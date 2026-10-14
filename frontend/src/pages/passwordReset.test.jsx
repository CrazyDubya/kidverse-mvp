import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../App';
import { useAuth } from '../store/auth';
import { api } from '../api/client';

vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() }
}));
vi.mock('../api/socket', () => ({ connectSocket: () => ({ on: vi.fn(), off: vi.fn(), disconnect: vi.fn() }) }));

const TOKEN = 'a'.repeat(64);
const renderAt = (path) => render(<MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.setState({ token: null, user: null });
});

describe('forgot password', () => {
  it('is reachable from the sign-in page', async () => {
    const user = userEvent.setup();
    renderAt('/login');
    await user.click(screen.getByRole('link', { name: 'Forgot your password?' }));
    expect(screen.getByRole('heading', { name: 'Reset your password' })).toBeInTheDocument();
  });

  it('asks for a link and shows a neutral confirmation', async () => {
    const user = userEvent.setup();
    api.post.mockResolvedValue({ data: { success: true } });
    renderAt('/forgot-password');

    await user.type(screen.getByLabelText('Email'), 'pat@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(api.post).toHaveBeenCalledWith('/auth/forgot-password', { email: 'pat@example.com' });
    expect(await screen.findByRole('status')).toHaveTextContent('If that email belongs to a parent account');
  });

  it('shows rate-limit errors', async () => {
    const user = userEvent.setup();
    api.post.mockRejectedValue({ response: { status: 429, data: { message: 'Too many requests. Please try again later.' } } });
    renderAt('/forgot-password');
    await user.type(screen.getByLabelText('Email'), 'pat@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests');
  });
});

describe('reset password', () => {
  it('sends the token from the link fragment with the new password', async () => {
    const user = userEvent.setup();
    api.post.mockResolvedValue({ data: { success: true } });
    renderAt(`/reset-password#token=${TOKEN}`);

    await user.type(screen.getByLabelText('New password'), 'N3w!Passw0rd');
    await user.type(screen.getByLabelText('Confirm new password'), 'N3w!Passw0rd');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(api.post).toHaveBeenCalledWith('/auth/reset-password', { token: TOKEN, password: 'N3w!Passw0rd' });
    expect(await screen.findByRole('status')).toHaveTextContent('Your password was changed');
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toBeInTheDocument();
    expect(useAuth.getState().token).toBeNull(); // reset doesn't sign anyone in
  });

  it('refuses mismatched passwords without calling the server', async () => {
    const user = userEvent.setup();
    renderAt(`/reset-password#token=${TOKEN}`);
    await user.type(screen.getByLabelText('New password'), 'N3w!Passw0rd');
    await user.type(screen.getByLabelText('Confirm new password'), 'Different1!');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('do not match');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('shows the server message for an expired link and offers a new one', async () => {
    const user = userEvent.setup();
    api.post.mockRejectedValue({ response: { status: 400, data: { message: 'This reset link is invalid or has expired' } } });
    renderAt(`/reset-password#token=${TOKEN}`);
    await user.type(screen.getByLabelText('New password'), 'N3w!Passw0rd');
    await user.type(screen.getByLabelText('Confirm new password'), 'N3w!Passw0rd');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid or has expired');
    expect(screen.getByRole('link', { name: 'Request a new link' })).toBeInTheDocument();
  });

  it('rejects a link with no token without showing the form', () => {
    renderAt('/reset-password');
    expect(screen.getByRole('alert')).toHaveTextContent('invalid or has expired');
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });
});
