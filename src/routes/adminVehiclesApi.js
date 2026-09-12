/**
 * adminVehiclesApi.js — the vehicle register.
 *
 * Reading it needs vehicles.view, which every role that may already open a pass
 * has: the vehicle on a pass is not a more sensitive fact than the pass itself.
 *
 * MONEY IS STRIPPED FOR ANYBODY WITHOUT finance.view, here as everywhere else.
 * It is done on the way out rather than by asking the database for less, because
 * a screen that forgets to ask is a screen that leaks — this way the only way to
 * see a rupee is to be allowed to.
 *
 * Nothing here changes anything. Barring a vehicle, correcting a type and the
 * rest live where those decisions already live, with their reasons and their
 * audit rows; a register that quietly became an editing screen would be a way to
 * change the record without leaving a trace of who did it.
 */

const express = require('express');
const { auth, needs } = require('./adminApi');
const admin = require('../gatepass/admin');
const vehicles = require('../gatepass/adminVehicles');

const router = express.Router();
const P = '/admin/api/vehicles';

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    console.error('[vehiclesApi] %s %s: %s', req.method, req.path, e.stack || e.message);
    res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
  }
};

/* Recursively drop the money from whatever shape it is in. */
function stripMoney(value) {
  if (Array.isArray(value)) return value.map(stripMoney);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (vehicles.MONEY_KEYS.includes(k)) continue;
      out[k] = stripMoney(v);
    }
    return out;
  }
  return value;
}

const shown = (req, body) => (admin.can(req.admin.role, 'finance.view') ? body : { ...stripMoney(body), moneyHidden: true });

router.get(P, auth, needs('vehicles.view'), handle(async (req, res) => {
  const out = await vehicles.list({
    q: req.query.q,
    kind: req.query.kind,
    type: req.query.type,
    from: req.query.from,
    to: req.query.to,
    sort: req.query.sort,
    limit: req.query.limit,
    offset: req.query.offset,
  });
  res.set('Cache-Control', 'no-store').json({ ok: true, ...shown(req, out) });
}));

router.get(`${P}/:regNo`, auth, needs('vehicles.view'), handle(async (req, res) => {
  const out = await vehicles.detail(req.params.regNo);
  if (!out) return res.status(404).json({ error: 'not_found', message: 'No vehicle with that number has ever been here.' });
  res.set('Cache-Control', 'no-store').json({ ok: true, ...shown(req, out) });
}));

module.exports = router;
