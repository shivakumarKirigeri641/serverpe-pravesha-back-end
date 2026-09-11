/**
 * booking.js — hold a place, then turn a payment into a pass.
 *
 * The order of operations is the design:
 *
 *   1. Claim the capacity and write the ticket in ONE transaction. Either both
 *      happened or neither did: a ticket without a claimed place is an oversold
 *      slot, and a claim without a ticket is a place nobody can buy.
 *   2. Take the money.
 *   3. Only then mark the ticket paid and deliver it.
 *
 * ONE PASS PER VEHICLE PER DATE is enforced by the database, not by a check in
 * here. Two bookings for the same vehicle arriving together would both pass an
 * "is it already booked?" test; idx_tickets_one_per_vehicle_per_date is the
 * only thing that can actually stop the second. The check the form runs first
 * exists to give the visitor a sentence instead of a failed payment.
 */

const crypto = require('crypto');
const { one, tx } = require('./db');
const inventory = require('./inventory');
const pricing = require('./pricing');

/**
 * Pass numbers are read aloud at a barrier and typed by tired people, so the
 * alphabet leaves out every character that gets confused: no O or 0, no I, L
 * or 1.
 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function ticketNo() {
  const b = crypto.randomBytes(8);
  let s = '';
  for (const x of b) s += ALPHABET[x % ALPHABET.length];
  return `PRV-${s.slice(0, 4)}-${s.slice(4)}`;
}

/**
 * Our own handle on a booking, unique forever. It carries the facts a support
 * call starts with, so a screenshot of it finds the row without three questions.
 * The random tail keeps it unique when the same person rebooks the same vehicle
 * for the same slot: Razorpay refuses a receipt it has seen before.
 */
function referenceId({ placeCode, mobile, regNo, travelDate, slotCode }) {
  const tail = crypto.randomBytes(3).toString('hex').toUpperCase();
  const place = String(placeCode || 'PRV').slice(0, 3).toUpperCase();
  return `${place}-${String(mobile).slice(-4)}-${regNo}-${String(travelDate).replace(/-/g, '')}-${slotCode}-${tail}`;
}

/** Has this vehicle already got a live pass for this date? */
function existingForDate(vehicleId, travelDate) {
  return one(
    `SELECT t.*, regexp_replace(s.label, '[[:space:]]+', ' ', 'g') AS slot_label
       FROM tickets t JOIN place_slots s ON s.id = t.slot_id
      WHERE t.vehicle_id = $1 AND t.travel_date = $2
        AND t.status IN ('held', 'paid', 'used')
      ORDER BY t.created_at DESC LIMIT 1`, [vehicleId, travelDate]);
}

/**
 * Claim a place and write a held ticket.
 *
 * Returns { ok: true, ticket } or { ok: false, reason } with reason one of
 * 'sold_out' | 'already_booked' | 'no_price'. They are kept apart because each
 * needs a different sentence: one sends the visitor to another slot, another
 * tells them they already hold a pass.
 */
async function hold({ customer, vehicle, place, slot, categoryId, travelDate }) {
  const price = await pricing.forPlaceCategory(place.id, categoryId);
  if (!price) return { ok: false, reason: 'no_price' };
  const b = await pricing.breakdown(price);
  const minutes = await inventory.holdMinutes();

  /* Abandoned holds must not make a slot look full to the next person. */
  await inventory.sweepExpiredHolds();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await tx(async (client) => {
        const inv = await inventory.hold(client, {
          placeId: place.id, slotId: slot.id, categoryId, travelDate });
        if (!inv) return { ok: false, reason: 'sold_out' };

        const r = await client.query(
          `INSERT INTO tickets
             (ticket_no, reference_id, customer_id, vehicle_id, place_id, slot_id,
              category_id, travel_date, reg_no, mobile,
              entry_paise, platform_paise, gst_paise, total_paise, status, held_until)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'held',
                   now() + ($15 || ' minutes')::interval)
           RETURNING *`,
          [ticketNo(),
           referenceId({ placeCode: place.code, mobile: customer.mobile, regNo: vehicle.reg_no,
             travelDate, slotCode: slot.code }),
           customer.id, vehicle.id, place.id, slot.id, categoryId, travelDate,
           vehicle.reg_no, customer.mobile,
           b.entry_paise, b.platform_paise, b.gst_paise, b.total_paise, String(minutes)]);
        return { ok: true, ticket: r.rows[0], breakdown: b };
      });
    } catch (e) {
      if (e.code === '23505' && /one_per_vehicle/.test(e.constraint || '')) {
        return { ok: false, reason: 'already_booked' };
      }
      /* A pass-number collision: vanishingly rare, and harmless to retry. */
      if (e.code === '23505' && /ticket_no|reference_id/.test(e.constraint || '')) continue;
      if (e.code === '23514') return { ok: false, reason: 'sold_out' };
      throw e;
    }
  }
  throw new Error('could not allocate a unique pass number');
}

