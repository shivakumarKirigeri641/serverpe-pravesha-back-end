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

/*
 * CHECK A VEHICLE — RC, eChallans, FASTag (user, 2026-09-16).
 *
 * The super administrator's own checks, of any plate, with everything the
 * government record returns. One dataset per call, so each tab on the screen
 * can be asked for, and refreshed, on its own.
 *
 * ALWAYS FRESH, AND THE CACHES FOLLOW (user, 2026-09-16). Each check asks the
 * gateway for a fresh ULIP fetch (refresh=1) — ULIP answers only the whitelisted
 * server, so "direct" means through it — and the gateway stores the new answer.
 * Pravesha's own copy of the vehicle is then brought up to date too, so the next
 * booking, gate check or vehicle screen reads today's record, not last week's.
 * No visitor, pass or lookup-log row is written: a personal check is not a
 * booking. Who checked which plate, and when, goes to the audit trail — each is
 * a paid lookup of somebody's government record.
 *
 * Later pages of a challan list are read from the cache the first page has just
 * refreshed, rather than fetching all of it from ULIP again for every page.
 *
 * The plate is validated before anything is spent on it.
 */
const DATASETS = ['rc', 'challans', 'fastag'];
router.get('/admin/api/vehicle-check/:regNo/:dataset', auth, needs('vehicles.check'), handle(async (req, res) => {
  const dataset = String(req.params.dataset);
  if (!DATASETS.includes(dataset)) return res.status(400).json({ error: 'bad_dataset', message: 'Choose RC, eChallan or FASTag.' });
  const parsed = require('../ulip/plate').parse(req.params.regNo);
  if (!parsed.ok) {
    return res.status(400).json({ error: 'bad_plate', message: String(parsed.error || 'Check the vehicle number.').replace(/\*/g, '') });
  }
  const regNo = parsed.regNo;
  /* Challans come in pages; the first call is page 1, the screen asks for more. */
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const perPage = Math.min(100, Math.max(1, Number.parseInt(req.query.per_page, 10) || 100));
  const vehicle = require('../gatepass/vehicle');
  /*
   * SLOW RECORDS FINISH IN THE BACKGROUND (user, 2026-09-16). The first ask
   * waits up to 15 seconds. A vehicle with hundreds of challans can take ULIP
   * minutes; the gateway carries on after we stop waiting and caches the
   * answer, so the screen then polls with cached=1 — a cache read that never
   * starts another ULIP fetch — and fills in when the answer lands.
   */
  const cachedOnly = String(req.query.cached || '') === '1';
  const fresh = !cachedOnly && !(dataset === 'challans' && page > 1);
  const out = await vehicle.fetchDataset(regNo, dataset, {
    timeoutMs: cachedOnly ? 10000 : 15000,
    query: {
      ...(fresh ? { refresh: 1 } : {}),
      ...(dataset === 'challans' ? { page, per_page: perPage } : {}),
    },
  });
  const body = out.body || {};

  /* Pravesha's copy, the way a booking would have stored it. */
  let cacheUpdated = false;
  /* Page 1 of anything is the whole record's summary: keep Pravesha's copy of
     it current whether it came fresh or from a background fetch finishing. */
  if (body.success === true && page === 1) {
    try {
      if (dataset === 'rc' && body.rc) {
        const v = await vehicle.upsert(regNo, body.rc);
        await vehicle.saveSnapshot(v.id, body.rc, body.source, 'rc');
      } else {
        const row = await require('../gatepass/db').one('SELECT id FROM vehicles WHERE reg_no = $1', [regNo])
          || await vehicle.upsertBare(regNo);
        await vehicle.saveSnapshot(row.id, dataset === 'fastag' ? body.fastag : body, body.source || 'ulip', dataset);
      }
      cacheUpdated = true;
    } catch (e) {
      console.error('[vehicle-check] cache update for %s %s: %s', regNo, dataset, e.message);
    }
  }

  await admin.audit({
    adminId: req.admin.admin_id, action: 'vehicle_checked', subject: `vehicle:${regNo}`,
    detail: { dataset, page: dataset === 'challans' ? page : undefined, success: body.success === true, fresh, cacheUpdated, ms: out.ms },
    ip: (req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim(), sessionId: req.admin.session_id,
  });

  res.set('Cache-Control', 'no-store').json({
    ok: body.success === true, regNo, dataset, ms: out.ms, fresh, cacheUpdated,
    error: body.success === true ? null : (body.error || 'unavailable'),
    message: body.success === true ? null
      : body.error === 'gateway_timeout'
        /* The gateway keeps fetching after we stop waiting, and caches it. */
        ? 'The government record is taking long to fetch — a vehicle with many challans can. Try again in a minute; it will be ready.'
        : (body.message || 'The record could not be fetched just now.'),
    body,
  });
}));

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
