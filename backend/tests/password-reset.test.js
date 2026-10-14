process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.AUTH_RATE_LIMIT_MAX = '1000';
process.env.FORGOT_RATE_LIMIT_MAX = '1000';
process.env.CLIENT_URL = 'https://app.example.com';

const mockUsers = require('./helpers/fakeModels').makeStore();
const mockFamilies = require('./helpers/fakeModels').makeStore();
jest.mock('../models/User', () => mockUsers);
jest.mock('../models/Family', () => mockFamilies);
jest.mock('../services/mailer', () => ({
  sendPasswordReset: jest.fn().mockResolvedValue(),
  sendPasswordChanged: jest.fn().mockResolvedValue()
}));

const crypto = require('crypto');
const request = require('supertest');
const mailer = require('../services/mailer');
const { app } = require('../server');

const PW = 'Str0ng!Pass';
const NEW_PW = 'N3w!Passw0rd';

const register = (email = 'pat@example.com') =>
  request(app).post('/api/auth/register').send({ email, password: PW, firstName: 'Pat', lastName: 'Parent' });
const forgot = (email) => request(app).post('/api/auth/forgot-password').send({ email });
const reset = (token, password = NEW_PW) => request(app).post('/api/auth/reset-password').send({ token, password });
const login = (identifier, password) => request(app).post('/api/auth/login').send({ identifier, password });

// The route answers first and works afterwards
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const issueToken = async (email = 'pat@example.com') => {
  mailer.sendPasswordReset.mockClear();
  await forgot(email);
  await settle();
  expect(mailer.sendPasswordReset).toHaveBeenCalledTimes(1);
  const { link } = mailer.sendPasswordReset.mock.calls[0][0];
  return link.split('#token=')[1];
};

beforeEach(() => {
  mockUsers.reset();
  mockFamilies.reset();
  mailer.sendPasswordReset.mockClear();
  mailer.sendPasswordChanged.mockClear();
});

