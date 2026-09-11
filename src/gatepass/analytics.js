/**
 * analytics.js — the questions a department actually asks, as queries.
 *
 * Separate from reports.js, which answers "what happened in this period and
 * what is owed". This file answers the other kind of question: who comes, how
 * often, when, in what, and how the gate is coping.
 *
 * Two rules run through all of it:
 *
 *   COMPUTE, NEVER CACHE. Every figure recomputes from tickets and scans. A
 *   cached counter that drifts is worse than no counter, because nobody notices
 *   until an officer is reading it aloud in a meeting.
 *
 *   INTERNAL NUMBERS ARE EXCLUDED. Our own testing must not appear in a
 *   department's visitor statistics, so anything from a customer flagged
 *   is_internal is left out of the counts. It is still in the raw tables.
 */

const { query, one } = require('./db');

/** Live tickets only: cancelled and expired ones are not visits. */
const LIVE = `t.status IN ('paid','used')`;
const NOT_INTERNAL = `NOT COALESCE(c.is_internal, false)`;

/* ══════════════════════════════════════════════════════ live monitoring */

/**
 * Everything happening right now, for a screen someone leaves open.
 *
 * `since` lets the browser ask only for what it has not seen, so a page left
 * open all day does not re-download the day every few seconds.
 */
async function live(placeId, since = null) {
  const sinceTs = since ? new Date(since) : new Date(Date.now() - 30 * 60000);

  const [scans, bookings, counters, gates] = await Promise.all([
    query(
      `SELECT sc.id, sc.scanned_at, sc.verdict, sc.ticket_no, sc.reg_no, sc.was_offline,
              st.name AS staff_name, cp.name AS checkpost_name
         FROM scans sc
         LEFT JOIN checkposts cp ON cp.id = sc.checkpost_id
         LEFT JOIN staff st ON st.id = sc.staff_id
        WHERE sc.scanned_at > $1 AND (cp.place_id = $2 OR cp.place_id IS NULL)
        ORDER BY sc.scanned_at DESC
        LIMIT 60`, [sinceTs, placeId]),

    query(
      `SELECT t.id, t.ticket_no, t.reg_no, t.travel_date, t.total_paise, t.created_at,
              s.label AS slot_label, vc.label AS category_label
         FROM tickets t
         JOIN place_slots s ON s.id = t.slot_id
         JOIN vehicle_categories vc ON vc.id = t.category_id
         LEFT JOIN customers c ON c.id = t.customer_id
        WHERE t.created_at > $1 AND t.place_id = $2 AND ${LIVE} AND ${NOT_INTERNAL}
        ORDER BY t.created_at DESC
        LIMIT 40`, [sinceTs, placeId]),

    one(
      `SELECT
         (SELECT count(*) FROM tickets t LEFT JOIN customers c ON c.id = t.customer_id
           WHERE t.place_id = $1 AND t.travel_date = CURRENT_DATE
             AND ${LIVE} AND ${NOT_INTERNAL})::int AS booked_today,
         (SELECT count(*) FROM tickets t LEFT JOIN customers c ON c.id = t.customer_id
           WHERE t.place_id = $1 AND t.travel_date = CURRENT_DATE
             AND t.status = 'used' AND ${NOT_INTERNAL})::int AS entered_today,
         (SELECT COALESCE(sum(t.total_paise),0) FROM tickets t
            LEFT JOIN customers c ON c.id = t.customer_id
           WHERE t.place_id = $1 AND t.travel_date = CURRENT_DATE
             AND ${LIVE} AND ${NOT_INTERNAL})::int AS collected_today,
         (SELECT count(*) FROM scans sc
            LEFT JOIN checkposts cp ON cp.id = sc.checkpost_id
           WHERE sc.scanned_at::date = CURRENT_DATE
             AND (cp.place_id = $1 OR cp.place_id IS NULL))::int AS scans_today,
         (SELECT count(*) FROM scans sc
            LEFT JOIN checkposts cp ON cp.id = sc.checkpost_id
           WHERE sc.scanned_at::date = CURRENT_DATE AND sc.verdict <> 'valid'
             AND (cp.place_id = $1 OR cp.place_id IS NULL))::int AS refused_today,
         (SELECT count(*) FROM tickets t LEFT JOIN customers c ON c.id = t.customer_id
           WHERE t.place_id = $1 AND t.created_at > now() - interval '1 hour'
             AND ${LIVE} AND ${NOT_INTERNAL})::int AS booked_last_hour`,
      [placeId]),

    // Which gates are manned this minute, and by whom.
    query(
      `SELECT cp.id, cp.name, st.name AS staff_name, ss.started_at, d.label AS device_label,
              (SELECT count(*)::int FROM scans s2
                WHERE s2.session_id = ss.id) AS scans_this_shift,
              (SELECT max(s3.scanned_at) FROM scans s3
                WHERE s3.session_id = ss.id) AS last_scan_at
         FROM checkposts cp
         LEFT JOIN staff_sessions ss ON ss.checkpost_id = cp.id AND ss.ended_at IS NULL
         LEFT JOIN staff st ON st.id = ss.staff_id
         LEFT JOIN devices d ON d.id = ss.device_id
        WHERE cp.place_id = $1
        ORDER BY cp.name`, [placeId]),
  ]);

  return {
    now: new Date().toISOString(),
    scans: scans.rows,
    bookings: bookings.rows,
    counters,
    gates: gates.rows,
  };
}

