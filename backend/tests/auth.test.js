process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.AUTH_RATE_LIMIT_MAX = '1000';

const mockUsers = require('./helpers/fakeModels').makeStore();
const mockFamilies = require('./helpers/fakeModels').makeStore();
jest.mock('../models/User', () => mockUsers);
jest.mock('../models/Family', () => mockFamilies);

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { app } = require('../server');

const parent = { email: 'Parent@Example.com', password: 'Str0ng!Pass', firstName: 'Pat', lastName: 'Parent' };

const register = (body = parent) => request(app).post('/api/auth/register').send(body);
const login = (identifier, password) => request(app).post('/api/auth/login').send({ identifier, password });

beforeEach(() => {
  mockUsers.reset();
  mockFamilies.reset();
});

describe('POST /api/auth/register', () => {
  it('creates a parent, a family, and returns a signed token', async () => {
    const res = await register();
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'parent@example.com', role: 'parent' });
    expect(res.body.user.familyId).toBeTruthy();
    expect(mockFamilies.rows).toHaveLength(1);

    const claims = jwt.verify(res.body.token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    expect(claims).toMatchObject({ userId: res.body.user.id, role: 'parent', familyId: res.body.user.familyId });
  });

  it('never stores or returns the plaintext password', async () => {
    const res = await register();
    expect(JSON.stringify(res.body)).not.toContain(parent.password);
    expect(mockUsers.rows[0].passwordHash).toMatch(/^\$2[aby]\$12\$/);
  });

  it('ignores a client-supplied role', async () => {
    const res = await register({ ...parent, role: 'admin' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('parent');
  });

  it('rejects weak passwords without echoing them back', async () => {
    const res = await register({ ...parent, password: 'weakpass' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain('weakpass');
  });

  it('rejects passwords over bcrypt\'s 72 byte limit', async () => {
    const res = await register({ ...parent, password: 'Aa1!' + 'x'.repeat(80) });
    expect(res.status).toBe(400);
  });

  it('rejects non-string fields (operator injection)', async () => {
    const res = await register({ ...parent, email: { $gt: '' } });
    expect(res.status).toBe(400);
  });

  it('returns a generic 409 for a duplicate email', async () => {
    await register();
    const res = await register();
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Unable to register with those details');
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await register();
  });

  it('logs in with email (case-insensitive)', async () => {
    const res = await login('PARENT@example.com', parent.password);
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it('gives the same error for a wrong password and an unknown user', async () => {
    const wrong = await login('parent@example.com', 'Wrong!Pass1');
    const unknown = await login('nobody@example.com', 'Wrong!Pass1');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('rejects operator-injection identifiers', async () => {
    const res = await request(app).post('/api/auth/login').send({ identifier: { $ne: null }, password: 'x' });
    expect(res.status).toBe(400);
  });

  it('locks the account after repeated failures, even for the right password', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await login('parent@example.com', 'Wrong!Pass1')).status).toBe(401);
    }
    const locked = await login('parent@example.com', parent.password);
    expect(locked.status).toBe(429);
  });

  it('resets the failure counter after a successful login', async () => {
    await login('parent@example.com', 'Wrong!Pass1');
    await login('parent@example.com', 'Wrong!Pass1');
    expect((await login('parent@example.com', parent.password)).status).toBe(200);
    expect(mockUsers.rows[0].failedLoginAttempts).toBe(0);
  });

  it('refuses deactivated accounts', async () => {
    mockUsers.rows[0].isActive = false;
    expect((await login('parent@example.com', parent.password)).status).toBe(401);
  });
});

describe('POST /api/auth/children', () => {
  const child = { username: 'Kiddo_1', password: 'Kid5!Password', firstName: 'Kit', lastName: 'Parent', dateOfBirth: '2016-05-01' };
  let parentToken;

  beforeEach(async () => {
    parentToken = (await register()).body.token;
  });

  const create = (token, body = child) => {
    const r = request(app).post('/api/auth/children').send(body);
    return token ? r.set('Authorization', `Bearer ${token}`) : r;
  };

  it('requires authentication', async () => {
    expect((await create(null)).status).toBe(401);
  });

  it('creates a child inside the parent\'s family and the child can log in by username', async () => {
    const res = await create(parentToken);
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ username: 'kiddo_1', role: 'child' });

    const parentFamily = mockUsers.rows.find((r) => r.role === 'parent').familyId;
    expect(String(res.body.user.familyId)).toBe(String(parentFamily));

    const loggedIn = await login('KIDDO_1', child.password);
    expect(loggedIn.status).toBe(200);
    expect(loggedIn.body.user.role).toBe('child');
  });

  it('forbids children from creating accounts', async () => {
    await create(parentToken);
    const childToken = (await login('kiddo_1', child.password)).body.token;
    const res = await create(childToken, { ...child, username: 'sneaky_kid' });
    expect(res.status).toBe(403);
  });

  it('rejects out-of-range ages and invalid usernames', async () => {
    expect((await create(parentToken, { ...child, dateOfBirth: '1990-01-01' })).status).toBe(400);
    expect((await create(parentToken, { ...child, username: 'a b' })).status).toBe(400);
  });

  it('rejects a duplicate username', async () => {
    await create(parentToken);
    expect((await create(parentToken)).status).toBe(409);
  });

  it('rejects tokens signed with a different algorithm or secret', async () => {
    const forged = jwt.sign({ userId: mockUsers.rows[0]._id.toString(), role: 'parent' }, 'wrong-secret');
    expect((await create(forged)).status).toBe(401);
  });
});

describe('GET /api/auth/children', () => {
  const mkChild = (token, username) =>
    request(app).post('/api/auth/children').set('Authorization', `Bearer ${token}`).send({
      username, password: 'Kid5!Password', firstName: 'Kit', lastName: 'Parent', dateOfBirth: '2016-05-01'
    });

  it('lists only the caller\'s own family\'s children, without secrets', async () => {
    const a = (await register()).body.token;
    const b = (await register({ ...parent, email: 'other@example.com' })).body.token;
    await mkChild(a, 'kid_a1');
    await mkChild(a, 'kid_a2');
    await mkChild(b, 'kid_b1');

    const res = await request(app).get('/api/auth/children').set('Authorization', `Bearer ${a}`);
    expect(res.status).toBe(200);
    expect(res.body.children.map((c) => c.username)).toEqual(['kid_a1', 'kid_a2']);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
  });

  it('requires a parent', async () => {
    expect((await request(app).get('/api/auth/children')).status).toBe(401);
    const a = (await register()).body.token;
    await mkChild(a, 'kid_a1');
    const childToken = (await login('kid_a1', 'Kid5!Password')).body.token;
    expect((await request(app).get('/api/auth/children').set('Authorization', `Bearer ${childToken}`)).status).toBe(403);
  });
});

describe('managing children', () => {
  const CHILD_PW = 'Kid5!Password';
  const authz = (token) => ({ Authorization: `Bearer ${token}` });
  let parentToken;
  let otherToken;
  let childId;
  let childToken;

  const setStatus = (token, id, body) => request(app).patch(`/api/auth/children/${id}/status`).set(authz(token)).send(body);
  const resetPassword = (token, id, password) =>
    request(app).post(`/api/auth/children/${id}/password`).set(authz(token)).send({ password });
  const me = (token) => request(app).get('/api/auth/me').set(authz(token));

  beforeEach(async () => {
    parentToken = (await register()).body.token;
    otherToken = (await register({ ...parent, email: 'other@example.com' })).body.token;
    const created = await request(app).post('/api/auth/children').set(authz(parentToken)).send({
      username: 'kid_a1', password: CHILD_PW, firstName: 'Kit', lastName: 'Parent', dateOfBirth: '2016-05-01'
    });
    childId = created.body.user.id;
    childToken = (await login('kid_a1', CHILD_PW)).body.token;
  });

  describe('deactivate / reactivate', () => {
    it('blocks sign-in and kills existing sessions immediately', async () => {
      expect((await me(childToken)).status).toBe(200);

      const res = await setStatus(parentToken, childId, { isActive: false });
      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({ id: childId, isActive: false });

      expect((await login('kid_a1', CHILD_PW)).status).toBe(401);
      expect((await me(childToken)).status).toBe(401);
      const list = await request(app).get('/api/auth/children').set(authz(parentToken));
      expect(list.body.children[0].isActive).toBe(false);
    });

    it('reactivation restores sign-in but not tokens from before', async () => {
      await setStatus(parentToken, childId, { isActive: false });
      await setStatus(parentToken, childId, { isActive: true });

      expect((await me(childToken)).status).toBe(401); // old token stays dead
      const again = await login('kid_a1', CHILD_PW);
      expect(again.status).toBe(200);
      expect((await me(again.body.token)).status).toBe(200);
    });

    it('is limited to the parent\'s own children', async () => {
      expect((await setStatus(otherToken, childId, { isActive: false })).status).toBe(404);
      expect((await login('kid_a1', CHILD_PW)).status).toBe(200); // untouched

      expect((await setStatus(childToken, childId, { isActive: false })).status).toBe(403);
      expect((await request(app).patch(`/api/auth/children/${childId}/status`).send({ isActive: false })).status).toBe(401);
      expect((await setStatus(parentToken, mockUsers.rows.find((r) => r.role === 'parent')._id.toString(), { isActive: false })).status).toBe(404);
      expect((await setStatus(parentToken, '5'.repeat(24), { isActive: false })).status).toBe(404);
    });

    it('validates the id and body', async () => {
      expect((await setStatus(parentToken, 'zzz', { isActive: false })).status).toBe(400);
      expect((await setStatus(parentToken, 'aaaaaaaaaaaa', { isActive: false })).status).toBe(400);
      expect((await setStatus(parentToken, childId, { isActive: 'false' })).status).toBe(400);
      expect((await setStatus(parentToken, childId, {})).status).toBe(400);
    });
  });

  describe('reset password', () => {
    it('sets the new password, rejects the old one, and signs the child out everywhere', async () => {
      const NEW_PW = 'Brand9!NewPass';
      const res = await resetPassword(parentToken, childId, NEW_PW);
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain(NEW_PW);

      expect((await login('kid_a1', CHILD_PW)).status).toBe(401);
      const fresh = await login('kid_a1', NEW_PW);
      expect(fresh.status).toBe(200);
      expect((await me(childToken)).status).toBe(401); // session from before the reset
      expect((await me(fresh.body.token)).status).toBe(200);
    });

    it('unlocks a locked-out child', async () => {
      for (let i = 0; i < 5; i++) await login('kid_a1', 'Wrong!Pass1');
      expect((await login('kid_a1', CHILD_PW)).status).toBe(429);

      await resetPassword(parentToken, childId, 'Brand9!NewPass');
      expect((await login('kid_a1', 'Brand9!NewPass')).status).toBe(200);
    });

    it('enforces the password rules without echoing the input', async () => {
      const res = await resetPassword(parentToken, childId, 'weakpass');
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toContain('weakpass');
      expect((await login('kid_a1', CHILD_PW)).status).toBe(200); // unchanged
    });

    it('is limited to the parent\'s own children', async () => {
      expect((await resetPassword(otherToken, childId, 'Brand9!NewPass')).status).toBe(404);
      expect((await resetPassword(childToken, childId, 'Brand9!NewPass')).status).toBe(403);
      expect((await resetPassword(parentToken, 'nope', 'Brand9!NewPass')).status).toBe(400);
      expect((await login('kid_a1', CHILD_PW)).status).toBe(200); // untouched
    });
  });
});

describe('GET /api/auth/me', () => {
  it('returns the current user without secrets', async () => {
    const { token } = (await register()).body;
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('parent@example.com');
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
  });
});
