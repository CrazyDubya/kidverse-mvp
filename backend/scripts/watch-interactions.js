#!/usr/bin/env node
/**
 * Follow a chat log and forward new lines to a KidVerse server, like `tail -f` plus delivery.
 *
 *   KIDVERSE_PASSWORD=... node scripts/watch-interactions.js \
 *     --api http://localhost:5000 --user kid_username --file ~/roblox-chat.jsonl
 *
 * Lines are plain text or JSON ({"message","contact","direction","timestamp"}), the same as
 * send-interaction.js. Roblox offers no feed of a player's chat, so something has to write the
 * file: an in-game script relaying chat, a proxy, or a log exporter you already have.
 *
 * Delivery is at-least-once and survives restarts: the byte offset of the last delivered line
 * is saved next to the log, partial lines wait for their newline, a truncated or replaced file
 * is re-read from the start, and network errors, 5xx and 429 are retried with backoff.
 */
const fs = require('fs');

const USAGE = `Usage: watch-interactions.js --user <username|email> --file <path> [options]

Options:
  --api <url>          Server base URL (default: http://localhost:5000, or KIDVERSE_API)
  --user <id>          Child username, or parent email (or KIDVERSE_USER)
  --file <path>        Log file to follow (must be appended to, one message per line)
  --state <path>       Where to remember progress (default: <file>.kidverse-offset)
  --from-start         On the first run, send what is already in the file (default: only new lines)
  --poll-ms <n>        How often to check the file (default: 1000)
  --contact <name>     Default contact for every message
  --direction <dir>    incoming (default) or outgoing
  --child-id <id>      When signed in as a parent: which child the messages belong to
  --password <pw>      Prefer the KIDVERSE_PASSWORD environment variable

Runs until interrupted.`;

const VALUE_FLAGS = ['api', 'user', 'file', 'state', 'poll-ms', 'contact', 'direction', 'child-id', 'password'];
const BOOL_FLAGS = ['from-start'];
const MAX_CHUNK = 1024 * 1024;
const MAX_LINE = 64 * 1024;
const MAX_BACKOFF_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 30 * 1000;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--help' || flag === '-h') return { help: true };
    const name = flag.startsWith('--') ? flag.slice(2) : null;
    if (name && BOOL_FLAGS.includes(name)) {
      args[name] = true;
      continue;
    }
    if (!name || !VALUE_FLAGS.includes(name)) throw new Error(`Unknown argument: ${flag}`);
    if (i + 1 >= argv.length) throw new Error(`Missing value for ${flag}`);
    args[name] = argv[++i];
  }
  return args;
}

const parseLine = (line) => {
  if (!line.startsWith('{')) return { message: line };
  const parsed = JSON.parse(line);
  if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
  return parsed;
};

