process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';

const { makeCollection } = require('./helpers/fakeCollection');

const mockUsers = makeCollection({ defaults: () => ({ isActive: true }) });
const mockInteractions = makeCollection();
const mockAlerts = makeCollection({ defaults: () => ({ status: 'pending' }) });
const mockConfigs = makeCollection();
jest.mock('../models/User', () =>
  Object.assign(mockUsers, { USERNAME_PATTERN: jest.requireActual('../models/User').USERNAME_PATTERN })
);
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
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { app } = require('../server');

const oid = () => new mongoose.Types.ObjectId();
const F1 = oid();
const F2 = oid();

let parentA, childA, parentB, childB;
const tokenFor = (u) => jwt.sign({ userId: String(u._id), role: u.role, familyId: String(u.familyId) }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '5m' });
const as = (u) => ({ Authorization: `Bearer ${tokenFor(u)}` });

const PREDATOR = "don't tell your parents, this is our secret. meet me at the park";
const emit = jest.fn();

beforeEach(async () => {
  [mockUsers, mockInteractions, mockAlerts, mockConfigs].forEach((c) => c.reset());
  parentA = await mockUsers.create({ role: 'parent', familyId: F1, email: 'a@x.co', firstName: 'Pa', lastName: 'A' });
  childA = await mockUsers.create({ role: 'child', familyId: F1, username: 'kida', firstName: 'Ka', lastName: 'A' });
  parentB = await mockUsers.create({ role: 'parent', familyId: F2, email: 'b@x.co', firstName: 'Pb', lastName: 'B' });
  childB = await mockUsers.create({ role: 'child', familyId: F2, username: 'kidb', firstName: 'Kb', lastName: 'B' });
  emit.mockClear();
  app.set('io', { to: jest.fn(() => ({ emit })) });
});

const ingest = (who, body) => request(app).post('/api/interactions').set(as(who)).send(body);

describe('authentication and roles', () => {
  it('requires a token', async () => {
    expect((await request(app).get('/api/status')).status).toBe(401);
  });

  it('keeps children out of the monitoring dashboard', async () => {
    for (const path of ['/api/status', '/api/interactions', '/api/alerts', '/api/config']) {
      expect((await request(app).get(path).set(as(childA))).status).toBe(403);
    }
  });

  it('rejects a valid token for a deactivated account', async () => {
    mockUsers.rows.find((r) => r.email === 'a@x.co').isActive = false;
    expect((await request(app).get('/api/status').set(as(parentA))).status).toBe(401);
  });
});

describe('POST /api/interactions (ingestion)', () => {
  it('flags a grooming message, raises a critical alert and notifies the family room only', async () => {
    const res = await ingest(parentA, { userId: String(childA._id), message: PREDATOR, contact: 'xX_friend_Xx' });
    expect(res.status).toBe(201);
    expect(res.body.flagged).toBe(true);

    expect(mockAlerts.rows).toHaveLength(1);
    expect(mockAlerts.rows[0]).toMatchObject({ severity: 'critical', status: 'pending', familyId: String(F1), userId: String(childA._id) });

    const io = app.get('io');
    expect(io.to).toHaveBeenCalledWith(`family_${F1}`);
    const payload = emit.mock.calls[0][1];
    expect(emit.mock.calls[0][0]).toBe('alert:new');
    expect(JSON.stringify(payload)).not.toContain('secret'); // never leak message text over the socket
  });

  it('stores benign messages without an alert', async () => {
    const res = await ingest(parentA, { userId: String(childA._id), message: 'gg, want to play obby again?' });
    expect(res.status).toBe(201);
    expect(res.body.flagged).toBe(false);
    expect(mockInteractions.rows).toHaveLength(1);
    expect(mockAlerts.rows).toHaveLength(0);
  });

  it('lets a child report for themself without revealing the alert outcome', async () => {
    const res = await ingest(childA, { message: PREDATOR });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true });
    expect(mockAlerts.rows).toHaveLength(1);
  });

  it('forbids a child from reporting as someone else', async () => {
    expect((await ingest(childA, { userId: String(childB._id), message: 'hi' })).status).toBe(403);
  });

  it('cannot reach into another family', async () => {
    const res = await ingest(parentA, { userId: String(childB._id), message: PREDATOR });
    expect(res.status).toBe(404);
    expect(mockInteractions.rows).toHaveLength(0);
  });

  it('cannot attribute messages to a parent account', async () => {
    expect((await ingest(parentA, { userId: String(parentA._id), message: 'hi' })).status).toBe(404);
  });

  it('validates input', async () => {
    expect((await ingest(parentA, { userId: String(childA._id), message: '' })).status).toBe(400);
    expect((await ingest(parentA, { userId: String(childA._id), message: { $gt: '' } })).status).toBe(400);
    expect((await ingest(parentA, { userId: String(childA._id), message: 'x'.repeat(2001) })).status).toBe(400);
    expect((await ingest(parentA, { message: 'hi' })).status).toBe(400);
    expect((await ingest(parentA, { userId: String(childA._id), message: 'hi', timestamp: '2999-01-01' })).status).toBe(400);
    expect((await ingest(parentA, { userId: String(childA._id), message: 'hi', direction: 'sideways' })).status).toBe(400);
  });

  it('skips recording when monitoring is switched off', async () => {
    await request(app).post('/api/config').set(as(parentA)).send({ monitoringEnabled: false });
    const res = await ingest(parentA, { userId: String(childA._id), message: PREDATOR });
    expect(res.status).toBe(202);
    expect(mockInteractions.rows).toHaveLength(0);
    expect(mockAlerts.rows).toHaveLength(0);
  });
});

