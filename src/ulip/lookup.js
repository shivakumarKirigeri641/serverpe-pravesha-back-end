/**
 * ulip/lookup.js — vehicle data straight from ULIP, in the gateway's shapes.
 *
 * Pravesha used to ask the GaadiPe gateway (api.gaadipe.in) for every vehicle,
 * because ULIP only answers a whitelisted server and that server was GaadiPe's.
 * This is the same work done in this process, for when Pravesha runs on its
 * own whitelisted server: the ULIP modules are ported unchanged from the
 * gateway, and the responses here are the bodies the gateway's
 * /api/v1/vehicle/:regNo/{rc,challans,fastag} endpoints return, so vehicle.js
 * handles both sources with one code path.
 *
 *   { success: true,  vehicle_number, source, cached, age_minutes, rc | fastag | challans … }
 *   { success: false, error: 'invalid_registration_number' | 'vehicle_not_found'
 *                          | 'upstream_unavailable', vehicle_number, message }
 *
 * THE PLATE IS VALIDATED BEFORE ANY CALL. A plate that cannot be a registration
 * — a state code that does not exist, a length ULIP would reject — is answered
 * here without spending a ULIP call, with a message a person can act on.
 */

const plate = require('./plate');
const cache = require('./cache');
const { config } = require('./config');
const vahan = require('./vahan');
const echallan = require('./echallan');
const fastag = require('./fastag');

const TTL = {
  rc: () => config.cache.rcMinutes,
  challan: () => config.cache.challanMinutes,
  fastag: () => config.cache.fastagMinutes,
};

/* WhatsApp bold markers are stripped: these messages are shown on the web form
   and in the chat alike, and a web page showing *KA* is worse than plain KA. */
const plain = (s) => String(s || '').replace(/\*/g, '');

/** One dataset, cache first. Mirrors the gateway's load(). */
async function load(kind, regNo) {
  const key = `${kind}:${regNo}`;
  const hit = cache.get(key);
  if (hit) {
    if (hit.value.notFound) return { notFound: true, cached: true, age_minutes: cache.ageMinutes(hit), calls: [] };
    return { ...hit.value, cached: true, age_minutes: cache.ageMinutes(hit), calls: [] };
  }

  const fn = kind === 'rc' ? vahan.fetchRc : kind === 'challan' ? echallan.fetchChallans : fastag.fetchFastag;
  const r = await fn(regNo);

  if (r.ok) {
    const value = { data: r.data, source: r.source || null };
    cache.set(key, value, TTL[kind]());
    return { ...value, cached: false, age_minutes: 0, calls: r.calls };
  }
  if (r.notFound) {
    cache.set(key, { notFound: true }, config.cache.notFoundMinutes);
    return { notFound: true, cached: false, calls: r.calls, error: r.error };
  }
  return { failed: true, calls: r.calls, code: r.code, error: r.error };
}

function parsePlate(input) {
  const p = plate.parse(input);
  if (!p.ok) {
    return { bad: { success: false, error: 'invalid_registration_number', vehicle_number: p.regNo, message: plain(p.error) } };
  }
  return { regNo: p.regNo };
}

const failure = (regNo, r) => ({
  success: false,
  error: 'upstream_unavailable',
  vehicle_number: regNo,
  message: r.error || 'Vehicle records are temporarily unavailable. Please try again in a few minutes.',
  calls: r.calls,
});

async function rc(input) {
  const { bad, regNo } = parsePlate(input);
  if (bad) return bad;
  const started = Date.now();
  const r = await load('rc', regNo);
  if (r.notFound) {
    return { success: false, error: 'vehicle_not_found', vehicle_number: regNo,
      message: 'No Government record found for this registration number.' };
  }
  if (r.failed) return failure(regNo, r);
  return {
    success: true, vehicle_number: regNo, source: r.source, cached: r.cached, age_minutes: r.age_minutes,
    latency_ms: Date.now() - started, rc: r.data, calls: r.calls, ulip_calls_made: (r.calls || []).length,
  };
}

async function challans(input) {
  const { bad, regNo } = parsePlate(input);
  if (bad) return bad;
  const started = Date.now();
  const r = await load('challan', regNo);
  if (r.failed) return failure(regNo, r);
  const d = r.data || {};
  return {
    success: true, vehicle_number: regNo, cached: r.cached, age_minutes: r.age_minutes,
    latency_ms: Date.now() - started,
    summary: d.summary || null,
    pending_count: d.pending_count || 0,
    disposed_count: d.disposed_count || 0,
    pending_amount_paise: d.pending_amount_paise || 0,
    challans: d.pending || [],
    calls: r.calls, ulip_calls_made: (r.calls || []).length,
  };
}

async function fastagLookup(input) {
  const { bad, regNo } = parsePlate(input);
  if (bad) return bad;
  const started = Date.now();
  const r = await load('fastag', regNo);
  if (r.failed) return failure(regNo, r);
  return {
    success: true, vehicle_number: regNo, source: r.source, cached: r.cached, age_minutes: r.age_minutes,
    latency_ms: Date.now() - started, fastag: r.data, calls: r.calls, ulip_calls_made: (r.calls || []).length,
  };
}

/** The three by the dataset names vehicle.js asks for. */
const byDataset = { rc, challans, fastag: fastagLookup };

module.exports = { rc, challans, fastag: fastagLookup, byDataset, parsePlate };
