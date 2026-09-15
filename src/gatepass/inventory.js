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
const slotTime = require('./slotTime');

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

/**
 * Both slots at once, for the category being booked — what the form shows.
 *
 * Two separate reasons a slot may be unavailable, and they are kept apart:
 * capacity is gone, or the slot's last entry has passed. A visitor told "full"
 * about a slot that simply finished an hour ago is being told something untrue,
 * and will try again tomorrow expecting it to be free.
 */
async function forDate(placeId, categoryId, travelDate) {
  const slots = await query(
    /* A slot with opening or closing dates is only offered between them. */
    `SELECT id, code, regexp_replace(label, '[[:space:]]+', ' ', 'g') AS label, label_kn, starts_at, ends_at FROM place_slots
      WHERE place_id=$1 AND is_active
        AND (valid_from IS NULL OR valid_from <= $2::date)
        AND (valid_to IS NULL OR valid_to >= $2::date)
      ORDER BY sort_order`, [placeId, travelDate]);

  const out = [];
  for (const s of slots.rows) {
    const a = await available(placeId, s.id, categoryId, travelDate);
    const t = slotTime.check(s, travelDate);
    out.push(Object.assign({
      slotId: String(s.id), code: s.code, label: s.label, labelKn: s.label_kn || null,
      lastEntry: t.lastEntry,
      timeClosed: !t.bookable,
      timeReason: t.reason || null,
    }, a, {
      /* One field the form can trust, whichever reason applies. */
      bookable: a.isOpen && a.remaining > 0 && t.bookable,
    }));
  }
  return out;
}

/* ─────────────────────────────────────────────── claiming and releasing ── */

/**
 * Claim one place, inside the caller's transaction.
 *
 * The capacity test is in the WHERE clause, not in JavaScript beforehand. Two
 * bookings for the last place would both read "one left" and both proceed; an
 * UPDATE that only matches while booked + held < capacity lets exactly one of
 * them through, and the table's own CHECK stands behind it.
 */
/**
 * How many places a pass takes: one for a vehicle, the number of people for a
 * per-person pass (056). Every claim, confirmation and release goes through
 * this, so a pass for four can never give back one.
 */
const unitsOf = (t) => (t && t.pass_kind === 'person' ? Math.max(1, Number(t.persons) || 1) : 1);

async function hold(client, { placeId, slotId, categoryId, travelDate, units = 1 }) {
  await ensure(placeId, slotId, categoryId, travelDate);
  const n = Math.max(1, Number(units) || 1);
  const r = await client.query(
    `UPDATE slot_inventory
        SET held = held + $5, modified_at = now()
      WHERE place_id = $1 AND slot_id = $2 AND category_id = $3 AND travel_date = $4
        AND is_open AND booked + held + $5 <= capacity
      RETURNING *`,
    [placeId, slotId, categoryId, travelDate, n]);
  return r.rows[0] || null;
}

/** A held place becomes a booked one: paid for. */
async function confirm(client, { placeId, slotId, categoryId, travelDate, units = 1 }) {
  const n = Math.max(1, Number(units) || 1);
  const r = await client.query(
    `UPDATE slot_inventory
        SET held = GREATEST(held - $5, 0), booked = booked + $5, modified_at = now()
      WHERE place_id = $1 AND slot_id = $2 AND category_id = $3 AND travel_date = $4
      RETURNING *`,
    [placeId, slotId, categoryId, travelDate, n]);
  return r.rows[0] || null;
}

/** Give a held place back. */
async function release(client, { placeId, slotId, categoryId, travelDate, units = 1 }) {
  const n = Math.max(1, Number(units) || 1);
  const r = await (client || { query }).query(
    `UPDATE slot_inventory
        SET held = GREATEST(held - $5, 0), modified_at = now()
      WHERE place_id = $1 AND slot_id = $2 AND category_id = $3 AND travel_date = $4
      RETURNING *`,
    [placeId, slotId, categoryId, travelDate, n]);
  return r.rows[0] || null;
}

/**
 * Holds whose time ran out, returned to the pool.
 *
 * Someone who opened the payment sheet and walked away must not keep a place
 * on a Sunday morning. Run before every new hold and by the reconciler, so no
 * scheduled job has to be trusted to exist.
 */
async function sweepExpiredHolds() {
  const rows = (await query(
    `UPDATE tickets SET status = 'expired', modified_at = now()
      WHERE status = 'held' AND held_until IS NOT NULL AND held_until < now()
      RETURNING place_id, slot_id, category_id, travel_date, pass_kind, persons`)).rows;
  for (const t of rows) {
    await release(null, { placeId: t.place_id, slotId: t.slot_id,
      categoryId: t.category_id, travelDate: t.travel_date, units: unitsOf(t) });
  }
  return rows.length;
}

async function holdMinutes() {
  return require('./settings').num('hold_minutes', 10);
}

module.exports = { ensure, available, forDate, hold, confirm, release, sweepExpiredHolds, holdMinutes, unitsOf };
