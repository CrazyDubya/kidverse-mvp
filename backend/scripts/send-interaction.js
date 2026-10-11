#!/usr/bin/env node
/**
 * Report observed messages to a KidVerse server so they are analysed and, when risky,
 * raise alerts on the family dashboard.
 *
 *   KIDVERSE_PASSWORD=... node scripts/send-interaction.js \
 *     --api http://localhost:5000 --user kid_username \
 *     --message "hey what school do you go to?" --contact SomePlayer
 *
 *   # many messages: one per line, plain text or JSON ({"message","contact","direction","timestamp"})
 *   KIDVERSE_PASSWORD=... node scripts/send-interaction.js --user kid_username --file chat.jsonl
 *
 * Signs in as the child (or a parent, with --child-id) and posts to POST /api/interactions.
 */
const fs = require('fs');

const USAGE = `Usage: send-interaction.js --user <username|email> (--message <text> | --file <path>) [options]

Options:
  --api <url>          Server base URL (default: http://localhost:5000, or KIDVERSE_API)
  --user <id>          Child username, or parent email (or KIDVERSE_USER)
  --message <text>     A single message to report
  --file <path>        File with one message per line ("-" for stdin); plain text or JSON lines
  --contact <name>     Who the message came from / went to (default for every message)
  --direction <dir>    incoming (default) or outgoing
  --child-id <id>      When signed in as a parent: which child the messages belong to
  --password <pw>      Prefer the KIDVERSE_PASSWORD environment variable; flags show up in shell history

Exit code is 0 only if every message was accepted.`;

const VALUE_FLAGS = ['api', 'user', 'message', 'file', 'contact', 'direction', 'child-id', 'password'];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--help' || flag === '-h') return { help: true };
    const name = flag.startsWith('--') ? flag.slice(2) : null;
    if (!name || !VALUE_FLAGS.includes(name)) throw new Error(`Unknown argument: ${flag}`);
    if (i + 1 >= argv.length) throw new Error(`Missing value for ${flag}`);
    args[name] = argv[++i];
  }
  return args;
}

function parseLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => {
      if (!line.startsWith('{')) return { message: line };
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`Line ${i + 1} looks like JSON but is not valid`);
      }
    });
}

const isLocal = (url) => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);

async function run(argv, { env = process.env, fetchImpl = fetch, readFile = fs.readFileSync, log = console.log, err = console.error } = {}) {
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

  const api = (args.api || env.KIDVERSE_API || 'http://localhost:5000').replace(/\/+$/, '');
  const identifier = args.user || env.KIDVERSE_USER;
  const password = env.KIDVERSE_PASSWORD || args.password;
  if (!identifier || !password || (!args.message && !args.file)) {
    err(`Need --user, a password (KIDVERSE_PASSWORD), and --message or --file.\n\n${USAGE}`);
    return 2;
  }
  if (args.direction && !['incoming', 'outgoing'].includes(args.direction)) {
    err('--direction must be incoming or outgoing');
    return 2;
  }

  let messages;
  try {
    messages = args.message ? [{ message: args.message }] : parseLines(String(readFile(args.file === '-' ? 0 : args.file, 'utf8')));
  } catch (e) {
    err(`Could not read messages: ${e.message}`);
    return 2;
  }
  if (messages.length === 0) {
    err('No messages to send.');
    return 2;
  }

  try {
    new URL(api);
  } catch {
    err(`Invalid --api URL: ${api}`);
    return 2;
  }
  if (api.startsWith('http://') && !isLocal(api)) {
    err('Warning: sending credentials over plain HTTP to a non-local host. Use https.');
  }

  const post = (path, body, token) =>
    fetchImpl(`${api}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body)
    });

  let token;
  try {
    const res = await post('/api/auth/login', { identifier, password });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      err(`Login failed (${res.status}): ${body.message || 'unknown error'}`);
      return 1;
    }
    token = body.token;
  } catch (e) {
    err(`Cannot reach ${api}: ${e.message}`);
    return 1;
  }

  let failures = 0;
  for (const [i, m] of messages.entries()) {
    const payload = {
      message: m.message,
      contact: m.contact || args.contact,
      direction: m.direction || args.direction,
      timestamp: m.timestamp,
      userId: args['child-id']
    };
    let res;
    try {
      res = await post('/api/interactions', payload, token);
    } catch (e) {
      err(`Cannot reach ${api}: ${e.message}`);
      return 1;
    }
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      log(`[${i + 1}/${messages.length}] ${res.status === 202 ? 'skipped (monitoring is off)' : 'sent'}`);
      continue;
    }
    failures++;
    err(`[${i + 1}/${messages.length}] rejected (${res.status}): ${body.message || 'unknown error'}`);
    // These won't get better by retrying the rest
    if (res.status === 401 || res.status === 429) {
      err('Stopping.');
      return 1;
    }
  }
  return failures ? 1 : 0;
}

if (require.main === module) {
  run(process.argv.slice(2)).then((code) => process.exit(code));
}

module.exports = { run, parseArgs, parseLines };
