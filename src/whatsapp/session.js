/**
 * session.js — where a conversation has got to.
 *
 * One row per mobile number, holding a state name and a bag of context. The
 * booking is built up across several messages and the customer can stop
 * halfway, so the half-built booking has to live somewhere that survives both
 * the gap and a restart of this process.
 *
 * WHY NOT IN MEMORY. A conversation that resumes after lunch, or after a
 * deploy, must not start again from the beginning. Anything in memory loses
 * both.
 */

const { query, one } = require('../gatepass/db');

const START = 'idle';

async function get(mobile) {
  return one('SELECT * FROM wa_sessions WHERE mobile = $1', [mobile]);
}

async function touch({ mobile, customerId, waId, profileName }) {
  const r = await query(
    `INSERT INTO wa_sessions (mobile, customer_id, wa_id, profile_name, state, context, last_inbound_at)
     VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, now())
     ON CONFLICT (mobile) DO UPDATE SET
       customer_id    = COALESCE(EXCLUDED.customer_id, wa_sessions.customer_id),
       wa_id          = COALESCE(EXCLUDED.wa_id, wa_sessions.wa_id),
       profile_name   = COALESCE(EXCLUDED.profile_name, wa_sessions.profile_name),
       last_inbound_at = now(),
       modified_at    = now()
     RETURNING *`,
    [mobile, customerId || null, waId || null, profileName || null, START]);
  return r.rows[0];
}

/** Move to a new state, merging into context rather than replacing it. */
async function set(mobile, state, patch = {}, reason = null) {
  const r = await query(
    `UPDATE wa_sessions
        SET state = $2, state_reason = $3,
            context = context || $4::jsonb,
            modified_at = now()
      WHERE mobile = $1
      RETURNING *`,
    [mobile, state, reason, JSON.stringify(patch)]);
  return r.rows[0];
}

/** Back to the beginning, context discarded — for "cancel" and for a fresh "hi". */
async function reset(mobile, reason = null) {
  const r = await query(
    `UPDATE wa_sessions
        SET state = $2, state_reason = $3, context = '{}'::jsonb, modified_at = now()
      WHERE mobile = $1
      RETURNING *`,
    [mobile, START, reason]);
  return r.rows[0];
}

module.exports = { get, touch, set, reset, START };
