import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dashboard from './Dashboard';
import { useAuth } from '../../store/auth';
import { api } from '../../api/client';
import { connectSocket } from '../../api/socket';

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal()),
  api: { get: vi.fn(), post: vi.fn() }
}));

const socket = { handlers: {}, on: vi.fn(), off: vi.fn(), disconnect: vi.fn() };
socket.on.mockImplementation((event, fn) => { socket.handlers[event] = fn; });
vi.mock('../../api/socket', () => ({ connectSocket: vi.fn(() => socket) }));

const now = () => new Date().toISOString();
const status = (overallStatus = 'critical', monitoringEnabled = true) => ({
  data: { overallStatus, lastUpdated: now(), statistics: { monitoringEnabled } }
});

let alerts, interactions;
const serve = ({ statusRes = status() } = {}) =>
  api.get.mockImplementation(async (url) => {
    if (url === '/status') return statusRes;
    if (url === '/alerts') return { data: { alerts } };
    if (url === '/interactions') return { data: { interactions } };
    throw new Error(`unexpected ${url}`);
  });

beforeEach(() => {
  vi.clearAllMocks();
  socket.handlers = {};
  alerts = [{ _id: 'a1', severity: 'critical', status: 'pending', createdAt: now(), description: 'Asked to meet in person', categories: ['off_platform_pressure:meetingRequests'] }];
  interactions = [
    { _id: 'i1', message: 'meet me at the park', contact: 'FriendlyHelper', riskScore: 10, timestamp: now(), direction: 'incoming' },
    { _id: 'i2', message: 'gg nice build', contact: 'BuilderPro', riskScore: 0, timestamp: now(), direction: 'incoming' }
  ];
  useAuth.setState({ token: 'tok', user: { id: 'p1', role: 'parent', firstName: 'Pat' } });
  serve();
});

describe('Dashboard', () => {
  it('shows server data: status, alerts and interactions', async () => {
    render(<Dashboard />);
    expect(await screen.findByText('Asked to meet in person')).toBeInTheDocument();
    expect(screen.getByText(/FriendlyHelper/)).toBeInTheDocument();
    expect(screen.getByText('1 active')).toBeInTheDocument();
    expect(screen.getByText(/Safety Status: Alert/)).toBeInTheDocument(); // critical -> danger indicator
  });

  it('asks the API for a window matching the selected time range', async () => {
    render(<Dashboard />);
    await screen.findByText('Asked to meet in person');
    const call = api.get.mock.calls.find(([url]) => url === '/interactions');
    const since = new Date(call[1].params.startDate).getTime();
    expect(Date.now() - since).toBeGreaterThan(23.9 * 3600e3);
    expect(Date.now() - since).toBeLessThan(24.1 * 3600e3);
  });

  it('filters interactions by threat level', async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    await screen.findByText(/FriendlyHelper/);
    const select = screen.getAllByRole('combobox').find((el) => within(el).queryByText('High'));
    await user.selectOptions(select, 'high');
    expect(screen.getByText(/FriendlyHelper/)).toBeInTheDocument();
    expect(screen.queryByText(/BuilderPro/)).not.toBeInTheDocument();
  });

  it('renders message text as text, never as markup', async () => {
    interactions = [{ _id: 'x', message: '<img src=x onerror=alert(1)>', contact: '<b>evil</b>', riskScore: 0, timestamp: now() }];
    const { container } = render(<Dashboard />);
    await screen.findByText(/<img src=x/);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });

  it('resolves an alert through the API and reloads', async () => {
    const user = userEvent.setup();
    api.post.mockResolvedValue({ data: { success: true } });
    render(<Dashboard />);
    await user.click(await screen.findByRole('button', { name: 'Resolve' }));
    expect(api.post).toHaveBeenCalledWith('/alerts/a1/review', { action: 'resolved' });
    await waitFor(() => expect(api.get.mock.calls.filter(([u]) => u === '/status').length).toBeGreaterThan(1));
  });

  it('refreshes when the server pushes a new alert over the socket', async () => {
    render(<Dashboard />);
    await screen.findByText('Asked to meet in person');
    const before = api.get.mock.calls.filter(([u]) => u === '/alerts').length;
    socket.handlers['alert:new']({ severity: 'high', description: 'Something new' });
    await waitFor(() => expect(api.get.mock.calls.filter(([u]) => u === '/alerts').length).toBe(before + 1));
  });

  it('shows an error with retry when the API fails', async () => {
    const user = userEvent.setup();
    api.get.mockRejectedValue({ response: { status: 500, data: { message: 'boom' } } });
    render(<Dashboard />);
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
    serve();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Asked to meet in person')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps children out and never calls the API for them', () => {
    useAuth.setState({ user: { id: 'c1', role: 'child', firstName: 'Kid' } });
    render(<Dashboard />);
    expect(screen.getByText(/for parents and guardians/)).toBeInTheDocument();
    expect(screen.queryByText('Asked to meet in person')).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
    expect(connectSocket).not.toHaveBeenCalled();
  });

  it('reflects monitoring being switched off', async () => {
    serve({ statusRes: status('safe', false) });
    render(<Dashboard />);
    await screen.findByText('Asked to meet in person');
    expect(screen.getByText(/Inactive/)).toBeInTheDocument();
  });

  it('disconnects the socket on unmount', async () => {
    const { unmount } = render(<Dashboard />);
    await screen.findByText('Asked to meet in person');
    unmount();
    expect(socket.disconnect).toHaveBeenCalled();
  });
});
