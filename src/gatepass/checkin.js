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
  t.total_paise, t.place_id, t.entry_source,
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
  /* 'gate' when a staff member checked it, 'self' when the visitor recorded it
     themselves at the payment sheet — the screens say which, because they are
     not the same fact. */
  entrySource: r.entry_source || null,
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
    /*
     * Unless the visitor recorded it themselves when paying.
     *
     * They ticked "I am already at the checkpost" and their phone agreed they
     * were — but nobody at the gate has seen the vehicle. Refusing them here
     * would be the system disbelieving its own feature, and would punish a
     * visitor for using it. So it is not blocking: the staff member is told what
     * happened and can check the vehicle and confirm, which replaces an
     * unwitnessed entry with a witnessed one.
     *
     * A pass a staff member already checked is still refused, exactly as before.
     * One pass is one entry.
     */
    if (t.entry_source === 'self') {
      return { verdict: 'self_declared', blocking: false, selfDeclared: true, usedAt: t.used_at,
        message: 'The visitor recorded this entry themselves when paying. Check the vehicle and confirm.' };
    }
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

  /*
   * Only 'paid' becomes 'used', so a second tap loses and is told so — with one
   * exception: a pass the visitor checked in themselves is already 'used', and
   * confirming it at the barrier is not a second entry but the first witnessed
   * one. That writes 'gate' over 'self': the stronger fact replaces the weaker,
   * and the pass can never be confirmed twice because it is no longer 'self'.
   */
  const selfDeclared = t.status === 'used' && t.entry_source === 'self';
  const claimed = await tx(async (client) => {
    const { rows } = await client.query(
      selfDeclared
        ? `UPDATE tickets SET entry_source = 'gate', modified_at = now()
            WHERE id = $1 AND status = 'used' AND entry_source = 'self'
            RETURNING used_at`
        : `UPDATE tickets SET status = 'used', used_at = now(), entry_source = 'gate', modified_at = now()
            WHERE id = $1 AND status = 'paid'
            RETURNING used_at`, [t.id]);
    if (!rows.length) return null;

    await client.query(
      `INSERT INTO scans (ticket_id, ticket_no, reg_no, checkpost_id, staff_id, device_id, session_id, verdict,
                          raw_payload, duration_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [t.id, t.ticket_no, t.reg_no, checkpost.id, session.staff_id, null, session.session_id,
        override ? 'valid_override' : 'valid',
        JSON.stringify({ typed: rawPayload, override: override || undefined, slotVerdict: v.verdict,
          confirmedSelfCheckin: selfDeclared || undefined }),
        sane(durationMs)]);
    return rows[0].used_at;
  });

  if (!claimed) {
    const fresh = await booking.byTicketNo(t.ticket_no);
    await logScan({ session, checkpost, ticket: t, verdict: 'already_used', rawPayload, durationMs });
    require('../log').gate('already_used', `already used — ${t.ticket_no} · ${t.reg_no}`);
    return { ok: false, verdict: 'already_used', usedAt: fresh ? fresh.used_at : null,
      message: 'This pass was recorded a moment ago.', pass: detail(fresh || t) };
  }

  require('../log').gate(override ? 'valid_override' : 'valid',
    `${t.ticket_no}  ${t.reg_no} · ${checkpost.name}${durationMs ? ` · ${(sane(durationMs) / 1000).toFixed(1)}s` : ''}`);

  notify(t, checkpost, claimed).catch((e) => console.error('[checkin] notify %s: %s', t.ticket_no, e.message));

  return { ok: true, verdict: override ? 'valid_override' : 'valid', usedAt: claimed,
    message: selfDeclared ? 'Checked. Their own entry is now confirmed by you.' : 'Entry recorded.',
    pass: { ...detail(t), status: 'used', usedAt: claimed } };
}

/** The visitor's copy: the approved template, in the language they chose. */
async function notify(t, checkpost, recordedAt) {
  const templates = require('../whatsapp/templates');
  const phone = require('../whatsapp/phone');
  const send = require('../whatsapp/send');
  const { t: tr, langOf } = require('../i18n');
  const customer = await one('SELECT language FROM customers WHERE id = $1', [t.customer_id]);
  /* The same rule every other message uses, so the entry template, the feedback
     template and the chat can never disagree about which language a visitor reads. */
  const lang = langOf(customer);
  const to = phone.toWa(t.mobile);
  await templates.sendEntryRecorded(to, t, { checkpost, recordedAt }, lang);

  /*
   * AND, HAVING JUST ARRIVED, ASKED HOW IT WENT.
   *
   * This is the moment worth asking: they are through the barrier, the queue is
   * behind them, and the answer is about something that has actually happened.
   *
   * THE APPROVED TEMPLATE FIRST. Most visitors booked the night before and are
   * outside WhatsApp's 24-hour window by the time they reach the gate, where a
   * free message is not delivered at all — so a template is the only thing that
   * reaches the people most worth asking. It costs a template send per entry;
   * that was a decision, made knowingly.
   *
   * THE BUTTONS AS A FALLBACK, inside the window only. Until Meta approves the
   * template, or on any day it refuses one, the ask goes the old way to whoever
   * can still receive a free message. Nothing needs switching when approval
   * lands: the template simply starts succeeding.
   *
   * AND IT NEVER AFFECTS THE ENTRY. The vehicle is already through. A failure
   * here is logged and forgotten.
   */
  try {
    const webToken = require('./webToken');
    const token = await webToken.issue(t.customer_id, 'feedback');
    const sent = await templates.sendFeedbackRequest(to, t, token, lang);

    if (!sent || !sent.ok) {
      console.warn('[checkin] feedback template not sent for %s (%s) — %s', t.ticket_no,
        sent && sent.error ? sent.error : 'no answer',
        'falling back to buttons if the chat window is open');
      if (await send.windowOpen(to)) {
        await send.buttons(to, tr('rateAsk', lang), [{ id: 'FEEDBACK', title: tr('btnRate', lang) }]);
      }
    }
  } catch (e) {
    console.error('[checkin] could not ask %s for feedback: %s', t.ticket_no, e.message);
  }
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


/**
 * The log, further back than the shift.
 *
 * "Did that car go through yesterday?" and "what happened with this number
 * plate?" are asked at a gate constantly, and until now the app could only
 * answer for today. Paged by the moment of the check so a long day does not
 * arrive in one lump, and searchable by plate or pass number, because that is
 * what staff have in front of them.
 *
 * It is this checkpost's own log. A gate is not given the run of every other
 * gate's activity — that is the panel's job, not a phone's.
 */
async function history(checkpost, { q = null, verdict = null, before = null, limit = 30 } = {}) {
  const size = Math.max(1, Math.min(100, Number(limit) || 30));
  const term = String(q || '').trim();
  const plate = term.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const cursor = before && /^\d+$/.test(String(before)) ? String(before) : null;

  const rows = await rowsOf(
    `SELECT sc.id, sc.verdict, sc.scanned_at, sc.ticket_no, sc.reg_no, sc.duration_ms,
            s.name AS staff_name, c.label AS category_label, t.travel_date,
            regexp_replace(sl.label, '[[:space:]]+', ' ', 'g') AS slot_label,
            cu.name AS customer_name, cu.wa_profile_name
       FROM scans sc
       LEFT JOIN staff s ON s.id = sc.staff_id
       LEFT JOIN tickets t ON t.id = sc.ticket_id
       LEFT JOIN place_slots sl ON sl.id = t.slot_id
       LEFT JOIN vehicle_categories c ON c.id = t.category_id
       LEFT JOIN customers cu ON cu.id = t.customer_id
      WHERE sc.checkpost_id = $1
        AND ($2::bigint IS NULL OR sc.id < $2::bigint)
        AND ($3::text IS NULL OR sc.verdict = $3
             OR ($3 = 'entered' AND sc.verdict IN ('valid','valid_override'))
             OR ($3 = 'refused' AND sc.verdict NOT IN ('valid','valid_override')))
        AND ($4::text IS NULL
             OR sc.reg_no LIKE '%' || $4 || '%'
             OR sc.ticket_no = ANY($5::text[]))
      ORDER BY sc.scanned_at DESC, sc.id DESC
      LIMIT $6`,
    [checkpost.id, cursor, verdict || null, plate || null,
      booking.passNumberCandidates(term), size + 1]);

  const hasMore = rows.length > size;
  const page = hasMore ? rows.slice(0, size) : rows;

  return {
    checks: page.map((r) => ({
      id: String(r.id),
      verdict: r.verdict,
      at: r.scanned_at,
      ticketNo: r.ticket_no,
      regNo: r.reg_no,
      by: r.staff_name,
      type: r.category_label,
      slot: r.slot_label,
      travelDate: r.travel_date ? String(r.travel_date instanceof Date ? r.travel_date.toISOString() : r.travel_date).slice(0, 10) : null,
      visitor: r.customer_name || r.wa_profile_name || null,
      seconds: r.duration_ms === null || r.duration_ms === undefined ? null : Math.round(Number(r.duration_ms) / 100) / 10,
    })),
    hasMore,
    nextCursor: hasMore && page.length ? String(page[page.length - 1].id) : null,
  };
}

/**
 * One vehicle, everything this gate has seen of it.
 *
 * The question behind it is usually suspicion — the same plate twice in a
 * morning, or a pass that did not work — so the refusals matter as much as the
 * entries, and both are shown in one line of history.
 */
async function vehicle(checkpost, regNoInput) {
  const regNo = String(regNoInput || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (regNo.length < 4) return { ok: false, error: 'short', message: 'Type at least four characters of the number plate.' };

  const checks = await rowsOf(
    `SELECT sc.verdict, sc.scanned_at, sc.ticket_no, sc.duration_ms, s.name AS staff_name
       FROM scans sc LEFT JOIN staff s ON s.id = sc.staff_id
      WHERE sc.checkpost_id = $1 AND sc.reg_no = $2
      ORDER BY sc.scanned_at DESC LIMIT 40`, [checkpost.id, regNo]);

  const passes = await rowsOf(
    `SELECT t.ticket_no, t.travel_date, t.status, t.used_at,
            regexp_replace(sl.label, '[[:space:]]+', ' ', 'g') AS slot_label, c.label AS category_label
       FROM tickets t
       JOIN place_slots sl ON sl.id = t.slot_id
       JOIN vehicle_categories c ON c.id = t.category_id
      WHERE t.reg_no = $1 AND t.place_id = $2
      ORDER BY t.travel_date DESC LIMIT 20`, [regNo, checkpost.place_id]);

  const v = await one(
    `SELECT maker, model, colour, fuel, vehicle_class FROM vehicles WHERE reg_no = $1`, [regNo]);

  return {
    ok: true,
    regNo,
    vehicle: v ? { maker: v.maker, model: v.model, colour: v.colour, fuel: v.fuel, vehicleClass: v.vehicle_class } : null,
    entries: checks.filter((c) => c.verdict === 'valid' || c.verdict === 'valid_override').length,
    refusals: checks.filter((c) => c.verdict !== 'valid' && c.verdict !== 'valid_override').length,
    checks: checks.map((c) => ({
      verdict: c.verdict, at: c.scanned_at, ticketNo: c.ticket_no, by: c.staff_name,
      seconds: c.duration_ms === null || c.duration_ms === undefined ? null : Math.round(Number(c.duration_ms) / 100) / 10,
    })),
    passes: passes.map((p) => ({
      ticketNo: p.ticket_no,
      travelDate: String(p.travel_date instanceof Date ? p.travel_date.toISOString() : p.travel_date).slice(0, 10),
      status: p.status, usedAt: p.used_at, slot: p.slot_label, type: p.category_label,
    })),
  };
}

/**
 * Every pass for a day at this gate — expected, entered, and who booked it.
 *
 * WHY THE GATE NEEDS MORE THAN A PLATE. The shift log answers "did that car go
 * through?". This answers the questions that come after it, usually with a
 * visitor standing there: who booked this, when, how, what did they pay, is
 * this the pass they moved from Saturday, and did somebody at this gate decide
 * the vehicle type rather than the register. All of it is already in the
 * booking; it was simply never carried out to the barrier.
 *
 * ANY DAY, NOT JUST TODAY. The gate screen deliberately shows today only — that
 * is the work in front of them. This is the record: pick a date, or search a
 * plate and see every pass it has ever held here.
 *
 * WHAT IS DELIBERATELY NOT HERE. The full mobile number: staff see the last
 * four digits, enough to confirm against a visitor reading theirs out, and not
 * enough to be a list of phone numbers walking around on a phone. The same rule
 * the rest of the gate app follows.
 */
async function passes(checkpost, { date = null, status = null, q = '', limit = 50, offset = 0 } = {}) {
  const size = Math.max(1, Math.min(100, Number(limit) || 50));
  const skip = Math.max(0, Number(offset) || 0);
  const term = String(q || '').trim();
  const cleaned = term.toUpperCase().replace(/[^A-Z0-9]/g, '');
  /* A plate search ignores the date: "has this vehicle ever been here?" is not
     a question about one day. Everything else is that day's list. */
  const day = cleaned.length >= 3 ? null : (date || slotTime.nowIST().date);

  const rows = await rowsOf(
    `SELECT ${LIST_COLUMNS},
            t.created_at, t.category_declared, t.declared_reason,
            t.moved_from_date, t.moved_at, t.entry_paise, t.platform_paise, t.gst_paise,
            regexp_replace(msl.label, '[[:space:]]+', ' ', 'g') AS moved_from_slot,
            cu.wa_id, cu.language,
            v.identified_by, v.identity_kind, v.identity_note, v.colour,
            pay.gateway, pay.payment_id, pay.paid_at, pay.status AS payment_status,
            g.kind AS grant_kind, g.payment_method, g.payment_reference, g.reason AS grant_reason,
            gs.name AS sold_by_staff, gu.name AS sold_by_admin,
            ent.staff_name AS entered_by, ent.checkpost_name AS entered_at_gate,
            (SELECT count(*) FROM scans sc WHERE sc.ticket_id = t.id) AS checks,
            (SELECT COALESCE(json_agg(json_build_object('id', ph.id, 'kind', ph.kind) ORDER BY ph.id), '[]')
               FROM gate_photos ph WHERE ph.ticket_id = t.id) AS photos,
            count(*) OVER () AS total_rows
       ${LIST_FROM}
       LEFT JOIN place_slots msl ON msl.id = t.moved_from_slot_id
       LEFT JOIN payments pay ON pay.id = t.payment_id
       LEFT JOIN ticket_grants g ON g.ticket_id = t.id
       LEFT JOIN staff gs ON gs.id = g.issued_by_staff
       LEFT JOIN admin_users gu ON gu.id = g.issued_by
       LEFT JOIN LATERAL (
         SELECT st.name AS staff_name, cp.name AS checkpost_name
           FROM scans sc
           LEFT JOIN staff st ON st.id = sc.staff_id
           LEFT JOIN checkposts cp ON cp.id = sc.checkpost_id
          WHERE sc.ticket_id = t.id AND sc.verdict IN ('valid','valid_override')
          ORDER BY sc.scanned_at LIMIT 1
       ) ent ON true
      WHERE t.place_id = $1
        AND t.status IN ('paid', 'used')
        AND ($2::date IS NULL OR t.travel_date = $2::date)
        AND ($3::text IS NULL
             OR (t.reg_no = $3 OR t.reg_no LIKE '%' || $3)
             OR t.ticket_no = ANY($4::text[])
             OR cu.name ILIKE '%' || $5 || '%')
        AND ($6::text IS NULL
             OR ($6 = 'entered' AND t.status = 'used')
             OR ($6 = 'expected' AND t.status <> 'used'))
      ORDER BY (t.status = 'used'), s.starts_at, t.travel_date DESC, t.ticket_no
      LIMIT $7 OFFSET $8`,
    [checkpost.place_id, day, cleaned || null, booking.passNumberCandidates(term),
      term || null, ['entered', 'expected'].includes(status) ? status : null, size, skip]);

  /* How a pass came to exist, in the words a staff member would use. */
  const how = (r) => {
    if (r.grant_kind === 'free') return 'Complimentary pass';
    if (r.grant_kind === 'onspot') return r.sold_by_staff ? `Sold at the gate by ${r.sold_by_staff}` : 'Sold on the spot';
    if (r.wa_id) return 'Booked on WhatsApp';
    return 'Booked online';
  };

  return {
    date: day,
    searched: cleaned.length >= 3 ? term : null,
    total: rows.length ? Number(rows[0].total_rows) : 0,
    passes: rows.map((r) => ({
      ...shape(r),
      colour: r.colour || null,
      booked: {
        at: r.created_at,
        how: how(r),
        by: r.customer_name || r.wa_profile_name || null,
        language: r.language || null,
        declared: r.category_declared === true,
        declaredReason: r.declared_reason || null,
        identifiedBy: r.identified_by,
        identity: r.identity_note ? { kind: r.identity_kind, value: r.identity_note } : null,
      },
      paid: {
        total: Math.round(Number(r.total_paise || 0) / 100),
        entry: Math.round(Number(r.entry_paise || 0) / 100),
        fee: Math.round((Number(r.platform_paise || 0) + Number(r.gst_paise || 0)) / 100),
        method: r.payment_method || r.gateway || null,
        reference: r.payment_reference || r.payment_id || null,
        at: r.paid_at || null,
        status: r.payment_status || (r.grant_kind ? 'collected' : null),
      },
      entered: r.used_at ? { at: r.used_at, by: r.entered_by || null, gate: r.entered_at_gate || null } : null,
      moved: r.moved_from_date
        ? { fromDate: String(r.moved_from_date instanceof Date ? r.moved_from_date.toISOString() : r.moved_from_date).slice(0, 10),
            fromSlot: r.moved_from_slot || null, at: r.moved_at }
        : null,
      checks: Number(r.checks || 0),
      photos: (r.photos || []).map((ph) => ({ id: String(ph.id), kind: ph.kind })),
    })),
  };
}

module.exports = { arrivals, search, inspect, record, recent, history, passes, vehicle, verdictFor, notify };
