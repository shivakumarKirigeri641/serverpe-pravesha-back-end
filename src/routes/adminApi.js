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

module.exports = { router, auth, needs, me };
