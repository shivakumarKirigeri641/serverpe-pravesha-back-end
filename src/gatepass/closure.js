/**
 * closure.js — closing a day, and putting the people who booked it somewhere.
 *
 * A closure is one thing whether it is a flood at 6 a.m. or a maintenance day
 * planned three weeks out; only the notice differs. It does three jobs:
 *
 *   1. STOP SELLING for that date and slot.
 *   2. ASK EVERYONE WHO HOLDS A TICKET what they want — another date, or their
 *      money back.
 *   3. CARRY OUT whichever they choose.
 *
 * WHY POSTPONE COMES FIRST. Moving a ticket costs nothing. A refund burns the
 * payment gateway's fee — about Rs.2.60 on a Rs.110 ticket, which is Rs.1,000
 * across a full car park — and, once the entry fee has been settled to the
 * department, means paying back money we are no longer holding. So the offer
 * leads with a new date.
 *
 * WHY IT IS NOT POSTPONE-ONLY. Someone who cannot come another day is entitled
 * to their money, and a system that refuses that is one complaint away from the
 * DC's office. The refund is one tap behind the offer, not hidden.
 *
 * WHY THE OLD QR NEEDS NO REVOCATION. A postponed ticket is re-signed with its
 * new date. The old code still carries a valid signature — but it says the old
 * date, and the gate compares that against today, so it reads as 'wrong_day'.
 * The old ticket dies of natural causes, with nothing to distribute to the
 * phones.
 */

const { query, one, tx } = require('./db');
const inventory = require('./inventory');
const booking = require('./booking');
const checkout = require('./checkout');
const settings = require('./settings');
const sign = require('./sign');
const Razorpay = require('razorpay');

/* ───────────────────────────────────────────────────────────── the preview */

/**
 * What would happen, without doing any of it.
 *
 * A closure cannot be undone once the messages have gone out, so the admin
 * screen must be able to say "37 tickets, Rs.4,070, 37 people will be
 * messaged" BEFORE anything is committed. Everything here is read-only.
 */
async function preview({ placeId, travelDate, slotIds = null }) {
  const tickets = await affected({ placeId, travelDate, slotIds });

  const total = tickets.reduce((n, t) => n + t.total_paise, 0);
  const used = tickets.filter((t) => t.status === 'used').length;

  return {
    travel_date: travelDate,
    slots: slotIds,
    tickets_affected: tickets.length,
    already_used: used,
    amount_paise: total,
    vehicles: tickets.map((t) => t.reg_no),
    // Booking stops for these; nobody who has already been through the gate is
    // touched, because they got what they paid for.
    will_be_offered: tickets.length - used,
  };
}

/**
 * Tickets a closure would hit.
 *
 * 'used' tickets are listed so the preview can say how many people are already
 * up the hill, but they are never offered anything: the visit happened.
 */
async function affected({ placeId, travelDate, slotIds = null }) {
  const params = [placeId, travelDate];
  let slotClause = '';
  if (slotIds && slotIds.length) {
    params.push(slotIds);
    slotClause = 'AND t.slot_id = ANY($3::bigint[])';
  }
  const r = await query(
    `SELECT t.*, s.code AS slot_code, s.label AS slot_label, c.label AS category_label
       FROM tickets t
       JOIN place_slots s ON s.id = t.slot_id
       JOIN vehicle_categories c ON c.id = t.category_id
      WHERE t.place_id = $1 AND t.travel_date = $2
        AND t.status IN ('paid', 'used') ${slotClause}
      ORDER BY t.id`, params);
  return r.rows;
}

/* ──────────────────────────────────────────────────────────── closing down */

/**
 * Close a date (or one slot of it) and offer everyone a way out.
 *
 * Booking is stopped inside a transaction; the messages are sent afterwards,
 * outside it. That order matters: a WhatsApp API that is slow or down must not
 * hold a database transaction open, and must certainly not roll back a closure
 * the department has already announced on the radio.
 */
