/**
 * adminApi.js — the JSON API behind the admin panel.
 *
 *   POST   /admin/api/session     sign in
 *   GET    /admin/api/session     who am I
 *   DELETE /admin/api/session     sign out
 *   GET    /admin/api/dashboard   the day's numbers, against yesterday
 *
 * Bearer token, resolved on every request except sign-in; a session that has
 * ended or gone idle answers 401 and the panel returns to its sign-in screen.
 *
 * Grows one screen at a time, alongside the navigation item that uses it — a
 * route with nothing reading it is a route nobody has checked.
 */

const express = require('express');
const admin = require('../gatepass/admin');
const stats = require('../gatepass/adminStats');
const liveStats = require('../gatepass/adminLive');
const analytics = require('../gatepass/adminAnalytics');
const conversations = require('../gatepass/adminConversations');
const reports = require('../gatepass/reports');
const negative = require('../gatepass/adminNegative');
const reportWorkbook = require('../gatepass/reportWorkbook');
const reportPdf = require('../pdf/reportPdf');
const settingsStore = require('../gatepass/settings');
const slotTime = require('../gatepass/slotTime');

const router = express.Router();
const json = express.json({ limit: '64kb' });

const P = '/admin/api';

const safe = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) {
    console.error('[adminApi] %s %s: %s', req.method, req.path, e.stack || e.message);
    res.status(500).json({ error: 'server_error', message: 'Something went wrong. Please try again.' });
  }
};

const tokenOf = (req) => (req.get('authorization') || '').replace(/^Bearer\s+/i, '') || req.get('x-admin-token');

async function auth(req, res, next) {
  const session = await admin.sessionFor(tokenOf(req));
  if (!session) {
    return res.status(401).json({ error: 'signed_out', message: 'Your session has ended. Please sign in again.' });
  }
  req.admin = session;
  next();
}

/** Guard a route by what the role may do, not by the role's name. */
const needs = (capability) => (req, res, next) => {
  if (!admin.can(req.admin.role, capability)) {
    return res.status(403).json({ error: 'not_allowed',
      message: 'Your account does not have permission for that.' });
  }
  next();
};

/*
 * Money totals are for roles that may see finances. Everyone else gets the same
 * screen without them — revenue, collections, GST and the split — rather than a
 * refusal, and `financeHidden` tells the panel to say so instead of showing ₹0.
 * The price of an individual pass is not a total and stays visible.
 */
const seesMoney = (req) => admin.can(req.admin.role, 'finance.view');
const MONEY_KEYS = ['collected', 'department', 'serviceFee', 'gst', 'gateway', 'refunds', 'passValue', 'revenue'];
const dropKeys = (rows, keys = MONEY_KEYS) => (rows || []).map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !keys.includes(k))));

function withoutMoney(kind, body) {
  const out = { ...body, financeHidden: true };
  if (kind === 'dashboard') {
    delete out.revenue;
    out.trend = dropKeys(out.trend);
  } else if (kind === 'analytics') {
    if (out.traffic) out.traffic = { ...out.traffic, value: undefined };
    out.daily = dropKeys(out.daily);
  } else if (kind === 'compare') {
    delete out.revenue;
  } else if (kind === 'report') {
    delete out.finance;
    out.vehicles = dropKeys(out.vehicles);
    out.daily = dropKeys(out.daily);
    out.weekly = dropKeys(out.weekly);
  }
  return out;
}
const money = (req, kind, body) => (seesMoney(req) ? body : withoutMoney(kind, body));

const me = (s) => ({
  id: String(s.admin_id),
  name: s.name,
  mobile: `••••${String(s.mobile).slice(-4)}`,
  role: s.role,
  /* The panel hides what it cannot use, and the routes refuse it regardless. */
  can: {
    operate: admin.can(s.role, 'negative.act'),
    configure: admin.can(s.role, 'conversations.technical'),
    manageStaff: admin.can(s.role, 'settings.staff'),
    readPersonal: admin.can(s.role, 'conversations.view'),
  },
  /* The gate a checkpost manager runs; null for roles that span every checkpost. */
  checkpost: s.checkpost_id ? { id: String(s.checkpost_id), name: s.checkpost_name, placeId: String(s.place_id) } : null,
  roleLabel: (require('../gatepass/permissions').ROLES[s.role] || {}).label || s.role,
  /* Filled in by the session route: the panel shows a banner while it runs. */
  simulation: s.simulation || null,
  capabilities: require('../gatepass/permissions').capabilitiesOf(s.role),
  signedInAt: s.started_at,
});