describe('POST /api/auth/forgot-password', () => {
  it('emails a link built from CLIENT_URL with the token in the fragment', async () => {
    await register();
    const res = await forgot('pat@example.com');
    await settle();

    expect(res.status).toBe(200);
    expect(mailer.sendPasswordReset).toHaveBeenCalledTimes(1);
    const arg = mailer.sendPasswordReset.mock.calls[0][0];
    expect(arg.to).toBe('pat@example.com');
    expect(arg.link).toMatch(/^https:\/\/app\.example\.com\/reset-password#token=[a-f0-9]{64}$/);
  });

  it('ignores a spoofed Host header', async () => {
    await register();
    await request(app).post('/api/auth/forgot-password').set('Host', 'evil.example').set('X-Forwarded-Host', 'evil.example').send({ email: 'pat@example.com' });
    await settle();
    expect(mailer.sendPasswordReset.mock.calls[0][0].link).toContain('https://app.example.com/');
  });

  it('stores only a hash of the token', async () => {
    await register();
    const token = await issueToken();
    const row = mockUsers.rows[0];
    expect(row.passwordResetHash).toBe(crypto.createHash('sha256').update(token).digest('hex'));
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it('answers identically whether or not the account exists', async () => {
    await register();
    const known = await forgot('pat@example.com');
    const unknown = await forgot('nobody@example.com');
    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);
    await settle();
    expect(mailer.sendPasswordReset).toHaveBeenCalledTimes(1);
  });

  it('sends nothing for children or deactivated accounts', async () => {
    const { body } = await register();
    const auth = { Authorization: `Bearer ${body.token}` };
    await request(app).post('/api/auth/children').set(auth).send({
      username: 'kiddo', password: PW, firstName: 'Kid', lastName: 'Parent', dateOfBirth: '2016-01-01'
    });
    await forgot('kiddo');
    mockUsers.rows[0].isActive = false;
    await forgot('pat@example.com');
    await settle();
    expect(mailer.sendPasswordReset).not.toHaveBeenCalled();
  });

  it('does not email the same account twice within a minute', async () => {
    await register();
    await forgot('pat@example.com');
    await forgot('pat@example.com');
    await settle();
    expect(mailer.sendPasswordReset).toHaveBeenCalledTimes(1);
  });

  it('matches Gmail addresses the way registration normalised them', async () => {
    await register('Pat.Parent@gmail.com');
    await forgot('pat.parent@gmail.com');
    await settle();
    expect(mailer.sendPasswordReset).toHaveBeenCalledTimes(1);
  });

  it('rejects non-string emails (operator injection)', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({ email: { $ne: null } });
    expect(res.status).toBe(400);
    expect(mailer.sendPasswordReset).not.toHaveBeenCalled();
  });

  it('survives a mail failure', async () => {
    await register();
    mailer.sendPasswordReset.mockRejectedValueOnce(new Error('smtp down'));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await forgot('pat@example.com');
    await settle();
    spy.mockRestore();
    expect(res.status).toBe(200);
  });
});

describe('POST /api/auth/reset-password', () => {
  it('sets the new password, and the old one stops working', async () => {
    await register();
    const token = await issueToken();

    const res = await reset(token);
    expect(res.status).toBe(200);
    expect((await login('pat@example.com', NEW_PW)).status).toBe(200);
    expect((await login('pat@example.com', PW)).status).toBe(401);
    await settle();
    expect(mailer.sendPasswordChanged).toHaveBeenCalledTimes(1);
  });

  it('is single-use', async () => {
    await register();
    const token = await issueToken();
    expect((await reset(token)).status).toBe(200);
    const again = await reset(token, 'An0ther!Passw0rd');
    expect(again.status).toBe(400);
    expect((await login('pat@example.com', NEW_PW)).status).toBe(200);
  });

  it('rejects expired and unknown tokens with the same message', async () => {
    await register();
    const token = await issueToken();
    mockUsers.rows[0].passwordResetExpires = new Date(Date.now() - 1000);

    const expired = await reset(token);
    const unknown = await reset('a'.repeat(64));
    expect([expired.status, unknown.status]).toEqual([400, 400]);
    expect(expired.body).toEqual(unknown.body);
    expect((await login('pat@example.com', PW)).status).toBe(200); // password untouched
  });

  it('rejects malformed and non-string tokens before touching the database', async () => {
    expect((await reset('short')).status).toBe(400);
    const res = await request(app).post('/api/auth/reset-password').send({ token: { $ne: null }, password: NEW_PW });
    expect(res.status).toBe(400);
  });

  it('revokes sessions issued before the reset', async () => {
    const { body } = await register();
    const token = await issueToken();
    await reset(token);
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${body.token}`);
    expect(me.status).toBe(401);
  });

  it('clears an account lockout', async () => {
    await register();
    for (let i = 0; i < 5; i++) await login('pat@example.com', 'wrong');
    expect((await login('pat@example.com', PW)).status).toBe(429);

    const token = await issueToken();
    await reset(token);
    expect((await login('pat@example.com', NEW_PW)).status).toBe(200);
  });

  it('enforces the password rules without echoing the password', async () => {
    await register();
    const token = await issueToken();
    const res = await reset(token, 'weak');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain('weak"');
    expect((await reset(token)).status).toBe(200); // a rejected attempt doesn't burn the token
  });

  it('refuses a token on a deactivated account', async () => {
    await register();
    const token = await issueToken();
    mockUsers.rows[0].isActive = false;
    expect((await reset(token)).status).toBe(400);
  });
});

describe('login email normalisation', () => {
  it('lets a Gmail user sign in with the dotted form they registered with', async () => {
    await register('Pat.Parent@gmail.com');
    expect((await login('Pat.Parent@gmail.com', PW)).status).toBe(200);
  });
});

describe('concurrency and sockets', () => {
  it('sends one email, with the one valid token, when requests race', async () => {
    await register();
    await Promise.all([forgot('pat@example.com'), forgot('pat@example.com'), forgot('pat@example.com')]);
    await settle();

    expect(mailer.sendPasswordReset).toHaveBeenCalledTimes(1);
    const token = mailer.sendPasswordReset.mock.calls[0][0].link.split('#token=')[1];
    expect((await reset(token)).status).toBe(200);
  });

  it('drops a family-less admin\'s live socket after a reset', async () => {
    const bcrypt = require('bcryptjs');
    const jwt = require('jsonwebtoken');
    const { io: connect } = require('socket.io-client');
    const { server } = require('../server');
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const socket = connect(`http://127.0.0.1:${server.address().port}`, {
      reconnection: false,
      forceNew: true,
      auth: { token: '' }
    });
    try {
      const admin = await mockUsers.create({
        role: 'admin', email: 'root@example.com', firstName: 'Ad', lastName: 'Min',
        passwordHash: bcrypt.hashSync(PW, 4), tokenVersion: 0
      });
      socket.auth = {
        token: jwt.sign({ userId: String(admin._id), role: 'admin', username: 'Ad', tv: 0 }, process.env.JWT_SECRET, { algorithm: 'HS256' })
      };
      await new Promise((resolve, reject) => {
        socket.on('connect', resolve);
        socket.on('connect_error', reject);
        socket.connect();
      });

      const gone = new Promise((resolve) => socket.on('disconnect', () => resolve(true)));
      const token = await issueToken('root@example.com');
      expect((await reset(token)).status).toBe(200);
      expect(await Promise.race([gone, new Promise((r) => setTimeout(() => r(false), 2000))])).toBe(true);
    } finally {
      socket.disconnect();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
