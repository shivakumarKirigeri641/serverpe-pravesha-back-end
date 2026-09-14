/**
 * capacityToday.js — the day itself, changed from live monitoring.
 *
 * WHAT IT IS FOR. The morning is not going as planned: fog on the road, a
 * landslip below the viewpoint, a VIP convoy at eleven. The person watching the
 * gate needs to take places away, or shut a slot, now — not open settings and
 * edit a default that also changes next Sunday.
 *
 * ONLY TODAY. Every change here is to today's rows in slot_inventory. The
 * defaults, and every other date, are settings' business.
 *
 * NOBODY WHO HAS PAID IS CANCELLED BY A NUMBER. Capacity cannot go below what is
 * already booked or being paid for: a smaller number stops further sales, it does
 * not un-sell a pass. Closing a slot stops sales and entry-by-booking for that
 * slot, and the people already holding a pass for it are told on WhatsApp in
 * their own language — what happens to their money is decided by the office
 * afterwards, in ticket management, as with any closure.
 *
 * EVERY CHANGE HAS A REASON AND AN AUDIT ROW (written by the route).
 */

const { query, one, tx } = require('./db');
const slotTime = require('./slotTime');
const inventory = require('./inventory');

class Refusal extends Error {
  constructor(message, { status = 400, code = 'refused' } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const refuse = (message, opts) => { throw new Refusal(message, opts); };
const n = (v) => Number(v || 0);
const rowsOf = async (text, params) => (await query(text, params)).rows;

const requireReason = (reason) => {
  const why = String(reason || '').trim();
  if (why.length < 5) refuse('Say why, in a few words. It is recorded in the audit log.', { code: 'reason_required' });
  return why;
};

/** A slot of an active place, valid today — or a refusal. */
async function slotToday(slotId) {
  const today = slotTime.nowIST().date;
  const s = await one(
    /* The label as every screen shows it — the stored one has stray spaces, and
       an audit row that reads differently from the screen invites an argument. */
    `SELECT s.*, regexp_replace(s.label, '[[:space:]]+', ' ', 'g') AS label,
            p.name AS place_name, p.is_active AS place_active
       FROM place_slots s JOIN places p ON p.id = s.place_id
      WHERE s.id = $1 AND s.is_active
        AND (s.valid_from IS NULL OR s.valid_from <= $2::date)
        AND (s.valid_to IS NULL OR s.valid_to >= $2::date)`, [slotId, today]);
  if (!s || !s.place_active) refuse('That slot is not running today.', { status: 404, code: 'not_found' });
  return { slot: s, today };
}

async function categories() {
  return rowsOf(`SELECT id, code, label FROM vehicle_categories WHERE is_active ORDER BY sort_order`);
}

/** Today's slots with their numbers per vehicle type, and who holds a pass for each. */
async function today({ placeId = null } = {}) {
  const date = slotTime.nowIST().date;
  const place = placeId
    ? await one(`SELECT * FROM places WHERE id = $1`, [placeId])
    : await one(`SELECT * FROM places WHERE is_active ORDER BY id LIMIT 1`);
  if (!place) return { date, place: null, slots: [] };

  const slots = await rowsOf(
    `SELECT id, code, regexp_replace(label, '[[:space:]]+', ' ', 'g') AS label, label_kn, starts_at, ends_at
       FROM place_slots
      WHERE place_id = $1 AND is_active
        AND (valid_from IS NULL OR valid_from <= $2::date) AND (valid_to IS NULL OR valid_to >= $2::date)
      ORDER BY starts_at, sort_order`, [place.id, date]);
  const cats = await categories();
  const now = slotTime.nowIST();

  const out = [];
  for (const s of slots) {
    const rows = [];
    for (const c of cats) {
      const r = await inventory.ensure(place.id, s.id, c.id, date);
      rows.push({
        categoryId: String(c.id), code: c.code, label: c.label,
        capacity: n(r.capacity), booked: n(r.booked), held: n(r.held),
        remaining: Math.max(0, n(r.capacity) - n(r.booked) - n(r.held)),
        isOpen: r.is_open !== false, closedNote: r.closed_note || null,
      });
    }
    const holders = await one(
      `SELECT count(*) AS passes, count(DISTINCT customer_id) AS visitors FROM tickets
        WHERE slot_id = $1 AND travel_date = $2::date AND status = 'paid'`, [s.id, date]);
    const starts = slotTime.toMinutes(String(s.starts_at).slice(0, 5));
    const ends = slotTime.toMinutes(String(s.ends_at).slice(0, 5));
    out.push({
      slotId: String(s.id), code: s.code, label: s.label, labelKn: s.label_kn || null,
      startsAt: slotTime.hhmm(starts), endsAt: slotTime.hhmm(ends),
      state: now.minutes < starts ? 'upcoming' : now.minutes >= ends ? 'over' : 'open',
      isOpen: rows.every((r) => r.isOpen),
      closedNote: rows.find((r) => !r.isOpen)?.closedNote || null,
      categories: rows,
      /* Passes paid for and not yet used: the people a closure notice goes to. */
      holders: { passes: n(holders.passes), visitors: n(holders.visitors) },
    });
  }
  return { date, place: { id: String(place.id), name: place.name }, slots: out };
}

/** Change one vehicle type's places in one slot, for today only. */
async function setCapacity({ slotId, categoryId, capacity, reason }) {
  const why = requireReason(reason);
  const { slot, today: date } = await slotToday(slotId);
  const cat = await one(`SELECT id, code, label FROM vehicle_categories WHERE id = $1 AND is_active`, [categoryId]);
  if (!cat) refuse('Choose a vehicle type.');
  const value = Number(capacity);
  if (!Number.isInteger(value) || value < 0 || value > 100000) refuse('Enter the number of places as a whole number.');

  const row = await inventory.ensure(slot.place_id, slot.id, cat.id, date);
  const taken = n(row.booked) + n(row.held);
  if (value < taken) {
    refuse(`${taken} ${cat.label} place${taken === 1 ? ' is' : 's are'} already booked or being paid for. The lowest this can go today is ${taken}.`,
      { code: 'below_booked' });
  }
  /* The guard again inside the update, in case a pass is bought between the
     check and the change. */
  const updated = await one(
    `UPDATE slot_inventory SET capacity = $2, modified_at = now()
      WHERE id = $1 AND booked + held <= $2 RETURNING *`, [row.id, value]);
  if (!updated) refuse('A pass was bought for this slot just now. Look at the numbers again and retry.', { status: 409, code: 'changed' });

  return {
    reason: why,
    slot: slot.label, category: cat.label,
    before: n(row.capacity), after: value, remaining: Math.max(0, value - n(updated.booked) - n(updated.held)),
    audit: {
      subject: `slot:${slot.id}:${date}:${cat.code}`,
      before: { capacity: n(row.capacity) }, after: { capacity: value, date, slot: slot.label, category: cat.label },
    },
  };
}

/**
 * Close a slot for today: no more sales, no more entries by booking. The people
 * already holding a pass for it are told, when asked to.
 */
async function closeSlot({ slotId, reason, notify = false, message = '', messageKn = '', adminId = null, sendNotice = null }) {
  const why = requireReason(reason);
  const { slot, today: date } = await slotToday(slotId);
  const text = String(message || '').trim();
  const textKn = String(messageKn || '').trim();
  if (notify && text.length < 10) refuse('Write the notice visitors will receive, in a sentence or two.', { code: 'message_required' });

  const cats = await categories();
  for (const c of cats) await inventory.ensure(slot.place_id, slot.id, c.id, date);

  const holders = await rowsOf(
    `SELECT t.*, cu.name AS customer_name, cu.wa_profile_name, cu.language,
            pl.name AS place_name, pl.name_kn AS place_name_kn,
            regexp_replace(s.label, '[[:space:]]+', ' ', 'g') AS slot_label, s.label_kn AS slot_label_kn
       FROM tickets t
       JOIN customers cu ON cu.id = t.customer_id
       JOIN places pl ON pl.id = t.place_id
       JOIN place_slots s ON s.id = t.slot_id
      WHERE t.slot_id = $1 AND t.travel_date = $2::date AND t.status = 'paid'`, [slot.id, date]);

  /* Asked before anything is written: a closure row is unique per live slot and
     day, so writing first would answer a second attempt with a database error
     instead of a sentence. */
  const open = await one(
    `SELECT count(*) AS n FROM slot_inventory
      WHERE place_id = $1 AND slot_id = $2 AND travel_date = $3::date AND is_open`, [slot.place_id, slot.id, date]);
  if (!n(open.n)) refuse('That slot is already closed today.', { status: 409, code: 'already_closed' });

  await tx(async (c) => {
    await c.query(
      `UPDATE slot_inventory SET is_open = false, closed_note = $4, modified_at = now()
        WHERE place_id = $1 AND slot_id = $2 AND travel_date = $3::date AND is_open`, [slot.place_id, slot.id, date, why.slice(0, 200)]);
    await c.query(
      `INSERT INTO closures (place_id, travel_date, slot_id, reason, kind, tickets_affected, created_by)
       VALUES ($1, $2, $3, $4, 'other', $5, $6)`, [slot.place_id, date, slot.id, why, holders.length, adminId]);
  });

  const notice = notify ? await (sendNotice || notifyHolders)(holders, text, textKn) : null;

  return {
    reason: why,
    slot: slot.label,
    affected: { passes: holders.length, visitors: new Set(holders.map((h) => String(h.customer_id))).size },
    notice,
    audit: {
      subject: `slot:${slot.id}:${date}`,
      before: { open: true },
      after: { open: false, date, slot: slot.label, passesAffected: holders.length, notified: notice ? notice : 'no' },
    },
  };
}

async function reopenSlot({ slotId, reason, adminId = null }) {
  const why = requireReason(reason);
  const { slot, today: date } = await slotToday(slotId);
  const opened = await tx(async (c) => {
    const r = await c.query(
      `UPDATE slot_inventory SET is_open = true, closed_note = NULL, modified_at = now()
        WHERE place_id = $1 AND slot_id = $2 AND travel_date = $3::date AND NOT is_open`, [slot.place_id, slot.id, date]);
    await c.query(
      `UPDATE closures SET lifted_at = now(), lifted_by = $4
        WHERE place_id = $1 AND slot_id = $2 AND travel_date = $3::date AND lifted_at IS NULL`, [slot.place_id, slot.id, date, adminId]);
    return r.rowCount;
  });
  if (!opened) refuse('That slot is not closed today.', { status: 409, code: 'not_closed' });
  return {
    reason: why, slot: slot.label,
    audit: { subject: `slot:${slot.id}:${date}`, before: { open: false }, after: { open: true, date, slot: slot.label } },
  };
}

/**
 * Tell each holder, in their language. The approved template first — it reaches
 * people outside the 24-hour window — and a chat message for those inside it when
 * the template is refused. Counted, so the office knows who was not reached.
 */
async function notifyHolders(holders, text, textKn) {
  const templates = require('../whatsapp/templates');
  const send = require('../whatsapp/send');
  const phone = require('../whatsapp/phone');
  const { langOf } = require('../i18n');
  const L = require('../localize');

  const counts = { total: holders.length, template: 0, chat: 0, notReached: 0, failed: 0 };
  for (const t of holders) {
    const lang = langOf({ language: t.language });
    const words = lang === 'kn' && textKn ? textKn : text;
    const to = phone.toWa(t.mobile);
    try {
      const sent = await templates.sendSlotNotice(to, t, words, lang);
      if (sent && sent.ok) { counts.template += 1; continue; }
      if (await send.windowOpen(to)) {
        const line = lang === 'kn'
          ? `ನಿಮ್ಮ ಪ್ರವೇಶ ಪಾಸ್ ${t.ticket_no} (${L.placeName(t, lang)}, ${L.longDate(t.travel_date, lang)}, ${L.slotLabel(t, lang)}) ಕುರಿತು: ${words}`
          : `About your entry pass ${t.ticket_no} (${L.placeName(t, lang)}, ${L.longDate(t.travel_date, lang)}, ${L.slotLabel(t, lang)}): ${words}`;
        const chat = await send.text(to, line);
        if (chat && chat.ok !== false) counts.chat += 1; else counts.failed += 1;
      } else {
        counts.notReached += 1;
      }
    } catch (e) {
      console.error('[capacityToday] notice to %s: %s', t.ticket_no, e.message);
      counts.failed += 1;
    }
  }
  return counts;
}

module.exports = { Refusal, today, setCapacity, closeSlot, reopenSlot, notifyHolders };