router.post(`${P}/session`, json, safe(async (req, res) => {
  const { mobile, password } = req.body || {};
  const out = await admin.signIn({
    mobile, password,
    ip: (req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim(),
    userAgent: (req.get('user-agent') || '').slice(0, 300),
  });
  if (!out.ok) return res.status(out.error === 'locked' ? 423 : 401).json(out);

  const session = await admin.sessionFor(out.token);
  res.json({ ok: true, token: out.token, ...me(session) });
}));

/*
 * Sign in with a code (2026-09-15): ask for one, then type it back. While codes
 * are fixed for development nothing is sent to any number, and production
 * refuses them — see src/gatepass/adminOtp.js.
 */
const clientIp = (req) => (req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim();

router.post(`${P}/session/otp`, json, safe(async (req, res) => {
  const out = await require('../gatepass/adminOtp').request({ mobile: req.body?.mobile, ip: clientIp(req) });
  res.status(out.ok ? 200 : (['too_soon', 'too_many'].includes(out.error) ? 429 : 400)).json(out);
}));

router.post(`${P}/session/verify`, json, safe(async (req, res) => {
  const out = await require('../gatepass/adminOtp').verify({
    mobile: req.body?.mobile, code: req.body?.code,
    ip: clientIp(req), userAgent: (req.get('user-agent') || '').slice(0, 300),
  });
  if (!out.ok) return res.status(401).json(out);
  const session = await admin.sessionFor(out.token);
  res.json({ ok: true, token: out.token, ...me(session) });
}));

router.get(`${P}/session`, auth, safe(async (req, res) => {
  /* Demonstration mode is stated on every screen while it is on: nobody should
     mistake generated traffic for real visitors. */
  const simulation = await require('../simulation').config();
  res.json({ ok: true, ...me({ ...req.admin, simulation: { running: simulation.enabled, until: simulation.until } }) });
}));

router.delete(`${P}/session`, auth, safe(async (req, res) => {
  await admin.signOut(tokenOf(req));
  await admin.audit({ adminId: req.admin.admin_id, action: 'sign_out' });
  res.json({ ok: true });
}));

/*
 * The landing screen. `date` looks back at an earlier day, with the same
 * comparison against the day before it.
 *
 * TOMORROW IS NOT A DAY THAT CAN BE REPORTED ON. A future date has bookings but
 * no arrivals, no gate activity and no money collected, so every figure but one
 * would read as zero — which looks like a catastrophe rather than a date that
 * has not happened. The panel hides the way there; this refuses it outright, so
 * a typed URL or a stale tab cannot get there either.
 */
router.get(`${P}/dashboard`, auth, needs('dashboard.view'), safe(async (req, res) => {
  const asked = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? String(req.query.date) : null;
  const today = slotTime.nowIST().date;

  if (asked && asked > today) {
    return res.status(400).json({ error: 'future_date', today,
      message: 'The dashboard reports on today and earlier days only.' });
  }
  res.json({ ok: true, ...money(req, 'dashboard', await stats.dashboard({ date: asked })) });
}));

/*
 * Live monitoring. Polled every few seconds by a screen somebody is watching, so
 * it is one call rather than nine, it never caches, and it always reports now —
 * there is no date parameter, because "live" for a past day is a contradiction.
 */
router.get(`${P}/live`, auth, needs('live.view'), safe(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, ...(await liveStats.live()) });
}));

/*
 * "Has anything happened?" — the small question the live screen asks between
 * refreshes.
 *
 * The full live payload is a dozen queries; this is one, with no joins. The
 * screen asks this often and rebuilds itself only when the answer differs from
 * the last one, so an idle gate costs almost nothing and a barrier that has just
 * checked a vehicle shows it within a couple of seconds.
 *
 * Every screen that shows bookings asks it — the dashboard, passes, payments,
 * on-spot sales — so any signed-in user may ask. It carries counts and a
 * change marker, nothing a role could be kept from.
 */
router.get(`${P}/live/pulse`, auth, safe(async (req, res) => {
  res.set('Cache-Control', 'no-store').json({ ok: true, ...(await liveStats.pulse()) });
}));

/*
 * Older pages of today's activity feed.
 *
 * Cursor-paged rather than offset-paged: checks land while somebody is reading,
 * and an offset of 25 means something different each time one arrives — page two
 * would repeat rows page one already showed.
 */
router.get(`${P}/live/activity`, auth, needs('live.view'), safe(async (req, res) => {
  const out = await liveStats.activity({
    limit: req.query.limit,
    /* '<iso time>|<id>', as handed back by the previous page. */
    before: req.query.before ? String(req.query.before) : null,
  });
  res.set('Cache-Control', 'no-store').json({
    ok: true,
    rows: out.rows.map(liveStats.shapeActivity),
    hasMore: out.hasMore,
    nextCursor: out.nextCursor,
  });
}));

