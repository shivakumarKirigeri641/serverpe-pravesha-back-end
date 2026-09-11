/**
 * adminNegative.js — suspicious and invalid activity, with its full story.
 *
 * Nothing here is recorded specially. Every refusal at a gate is already a row
 * in scans, every failed payment a row in payments, every abandoned hold a
 * ticket that expired. This module reads those as one stream of negative events,
 * gives each the context a person needs to judge it — the pass, the booking, the
 * last time that vehicle got in, who checked it — and finds the patterns that no
 * single event shows: the vehicle refused five times in a week, the number that
 * holds places it never pays for.
 *
 * WHAT EACH CATEGORY MEANS HERE:
 *
 *   invalid          a pass number or vehicle the system has no pass for
 *   duplicate        a used pass presented again, later than the duplicate
 *                    window after its entry: a reuse attempt, or a copy
 *   already_used     a used pass looked up again within that window: almost
 *                    always the same vehicle checked twice at the gate
 *   expired          a pass for a date that has passed
 *   early            a pass for a date that has not come yet
 *   unpaid           the number of a booking that was never paid for
 *   wrong_place      a pass for a different destination
 *   outside_slot     admitted outside the time slot, on a staff member's word
 *   repeat           a vehicle refused again the same day after a refusal
 *   suspicious       a vehicle or visitor past the attempts threshold
 *   payment_failure  a payment the bank or the visitor did not complete
 *   booking_abuse    abandoned holds in a burst, or many vehicles on one number
 *
 * NOT MEASURED, AND SAID SO: vehicle mismatch (staff look a vehicle up by its own
 * number, so there is nothing to mismatch) and cancelled passes (nothing in the
 * product cancels one).
 *
 * The thresholds that separate unlucky from suspicious are settings, not
 * constants, because they will be argued about once there is real traffic.
 */

const { query, one } = require('./db');
const slotTime = require('./slotTime');
const settings = require('./settings');

const rowsOf = async (text, params) => (await query(text, params)).rows;
const n = (v) => Number(v || 0);
const mask = (m) => (m ? `••••${String(m).slice(-4)}` : null);
const asDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : (d ? String(d).slice(0, 10) : null));
const shiftDay = (date, days) => {
  const [y, m, d] = String(date).split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
};

const CATEGORY = {
  invalid: { label: 'Invalid ticket', tone: 'wrong' },
  duplicate: { label: 'Duplicate ticket', tone: 'wrong' },
  already_used: { label: 'Already used', tone: 'watch' },
  expired: { label: 'Expired ticket', tone: 'wrong' },
  early: { label: 'Not yet valid', tone: 'watch' },
  unpaid: { label: 'Unpaid booking', tone: 'wrong' },
  wrong_place: { label: 'Wrong destination', tone: 'wrong' },
  outside_slot: { label: 'Admitted outside slot', tone: 'watch' },
  payment_failure: { label: 'Payment failure', tone: 'watch' },
  booking_abuse: { label: 'Booking abuse', tone: 'wrong' },
};

async function thresholds() {
  const [attempts, windowDays, dupMinutes, holds, vehiclesPerDate] = await Promise.all([
    settings.num('negative_suspicious_attempts', 3),
    settings.num('negative_window_days', 7),
    settings.num('negative_duplicate_minutes', 15),
    settings.num('abuse_abandoned_holds_per_day', 3),
    settings.num('abuse_vehicles_per_date', 4),
  ]);
  return { attempts, windowDays, dupMinutes, holds, vehiclesPerDate };
}

/*
 * One stream of negative events, as SQL, so that filtering, counting and paging
 * all happen on the same definitions. $1 = duplicate window in minutes.
 *
 *   key       a stable id across kinds, for paging and for reviews
 *   category  one of CATEGORY
 */
