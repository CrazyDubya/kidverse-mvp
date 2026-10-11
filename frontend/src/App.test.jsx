import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from './App';
import { useAuth } from './store/auth';
import { api } from './api/client';

vi.mock('./api/client', async (importOriginal) => ({
  ...(await importOriginal()),
  api: { get: vi.fn(), post: vi.fn() }
}));
vi.mock('./api/socket', () => ({ connectSocket: () => ({ on: vi.fn(), off: vi.fn(), disconnect: vi.fn() }) }));

const renderAt = (path) => render(<MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.setState({ token: null, user: null });
  api.get.mockImplementation(async (url) => {
    if (url === '/status') return { data: { overallStatus: 'safe', lastUpdated: new Date().toISOString(), statistics: { monitoringEnabled: true } } };
    return { data: { alerts: [], interactions: [] } };
  });
});

describe('routing and auth', () => {
  it('redirects unauthenticated visitors to the login page', () => {
    renderAt('/');
    expect(screen.getByRole('heading', { name: 'Sign in to KidVerse' })).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('logs in, stores the session and lands on the dashboard', async () => {
    const user = userEvent.setup();
    api.post.mockResolvedValue({ data: { token: 'jwt', user: { id: 'p1', role: 'parent', firstName: 'Pat' } } });
    renderAt('/login');

    await user.type(screen.getByLabelText('Email or username'), 'pat@example.com');
    await user.type(screen.getByLabelText('Password'), 'Str0ng!Pass');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(api.post).toHaveBeenCalledWith('/auth/login', { identifier: 'pat@example.com', password: 'Str0ng!Pass' });
    expect(await screen.findByText('KidVerse Safety Dashboard')).toBeInTheDocument();
    expect(useAuth.getState().token).toBe('jwt');
  });

  it('shows the server message on a failed login and stays put', async () => {
    const user = userEvent.setup();
    api.post.mockRejectedValue({ response: { status: 401, data: { message: 'Invalid credentials' } } });
    renderAt('/login');

    await user.type(screen.getByLabelText('Email or username'), 'pat@example.com');
    await user.type(screen.getByLabelText('Password'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials');
    expect(useAuth.getState().token).toBeNull();
  });

  it('registers a parent and lists every validation problem', async () => {
    const user = userEvent.setup();
    api.post.mockRejectedValue({ response: { status: 400, data: { errors: [{ message: 'Password must contain a number' }, { message: 'A valid email is required' }] } } });
    renderAt('/login');

    await user.click(screen.getByRole('button', { name: /Create an account/ }));
    await user.type(screen.getByLabelText('First name'), 'Pat');
    await user.type(screen.getByLabelText('Last name'), 'Parent');
    await user.type(screen.getByLabelText('Email'), 'a@b.co');
    await user.type(screen.getByLabelText('Password'), 'weak');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Password must contain a number');
    expect(alert).toHaveTextContent('A valid email is required');
    expect(api.post).toHaveBeenCalledWith('/auth/register', { email: 'a@b.co', password: 'weak', firstName: 'Pat', lastName: 'Parent' });
  });

  it('sends a signed-in user straight past the login page', async () => {
    useAuth.setState({ token: 'jwt', user: { id: 'p1', role: 'parent', firstName: 'Pat' } });
    renderAt('/login');
    await waitFor(() => expect(screen.getByText('KidVerse Safety Dashboard')).toBeInTheDocument());
  });

  it('signs out back to the login page', async () => {
    const user = userEvent.setup();
    useAuth.setState({ token: 'jwt', user: { id: 'p1', role: 'parent', firstName: 'Pat' } });
    renderAt('/');
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in to KidVerse' })).toBeInTheDocument();
  });
});
