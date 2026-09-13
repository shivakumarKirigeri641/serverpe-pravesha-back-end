/**
 * jobs/periodReports.js — the evening report, sent once.
 *
 * WHY EIGHT IN THE EVENING. The last slot ends at six and the last entry is an
 * hour before that, so by eight the day is genuinely finished: nothing more will
 * be booked, entered or refused. A report sent at five would be a guess with a
 * number on it.
 *
 * WHY SUNDAY AND THE LAST OF THE MONTH, rather than Monday morning and the 1st.
 * Sent on the evening a period ends, the period being reported IS the current
 * one — this week, this month — and there is no "go back and find the previous
 * one" arithmetic. That arithmetic is where off-by-one errors live, and an
 * off-by-one in a report to a Deputy Commissioner is a meeting nobody enjoys.
 *
 * IT SENDS TO NOBODY BY DEFAULT. The recipients list starts empty, and an empty
 * list means this job does nothing at all. Revenue figures reach a phone only
 * because somebody deliberately put that number in Settings.
 *
 * ONCE, EVEN IF THE SERVER RESTARTS. What has been sent is written down, so a
 * process that restarts at 20:05 does not send the day again — and one that is
 * down all evening sends nothing rather than a burst of yesterday at midnight.
 */

const { query, one } = require('../gatepass/db');
const settings = require('../gatepass/settings');
const slotTime = require('../gatepass/slotTime');
const templates = require('../whatsapp/templates');
const phone = require('../whatsapp/phone');
const periodReport = require('../gatepass/periodReport');

const EVERY_MS = 60_000;               // the clock is checked once a minute
const DEFAULT_AT = '20:00';            // IST, and overridable in settings
const LATE_MINUTES = 30;               // how long after the hour it may still go

/* Who gets it. Ten digits each, comma or space separated, and nothing by default. */
async function recipients() {
  const raw = await settings.str('report_recipients', '');
  return String(raw || '')
    .split(/[,\s]+/)
    .map((x) => x.replace(/\D/g, '').slice(-10))
    .filter((x) => /^[6-9]\d{9}$/.test(x));
}

/* What has already gone out, so nothing goes twice. */
async function alreadySent(kind, period) {
  const row = await one(
    `SELECT value FROM app_settings WHERE key = $1`, [`report_sent_${kind}`]);
  return row && String(row.value) === `${period.from}..${period.to}`;
}

async function markSent(kind, period) {
  await query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [`report_sent_${kind}`, `${period.from}..${period.to}`]);
  settings.clear();
}

/** Which reports are due on this date, in the order they should arrive. */
function dueOn(date) {
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();     // 0 = Sunday
  const lastOfMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();

  const due = ['daily'];
  if (dow === 0) due.push('weekly');
  if (d === lastOfMonth) due.push('monthly');
  return due;
}

/**
 * Send one kind to everybody on the list.
 *
 * A number that fails does not stop the others: one phone out of coverage must
 * not cost everybody else their report. The failure is logged with the number
 * masked, and the send is still recorded as done — retrying an approved template
 * every minute for an hour would cost money and annoy everybody who did get it.
 */
async function sendOne(kind, to) {
  const report = await periodReport.build({ kind });
  const vars = periodReport.variables(report);

  const results = [];
  for (const mobile of to) {
    try {
      const out = await templates.sendPeriodReport(phone.toWa(mobile), vars);
      results.push({ mobile, ok: Boolean(out && out.ok !== false) });
      console.log('[reports] %s report to ••••%s: %s', kind, mobile.slice(-4),
        out && out.ok !== false ? 'sent' : 'refused');
    } catch (e) {
      results.push({ mobile, ok: false, error: e.message });
      console.error('[reports] %s report to ••••%s failed: %s', kind, mobile.slice(-4), e.message);
    }
  }
  return { period: report.period, results };
}

/** The once-a-minute check. */
async function pass() {
  const to = await recipients();
  if (!to.length) return;                       // nobody asked for it

  const at = String(await settings.str('report_send_at', DEFAULT_AT));
  const [hh, mm] = at.split(':').map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return;

  const now = slotTime.nowIST();
  const target = hh * 60 + mm;
  /* A window rather than an instant: a minute can be missed by a slow tick or a
     restart, and half an hour late is still this evening's report. Later than
     that and it is tomorrow's problem — nobody wants yesterday at midnight. */
  if (now.minutes < target || now.minutes > target + LATE_MINUTES) return;

  for (const kind of dueOn(now.date)) {
    const period = periodReport.periodFor(kind, now.date);
    if (await alreadySent(kind, period)) continue;
    await markSent(kind, period);               // before sending: a crash mid-send must not repeat it
    await sendOne(kind, to);
  }
}

function start() {
  console.log('[reports] period reports at %s IST — daily, Sundays weekly, month end monthly',
    DEFAULT_AT);
  setInterval(() => pass().catch((e) => console.error('[reports] %s', e.message)), EVERY_MS).unref();
}

module.exports = { start, pass, dueOn, recipients, sendOne };