const STREAM = `
  SELECT 'scan:' || s.id                                    AS key,
         'scan'                                             AS kind,
         s.id::text                                         AS ref_id,
         s.scanned_at                                       AS at,
         CASE s.verdict
           WHEN 'unknown_ticket' THEN 'invalid'
           WHEN 'already_used'   THEN CASE WHEN t.used_at IS NOT NULL
                                             AND s.scanned_at - t.used_at <= make_interval(mins => $1::int)
                                           THEN 'already_used' ELSE 'duplicate' END
           /* A wrong-date refusal always names a pass; one without a pass has
              nothing to be early or late for, and is an invalid attempt. */
           WHEN 'wrong_day'      THEN CASE WHEN t.id IS NULL THEN 'invalid'
                                           WHEN t.travel_date < (s.scanned_at AT TIME ZONE 'Asia/Kolkata')::date
                                           THEN 'expired' ELSE 'early' END
           WHEN 'not_paid'       THEN 'unpaid'
           WHEN 'wrong_place'    THEN 'wrong_place'
           WHEN 'valid_override' THEN 'outside_slot'
           WHEN 'cancelled'      THEN 'invalid'
         END                                                AS category,
         s.reg_no                                           AS reg_no,
         t.id                                               AS ticket_id,
         t.customer_id                                      AS customer_id
    FROM scans s
    LEFT JOIN tickets t ON t.id = s.ticket_id
   WHERE s.verdict IN ('unknown_ticket','already_used','wrong_day','not_paid','wrong_place','valid_override','cancelled')
  UNION ALL
  SELECT 'payment:' || p.id, 'payment', p.id::text, p.created_at, 'payment_failure',
         NULL, NULL, p.customer_id
    FROM payments p
   WHERE p.status = 'failed'`;

/** Negative events, newest first, with everything needed to judge each one. */
async function events({ category = null, q = null, from = null, to = null, before = null, limit = 30 } = {}) {
  const th = await thresholds();
  const size = Math.max(1, Math.min(100, Number(limit) || 30));
  const term = q ? String(q).trim() : null;
  const plate = term ? term.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
  const digits = term ? term.replace(/\D/g, '') : '';

  let cursorAt = null;
  let cursorKey = null;
  if (before && String(before).includes('|')) [cursorAt, cursorKey] = String(before).split('|');

  const rows = await rowsOf(
    `WITH stream AS (${STREAM})
     SELECT st.* FROM stream st
       LEFT JOIN customers c ON c.id = st.customer_id
       LEFT JOIN tickets tk ON tk.id = st.ticket_id
      WHERE ($2::text IS NULL OR st.category = $2)
        AND ($3::date IS NULL OR (st.at AT TIME ZONE 'Asia/Kolkata')::date >= $3::date)
        AND ($4::date IS NULL OR (st.at AT TIME ZONE 'Asia/Kolkata')::date <= $4::date)
        AND ($5::text IS NULL
             OR ($6 <> '' AND st.reg_no LIKE '%' || $6 || '%')
             OR ($6 <> '' AND tk.ticket_no ILIKE '%' || $5 || '%')
             OR ($7 <> '' AND c.mobile LIKE '%' || $7 || '%')
             OR c.name ILIKE '%' || $5 || '%')
        AND ($8::timestamptz IS NULL OR (st.at, st.key) < ($8::timestamptz, $9::text))
      ORDER BY st.at DESC, st.key DESC
      LIMIT $10`,
    [th.dupMinutes, category || null, from || null, to || null, term, plate, digits,
      cursorAt || null, cursorKey || null, size + 1]);

  const hasMore = rows.length > size;
  const page = hasMore ? rows.slice(0, size) : rows;
  const enriched = await enrich(page, th);

  return {
    events: enriched,
    hasMore,
    nextCursor: hasMore && page.length ? `${new Date(page[page.length - 1].at).toISOString()}|${page[page.length - 1].key}` : null,
  };
}