/* ═══════════════════════════════════════════════════════════ the series */

/** Bookings, entries and money, day by day — the shape of the season. */
async function daily(placeId, { from, to }) {
  const r = await query(
    `SELECT d::date AS date,
            COALESCE(x.tickets, 0)::int      AS tickets,
            COALESCE(x.entered, 0)::int      AS entered,
            COALESCE(x.gross_paise, 0)::int  AS gross_paise,
            COALESCE(x.entry_paise, 0)::int  AS entry_paise,
            COALESCE(x.fee_paise, 0)::int    AS fee_paise
       FROM generate_series($2::date, $3::date, '1 day') AS d
       LEFT JOIN (
         SELECT t.travel_date,
                count(*) AS tickets,
                count(*) FILTER (WHERE t.status = 'used') AS entered,
                sum(t.total_paise) AS gross_paise,
                sum(t.entry_paise) AS entry_paise,
                sum(t.platform_paise) AS fee_paise
           FROM tickets t
           LEFT JOIN customers c ON c.id = t.customer_id
          WHERE t.place_id = $1 AND ${LIVE} AND ${NOT_INTERNAL}
          GROUP BY t.travel_date
       ) x ON x.travel_date = d::date
      ORDER BY d`, [placeId, from, to]);
  return r.rows;
}

/**
 * When people arrive, by hour.
 *
 * The number that decides whether the slot boundary is in the right place, and
 * whether the gate needs a second phone at 8 a.m.
 */
async function byHour(placeId, { from, to }) {
  const r = await query(
    `SELECT EXTRACT(hour FROM sc.scanned_at)::int AS hour,
            count(*)::int AS scans,
            count(*) FILTER (WHERE sc.verdict = 'valid')::int AS entered
       FROM scans sc
       LEFT JOIN checkposts cp ON cp.id = sc.checkpost_id
      WHERE (cp.place_id = $1 OR cp.place_id IS NULL)
        AND sc.scanned_at::date BETWEEN $2 AND $3
      GROUP BY 1 ORDER BY 1`, [placeId, from, to]);

  // Fill the gaps so a chart does not imply the gate vanished at 11 a.m.
  const out = [];
  for (let h = 0; h < 24; h++) {
    const row = r.rows.find((x) => x.hour === h);
    out.push({ hour: h, scans: row?.scans || 0, entered: row?.entered || 0 });
  }
  return out;
}

/** Which day of the week is busy. */
async function byWeekday(placeId, { from, to }) {
  const r = await query(
    `SELECT EXTRACT(dow FROM t.travel_date)::int AS dow,
            count(*)::int AS tickets,
            COALESCE(sum(t.total_paise),0)::int AS gross_paise
       FROM tickets t
       LEFT JOIN customers c ON c.id = t.customer_id
      WHERE t.place_id = $1 AND t.travel_date BETWEEN $2 AND $3
        AND ${LIVE} AND ${NOT_INTERNAL}
      GROUP BY 1 ORDER BY 1`, [placeId, from, to]);

  const NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return NAMES.map((name, dow) => {
    const row = r.rows.find((x) => x.dow === dow);
    return { dow, name, short: name.slice(0, 3),
      tickets: row?.tickets || 0, gross_paise: row?.gross_paise || 0 };
  });
}

/**
 * How far ahead people book.
 *
 * Decides how long the booking window needs to be, and whether same-day
 * booking is carrying the site or barely used.
 */
