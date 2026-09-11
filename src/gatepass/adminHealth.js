/**
 * adminHealth.js — System Health: is Pravesha working right now?
 *
 * MEASURED FROM OUR OWN RECORDS, NOT FROM PINGING ANYBODY. A status page that
 * calls Meta and Razorpay every time somebody opens it is a status page that
 * makes the outage worse, and their "everything is fine" would not tell us that
 * OUR messages are failing. So each service is judged on what actually happened
 * here: messages we sent, payments visitors made, look-ups we asked for. The
 * database is the one thing checked live, because that check is a query.
 *
 * THREE STATES, PLAINLY. Working, degraded, or failing — and "quiet" when
 * nothing has happened recently enough to judge, which is not the same as
 * healthy and must not be coloured green.
 *
 * CONFIGURATION IS CHECKED, NEVER SHOWN. Whether a key is set is useful before
 * a launch; the key itself is never read into a response.
 */

const os = require('os');
const { query, one } = require('./db');
const slotTime = require('./slotTime');

const n = (v) => Number(v || 0);
const rowsOf = async (text, params) => (await query(text, params)).rows;
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);

/* The four states a service can be in. */
const WORKING = 'working';
const DEGRADED = 'degraded';
const FAILING = 'failing';
const QUIET = 'quiet';

const rank = { [FAILING]: 3, [DEGRADED]: 2, [QUIET]: 1, [WORKING]: 0 };

/** A failure rate becomes a state: a little is degraded, a lot is failing. */
function fromRate(failed, total, { degraded = 10, failing = 40, quietBelow = 1 } = {}) {
  if (total < quietBelow) return QUIET;
  const rate = (failed / total) * 100;
  if (rate >= failing) return FAILING;
  if (rate >= degraded) return DEGRADED;
  return WORKING;
}

async function database() {
  const started = process.hrtime.bigint();
  let ok = true;
  let detail = null;
  try {
    await query('SELECT 1');
  } catch (e) {
    ok = false;
    detail = e.message;
  }
  const ms = Number(process.hrtime.bigint() - started) / 1e6;

  let size = null;
  let connections = null;
  try {
    const [r] = await rowsOf(
      `SELECT pg_size_pretty(pg_database_size(current_database())) AS size,
              (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) AS conns`);
    size = r.size;
    connections = n(r.conns);
  } catch { /* a permission-light database is still a working one */ }

  return {
    key: 'database',
    label: 'Database',
    state: !ok ? FAILING : ms > 500 ? DEGRADED : WORKING,
    headline: ok ? `Answering in ${Math.round(ms)} ms` : 'Not answering',
    detail: ok ? `${size || 'size unknown'} · ${connections ?? '?'} connections open` : detail,
    metrics: [['Query time', `${Math.round(ms)} ms`], ['Size', size || '—'], ['Connections', connections ?? '—']],
  };
}

async function whatsapp() {
  const [day] = await rowsOf(
    `SELECT count(*) FILTER (WHERE direction = 'out') AS sent,
            count(*) FILTER (WHERE direction = 'out' AND error_message IS NOT NULL
              AND error_message NOT IN ('dry_run','replies_disabled','test_recipient_not_sent')) AS failed,
            count(*) FILTER (WHERE direction = 'in') AS received,
            max(created_at) FILTER (WHERE direction = 'out' AND error_message IS NULL) AS last_ok,
            max(created_at) FILTER (WHERE direction = 'in') AS last_in
       FROM wa_messages WHERE created_at > now() - interval '24 hours'`);
  const [hour] = await rowsOf(
    `SELECT count(*) FILTER (WHERE direction = 'out') AS sent,
            count(*) FILTER (WHERE direction = 'out' AND error_message IS NOT NULL
              AND error_message NOT IN ('dry_run','replies_disabled','test_recipient_not_sent')) AS failed
       FROM wa_messages WHERE created_at > now() - interval '1 hour'`);

  const state = n(hour.sent) ? fromRate(n(hour.failed), n(hour.sent)) : (n(day.sent) ? fromRate(n(day.failed), n(day.sent)) : QUIET);
  return {
    key: 'whatsapp',
    label: 'WhatsApp',
    state,
    headline: n(day.sent) === 0 ? 'No messages in 24 hours' : `${n(day.sent) - n(day.failed)} of ${n(day.sent)} delivered in 24 hours`,
    detail: n(day.failed) ? `${n(day.failed)} failed · last success ${day.last_ok ? new Date(day.last_ok).toISOString() : 'none'}` : 'No delivery failures recorded',
    metrics: [['Sent (24h)', n(day.sent)], ['Failed (24h)', n(day.failed)], ['Received (24h)', n(day.received)],
      ['Failure rate (1h)', n(hour.sent) ? `${pct(n(hour.failed), n(hour.sent))}%` : '—']],
    lastAt: day.last_ok || day.last_in,
  };
}

