/**
 * inventory.js — how many vehicles of a kind may still go up.
 *
 * Capacity is per place, per slot, per category, per date. Not one number for
 * the hill: a road that can take four hundred cars cannot take four hundred
 * Tempo Travellers, and the limit that matters is the one for the vehicle
 * actually being booked. This is why the vehicle is identified before
 * availability is shown, rather than after.
 *
 * TWO COUNTERS, NOT ONE. `booked` is a pass that exists. `held` is capacity
 * claimed by someone sitting on the payment page who has not paid yet. Without
 * the hold, the last place on a Sunday morning is sold to everyone who reaches
 * that page at the same moment, and refunded to all but one of them.
 */

const { one, query } = require('./db');

/**
 * A row is created on demand rather than seeded far ahead.
 *
 * Four places times two slots times four categories times a year is twelve
 * thousand rows describing days nobody has asked about, and every change to a
 * default then has to be applied across all of them. The defaults live in
 * slot_capacity; a date gets its own row the first time somebody looks at it,
 * and from then on it can be adjusted for that one day.
 */
async function ensure(placeId, slotId, categoryId, travelDate) {
  const existing = await one(
    `SELECT * FROM slot_inventory
      WHERE place_id=$1 AND slot_id=$2 AND category_id=$3 AND travel_date=$4`,
    [placeId, slotId, categoryId, travelDate]);
  if (existing) return existing;

  const def = await one(
    `SELECT capacity FROM slot_capacity
      WHERE place_id=$1 AND slot_id=$2 AND category_id=$3`,
    [placeId, slotId, categoryId]);

  const r = await query(
    `INSERT INTO slot_inventory (place_id, slot_id, category_id, travel_date, capacity)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (place_id, slot_id, category_id, travel_date) DO UPDATE
       SET modified_at = now()
     RETURNING *`,
    [placeId, slotId, categoryId, travelDate, def ? def.capacity : 0]);
  return r.rows[0];
}

/** What is left, and whether it may be sold at all. */
async function available(placeId, slotId, categoryId, travelDate) {
  const row = await ensure(placeId, slotId, categoryId, travelDate);
  const capacity = Number(row.capacity || 0);
  const taken = Number(row.booked || 0) + Number(row.held || 0);
  return {
    capacity,
    booked: Number(row.booked || 0),
    held: Number(row.held || 0),
    remaining: Math.max(0, capacity - taken),
    isOpen: row.is_open !== false,
    closedNote: row.closed_note || null,
  };
}

/** Both slots at once, for the category being booked — what the form shows. */
async function forDate(placeId, categoryId, travelDate) {
  const slots = await query(
    `SELECT id, code, label FROM place_slots
      WHERE place_id=$1 AND is_active ORDER BY sort_order`, [placeId]);
  const out = [];
  for (const s of slots.rows) {
    const a = await available(placeId, s.id, categoryId, travelDate);
    out.push(Object.assign({ slotId: String(s.id), code: s.code, label: s.label }, a));
  }
  return out;
}

module.exports = { ensure, available, forDate };
