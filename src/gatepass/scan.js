/**
 * scan.js — the decision at the barrier.
 *
 * THE VISITOR PRESENTS NOTHING. They drive up, the staff member reads the last
 * few characters off the number plate and types them, and the gate answers.
 * There is no code to scan, no phone to find, no screenshot to zoom into, and
 * no paper to have left at home.
 *
 * WHY THE SIGNED QR WENT. A ticket is bound to a vehicle, not to a person —
 * whoever is driving is nobody's business but the owner's. So the only thing
 * that ever mattered at the barrier was the plate, and the QR was an elaborate
 * way of restating a number already written on the bumper in front of the
 * officer. Worse, it added failure modes that had nothing to do with entry: a
 * flat battery, a cracked screen, a deleted chat, sun on glass.
 *
 * And it bought less than it appeared to. A forged QR was caught by its
 * signature — but a vehicle whose plate is not in today's list is refused
 * whether it presents a perfect forgery or nothing at all. There is no longer
 * anything to forge, which is a stronger position than being good at detecting
 * forgeries.
 *
 * Seven verdicts, kept separate on purpose. A single "invalid" would be easier
 * to write and useless in practice: the staff member has a car in front of them
 * and needs to know whether to send it back, wave it through, or call someone.
 *
 *   valid          let them in
 *   already_used   this vehicle has come through once today
 *   wrong_day      a real booking, for another date
 *   wrong_slot     a real booking, for the other half of the day
 *   wrong_place    a real booking, for a different gate
 *   cancelled      refunded or cancelled
 *   not_paid       a booking that was started and never paid for
 *   not_found      no booking for this vehicle — sell one, or turn them back
 *
 * EVERY LOOKUP IS RECORDED, including every refusal. The refusals are the
 * evidence the system is doing its job — a weekly report showing the vehicles
 * that arrived without a booking is what justifies the whole thing.
 */

const { query, one } = require('./db');
const settings = require('./settings');

const GRACE_MINUTES = 60;   // late arrivals are normal; a whole slot is not

/* How far either side of today to look when a plate is typed.
 *
 * Searching only today would answer "no booking" to somebody holding a genuine
 * ticket for tomorrow, and the officer would turn away a paying visitor over
 * what is really a date mix-up. Looking wider costs one indexed query and lets
 * the gate say "your booking is for Thursday" — which is the difference between
 * an argument and an explanation. */
const LOOK_BACK_DAYS = 1;
const LOOK_AHEAD_DAYS = 14;

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const shiftDays = (d, n) => localDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));

/**
 * Everything typed at a gate, reduced to the characters a plate can contain.
 *
 * Staff type fast and with one hand. "31 n" and "31-N" and "31n" are the same
 * search, and a space that silently returns nothing is the kind of fault that
 * gets blamed on the vehicle rather than on the software.
 */
const normalise = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Find the bookings matching what was typed — by plate OR by booking code.
 *
 * TRAILING MATCH, NOT "LAST FOUR DIGITS". The obvious reading of "type the last
 * four digits" breaks on three kinds of plate this platform accepts: a Bharat
 * plate (22BH1234AA) ends in letters, an old registration (MYE505) has only
 * three digits, and a short one (KA51MM1) has one. Matching on the tail of the
 * string handles all of them, and typing four digits still works for the
 * ordinary case — which is the great majority.
 *
 * THE BOOKING CODE IS THE SECOND WAY IN, and it earns its place. A temporary
 * registration is long and unfamiliar to read off a windscreen sticker; a plate
 * can be caked in mud after a hill road, obscured by a bull bar, or simply
 * argued about. The code is six characters from an alphabet with no O/0 and no
 * I/L/1, printed on the visitor's ticket under BOOKING CODE, and it is read
 * aloud through a car window without ambiguity.
 *
 * Both are searched at once and the results merged, so the staff member never
 * has to choose a mode before typing — they type what they can see. Whichever
 * one finds the booking, it is the SAME booking: one row, one id, admitted
 * once. Marking it used by code or by plate is the same act.
 *
 * Three characters is the floor. Two would return most of the car park.
 */
