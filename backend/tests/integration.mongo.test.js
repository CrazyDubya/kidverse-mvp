// End-to-end flow against a real MongoDB (mongodb-memory-server) with no model mocks.
// Needs a mongod binary download, so it only runs when RUN_MONGO_TESTS=1 (set in CI).
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.AUTH_RATE_LIMIT_MAX = '1000';

const run = process.env.RUN_MONGO_TESTS === '1';
const suite = run ? describe : describe.skip;

suite('integration (real MongoDB)', () => {
  jest.setTimeout(120000);

  const mongoose = require('mongoose');
  const request = require('supertest');
  let mongod;
  let app;

  const PW = 'Str0ng!Pass';
  const PREDATOR = "don't tell your parents, this is our secret. meet me at the park";

  const auth = (token) => ({ Authorization: `Bearer ${token}` });
  const register = (email) =>
    request(app).post('/api/auth/register').send({ email, password: PW, firstName: 'Pat', lastName: 'Parent' });

  beforeAll(async () => {
    const { MongoMemoryServer } = require('mongodb-memory-server');
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    ({ app } = require('../server'));
    // Build the real indexes (unique/sparse) before any test relies on them
    await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
  });

  let a; // family A: { token, familyId, childId, childToken }
  let b;

  it('registers parents; the unique email index wins a concurrent race', async () => {
    const [r1, r2] = await Promise.all([register('a@example.com'), register('a@example.com')]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    const ok = r1.status === 201 ? r1 : r2;
    a = { token: ok.body.token, familyId: ok.body.user.familyId };

    const rb = await register('b@example.com');
    expect(rb.status).toBe(201);
    b = { token: rb.body.token, familyId: rb.body.user.familyId };
    expect(a.familyId).not.toBe(b.familyId);

    const User = require('../models/User');
    expect(await User.countDocuments({ email: 'a@example.com' })).toBe(1);
    const stored = await User.findOne({ email: 'a@example.com' }).select('+passwordHash').lean();
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    // select:false keeps the hash out of normal reads
    expect((await User.findOne({ email: 'a@example.com' }).lean()).passwordHash).toBeUndefined();
  });

  it('creates children without email (sparse index) and rejects duplicate usernames', async () => {
    const mk = (token, username) =>
      request(app).post('/api/auth/children').set(auth(token)).send({
        username, password: PW, firstName: 'Kid', lastName: 'Parent', dateOfBirth: '2016-05-01'
      });

    const c1 = await mk(a.token, 'kid_a1');
    const c2 = await mk(a.token, 'kid_a2'); // second child with no email must not collide on null
    const cb = await mk(b.token, 'kid_b1');
    expect([c1.status, c2.status, cb.status]).toEqual([201, 201, 201]);
    expect((await mk(b.token, 'kid_a1')).status).toBe(409);

    expect(c1.body.user.familyId).toBe(a.familyId);
    a.childId = c1.body.user.id;
    b.childId = cb.body.user.id;

    const login = await request(app).post('/api/auth/login').send({ identifier: 'KID_A1', password: PW });
    expect(login.status).toBe(200);
    a.childToken = login.body.token;
  });

  it('ingests, alerts, and keeps families isolated', async () => {
    const send = (token, body) => request(app).post('/api/interactions').set(auth(token)).send(body);

    expect((await send(a.childToken, { message: PREDATOR })).status).toBe(201);
    expect((await send(a.token, { userId: a.childId, message: 'nice build!' })).status).toBe(201);
    expect((await send(b.token, { userId: a.childId, message: PREDATOR })).status).toBe(404);

    const alertsA = await request(app).get('/api/alerts').set(auth(a.token));
    const alertsB = await request(app).get('/api/alerts').set(auth(b.token));
    expect(alertsA.body.count).toBe(1);
    expect(alertsA.body.alerts[0]).toMatchObject({ severity: 'critical', status: 'pending', userId: a.childId });
    expect(alertsB.body.count).toBe(0);

    const list = await request(app).get('/api/interactions?flagged=true').set(auth(a.token));
    expect(list.body.pagination.total).toBe(1);
    const since = new Date(Date.now() - 60 * 1000).toISOString();
    const byChild = await request(app).get(`/api/interactions?userId=${a.childId}&startDate=${since}`).set(auth(a.token));
    expect(byChild.body.pagination.total).toBe(2);
    expect((await request(app).get(`/api/interactions?userId=${b.childId}`).set(auth(a.token))).status).toBe(404);

    a.alertId = alertsA.body.alerts[0]._id;
  });

  it('reviews alerts only within the family and updates /status', async () => {
    const review = (token) =>
      request(app).post(`/api/alerts/${a.alertId}/review`).set(auth(token)).send({ action: 'resolved', notes: 'talked it through' });

    expect((await review(b.token)).status).toBe(404);
    const ok = await review(a.token);
    expect(ok.status).toBe(200);
    expect(ok.body.alert).toMatchObject({ status: 'resolved', reviewNotes: 'talked it through' });
    expect(ok.body.alert.reviewedBy).toBeTruthy();

    const status = await request(app).get('/api/status').set(auth(a.token));
    expect(status.body).toMatchObject({
      overallStatus: 'safe',
      statistics: { totalInteractions: 2, flaggedInteractions: 1, activeAlerts: 0, resolvedAlerts: 1 }
    });
  });

  it('persists partial config updates with dotted $set and upsert', async () => {
    const post = (token, body) => request(app).post('/api/config').set(auth(token)).send(body);

    expect((await post(a.token, { alertThresholds: { excessive: { threshold: 42 } } })).status).toBe(200);
    expect((await post(a.token, { alertThresholds: { excessive: { severity: 'high' } }, contentFilters: { adult: false } })).status).toBe(200);

    const cfg = (await request(app).get('/api/config').set(auth(a.token))).body;
    expect(cfg.alertThresholds.excessive).toEqual({ enabled: true, threshold: 42, severity: 'high' });
    expect(cfg.contentFilters.adult).toBe(false);
    expect(cfg.contentFilters.profanity).toBe(true);

    expect((await request(app).get('/api/config').set(auth(b.token))).body.alertThresholds.excessive.threshold).toBe(100);

    // monitoring off => ingestion is skipped
    await post(a.token, { monitoringEnabled: false });
    const skipped = await request(app).post('/api/interactions').set(auth(a.childToken)).send({ message: PREDATOR });
    expect(skipped.status).toBe(202);
  });

  it('locks an account after repeated failures using the real counters', async () => {
    const bad = () => request(app).post('/api/auth/login').send({ identifier: 'b@example.com', password: 'Wrong!Pass1' });
    for (let i = 0; i < 5; i++) expect((await bad()).status).toBe(401);
    expect((await bad()).status).toBe(429);
    const good = await request(app).post('/api/auth/login').send({ identifier: 'b@example.com', password: PW });
    expect(good.status).toBe(429);
  });
});