/** Give each event its pass, booking, vehicle, visitor, staff and history. */
async function enrich(page, th) {
  if (!page.length) return [];
  const scanIds = page.filter((r) => r.kind === 'scan').map((r) => r.ref_id);
  const payIds = page.filter((r) => r.kind === 'payment').map((r) => r.ref_id);

  const [scans, payments, reviews] = await Promise.all([
    scanIds.length ? rowsOf(
      `SELECT s.id, s.verdict, s.scanned_at, s.reg_no, s.ticket_no, s.duration_ms,
              st.name AS staff_name, cp.name AS checkpost_name,
              t.id AS ticket_id, t.ticket_no AS t_no, t.travel_date, t.status AS ticket_status, t.used_at,
              t.created_at AS booked_at, t.total_paise, t.customer_id,
              regexp_replace(sl.label, '[[:space:]]+', ' ', 'g') AS slot_label, p.name AS place_name,
              cat.label AS category_label, cat.code AS category_code,
              v.maker, v.model, v.vehicle_category,
              cu.name AS customer_name, cu.wa_profile_name, cu.mobile, cu.is_blocked,
              /* This vehicle's refusals that day, up to and including this one. */
              (SELECT count(*) FROM scans s2
                WHERE s2.reg_no = s.reg_no AND s2.verdict NOT IN ('valid','valid_override')
                  AND (s2.scanned_at AT TIME ZONE 'Asia/Kolkata')::date = (s.scanned_at AT TIME ZONE 'Asia/Kolkata')::date
                  AND s2.scanned_at <= s.scanned_at) AS attempt_no,
              /* The last time this vehicle actually got in, before this check. */
              (SELECT max(t2.used_at) FROM tickets t2
                WHERE t2.reg_no = s.reg_no AND t2.status = 'used' AND t2.used_at < s.scanned_at) AS previous_entry,
              /* Refusals across the suspicious window, ending at this check. */
              (SELECT count(*) FROM scans s3
                WHERE s3.reg_no = s.reg_no AND s3.verdict NOT IN ('valid','valid_override')
                  AND s3.scanned_at > s.scanned_at - make_interval(days => $2::int)
                  AND s3.scanned_at <= s.scanned_at) AS window_attempts
         FROM scans s
         LEFT JOIN staff st ON st.id = s.staff_id
         LEFT JOIN checkposts cp ON cp.id = s.checkpost_id
         LEFT JOIN tickets t ON t.id = s.ticket_id
         LEFT JOIN place_slots sl ON sl.id = t.slot_id
         LEFT JOIN places p ON p.id = t.place_id
         LEFT JOIN vehicle_categories cat ON cat.id = t.category_id
         LEFT JOIN vehicles v ON v.reg_no = s.reg_no
         LEFT JOIN customers cu ON cu.id = t.customer_id
        WHERE s.id = ANY($1::bigint[])`, [scanIds, th.windowDays]) : [],
    payIds.length ? rowsOf(
      `SELECT p.id, p.created_at, p.amount_paise, p.raw, p.order_id,
              cu.id AS customer_id, cu.name AS customer_name, cu.wa_profile_name, cu.mobile, cu.is_blocked,
              (SELECT count(*) FROM payments p2
                WHERE p2.customer_id = p.customer_id AND p2.status = 'failed'
                  AND (p2.created_at AT TIME ZONE 'Asia/Kolkata')::date = (p.created_at AT TIME ZONE 'Asia/Kolkata')::date
                  AND p2.created_at <= p.created_at) AS attempt_no,
              (SELECT min(p3.paid_at) FROM payments p3
                WHERE p3.customer_id = p.customer_id AND p3.status = 'paid' AND p3.paid_at > p.created_at
                  AND p3.paid_at < p.created_at + interval '1 day') AS later_paid_at,
              (SELECT t.ticket_no FROM tickets t WHERE t.payment_id = p.id LIMIT 1) AS ticket_no
         FROM payments p
         LEFT JOIN customers cu ON cu.id = p.customer_id
        WHERE p.id = ANY($1::bigint[])`, [payIds]) : [],
    rowsOf(
      `SELECT DISTINCT ON (subject_type, subject_id) subject_type, subject_id, action, note, created_at,
              (SELECT name FROM admin_users a WHERE a.id = r.admin_id) AS admin_name
         FROM negative_reviews r
        WHERE (subject_type = 'scan' AND subject_id = ANY($1::text[]))
           OR (subject_type = 'payment' AND subject_id = ANY($2::text[]))
        ORDER BY subject_type, subject_id, created_at DESC`, [scanIds, payIds]),
  ]);

  const scanOf = Object.fromEntries(scans.map((s) => [String(s.id), s]));
  const payOf = Object.fromEntries(payments.map((p) => [String(p.id), p]));
  const reviewOf = Object.fromEntries(reviews.map((r) => [`${r.subject_type}:${r.subject_id}`, r]));

  return page.map((row) => {
    const review = reviewOf[row.key];
    const reviewed = review ? { action: review.action, note: review.note, at: review.created_at, by: review.admin_name } : null;

    if (row.kind === 'payment') {
      const p = payOf[row.ref_id] || {};
      return {
        key: row.key,
        kind: 'payment',
        category: row.category,
        categoryLabel: CATEGORY[row.category].label,
        tone: CATEGORY[row.category].tone,
        at: row.at,
        ticketNo: p.ticket_no || null,
        regNo: null,
        vehicleType: null,
        visitor: p.customer_id ? { id: String(p.customer_id), name: p.customer_name || p.wa_profile_name || null, mobile: mask(p.mobile), blocked: p.is_blocked } : null,
        attemptNo: n(p.attempt_no),
        staff: null,
        checkpost: null,
        reason: p.raw?.failed_reason || 'Payment not completed',
        previousEntry: null,
        booking: { amount: Math.round(n(p.amount_paise) / 100), order: p.order_id },
        action: p.later_paid_at ? `Paid on a later attempt at ${new Date(p.later_paid_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}` : 'Not completed',
        repeat: n(p.attempt_no) > 1,
        suspicious: false,
        reviewed,
      };
    }

    const s = scanOf[row.ref_id] || {};
    const attempts = n(s.window_attempts);
    const reasonFor = {
      invalid: 'No pass exists for this number',
      duplicate: `Pass already used on ${s.used_at ? new Date(s.used_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : 'an earlier visit'} — presented again`,
      already_used: 'Pass looked up again within minutes of its entry',
      expired: `Pass was for ${asDate(s.travel_date)}`,
      early: `Pass is for ${asDate(s.travel_date)}`,
      unpaid: 'Booking was never paid for',
      wrong_place: `Pass is for ${s.place_name || 'another destination'}`,
      outside_slot: 'Outside the booked slot; staff allowed entry',
    };
    return {
      key: row.key,
      kind: 'scan',
      category: row.category,
      categoryLabel: CATEGORY[row.category].label,
      tone: CATEGORY[row.category].tone,
      at: row.at,
      ticketNo: s.t_no || s.ticket_no || null,
      regNo: s.reg_no,
      vehicleType: s.category_label || s.vehicle_category || null,
      vehicle: [s.maker, s.model].filter(Boolean).join(' ') || null,
      visitor: s.customer_id ? { id: String(s.customer_id), name: s.customer_name || s.wa_profile_name || null, mobile: mask(s.mobile), blocked: s.is_blocked } : null,
      attemptNo: n(s.attempt_no),
      staff: s.staff_name || null,
      checkpost: s.checkpost_name || null,
      durationMs: s.duration_ms,
      reason: reasonFor[row.category] || s.verdict,
      previousEntry: s.previous_entry,
      booking: s.ticket_id ? {
        travelDate: asDate(s.travel_date), slot: s.slot_label, place: s.place_name, status: s.ticket_status,
        bookedAt: s.booked_at, amount: Math.round(n(s.total_paise) / 100),
      } : null,
      action: row.category === 'outside_slot' ? 'Admitted by staff' : 'Refused entry',
      repeat: n(s.attempt_no) > 1,
      windowAttempts: attempts,
      suspicious: attempts >= th.attempts,
      reviewed,
    };
  });
}

