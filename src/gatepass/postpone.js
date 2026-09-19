/**
 * postpone.js — moving a pass to another date and slot (user, 2026-09-19).
 *
 * Pravesha does not refund a pass, so a visitor whose plans change can move it
 * instead. The rules, stated once here and shown word for word wherever a
 * visitor or an administrator is asked to agree to them:
 *
 *   * ONCE per pass — a pass cannot be walked around the calendar;
 *   * until 24 HOURS before the booked slot starts;
 *   * to a date within the next 30 DAYS, into a slot that still has room;
 *   * NO FEE, and NO REFUND or difference either way — the same pass, the same
 *     vehicle (or number of people), the same amount paid;
 *   * a pass already used, cancelled or unpaid cannot be moved.
 *
 * The limits are settings (postpone_max_moves, postpone_cutoff_hours,
 * postpone_window_days) so the Department can change them without a release.
 *
 * THE SEAT MOVES WITH THE PASS, ATOMICALLY. In one transaction the new slot's
 * capacity is claimed — only while there is room, decided by the database, as
 * for a booking — and the old seat is given back. Either both happen or
 * neither does, so a slot can never be oversold by a postponement.
 *
 * THE PASS NUMBER STAYS. The gate reads the date and slot from the database,
 * never from the number, so the visitor keeps the number they already have and
 * the updated pass is sent to them again on WhatsApp.
 */

const { query, one, tx } = require('./db');
const settings = require('./settings');
const slotTime = require('./slotTime');
const inventory = require('./inventory');

async function rules() {
  return {
    maxMoves: await settings.num('postpone_max_moves', 1),
    cutoffHours: await settings.num('postpone_cutoff_hours', 24),
    windowDays: await settings.num('postpone_window_days', 30),
  };
}

const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

/** When the booked slot starts, as a real moment (IST). */
function slotStart(t) {
  return new Date(`${iso(t.travel_date)}T${String(t.starts_at || '00:00').slice(0, 5)}:00+05:30`);
}

const addDays = (date, n) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/** The pass with what the rules need to see. */
function load(where, params) {
  return one(
    `SELECT t.*, s.starts_at, s.ends_at, regexp_replace(s.label, '[[:space:]]+', ' ', 'g') AS slot_label, s.label_kn AS slot_label_kn,
            p.name AS place_name, p.name_kn AS place_name_kn, p.district, p.district_kn, p.is_active AS place_active,
            c.label AS category_label, c.label_kn AS category_label_kn, c.code AS category_code
       FROM tickets t
       JOIN place_slots s ON s.id = t.slot_id
       JOIN places p ON p.id = t.place_id
       JOIN vehicle_categories c ON c.id = t.category_id
      WHERE ${where}`, params);
}

/**
 * May this pass be moved now? { ok, reason, message } — the message is what the
 * visitor or administrator is shown, so it says what to do next.
 */
async function check(t, now = new Date()) {
  const r = await rules();
  if (!t) return { ok: false, reason: 'not_found', message: 'No such pass.' };
  if (t.status === 'used') return { ok: false, reason: 'used', message: 'This pass has already been used for entry, so it cannot be moved.' };
  if (t.status !== 'paid') return { ok: false, reason: 'not_paid', message: 'Only a paid pass can be moved.' };
  if (Number(t.move_count || 0) >= r.maxMoves) {
    return { ok: false, reason: 'already_moved', message: `This pass has already been moved${r.maxMoves === 1 ? ' once' : ` ${r.maxMoves} times`}. A pass can be moved only ${r.maxMoves === 1 ? 'once' : `${r.maxMoves} times`}.` };
  }
  const hoursLeft = (slotStart(t) - now) / 3600000;
  if (hoursLeft < r.cutoffHours) {
    return { ok: false, reason: 'too_late', message: `A pass can be moved only until ${r.cutoffHours} hours before its slot starts.` };
  }
  return { ok: true, rules: r };
}

/**
 * The dates a pass may move to, and — for one date — its slots with room. The
 * current date and slot are offered too only if another slot on it has room;
 * the same slot on the same day is not a move.
 */
async function window(t) {
  const r = await rules();
  const today = slotTime.nowIST().date;
  return { from: today, to: addDays(today, r.windowDays), rules: r };
}

async function slotsFor(t, date) {
  const w = await window(t);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) || date < w.from || date > w.to) {
    return { ok: false, message: `Choose a date between ${w.from} and ${w.to}.` };
  }
  const units = inventory.unitsOf(t);
  const slots = await inventory.forDate(t.place_id, t.category_id, date);
  return {
    ok: true,
    date,
    slots: slots.map((s) => {
      const same = date === iso(t.travel_date) && String(s.slotId) === String(t.slot_id);
      return {
        slotId: s.slotId, label: s.label, labelKn: s.labelKn, remaining: s.remaining,
        bookable: !same && s.bookable && s.remaining >= units,
        reason: same ? 'current' : !s.isOpen ? 'closed' : s.timeClosed ? 'time' : s.remaining < units ? 'full' : null,
      };
    }),
  };
}