async function gateway() {
  const [day] = await rowsOf(
    `SELECT count(*) FILTER (WHERE status IN ('paid','refunded')) AS paid,
            count(*) FILTER (WHERE status = 'failed') AS failed,
            count(*) FILTER (WHERE status = 'created') AS pending,
            max(paid_at) AS last_paid
       FROM payments WHERE created_at > now() - interval '24 hours'`);
  const attempts = n(day.paid) + n(day.failed);
  return {
    key: 'gateway',
    label: 'Payment gateway',
    state: fromRate(n(day.failed), attempts, { degraded: 20, failing: 50 }),
    headline: attempts === 0 ? 'No payment attempts in 24 hours' : `${n(day.paid)} of ${attempts} payments succeeded in 24 hours`,
    detail: `${n(day.pending)} checkout${n(day.pending) === 1 ? '' : 's'} opened and not completed`,
    metrics: [['Successful (24h)', n(day.paid)], ['Failed (24h)', n(day.failed)], ['Pending', n(day.pending)],
      ['Failure rate', attempts ? `${pct(n(day.failed), attempts)}%` : '—']],
    lastAt: day.last_paid,
  };
}

async function lookups() {
  const [day] = await rowsOf(
    `SELECT count(*) AS calls, count(*) FILTER (WHERE NOT ok) AS failed,
            count(*) FILTER (WHERE cache_hit) AS cached,
            avg(duration_ms) FILTER (WHERE NOT cache_hit) AS avg_ms, max(created_at) AS last_at
       FROM api_calls WHERE created_at > now() - interval '24 hours'`);
  const live = n(day.calls) - n(day.cached);
  return {
    key: 'lookups',
    label: 'Vehicle look-up',
    state: fromRate(n(day.failed), live, { degraded: 10, failing: 35 }),
    headline: n(day.calls) === 0 ? 'No look-ups in 24 hours' : `${n(day.calls) - n(day.failed)} of ${n(day.calls)} look-ups answered`,
    detail: `${n(day.cached)} served from the cache · ${day.avg_ms ? `${Math.round(n(day.avg_ms))} ms average` : 'no live calls'}`,
    metrics: [['Look-ups (24h)', n(day.calls)], ['From cache', n(day.cached)], ['Failed', n(day.failed)],
      ['Average', day.avg_ms ? `${Math.round(n(day.avg_ms))} ms` : '—']],
    lastAt: day.last_at,
  };
}

