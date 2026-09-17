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

/*
 * ONE ULIP FETCH PER PLATE AT A TIME (2026-09-17). A slow record — a bus with
 * hundreds of challans — is still being fetched when the same plate is asked
 * for again: the panel's background poll, a retried booking. Each would start a
 * second, paid fetch of the same record. They now wait on the one already
 * running and share its answer.
 */
const inflight = new Map();

/** One dataset, cache first. Mirrors the gateway's load(). */
async function load(kind, regNo) {
  const key = `${kind}:${regNo}`;
  const hit = cache.get(key);
  if (hit) {
    if (hit.value.notFound) return { notFound: true, cached: true, age_minutes: cache.ageMinutes(hit), calls: [] };
    return { ...hit.value, cached: true, age_minutes: cache.ageMinutes(hit), calls: [] };
  }
  if (inflight.has(key)) {
    const shared = await inflight.get(key);
    return { ...shared, calls: [] };
  }
  const running = fetchInto(kind, regNo, key);
  inflight.set(key, running);
  try {
    return await running;
  } finally {
    inflight.delete(key);
  }
}

async function fetchInto(kind, regNo, key) {
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

/*
 * Paged exactly as the gateway's /challans is (2026-09-17): pending by default,
 * 50 a page, at most 200, with total, pages and has_more — so the panel's list
 * and every caller read one shape whichever source answered.
 */
const PER_PAGE = 50;
const MAX_PER_PAGE = 200;

async function challans(input, query = {}) {
  const { bad, regNo } = parsePlate(input);
  if (bad) return bad;
  const started = Date.now();
  const r = await load('challan', regNo);
  if (r.notFound) {
    return { success: false, error: 'vehicle_not_found', vehicle_number: regNo,
      message: 'No Government record found for this registration number.' };
  }
  if (r.failed) return failure(regNo, r);
  const d = r.data || {};

  const status = ['pending', 'disposed', 'all'].includes(String(query.status)) ? String(query.status) : 'pending';
  const perPage = Math.min(MAX_PER_PAGE, Math.max(1, parseInt(query.per_page, 10) || PER_PAGE));
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const rows = status === 'all' ? [...(d.pending || []), ...(d.disposed || [])] : (d[status] || []);
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / perPage));

  return {
    success: true, vehicle_number: regNo, cached: r.cached, age_minutes: r.age_minutes,
    latency_ms: Date.now() - started,
    status, page, per_page: perPage, total, pages, has_more: page < pages,
    summary: d.summary || null,
    pending_count: d.pending_count || 0,
    disposed_count: d.disposed_count || 0,
    pending_amount_paise: d.pending_amount_paise || 0,
    challans: rows.slice((page - 1) * perPage, (page - 1) * perPage + perPage),
    calls: r.calls, ulip_calls_made: (r.calls || []).length,
  };
}

async function fastagLookup(input) {
  const { bad, regNo } = parsePlate(input);
  if (bad) return bad;
  const started = Date.now();
  const r = await load('fastag', regNo);
  if (r.notFound) {
    return { success: false, error: 'vehicle_not_found', vehicle_number: regNo,
      message: 'No Government record found for this registration number.' };
  }
  if (r.failed) return failure(regNo, r);
  return {
    success: true, vehicle_number: regNo, source: r.source, cached: r.cached, age_minutes: r.age_minutes,
    latency_ms: Date.now() - started, fastag: r.data, calls: r.calls, ulip_calls_made: (r.calls || []).length,
  };
}

/** The three by the dataset names vehicle.js asks for, each taking (regNo, query). */
const byDataset = { rc: (regNo) => rc(regNo), challans, fastag: (regNo) => fastagLookup(regNo) };

/* The status code the gateway would have answered with, so a caller reading
   status behaves the same whichever source answered. */
const STATUS = { invalid_registration_number: 400, vehicle_not_found: 404, upstream_unavailable: 503 };
const statusOf = (body) => (body && body.success ? 200 : STATUS[body && body.error] || 500);

module.exports = { rc, challans, fastag: fastagLookup, byDataset, parsePlate, statusOf };
