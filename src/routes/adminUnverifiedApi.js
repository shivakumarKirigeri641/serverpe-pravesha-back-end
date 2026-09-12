/**
 * adminUnverifiedApi.js — vehicles the register could not vouch for.
 *
 * Read by anyone who may watch the gates; asking the register again is a
 * look-up that costs money, so it needs the permission that manages vehicles
 * and is audited with what changed.
 */

const express = require('express');
const { auth, needs } = require('./adminApi');
const admin = require('../gatepass/admin');
const unverified = require('../gatepass/adminUnverified');
const slotTime = require('../gatepass/slotTime');

const router = express.Router();
const P = '/admin/api/unverified';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ipOf = (req) => (req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim();

const safe = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    console.error('[unverifiedApi] %s %s: %s', req.method, req.path, e.stack || e.message);
    res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
  }
};

/** The period, defaulting to the last thirty days. */
const period = (q) => {
  const today = slotTime.nowIST().date;
  const [y, m, d] = today.split('-').map(Number);
  const monthAgo = new Date(Date.UTC(y, m - 1, d - 29)).toISOString().slice(0, 10);
  return {
    from: DATE.test(String(q.from || '')) ? q.from : monthAgo,
    to: DATE.test(String(q.to || '')) ? q.to : today,
    today,
  };
};

router.get(P, auth, needs('unverified.view'), safe(async (req, res) => {
  const range = period(req.query);
  const [overview, list] = await Promise.all([
    unverified.overview(range),
    unverified.list({ q: req.query.q, kind: req.query.kind, from: range.from, to: range.to, limit: req.query.limit, offset: req.query.offset }),
  ]);
  res.set('Cache-Control', 'no-store').json({ ok: true, period: range, ...overview, ...list });
}));

router.post(`${P}/recheck`, express.json(), auth, needs('destinations.manage'), safe(async (req, res) => {
  const regNo = String(req.body?.regNo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!regNo) return res.status(400).json({ error: 'invalid', message: 'Which vehicle?' });
  const out = await unverified.recheck({ regNo });
  if (out.ok) {
    await admin.audit({
      adminId: req.admin.admin_id, action: 'vehicle_rechecked', subject: `vehicle:${regNo}`,
      before: { identifiedBy: 'declared', type: out.was || null },
      after: { verified: Boolean(out.verified), type: out.now || null },
      reason: req.body?.reason || null, ip: ipOf(req), sessionId: req.admin.session_id,
    });
  }
  res.status(out.ok ? 200 : 400).json(out);
}));

module.exports = router;
