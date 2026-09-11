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

const me = (s) => ({
  id: String(s.admin_id),
  name: s.name,
  mobile: `••••${String(s.mobile).slice(-4)}`,
  role: s.role,
  /* The panel hides what it cannot use, and the routes refuse it regardless. */
  can: {
    operate: admin.can(s.role, 'operate'),
    configure: admin.can(s.role, 'configure'),
    manageStaff: admin.can(s.role, 'manage_staff'),
    readPersonal: admin.can(s.role, 'read_personal'),
  },
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

router.get(`${P}/session`, auth, safe(async (req, res) => res.json({ ok: true, ...me(req.admin) })));

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
router.get(`${P}/dashboard`, auth, safe(async (req, res) => {
  const asked = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? String(req.query.date) : null;
  const today = slotTime.nowIST().date;

  if (asked && asked > today) {
    return res.status(400).json({ error: 'future_date', today,
      message: 'The dashboard reports on today and earlier days only.' });
  }
  res.json({ ok: true, ...(await stats.dashboard({ date: asked })) });
}));

/*
 * Live monitoring. Polled every few seconds by a screen somebody is watching, so
 * it is one call rather than nine, it never caches, and it always reports now —
 * there is no date parameter, because "live" for a past day is a contradiction.
 */
router.get(`${P}/live`, auth, safe(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, ...(await liveStats.live()) });
}));

/*
 * Older pages of the activity feed.
 *
 * Cursor-paged rather than offset-paged: checks land while somebody is reading,
 * and an offset of 25 means something different each time one arrives — page two
 * would repeat rows page one already showed.
 */
router.get(`${P}/live/activity`, auth, safe(async (req, res) => {
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
router.get(`${P}/analytics`, auth, safe(async (req, res) => {
  const { from, to } = range(req);
  res.json({ ok: true, ...(await analytics.overview({ from, to })) });
}));

/* The visitor list: searchable by number, name or vehicle. */
router.get(`${P}/analytics/visitors`, auth, safe(async (req, res) => {
  const rows = await analytics.visitors({
    q: req.query.q || null,
    band: req.query.band || null,
    limit: req.query.limit,
    offset: req.query.offset,
  });
  res.json({ ok: true, visitors: rows, bands: await analytics.visitorBands() });
}));

/* One visitor's passes. */
router.get(`${P}/analytics/visitor/:id`, auth, safe(async (req, res) => {
  const found = await analytics.visitorVisits(req.params.id);
  if (!found) return res.status(404).json({ error: 'not_found', message: 'No such visitor.' });
  res.json({ ok: true, ...found });
}));

/* One vehicle, in full. */
router.get(`${P}/analytics/vehicle/:regNo`, auth, safe(async (req, res) => {
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
router.get(`${P}/analytics/compare`, auth, safe(async (req, res) => {
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
    ...(await analytics.compare(aFrom, aTo, bFrom, bTo)),
  });
}));

/* ──────────────────────────────────────────────────── conversations ── */

router.get(`${P}/conversations`, auth, safe(async (req, res) => {
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
router.get(`${P}/conversations/:id`, auth, safe(async (req, res) => {
  const technical = admin.can(req.admin.role, 'configure');
  const found = await conversations.thread(req.params.id, { technical });
  if (!found) return res.status(404).json({ error: 'not_found', message: 'No such conversation.' });
  if (technical) {
    await admin.audit({ adminId: req.admin.admin_id, action: 'view_conversation_technical',
      subject: `customer:${req.params.id}`, ip: (req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim() });
  }
  res.set('Cache-Control', 'no-store').json({ ok: true, ...found });
}));

module.exports = { router, auth, needs, me };
