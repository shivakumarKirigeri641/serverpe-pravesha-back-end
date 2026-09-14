/**
 * adminWatchlistApi.js — putting plates on the watchlist, and taking them off.
 *
 * Reading the list needs vehicles.view: anybody who can open a vehicle can see
 * whether it is being watched. Changing it needs watchlist.manage, because a
 * blocked plate is a vehicle turned away at a barrier with a paid pass.
 *
 * Every change carries a reason and writes an audit row — the level and reason
 * before, the level and reason after.
 */

const express = require('express');
const { auth, needs } = require('./adminApi');
const admin = require('../gatepass/admin');
const watchlist = require('../gatepass/watchlist');

const router = express.Router();
const json = express.json({ limit: '16kb' });
const P = '/admin/api/watchlist';

const ipOf = (req) => (req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim();

const fail = (res, e) => {
  if (e instanceof watchlist.Refusal) return res.status(e.status).json({ error: e.code, message: e.message });
  console.error('[watchlistApi] %s', e.stack || e.message);
  return res.status(500).json({ error: 'server_error', message: 'Something went wrong. Nothing was changed.' });
};

router.get(P, auth, needs('vehicles.view'), async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store').json({ ok: true, ...(await watchlist.list({ removed: req.query.removed === '1' })) });
  } catch (e) { fail(res, e); }
});

router.get(`${P}/:regNo`, auth, needs('vehicles.view'), async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store').json({ ok: true, entry: await watchlist.levelFor(req.params.regNo) });
  } catch (e) { fail(res, e); }
});

router.post(P, json, auth, needs('watchlist.manage'), async (req, res) => {
  try {
    const { regNo, level, reason } = req.body || {};
    const out = await watchlist.add({ regNo, level, reason, adminId: req.admin.admin_id });
    await admin.audit({
      adminId: req.admin.admin_id,
      action: out.before ? 'watchlist_changed' : 'watchlist_added',
      subject: `vehicle:${out.entry.regNo}`,
      before: out.before ? { level: out.before.level, reason: out.before.reason } : null,
      after: { level: out.entry.level, reason: out.entry.reason },
      reason: out.entry.reason,
      ip: ipOf(req),
      sessionId: req.admin.session_id,
    });
    res.json({ ok: true, entry: out.entry, changed: Boolean(out.before) });
  } catch (e) { fail(res, e); }
});

router.post(`${P}/:regNo/remove`, json, auth, needs('watchlist.manage'), async (req, res) => {
  try {
    const out = await watchlist.remove({ regNo: req.params.regNo, reason: req.body?.reason, adminId: req.admin.admin_id });
    await admin.audit({
      adminId: req.admin.admin_id,
      action: 'watchlist_removed',
      subject: `vehicle:${out.entry.regNo}`,
      before: { level: out.entry.level, reason: out.entry.reason },
      after: null,
      reason: out.entry.removedReason,
      ip: ipOf(req),
      sessionId: req.admin.session_id,
    });
    res.json({ ok: true, entry: out.entry });
  } catch (e) { fail(res, e); }
});

module.exports = router;