// A missing progress file is a first run. One that exists but can't be trusted is an error:
// treating it as a first run would skip whatever hadn't been delivered yet.
const loadState = (path) => {
  let text;
  try {
    text = fs.readFileSync(path, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new Error(`Cannot read the progress file ${path}: ${e.message}`);
  }
  let s;
  try {
    s = JSON.parse(text);
  } catch {
    s = null;
  }
  // Every field is checked: a wrong `skipping` would swallow a line, a wrong `ino`/`head` would
  // resend the whole log
  const valid =
    s &&
    Number.isInteger(s.offset) && s.offset >= 0 &&
    Number.isInteger(s.ino) && s.ino >= 0 &&
    typeof s.head === 'string' && /^[0-9a-f]*$/.test(s.head) && s.head.length === 2 * Math.min(s.offset, HEAD_BYTES) &&
    (s.skipping === undefined || typeof s.skipping === 'boolean');
  if (!valid) {
    throw new Error(`The progress file ${path} is corrupt. Fix or delete it (deleting skips what is already in the log).`);
  }
  return s;
};

// The bytes already consumed (first 64 at most). An append-only log never changes them, so a
// mismatch means the file was replaced, even if it kept its inode and grew past our offset.
const HEAD_BYTES = 64;
const readHead = (fd, offset) => {
  const length = Math.min(offset, HEAD_BYTES);
  if (length === 0) return '';
  const buf = Buffer.alloc(length);
  const n = fs.readSync(fd, buf, 0, length, 0);
  return buf.toString('hex', 0, n);
};

// Offset just past the last newline, so a line still being written at startup is delivered whole
// once finished instead of as a fragment. With no newline in view, a small file is one line in
// progress (start at 0); a huge one is junk: start at the end and drop it through its newline.
const startPosition = (fd, size) => {
  const length = Math.min(size, MAX_LINE);
  if (length === 0) return { offset: 0 };
  const buf = Buffer.alloc(length);
  fs.readSync(fd, buf, 0, length, size - length);
  const nl = buf.lastIndexOf(0x0a);
  if (nl !== -1) return { offset: size - length + nl + 1 };
  return size <= MAX_LINE ? { offset: 0 } : { offset: size, skipping: true };
};

const saveState = (path, state) => {
  const tmp = `${path}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, path); // never leave a half-written state file
};

/**
 * Builds a watcher. `tick()` delivers whatever is new and resolves with
 * { sent, skipped, retry }: retry is true when delivery should be attempted again after a delay.
 */
function createWatcher(opts, { fetchImpl = fetch, log = console.log, err = console.error } = {}) {
  const { api, identifier, password, file, statePath, fromStart, defaults = {}, childId, signal, timeoutMs = REQUEST_TIMEOUT_MS } = opts;
  let token = null;
  let state = loadState(statePath); // { offset, ino, head }
  let seenMissing = false;

  // The file being read stays open. After a rotation the old file is still readable through this
  // descriptor, so lines that couldn't be delivered yet (server outage) aren't lost with it.
  let handle = null; // { fd, ino }
  const closeHandle = () => {
    if (!handle) return;
    try {
      fs.closeSync(handle.fd);
    } catch {
      // already gone
    }
    handle = null;
  };
  // Only a missing *log* is benign; any other error (including a failing checkpoint) must surface
  const openHandle = () => {
    try {
      const fd = fs.openSync(file, 'r');
      handle = { fd, ino: fs.fstatSync(fd).ino };
      return true;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      seenMissing = true;
      return false;
    }
  };

  const persist = () => {
    state.head = readHead(handle.fd, state.offset);
    saveState(statePath, state);
  };

  const post = (path, body) =>
    fetchImpl(`${api}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      // A stalled server must not hang the watcher or block shutdown
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
    });

  // Returns true when signed in; 'fatal' for bad credentials (retrying only locks the account)
  const login = async () => {
    let res;
    try {
      res = await post('/api/auth/login', { identifier, password });
    } catch (e) {
      err(`Cannot reach ${api}: ${e.message}`);
      return false;
    }
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      token = body.token;
      return true;
    }
    err(`Login failed (${res.status}): ${body.message || 'unknown error'}`);
    return res.status === 401 || res.status === 403 ? 'fatal' : false;
  };

  // 'sent' | 'skipped' (will never succeed) | 'retry' | 'fatal'
  const deliver = async (m) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!token) {
        const ok = await login();
        if (ok === 'fatal') return 'fatal';
        if (!ok) return 'retry';
      }
      let res;
      try {
        res = await post('/api/interactions', {
          message: m.message,
          contact: m.contact || defaults.contact,
          direction: m.direction || defaults.direction,
          timestamp: m.timestamp,
          userId: childId
        });
      } catch (e) {
        err(`Cannot reach ${api}: ${e.message}`);
        return 'retry';
      }
      if (res.ok) return 'sent';
      const body = await res.json().catch(() => ({}));
      if (res.status === 401 && attempt === 0) {
        token = null; // expired (1h) or revoked: sign in again once
        continue;
      }
      if (res.status === 401) return 'fatal';
      if (res.status === 429 || res.status >= 500) {
        err(`Server said ${res.status}; will retry`);
        return 'retry';
      }
      err(`Skipping a message the server rejected (${res.status}): ${body.message || 'unknown error'}`);
      return 'skipped';
    }
    return 'retry';
  };

  // Delivers one chunk of whatever is available in the open file
  const consume = async (result) => {
    const size = fs.fstatSync(handle.fd).size;
    if (size < state.offset || readHead(handle.fd, state.offset) !== (state.head || '')) {
      // Truncated or rewritten in place: the old bytes are gone, so anything not yet delivered
      // from them is lost (rename-style rotation avoids this; see the README)
      err('The log was truncated or rewritten in place; messages not yet delivered from it may be lost.');
      state = { offset: 0, ino: handle.ino };
    }
    if (size === state.offset) return;

    const length = Math.min(size - state.offset, MAX_CHUNK);
    const buf = Buffer.alloc(length);
    fs.readSync(handle.fd, buf, 0, length, state.offset);

    let pos = 0;
    if (state.skipping) {
      // Inside an oversized line: drop everything up to and including its newline
      const nl = buf.indexOf(0x0a);
      const consumed = nl === -1 ? buf.length : nl + 1;
      state.offset += consumed;
      if (nl !== -1) state.skipping = false;
      persist();
      pos = consumed;
    }
    while (pos < buf.length) {
      const nl = buf.indexOf(0x0a, pos);
      if (nl === -1) {
        if (buf.length - pos >= MAX_LINE) {
          // Already too long to be a message and still no end: drop it, and the rest of it too
          err('Skipping an oversized line');
          state.offset += buf.length - pos;
          state.skipping = true;
          result.skipped++;
          persist();
        }
        break; // otherwise a line still being written: wait for its newline
      }
      const next = nl + 1;
      const raw = buf.toString('utf8', pos, nl).trim();
      let outcome;
      if (!raw) {
        outcome = 'blank';
      } else if (nl - pos > MAX_LINE) {
        err('Skipping an oversized line');
        outcome = 'skipped';
      } else {
        let m;
        try {
          m = parseLine(raw);
        } catch (e) {
          err(`Skipping an unreadable line: ${e.message}`);
        }
        outcome = m ? await deliver(m) : 'skipped';
      }

      if (outcome === 'retry' || outcome === 'fatal') {
        result.retry = true;
        result.fatal = outcome === 'fatal';
        return; // offset not advanced: this line is sent again next time
      }
      if (outcome === 'sent') result.sent++;
      if (outcome === 'skipped') result.skipped++;
      state.offset += next - pos;
      persist();
      pos = next;
    }
  };

  const tick = async () => {
    const result = { sent: 0, skipped: 0, retry: false, fatal: false };
    let stat = null;
    try {
      stat = fs.statSync(file);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      seenMissing = true;
    }

    if (handle && (!stat || stat.ino !== handle.ino)) {
      // Rotated or deleted: finish the old file first (like tail -F), then move on. An
      // unterminated tail can never complete, so it is dropped with the file.
      for (;;) {
        const before = state.offset;
        await consume(result);
        if (result.retry) return result;
        if (state.offset === before) break;
      }
      closeHandle();
    }
    if (!handle && (!stat || !openHandle())) return result;

    if (!state) {
      // First run: by default ignore history so old messages aren't replayed as new, unless the
      // file only appeared after we started watching, in which case all of it is new
      const size = fs.fstatSync(handle.fd).size;
      state = { ...(fromStart || seenMissing ? { offset: 0 } : startPosition(handle.fd, size)), ino: handle.ino };
      persist();
    } else if (state.ino !== handle.ino) {
      state = { offset: 0, ino: handle.ino }; // a different file than the one we checkpointed
    }

    await consume(result);
    return result;
  };

  return { tick, close: closeHandle, log };
}