/**
 * Payment confirmed: the hold becomes a pass.
 *
 * IDEMPOTENT BY CONSTRUCTION. The browser callback, the webhook and the
 * reconciler all arrive here for the same payment, often within a second of one
 * another. The row lock and the status check make the second and third
 * harmless; without them one payment would consume three places.
 */
async function markPaid(ticketId, paymentId) {
  return tx(async (client) => {
    const t = (await client.query('SELECT * FROM tickets WHERE id = $1 FOR UPDATE', [ticketId])).rows[0];
    if (!t) return { ok: false, reason: 'not_found' };
    if (t.status === 'paid' || t.status === 'used') return { ok: true, ticket: t, already: true };
    if (t.status === 'cancelled') return { ok: false, reason: 'cancelled' };

    /* A hold that timed out gave its place back. It has to be claimed again
       before this pass can be honoured; issuing it anyway is how a slow payment
       oversells a slot. */
    if (t.status === 'expired') {
      const again = await inventory.hold(client, { placeId: t.place_id, slotId: t.slot_id,
        categoryId: t.category_id, travelDate: t.travel_date });
      if (!again) return { ok: false, reason: 'expired_and_full' };
    }

    await inventory.confirm(client, { placeId: t.place_id, slotId: t.slot_id,
      categoryId: t.category_id, travelDate: t.travel_date });

    const u = (await client.query(
      `UPDATE tickets SET status = 'paid', payment_id = COALESCE($2, payment_id),
              held_until = NULL, modified_at = now()
        WHERE id = $1 RETURNING *`, [ticketId, paymentId || null])).rows[0];

    /* The booking link is spent by the pass, not by opening the form: a failed
       payment leaves it usable, so the visitor can simply try again. */
    await client.query(
      'UPDATE web_tokens SET used_at = COALESCE(used_at, now()) WHERE ticket_id = $1', [ticketId]);

    return { ok: true, ticket: u };
  });
}

/** Payment failed or was abandoned: give the place back at once. */
async function releaseHold(ticketId) {
  return tx(async (client) => {
    const t = (await client.query('SELECT * FROM tickets WHERE id = $1 FOR UPDATE', [ticketId])).rows[0];
    if (!t || t.status !== 'held') return false;
    await client.query("UPDATE tickets SET status = 'expired', modified_at = now() WHERE id = $1", [ticketId]);
    await inventory.release(client, { placeId: t.place_id, slotId: t.slot_id,
      categoryId: t.category_id, travelDate: t.travel_date });
    return true;
  });
}

/** Everything a PDF, a verification page or a support screen needs, in one row. */
function full(where, params) {
  return one(
    `SELECT t.*,
            p.code AS place_code, p.name AS place_name, p.district,
            p.name_kn AS place_name_kn, p.district_kn, s.label_kn AS slot_label_kn,
            s.code AS slot_code, regexp_replace(s.label, '[[:space:]]+', ' ', 'g') AS slot_label, s.starts_at, s.ends_at,
            c.code AS category_code, c.label AS category_label, c.label_kn AS category_label_kn,
            v.maker, v.model, v.fuel, v.colour, v.vehicle_class, v.vehicle_category, v.body_type,
            cu.name AS customer_name, cu.wa_profile_name,
            pay.status AS payment_status, pay.order_id, pay.payment_id AS gateway_payment_id,
            pay.created_at AS payment_created_at, pay.paid_at, pay.raw AS payment_raw
       FROM tickets t
       JOIN places p ON p.id = t.place_id
       JOIN place_slots s ON s.id = t.slot_id
       JOIN vehicle_categories c ON c.id = t.category_id
       JOIN vehicles v ON v.id = t.vehicle_id
       JOIN customers cu ON cu.id = t.customer_id
       LEFT JOIN payments pay ON pay.id = t.payment_id
      WHERE ${where}`, params);
}

const byId = (id) => full('t.id = $1', [id]);
const byTicketNo = (no) => full('t.ticket_no = $1', [no]);
const byReference = (ref) => full('t.reference_id = $1', [ref]);

module.exports = {
  ticketNo, referenceId, existingForDate, hold, markPaid, releaseHold,
  byId, byTicketNo, byReference,
};
