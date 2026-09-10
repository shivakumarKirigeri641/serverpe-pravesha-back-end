/**
 * scan.js — the decision at the barrier.
 *
 * Eight verdicts, kept separate on purpose. A single "invalid" would be easier
 * to write and useless in practice: the staff member has a car in front of them
 * and needs to know whether to send it back, wave it through, or call someone.
 * A forged ticket and a Tuesday ticket demand completely different responses.
 *
 *   valid              let them in
 *   already_used       this QR came through already — likely a shared copy
 *   wrong_day          genuine ticket, wrong date
 *   wrong_slot         genuine ticket, other half of the day
 *   wrong_place        genuine ticket for a different gate
 *   cancelled          refunded or cancelled
 *   invalid_signature  edited or fabricated — THE FRAUD
 *   unknown_ticket     signature fine but no such ticket here (a stale key, or
 *                      a ticket from another deployment)
 *
 * ORDER MATTERS. The signature is checked FIRST, before any database lookup,
 * because it is the check that works with no network and because a forged
 * ticket must never be graded on its contents.
 *
 * EVERY SCAN IS RECORDED, including every rejection. The rejections are the
 * evidence the system is doing its job — a weekly report showing eleven edited
 * tickets caught is what justifies the whole thing to the department.
 */

const { query, one, tx } = require('./db');
const sign = require('./sign');
const settings = require('./settings');

const GRACE_MINUTES = 60;   // late arrivals are normal; a whole slot is not

/**
 * Decide on one scanned payload.
 *
 * @param raw      exactly what the camera read
 * @param session  the staff session doing the scanning
 * @param at       when it was scanned — NOT when it reached us. A scan taken
 *                 offline at 07:10 and synced at 11:00 must be judged against
 *                 07:10, or every offline scan would be graded wrong.
 */
async function decide(raw, session, at = new Date()) {
  const v = sign.verifyTicket(raw);

  if (!v.ok) {
    return {
      verdict: 'invalid_signature',
      reason: v.reason,
      message: v.reason === 'signature'
        ? 'This ticket has been altered. Do not allow entry.'
        : 'This is not a valid ticket QR code.',
    };
  }

  const p = v.ticket;
  const t = await one(
    `SELECT t.*, pl.code AS place_code, pl.name AS place_name,
            s.code AS slot_code, s.label AS slot_label, s.starts_at, s.ends_at,
            c.label AS category_label
       FROM tickets t
       JOIN places pl ON pl.id = t.place_id
       JOIN place_slots s ON s.id = t.slot_id
       JOIN vehicle_categories c ON c.id = t.category_id
      WHERE t.ticket_no = $1`, [p.ticket_no]);

  if (!t) return { verdict: 'unknown_ticket', payload: p,
    message: 'Signature is valid but this ticket is not in the system.' };

  // A signature covers the plate, so a mismatch here means the row and the QR
  // disagree — which should be impossible. Treat it as tampering, not as data.
  if (t.reg_no !== p.reg_no) {
    return { verdict: 'invalid_signature', ticket: t, payload: p,
      message: 'Ticket does not match our record. Do not allow entry.' };
  }

  if (t.status === 'cancelled') return { verdict: 'cancelled', ticket: t,
    message: 'This ticket was cancelled.' };

  if (t.status === 'used') return {
    verdict: 'already_used', ticket: t, used_at: t.used_at,
    message: `Already scanned at ${new Date(t.used_at).toLocaleTimeString('en-IN')}. ` +
             'A copy of this ticket has been used.',
  };

  if (t.status !== 'paid') return { verdict: 'unknown_ticket', ticket: t,
    message: 'This ticket was never paid for.' };

  /* Right gate? */
  if (session?.place_id && Number(t.place_id) !== Number(session.place_id)) {
    return { verdict: 'wrong_place', ticket: t,
      message: `This ticket is for ${t.place_name}.` };
  }

  /* Right day? Compared in local terms, because a gate opens at 6 a.m. local. */
  const scanDate = localDate(at);
  if (String(t.travel_date) !== scanDate) {
    return { verdict: 'wrong_day', ticket: t,
      message: `This ticket is for ${t.travel_date}, not today.` };
  }

  /* Right half of the day? */
  const grace = await settings.num('slot_grace_minutes', GRACE_MINUTES);
  if (!withinSlot(at, t.starts_at, t.ends_at, grace)) {
    return { verdict: 'wrong_slot', ticket: t,
      message: `Too early — this ticket is for ${t.slot_label}.` };
  }

  return { verdict: 'valid', ticket: t,
    message: `${t.reg_no} · ${t.category_label} · ${t.slot_label}` };
}

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * LATE IS FINE, EARLY IS NOT.
 *
 * A morning ticket arriving at 2 p.m. is someone who set off late. They already
 * paid, their place in the morning slot was counted, and turning them away
 * gains the hill nothing — so the ticket stays valid to the end of the day.
 *
 * An afternoon ticket arriving at 7 a.m. is the opposite: that vehicle would be
 * taking a place the morning slot has already sold to someone else. That is
 * precisely what splitting the day into slots exists to prevent, so it is
 * refused with 'wrong_slot' — and the person is told what time their ticket is
 * for, not simply turned away.
 *
 * The grace is only ever applied to the start, for the queue that forms before
 * the barrier opens.
 */
