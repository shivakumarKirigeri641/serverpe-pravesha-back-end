/**
 * booking.js — hold a place, then turn payment into a ticket.
 *
 * The order of operations is the whole design:
 *
 *   1. Claim the capacity and write the ticket in ONE transaction. Either both
 *      happened or neither did; a ticket without a claimed place is an oversold
 *      slot, and a claim without a ticket is a place nobody can buy.
 *   2. Take the money.
 *   3. Mark it paid only after the money is confirmed. Until then the row is a
 *      claim on a place, not a booking, and the gate must not honour it.
 *
 * The uniqueness rule is enforced by the database, not by a check here. Two
 * simultaneous bookings for one vehicle would both pass an application-level
 * "is it already booked?" test; only a unique index can actually stop the
 * second one.
 */

const { query, one, tx } = require('./db');
const inventory = require('./inventory');
const pricing = require('./pricing');
const settings = require('./settings');
const crypto = require('crypto');

/**
 * Ticket numbers are read aloud over a phone and typed by tired people, so the
 * alphabet excludes every character that gets confused: no O or 0, no I, L or
 * 1. What is left is 32 symbols; six of them is a billion combinations, which
 * is ample for a hill that sells a thousand tickets a day.
 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function ticketNo() {
  const bytes = crypto.randomBytes(6);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s;
}

/**
 * Our own handle on a booking, unique forever.
 *
 * It carries the facts a support call starts with, so a screenshot of a
 * reference is enough to find the row without asking three questions. The
 * random tail is what keeps it unique when a hold expires and the same person
 * books the same vehicle for the same slot again — a payment gateway will
 * reject a reference it has seen before, even years later.
 */
function referenceId({ mobile, regNo, travelDate, slotCode }) {
  const tail = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `MLG-${mobile.slice(-4)}-${regNo}-${String(travelDate).replace(/-/g, '')}-${slotCode}-${tail}`;
}

/* ────────────────────────────────────────────────────────── what can be sold */

const placeByCode = (code) => one('SELECT * FROM places WHERE code = $1 AND is_active', [code]);
const slotByCode = (placeId, code) =>
  one('SELECT * FROM place_slots WHERE place_id = $1 AND code = $2 AND is_active', [placeId, code]);

/**
 * The dates a customer may choose.
 *
 * THE WINDOW OPENS AT A FIXED HOUR, NOT AT MIDNIGHT. At the release hour each
 * evening, the date exactly `booking_days_ahead` away becomes bookable. Before
 * that hour the furthest date is one day nearer.
 *
 * WHY THERE IS NO SCHEDULED JOB HERE. The obvious implementation is a nightly
 * cron that opens tomorrow's furthest date, and it would be worse in every way:
 * a job that fails to fire leaves the window silently short, a server restarted
 * at the wrong moment misses it entirely, and a job that runs twice needs
 * guarding. Deriving the window from the clock has none of those failure modes
 * — it is correct the instant the process starts, correct after any outage, and
 * cannot run twice. The only thing a cron would add is something else to
 * monitor.
 *
 * Three settings shape this, and each exists because it will be argued about:
 * whether today itself can still be booked, how far ahead the window runs, and
 * what hour it opens.
 */
