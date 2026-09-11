/**
 * settings.js — the numbers and names that get argued about, read from the table.
 *
 * Fee percentages, GST, the hold length, the legal name on a PDF: each of these
 * is a business decision that will change, and each change should be an UPDATE
 * rather than a deploy. Cached briefly so a booking does not cost a query per
 * setting.
 */

const { query } = require('./db');

const TTL_MS = 60_000;
let cache = { at: 0, map: new Map() };

async function all() {
  if (Date.now() - cache.at < TTL_MS) return cache.map;
  const r = await query('SELECT key, value FROM app_settings');
  cache = { at: Date.now(), map: new Map(r.rows.map((x) => [x.key, x.value])) };
  return cache.map;
}

async function str(key, fallback = null) {
  const v = (await all()).get(key);
  return v === undefined || v === null || v === '' ? fallback : String(v);
}

async function num(key, fallback = null) {
  const n = Number((await all()).get(key));
  return Number.isFinite(n) ? n : fallback;
}

module.exports = { str, num, all };
