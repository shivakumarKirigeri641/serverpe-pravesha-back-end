/**
 * demo/jobs.js — TEMPORARY. Running the demonstration-data scripts from the panel.
 *
 * This whole folder, src/routes/adminDemoApi.js, the two demo capabilities and
 * the panel's "Demo & test data" screen exist to fill and empty a demonstration
 * database. They are meant to be deleted before launch; nothing else in src/
 * imports them, so deleting them breaks nothing.
 *
 * WHY IT SHELLS OUT. The seeding logic already exists in scripts/, is written to
 * be disposable, and is the thing that has been tested. Re-implementing it here
 * would give two versions of the same thing, and the wrong one would be the one
 * running. So each action is the script, run as a child process, with its output
 * streamed back to the screen.
 *
 * WHAT IT CANNOT DO. It never touches a row that is not flagged is_test, because
 * the scripts do not. It refuses entirely on a production server. Only one job
 * runs at a time, and every run is audited with who asked for it and why.
 */

const { spawn } = require('child_process');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const MAX_LINES = 400;

/*
 * The actions the screen offers. `args` is built from the options the panel
 * sends — never from free text, so nothing a browser says can become a flag.
 */
const ACTIONS = {
  seed: {
    label: 'Fill the database with demonstration data',
    script: 'scripts/temp-seed-occupancy.js',
    destructive: false,
    blurb: 'Bookings, gate activity, payments and conversations to the configured occupancy, from the start date to today.',
    args: (o) => [
      ...(o.from ? [`--from=${o.from}`] : []),
      ...(o.to ? [`--to=${o.to}`] : []),
      ...(o.holidays ? [`--holidays=${o.holidays}`] : []),
      ...(o.keepPrices ? ['--keep-prices'] : []),
    ],
  },
  invoices: {
    label: 'Issue tax invoices for the test passes',
    script: 'scripts/seed-test-invoices.js',
    destructive: false,
    blurb: 'A TST/ series of its own, so the real invoice series is never touched.',
    args: () => [],
  },
  settlements: {
    label: 'Add settlements, refunds and remittances',
    script: 'scripts/seed-test-payments.js',
    destructive: false,
    blurb: 'Gateway settlements at T+2, a few refunds, and weekly remittances to the Department.',
    args: () => [],
  },
  conversations: {
    label: 'Write WhatsApp conversation history',
    script: 'scripts/temp-seed-occupancy.js',
    destructive: false,
    blurb: 'Threads for passes that have none. Written as history — nothing is sent.',
    args: (o) => ['--conversations-only', ...(o.count ? [`--count=${o.count}`] : [])],
  },
  failures: {
    label: 'Add failed checkouts',
    script: 'scripts/temp-seed-occupancy.js',
    destructive: false,
    blurb: 'Payments that did not go through, spread across the days that have passes.',
    args: (o) => ['--failures-only', ...(o.from ? [`--from=${o.from}`] : [])],
  },
  reset: {
    label: 'Remove every piece of test data',
    script: 'scripts/temp-seed-occupancy.js',
    destructive: true,
    blurb: 'Deletes test passes, payments, invoices, scans, vehicles, visitors and conversations, and resets the slot counters. Real rows and the one real conversation are left alone.',
    args: () => ['--remove'],
  },
};

/* The last few jobs, in memory. A restart forgets them, which is correct: this
   is a screen for watching something run, not a record of anything. */
const history = [];
let current = null;

const clean = (v, pattern) => (pattern.test(String(v || '')) ? String(v) : null);

function sanitise(action, options = {}) {
  const o = {};
  if (options.from) o.from = clean(options.from, /^\d{4}-\d{2}-\d{2}$/);
  if (options.to) o.to = clean(options.to, /^\d{4}-\d{2}-\d{2}$/);
  if (options.holidays) o.holidays = clean(options.holidays, /^\d{4}-\d{2}-\d{2}(,\d{4}-\d{2}-\d{2})*$/);
  if (options.count) o.count = clean(options.count, /^\d{1,4}$/);
  o.keepPrices = options.keepPrices === true;
  return ACTIONS[action].args(o);
}

function status() {
  return {
    actions: Object.entries(ACTIONS).map(([key, a]) => ({ key, label: a.label, blurb: a.blurb, destructive: a.destructive })),
    running: current ? { ...current, log: current.log.slice(-MAX_LINES) } : null,
    recent: history.slice(-5).reverse().map((j) => ({ ...j, log: j.log.slice(-MAX_LINES) })),
  };
}

/** Start one. Returns the job; the screen follows it by polling status(). */
function run({ action, options = {}, by }) {
  if (!ACTIONS[action]) {
    const e = new Error('No such action.');
    e.status = 400;
    throw e;
  }
  if (current) {
    const e = new Error(`"${ACTIONS[current.action].label}" is still running. Wait for it to finish.`);
    e.status = 409;
    e.code = 'busy';
    throw e;
  }

  const a = ACTIONS[action];
  const args = [a.script, ...sanitise(action, options)];
  const job = {
    id: crypto.randomBytes(6).toString('hex'),
    action,
    label: a.label,
    command: `node ${args.join(' ')}`,
    by,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    ok: null,
    log: [],
  };
  current = job;

  const child = spawn(process.execPath, args, { cwd: ROOT, env: process.env });
  const take = (buffer) => {
    for (const line of String(buffer).split(/\r?\n/)) {
      /* dotenv announces itself on every script; it is noise here. */
      if (!line.trim() || /injected env|PostgreSQL connected/.test(line)) continue;
      job.log.push(line);
      if (job.log.length > MAX_LINES * 2) job.log.splice(0, job.log.length - MAX_LINES);
    }
  };
  child.stdout.on('data', take);
  child.stderr.on('data', take);
  child.on('close', (code) => {
    job.finishedAt = new Date().toISOString();
    job.ok = code === 0;
    job.log.push(code === 0 ? '— finished —' : `— failed (exit ${code}) —`);
    history.push(job);
    if (history.length > 10) history.shift();
    current = null;
  });
  child.on('error', (e) => {
    job.log.push(`could not start: ${e.message}`);
    job.finishedAt = new Date().toISOString();
    job.ok = false;
    history.push(job);
    current = null;
  });

  return { id: job.id, label: job.label, command: job.command };
}

module.exports = { ACTIONS, run, status };
