process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.AUTH_RATE_LIMIT_MAX = '1000';

const { makeCollection } = require('./helpers/fakeCollection');

const mockUsers = makeCollection({ defaults: () => ({ isActive: true }) });
const mockInteractions = makeCollection();
const mockAlerts = makeCollection({ defaults: () => ({ status: 'pending' }) });
const mockConfigs = makeCollection();
const mockFamilies = makeCollection();
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
const bcrypt = require('bcryptjs');
const { server } = require('../server');
const { run, parseArgs, parseLines } = require('../scripts/send-interaction');

const PW = 'Kid5!Password';
const PREDATOR = "don't tell your parents, this is our secret. meet me at the park";
const familyId = new mongoose.Types.ObjectId();
let api;
let child;

const exec = async (argv, { env = {}, readFile } = {}) => {
  const out = [];
  const errs = [];
  const code = await run(argv, {
    env: { KIDVERSE_PASSWORD: PW, ...env },
    log: (m) => out.push(m),
    err: (m) => errs.push(m),
    ...(readFile ? { readFile } : {})
  });
  return { code, out: out.join('\n'), errs: errs.join('\n') };
};

beforeAll(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  api = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(async () => {
  [mockUsers, mockInteractions, mockAlerts, mockConfigs].forEach((c) => c.reset());
  const passwordHash = bcrypt.hashSync(PW, 4);
  child = await mockUsers.create({ role: 'child', familyId, username: 'kidc', firstName: 'Kid', lastName: 'C', passwordHash });
  await mockUsers.create({ role: 'parent', familyId, email: 'p@x.co', firstName: 'Par', lastName: 'P', passwordHash });
});

describe('argument parsing', () => {
  it('parses flags and rejects unknown or incomplete ones', () => {
    expect(parseArgs(['--user', 'k', '--message', 'hi'])).toEqual({ user: 'k', message: 'hi' });
    expect(() => parseArgs(['--nope', 'x'])).toThrow(/Unknown argument/);
    expect(() => parseArgs(['--user'])).toThrow(/Missing value/);
    expect(parseArgs(['--help'])).toEqual({ help: true });
  });

  it('reads plain and JSON lines, skipping blanks', () => {
    expect(parseLines('hello\n\n{"message":"x","contact":"Bob"}\r\nbye\n')).toEqual([
      { message: 'hello' }, { message: 'x', contact: 'Bob' }, { message: 'bye' }
    ]);
    expect(() => parseLines('{oops')).toThrow(/Line 1/);
  });
});

describe('against the real server', () => {
  it('reports a risky message as a child and raises an alert', async () => {
    const r = await exec(['--api', api, '--user', 'kidc', '--message', PREDATOR, '--contact', 'FriendlyHelper']);
    expect(r).toMatchObject({ code: 0, out: expect.stringContaining('[1/1] sent') });
    expect(mockInteractions.rows).toHaveLength(1);
    expect(mockInteractions.rows[0]).toMatchObject({ contact: 'FriendlyHelper', userId: String(child._id), flagged: true });
    expect(mockAlerts.rows).toHaveLength(1);
  });

  it('sends a file of mixed plain/JSON lines; benign ones raise no alert', async () => {
    const lines = ['nice build!', JSON.stringify({ message: PREDATOR, contact: 'X', direction: 'incoming' }), 'gg'].join('\n');
    const r = await exec(['--api', api, '--user', 'kidc', '--file', 'chat.txt'], { readFile: () => lines });
    expect(r.code).toBe(0);
    expect(r.out).toContain('[3/3] sent');
    expect(mockInteractions.rows).toHaveLength(3);
    expect(mockAlerts.rows).toHaveLength(1);
  });

  it('lets a parent report for a child in their family with --child-id', async () => {
    const r = await exec(['--api', api, '--user', 'p@x.co', '--message', PREDATOR, '--child-id', String(child._id)]);
    expect(r.code).toBe(0);
    expect(mockAlerts.rows[0].userId).toBe(String(child._id));
  });

  it('is refused for a child in another family', async () => {
    const other = await mockUsers.create({ role: 'child', familyId: new mongoose.Types.ObjectId(), username: 'otherkid', firstName: 'O', lastName: 'K' });
    const r = await exec(['--api', api, '--user', 'p@x.co', '--message', 'hi', '--child-id', String(other._id)]);
    expect(r.code).toBe(1);
    expect(r.errs).toContain('rejected (404)');
    expect(mockInteractions.rows).toHaveLength(0);
  });

  it('fails cleanly on a wrong password without leaking it', async () => {
    const r = await exec(['--api', api, '--user', 'kidc', '--message', 'hi'], { env: { KIDVERSE_PASSWORD: 'Wrong!Pass1' } });
    expect(r.code).toBe(1);
    expect(r.errs).toContain('Login failed (401)');
    expect(r.out + r.errs).not.toContain('Wrong!Pass1');
    expect(mockInteractions.rows).toHaveLength(0);
  });

  it('reports a skipped message when monitoring is off', async () => {
    await mockConfigs.create({ familyId, monitoringEnabled: false });
    const r = await exec(['--api', api, '--user', 'kidc', '--message', PREDATOR]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('skipped (monitoring is off)');
    expect(mockInteractions.rows).toHaveLength(0);
  });

  it('exits non-zero but keeps going after a rejected message', async () => {
    const lines = ['ok one', 'x'.repeat(2500), 'ok two'].join('\n');
    const r = await exec(['--api', api, '--user', 'kidc', '--file', 'f'], { readFile: () => lines });
    expect(r.code).toBe(1);
    expect(r.errs).toContain('[2/3] rejected (400)');
    expect(mockInteractions.rows.map((i) => i.message)).toEqual(['ok one', 'ok two']);
  });
});

describe('usage and connectivity', () => {
  it('exits 2 with usage when required input is missing', async () => {
    expect((await exec(['--api', api, '--user', 'kidc'])).code).toBe(2);
    expect((await exec(['--message', 'hi'], { env: { KIDVERSE_PASSWORD: '' } })).code).toBe(2);
    expect((await exec(['--user', 'k', '--message', 'hi', '--direction', 'sideways'])).code).toBe(2);
    expect((await exec(['--user', 'k', '--message', 'hi', '--api', 'not a url'])).code).toBe(2);
  });

  it('reports an unreachable server', async () => {
    const r = await exec(['--api', 'http://127.0.0.1:1', '--user', 'kidc', '--message', 'hi']);
    expect(r.code).toBe(1);
    expect(r.errs).toContain('Cannot reach');
  });

  it('warns before sending credentials over plain http to a remote host', async () => {
    const r = await exec(['--api', 'http://example.invalid', '--user', 'kidc', '--message', 'hi']);
    expect(r.errs).toContain('plain HTTP');
    expect(r.code).toBe(1);
  });
});
