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

describe('GET /api/auth/me', () => {
  it('returns the current user without secrets', async () => {
    const { token } = (await register()).body;
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('parent@example.com');
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
  });
});