// Resolves early when the signal aborts, so shutdown isn't held up by a long backoff
const defaultSleep = (ms, signal) =>
  new Promise((resolve) => {
    if (signal && signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    if (signal) signal.addEventListener('abort', done);
  });

async function run(argv, { env = process.env, fetchImpl = fetch, log = console.log, err = console.error, sleep = defaultSleep, signal } = {}) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    err(`${e.message}\n\n${USAGE}`);
    return 2;
  }
  if (args.help) {
    log(USAGE);
    return 0;
  }
  const api = (args.api || env.KIDVERSE_API || 'http://localhost:5000').trim().replace(/\/+$/, '');
  const identifier = args.user || env.KIDVERSE_USER;
  const password = env.KIDVERSE_PASSWORD || args.password;
  if (!identifier || !password || !args.file) {
    err(`Need --user, a password (KIDVERSE_PASSWORD) and --file.\n\n${USAGE}`);
    return 2;
  }
  if (args.direction && !['incoming', 'outgoing'].includes(args.direction)) {
    err('--direction must be incoming or outgoing');
    return 2;
  }
  const pollMs = args['poll-ms'] === undefined ? 1000 : Number(args['poll-ms']);
  if (!Number.isFinite(pollMs) || pollMs < 50) {
    err('--poll-ms must be a number of at least 50');
    return 2;
  }
  let apiUrl;
  try {
    apiUrl = new URL(api);
  } catch {
    err(`Invalid --api URL: ${api}`);
    return 2;
  }
  if (!['http:', 'https:'].includes(apiUrl.protocol)) {
    err(`--api must be an http(s) URL, got ${apiUrl.protocol}`);
    return 2;
  }
  if (apiUrl.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(apiUrl.hostname)) {
    err('Warning: sending credentials over plain HTTP to a non-local host. Use https.');
  }

  let watcher;
  try {
    watcher = createWatcher(
      {
        api,
        identifier,
        password,
        file: args.file,
        statePath: args.state || `${args.file}.kidverse-offset`,
        fromStart: Boolean(args['from-start']),
        defaults: { contact: args.contact, direction: args.direction },
        childId: args['child-id'],
        signal
      },
      { fetchImpl, log, err }
    );
  } catch (e) {
    err(`Cannot start: ${e.message}`);
    return 1;
  }

  log(`Watching ${args.file} -> ${api}`);
  let backoff = pollMs;
  try {
    while (!(signal && signal.aborted)) {
      const r = await watcher.tick();
      if (r.sent) log(`sent ${r.sent} message${r.sent === 1 ? '' : 's'}`);
      if (r.fatal) {
        err('Stopping: the server refused these credentials.');
        return 1;
      }
      backoff = r.retry ? Math.min(backoff * 2, MAX_BACKOFF_MS) : pollMs;
      await sleep(backoff, signal);
    }
  } catch (e) {
    // e.g. the progress file can't be written: carrying on would risk resending or losing lines
    err(`Stopping: ${e.message}`);
    return 1;
  } finally {
    watcher.close();
  }
  return 0;
}

if (require.main === module) {
  const controller = new AbortController();
  process.on('SIGINT', () => controller.abort());
  process.on('SIGTERM', () => controller.abort());
  run(process.argv.slice(2), { signal: controller.signal }).then((code) => process.exit(code));
}

module.exports = { run, createWatcher, parseArgs };