async function search(typed, session, at = new Date()) {
  const tail = normalise(typed);
  if (tail.length < 3) return { ok: false, reason: 'too_short', candidates: [] };

  const from = shiftDays(at, -LOOK_BACK_DAYS);
  const to = shiftDays(at, LOOK_AHEAD_DAYS);

  /* Restricted to this gate's place when the session names one. A gate on one
     hill has no business listing another hill's visitors, and the shorter list
     is also the faster one to read aloud. */
  const rows = (await query(
    `SELECT t.*, pl.code AS place_code, pl.name AS place_name,
            s.code AS slot_code, s.label AS slot_label, s.starts_at, s.ends_at,
            c.label AS category_label,
            v.maker, v.model, v.colour
       FROM tickets t
       JOIN places pl ON pl.id = t.place_id
       JOIN place_slots s ON s.id = t.slot_id
       JOIN vehicle_categories c ON c.id = t.category_id
       LEFT JOIN vehicles v ON v.id = t.vehicle_id
      WHERE (t.reg_no LIKE '%' || $1 OR t.ticket_no LIKE '%' || $1)
        AND t.travel_date BETWEEN $2::date AND $3::date
        AND t.status IN ('paid', 'used', 'cancelled')
        AND ($4::bigint IS NULL OR t.place_id = $4)
      ORDER BY (t.travel_date = $5::date) DESC, t.travel_date, t.reg_no`,
    [tail, from, to, session?.place_id || null, localDate(at)])).rows;

  const candidates = [];
  for (const t of rows) {
    candidates.push({
      ticket: t,
      /* Which one matched, so the gate screen can say so. A row found only by
         its code, with a plate that looks nothing like what was typed, would
         otherwise read as a fault. */
      matched_on: String(t.reg_no).endsWith(tail) ? 'plate' : 'code',
      ...(await judge(t, session, at)),
    });
  }

  return { ok: true, tail, candidates };
}

/**
 * What to do about one booking, at this moment, at this gate.
 *
 * Pure: it reads settings and decides, and changes nothing. The claiming of
 * the ticket happens in admit(), so that this can be called freely — once per
 * candidate in a list, or twice on the same ticket — without consequences.
 */
async function judge(t, session, at = new Date()) {
  if (!t) return { verdict: 'not_found', message: 'No booking found for this vehicle.' };

  if (t.status === 'cancelled') {
    return { verdict: 'cancelled', message: 'This booking was cancelled.' };
  }

  if (t.status === 'used') {
    return {
      verdict: 'already_used',
      used_at: t.used_at,
      message: `${t.reg_no} already entered at `
             + `${new Date(t.used_at).toLocaleTimeString('en-IN')} today.`,
    };
  }

  if (t.status !== 'paid') {
    return { verdict: 'not_paid', message: 'This booking was never paid for.' };
  }

  if (session?.place_id && Number(t.place_id) !== Number(session.place_id)) {
    return { verdict: 'wrong_place', message: `This booking is for ${t.place_name}.` };
  }

  /* Compared in local terms, because a gate opens at 6 a.m. local. */
  if (String(t.travel_date) !== localDate(at)) {
    return { verdict: 'wrong_day', message: `This booking is for ${t.travel_date}, not today.` };
  }

  const grace = await settings.num('slot_grace_minutes', GRACE_MINUTES);
  if (!withinSlot(at, t.starts_at, t.ends_at, grace)) {
    return { verdict: 'wrong_slot', message: `Too early — this booking is for ${t.slot_label}.` };
  }

  return {
    verdict: 'valid',
    message: `${t.reg_no} · ${t.category_label} · ${t.slot_label}`,
  };
}

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
 * refused with 'wrong_slot' — and the person is told what time their booking is
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
 * Let a vehicle through, and write down that it happened.
 *
 * The consumption is a conditional UPDATE, not a read followed by a write. Two
 * gates admitting the same vehicle at the same instant is exactly what a busy
 * Sunday produces, and only one of them may win.
 *
 * `typed` is kept verbatim — in a dispute the argument is always about what was
 * entered, never about what we decided from it.
 */