async function leadTime(placeId, { from, to }) {
  const r = await query(
    `SELECT CASE
              WHEN d = 0 THEN 'Same day'
              WHEN d = 1 THEN '1 day'
              WHEN d <= 3 THEN '2-3 days'
              WHEN d <= 7 THEN '4-7 days'
              ELSE 'Over a week'
            END AS bucket,
            min(d) AS sort,
            count(*)::int AS tickets
       FROM (
         SELECT (t.travel_date - t.created_at::date) AS d
           FROM tickets t
           LEFT JOIN customers c ON c.id = t.customer_id
          WHERE t.place_id = $1 AND t.travel_date BETWEEN $2 AND $3
            AND ${LIVE} AND ${NOT_INTERNAL}
       ) q
      GROUP BY 1 ORDER BY 2`, [placeId, from, to]);
  return r.rows;
}

/* ══════════════════════════════════════════════════ who keeps coming back */

/**
 * How many visitors come once, twice, or many times.
 *
 * The single most interesting number a tourism department does not currently
 * have: whether the hill is visited once in a lifetime or every other month.
 */
async function repeatVisitors(placeId, { from, to }) {
  const r = await query(
    `SELECT CASE
              WHEN n = 1 THEN 'Once'
              WHEN n = 2 THEN 'Twice'
              WHEN n <= 5 THEN '3-5 times'
              ELSE 'More than 5'
            END AS bucket,
            min(n) AS sort,
            count(*)::int AS customers,
            sum(n)::int AS tickets
       FROM (
         SELECT t.customer_id, count(*) AS n
           FROM tickets t
           LEFT JOIN customers c ON c.id = t.customer_id
          WHERE t.place_id = $1 AND t.travel_date BETWEEN $2 AND $3
            AND ${LIVE} AND ${NOT_INTERNAL}
          GROUP BY t.customer_id
       ) q
      GROUP BY 1 ORDER BY 2`, [placeId, from, to]);
  return r.rows;
}

/** New faces against returning ones, week by week. */
async function newVsReturning(placeId, { from, to }) {
  const r = await query(
    `WITH first_visit AS (
       SELECT t.customer_id, min(t.travel_date) AS first_date
         FROM tickets t WHERE t.place_id = $1 AND ${LIVE}
        GROUP BY t.customer_id
     )
     SELECT date_trunc('week', t.travel_date)::date AS week,
            count(*) FILTER (WHERE t.travel_date = f.first_date)::int AS first_time,
            count(*) FILTER (WHERE t.travel_date > f.first_date)::int AS returning
       FROM tickets t
       JOIN first_visit f ON f.customer_id = t.customer_id
       LEFT JOIN customers c ON c.id = t.customer_id
      WHERE t.place_id = $1 AND t.travel_date BETWEEN $2 AND $3
        AND ${LIVE} AND ${NOT_INTERNAL}
      GROUP BY 1 ORDER BY 1`, [placeId, from, to]);
  return r.rows;
}

/* ═════════════════════════════════════════════════ customers and vehicles */

async function customers(placeId, { q, limit = 100, offset = 0, sort = 'tickets' }) {
  const order = { tickets: 'tickets DESC', spend: 'spend_paise DESC',
    recent: 'last_visit DESC', name: 'c.mobile' }[sort] || 'tickets DESC';

  const params = [placeId];
  let where = '';
  if (q) {
    params.push(`%${String(q).replace(/\s/g, '').toUpperCase()}%`);
    where = `AND (c.mobile ILIKE $${params.length}
                  OR UPPER(COALESCE(c.wa_profile_name,'')) ILIKE $${params.length}
                  OR EXISTS (SELECT 1 FROM tickets t2 WHERE t2.customer_id = c.id
                              AND t2.reg_no ILIKE $${params.length}))`;
  }

  const rows = (await query(
    `SELECT c.id, c.mobile, c.wa_profile_name, c.first_seen_at, c.last_seen_at, c.is_internal,
            count(t.id)::int AS tickets,
            count(t.id) FILTER (WHERE t.status = 'used')::int AS entered,
            COALESCE(sum(t.total_paise), 0)::int AS spend_paise,
            COALESCE(sum(t.entry_paise), 0)::int AS to_department_paise,
            min(t.travel_date) AS first_visit,
            max(t.travel_date) AS last_visit,
            count(DISTINCT t.vehicle_id)::int AS vehicles
       FROM customers c
       LEFT JOIN tickets t ON t.customer_id = c.id AND t.place_id = $1
            AND t.status IN ('paid','used')
      WHERE true ${where}
      GROUP BY c.id
     HAVING count(t.id) > 0
      ORDER BY ${order}
      LIMIT ${Number(limit)} OFFSET ${Number(offset)}`, params)).rows;

  const totals = await one(
    `SELECT count(DISTINCT t.customer_id)::int AS customers,
            count(*)::int AS tickets,
            COALESCE(sum(t.total_paise),0)::int AS spend_paise
       FROM tickets t LEFT JOIN customers c ON c.id = t.customer_id
      WHERE t.place_id = $1 AND ${LIVE} AND ${NOT_INTERNAL}`, [placeId]);

  return { rows, totals };
}