/* The counts per category for a day, cut at a time of day. */
async function countsFor(date, cutTime, th) {
  const rows = await rowsOf(
    `WITH stream AS (${STREAM})
     SELECT category, count(*) AS n FROM stream
      WHERE (at AT TIME ZONE 'Asia/Kolkata')::date = $2::date
        AND (at AT TIME ZONE 'Asia/Kolkata')::time <= $3::time
      GROUP BY category`, [th.dupMinutes, date, cutTime]);
  const out = Object.fromEntries(Object.keys(CATEGORY).map((k) => [k, 0]));
  for (const r of rows) out[r.category] = n(r.n);

  const [repeat] = await rowsOf(
    `SELECT COALESCE(sum(c - 1), 0) AS n FROM (
       SELECT reg_no, count(*) AS c FROM scans
        WHERE reg_no IS NOT NULL AND verdict NOT IN ('valid','valid_override')
          AND (scanned_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date
          AND (scanned_at AT TIME ZONE 'Asia/Kolkata')::time <= $2::time
        GROUP BY reg_no HAVING count(*) > 1) x`, [date, cutTime]);
  out.repeat = n(repeat.n);
  return out;
}

const change = (now, before) => ({
  value: now, previous: before, diff: now - before,
  percent: before === 0 ? null : Math.round(((now - before) / before) * 1000) / 10,
  direction: now === before ? 'flat' : now > before ? 'up' : 'down',
});

