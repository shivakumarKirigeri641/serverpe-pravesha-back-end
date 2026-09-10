/**
 * settings.js — app_settings, cached briefly.
 *
 * Every one of these is something a department will want changed in a meeting:
 * the GST rate, how long a hold lasts, whether today can still be booked. They
 * live in the database so the admin panel can change them, and are cached for a
 * few seconds so a busy Sunday does not turn one booking into six queries.
 */

const { query } = require('./db');

const TTL_MS = 15000;
let cache = null;
let loadedAt = 0;

async function all() {
  if (cache && Date.now() - loadedAt < TTL_MS) return cache;
  const r = await query('SELECT key, value FROM app_settings');
  cache = Object.fromEntries(r.rows.map((x) => [x.key, x.value]));
  loadedAt = Date.now();
  return cache;
}

/** Force the next read to hit the database — call after an admin edit. */
function invalidate() { cache = null; }

async function get(key, fallback = null) {
  const s = await all();
  return s[key] !== undefined ? s[key] : fallback;
}

async function num(key, fallback) {
  const v = Number(await get(key, fallback));
  return Number.isFinite(v) ? v : fallback;
}

async function bool(key, fallback = false) {
  const v = await get(key, String(fallback));
  return String(v).toLowerCase() === 'true';
}

async function set(key, value, note = null) {
  await query(
    `INSERT INTO app_settings (key, value, note, modified_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (key) DO UPDATE SET value = $2, modified_at = now()`,
    [key, String(value), note]);
  invalidate();
}

module.exports = { all, get, num, bool, set, invalidate };