async function customerDetail(placeId, mobile) {
  const customer = await one('SELECT * FROM customers WHERE mobile = $1', [mobile]);
  if (!customer) return null;

  const tickets = (await query(
    `SELECT t.*, s.label AS slot_label, vc.label AS category_label, v.maker, v.model
       FROM tickets t
       JOIN place_slots s ON s.id = t.slot_id
       JOIN vehicle_categories vc ON vc.id = t.category_id
       JOIN vehicles v ON v.id = t.vehicle_id
      WHERE t.customer_id = $1
      ORDER BY t.travel_date DESC`, [customer.id])).rows;

  const events = (await query(
    `SELECT kind, detail, created_at FROM event_log
      WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 30`, [customer.id])).rows;

  return { customer, tickets, events };
}

/**
 * Vehicles, and how often each one comes.
 *
 * A vehicle that has entered eleven times this season is either a taxi working
 * the route or something the department should know about; either way it is
 * invisible today.
 */
async function vehicles(placeId, { q, limit = 100, offset = 0, sort = 'visits' }) {
  const order = { visits: 'visits DESC', recent: 'last_visit DESC',
    plate: 'v.reg_no' }[sort] || 'visits DESC';

  const params = [placeId];
  let where = '';
  if (q) {
    params.push(`%${String(q).replace(/\s/g, '').toUpperCase()}%`);
    where = `AND v.reg_no ILIKE $${params.length}`;
  }

  const rows = (await query(
    `SELECT v.id, v.reg_no, v.maker, v.model, v.fuel, v.vehicle_class, v.colour,
            count(t.id)::int AS visits,
            count(t.id) FILTER (WHERE t.status = 'used')::int AS entered,
            COALESCE(sum(t.total_paise),0)::int AS spend_paise,
            min(t.travel_date) AS first_visit,
            max(t.travel_date) AS last_visit,
            count(DISTINCT t.customer_id)::int AS booked_by,
            max(vc.label) AS category_label
       FROM vehicles v
       JOIN tickets t ON t.vehicle_id = v.id AND t.place_id = $1
            AND t.status IN ('paid','used')
       JOIN vehicle_categories vc ON vc.id = t.category_id
      WHERE true ${where}
      GROUP BY v.id
      ORDER BY ${order}
      LIMIT ${Number(limit)} OFFSET ${Number(offset)}`, params)).rows;

  const totals = await one(
    `SELECT count(DISTINCT t.vehicle_id)::int AS vehicles,
            count(*)::int AS visits
       FROM tickets t LEFT JOIN customers c ON c.id = t.customer_id
      WHERE t.place_id = $1 AND ${LIVE} AND ${NOT_INTERNAL}`, [placeId]);

  return { rows, totals };
}

async function vehicleDetail(placeId, regNo) {
  const vehicle = await one('SELECT * FROM vehicles WHERE reg_no = $1', [regNo]);
  if (!vehicle) return null;

  const visits = (await query(
    `SELECT t.ticket_no, t.travel_date, t.status, t.total_paise, t.used_at, t.mobile,
            s.label AS slot_label, vc.label AS category_label
       FROM tickets t
       JOIN place_slots s ON s.id = t.slot_id
       JOIN vehicle_categories vc ON vc.id = t.category_id
      WHERE t.vehicle_id = $1
      ORDER BY t.travel_date DESC`, [vehicle.id])).rows;

  const scans = (await query(
    `SELECT sc.scanned_at, sc.verdict, sc.ticket_no, st.name AS staff_name
       FROM scans sc LEFT JOIN staff st ON st.id = sc.staff_id
      WHERE sc.reg_no = $1 ORDER BY sc.scanned_at DESC LIMIT 40`, [regNo])).rows;

  return { vehicle, visits, scans };
}

