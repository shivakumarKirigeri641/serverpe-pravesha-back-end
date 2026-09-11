/**
 * customers.js — who is on the other end of the conversation.
 *
 * The mobile number is the identity. WhatsApp gives us a profile name too,
 * which is what the person calls themselves and is good enough to greet them
 * by, but it is theirs to change at any time and is never treated as the name
 * on a booking.
 */

const { query, one } = require('./db');

/**
 * Find or create, and keep the profile name current.
 *
 * COALESCE on the way in, not overwrite: Meta omits the profile block on some
 * webhook deliveries, and a missing name must not blank a name we already had.
 */
async function touch({ mobile, waId, profileName }) {
  const r = await query(
    `INSERT INTO customers (mobile, wa_id, wa_profile_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (mobile) DO UPDATE SET
       wa_id           = COALESCE(EXCLUDED.wa_id, customers.wa_id),
       wa_profile_name = COALESCE(EXCLUDED.wa_profile_name, customers.wa_profile_name),
       last_seen_at    = now(),
       modified_at     = now()
     RETURNING *`,
    [mobile, waId || null, profileName || null]);
  return r.rows[0];
}

/** The name to greet someone by: what they gave us, else their WhatsApp name. */
const greetingName = (c) => (c?.name || c?.wa_profile_name || '').trim().split(/\s+/)[0] || null;

const byMobile = (mobile) => one('SELECT * FROM customers WHERE mobile = $1', [mobile]);

module.exports = { touch, byMobile, greetingName };