function withinSlot(at, startsAt, endsAt, graceMinutes) {
  const mins = at.getHours() * 60 + at.getMinutes();
  const [sh, sm] = String(startsAt).split(':').map(Number);
  return mins >= sh * 60 + sm - graceMinutes;
}

/**
 * Act on the decision and write it down.
 *
 * The consumption of the ticket is a conditional UPDATE, not a read followed by
 * a write. Two gates scanning the same QR at the same instant is exactly the
 * scenario a shared ticket creates, and only one of them may win.
 */
async function record(rawPayload, session, { at = new Date(), wasOffline = false } = {}) {
  const d = await decide(rawPayload, session, at);
  const t = d.ticket;

  let verdict = d.verdict;

  if (verdict === 'valid') {
    const claimed = (await query(
      `UPDATE tickets SET status = 'used', used_at = $2, modified_at = now()
        WHERE id = $1 AND status = 'paid'
        RETURNING *`, [t.id, at])).rows[0];

    if (!claimed) {
      // Someone else took it between our read and our write — which is the
      // duplicate-copy case, so it must be reported as one.
      const now = await one('SELECT used_at FROM tickets WHERE id = $1', [t.id]);
      verdict = 'already_used';
      d.message = `Already scanned at ${new Date(now.used_at).toLocaleTimeString('en-IN')}.`;
    }
  }

  await query(
    `INSERT INTO scans (ticket_id, ticket_no, reg_no, checkpost_id, staff_id,
                        device_id, session_id, verdict, raw_payload,
                        scanned_at, synced_at, was_offline)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [t?.id || null, t?.ticket_no || d.payload?.ticket_no || null,
     t?.reg_no || d.payload?.reg_no || null,
     session?.checkpost_id || null, session?.staff_id || null,
     session?.device_id || null, session?.id || null,
     verdict, String(rawPayload).slice(0, 500), at,
     wasOffline ? new Date() : null, wasOffline]);

  return {
    verdict,
    message: d.message,
    ticket: t ? {
      ticket_no: t.ticket_no, reg_no: t.reg_no, category: t.category_label,
      travel_date: t.travel_date, slot: t.slot_label, place: t.place_name,
    } : null,
  };
}

/** What the gate has seen today — the number a supervisor asks for. */
async function todayAt(checkpostId) {
  const r = await query(
    `SELECT verdict, count(*)::int AS n
       FROM scans
      WHERE checkpost_id = $1 AND scanned_at::date = CURRENT_DATE
      GROUP BY verdict`, [checkpostId]);
  const out = { total: 0 };
  for (const row of r.rows) { out[row.verdict] = row.n; out.total += row.n; }
  return out;
}

module.exports = { decide, record, todayAt };
