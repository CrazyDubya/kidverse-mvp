process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.AUTH_RATE_LIMIT_MAX = '1000';

const { makeCollection } = require('./helpers/fakeCollection');

const mockUsers = makeCollection({ defaults: () => ({ isActive: true }) });
const mockFamilies = makeCollection();
const mockInteractions = makeCollection();
const mockAlerts = makeCollection();
const mockConfigs = makeCollection();
jest.mock('../models/User', () =>
  Object.assign(mockUsers, { USERNAME_PATTERN: jest.requireActual('../models/User').USERNAME_PATTERN })
);
jest.mock('../models/Family', () => mockFamilies);
jest.mock('../models/Interaction', () => mockInteractions);
jest.mock('../models/Alert', () => {
  const real = jest.requireActual('../models/Alert');
  return Object.assign(mockAlerts, { STATUSES: real.STATUSES, SEVERITIES: real.SEVERITIES });
});
jest.mock('../models/Config', () => {
  const real = jest.requireActual('../models/Config');
  return Object.assign(mockConfigs, { DEFAULTS: real.DEFAULTS });
});

const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { io: connect } = require('socket.io-client');
const { server } = require('../server');

const F1 = new mongoose.Types.ObjectId();
const F2 = new mongoose.Types.ObjectId();
let url;
let sockets = [];
let parentA, kidA1, kidA2, kidB;

const tokenFor = (u, overrides = {}) =>
  jwt.sign(
    { userId: String(u._id), role: u.role, familyId: String(u.familyId), username: u.username || u.firstName, tv: u.tokenVersion || 0, ...overrides },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '5m' }
  );

// Resolves with the connected socket, or with the Error if the handshake is refused
const open = (token) =>
  new Promise((resolve) => {
    const s = connect(url, { auth: token ? { token } : {}, reconnection: false, forceNew: true });
    sockets.push(s);
    s.on('connect', () => resolve(s));
    s.on('connect_error', (err) => resolve(err));
  });

const collect = (socket, event) => {
  const got = [];
  socket.on(event, (m) => got.push(m));
  return got;
};
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms));
const closed = (socket) => new Promise((resolve) => (socket.disconnected ? resolve(true) : socket.on('disconnect', () => resolve(true))));
const within = (promise, ms) => Promise.race([promise, new Promise((r) => setTimeout(() => r(false), ms))]);