async function passes() {
  const today = slotTime.nowIST().date;
  const [day] = await rowsOf(
    `SELECT count(*) FILTER (WHERE t.created_at > now() - interval '24 hours') AS issued,
            count(*) FILTER (WHERE t.created_at > now() - interval '24 hours' AND t.status = 'held') AS held,
            (SELECT count(*) FROM payments p WHERE p.status = 'paid' AND p.paid_at > now() - interval '24 hours'
                AND NOT EXISTS (SELECT 1 FROM tickets x WHERE x.payment_id = p.id)) AS paid_unissued,
            (SELECT count(*) FROM event_log e WHERE e.kind = 'invoice_failed' AND e.created_at > now() - interval '24 hours') AS invoice_failures,
            (SELECT count(*) FROM tickets x JOIN payments p2 ON p2.id = x.payment_id
              WHERE p2.status = 'paid' AND p2.paid_at > now() - interval '24 hours' AND x.total_paise > 0
                AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.ticket_id = x.id)) AS without_invoice
       FROM tickets t`);
  const [gate] = await rowsOf(
    `SELECT count(*) AS checks, avg(duration_ms) AS avg_ms
       FROM scans WHERE scanned_at > now() - interval '24 hours' AND duration_ms IS NOT NULL`);

  const broken = n(day.paid_unissued) + n(day.invoice_failures);
  return {
    key: 'passes',
    label: 'Pass and invoice generation',
    state: n(day.paid_unissued) > 0 ? FAILING : (n(day.invoice_failures) > 0 || n(day.without_invoice) > 0) ? DEGRADED : n(day.issued) ? WORKING : QUIET,
    headline: n(day.issued) === 0 ? 'No passes issued in 24 hours' : `${n(day.issued)} passes issued in 24 hours`,
    detail: broken === 0
      ? 'Every paid booking became a pass'
      : `${n(day.paid_unissued)} paid without a pass · ${n(day.invoice_failures)} invoices failed`,
    metrics: [['Issued (24h)', n(day.issued)], ['Awaiting payment', n(day.held)],
      ['Paid without a pass', n(day.paid_unissued)], ['Paid without an invoice', n(day.without_invoice)],
      ['Gate checks (24h)', n(gate.checks)], ['Average check', gate.avg_ms ? `${(n(gate.avg_ms) / 1000).toFixed(1)} sec` : '—']],
    today,
  };
}

async function delivery() {
  const [day] = await rowsOf(
    /* Seeded test bookings are never messaged on purpose, so they are not
       counted here — otherwise delivery would always look broken on a
       demonstration database. */
    `SELECT (SELECT count(*) FROM event_log WHERE kind = 'pass_delivered' AND created_at > now() - interval '24 hours') AS delivered,
            (SELECT count(*) FROM event_log WHERE kind = 'pass_resent' AND created_at > now() - interval '24 hours') AS resent,
            (SELECT count(*) FROM tickets t JOIN payments p ON p.id = t.payment_id
              WHERE p.status = 'paid' AND p.paid_at > now() - interval '24 hours'
                AND NOT t.is_test AND NOT p.is_test) AS paid_passes,
            (SELECT count(*) FROM tickets t WHERE t.is_test AND t.created_at > now() - interval '24 hours') AS test_passes`);
  const missing = Math.max(0, n(day.paid_passes) - n(day.delivered));
  return {
    key: 'delivery',
    label: 'Pass delivery',
    state: n(day.paid_passes) === 0 ? QUIET : fromRate(missing, n(day.paid_passes), { degraded: 5, failing: 25 }),
    headline: n(day.paid_passes) === 0 ? 'No passes to deliver in 24 hours' : `${n(day.delivered)} of ${n(day.paid_passes)} paid passes sent`,
    detail: missing
      ? `${missing} paid pass${missing === 1 ? '' : 'es'} not recorded as sent`
      : `Every paid pass was sent${n(day.test_passes) ? ` · ${n(day.test_passes)} test passes excluded` : ''}`,
    metrics: [['Sent (24h)', n(day.delivered)], ['Resent', n(day.resent)], ['Paid passes', n(day.paid_passes)], ['Test passes (not sent)', n(day.test_passes)]],
  };
}

/** Recent delivery failures, in the visitor's own words where we have them. */
async function failures() {
  const rows = await rowsOf(
    `SELECT created_at, mobile, message_type, template_name, error_message
       FROM wa_messages
      WHERE direction = 'out' AND error_message IS NOT NULL
        AND error_message NOT IN ('dry_run','replies_disabled','test_recipient_not_sent')
        AND created_at > now() - interval '7 days'
      ORDER BY created_at DESC LIMIT 20`);
  return rows.map((r) => ({
    at: r.created_at,
    mobile: r.mobile ? `••••${String(r.mobile).slice(-4)}` : null,
    type: r.template_name || r.message_type,
    error: r.error_message,
  }));
}