/**
 * Today against yesterday at the same time of day, per category and in total.
 * "Suspicious attempts" is every gate refusal plus every failed payment — the
 * figure that goes up when something is being tried.
 */
async function overview() {
  const th = await thresholds();
  const now = slotTime.nowIST();
  const today = now.date;
  const yesterday = shiftDay(today, -1);
  const cut = `${slotTime.hhmm(now.minutes)}:59`;

  const [t, y, suspects, abuse] = await Promise.all([
    countsFor(today, cut, th),
    countsFor(yesterday, cut, th),
    suspiciousList({ th }),
    bookingAbuse({ th }),
  ]);

  const attemptKeys = ['invalid', 'duplicate', 'expired', 'early', 'unpaid', 'wrong_place', 'payment_failure'];
  const total = (o) => attemptKeys.reduce((s, k) => s + o[k], 0);

  const categories = [
    ...Object.entries(CATEGORY).filter(([k]) => k !== 'booking_abuse').map(([key, meta]) => ({ key, ...meta, ...change(t[key], y[key]) })),
    { key: 'repeat', label: 'Repeated attempt', tone: 'wrong', ...change(t.repeat, y.repeat) },
    { key: 'booking_abuse', label: 'Booking abuse', tone: 'wrong', value: abuse.length, previous: null, direction: null,
      note: 'Numbers matching an abuse pattern in the last 7 days' },
    { key: 'suspicious', label: 'Suspicious activity', tone: 'wrong', value: suspects.vehicles.length + suspects.visitors.length, previous: null, direction: null,
      note: `Vehicles or visitors with ${th.attempts}+ failures in ${th.windowDays} days` },
    { key: 'vehicle_mismatch', label: 'Vehicle mismatch', value: null,
      note: 'Staff look a vehicle up by its own number, so a pass cannot be presented against another vehicle' },
    { key: 'cancelled', label: 'Cancelled ticket', value: null, note: 'Passes cannot be cancelled in the product' },
  ];

  return {
    date: today,
    comparedWith: yesterday,
    cutAt: slotTime.hhmm(now.minutes),
    thresholds: th,
    suspiciousAttempts: change(total(t), total(y)),
    categories,
    suspects,
    abuse,
  };
}

/**
 * Vehicles and visitors past the threshold within the window.
 *
 * Vehicles are judged by gate refusals. Visitors are judged by what they did
 * with bookings and payments, plus refusals of their own passes — a number that
 * fails at the payment page five times is suspicious in a different way from a
 * vehicle refused at the barrier, and both lists say which.
 */