/* ════════════════════════════════════════════ every ticket ever issued */

/**
 * The ticket board: every ticket, what state it is in, and what has been
 * attempted against it.
 *
 * The scan counts are the reason this page exists. A ticket with one scan is
 * ordinary; a ticket with three scans, two of them refused, is a code that has
 * been passed around — and that is invisible on a bookings list, because the
 * booking itself looks perfectly normal.
 *
 * `state` is derived rather than stored, because "upcoming" and "expired" are
 * facts about today, not about the row.
 */
async function ticketBoard(placeId, { state, q, limit = 100, offset = 0 } = {}) {
  const params = [placeId];
  const where = ['t.place_id = $1'];

  if (q) {
    params.push(`%${String(q).replace(/\s/g, '').toUpperCase()}%`);
    where.push(`(t.reg_no ILIKE $${params.length} OR t.ticket_no ILIKE $${params.length}
                 OR t.mobile ILIKE $${params.length})`);
  }

  const STATES = {
    upcoming:  `t.status = 'paid' AND t.travel_date > CURRENT_DATE`,
    today:     `t.travel_date = CURRENT_DATE AND t.status IN ('paid','used')`,
    used:      `t.status = 'used'`,
    unused:    `t.status = 'paid' AND t.travel_date < CURRENT_DATE`,
    contested: `EXISTS (SELECT 1 FROM scans s2 WHERE s2.ticket_id = t.id
                         AND s2.verdict <> 'valid')`,
    cancelled: `t.status = 'cancelled'`,
    moved:     `t.move_count > 0`,
  };
  if (state && STATES[state]) where.push(STATES[state]);
  else where.push(`t.status <> 'expired'`);

  const rows = (await query(
    `SELECT t.id, t.ticket_no, t.reference_id, t.reg_no, t.mobile, t.travel_date,
            t.status, t.total_paise, t.created_at, t.used_at,
            t.move_count, t.moved_from_date,
            (SELECT p.checkout_token FROM payments p WHERE (p.raw->>'ticket_id')::bigint = t.id ORDER BY p.id DESC LIMIT 1) AS checkout_token,
            s.label AS slot_label, s.code AS slot_code, s.starts_at,
            vc.label AS category_label,
            c.wa_profile_name,
            (t.travel_date - CURRENT_DATE)::int AS days_to_go,
            (SELECT count(*)::int FROM scans sc WHERE sc.ticket_id = t.id) AS scan_count,
            (SELECT count(*)::int FROM scans sc WHERE sc.ticket_id = t.id
              AND sc.verdict <> 'valid') AS refused_count,
            (SELECT min(sc.scanned_at) FROM scans sc WHERE sc.ticket_id = t.id) AS first_scan,
            (SELECT max(sc.scanned_at) FROM scans sc WHERE sc.ticket_id = t.id) AS last_scan,
            (SELECT string_agg(DISTINCT sc.verdict, ',') FROM scans sc
              WHERE sc.ticket_id = t.id) AS verdicts
       FROM tickets t
       JOIN place_slots s ON s.id = t.slot_id
       JOIN vehicle_categories vc ON vc.id = t.category_id
       LEFT JOIN customers c ON c.id = t.customer_id
      WHERE ${where.join(' AND ')}
      ORDER BY t.travel_date DESC, t.created_at DESC
      LIMIT ${Number(limit)} OFFSET ${Number(offset)}`, params)).rows;

  const counts = await one(
    `SELECT
       count(*) FILTER (WHERE t.status = 'paid' AND t.travel_date > CURRENT_DATE)::int AS upcoming,
       count(*) FILTER (WHERE t.travel_date = CURRENT_DATE
                          AND t.status IN ('paid','used'))::int AS today,
       count(*) FILTER (WHERE t.status = 'used')::int AS used,
       count(*) FILTER (WHERE t.status = 'paid' AND t.travel_date < CURRENT_DATE)::int AS unused,
       count(*) FILTER (WHERE t.status = 'cancelled')::int AS cancelled,
       count(*) FILTER (WHERE t.move_count > 0)::int AS moved,
       (SELECT count(DISTINCT sc.ticket_id) FROM scans sc
          JOIN tickets t2 ON t2.id = sc.ticket_id
         WHERE t2.place_id = $1 AND sc.verdict <> 'valid')::int AS contested,
       (SELECT count(*) FROM scans sc
          LEFT JOIN checkposts cp ON cp.id = sc.checkpost_id
         WHERE sc.verdict = 'invalid_signature'
           AND (cp.place_id = $1 OR cp.place_id IS NULL))::int AS forged_attempts
       FROM tickets t WHERE t.place_id = $1 AND t.status <> 'expired'`, [placeId]);

  return { rows, counts };
}