/** What is configured, as yes or no. No value is ever read out. */
function configuration() {
  const set = (name) => Boolean(String(process.env[name] || '').trim());
  const source = process.env.VEHICLE_SOURCE || 'not set';
  return [
    { key: 'whatsapp', label: 'WhatsApp Business API', ready: set('WHATSAPP_ACCESS_TOKEN') && set('WHATSAPP_PHONE_NUMBER_ID'),
      note: `Sending messages · replies ${String(process.env.WHATSAPP_REPLY_ENABLED) === 'true' ? 'enabled' : 'disabled'}${String(process.env.WHATSAPP_DRY_RUN) === 'true' ? ' · dry run' : ''}` },
    { key: 'whatsapp_webhook', label: 'WhatsApp webhook', ready: set('WHATSAPP_VERIFY_TOKEN') && set('WHATSAPP_APP_SECRET'), note: 'Receiving and verifying messages' },
    { key: 'razorpay', label: 'Razorpay keys', ready: (set('RAZORPAY_LIVE_KEY') && set('RAZORPAY_LIVE_SECRET')) || (set('RAZORPAY_TEST_KEY') && set('RAZORPAY_TEST_SECRET')),
      note: set('RAZORPAY_LIVE_KEY') ? 'Live keys present' : set('RAZORPAY_TEST_KEY') ? 'Test keys only' : 'No keys' },
    { key: 'razorpay_webhook', label: 'Razorpay webhook secret', ready: set('RAZORPAY_WEBHOOK'), note: 'Confirms payment even if the visitor closes the page' },
    { key: 'vehicle', label: 'Vehicle look-up', ready: set('VEHICLE_SOURCE') && (source === 'ulip' ? set('ULIP_USERNAME') && set('ULIP_PASSWORD') : set('GATEWAY_BASE_URL') && set('VEHICLE_LOOKUP_KEY')),
      note: `Source: ${source}` },
    { key: 'pass_key', label: 'Pass number key', ready: set('PASS_NUMBER_KEY'), note: 'Encrypts pass numbers' },
    { key: 'web_token', label: 'Booking link secret', ready: set('WEB_TOKEN_SECRET'), note: 'Signs the booking and payment links' },
    { key: 'public_url', label: 'Public address', ready: set('PUBLIC_BASE_URL'), note: process.env.PUBLIC_BASE_URL || 'Links in messages need this' },
    { key: 'mail', label: 'Support mailbox', ready: set('MAIL_HOST') && (set('MAIL_USER') || set('MAIL_USERNAME')), note: 'Contact form delivery' },
    { key: 'database', label: 'Database', ready: set('PGHOST') && set('PGDATABASEMAIN'), note: 'Connection details' },
  ];
}

function server() {
  const up = Math.floor(process.uptime());
  const days = Math.floor(up / 86400);
  const hours = Math.floor((up % 86400) / 3600);
  const mins = Math.floor((up % 3600) / 60);
  const mem = process.memoryUsage();
  return {
    key: 'server',
    label: 'Application',
    state: WORKING,
    headline: `Up ${days ? `${days}d ` : ''}${hours}h ${mins}m`,
    detail: `Node ${process.version} on ${os.type()} · started ${new Date(Date.now() - up * 1000).toISOString()}`,
    metrics: [
      ['Uptime', `${days ? `${days}d ` : ''}${hours}h ${mins}m`],
      ['Memory', `${Math.round(mem.rss / 1048576)} MB`],
      ['Load (1 min)', os.loadavg()[0] ? os.loadavg()[0].toFixed(2) : '—'],
      ['Node', process.version],
    ],
    startedAt: new Date(Date.now() - up * 1000).toISOString(),
  };
}

async function health() {
  const started = Date.now();
  const [db, wa, pay, look, pass, deliv, fails] = await Promise.all([
    database(), whatsapp(), gateway(), lookups(), passes(), delivery(), failures(),
  ]);
  const services = [db, wa, pay, look, pass, deliv, server()];
  const worst = services.reduce((w, s) => (rank[s.state] > rank[w] ? s.state : w), WORKING);
  const config = configuration();

  return {
    at: new Date().toISOString(),
    overall: worst,
    overallLabel: { working: 'Everything is working', degraded: 'Something needs attention', failing: 'Something is failing', quiet: 'Nothing has happened recently' }[worst],
    responseMs: Date.now() - started,
    services,
    failures: fails,
    configuration: config,
    configurationReady: config.every((c) => c.ready),
    note: 'Judged on what actually happened here — messages sent, payments made, look-ups asked for — rather than by calling Meta or Razorpay.',
  };
}

module.exports = { health };
