/**
 * checkin.js — what happens when a vehicle reaches the gate.
 *
 * The visitor was promised they need do nothing at the checkpost: staff look up
 * the vehicle and record the entry. So this module answers two questions, in
 * this order, and keeps a record of both:
 *
 *   1. May this vehicle go in?  — a verdict, always, even when the answer is no
 *   2. It went in.              — the ticket becomes 'used', once, and the
 *                                 visitor is told on WhatsApp
 *
 * EVERY LOOK-UP IS RECORDED, NOT ONLY THE SUCCESSFUL ONES. A refused vehicle is
 * the row that matters in a dispute — someone will say they were turned away
 * wrongly — so scans keeps the verdict, the plate as typed, who was on duty and
 * when. That is also the day's count of how many arrived without a pass.
 *
 * THE VERDICTS. Blocking ones are facts the gate cannot wave through: no such
 * pass, unpaid, cancelled, already used, a pass for another place, a pass for
 * another day. 'wrong_slot' is different — a visitor half an hour outside their
 * slot is an argument, not a forgery — so it is a warning the staff member can
 * override, and the override is written into the row with their name on it.
 *
 * MARKING USED IS ATOMIC. Two phones at the same gate, or a double tap, must not
 * produce two entries: the update only succeeds from 'paid', and whoever loses
 * the race is told the pass is already used and when.
 */

const { query, one, tx } = require('./db');
const slotTime = require('./slotTime');
const booking = require('./booking');
const plate = require('../ulip/plate');

/** query() hands back a pg result; every list here wants the rows. */
const rowsOf = async (text, params) => (await query(text, params)).rows;

/* The gate is only ever interested in a pass that was paid for. */
const LIST_COLUMNS = `
  t.id, t.ticket_no, t.reg_no, t.travel_date, t.status, t.used_at, t.mobile,
  t.total_paise, t.place_id,
  s.code AS slot_code, regexp_replace(s.label, '[[:space:]]+', ' ', 'g') AS slot_label,
  s.label_kn AS slot_label_kn, s.starts_at, s.ends_at,
  c.code AS category_code, c.label AS category_label, c.label_kn AS category_label_kn,
  v.maker, v.model, cu.name AS customer_name, cu.wa_profile_name`;

const LIST_FROM = `
  FROM tickets t
  JOIN place_slots s ON s.id = t.slot_id
  JOIN vehicle_categories c ON c.id = t.category_id
  JOIN vehicles v ON v.id = t.vehicle_id
  JOIN customers cu ON cu.id = t.customer_id`;

const shape = (r) => ({
  id: String(r.id),
  ticketNo: r.ticket_no,
  regNo: r.reg_no,
  travelDate: r.travel_date instanceof Date ? r.travel_date.toISOString().slice(0, 10) : String(r.travel_date),
  status: r.status,
  usedAt: r.used_at,
  slot: { code: r.slot_code, label: r.slot_label, startsAt: r.starts_at, endsAt: r.ends_at },
  category: { code: r.category_code, label: r.category_label },
  vehicle: [r.maker, r.model].filter(Boolean).join(' ') || null,
  visitor: r.customer_name || r.wa_profile_name || null,
  mobile: r.mobile ? `••••${String(r.mobile).slice(-4)}` : null,
  amount: (r.total_paise / 100).toFixed(0),
});

/** Today at this gate, in the order the gate cares about: still to come, then arrived. */
async function arrivals(checkpost, date) {
  const day = date || slotTime.nowIST().date;
  const rows = await rowsOf(
    `SELECT ${LIST_COLUMNS} ${LIST_FROM}
      WHERE t.place_id = $1 AND t.travel_date = $2 AND t.status IN ('paid', 'used')
      ORDER BY (t.status = 'used'), s.starts_at, t.ticket_no`,
    [checkpost.place_id, day]);

  const list = rows.map(shape);
  const bySlot = new Map();
  for (const p of list) {
    const k = p.slot.code;
    if (!bySlot.has(k)) bySlot.set(k, { code: k, label: p.slot.label, expected: 0, entered: 0 });
    const s = bySlot.get(k);
    s.expected += 1;
    if (p.status === 'used') s.entered += 1;
  }

  return {
    date: day,
    passes: list,
    totals: {
      expected: list.length,
      entered: list.filter((p) => p.status === 'used').length,
      pending: list.filter((p) => p.status !== 'used').length,
      slots: [...bySlot.values()],
    },
  };
}

/**
 * Find a pass from whatever the staff member typed.
 *
 * A plate is what they can read off the vehicle, so that is the primary key
 * here: full or partial, with or without spaces. Four or more characters of a
 * plate matches on the ending, which is how people read out "…7 8 1 4 7". A
 * pass number is accepted too, for the visitor who holds up their phone.
 */
