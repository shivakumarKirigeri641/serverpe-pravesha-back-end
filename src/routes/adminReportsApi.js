/**
 * adminReportsApi.js — who receives the evening report, and sending one by hand.
 *
 * READING THE PREVIEW needs reports.view: it is the same figures the panel
 * already shows, arranged differently. CHANGING WHO RECEIVES IT needs
 * settings.reports, because adding a number to that list puts collection figures
 * on somebody's phone every evening from then on — that is not a preference, it
 * is a decision, and it leaves an audit row with the numbers before and after.
 *
 * SENDING ONE NOW IS ALSO A DECISION, and costs real money at Meta's template
 * rates, so it is behind the same permission and audited the same way. It is
 * there for one honest reason: an approved template cannot be tested by reading
 * it, and finding out at eight in the evening that the parameters are in the
 * wrong order is finding out in front of the recipient.
 */

const express = require('express');
const { auth, needs } = require('./adminApi');
const admin = require('../gatepass/admin');
const settings = require('../gatepass/settings');
const { query, one } = require('../gatepass/db');
const periodReport = require('../gatepass/periodReport');
const templates = require('../whatsapp/templates');
const phone = require('../whatsapp/phone');

const router = express.Router();
const P = '/admin/api/reports/period';
const json = express.json({ limit: '32kb' });
const ipOf = (req) => (req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim();

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    console.error('[reportsApi] %s %s: %s', req.method, req.path, e.stack || e.message);
    res.status(500).json({ error: 'server_error', message: 'Something went wrong. Nothing was changed.' });
  }
};

/* Ten digits each, however they were typed. */
const parseList = (raw) => String(raw || '')
  .split(/[,\s]+/)
  .map((x) => x.replace(/\D/g, '').slice(-10))
  .filter(Boolean);

const valid = (m) => /^[6-9]\d{9}$/.test(m);
const mask = (m) => `••••${m.slice(-4)}`;

const setSetting = async (key, value) => {
  await query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [key, value]);
  settings.clear();
};

/** The settings, the previews and what has gone out already. */
router.get(P, auth, needs('reports.view'), handle(async (req, res) => {
  const recipients = parseList(await settings.str('report_recipients', ''));
  const [daily, weekly, monthly] = await Promise.all(
    ['daily', 'weekly', 'monthly'].map((kind) => periodReport.build({ kind })),
  );

  const sent = {};
  for (const kind of ['daily', 'weekly', 'monthly']) {
    const row = await one(`SELECT value FROM app_settings WHERE key = $1`, [`report_sent_${kind}`]);
    sent[kind] = row ? String(row.value) : null;
  }

  res.set('Cache-Control', 'no-store').json({
    ok: true,
    template: templates.PERIOD_REPORT.name,
    sendAt: await settings.str('report_send_at', '20:00'),
    /* Shown in full to whoever may change the list — they have to be able to
       check a digit — and never anywhere else. */
    recipients: recipients.map((m) => ({
      mobile: admin.can(req.admin.role, 'settings.reports') ? m : mask(m),
      valid: valid(m),
    })),
    preview: {
      daily: periodReport.asText(daily),
      weekly: periodReport.asText(weekly),
      monthly: periodReport.asText(monthly),
    },
    periods: { daily: daily.period, weekly: weekly.period, monthly: monthly.period },
    lastSent: sent,
  });
}));

/** Change the list, or the hour. */
router.put(P, json, auth, needs('settings.reports'), handle(async (req, res) => {
  const before = {
    recipients: parseList(await settings.str('report_recipients', '')),
    sendAt: await settings.str('report_send_at', '20:00'),
  };

  const wanted = parseList(req.body?.recipients);
  const bad = wanted.filter((m) => !valid(m));
  if (bad.length) {
    return res.status(400).json({
      error: 'bad_number',
      message: `Not a mobile number: ${bad.map(mask).join(', ')}. Ten digits, starting 6 to 9.`,
    });
  }

  const at = String(req.body?.sendAt || before.sendAt);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(at)) {
    return res.status(400).json({ error: 'bad_time', message: 'Give the time as HH:MM, for example 20:00.' });
  }

  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 5) {
    return res.status(400).json({ error: 'reason_required', message: 'Write a short reason — it goes in the audit trail.' });
  }

  await setSetting('report_recipients', wanted.join(','));
  await setSetting('report_send_at', at);

  await admin.audit({
    adminId: req.admin.admin_id,
    action: 'report_recipients_changed',
    subject: 'report:period',
    /* Masked in the audit row: the trail records that the list changed and by
       how much, not a copy of everybody's number in a second place. */
    before: { recipients: before.recipients.map(mask), sendAt: before.sendAt },
    after: { recipients: wanted.map(mask), sendAt: at },
    reason,
    ip: ipOf(req),
    sessionId: req.admin.session_id,
  });

  res.json({ ok: true, recipients: wanted.length, sendAt: at });
}));

/**
 * Send one now.
 *
 * To one number, named in the request, rather than to the whole list: testing a
 * template should not be a thing that arrives on a Deputy Commissioner's phone
 * because somebody wanted to see the layout.
 */
router.post(`${P}/send`, json, auth, needs('settings.reports'), handle(async (req, res) => {
  const kind = ['daily', 'weekly', 'monthly'].includes(req.body?.kind) ? req.body.kind : 'daily';
  const to = parseList(req.body?.to)[0];
  if (!to || !valid(to)) {
    return res.status(400).json({ error: 'bad_number', message: 'Give the mobile number to send it to.' });
  }

  const report = await periodReport.build({ kind });
  const vars = periodReport.variables(report);

  let out;
  try {
    out = await templates.sendPeriodReport(phone.toWa(to), vars);
  } catch (e) {
    return res.status(502).json({ error: 'send_failed', message: e.message });
  }

  await admin.audit({
    adminId: req.admin.admin_id,
    action: 'report_sent_by_hand',
    subject: `report:${kind}`,
    before: null,
    after: { kind, to: mask(to), period: `${report.period.from}..${report.period.to}` },
    reason: `Sent the ${kind} report to ${mask(to)} by hand`,
    ip: ipOf(req),
    sessionId: req.admin.session_id,
  });

  res.json({
    ok: out !== false && out !== null,
    sentTo: mask(to),
    kind,
    period: report.period,
    /* What was actually sent, so a template that renders wrongly can be
       compared against what it was given. */
    variables: vars,
  });
}));

module.exports = router;