async function close({ placeId, travelDate, slotIds = null, reason, kind = 'other', adminId }) {
  const tickets = (await affected({ placeId, travelDate, slotIds }))
    .filter((t) => t.status === 'paid');

  const closure = await tx(async (client) => {
    // Rows may not exist yet for a date nobody has booked. Create them, so
    // closing a future date actually prevents the first sale.
    await inventory.ensureDate(client, placeId, travelDate);

    const params = [placeId, travelDate, reason];
    let slotClause = '';
    if (slotIds && slotIds.length) {
      params.push(slotIds);
      slotClause = 'AND slot_id = ANY($4::bigint[])';
    }
    await client.query(
      `UPDATE slot_inventory
          SET is_open = false, closed_note = $3, modified_at = now()
        WHERE place_id = $1 AND travel_date = $2 ${slotClause}`, params);

    // One closure row per place/date/slot; re-closing updates rather than
    // messaging everyone twice.
    const rows = [];
    for (const slotId of (slotIds && slotIds.length ? slotIds : [null])) {
      const r = await client.query(
        `INSERT INTO closures (place_id, travel_date, slot_id, reason, kind,
                               tickets_affected, amount_paise, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [placeId, travelDate, slotId, reason, kind,
         tickets.length, tickets.reduce((n, t) => n + t.total_paise, 0), adminId || null]);

      rows.push(r.rows[0] || await one(
        `SELECT * FROM closures
          WHERE place_id = $1 AND travel_date = $2
            AND slot_id IS NOT DISTINCT FROM $3 AND lifted_at IS NULL`,
        [placeId, travelDate, slotId]));
    }
    return rows[0];
  });

  // Mark the tickets as awaiting a decision. Until the customer chooses, the
  // ticket stays 'paid' — it is a real ticket for a day that will not happen,
  // and the gate would refuse it anyway because the day is closed.
  for (const t of tickets) {
    await query(
      `UPDATE tickets SET closure_id = $2, closure_outcome = 'offered', modified_at = now()
        WHERE id = $1 AND closure_outcome IS DISTINCT FROM 'postponed'`,
      [t.id, closure.id]);
  }

  await query(
    `INSERT INTO event_log (kind, detail) VALUES ('closure_created', $1)`,
    [JSON.stringify({ closure_id: closure.id, travel_date: travelDate, reason,
      slot_ids: slotIds, tickets: tickets.length, admin_id: adminId })]);

  return { closure, tickets };
}

/** Reopen booking. Nothing already refunded or moved is undone. */
async function lift({ closureId, adminId }) {
  const c = await one('SELECT * FROM closures WHERE id = $1', [closureId]);
  if (!c || c.lifted_at) return null;

  const params = [c.place_id, c.travel_date];
  let slotClause = '';
  if (c.slot_id) { params.push(c.slot_id); slotClause = 'AND slot_id = $3'; }

  await query(
    `UPDATE slot_inventory SET is_open = true, closed_note = NULL, modified_at = now()
      WHERE place_id = $1 AND travel_date = $2 ${slotClause}`, params);

  await query(
    `UPDATE closures SET lifted_at = now(), lifted_by = $2 WHERE id = $1`,
    [closureId, adminId || null]);

  await query(
    `INSERT INTO event_log (kind, detail) VALUES ('closure_lifted', $1)`,
    [JSON.stringify({ closure_id: closureId, admin_id: adminId })]);

  return true;
}

/* ────────────────────────────────────────────────────────────── postponing */

/**
 * Move a ticket to another date and slot.
 *
 * The order is: claim the new place, then release the old one. Never the
 * reverse — releasing first would let someone else take the customer's place
 * while we were mid-move, and leave them with nothing.
 *
 * Returns { ok, ticket } or { ok:false, reason }: 'sold_out', 'already_booked'
 * (the vehicle has a ticket on the new date already), 'too_many_moves',
 * 'closed'.
 */
async function postpone(ticketId, { travelDate, slotCode }) {
  const maxMoves = await settings.num('max_moves_per_ticket', 1);

  return tx(async (client) => {
    const t = (await client.query(
      `SELECT t.*, p.code AS place_code, c.code AS category_code
         FROM tickets t
         JOIN places p ON p.id = t.place_id
         JOIN vehicle_categories c ON c.id = t.category_id
        WHERE t.id = $1 FOR UPDATE OF t`, [ticketId])).rows[0];

    if (!t) return { ok: false, reason: 'not_found' };
    if (t.status === 'used') return { ok: false, reason: 'already_used' };
    if (t.status !== 'paid') return { ok: false, reason: 'not_paid' };
    if (t.move_count >= maxMoves) return { ok: false, reason: 'too_many_moves' };

    const slot = (await client.query(
      `SELECT * FROM place_slots WHERE place_id = $1 AND code = $2 AND is_active`,
      [t.place_id, slotCode])).rows[0];
    if (!slot) return { ok: false, reason: 'no_such_slot' };

    if (String(travelDate) === String(t.travel_date) && slot.id === t.slot_id) {
      return { ok: false, reason: 'same_day' };
    }

    // One vehicle, one ticket per date — still true when moving.
    const clash = (await client.query(
      `SELECT ticket_no FROM tickets
        WHERE vehicle_id = $1 AND travel_date = $2 AND id <> $3
          AND status IN ('held','paid','used')`,
      [t.vehicle_id, travelDate, t.id])).rows[0];
    if (clash) return { ok: false, reason: 'already_booked', ticket_no: clash.ticket_no };

    const claimed = await inventory.hold(client, {
      placeId: t.place_id, travelDate, slotId: slot.id, categoryId: t.category_id });
    if (!claimed) return { ok: false, reason: 'sold_out' };

    // The new place is ours; now let the old one go.
    await inventory.unbook(client, {
      placeId: t.place_id, travelDate: t.travel_date,
      slotId: t.slot_id, categoryId: t.category_id });
    // And turn the claim from a hold into a booking — this is a paid ticket.
    await inventory.confirm(client, {
      placeId: t.place_id, travelDate, slotId: slot.id, categoryId: t.category_id });

    // Re-signed for the new date. The old QR now reads 'wrong_day' at the gate,
    // which is exactly the invalidation we want and costs nothing.
    const qr = sign.signTicket({
      ticket_no: t.ticket_no, place_code: t.place_code, travel_date: travelDate,
      slot_code: slot.code, category_code: t.category_code, reg_no: t.reg_no });

    const moved = (await client.query(
      `UPDATE tickets
          SET travel_date = $2, slot_id = $3, qr_payload = $4,
              moved_from_date = travel_date, moved_from_slot_id = slot_id,
              moved_at = now(), move_count = move_count + 1,
              closure_outcome = CASE WHEN closure_id IS NOT NULL THEN 'postponed'
                                     ELSE closure_outcome END,
              modified_at = now()
        WHERE id = $1
        RETURNING *`, [t.id, travelDate, slot.id, qr])).rows[0];

    await client.query(
      `INSERT INTO event_log (customer_id, kind, detail) VALUES ($1, 'ticket_postponed', $2)`,
      [t.customer_id, JSON.stringify({
        ticket_no: t.ticket_no, from: t.travel_date, to: travelDate,
        slot: slot.code, closure_id: t.closure_id })]);

    if (t.closure_id) {
      await client.query(
        `UPDATE closures SET tickets_postponed = tickets_postponed + 1 WHERE id = $1`,
        [t.closure_id]);
    }

    return { ok: true, ticket: moved, slot };
  });
}

/* ─────────────────────────────────────────────────────────────── refunding */

let rzpClient = null;
function rzp() {
  if (!rzpClient) {
    const k = checkout.keys();
    rzpClient = new Razorpay({ key_id: k.id, key_secret: k.secret });
  }
  return rzpClient;
}

/**
 * Refund a ticket in full and cancel it.
 *
 * Full means the entry fee AND our booking fee. The visitor did nothing wrong;
 * keeping our fee because the hill flooded would be indefensible, and the
 * amount is too small to be worth the argument it would cause.
 *
 * Idempotent: a ticket already refunded returns its existing refund rather than
 * issuing a second one. This is money, so the guard is a condition on the
 * UPDATE, not a check in JavaScript.
 */
async function refund(ticketId, { reason = 'closure', adminId } = {}) {
  const t = await one(
    `SELECT t.*, p.payment_id AS gateway_payment_id, p.id AS payment_row_id,
            p.status AS payment_status, p.refund_id
       FROM tickets t
       LEFT JOIN payments p ON p.id = t.payment_id
      WHERE t.id = $1`, [ticketId]);

  if (!t) return { ok: false, reason: 'not_found' };
  if (t.status === 'used') return { ok: false, reason: 'already_used' };
  if (t.status === 'cancelled' && t.refund_id) {
    return { ok: true, already: true, refund_id: t.refund_id };
  }
  if (!t.gateway_payment_id) {
    // Nothing was ever captured — a comped or test ticket. Cancel it and give
    // the place back, but do not pretend a refund happened.
    await cancelWithoutRefund(t, reason, adminId);
    return { ok: true, no_payment: true };
  }

  let refundRow;
  try {
    refundRow = await rzp().payments.refund(t.gateway_payment_id, {
      amount: t.total_paise,
      speed: 'normal',
      notes: { ticket_no: t.ticket_no, reason },
      // Razorpay rejects a second refund carrying the same key, which is what
      // makes a double-tap on the admin screen harmless.
      receipt: `rf-${t.ticket_no}`,
    });
  } catch (e) {
    console.error('[refund] %s failed: %s', t.ticket_no, e.message);
    await query(
      `INSERT INTO event_log (customer_id, kind, detail) VALUES ($1, 'refund_failed', $2)`,
      [t.customer_id, JSON.stringify({ ticket_no: t.ticket_no, error: e.message })]);
    return { ok: false, reason: 'gateway_error', message: e.message };
  }

  await tx(async (client) => {
    await client.query(
      `UPDATE payments SET status = 'refunded', refund_id = $2, refunded_at = now()
        WHERE id = $1`, [t.payment_row_id, refundRow.id]);

    await client.query(
      `UPDATE tickets SET status = 'cancelled',
              closure_outcome = CASE WHEN closure_id IS NOT NULL THEN 'refunded'
                                     ELSE closure_outcome END,
              modified_at = now()
        WHERE id = $1`, [t.id]);

    await inventory.unbook(client, {
      placeId: t.place_id, travelDate: t.travel_date,
      slotId: t.slot_id, categoryId: t.category_id });

    if (t.closure_id) {
      await client.query(
        `UPDATE closures SET tickets_refunded = tickets_refunded + 1 WHERE id = $1`,
        [t.closure_id]);
    }

    await client.query(
      `INSERT INTO event_log (customer_id, kind, detail) VALUES ($1, 'ticket_refunded', $2)`,
      [t.customer_id, JSON.stringify({ ticket_no: t.ticket_no, amount_paise: t.total_paise,
        refund_id: refundRow.id, reason, admin_id: adminId })]);
  });

  return { ok: true, refund_id: refundRow.id, amount_paise: t.total_paise };
}

async function cancelWithoutRefund(t, reason, adminId) {
  await tx(async (client) => {
    await client.query(
      `UPDATE tickets SET status = 'cancelled', modified_at = now() WHERE id = $1`, [t.id]);
    await inventory.unbook(client, {
      placeId: t.place_id, travelDate: t.travel_date,
      slotId: t.slot_id, categoryId: t.category_id });
    await client.query(
      `INSERT INTO event_log (customer_id, kind, detail) VALUES ($1, 'ticket_cancelled', $2)`,
      [t.customer_id, JSON.stringify({ ticket_no: t.ticket_no, reason, admin_id: adminId,
        note: 'no captured payment to refund' })]);
  });
}

/** Tickets still waiting for their owner to choose. */
async function awaitingChoice(customerId) {
  const r = await query(
    `SELECT t.*, s.label AS slot_label, cl.reason, cl.travel_date AS closed_date
       FROM tickets t
       JOIN place_slots s ON s.id = t.slot_id
       JOIN closures cl ON cl.id = t.closure_id
      WHERE t.customer_id = $1 AND t.closure_outcome = 'offered'
        AND t.status = 'paid'
      ORDER BY t.travel_date`, [customerId]);
  return r.rows;
}

/** Is this date closed, in whole or for one slot? */
async function isClosed(placeId, travelDate, slotId = null) {
  return !!(await one(
    `SELECT 1 FROM closures
      WHERE place_id = $1 AND travel_date = $2 AND lifted_at IS NULL
        AND (slot_id IS NULL OR slot_id = $3)`, [placeId, travelDate, slotId]));
}

module.exports = {
  preview, affected, close, lift, postpone, refund, awaitingChoice, isClosed,
};