async function search(checkpost, q, { date } = {}) {
  const raw = String(q || '').trim();
  if (raw.length < 3) return { ok: false, error: 'too_short', message: 'Type at least 3 characters.' };

  const day = date || slotTime.nowIST().date;
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');

  /* A pass number first, when it looks like one: it identifies exactly one pass
     on any date, which a plate does not. */
  const byPass = booking.passNumberCandidates ? booking.passNumberCandidates(cleaned) : [];
  if (byPass.length) {
    const rows = await rowsOf(
      `SELECT ${LIST_COLUMNS} ${LIST_FROM} WHERE t.ticket_no = ANY($1::text[]) AND t.status IN ('paid','used')`,
      [byPass]);
    if (rows.length) return { ok: true, matchedOn: 'pass', passes: rows.map(shape) };
  }

  const parsed = plate.parse(cleaned);
  const full = parsed.ok ? parsed.regNo : null;

  const rows = await rowsOf(
    `SELECT ${LIST_COLUMNS} ${LIST_FROM}
      WHERE t.status IN ('paid','used')
        AND (t.reg_no = $1 OR t.reg_no LIKE $2)
        AND t.travel_date BETWEEN ($3::date - 1) AND ($3::date + 1)
      ORDER BY (t.travel_date = $3::date) DESC, t.travel_date, s.starts_at
      LIMIT 25`,
    [full || cleaned, `%${cleaned}`, day]);

  return { ok: true, matchedOn: 'vehicle', passes: rows.map(shape) };
}

/** Everything the gate screen shows for one pass, plus its verdict here and now. */
async function inspect(checkpost, ticketNo) {
  const t = await booking.byTicketNo(ticketNo);
  if (!t) {
    return { found: false, verdict: 'unknown_ticket', blocking: true,
      message: 'No pass found with that number.' };
  }
  return { found: true, pass: detail(t), ...verdictFor(checkpost, t) };
}

function detail(t) {
  return {
    ...shape(t),
    place: { id: String(t.place_id), name: t.place_name, district: t.district },
    vehicle: {
      regNo: t.reg_no,
      description: [t.maker, t.model].filter(Boolean).join(' ') || null,
      type: t.category_label,
      fuel: t.fuel, colour: t.colour,
    },
    paidAt: t.paid_at || t.payment_created_at || null,
  };
}

/**
 * The verdict, given where this gate is and what time it is.
 *
 * Order matters: the most fundamental objection is reported, not the first one
 * noticed. A pass for another place on another day is "wrong place" — telling
 * the visitor the date is wrong would send them back tomorrow to the same wrong
 * gate.
 */
function verdictFor(checkpost, t) {
  const block = (verdict, message) => ({ verdict, blocking: true, message });
  const today = slotTime.nowIST().date;
  const travelDate = t.travel_date instanceof Date
    ? t.travel_date.toISOString().slice(0, 10) : String(t.travel_date);

  if (t.status === 'cancelled') return block('cancelled', 'This pass was cancelled.');
  if (t.status === 'used') {
    return { verdict: 'already_used', blocking: true, usedAt: t.used_at,
      message: 'This pass has already been used for entry.' };
  }
  if (t.status !== 'paid') return block('not_paid', 'This pass was never paid for. It is not valid.');
  if (String(t.place_id) !== String(checkpost.place_id)) {
    return block('wrong_place', `This pass is for ${t.place_name}, not this checkpost.`);
  }
  if (travelDate !== today) {
    return block('wrong_day', travelDate > today
      ? `This pass is for a later date (${travelDate}). It is not valid today.`
      : `This pass was for ${travelDate}. It has expired.`);
  }

  /* Inside the slot? The same window the booking sold: entry closes an hour
     before the slot ends, and the slot has not started yet if they are early. */
  const mins = slotTime.nowIST().minutes;
  const startsAt = slotTime.toMinutes(String(t.starts_at).slice(0, 5));
  const lastEntry = slotTime.toMinutes(String(t.ends_at).slice(0, 5)) - slotTime.LAST_ENTRY_BUFFER_MIN;

  if (mins < startsAt) {
    return { verdict: 'wrong_slot', blocking: false, overridable: true,
      message: `Their slot starts at ${slotTime.hhmm(startsAt)}. They are early.` };
  }
  if (mins > lastEntry) {
    return { verdict: 'wrong_slot', blocking: false, overridable: true,
      message: `Last entry for this slot was ${slotTime.hhmm(lastEntry)}. They are late.` };
  }
  return { verdict: 'valid', blocking: false, message: 'Valid for entry.' };
}

/**
 * Record the entry.
 *
 * The scan row is written whatever the verdict; the ticket only moves to 'used'
 * when entry actually happened. The WhatsApp confirmation is sent afterwards and
 * is not allowed to fail the entry: the vehicle is already through the gate, and
 * a template that did not send is a message to retry, not a reason to stop a
 * queue.
 */