async function suspiciousList({ th } = {}) {
  th = th || await thresholds();

  const vehicles = await rowsOf(
    `SELECT s.reg_no, count(*) AS attempts, min(s.scanned_at) AS first_at, max(s.scanned_at) AS last_at,
            count(DISTINCT (s.scanned_at AT TIME ZONE 'Asia/Kolkata')::date) AS days,
            array_agg(DISTINCT s.verdict) AS verdicts,
            v.maker, v.model, v.vehicle_category,
            (SELECT max(t.used_at) FROM tickets t WHERE t.reg_no = s.reg_no AND t.status = 'used') AS last_valid_entry,
            (SELECT action FROM negative_reviews r WHERE r.subject_type = 'vehicle' AND r.subject_id = s.reg_no
              ORDER BY created_at DESC LIMIT 1) AS review_action
       FROM scans s
       LEFT JOIN vehicles v ON v.reg_no = s.reg_no
      WHERE s.reg_no IS NOT NULL AND s.verdict NOT IN ('valid','valid_override','already_used')
        AND s.scanned_at > now() - make_interval(days => $1::int)
      GROUP BY s.reg_no, v.maker, v.model, v.vehicle_category
     HAVING count(*) >= $2
      ORDER BY attempts DESC, last_at DESC
      LIMIT 50`, [th.windowDays, th.attempts]);

  const visitors = await rowsOf(
    `WITH failures AS (
       SELECT customer_id, created_at AS at, 'payment_failure' AS what FROM payments
        WHERE status = 'failed' AND created_at > now() - make_interval(days => $1::int)
       UNION ALL
       SELECT customer_id, created_at, 'abandoned_hold' FROM tickets
        WHERE status = 'expired' AND created_at > now() - make_interval(days => $1::int)
       UNION ALL
       SELECT t.customer_id, s.scanned_at, 'gate_refusal' FROM scans s JOIN tickets t ON t.id = s.ticket_id
        WHERE s.verdict NOT IN ('valid','valid_override','already_used')
          AND s.scanned_at > now() - make_interval(days => $1::int))
     SELECT c.id, c.name, c.wa_profile_name, c.mobile, c.is_blocked, c.blocked_reason,
            count(*) AS attempts,
            count(*) FILTER (WHERE f.what = 'payment_failure') AS payment_failures,
            count(*) FILTER (WHERE f.what = 'abandoned_hold') AS abandoned_holds,
            count(*) FILTER (WHERE f.what = 'gate_refusal') AS gate_refusals,
            max(f.at) AS last_at
       FROM failures f JOIN customers c ON c.id = f.customer_id
      GROUP BY c.id
     HAVING count(*) >= $2
      ORDER BY attempts DESC, last_at DESC
      LIMIT 50`, [th.windowDays, th.attempts]);

  return {
    vehicles: vehicles.map((v) => ({
      regNo: v.reg_no,
      vehicle: [v.maker, v.model].filter(Boolean).join(' ') || null,
      type: v.vehicle_category || null,
      attempts: n(v.attempts),
      days: n(v.days),
      firstAt: v.first_at,
      lastAt: v.last_at,
      verdicts: v.verdicts,
      lastValidEntry: v.last_valid_entry,
      reviewed: v.review_action || null,
    })),
    visitors: visitors.map((c) => ({
      id: String(c.id),
      name: c.name || c.wa_profile_name || null,
      mobile: mask(c.mobile),
      blocked: c.is_blocked,
      blockedReason: c.blocked_reason,
      attempts: n(c.attempts),
      paymentFailures: n(c.payment_failures),
      abandonedHolds: n(c.abandoned_holds),
      gateRefusals: n(c.gate_refusals),
      lastAt: c.last_at,
    })),
  };
}