class Refusal extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/**
 * Move it. `by` is 'visitor' or 'admin'; an administrator is named in the
 * audit trail. Returns { ok, ticket, from, to } or { ok:false, reason, message }.
 */
async function move({ ticketId, date, slotId, by = 'visitor', adminId = null, customerId = null, reason = null, consent = null }) {
  const t = await load('t.id = $1', [ticketId]);
  if (!t) return { ok: false, reason: 'not_found', message: 'No such pass.' };
  if (customerId && String(t.customer_id) !== String(customerId)) {
    return { ok: false, reason: 'not_yours', message: 'This pass does not belong to this number.' };
  }
  const allowed = await check(t);
  if (!allowed.ok) return allowed;

  const offer = await slotsFor(t, date);
  if (!offer.ok) return { ok: false, reason: 'bad_date', message: offer.message };
  const slot = offer.slots.find((s) => String(s.slotId) === String(slotId));
  if (!slot) return { ok: false, reason: 'bad_slot', message: 'Choose one of the slots shown for that date.' };
  if (!slot.bookable) return { ok: false, reason: 'slot_unavailable', message: 'That slot has no room left, or is closed. Choose another.' };

  const units = inventory.unitsOf(t);
  const from = { date: iso(t.travel_date), slotId: String(t.slot_id), slotLabel: t.slot_label };
  await inventory.ensure(t.place_id, slotId, t.category_id, date);

  try {
    await tx(async (client) => {
      /* The pass, locked, and still what it was a moment ago. */
      const cur = (await client.query('SELECT * FROM tickets WHERE id = $1 FOR UPDATE', [t.id])).rows[0];
      if (!cur || cur.status !== 'paid' || Number(cur.move_count || 0) !== Number(t.move_count || 0)
          || iso(cur.travel_date) !== from.date || String(cur.slot_id) !== from.slotId) {
        throw new Refusal('changed', 'This pass changed a moment ago. Please look at it again.');
      }
      /* The new seat, only while there is room — the database decides. */
      const claimed = await client.query(
        `UPDATE slot_inventory SET booked = booked + $5, modified_at = now()
          WHERE place_id = $1 AND slot_id = $2 AND category_id = $3 AND travel_date = $4
            AND is_open AND booked + held + $5 <= capacity
          RETURNING id`, [t.place_id, slotId, t.category_id, date, units]);
      if (!claimed.rows.length) throw new Refusal('slot_unavailable', 'That slot filled up a moment ago. Choose another.');
      /* The old seat, given back. */
      await client.query(
        `UPDATE slot_inventory SET booked = GREATEST(booked - $5, 0), modified_at = now()
          WHERE place_id = $1 AND slot_id = $2 AND category_id = $3 AND travel_date = $4`,
        [t.place_id, t.slot_id, t.category_id, from.date, units]);
      await client.query(
        `UPDATE tickets SET travel_date = $2, slot_id = $3,
                moved_from_date = travel_date, moved_from_slot_id = slot_id,
                moved_at = now(), move_count = move_count + 1, modified_at = now()
          WHERE id = $1`, [t.id, date, slotId]);
      await client.query(
        `INSERT INTO event_log (customer_id, kind, detail) VALUES ($1, 'pass_postponed', $2)`,
        [t.customer_id, JSON.stringify({ ticket_id: String(t.id), by, from: from.date, fromSlot: from.slotId, to: date, toSlot: String(slotId), reason: reason || undefined,
          /* What the visitor agreed to, and when: the rules as shown on the page. */
          consent: consent || undefined })]);
    });
  } catch (e) {
    if (e instanceof Refusal) return { ok: false, reason: e.code, message: e.message };
    /* One pass per vehicle per day: the vehicle already has one for that date. */
    if (e.code === '23505') return { ok: false, reason: 'vehicle_has_pass', message: 'This vehicle already has a pass for that date.' };
    throw e;
  }

  if (adminId) {
    await require('./admin').audit({ adminId, action: 'pass_postponed', subject: `ticket:${t.ticket_no}`,
      reason: reason || null, detail: { from: from.date, to: date, slotId: String(slotId) } }).catch(() => {});
  }
  require('../log').event('wa', 'postponed', `${t.ticket_no}  ${from.date} → ${date} · by ${by}`);

  return { ok: true, ticketId: String(t.id), ticketNo: t.ticket_no, from, to: { date, slotId: String(slotId), slotLabel: slot.label } };
}

/** A visitor's passes that may be postponed now, soonest first, each with why not if it may not. */
async function forCustomer(customerId) {
  const rows = (await query(
    `SELECT t.id FROM tickets t
      WHERE t.customer_id = $1 AND t.status = 'paid' AND t.travel_date >= $2::date
      ORDER BY t.travel_date, t.id LIMIT 10`, [customerId, slotTime.nowIST().date])).rows;
  const out = [];
  for (const { id } of rows) {
    // eslint-disable-next-line no-await-in-loop
    const t = await load('t.id = $1', [id]);
    // eslint-disable-next-line no-await-in-loop
    out.push({ t, verdict: await check(t) });
  }
  return out;
}

module.exports = { rules, check, window, slotsFor, move, forCustomer, load, slotStart };
