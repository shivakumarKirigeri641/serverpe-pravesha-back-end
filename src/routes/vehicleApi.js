/**
 * vehicleApi.js — Pravesha's own vehicle-lookup gateway.
 *
 * ULIP authorises by source IP, and the address it has whitelisted is the
 * deployed server's. A laptop cannot call ULIP at all. So the deployed server
 * offers the lookup over HTTP and a development machine asks it instead:
 *
 *   laptop (VEHICLE_SOURCE=gateway, GATEWAY_BASE_URL=https://api.pravesha.in)
 *      -> GET /api/v1/vehicle/:regNo/:dataset   (this file, on the server)
 *      -> src/ulip                              (ULIP, from the whitelisted IP)
 *
 * The path and the response bodies are exactly what vehicle.js already expects
 * from the GaadiPe gateway it replaces, so nothing downstream changes — only
 * GATEWAY_BASE_URL does. On the server itself VEHICLE_SOURCE=ulip, so the
 * booking calls src/ulip directly and never comes through here.
 *
 * WHO MAY ASK. Every call costs a paid ULIP call and returns a real person's
 * vehicle record, so the endpoint is closed unless VEHICLE_LOOKUP_KEY is set,
 * and every request must carry it. A wrong or missing key is answered 401
 * without touching ULIP.
 *
 * IT REFUSES TO FORWARD. If this process is not itself the ULIP source
 * (VEHICLE_SOURCE is not 'ulip'), it answers 503 rather than proxying onward to
 * whatever GATEWAY_BASE_URL points at — that would be a laptop asking a laptop,
 * or, worse, a loop back into itself.
 */

const express = require('express');
const { config } = require('../ulip/config');
const lookup = require('../ulip/lookup');

const router = express.Router();

const DATASETS = new Set(['rc', 'challans', 'fastag']);

/* Timing-safe enough for a shared secret compared as whole strings: the
   comparison is on equal-length buffers or it fails on length alone. */
function keyMatches(given) {
  const want = process.env.VEHICLE_LOOKUP_KEY || '';
  if (!want || !given || given.length !== want.length) return false;
  const crypto = require('crypto');
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(want));
}

router.get('/api/v1/vehicle/:regNo/:dataset', async (req, res) => {
  const { regNo, dataset } = req.params;

  if (!process.env.VEHICLE_LOOKUP_KEY) {
    return res.status(503).json({ success: false, error: 'lookup_disabled',
      message: 'Vehicle lookup is not enabled on this server.' });
  }
  const given = req.get('x-api-key') || (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!keyMatches(given)) {
    return res.status(401).json({ success: false, error: 'unauthorised' });
  }
  if (!DATASETS.has(dataset)) {
    return res.status(404).json({ success: false, error: 'unknown_dataset',
      message: `Dataset must be one of ${[...DATASETS].join(', ')}.` });
  }
  if (config.source() !== 'ulip') {
    return res.status(503).json({ success: false, error: 'not_a_ulip_source',
      message: 'This server is not configured to call ULIP (VEHICLE_SOURCE is not "ulip").' });
  }

  const started = Date.now();
  try {
    /* The gateway's query, all of it (2026-09-17): refresh=1 forgets the cached
       record first, and challans take page, per_page and status. The plate is
       parsed here the same way lookup parses it, so the cache key matches. */
    if (String(req.query.refresh || '') === '1') {
      const parsed = require('../ulip/plate').parse(regNo);
      if (parsed.ok) require('../ulip/cache').drop(`${dataset === 'challans' ? 'challan' : dataset}:${parsed.regNo}`);
    }
    const body = await lookup.byDataset[dataset](regNo, req.query || {});
    console.log('[vehicleApi] %s %s -> %s in %dms', dataset, regNo,
      body.success ? 'ok' : body.error, Date.now() - started);
    /* The gateway's status codes — 400 bad plate, 404 no record, 503 ULIP down —
       with the same body; vehicle.js reads the body either way. */
    return res.status(lookup.statusOf(body)).json(body);
  } catch (e) {
    console.error('[vehicleApi] %s %s failed: %s', dataset, regNo, e.message);
    return res.status(502).json({ success: false, error: 'upstream_unavailable',
      vehicle_number: regNo,
      message: 'Vehicle records are temporarily unavailable. Please try again in a few minutes.' });
  }
});

module.exports = router;