describe('GET /api/interactions', () => {
  beforeEach(async () => {
    await ingest(parentA, { userId: String(childA._id), message: PREDATOR, timestamp: '2026-01-02T00:00:00Z' });
    await ingest(parentA, { userId: String(childA._id), message: 'nice build!', timestamp: '2026-01-01T00:00:00Z' });
    await ingest(parentB, { userId: String(childB._id), message: 'other family message' });
  });

  it('returns only the caller\'s family, newest first', async () => {
    const res = await request(app).get('/api/interactions').set(as(parentA));
    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(2);
    expect(res.body.interactions.map((i) => i.message)).toEqual([PREDATOR, 'nice build!']);
    expect(JSON.stringify(res.body)).not.toContain('other family');
  });

  it('filters by flagged, date range, and pagination', async () => {
    const flagged = await request(app).get('/api/interactions?flagged=true').set(as(parentA));
    expect(flagged.body.pagination.total).toBe(1);

    const ranged = await request(app).get('/api/interactions?endDate=2026-01-01T12:00:00Z').set(as(parentA));
    expect(ranged.body.interactions.map((i) => i.message)).toEqual(['nice build!']);

    const paged = await request(app).get('/api/interactions?limit=1&page=2').set(as(parentA));
    expect(paged.body.interactions).toHaveLength(1);
    expect(paged.body.pagination).toMatchObject({ total: 2, totalPages: 2, hasNext: false, hasPrev: true });
  });

  it('only lets userId select members of your own family', async () => {
    expect((await request(app).get(`/api/interactions?userId=${childA._id}`).set(as(parentA))).body.pagination.total).toBe(2);
    expect((await request(app).get(`/api/interactions?userId=${childB._id}`).set(as(parentA))).status).toBe(404);
  });

  it('rejects malformed query input', async () => {
    for (const q of ['userId[]=1', 'limit=1000', 'page=0', 'startDate=nope', 'flagged[$ne]=1']) {
      expect((await request(app).get(`/api/interactions?${q}`).set(as(parentA))).status).toBe(400);
    }
    // a 12-char string is a "valid" ObjectId to mongoose; it must not be treated as one
    expect((await request(app).get('/api/interactions?userId=aaaaaaaaaaaa').set(as(parentA))).status).toBe(404);
  });
});