beforeAll(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(async () => {
  [mockUsers, mockFamilies, mockInteractions, mockAlerts, mockConfigs].forEach((c) => c.reset());
  const passwordHash = bcrypt.hashSync('Kid5!Password', 4);
  parentA = await mockUsers.create({ role: 'parent', familyId: F1, email: 'a@x.co', firstName: 'Pa', lastName: 'A', passwordHash });
  kidA1 = await mockUsers.create({ role: 'child', familyId: F1, username: 'kid_a1', firstName: 'K1', lastName: 'A', passwordHash });
  kidA2 = await mockUsers.create({ role: 'child', familyId: F1, username: 'kid_a2', firstName: 'K2', lastName: 'A', passwordHash });
  kidB = await mockUsers.create({ role: 'child', familyId: F2, username: 'kid_b1', firstName: 'KB', lastName: 'B', passwordHash });
});

afterEach(() => {
  sockets.forEach((s) => s.disconnect());
  sockets = [];
});

describe('handshake', () => {
  it('accepts a valid token', async () => {
    const s = await open(tokenFor(kidA1));
    expect(s.connected).toBe(true);
  });

  it('refuses a missing, forged or alg:none token', async () => {
    expect(await open(null)).toBeInstanceOf(Error);
    expect(await open(jwt.sign({ userId: String(kidA1._id) }, 'wrong-secret'))).toBeInstanceOf(Error);
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ userId: String(kidA1._id) })).toString('base64url')}.`;
    expect(await open(none)).toBeInstanceOf(Error);
  });

  it('refuses a valid signature for a deactivated or missing account', async () => {
    const token = tokenFor(kidA1);
    mockUsers.rows.find((r) => r.username === 'kid_a1').isActive = false;
    expect(await open(token)).toBeInstanceOf(Error);
    expect(await open(tokenFor(kidA1, { userId: String(new mongoose.Types.ObjectId()) }))).toBeInstanceOf(Error);
  });

  it('refuses a token from before a password reset', async () => {
    const old = tokenFor(kidA1);
    mockUsers.rows.find((r) => r.username === 'kid_a1').tokenVersion = 1;
    expect(await open(old)).toBeInstanceOf(Error);
    expect((await open(tokenFor({ ...kidA1, tokenVersion: 1 }))).connected).toBe(true);
  });
});

describe('family isolation', () => {
  it('delivers chat and presence only within the family, escaped', async () => {
    const a1 = await open(tokenFor(kidA1));
    const a2 = await open(tokenFor(kidA2));
    const b = await open(tokenFor(kidB));
    const toA2 = collect(a2, 'chat:message');
    const toB = collect(b, 'chat:message');

    a1.emit('chat:message', { message: '<img src=x onerror=alert(1)>' });
    await settle();
    expect(toA2).toHaveLength(1);
    expect(toA2[0].message).not.toContain('<');
    expect(toA2[0].senderId).toBe(String(kidA1._id)); // from the token, not the client
    expect(toB).toHaveLength(0);

    const presenceB = collect(b, 'user:online');
    const late = await open(tokenFor(parentA));
    await settle();
    expect(late.connected).toBe(true);
    expect(presenceB).toHaveLength(0);
  });

  it('flood-limits chat per socket', async () => {
    const a1 = await open(tokenFor(kidA1));
    const errors = collect(a1, 'error');
    for (let i = 0; i < 25; i++) a1.emit('chat:message', { message: 'hi' });
    await settle();
    expect(errors.some((e) => /too quickly/.test(e.message))).toBe(true);
  });

  it('only lets members emit into a game room', async () => {
    const a1 = await open(tokenFor(kidA1));
    const a2 = await open(tokenFor(kidA2));
    const outsider = await open(tokenFor(kidB));
    const seen = collect(a2, 'game:action');

    a1.emit('game:join', { roomId: 'r1' });
    a2.emit('game:join', { roomId: 'r1' });
    await settle();
    outsider.emit('game:action', { roomId: 'r1', action: 'spoof' });
    await settle();
    expect(seen).toHaveLength(0);

    a1.emit('game:action', { roomId: 'r1', action: 'move' });
    await settle();
    expect(seen).toHaveLength(1);
    expect(seen[0].userId).toBe(String(kidA1._id));

  });

  it('does not let a game room named like a family room reach that family\'s traffic', async () => {
    const a1 = await open(tokenFor(kidA1));
    const b = await open(tokenFor(kidB));
    const snooped = collect(a1, 'chat:message');

    a1.emit('game:join', { roomId: `family_${F2}` }); // game rooms are namespaced (game_*)
    await settle();
    b.emit('chat:message', { message: 'private family chat' });
    await settle();
    expect(snooped).toHaveLength(0);
  });
});

describe('live sessions end when access is revoked', () => {
  const http = (method, path, body) => fetch(`${url}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenFor(parentA)}` },
    body: JSON.stringify(body)
  });

  it('drops a connected child when the parent deactivates them, but no one else', async () => {
    const child = await open(tokenFor(kidA1));
    const sibling = await open(tokenFor(kidA2));
    const other = await open(tokenFor(kidB));
    const gone = closed(child);

    const res = await http('PATCH', `/api/auth/children/${kidA1._id}/status`, { isActive: false });
    expect(res.status).toBe(200);
    expect(await within(gone, 2000)).toBe(true);
    await settle();
    expect([sibling.connected, other.connected]).toEqual([true, true]);
  });

  it('drops a connected child when their password is reset', async () => {
    const child = await open(tokenFor(kidA1));
    const gone = closed(child);

    const res = await http('POST', `/api/auth/children/${kidA1._id}/password`, { password: 'Brand9!NewPass' });
    expect(res.status).toBe(200);
    expect(await within(gone, 2000)).toBe(true);
    // and the old token can't get back in
    expect(await open(tokenFor(kidA1))).toBeInstanceOf(Error);
  });
});