/**
 * Upcoming bookings, for the monitoring board.
 *
 * Grouped by travel date so the shape of the next fortnight is visible at a
 * glance — which is what someone rostering staff actually needs.
 */
async function upcoming(placeId, days = 14) {
  const byDate = (await query(
    `SELECT t.travel_date, s.code AS slot_code, s.label AS slot_label,
            count(*)::int AS tickets,
            COALESCE(sum(t.total_paise),0)::int AS gross_paise,
            count(DISTINCT t.customer_id)::int AS customers
       FROM tickets t
       JOIN place_slots s ON s.id = t.slot_id
       LEFT JOIN customers c ON c.id = t.customer_id
      WHERE t.place_id = $1 AND t.status = 'paid'
        AND t.travel_date BETWEEN CURRENT_DATE AND CURRENT_DATE + $2::int
        AND ${NOT_INTERNAL}
      GROUP BY t.travel_date, s.code, s.label, s.sort_order
      ORDER BY t.travel_date, s.sort_order`, [placeId, days])).rows;

  const latest = (await query(
    `SELECT t.ticket_no, t.reg_no, t.mobile, t.travel_date, t.total_paise, t.created_at,
            t.status, t.category_declared,
            (SELECT p.checkout_token FROM payments p WHERE (p.raw->>'ticket_id')::bigint = t.id ORDER BY p.id DESC LIMIT 1) AS checkout_token,
            (t.travel_date - CURRENT_DATE)::int AS days_to_go,
            s.label AS slot_label, vc.label AS category_label, c.wa_profile_name
       FROM tickets t
       JOIN place_slots s ON s.id = t.slot_id
       JOIN vehicle_categories vc ON vc.id = t.category_id
       LEFT JOIN customers c ON c.id = t.customer_id
      WHERE t.place_id = $1 AND t.status IN ('paid','used') AND ${NOT_INTERNAL}
      ORDER BY t.created_at DESC LIMIT 25`, [placeId])).rows;

  return { byDate, latest };
}

/* ═════════════════════════════════════════════════════════ the gate itself */

/**
 * Per staff member, with the numbers that say whether the gate is working.
 *
 * Scans per hour matters because a queue forms when it drops. The refusal rate
 * matters for the opposite reason: a staff member refusing nothing may be
 * waving people through.
 */
async function staffPerformance(placeId, { from, to }) {
  const r = await query(
    `SELECT st.id, st.name, st.is_active,
            count(sc.id)::int AS scans,
            count(sc.id) FILTER (WHERE sc.verdict = 'valid')::int AS allowed,
            count(sc.id) FILTER (WHERE sc.verdict <> 'valid')::int AS refused,
            count(sc.id) FILTER (WHERE sc.verdict IN ('invalid_signature','already_used'))::int AS caught,
            count(sc.id) FILTER (WHERE sc.was_offline)::int AS offline,
            count(DISTINCT sc.scanned_at::date)::int AS days_worked,
            count(DISTINCT sc.session_id)::int AS shifts,
            min(sc.scanned_at) AS first_scan,
            max(sc.scanned_at) AS last_scan,
            ROUND(EXTRACT(epoch FROM (
              SELECT COALESCE(sum(COALESCE(ss.ended_at, now()) - ss.started_at), interval '0')
                FROM staff_sessions ss WHERE ss.staff_id = st.id
                 AND ss.started_at::date BETWEEN $2 AND $3)) / 3600.0, 1)::float AS hours_on_duty
       FROM staff st
       LEFT JOIN scans sc ON sc.staff_id = st.id
            AND sc.scanned_at::date BETWEEN $2 AND $3
       LEFT JOIN checkposts cp ON cp.id = sc.checkpost_id
      WHERE cp.place_id = $1 OR cp.id IS NULL
      GROUP BY st.id
      ORDER BY scans DESC`, [placeId, from, to]);

  return r.rows.map((s) => ({
    ...s,
    per_hour: s.hours_on_duty > 0 ? Math.round((s.scans / s.hours_on_duty) * 10) / 10 : 0,
    refusal_rate: s.scans > 0 ? Math.round((s.refused / s.scans) * 1000) / 10 : 0,
  }));
}