/* ─────────────────────────────────────────────────────── analytics ── */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A range from the query, clamped to today and to a sane span. */
function range(req, defaultDays = 29) {
  const today = slotTime.nowIST().date;
  let to = DATE.test(String(req.query.to || '')) ? String(req.query.to) : today;
  if (to > today) to = today;
  let from = DATE.test(String(req.query.from || '')) ? String(req.query.from) : analytics.shiftDay(to, -defaultDays);
  if (from > to) from = to;
  /* Two years is far more than anybody will ask for and stops a hand-typed URL
     from asking the database to scan everything. */
  const earliest = analytics.shiftDay(to, -730);
  if (from < earliest) from = earliest;
  return { from, to, today };
}

/* Totals, peaks, the day table, visitor bands and staff, for one range. */
router.get(`${P}/analytics`, auth, needs('analytics.view'), safe(async (req, res) => {
  const { from, to } = range(req);
  res.json({ ok: true, ...money(req, 'analytics', await analytics.overview({ from, to })) });
}));

/* When vehicles come: entries by hour across the days of the week. */
router.get(`${P}/analytics/patterns`, auth, needs('analytics.view'), safe(async (req, res) => {
  const to = String(req.query.to || '').slice(0, 10);
  const from = String(req.query.from || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return res.status(400).json({ error: 'bad_range', message: 'Choose a start and end date.' });
  }
  res.set('Cache-Control', 'no-store').json({ ok: true, heatmap: await analytics.heatmap(from, to) });
}));

/* Where the vehicles are registered: by state, and by registering office. */
router.get(`${P}/analytics/origins`, auth, needs('analytics.view'), safe(async (req, res) => {
  const to = String(req.query.to || '').slice(0, 10);
  const from = String(req.query.from || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return res.status(400).json({ error: 'bad_range', message: 'Choose a start and end date.' });
  }
  res.set('Cache-Control', 'no-store').json({ ok: true, ...(await analytics.origins(from, to)) });
}));

/* Each staff member day by day: how much they checked, and how long it took. */
router.get(`${P}/analytics/staff-trend`, auth, needs('analytics.view'), safe(async (req, res) => {
  const to = String(req.query.to || '').slice(0, 10);
  const from = String(req.query.from || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return res.status(400).json({ error: 'bad_range', message: 'Choose a start and end date.' });
  }
  res.set('Cache-Control', 'no-store').json({ ok: true, ...(await analytics.staffTrend(from, to)) });
}));

/* The visitor list: searchable by number, name or vehicle. */
router.get(`${P}/analytics/visitors`, auth, needs('analytics.view'), safe(async (req, res) => {
  const rows = await analytics.visitors({
    q: req.query.q || null,
    band: req.query.band || null,
    limit: req.query.limit,
    offset: req.query.offset,
  });
  res.json({ ok: true, visitors: rows, bands: await analytics.visitorBands() });
}));

/* One visitor's passes. */
router.get(`${P}/analytics/visitor/:id`, auth, needs('analytics.view'), safe(async (req, res) => {
  const found = await analytics.visitorVisits(req.params.id);
  if (!found) return res.status(404).json({ error: 'not_found', message: 'No such visitor.' });
  res.json({ ok: true, ...found });
}));

/* One vehicle, in full. */
router.get(`${P}/analytics/vehicle/:regNo`, auth, needs('analytics.view'), safe(async (req, res) => {
  const found = await analytics.vehicle(req.params.regNo);
  if (!found) {
    return res.status(404).json({ error: 'not_found',
      message: 'No vehicle with that number has been looked up or booked here.' });
  }
  res.json({ ok: true, ...found });
}));

/*
 * Two ranges side by side. A preset names the common pairs so nobody has to
 * choose four dates to answer "how is this week against last".
 */
router.get(`${P}/analytics/compare`, auth, needs('analytics.view'), safe(async (req, res) => {
  const today = slotTime.nowIST().date;
  const sets = analytics.presets(today);
  const preset = sets[String(req.query.preset || '')];

  const pick = (key, fallback) => (DATE.test(String(req.query[key] || '')) ? String(req.query[key]) : fallback);
  const [aFrom, aTo] = preset ? preset.a : [pick('from', today), pick('to', today)];
  const [bFrom, bTo] = preset ? preset.b : [pick('againstFrom', analytics.shiftDay(today, -1)), pick('againstTo', analytics.shiftDay(today, -1))];

  res.json({
    ok: true,
    preset: preset ? String(req.query.preset) : 'custom',
    presets: Object.entries(sets).map(([key, v]) => ({ key, label: v.label })),
    ...money(req, 'compare', await analytics.compare(aFrom, aTo, bFrom, bTo)),
  });
}));

