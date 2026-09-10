/**
 * customers.js — a customer is a mobile number.
 *
 * There is no signup and no password. WhatsApp already proved the number by
 * delivering the message, and a hill station ticket needs no more identity than
 * that. Anything else would be a form standing between a visitor and a ticket.
 */

const { query, one } = require('./db');
const settings = require('./settings');

/**
 * Find or create the person behind a number.
 *
 * is_internal comes from a setting rather than a hand-edited row, so our own
 * constant testing stays out of the department's visitor counts and survives a
 * database rebuild.
 */
async function upsert(mobile, { name, waId } = {}) {
  const internal = String(await settings.get('internal_mobiles', ''))
    .split(',').map((s) => s.trim()).filter(Boolean)
    .includes(String(mobile));

  const r = await query(
    `INSERT INTO customers (mobile, wa_profile_name, wa_id, is_internal)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (mobile) DO UPDATE SET
        last_seen_at    = now(),
        modified_at     = now(),
        wa_profile_name = COALESCE(EXCLUDED.wa_profile_name, customers.wa_profile_name),
        wa_id           = COALESCE(EXCLUDED.wa_id, customers.wa_id),
        is_internal     = EXCLUDED.is_internal
     RETURNING *`,
    [mobile, name || null, waId || null, internal]);
  return r.rows[0];
}

const byMobile = (mobile) => one('SELECT * FROM customers WHERE mobile = $1', [mobile]);

/** Anything worth being able to answer later: consents, bookings, scans. */
async function logEvent(customerId, kind, detail = {}) {
  await query(
    `INSERT INTO event_log (customer_id, kind, detail) VALUES ($1, $2, $3)`,
    [customerId || null, kind, JSON.stringify(detail)]);
}

module.exports = { upsert, byMobile, logEvent };