/** Numbers matching a booking-abuse pattern in the last week. */
async function bookingAbuse({ th } = {}) {
  th = th || await thresholds();
  const rows = await rowsOf(
    `SELECT 'abandoned_holds' AS pattern, t.customer_id, (t.created_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
            count(*) AS n, array_agg(DISTINCT t.reg_no) AS vehicles
       FROM tickets t
      WHERE t.status = 'expired' AND t.created_at > now() - interval '7 days'
      GROUP BY t.customer_id, 3 HAVING count(*) >= $1
     UNION ALL
     SELECT 'many_vehicles', t.customer_id, t.travel_date, count(DISTINCT t.reg_no), array_agg(DISTINCT t.reg_no)
       FROM tickets t
      WHERE t.status IN ('paid','used') AND t.created_at > now() - interval '7 days'
      GROUP BY t.customer_id, t.travel_date HAVING count(DISTINCT t.reg_no) >= $2
      ORDER BY n DESC`, [th.holds, th.vehiclesPerDate]);

  if (!rows.length) return [];
  const people = await rowsOf(`SELECT id, name, wa_profile_name, mobile, is_blocked FROM customers WHERE id = ANY($1::bigint[])`,
    [[...new Set(rows.map((r) => r.customer_id))]]);
  const who = Object.fromEntries(people.map((p) => [String(p.id), p]));

  return rows.map((r) => {
    const p = who[String(r.customer_id)] || {};
    return {
      pattern: r.pattern,
      label: r.pattern === 'abandoned_holds'
        ? `${n(r.n)} payment holds abandoned in one day`
        : `${n(r.n)} different vehicles booked for one date`,
      day: asDate(r.day),
      count: n(r.n),
      vehicles: r.vehicles,
      visitor: { id: String(r.customer_id), name: p.name || p.wa_profile_name || null, mobile: mask(p.mobile), blocked: p.is_blocked },
    };
  });
}