/** Every shift, with how long it ran and what happened in it. */
async function shifts(placeId, { from, to, limit = 60 }) {
  const r = await query(
    `SELECT ss.id, ss.started_at, ss.ended_at, ss.ended_reason,
            st.name AS staff_name, cp.name AS checkpost_name, d.label AS device_label,
            ROUND(EXTRACT(epoch FROM (COALESCE(ss.ended_at, now()) - ss.started_at))
                  / 3600.0, 1)::float AS hours,
            (SELECT count(*)::int FROM scans s2 WHERE s2.session_id = ss.id) AS scans,
            (SELECT count(*)::int FROM scans s2 WHERE s2.session_id = ss.id
              AND s2.verdict <> 'valid') AS refused
       FROM staff_sessions ss
       JOIN staff st ON st.id = ss.staff_id
       JOIN checkposts cp ON cp.id = ss.checkpost_id
       LEFT JOIN devices d ON d.id = ss.device_id
      WHERE cp.place_id = $1 AND ss.started_at::date BETWEEN $2 AND $3
      ORDER BY ss.started_at DESC
      LIMIT ${Number(limit)}`, [placeId, from, to]);
  return r.rows;
}

/**
 * How long between a ticket being sold and the vehicle arriving.
 *
 * Not a vanity metric: it says whether people book from the road or from home,
 * which decides how much of the booking window is real.
 */
async function bookingToEntry(placeId, { from, to }) {
  return one(
    `SELECT count(*)::int AS n,
            ROUND(AVG(EXTRACT(epoch FROM (t.used_at - t.created_at)) / 3600.0)::numeric, 1)::float
              AS avg_hours,
            ROUND((percentile_cont(0.5) WITHIN GROUP (
              ORDER BY EXTRACT(epoch FROM (t.used_at - t.created_at)) / 3600.0))::numeric, 1)::float
              AS median_hours
       FROM tickets t
       LEFT JOIN customers c ON c.id = t.customer_id
      WHERE t.place_id = $1 AND t.status = 'used' AND t.used_at IS NOT NULL
        AND t.travel_date BETWEEN $2 AND $3 AND ${NOT_INTERNAL}`, [placeId, from, to]);
}

/** Occupancy per day as a percentage — the heat of the season. */
async function occupancySeries(placeId, { from, to }) {
  const r = await query(
    `SELECT i.travel_date AS date,
            sum(i.capacity)::int AS capacity,
            sum(i.booked)::int AS booked,
            CASE WHEN sum(i.capacity) > 0
                 THEN ROUND((sum(i.booked)::numeric / sum(i.capacity)) * 100, 1)::float
                 ELSE 0 END AS pct
       FROM slot_inventory i
      WHERE i.place_id = $1 AND i.travel_date BETWEEN $2 AND $3
      GROUP BY i.travel_date ORDER BY i.travel_date`, [placeId, from, to]);
  return r.rows;
}

/**
 * The operating ratios a department asks for by name.
 *
 * NO-SHOW AND CANCELLATION ARE NOT THE SAME THING and are deliberately kept
 * apart. A cancellation is a decision the visitor made and told us about; a
 * no-show is a place that was paid for, held against everyone else, and then
 * left empty. Only the second one costs the department a visitor it could have
 * admitted, and only the second one argues for overbooking.
 */
