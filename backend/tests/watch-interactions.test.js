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

const fs = require('fs');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { server } = require('../server');
const { run, createWatcher, parseArgs } = require('../scripts/watch-interactions');

const PW = 'Kid5!Password';
const PREDATOR = "don't tell your parents, this is our secret. meet me at the park";
const familyId = new mongoose.Types.ObjectId();
let api;
let dir;
let file;
let statePath;
let errs;

const make = (overrides = {}, deps = {}) =>
  createWatcher(
    { api, identifier: 'kidc', password: PW, file, statePath, fromStart: false, defaults: {}, ...overrides },
    { err: (m) => errs.push(m), log: () => {}, ...deps }
  );
const append = (text) => fs.appendFileSync(file, text);

beforeAll(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  api = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(async () => {
  [mockUsers, mockInteractions, mockAlerts, mockConfigs].forEach((c) => c.reset());
  const passwordHash = bcrypt.hashSync(PW, 4);
  await mockUsers.create({ role: 'child', familyId, username: 'kidc', firstName: 'Kid', lastName: 'C', passwordHash });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kv-watch-'));
  file = path.join(dir, 'chat.jsonl');
  statePath = `${file}.kidverse-offset`;
  errs = [];
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('following a file', () => {
  it('sends only new lines by default and raises an alert for a risky one', async () => {
    append('old message\n');
    const w = make();
    expect(await w.tick()).toMatchObject({ sent: 0 }); // history is ignored on the first run

    append(`nice build\n${JSON.stringify({ message: PREDATOR, contact: 'Helper' })}\n`);
    expect(await w.tick()).toMatchObject({ sent: 2, retry: false });
    expect(mockInteractions.rows.map((r) => r.contact)).toEqual([undefined, 'Helper']);
    expect(mockAlerts.rows).toHaveLength(1);
    expect((await w.tick()).sent).toBe(0); // nothing is sent twice
  });

  it('--from-start sends what is already there', async () => {
    append('one\ntwo\n');
    expect((await make({ fromStart: true }).tick()).sent).toBe(2);
  });

  it('waits for the end of a half-written line', async () => {
    const w = make({ fromStart: true });
    append('first\nsecond hal');
    expect((await w.tick()).sent).toBe(1);
    append('f done\n');
    expect((await w.tick()).sent).toBe(1);
    expect(mockInteractions.rows.map((r) => r.message)).toEqual(['first', 'second half done']);
  });

  it('resumes after a restart without resending', async () => {
    append('a\nb\n');
    await make({ fromStart: true }).tick();
    append('c\n');
    expect((await make().tick()).sent).toBe(1); // a new watcher, same state file
    expect(mockInteractions.rows.map((r) => r.message)).toEqual(['a', 'b', 'c']);
  });

  it('starts over when the file is truncated or replaced', async () => {
    append('aaaaaaaaaa\nbbbbbbbbbb\n');
    const w = make({ fromStart: true });
    await w.tick();
    fs.writeFileSync(file, 'new\n'); // shorter than the saved offset
    expect((await w.tick()).sent).toBe(1);
    expect(mockInteractions.rows.at(-1).message).toBe('new');

    fs.rmSync(file);
    fs.writeFileSync(file, 'xxxxxxxxxxxxxxxxxxxxxxxx\n'); // new file, longer than the old offset
    expect((await w.tick()).sent).toBe(1);
    expect(mockInteractions.rows.at(-1).message).toBe('xxxxxxxxxxxxxxxxxxxxxxxx');
  });

  it('waits quietly for a file that does not exist yet', async () => {
    expect(await make().tick()).toMatchObject({ sent: 0, retry: false });
  });

  it('skips unreadable and rejected lines without blocking the rest', async () => {
    append(`{oops\n${'x'.repeat(2500)}\nfine\n`);
    const r = await make({ fromStart: true }).tick();
    expect(r).toMatchObject({ sent: 1, skipped: 2 });
    expect(errs.join('\n')).toMatch(/unreadable line/);
    expect(errs.join('\n')).toMatch(/rejected \(400\)/);
  });
});

describe('delivery failures', () => {
  const failing = (status) => {
    let up = false;
    const fetchImpl = (url, init) =>
      up || String(url).endsWith('/auth/login') ? fetch(url, init) : Promise.resolve({ ok: false, status, json: async () => ({}) });
    return { fetchImpl, recover: () => { up = true; } };
  };

  it.each([500, 503, 429])('retries the same line after a %i, then delivers it once', async (status) => {
    const f = failing(status);
    append('keep me\n');
    const w = make({ fromStart: true }, { fetchImpl: f.fetchImpl });
    expect(await w.tick()).toMatchObject({ sent: 0, retry: true });
    expect(mockInteractions.rows).toHaveLength(0);
    f.recover();
    expect(await w.tick()).toMatchObject({ sent: 1, retry: false });
    expect(mockInteractions.rows).toHaveLength(1);
  });

  it('retries when the server is unreachable', async () => {
    append('hello\n');
    const w = make({ fromStart: true }, { fetchImpl: () => Promise.reject(new Error('ECONNREFUSED')) });
    expect(await w.tick()).toMatchObject({ sent: 0, retry: true, fatal: false });
  });

  it('signs in again once when the token expires', async () => {
    append('one\ntwo\n');
    let first = true;
    const fetchImpl = (url, init) => {
      if (String(url).endsWith('/interactions') && first) {
        first = false;
        return Promise.resolve({ ok: false, status: 401, json: async () => ({}) });
      }
      return fetch(url, init);
    };
    expect((await make({ fromStart: true }, { fetchImpl }).tick()).sent).toBe(2);
  });

  it('stops on bad credentials instead of hammering the login', async () => {
    append('hello\n');
    const r = await make({ fromStart: true, password: 'wrong' }).tick();
    expect(r).toMatchObject({ sent: 0, retry: true, fatal: true });
    expect(JSON.stringify(errs)).not.toContain('wrong');
  });
});

describe('command line', () => {
  it('validates arguments', async () => {
    const out = [];
    const code = (argv, env = { KIDVERSE_PASSWORD: PW }) => run(argv, { env, err: (m) => out.push(m), log: () => {} });
    expect(await code([])).toBe(2);
    expect(await code(['--user', 'k', '--file', 'x', '--poll-ms', '5'])).toBe(2);
    expect(await code(['--user', 'k', '--file', 'x', '--direction', 'sideways'])).toBe(2);
    expect(await code(['--user', 'k', '--file', 'x', '--api', 'ftp://h'])).toBe(2);
    expect(await code(['--user', 'k', '--file', 'x'], {})).toBe(2);
    expect(await code(['--bogus'])).toBe(2);
    expect(parseArgs(['--from-start', '--user', 'k'])).toEqual({ 'from-start': true, user: 'k' });
  });

  it('runs until aborted and delivers what appears while running', async () => {
    const controller = new AbortController();
    const logs = [];
    const done = run(['--api', api, '--user', 'kidc', '--file', file, '--poll-ms', '50'], {
      env: { KIDVERSE_PASSWORD: PW },
      log: (m) => logs.push(m),
      err: (m) => errs.push(m),
      signal: controller.signal
    });
    await new Promise((r) => setTimeout(r, 150));
    append(`${PREDATOR}\n`);
    for (let i = 0; i < 40 && mockAlerts.rows.length === 0; i++) await new Promise((r) => setTimeout(r, 50));
    controller.abort();
    expect(await done).toBe(0);
    expect(mockAlerts.rows).toHaveLength(1);
  });

  it('exits with 1 on bad credentials', async () => {
    append('x\n');
    const code = await run(['--api', api, '--user', 'kidc', '--file', file, '--from-start', '--poll-ms', '50'], {
      env: { KIDVERSE_PASSWORD: 'nope' }, log: () => {}, err: () => {}, sleep: async () => {}
    });
    expect(code).toBe(1);
  });
});

describe('edge cases found in review', () => {
  it('delivers a line that was half-written when the watcher started, whole', async () => {
    append('already seen\nsecret: meet me at');
    const w = make();
    expect((await w.tick()).sent).toBe(0);
    append(' the park\n');
    expect((await w.tick()).sent).toBe(1);
    expect(mockInteractions.rows.map((r) => r.message)).toEqual(['secret: meet me at the park']);
  });

  it('drops an oversized line through its newline, never sending its tail as a message', async () => {
    const w = make({ fromStart: true });
    append('before\n');
    append('y'.repeat(70 * 1024)); // no newline yet: already too long
    expect((await w.tick()).sent).toBe(1);
    append('tail of the long line\nafter\n');
    const r = await w.tick();
    expect(r.sent).toBe(1);
    expect(mockInteractions.rows.map((x) => x.message)).toEqual(['before', 'after']);
  });

  it('drops a multi-megabyte line the same way', async () => {
    append(`${'z'.repeat(2.5 * 1024 * 1024)}\nok\n`);
    const w = make({ fromStart: true });
    let sent = 0;
    for (let i = 0; i < 5; i++) sent += (await w.tick()).sent;
    expect(sent).toBe(1);
    expect(mockInteractions.rows.map((x) => x.message)).toEqual(['ok']);
  });

  it('shuts down promptly even in the middle of a long backoff', async () => {
    const controller = new AbortController();
    append('x\n');
    const started = Date.now();
    const done = run(['--api', 'http://127.0.0.1:1', '--user', 'kidc', '--file', file, '--from-start', '--poll-ms', '60000'], {
      env: { KIDVERSE_PASSWORD: PW }, log: () => {}, err: () => {}, signal: controller.signal
    });
    setTimeout(() => controller.abort(), 200);
    expect(await done).toBe(0);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe('edge cases found in the second review', () => {
  it('drops an oversized unterminated line found at startup, through its newline', async () => {
    append('y'.repeat(70 * 1024));
    const w = make();
    expect((await w.tick()).sent).toBe(0);
    append('rest of the huge line\nnext\n');
    expect((await w.tick()).sent).toBe(1);
    expect(mockInteractions.rows.map((x) => x.message)).toEqual(['next']);
  });

  it('gives up on a stalled server and retries instead of hanging', async () => {
    append('hello\n');
    const stalled = (url, init) =>
      new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('timed out'))));
    const w = make({ fromStart: true, timeoutMs: 100 }, { fetchImpl: stalled });
    expect(await w.tick()).toMatchObject({ sent: 0, retry: true });
  });

  it('stops an in-flight request when shutting down', async () => {
    append('hello\n');
    const controller = new AbortController();
    const stalled = (url, init) =>
      new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    const w = make({ fromStart: true, signal: controller.signal }, { fetchImpl: stalled });
    const pending = w.tick();
    setTimeout(() => controller.abort(), 50);
    expect(await pending).toMatchObject({ retry: true });
  });

  it('treats a file that vanishes between stat and open as missing', async () => {
    append('hello\n');
    const w = make({ fromStart: true });
    const realOpen = fs.openSync;
    const spy = jest.spyOn(fs, 'openSync').mockImplementation((p, ...rest) => {
      if (p === file) throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
      return realOpen(p, ...rest);
    });
    try {
      expect(await w.tick()).toMatchObject({ sent: 0, retry: false });
    } finally {
      spy.mockRestore();
    }
    expect((await w.tick()).sent).toBe(1); // and it carries on afterwards
  });
});