describe('alerts', () => {
  let alertA, alertB;
  beforeEach(async () => {
    await ingest(parentA, { userId: String(childA._id), message: PREDATOR });
    await ingest(parentB, { userId: String(childB._id), message: PREDATOR });
    alertA = mockAlerts.rows.find((r) => r.familyId === String(F1));
    alertB = mockAlerts.rows.find((r) => r.familyId === String(F2));
  });

  it('lists only the family\'s alerts and validates filters', async () => {
    const res = await request(app).get('/api/alerts').set(as(parentA));
    expect(res.body.alerts.map((a) => a._id)).toEqual([alertA._id]);
    expect((await request(app).get('/api/alerts?status=pending&severity=critical').set(as(parentA))).body.count).toBe(1);
    expect((await request(app).get('/api/alerts?status=resolved').set(as(parentA))).body.count).toBe(0);
    expect((await request(app).get('/api/alerts?status=bogus').set(as(parentA))).status).toBe(400);
    expect((await request(app).get('/api/alerts?severity[$ne]=x').set(as(parentA))).status).toBe(400);
  });

  const review = (who, id, body) => request(app).post(`/api/alerts/${id}/review`).set(as(who)).send(body);

  it('records who reviewed it, ignoring any client-supplied reviewer', async () => {
    const res = await review(parentA, alertA._id, { action: 'resolved', notes: 'spoke with them', reviewedBy: String(parentB._id) });
    expect(res.status).toBe(200);
    expect(res.body.alert).toMatchObject({ status: 'resolved', reviewNotes: 'spoke with them', reviewedBy: String(parentA._id) });
  });

  it('cannot review another family\'s alert, and it looks like a missing one', async () => {
    const cross = await review(parentA, alertB._id, { action: 'dismissed' });
    const missing = await review(parentA, String(oid()), { action: 'dismissed' });
    expect(cross.status).toBe(404);
    expect(cross.body).toEqual(missing.body);
    expect(mockAlerts.rows.find((r) => r._id === alertB._id).status).toBe('pending');
  });

  it('validates id and body', async () => {
    expect((await review(parentA, 'zzz', { action: 'resolved' })).status).toBe(400);
    expect((await review(parentA, 'aaaaaaaaaaaa', { action: 'resolved' })).status).toBe(400);
    expect((await review(parentA, alertA._id, { action: 'nuke' })).status).toBe(400);
    expect((await review(parentA, alertA._id, { action: 'resolved', notes: 5 })).status).toBe(400);
  });

  it('reflects open alerts in /status', async () => {
    const before = await request(app).get('/api/status').set(as(parentA));
    expect(before.body).toMatchObject({ overallStatus: 'critical', statistics: { activeAlerts: 1, totalInteractions: 1, flaggedInteractions: 1 } });

    await review(parentA, alertA._id, { action: 'resolved' });
    const after = await request(app).get('/api/status').set(as(parentA));
    expect(after.body).toMatchObject({ overallStatus: 'safe', statistics: { activeAlerts: 0, resolvedAlerts: 1 } });
    expect(after.body.recentActivity.last24Hours.interactions).toBe(1);
  });
});

describe('config', () => {
  const post = (who, body) => request(app).post('/api/config').set(as(who)).send(body);

  it('returns defaults, then persists partial updates without clobbering siblings', async () => {
    const defaults = await request(app).get('/api/config').set(as(parentA));
    expect(defaults.body.alertThresholds.excessive).toEqual({ enabled: true, threshold: 100, severity: 'low' });

    const res = await post(parentA, { alertThresholds: { excessive: { threshold: 50 } }, contentFilters: { adult: false } });
    expect(res.status).toBe(200);
    expect(res.body.config.alertThresholds.excessive).toEqual({ enabled: true, threshold: 50, severity: 'low' });
    expect(res.body.config.contentFilters).toEqual({ profanity: true, violence: true, adult: false, personalInfo: true });

    const again = await request(app).get('/api/config').set(as(parentA));
    expect(again.body.alertThresholds.excessive.threshold).toBe(50);
  });

  it('is isolated per family', async () => {
    await post(parentA, { monitoringEnabled: false });
    expect((await request(app).get('/api/config').set(as(parentB))).body.monitoringEnabled).toBe(true);
  });

  it('rejects unknown keys, bad values and prototype pollution', async () => {
    expect((await post(parentA, { evil: 1 })).status).toBe(400);
    expect((await post(parentA, { alertThresholds: { inappropriate: { severity: 'apocalyptic' } } })).status).toBe(400);
    expect((await post(parentA, { dataRetention: { alerts: 9999 } })).status).toBe(400);
    expect((await post(parentA, { monitoringEnabled: 'false' })).status).toBe(400);
    expect((await post(parentA, { notifications: { email: { address: 'nope' } } })).status).toBe(400);
    expect((await post(parentA, [])).status).toBe(400);
    expect((await post(parentA, {})).status).toBe(400);
    const polluted = await request(app).post('/api/config').set(as(parentA)).set('Content-Type', 'application/json')
      .send('{"contentFilters":{"__proto__":{"x":1}},"constructor":{"prototype":{"y":1}}}');
    expect(polluted.status).toBe(400);
    expect({}.x).toBeUndefined();
  });

  it('forbids children', async () => {
    expect((await post(childA, { monitoringEnabled: false })).status).toBe(403);
  });
});
