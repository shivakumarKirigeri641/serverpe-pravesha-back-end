/**
 * inventory.js — claiming a place in a slot.
 *
 * THE FAILURE THIS FILE EXISTS TO PREVENT: 400 car places, 399 sold, and two
 * people tap Pay within the same second. Read-then-write sells both of them the
 * last place, and two cars arrive for one gap in the barrier. There is no
 * graceful way to handle that at 7 a.m. on a hill road.
 *
 * So capacity is never read and then written. The claim is one statement whose
 * WHERE clause contains the check, and Postgres decides the winner:
 *
 *     UPDATE slot_inventory SET held = held + 1
 *      WHERE ... AND booked + held < capacity
 *     RETURNING *
 *
 * Nothing returned means it was full at the moment we asked — which is the only
 * moment that matters.
 *
 * HELD versus BOOKED: a customer at the payment page has not paid, but their
 * place cannot be sold to someone else meanwhile. So a hold is taken first and
 * converted to a booking on payment, or released on failure or expiry. Without
 * that, a slow UPI approval would routinely end with a paid customer and no
 * place left.
 */

const { query, one } = require('./db');
const settings = require('./settings');

/**
 * Make sure the rows for one date exist, copied from the template.
 *
 * Created on demand rather than by a nightly job, because a job that fails at
 * 2 a.m. means a morning with no inventory at all. ON CONFLICT DO NOTHING makes
 * two simultaneous first-bookings harmless, and — importantly — never resets a
 * day an administrator has already edited.
 */
async function ensureDate(client, placeId, travelDate) {
  await (client || { query }).query(
    `INSERT INTO slot_inventory (place_id, slot_id, category_id, travel_date, capacity)
     SELECT sc.place_id, sc.slot_id, sc.category_id, $2::date, sc.capacity
       FROM slot_capacity sc
      WHERE sc.place_id = $1
     ON CONFLICT (place_id, travel_date, slot_id, category_id) DO NOTHING`,
    [placeId, travelDate]);
}

/**
 * What is left on each of several dates at once, for one vehicle type.
 *
 * One query rather than one per date. The date list on WhatsApp shows a
 * fortnight, and asking the database fourteen times while a customer waits is
 * fourteen round trips for a number that fits in one.
 *
 * Dates with no inventory row yet are reported at full template capacity — the
 * rows are created on first booking, and an unbooked day is not a full one.
 */
async function availabilityForDates(placeId, dates, categoryId) {
  if (!dates.length) return {};

  const r = await query(
    `SELECT i.travel_date, s.code AS slot_code,
            i.is_open,
            GREATEST(i.capacity - i.booked - i.held, 0)::int AS available
       FROM slot_inventory i
       JOIN place_slots s ON s.id = i.slot_id
      WHERE i.place_id = $1 AND i.category_id = $2
        AND i.travel_date = ANY($3::date[])`,
    [placeId, categoryId, dates]);

  const template = (await query(
    `SELECT s.code AS slot_code, sc.capacity
       FROM slot_capacity sc JOIN place_slots s ON s.id = sc.slot_id
      WHERE sc.place_id = $1 AND sc.category_id = $2`, [placeId, categoryId])).rows;

  const out = {};
  for (const d of dates) {
    out[d] = {};
    for (const t of template) out[d][t.slot_code] = { available: t.capacity, is_open: true };
  }
  for (const row of r.rows) {
    const key = String(row.travel_date).slice(0, 10);
    if (!out[key]) out[key] = {};
    out[key][row.slot_code] = { available: row.available, is_open: row.is_open };
  }
  return out;
}

/** What is left, per slot, for one category on one date. */
async function availability(placeId, travelDate, categoryId) {
  await ensureDate(null, placeId, travelDate);
  const r = await query(
    `SELECT s.id AS slot_id, s.code, s.label, s.starts_at, s.ends_at,
            i.capacity, i.booked, i.held, i.is_open, i.closed_note,
            GREATEST(i.capacity - i.booked - i.held, 0) AS available
       FROM slot_inventory i
       JOIN place_slots s ON s.id = i.slot_id
      WHERE i.place_id = $1 AND i.travel_date = $2 AND i.category_id = $3
        AND s.is_active
      ORDER BY s.sort_order`,
    [placeId, travelDate, categoryId]);
  return r.rows;
}

/**
 * Take one place. Returns the inventory row, or null if it could not be taken.
 *
 * Runs on the caller's client so it commits or rolls back together with the
 * ticket that depends on it — a hold with no ticket is a place lost until the
 * sweeper runs, and a ticket with no hold is an oversold slot.
 */
async function hold(client, { placeId, travelDate, slotId, categoryId }) {
  await ensureDate(client, placeId, travelDate);
  const r = await client.query(
    `UPDATE slot_inventory
        SET held = held + 1, modified_at = now()
      WHERE place_id = $1 AND travel_date = $2 AND slot_id = $3 AND category_id = $4
        AND is_open
        AND booked + held < capacity
      RETURNING *`,
    [placeId, travelDate, slotId, categoryId]);
  return r.rows[0] || null;
}

/** Payment succeeded: the hold becomes a booking. */
async function confirm(client, { placeId, travelDate, slotId, categoryId }) {
  const r = await client.query(
    `UPDATE slot_inventory
        SET held = GREATEST(held - 1, 0), booked = booked + 1, modified_at = now()
      WHERE place_id = $1 AND travel_date = $2 AND slot_id = $3 AND category_id = $4
      RETURNING *`,
    [placeId, travelDate, slotId, categoryId]);
  return r.rows[0] || null;
}

/** Payment failed, was abandoned, or the hold aged out. */
async function release(client, { placeId, travelDate, slotId, categoryId }) {
  const r = await (client || { query }).query(
    `UPDATE slot_inventory
        SET held = GREATEST(held - 1, 0), modified_at = now()
      WHERE place_id = $1 AND travel_date = $2 AND slot_id = $3 AND category_id = $4
      RETURNING *`,
    [placeId, travelDate, slotId, categoryId]);
  return r.rows[0] || null;
}

/** A cancellation or refund after payment gives the place back. */
async function unbook(client, { placeId, travelDate, slotId, categoryId }) {
  const r = await (client || { query }).query(
    `UPDATE slot_inventory
        SET booked = GREATEST(booked - 1, 0), modified_at = now()
      WHERE place_id = $1 AND travel_date = $2 AND slot_id = $3 AND category_id = $4
      RETURNING *`,
    [placeId, travelDate, slotId, categoryId]);
  return r.rows[0] || null;
}

/**
 * Expire abandoned holds and hand their places back.
 *
 * Most abandonments are ordinary — someone opened the payment page and put the
 * phone down. Without this, every one of them would permanently shrink the
 * slot. Run on a timer AND before quoting availability, so a customer is never
 * told "full" because of places nobody is buying.
 */
async function sweepExpiredHolds() {
  const rows = (await query(
    `UPDATE tickets
        SET status = 'expired', modified_at = now()
      WHERE status = 'held' AND held_until IS NOT NULL AND held_until < now()
      RETURNING place_id, travel_date, slot_id, category_id, id`)).rows;

  for (const t of rows) {
    await release(null, {
      placeId: t.place_id, travelDate: t.travel_date,
      slotId: t.slot_id, categoryId: t.category_id,
    });
  }
  return rows.length;
}

/** Minutes a hold survives — long enough for UPI, short enough to recover. */
const holdMinutes = () => settings.num('hold_minutes', 10);

module.exports = {
  ensureDate, availability, hold, confirm, release, unbook,
  sweepExpiredHolds, holdMinutes,
};