async function admit(ticketId, session, { at = new Date(), wasOffline = false, typed = '' } = {}) {
  const t = await one(
    `SELECT t.*, pl.name AS place_name, s.label AS slot_label, s.starts_at, s.ends_at,
            c.label AS category_label
       FROM tickets t
       JOIN places pl ON pl.id = t.place_id
       JOIN place_slots s ON s.id = t.slot_id
       JOIN vehicle_categories c ON c.id = t.category_id
      WHERE t.id = $1`, [ticketId]);

  const d = await judge(t, session, at);
  let verdict = d.verdict;
  let message = d.message;

  if (verdict === 'valid') {
    const claimed = (await query(
      `UPDATE tickets SET status = 'used', used_at = $2, modified_at = now()
        WHERE id = $1 AND status = 'paid'
        RETURNING *`, [t.id, at])).rows[0];

    if (!claimed) {
      /* Someone else took it between the read and the write. On a plate lookup
         that means the same vehicle was admitted at another lane seconds ago —
         so it is reported as what it is rather than as a failure. */
      const now = await one('SELECT used_at FROM tickets WHERE id = $1', [t.id]);
      verdict = 'already_used';
      message = `${t.reg_no} already entered at `
              + `${new Date(now.used_at).toLocaleTimeString('en-IN')}.`;
    }
  }

  await record(verdict, t, session, { at, wasOffline, typed });

  return { verdict, message, ticket: t ? summary(t) : null };
}

/** A refusal, written down without changing any ticket. */
async function refuse(verdict, ticket, session, { at = new Date(), wasOffline = false, typed = '' } = {}) {
  await record(verdict, ticket, session, { at, wasOffline, typed });
  return { verdict, ticket: ticket ? summary(ticket) : null };
}

async function record(verdict, t, session, { at, wasOffline, typed }) {
  await query(
    `INSERT INTO scans (ticket_id, ticket_no, reg_no, checkpost_id, staff_id,
                        device_id, session_id, verdict, raw_payload,
                        scanned_at, synced_at, was_offline)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [t?.id || null, t?.ticket_no || null, t?.reg_no || normalise(typed) || null,
     session?.checkpost_id || null, session?.staff_id || null,
     session?.device_id || null, session?.id || null,
     verdict, String(typed).slice(0, 64), at,
     wasOffline ? new Date() : null, wasOffline]);
}

const summary = (t) => ({
  id: t.id, ticket_no: t.ticket_no, reg_no: t.reg_no,
  category: t.category_label, travel_date: t.travel_date,
  slot: t.slot_label, place: t.place_name,
});

/**
 * Every booking this gate could see today, for the device to hold offline.
 *
 * Deliberately narrow: the plate, the code, the slot and enough to show a
 * person at a barrier. No mobile number, no customer name — a staff phone that
 * is lost should not be a list of who went up the hill, and none of it is
 * needed to decide whether to raise the boom.
 *
 * A busy day is a few hundred rows of about 130 bytes, so a whole week fits in
 * under two megabytes. The size is why holding it locally is reasonable at all.
 */
async function manifest(placeId, date) {
  const rows = (await query(
    `SELECT t.id, t.ticket_no, t.reg_no, t.travel_date, t.status, t.used_at,
            s.code AS slot_code, s.label AS slot_label, s.starts_at, s.ends_at,
            c.label AS category_label, t.category_declared
       FROM tickets t
       JOIN place_slots s ON s.id = t.slot_id
       JOIN vehicle_categories c ON c.id = t.category_id
      WHERE t.place_id = $1 AND t.travel_date = $2::date
        AND t.status IN ('paid', 'used')
      ORDER BY t.reg_no`, [placeId, date])).rows;

  return { date, place_id: placeId, at: new Date().toISOString(), tickets: rows };
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

module.exports = { search, judge, admit, refuse, manifest, todayAt, normalise, withinSlot };