async function operations(placeId, { from, to }) {
  const t = await one(
    `SELECT count(*)::int AS sold,
            count(*) FILTER (WHERE t.status = 'used')::int AS arrived,
            count(*) FILTER (WHERE t.status = 'paid'
                               AND t.travel_date < CURRENT_DATE)::int AS no_show,
            count(*) FILTER (WHERE t.status = 'cancelled')::int AS cancelled,
            count(*) FILTER (WHERE t.move_count > 0)::int AS postponed
       FROM tickets t
       LEFT JOIN customers c ON c.id = t.customer_id
      WHERE t.place_id = $1 AND t.travel_date BETWEEN $2 AND $3
        AND t.status <> 'expired' AND ${NOT_INTERNAL}`, [placeId, from, to]);

  /* Only days that have already happened can have a no-show, so the rate is
     taken against those alone. Including tomorrow's bookings would make the
     figure improve every time somebody books ahead, which is nonsense. */
  const settled = await one(
    `SELECT count(*)::int AS n
       FROM tickets t LEFT JOIN customers c ON c.id = t.customer_id
      WHERE t.place_id = $1 AND t.travel_date BETWEEN $2 AND $3
        AND t.travel_date < CURRENT_DATE
        AND t.status IN ('paid','used') AND ${NOT_INTERNAL}`, [placeId, from, to]);

  const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

  /* When people arrive, measured against when their slot opened rather than
     against the clock — a 7 a.m. arrival means something different for a
     morning ticket than for an afternoon one. */
  const arrival = await one(
    `SELECT count(*)::int AS n,
            ROUND(AVG(EXTRACT(hour FROM sc.scanned_at)
                    + EXTRACT(minute FROM sc.scanned_at) / 60.0)::numeric, 2)::float
              AS avg_hour,
            ROUND(AVG(EXTRACT(epoch FROM (
                    sc.scanned_at - (t.travel_date + s.starts_at))) / 60.0)::numeric, 0)::int
              AS avg_minutes_after_open
       FROM scans sc
       JOIN tickets t ON t.id = sc.ticket_id
       JOIN place_slots s ON s.id = t.slot_id
      WHERE t.place_id = $1 AND sc.verdict = 'valid'
        AND t.travel_date BETWEEN $2 AND $3`, [placeId, from, to]);

  /* And when people BOOK, which is a different question from when they arrive
     and decides when a reminder or a release should be timed. */
  const bookingHours = (await query(
    `SELECT EXTRACT(hour FROM t.created_at)::int AS hour, count(*)::int AS tickets
       FROM tickets t LEFT JOIN customers c ON c.id = t.customer_id
      WHERE t.place_id = $1 AND t.travel_date BETWEEN $2 AND $3
        AND ${LIVE} AND ${NOT_INTERNAL}
      GROUP BY 1 ORDER BY 1`, [placeId, from, to])).rows;

  const hours = [];
  for (let h = 0; h < 24; h++) {
    hours.push({ hour: h, tickets: bookingHours.find((x) => x.hour === h)?.tickets || 0 });
  }
  const peak = hours.reduce((a, x) => (x.tickets > a.tickets ? x : a), hours[0]);

  return {
    ...t,
    settled: settled.n,
    no_show_rate: pct(t.no_show, settled.n),
    cancellation_rate: pct(t.cancelled, t.sold),
    postpone_rate: pct(t.postponed, t.sold),
    arrival: {
      n: arrival.n,
      avg_hour: arrival.avg_hour,
      avg_label: arrival.avg_hour != null ? clockLabel(arrival.avg_hour) : null,
      avg_minutes_after_open: arrival.avg_minutes_after_open,
    },
    booking_hours: hours,
    peak_booking_hour: peak,
  };
}

/** 7.75 -> "7:45 am" — an average hour is unreadable as a decimal. */
function clockLabel(dec) {
  const h = Math.floor(dec);
  const m = Math.round((dec - h) * 60);
  const ampm = h >= 12 ? 'pm' : 'am';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** Headline counts for the analytics page. */
async function summary(placeId, { from, to }) {
  return one(
    `SELECT count(*)::int AS tickets,
            count(*) FILTER (WHERE t.status = 'used')::int AS entered,
            count(DISTINCT t.customer_id)::int AS customers,
            count(DISTINCT t.vehicle_id)::int AS vehicles,
            COALESCE(sum(t.total_paise),0)::int AS gross_paise,
            COALESCE(sum(t.entry_paise),0)::int AS entry_paise,
            COALESCE(sum(t.platform_paise),0)::int AS fee_paise,
            COALESCE(ROUND(AVG(t.total_paise))::int, 0) AS avg_ticket_paise,
            count(*) FILTER (WHERE t.move_count > 0)::int AS postponed
       FROM tickets t
       LEFT JOIN customers c ON c.id = t.customer_id
      WHERE t.place_id = $1 AND t.travel_date BETWEEN $2 AND $3
        AND ${LIVE} AND ${NOT_INTERNAL}`, [placeId, from, to]);
}

module.exports = {
  live, daily, byHour, byWeekday, leadTime,
  repeatVisitors, newVsReturning,
  customers, customerDetail, vehicles, vehicleDetail,
  ticketBoard, upcoming, operations,
  staffPerformance, shifts, bookingToEntry, occupancySeries, summary,
};