/** Everything negative about one vehicle, and the valid entries around it. */
async function vehicleProfile(regNo) {
  const plate = String(regNo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (plate.length < 4) return null;
  const th = await thresholds();

  const [vehicle, refusals, entries, reviews] = await Promise.all([
    one(`SELECT reg_no, maker, model, fuel, colour, vehicle_class, vehicle_category, is_test FROM vehicles WHERE reg_no = $1`, [plate]),
    rowsOf(`SELECT s.id FROM scans s WHERE s.reg_no = $1
              AND s.verdict IN ('unknown_ticket','already_used','wrong_day','not_paid','wrong_place','valid_override','cancelled')
            ORDER BY s.scanned_at DESC LIMIT 100`, [plate]),
    rowsOf(`SELECT t.ticket_no, t.travel_date, t.used_at, regexp_replace(sl.label, '[[:space:]]+', ' ', 'g') AS slot,
                   cu.name AS visitor
              FROM tickets t JOIN place_slots sl ON sl.id = t.slot_id LEFT JOIN customers cu ON cu.id = t.customer_id
             WHERE t.reg_no = $1 AND t.status = 'used' ORDER BY t.used_at DESC LIMIT 30`, [plate]),
    reviewsFor('vehicle', plate),
  ]);
  if (!vehicle && !refusals.length) return null;

  /* The category and time come from the stream, so a vehicle's history uses the
     same definitions as the feed. */
  const stream = refusals.length ? await rowsOf(
    `WITH stream AS (${STREAM}) SELECT * FROM stream WHERE kind = 'scan' AND ref_id = ANY($2::text[]) ORDER BY at DESC`,
    [th.dupMinutes, refusals.map((r) => String(r.id))]) : [];
  const events = await enrich(stream, th);

  const recent = events.filter((e) => new Date(e.at) > new Date(Date.now() - th.windowDays * 86400000) && e.category !== 'already_used' && e.category !== 'outside_slot');

  return {
    vehicle: vehicle ? {
      regNo: vehicle.reg_no, maker: vehicle.maker, model: vehicle.model, fuel: vehicle.fuel, colour: vehicle.colour,
      vehicleClass: vehicle.vehicle_class, category: vehicle.vehicle_category, isTest: vehicle.is_test,
    } : { regNo: plate, unknown: true },
    suspicious: recent.length >= th.attempts,
    recentFailures: recent.length,
    thresholds: th,
    events,
    validEntries: entries.map((e) => ({ ticketNo: e.ticket_no, travelDate: asDate(e.travel_date), enteredAt: e.used_at, slot: e.slot, visitor: e.visitor })),
    reviews,
  };
}

/** Everything negative about one visitor: gate, payments and holds. */
async function visitorProfile(customerId) {
  if (!/^\d+$/.test(String(customerId || ''))) return null;
  const th = await thresholds();
  const c = await one(`SELECT id, name, wa_profile_name, mobile, is_blocked, blocked_reason, created_at, is_test FROM customers WHERE id = $1`, [customerId]);
  if (!c) return null;

  const [stream, holds, passes, reviews] = await Promise.all([
    rowsOf(`WITH stream AS (${STREAM}) SELECT * FROM stream WHERE customer_id = $2 ORDER BY at DESC LIMIT 100`, [th.dupMinutes, c.id]),
    rowsOf(`SELECT ticket_no, reg_no, travel_date, created_at FROM tickets WHERE customer_id = $1 AND status = 'expired'
             ORDER BY created_at DESC LIMIT 50`, [c.id]),
    rowsOf(`SELECT count(*) FILTER (WHERE status IN ('paid','used')) AS paid, count(*) FILTER (WHERE status = 'used') AS used,
                   count(DISTINCT reg_no) AS vehicles FROM tickets WHERE customer_id = $1`, [c.id]),
    reviewsFor('customer', String(c.id)),
  ]);
  const events = await enrich(stream, th);
  const windowStart = Date.now() - th.windowDays * 86400000;
  const recent = events.filter((e) => new Date(e.at) > windowStart && e.category !== 'already_used' && e.category !== 'outside_slot').length
    + holds.filter((h) => new Date(h.created_at) > windowStart).length;

  return {
    visitor: {
      id: String(c.id), name: c.name || c.wa_profile_name || null, mobile: mask(c.mobile),
      blocked: c.is_blocked, blockedReason: c.blocked_reason, since: c.created_at, isTest: c.is_test,
      passes: n(passes[0]?.paid), visits: n(passes[0]?.used), vehicles: n(passes[0]?.vehicles),
    },
    suspicious: recent >= th.attempts,
    recentFailures: recent,
    thresholds: th,
    events,
    abandonedHolds: holds.map((h) => ({ ticketNo: h.ticket_no, regNo: h.reg_no, travelDate: asDate(h.travel_date), at: h.created_at })),
    reviews,
  };
}

async function reviewsFor(type, id) {
  const rows = await rowsOf(
    `SELECT r.action, r.note, r.created_at, a.name AS admin_name FROM negative_reviews r
       LEFT JOIN admin_users a ON a.id = r.admin_id
      WHERE r.subject_type = $1 AND r.subject_id = $2 ORDER BY r.created_at DESC LIMIT 50`, [type, id]);
  return rows.map((r) => ({ action: r.action, note: r.note, at: r.created_at, by: r.admin_name }));
}

/** Record what an administrator decided about something. */
async function review({ subjectType, subjectId, action, note, adminId }) {
  const row = await one(
    `INSERT INTO negative_reviews (subject_type, subject_id, action, note, admin_id)
     VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at`,
    [subjectType, String(subjectId), action, note ? String(note).slice(0, 1000) : null, adminId || null]);
  return row;
}

/**
 * Block or unblock a visitor's number.
 *
 * A blocked number's WhatsApp messages are received and recorded but not
 * answered (inbox.js), so it cannot book. It does not cancel a pass already
 * paid for — that is a refund decision, not a block — and it is always recorded
 * with a reason and a name.
 */
async function setBlocked({ customerId, blocked, reason, adminId }) {
  const c = await one(
    `UPDATE customers SET is_blocked = $2, blocked_reason = CASE WHEN $2 THEN $3 ELSE NULL END, modified_at = now()
      WHERE id = $1 RETURNING id, is_blocked, blocked_reason`, [customerId, blocked, reason || null]);
  if (!c) return null;
  await review({ subjectType: 'customer', subjectId: customerId, action: blocked ? 'blocked' : 'unblocked', note: reason, adminId });
  return c;
}

module.exports = {
  CATEGORY, overview, events, suspiciousList, bookingAbuse, vehicleProfile, visitorProfile, review, setBlocked, thresholds,
};
