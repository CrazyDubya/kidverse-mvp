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

describe('revocation is enforced everywhere', () => {
  const getWith = (path, token) =>
    fetch(`${url}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const patchStatus = (id, isActive) =>
    fetch(`${url}/api/auth/children/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenFor(parentA)}` },
      body: JSON.stringify({ isActive })
    });

  it('every authenticated API mount rejects a token after deactivation and after a reset', async () => {
    const stale = tokenFor(kidA1);
    for (const path of ['/api/users', '/api/games', '/api/parents', '/api/auth/me']) {
      expect((await getWith(path, stale)).status).toBe(200); // sanity: works before revocation
    }

    expect((await patchStatus(kidA1._id, false)).status).toBe(200);
    for (const path of ['/api/users', '/api/games', '/api/parents', '/api/auth/me']) {
      expect((await getWith(path, stale)).status).toBe(401);
    }

    // reactivation does not resurrect it either
    await patchStatus(kidA1._id, true);
    for (const path of ['/api/users', '/api/games', '/api/parents', '/api/auth/me']) {
      expect((await getWith(path, stale)).status).toBe(401);
    }
    expect((await getWith('/api/users', tokenFor({ ...kidA1, tokenVersion: 2 }))).status).toBe(200);
  });

  it('optional-auth routes treat a revoked token as anonymous (and still serve public content)', async () => {
    await patchStatus(kidA1._id, false);
    expect((await getWith('/api/content', tokenFor(kidA1))).status).toBe(200);
  });

  it('does not leave a socket connected when access is revoked during its handshake', async () => {
    // Reproduce the race: the handshake reads the account (still active), then the parent
    // deactivates the child before the connection is registered. The revoking request's
    // disconnect scan can't see a socket that hasn't joined its room yet.
    const realFindById = mockUsers.findById;
    let armed = true;
    mockUsers.findById = (id) => {
      const real = realFindById(id);
      if (!armed) return real;
      armed = false;
      const staleThenRevoke = {
        select: () => staleThenRevoke,
        lean: () => staleThenRevoke,
        then: (resolve, reject) =>
          real
            .then(async (snapshotBeforeRevocation) => {
              expect((await patchStatus(kidA1._id, false)).status).toBe(200);
              return snapshotBeforeRevocation;
            })
            .then(resolve, reject)
      };
      return staleThenRevoke;
    };

    try {
      const s = await open(tokenFor(kidA1)); // admitted using the stale pre-revocation snapshot
      expect(s).not.toBeInstanceOf(Error);
      expect(await within(closed(s), 2000)).toBe(true); // ...but must not stay connected
    } finally {
      mockUsers.findById = realFindById;
    }
  });

  it('ignores events from a socket while its session re-check is still pending', async () => {
    // Same race, but make the re-check slow so the revoked client can try to act in the gap
    const sibling = await open(tokenFor(kidA2)); // connected before the hooks are installed
    const heard = collect(sibling, 'chat:message');
    await settle();
    const realFindById = mockUsers.findById;
    let handshakeSeen = false;
    let revokedYet = false;
    let slowedRecheck = false;
    const chain = (real, after) => {
      const q = { select: () => q, lean: () => q, then: (resolve, reject) => real.then(after).then(resolve, reject) };
      return q;
    };
    mockUsers.findById = (id) => {
      const real = realFindById(id);
      if (!handshakeSeen) {
        // the handshake: hand it the stale snapshot, then revoke
        handshakeSeen = true;
        return chain(real, async (snapshot) => {
          expect((await patchStatus(kidA1._id, false)).status).toBe(200);
          revokedYet = true;
          return snapshot;
        });
      }
      if (revokedYet && !slowedRecheck) {
        // the first lookup after the revocation is the socket's re-check: make it slow
        slowedRecheck = true;
        return chain(real, (r) => new Promise((done) => setTimeout(() => done(r), 400)));
      }
      return real;
    };

    try {
      const revoked = await open(tokenFor(kidA1));
      expect(revoked).not.toBeInstanceOf(Error);
      revoked.emit('chat:message', { message: 'sent while the re-check was pending' });
      expect(await within(closed(revoked), 3000)).toBe(true);
      await settle();
      expect(heard).toHaveLength(0);
    } finally {
      mockUsers.findById = realFindById;
    }
  });

  it('does not lose events a legitimate client sends right after connecting', async () => {
    const sibling = await open(tokenFor(kidA2));
    const heard = collect(sibling, 'chat:message');
    const s = await open(tokenFor(kidA1));
    s.emit('chat:message', { message: 'first' });
    s.emit('chat:message', { message: 'second' });
    await settle(400);
    expect(heard.map((m) => m.message)).toEqual(['first', 'second']);
  });

  it('drops live sockets on any status update, even a redundant one', async () => {
    const child = await open(tokenFor(kidA1));
    const gone = closed(child);
    // already active: the update still bumps the token version, so the session must end
    expect((await patchStatus(kidA1._id, true)).status).toBe(200);
    expect(await within(gone, 2000)).toBe(true);
  });

  it('drops a revoked socket on its own, even if the API never swept it', async () => {
    // Simulates a failed/never-run sweep (adapter error, crash after the DB write): change the
    // account directly and rely only on the socket's periodic self-check.
    process.env.SOCKET_REVALIDATE_MS = '150';
    try {
      const revoked = await open(tokenFor(kidA1));
      const bystander = await open(tokenFor(kidA2));
      const gone = closed(revoked);

      mockUsers.rows.find((r) => r.username === 'kid_a1').isActive = false;

      expect(await within(gone, 3000)).toBe(true);
      expect(bystander.connected).toBe(true);
    } finally {
      delete process.env.SOCKET_REVALIDATE_MS;
    }
  });

  it('keeps connected clients connected across re-validation ticks', async () => {
    process.env.SOCKET_REVALIDATE_MS = '100';
    try {
      const ok = await open(tokenFor(kidA1));
      await settle(450);
      expect(ok.connected).toBe(true);
    } finally {
      delete process.env.SOCKET_REVALIDATE_MS;
    }
  });
});