/** "18:00:00" -> minutes since midnight. */
function minutesOfDay(t) {
  const [h, m] = String(t || '00:00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Can this slot still be sold, for this date, right now?
 *
 * Only today is ever in question — a future date's slots are all ahead of us.
 * For today the rule is the obvious one that was missing: a slot that has
 * ended cannot be entered, so it cannot be sold. At ten at night the system
 * was happily selling a six-to-twelve morning slot for the same morning that
 * finished ten hours earlier.
 *
 * The cutoff stops the last few minutes being sold as well. Somebody buying
 * entry at 17:58 for a slot that closes at 18:00 has bought nothing, and will
 * be at the barrier arguing about it.
 */
function slotSellable(slot, travelDate, cutoffMinutes = 60, now = new Date()) {
  if (String(travelDate) !== todayStr()) return true;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return nowMin <= minutesOfDay(slot.ends_at) - cutoffMinutes;
}

async function bookableDates(place) {
  const days = place.booking_days_ahead || 14;
  const sameDay = await settings.bool('same_day_booking', true);
  const releaseHour = await settings.num('booking_release_hour', 18);
  const cutoff = await settings.num('same_day_cutoff_minutes', 60);

  // Before the release hour the furthest date has not opened yet.
  const reach = new Date().getHours() >= releaseHour ? days : days - 1;

  /* Today only counts as bookable if at least one of its slots still has
     usable time left. Otherwise the date is offered, tapped, and answered with
     an empty list of slots — which reads as a broken system rather than as a
     day that is simply over. */
  let start = sameDay ? 0 : 1;
  if (start === 0) {
    const slots = (await query(
      'SELECT ends_at FROM place_slots WHERE place_id = $1 AND is_active', [place.id])).rows;
    const anyLeft = slots.some((s) => slotSellable(s, todayStr(), cutoff));
    if (!anyLeft) start = 1;
  }

  const out = [];
  for (let i = start; i <= reach; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return out;
}

/**
 * When the next date opens, and which one it is.
 *
 * Told to the customer rather than left to be discovered: someone looking for a
 * date a fortnight out should be told it appears this evening, not shown a list
 * that quietly ends a day early.
 */
async function nextRelease(place) {
  const days = place.booking_days_ahead || 14;
  const hour = await settings.num('booking_release_hour', 18);
  const now = new Date();
  const opensToday = now.getHours() < hour;

  const at = new Date(now);
  at.setHours(hour, 0, 0, 0);
  if (!opensToday) at.setDate(at.getDate() + 1);

  const date = new Date(at);
  date.setDate(date.getDate() + days);

  return {
    hour,
    opens_at: at.toISOString(),
    opens_today: opensToday,
    date: date.toISOString().slice(0, 10),
  };
}

/**
 * Has this vehicle already got a live ticket for this date?
 *
 * Asked before taking payment purely so the customer gets a sentence that
 * explains the situation instead of a failed transaction. The rule itself is
 * enforced by the unique index; this is courtesy, not enforcement.
 */
async function existingForDate(vehicleId, travelDate) {
  return one(
    `SELECT t.*, s.code AS slot_code, s.label AS slot_label
       FROM tickets t
       JOIN place_slots s ON s.id = t.slot_id
      WHERE t.vehicle_id = $1 AND t.travel_date = $2
        AND t.status IN ('held', 'paid', 'used')
      ORDER BY t.created_at DESC LIMIT 1`,
    [vehicleId, travelDate]);
}

/* ─────────────────────────────────────────────────────────────── the hold */

/**
 * Claim a place and write a held ticket.
 *
 * Returns { ok, ticket, breakdown } or { ok:false, reason } where reason is one
 * of: 'sold_out', 'already_booked', 'closed'. Each of those needs a different
 * sentence to the customer, so they are distinguished rather than collapsed
 * into a generic failure.
 */
async function hold({ customer, vehicle, place, slot, category, travelDate,
                      declared = false, declaredReason = null }) {
  const price = await pricing.priceFor(place.id, category.id);
  const b = await pricing.breakdown(price);
  const minutes = await inventory.holdMinutes();

  // Abandoned holds must not make a slot look full to the next customer.
  await inventory.sweepExpiredHolds();

  try {
    return await tx(async (client) => {
      const inv = await inventory.hold(client, {
        placeId: place.id, travelDate, slotId: slot.id, categoryId: category.id,
      });
      if (!inv) return { ok: false, reason: 'sold_out' };

      const r = await client.query(
        `INSERT INTO tickets
           (ticket_no, reference_id, customer_id, vehicle_id, place_id, slot_id,
            category_id, travel_date, reg_no, mobile,
            entry_paise, platform_paise, gst_paise, total_paise,
            category_declared, declared_reason,
            status, held_until)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$16,$17,'held',
                 now() + ($15 || ' minutes')::interval)
         RETURNING *`,
        [ticketNo(),
         referenceId({ mobile: customer.mobile, regNo: vehicle.reg_no, travelDate, slotCode: slot.code }),
         customer.id, vehicle.id, place.id, slot.id, category.id, travelDate,
         vehicle.reg_no, customer.mobile,
         b.entry_paise, b.platform_paise, b.gst_paise, b.total_paise,
         String(minutes), !!declared, declared ? declaredReason : null]);

      return { ok: true, ticket: r.rows[0], breakdown: b };
    });
  } catch (e) {
    // 23505 on the one-per-vehicle-per-date index: someone — possibly this same
    // person on another phone — got there first. This is the rule working.
    if (e.code === '23505') return { ok: false, reason: 'already_booked' };
    if (e.code === '23514') return { ok: false, reason: 'sold_out' };  // capacity CHECK
    throw e;
  }
}

/* ────────────────────────────────────────────────────────────── the payment */

/**
 * Payment confirmed: convert the hold into a booking.
 *
 * IDEMPOTENT BY CONSTRUCTION. The browser callback, the webhook and the
 * reconciler all call this for the same payment, often within a second of each
 * other. The status check inside the transaction is what makes the second and
 * third calls harmless — without it, the same ticket would consume three places
 * from the slot.
 */
async function markPaid(ticketId, paymentId) {
  return tx(async (client) => {
    const t = (await client.query(
      `SELECT t.*, p.code AS place_code, s.code AS slot_code, c.code AS category_code
         FROM tickets t
         JOIN places p ON p.id = t.place_id
         JOIN place_slots s ON s.id = t.slot_id
         JOIN vehicle_categories c ON c.id = t.category_id
        WHERE t.id = $1
        FOR UPDATE OF t`, [ticketId])).rows[0];

    if (!t) return { ok: false, reason: 'not_found' };
    if (t.status === 'paid' || t.status === 'used') return { ok: true, ticket: t, already: true };
    if (t.status === 'cancelled') return { ok: false, reason: 'cancelled' };

    // An expired hold gave its place back, so it must be re-claimed before this
    // ticket can be honoured. Refusing here rather than issuing anyway is what
    // keeps a slow payment from overselling the slot.
    if (t.status === 'expired') {
      const inv = await inventory.hold(client, {
        placeId: t.place_id, travelDate: t.travel_date,
        slotId: t.slot_id, categoryId: t.category_id,
      });
      if (!inv) return { ok: false, reason: 'expired_and_full' };
    }

    await inventory.confirm(client, {
      placeId: t.place_id, travelDate: t.travel_date,
      slotId: t.slot_id, categoryId: t.category_id,
    });

    /* The booking exists from this moment. Nothing is issued to be carried or
       presented — the gate reads the plate and looks the vehicle up, so what
       makes this ticket real is the row, not an artefact in the visitor's
       hand. */
    const updated = (await client.query(
      `UPDATE tickets
          SET status = 'paid', payment_id = COALESCE($2, payment_id),
              held_until = NULL, modified_at = now()
        WHERE id = $1
        RETURNING *`, [ticketId, paymentId || null])).rows[0];

    return { ok: true, ticket: { ...updated, place_code: t.place_code,
      slot_code: t.slot_code, category_code: t.category_code } };
  });
}

/** Payment failed or was abandoned: give the place back at once. */
async function releaseHold(ticketId, reason = 'failed') {
  return tx(async (client) => {
    const t = (await client.query(
      `SELECT * FROM tickets WHERE id = $1 FOR UPDATE`, [ticketId])).rows[0];
    if (!t || t.status !== 'held') return false;

    await client.query(
      `UPDATE tickets SET status = 'expired', modified_at = now() WHERE id = $1`, [ticketId]);
    await inventory.release(client, {
      placeId: t.place_id, travelDate: t.travel_date,
      slotId: t.slot_id, categoryId: t.category_id,
    });
    return true;
  });
}

/** The full ticket with every name a screen or a PDF needs. */
function full(where, params) {
  return one(
    `SELECT t.*, p.code AS place_code, p.name AS place_name,
            s.code AS slot_code, s.label AS slot_label,
            c.code AS category_code, c.label AS category_label,
            v.maker, v.model
       FROM tickets t
       JOIN places p ON p.id = t.place_id
       JOIN place_slots s ON s.id = t.slot_id
       JOIN vehicle_categories c ON c.id = t.category_id
       JOIN vehicles v ON v.id = t.vehicle_id
      WHERE ${where}`, params);
}

const byId = (id) => full('t.id = $1', [id]);
const byTicketNo = (no) => full('t.ticket_no = $1', [no]);
const byReference = (ref) => full('t.reference_id = $1', [ref]);

/** A customer's recent tickets, newest first — what "my bookings" shows. */
async function forCustomer(customerId, limit = 5) {
  const r = await query(
    `SELECT t.*, p.name AS place_name, s.label AS slot_label, c.label AS category_label
       FROM tickets t
       JOIN places p ON p.id = t.place_id
       JOIN place_slots s ON s.id = t.slot_id
       JOIN vehicle_categories c ON c.id = t.category_id
      WHERE t.customer_id = $1 AND t.status IN ('paid', 'used')
      ORDER BY t.travel_date DESC, t.created_at DESC
      LIMIT $2`, [customerId, limit]);
  return r.rows;
}

module.exports = {
  ticketNo, referenceId, placeByCode, slotByCode, bookableDates, nextRelease,
  slotSellable,
  existingForDate, hold, markPaid, releaseHold,
  byId, byTicketNo, byReference, forCustomer,
};
