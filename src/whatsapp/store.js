/**
 * whatsapp/store.js — where a conversation is, and what it is carrying.
 *
 * A WhatsApp bot has no page and no back button. The only memory of what is
 * happening is this row: a state name, and a small bag of context — the plate
 * being booked, the date chosen, the ticket awaiting payment.
 *
 * Context is deliberately small and always re-validated before use. A person
 * can leave mid-booking and come back three days later; a price or a capacity
 * held in that bag would be stale, so the bag holds identifiers and the
 * database holds the truth.
 */

const db = require('../gatepass/db');

/** Find or create the conversation, recording that they just spoke to us. */
async function touchInbound(mobile, { waId, profileName, customerId } = {}) {
  const r = await db.query(
    `INSERT INTO wa_sessions (mobile, wa_id, profile_name, customer_id, last_inbound_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (mobile) DO UPDATE SET
        last_inbound_at = now(),
        modified_at     = now(),
        wa_id           = COALESCE(EXCLUDED.wa_id, wa_sessions.wa_id),
        profile_name    = COALESCE(EXCLUDED.profile_name, wa_sessions.profile_name),
        customer_id     = COALESCE(EXCLUDED.customer_id, wa_sessions.customer_id)
     RETURNING *`,
    [mobile, waId || null, profileName || null, customerId || null]);
  return r.rows[0];
}

const get = (mobile) => db.one('SELECT * FROM wa_sessions WHERE mobile = $1', [mobile]);

/**
 * Move to a new state, merging into the context bag.
 *
 * Merging rather than replacing means a handler can add the date it just
 * learned without having to remember and rewrite the plate it was given two
 * messages ago.
 */
async function setState(mobile, state, patch = {}, reason = null) {
  const r = await db.query(
    `UPDATE wa_sessions
        SET state = $2, state_reason = $3,
            context = context || $4::jsonb,
            modified_at = now()
      WHERE mobile = $1
      RETURNING *`,
    [mobile, state, reason, JSON.stringify(patch)]);
  return r.rows[0];
}

/** Drop the bag — after a booking completes, or when someone starts over. */
async function reset(mobile, state = 'idle') {
  const r = await db.query(
    `UPDATE wa_sessions
        SET state = $2, state_reason = NULL, context = '{}'::jsonb, modified_at = now()
      WHERE mobile = $1
      RETURNING *`, [mobile, state]);
  return r.rows[0];
}

/** Record what arrived, before anything is done with it. */
async function logInbound({ mobile, sessionId, type, body, payload }) {
  try {
    await db.query(
      `INSERT INTO wa_messages (session_id, mobile, direction, message_type, body, payload)
       VALUES ($1, $2, 'in', $3, $4, $5)`,
      [sessionId || null, mobile, type || null, body || null, JSON.stringify(payload || {})]);
  } catch (e) {
    console.error('[wa] could not record inbound:', e.message);
  }
}

/**
 * Has this exact message already been handled?
 *
 * Meta retries a webhook it believes failed, and a retry that books a second
 * ticket is a real charge to a real person. The message id is unique per
 * message, so seeing it twice means the second one is a replay.
 */
async function alreadySeen(waMessageId) {
  if (!waMessageId) return false;
  const row = await db.one(
    `SELECT 1 FROM wa_messages WHERE wa_message_id = $1 AND direction = 'in' LIMIT 1`,
    [waMessageId]);
  return !!row;
}

async function markSeen(waMessageId, mobile) {
  if (!waMessageId) return;
  await db.query(
    `INSERT INTO wa_messages (mobile, direction, message_type, wa_message_id, body)
     VALUES ($1, 'in', 'receipt', $2, NULL)`,
    [mobile, waMessageId]);
}

module.exports = { touchInbound, get, setState, reset, logInbound, alreadySeen, markSeen };