async function record({ session, checkpost, ticketNo, regNo, override = false, rawPayload = null, durationMs = null }) {
  const t = ticketNo ? await booking.byTicketNo(ticketNo) : null;

  if (!t) {
    await logScan({ session, checkpost, ticket: null, ticketNo, regNo, verdict: 'unknown_ticket', rawPayload, durationMs });
    return { ok: false, verdict: 'unknown_ticket', message: 'No pass found with that number.' };
  }

  const v = verdictFor(checkpost, t);

  if (v.blocking) {
    await logScan({ session, checkpost, ticket: t, verdict: v.verdict, rawPayload, durationMs });
    return { ok: false, verdict: v.verdict, message: v.message, usedAt: v.usedAt || null, pass: detail(t) };
  }
  if (v.verdict === 'wrong_slot' && !override) {
    /* Not logged yet: nothing happened, the staff member is being asked. The
       scan is written when they decide. */
    return { ok: false, verdict: 'wrong_slot', needsOverride: true, message: v.message, pass: detail(t) };
  }

  /* Only 'paid' becomes 'used', so a second tap loses and is told so. */
  const claimed = await tx(async (client) => {
    const { rows } = await client.query(
      `UPDATE tickets SET status = 'used', used_at = now(), modified_at = now()
        WHERE id = $1 AND status = 'paid'
        RETURNING used_at`, [t.id]);
    if (!rows.length) return null;

    await client.query(
      `INSERT INTO scans (ticket_id, ticket_no, reg_no, checkpost_id, staff_id, device_id, session_id, verdict,
                          raw_payload, duration_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [t.id, t.ticket_no, t.reg_no, checkpost.id, session.staff_id, null, session.session_id,
        override ? 'valid_override' : 'valid',
        JSON.stringify({ typed: rawPayload, override: override || undefined, slotVerdict: v.verdict }),
        sane(durationMs)]);
    return rows[0].used_at;
  });

  if (!claimed) {
    const fresh = await booking.byTicketNo(t.ticket_no);
    await logScan({ session, checkpost, ticket: t, verdict: 'already_used', rawPayload, durationMs });
    return { ok: false, verdict: 'already_used', usedAt: fresh ? fresh.used_at : null,
      message: 'This pass was recorded a moment ago.', pass: detail(fresh || t) };
  }

  notify(t, checkpost, claimed).catch((e) => console.error('[checkin] notify %s: %s', t.ticket_no, e.message));

  return { ok: true, verdict: override ? 'valid_override' : 'valid', usedAt: claimed,
    message: 'Entry recorded.', pass: { ...detail(t), status: 'used', usedAt: claimed } };
}

/** The visitor's copy: the approved template, in the language they chose. */
async function notify(t, checkpost, recordedAt) {
  const templates = require('../whatsapp/templates');
  const phone = require('../whatsapp/phone');
  const customer = await one('SELECT language FROM customers WHERE id = $1', [t.customer_id]);
  const lang = customer && customer.language === 'kn' ? 'kn' : 'en';
  await templates.sendEntryRecorded(phone.toWa(t.mobile), t, { checkpost, recordedAt }, lang);
}

/* A phone left open on a pass for an hour is not a one-hour check; it is a
   phone left open. Anything outside a plausible range is stored as unmeasured
   rather than allowed to drag every average with it. */
const sane = (ms) => (Number.isFinite(Number(ms)) && ms >= 0 && ms <= 10 * 60 * 1000 ? Math.round(ms) : null);

function logScan({ session, checkpost, ticket, ticketNo, regNo, verdict, rawPayload, durationMs = null }) {
  return query(
    `INSERT INTO scans (ticket_id, ticket_no, reg_no, checkpost_id, staff_id, session_id, verdict, raw_payload, duration_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [ticket ? ticket.id : null, ticket ? ticket.ticket_no : (ticketNo || null),
      ticket ? ticket.reg_no : (regNo || null), checkpost.id, session.staff_id, session.session_id,
      verdict, rawPayload ? JSON.stringify({ typed: rawPayload }) : null, sane(durationMs)]);
}

/** The shift's own log — what this phone has recorded, most recent first. */
async function recent(checkpost, { limit = 25 } = {}) {
  const rows = await rowsOf(
    `SELECT sc.verdict, sc.scanned_at, sc.ticket_no, sc.reg_no, s.name AS staff_name,
            c.label AS category_label, cu.name AS customer_name, cu.wa_profile_name
       FROM scans sc
       LEFT JOIN staff s ON s.id = sc.staff_id
       LEFT JOIN tickets t ON t.id = sc.ticket_id
       LEFT JOIN vehicle_categories c ON c.id = t.category_id
       LEFT JOIN customers cu ON cu.id = t.customer_id
      WHERE sc.checkpost_id = $1 AND sc.scanned_at >= date_trunc('day', now())
      ORDER BY sc.scanned_at DESC
      LIMIT $2`, [checkpost.id, limit]);

  return rows.map((r) => ({
    verdict: r.verdict,
    at: r.scanned_at,
    ticketNo: r.ticket_no,
    regNo: r.reg_no,
    by: r.staff_name,
    type: r.category_label,
    visitor: r.customer_name || r.wa_profile_name || null,
  }));
}

module.exports = { arrivals, search, inspect, record, recent, verdictFor };