/* ──────────────────────────────────────────────────── conversations ── */

router.get(`${P}/conversations`, auth, needs('conversations.view'), safe(async (req, res) => {
  res.set('Cache-Control', 'no-store').json({
    ok: true,
    conversations: await conversations.list({ q: req.query.q || null, limit: req.query.limit, offset: req.query.offset }),
  });
}));

/*
 * One conversation. The technical panel — the full number and WhatsApp and
 * session identifiers — is included only for a role that may configure the
 * system, and every time it is, the viewing is written to the audit trail.
 */
router.get(`${P}/conversations/:id`, auth, needs('conversations.view'), safe(async (req, res) => {
  const technical = admin.can(req.admin.role, 'conversations.technical');
  const found = await conversations.thread(req.params.id, { technical });
  if (!found) return res.status(404).json({ error: 'not_found', message: 'No such conversation.' });
  if (technical) {
    await admin.audit({ adminId: req.admin.admin_id, action: 'view_conversation_technical',
      subject: `customer:${req.params.id}`, ip: (req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim() });
  }
  res.set('Cache-Control', 'no-store').json({ ok: true, ...found });
}));

/* ────────────────────────────────────────────────────────────── reports ── */

const REPORT_KINDS = ['daily', 'weekly', 'monthly', 'custom'];

function reportPeriod(q) {
  const kind = REPORT_KINDS.includes(String(q.kind)) ? String(q.kind) : 'daily';
  return reports.periodFor(kind, { date: q.date, from: q.from, to: q.to });
}

/* The figures, for the screen. Not registered: looking is not issuing. */
router.get(`${P}/reports`, auth, needs('reports.view'), safe(async (req, res) => {
  res.set('Cache-Control', 'no-store').json({ ok: true, ...money(req, 'report', await reports.build(reportPeriod(req.query))) });
}));

/*
 * A downloadable report: PDF, Excel workbook or CSV.
 *
 * Each one is registered before it is sent, and the Report ID printed on it is
 * the row's number — so a report quoted weeks later can be traced to its
 * period, its author, its moment and a fingerprint of its figures. The
 * download itself is written to the audit trail.
 */
router.get(`${P}/reports/download`, auth, needs('reports.view'), safe(async (req, res) => {
  /* An issued report is a financial document too: its collections, GST and
     split cannot be cut out of a registered, fingerprinted file. */
  if (!seesMoney(req)) {
    return res.status(403).json({ error: 'not_allowed',
      message: 'Issued reports include revenue and GST, so downloading them needs finance access. The figures on screen are yours to use.' });
  }
  const format = ['pdf', 'xlsx', 'csv'].includes(String(req.query.format)) ? String(req.query.format) : 'pdf';
  const report = await reports.build(reportPeriod(req.query));
  const { reportNo, generatedAt } = await reports.register({
    report, format, adminId: req.admin.admin_id,
  });
  const by = req.admin.name;
  const base = `Pravesha-${report.period.kind}-report-${report.period.from}${report.period.to !== report.period.from ? `-to-${report.period.to}` : ''}-${reportNo}`;

  let body;
  let type;
  if (format === 'pdf') {
    const s = Object.fromEntries(await settingsStore.all());
    body = await reportPdf.render(report, { reportNo, generatedAt, generatedBy: by, settings: s });
    type = 'application/pdf';
  } else if (format === 'xlsx') {
    body = Buffer.from(await reportWorkbook.workbook(report, { reportNo, generatedAt, generatedBy: by }));
    type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  } else {
    body = Buffer.from(reports.csv(report, { reportNo, generatedAt }), 'utf8');
    type = 'text/csv; charset=utf-8';
  }

  await reports.finishRegistration(reportNo, body.length);
  await admin.audit({ adminId: req.admin.admin_id, action: 'report_downloaded', subject: reportNo,
    detail: { kind: report.period.kind, from: report.period.from, to: report.period.to, format } });

  res.set({
    'Content-Type': type,
    'Content-Disposition': `${req.query.inline === '1' ? 'inline' : 'attachment'}; filename="${base}.${format}"`,
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Report-No': reportNo,
    'Access-Control-Expose-Headers': 'X-Report-No, Content-Disposition',
  });
  res.send(body);
}));

/* The register of reports issued, newest first. */
router.get(`${P}/reports/history`, auth, needs('reports.view'), safe(async (req, res) => {
  const { rows } = await require('../gatepass/db').query(
    `SELECT r.report_no, r.kind, r.period_from, r.period_to, r.format, r.generated_at, r.bytes, a.name AS generated_by
       FROM admin_reports r LEFT JOIN admin_users a ON a.id = r.generated_by
      ORDER BY r.generated_at DESC LIMIT 20`);
  res.json({ ok: true, reports: rows.map((r) => ({
    reportNo: r.report_no, kind: r.kind,
    from: r.period_from instanceof Date ? r.period_from.toISOString().slice(0, 10) : r.period_from,
    to: r.period_to instanceof Date ? r.period_to.toISOString().slice(0, 10) : r.period_to,
    format: r.format, generatedAt: r.generated_at, bytes: r.bytes, generatedBy: r.generated_by,
  })) });
}));

/* ──────────────────────────────────────────────────── negative tracking ── */

const ipOf = (req) => (req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim();

/* Today against yesterday at this hour, the suspects, and abuse patterns. */
router.get(`${P}/negative`, auth, needs('negative.view'), safe(async (req, res) => {
  res.set('Cache-Control', 'no-store').json({ ok: true, ...(await negative.overview()) });
}));

/* The event feed: filterable by category, dates and a search, paged by cursor. */
router.get(`${P}/negative/events`, auth, needs('negative.view'), safe(async (req, res) => {
  const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
  const category = Object.keys(negative.CATEGORY).includes(String(req.query.category)) ? String(req.query.category) : null;
  res.set('Cache-Control', 'no-store').json({
    ok: true,
    ...(await negative.events({
      category, q: req.query.q || null, from: date(req.query.from), to: date(req.query.to),
      before: req.query.before || null, limit: req.query.limit,
    })),
  });
}));

router.get(`${P}/negative/vehicle/:regNo`, auth, needs('negative.view'), safe(async (req, res) => {
  const found = await negative.vehicleProfile(req.params.regNo);
  if (!found) return res.status(404).json({ error: 'not_found', message: 'No activity recorded for that vehicle.' });
  res.json({ ok: true, ...found });
}));

router.get(`${P}/negative/visitor/:id`, auth, needs('negative.view'), safe(async (req, res) => {
  const found = await negative.visitorProfile(req.params.id);
  if (!found) return res.status(404).json({ error: 'not_found', message: 'No such visitor.' });
  res.json({ ok: true, ...found });
}));

/* A decision about something: reviewed, dismissed, escalated, or a note. */
router.post(`${P}/negative/review`, json, auth, needs('negative.act'), safe(async (req, res) => {
  const { subjectType, subjectId, action, note } = req.body || {};
  if (!['scan', 'payment', 'ticket', 'vehicle', 'customer'].includes(subjectType) || !subjectId) {
    return res.status(400).json({ error: 'bad_subject', message: 'Choose what is being reviewed.' });
  }
  if (!['reviewed', 'dismissed', 'escalated', 'note'].includes(action)) {
    return res.status(400).json({ error: 'bad_action', message: 'Choose reviewed, dismissed, escalated or note.' });
  }
  if (action === 'note' && !String(note || '').trim()) {
    return res.status(400).json({ error: 'note_required', message: 'Write the note first.' });
  }
  const row = await negative.review({ subjectType, subjectId, action, note, adminId: req.admin.admin_id });
  await admin.audit({ adminId: req.admin.admin_id, action: `negative_${action}`, subject: `${subjectType}:${subjectId}`,
    detail: { note: note || null }, ip: ipOf(req) });
  res.json({ ok: true, id: String(row.id), at: row.created_at });
}));

/*
 * Block or unblock a visitor. A reason is required to block: a number stopped
 * from booking with no reason on record is indistinguishable from a mistake.
 */
router.post(`${P}/negative/visitor/:id/block`, json, auth, needs('visitors.block'), safe(async (req, res) => {
  const blocked = req.body?.blocked !== false;
  const reason = String(req.body?.reason || '').trim();
  if (blocked && reason.length < 5) {
    return res.status(400).json({ error: 'reason_required', message: 'Give a reason for blocking this number.' });
  }
  const c = await negative.setBlocked({ customerId: req.params.id, blocked, reason, adminId: req.admin.admin_id });
  if (!c) return res.status(404).json({ error: 'not_found', message: 'No such visitor.' });
  await admin.audit({ adminId: req.admin.admin_id, action: blocked ? 'visitor_blocked' : 'visitor_unblocked',
    subject: `customer:${req.params.id}`, detail: { reason: reason || null }, ip: ipOf(req) });
  res.json({ ok: true, blocked: c.is_blocked, reason: c.blocked_reason });
}));

module.exports = { router, auth, needs, me };
