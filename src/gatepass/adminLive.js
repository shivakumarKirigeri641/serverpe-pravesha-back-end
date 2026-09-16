/**
 * adminLive.js — what is happening at the gates right now.
 *
 * The dashboard reports on a day. This reports on a minute: who is on duty, what
 * they just checked, how fast, and how today's traffic is running against
 * yesterday's at the same hour.
 *
 * AGAINST YESTERDAY AT THE SAME HOUR, NOT YESTERDAY'S TOTAL. Comparing 11 a.m.
 * today with a full day yesterday would report a collapse every morning. Every
 * "vs yesterday" figure here is cut at the current hour on both days.
 *
 * TWO THINGS THE SYSTEM CANNOT SEE, AND SAYS SO:
 *
 *   Vehicles inside. Nothing records an exit — a visitor drives out past a gate
 *   nobody is stood at. "Inside" is therefore an estimate: vehicles that entered
 *   and whose slot has not ended. It is labelled as an estimate everywhere it
 *   appears, because a number presented as a count of vehicles on a hill had
 *   better be one.
 *
 *   Vehicle mismatch. Staff look a vehicle up by its own number, so a pass
 *   cannot be presented against a different vehicle. Null, not zero.
 *
 * VERIFICATION TIMES come from the gate app, which measures from opening a pass
 * to recording the entry (032). Checks recorded before that existed have no
 * measurement and are excluded from the averages rather than counted as zero.
 */

const { query } = require('./db');
const slotTime = require('./slotTime');

const rowsOf = async (text, params) => (await query(text, params)).rows;
const n = (v) => Number(v || 0);

const REFUSALS = ['unknown_ticket', 'wrong_day', 'wrong_place', 'not_paid', 'cancelled'];

function delta(today, yesterday) {
  const diff = today - yesterday;
  return {
    value: today,
    previous: yesterday,
    diff,
    percent: yesterday === 0 ? null : Math.round((diff / yesterday) * 1000) / 10,
    direction: diff === 0 ? 'flat' : diff > 0 ? 'up' : 'down',
  };
}

function previousDay(date) {
  const [y, m, d] = String(date).split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() - 1);
  return at.toISOString().slice(0, 10);
}

/** Visitors: booked, arrived, entered, still expected, no-shows, and inside. */
async function visitors(today, yesterday, nowTime, hour) {
  const buffer = slotTime.LAST_ENTRY_BUFFER_MIN;

  const [t] = await rowsOf(
    `SELECT
       count(*) FILTER (WHERE t.status IN ('paid','used'))                    AS booked,
       count(*) FILTER (WHERE t.status = 'used')                              AS entered,
       count(*) FILTER (WHERE t.status = 'paid'
                          AND (s.ends_at - make_interval(mins => $2::int)) > $3::time) AS yet_to_arrive,
       count(*) FILTER (WHERE t.status = 'paid'
                          AND (s.ends_at - make_interval(mins => $2::int)) <= $3::time) AS skipped,
       /* Entered, and their slot has not ended: still on the hill, as far as
          anything here can tell. */
       count(*) FILTER (WHERE t.status = 'used' AND s.ends_at > $3::time)     AS inside
     FROM tickets t JOIN place_slots s ON s.id = t.slot_id
    WHERE t.travel_date = $1`, [today, buffer, nowTime]);

  /* Yesterday, cut at this hour, so morning is compared with morning. */
  const [y] = await rowsOf(
    `SELECT
       count(*) FILTER (WHERE t.status IN ('paid','used'))  AS booked,
       count(*) FILTER (WHERE t.status = 'used'
                          AND (t.used_at AT TIME ZONE 'Asia/Kolkata')::time <= $2::time) AS entered
     FROM tickets t WHERE t.travel_date = $1`, [yesterday, nowTime]);

  const [arrived] = await rowsOf(
    `SELECT count(DISTINCT ticket_id) AS today,
            0 AS placeholder
       FROM scans
      WHERE ticket_id IS NOT NULL AND (scanned_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date`, [today]);

  const [arrivedY] = await rowsOf(
    `SELECT count(DISTINCT ticket_id) AS yesterday
       FROM scans
      WHERE ticket_id IS NOT NULL
        AND (scanned_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date
        AND (scanned_at AT TIME ZONE 'Asia/Kolkata')::time <= $2::time`, [yesterday, nowTime]);

  const [entriesToday] = await rowsOf(
    `SELECT count(*) AS n FROM scans
      WHERE verdict IN ('valid','valid_override')
        AND (scanned_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date`, [today]);

  const [entriesY] = await rowsOf(
    `SELECT count(*) AS n FROM scans
      WHERE verdict IN ('valid','valid_override')
        AND (scanned_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date
        AND (scanned_at AT TIME ZONE 'Asia/Kolkata')::time <= $2::time`, [yesterday, nowTime]);

  return {
    booked: delta(n(t.booked), n(y.booked)),
    entered: delta(n(t.entered), n(y.entered)),
    /* Kept for the checks count, not shown as a separate visitor figure: a pass
       looked up and a pass entered are the same action for a valid pass. */
    checkedAtGate: delta(n(arrived.today), n(arrivedY.yesterday)),
    yetToArrive: { value: n(t.yet_to_arrive) },
    skipped: { value: n(t.skipped) },
    /* An estimate, and labelled as one: no exit is recorded anywhere. */
    inside: { value: n(t.inside), estimated: true },
    totalEntries: delta(n(entriesToday.n), n(entriesY.n)),
    comparedAtHour: hour,
  };
}

/** Vehicles that have entered today, by type, against yesterday at this hour. */
async function vehicles(today, yesterday, nowTime) {
  const rows = await rowsOf(
    `SELECT c.code, c.label,
            count(*) FILTER (WHERE sc.scan_date = $1::date) AS today,
            count(*) FILTER (WHERE sc.scan_date = $2::date AND sc.scan_time <= $3::time) AS yesterday
       FROM vehicle_categories c
       LEFT JOIN (
         SELECT t.category_id,
                (s.scanned_at AT TIME ZONE 'Asia/Kolkata')::date AS scan_date,
                (s.scanned_at AT TIME ZONE 'Asia/Kolkata')::time AS scan_time
           FROM scans s JOIN tickets t ON t.id = s.ticket_id
          WHERE s.verdict IN ('valid','valid_override')
            AND (s.scanned_at AT TIME ZONE 'Asia/Kolkata')::date IN ($1::date, $2::date)
       ) sc ON sc.category_id = c.id
      WHERE c.is_active
      GROUP BY c.id, c.code, c.label, c.sort_order
      ORDER BY c.sort_order, c.id`, [today, yesterday, nowTime]);

  const total = rows.reduce((sum, r) => sum + n(r.today), 0);
  return rows.map((r) => ({
    code: r.code,
    label: r.label,
    ...delta(n(r.today), n(r.yesterday)),
    /* Share of today's traffic, which is what tells an officer whether the road
       is full of bikes or of Tempo Travellers. */
    shareOfTraffic: total ? Math.round((n(r.today) / total) * 1000) / 10 : 0,
  }));
}

/** Entries per hour, today against yesterday, for the traffic graph. */
async function hourly(today, yesterday) {
  const rows = await rowsOf(
    `WITH hours AS (SELECT generate_series(5, 20) AS hour),
     counted AS (
       SELECT extract(hour FROM (s.scanned_at AT TIME ZONE 'Asia/Kolkata'))::int AS hour,
              (s.scanned_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
              t.category_id
         FROM scans s LEFT JOIN tickets t ON t.id = s.ticket_id
        WHERE s.verdict IN ('valid','valid_override')
          AND (s.scanned_at AT TIME ZONE 'Asia/Kolkata')::date IN ($1::date, $2::date))
     SELECT h.hour,
            count(*) FILTER (WHERE c.day = $1::date) AS today,
            count(*) FILTER (WHERE c.day = $2::date) AS yesterday
       FROM hours h LEFT JOIN counted c ON c.hour = h.hour
      GROUP BY h.hour ORDER BY h.hour`, [today, yesterday]);

  return rows.map((r) => ({
    hour: n(r.hour),
    label: `${((n(r.hour) + 11) % 12) + 1} ${n(r.hour) < 12 ? 'AM' : 'PM'}`,
    today: n(r.today),
    yesterday: n(r.yesterday),
    difference: n(r.today) - n(r.yesterday),
  }));
}

/** Entries per hour per vehicle type, for the category graph. */
async function hourlyByCategory(today) {
  const rows = await rowsOf(
    `WITH hours AS (SELECT generate_series(5, 20) AS hour)
     SELECT h.hour, c.code,
            count(s.id) AS n
       FROM hours h
       CROSS JOIN vehicle_categories c
       LEFT JOIN tickets t ON t.category_id = c.id
       LEFT JOIN scans s ON s.ticket_id = t.id
                        AND s.verdict IN ('valid','valid_override')
                        AND (s.scanned_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date
                        AND extract(hour FROM (s.scanned_at AT TIME ZONE 'Asia/Kolkata'))::int = h.hour
      WHERE c.is_active
      GROUP BY h.hour, c.id, c.code, c.sort_order
      ORDER BY h.hour, c.sort_order`, [today]);

  const byHour = new Map();
  for (const r of rows) {
    const hour = n(r.hour);
    if (!byHour.has(hour)) {
      byHour.set(hour, { hour, label: `${((hour + 11) % 12) + 1} ${hour < 12 ? 'AM' : 'PM'}` });
    }
    byHour.get(hour)[r.code] = n(r.n);
  }
  return [...byHour.values()];
}

/**
 * The gate's activity, newest first — every check, not only the ones that let
 * somebody in.
 *
 * NEWEST FIRST, BY WHEN THE CHECK HAPPENED. Not by row id: a check made on a
 * phone that had no signal reaches us later than it happened, so id order and
 * time order are not the same thing, and a feed that claims to be newest-first
 * had better be.
 *
 * PAGED BY THE ROW ITSELF, NOT BY AN OFFSET. Checks arrive while somebody is
 * reading: an offset of 25 means something different each time one lands, and
 * page two would repeat rows page one already showed. The cursor is the time and
 * id of the last row on the page — the id breaks ties between checks recorded in
 * the same second — so "older than this one" stays true however much arrives
 * above it.
 */
const cursorOf = (row) => `${new Date(row.scanned_at).toISOString()}|${row.id}`;

function parseCursor(cursor) {
  const [at, id] = String(cursor || '').split('|');
  if (!at || !id || Number.isNaN(Date.parse(at)) || !/^\d+$/.test(id)) return null;
  return { at, id };
}

async function activity({ limit = 25, before = null, date = null } = {}) {
  const size = Math.max(1, Math.min(100, Number(limit) || 25));
  const cursor = parseCursor(before);
  /* Live monitoring is today. Paging back walks this morning, not last week —
     yesterday's checks are history and belong to Reports and Ticket management. */
  const today = date || slotTime.nowIST().date;

  const rows = await rowsOf(
    `SELECT s.id, s.verdict, s.scanned_at, s.ticket_no, s.reg_no, s.duration_ms,
            st.name AS staff_name, cp.name AS checkpost_name,
            c.label AS category_label, c.code AS category_code,
            cu.name AS customer_name, cu.wa_profile_name
       FROM scans s
       LEFT JOIN staff st ON st.id = s.staff_id
       LEFT JOIN checkposts cp ON cp.id = s.checkpost_id
       LEFT JOIN tickets t ON t.id = s.ticket_id
       LEFT JOIN vehicle_categories c ON c.id = t.category_id
       LEFT JOIN customers cu ON cu.id = t.customer_id
      WHERE (s.scanned_at AT TIME ZONE 'Asia/Kolkata')::date = $4::date
        AND ($1::timestamptz IS NULL
             OR (s.scanned_at, s.id) < ($1::timestamptz, $2::bigint))
      ORDER BY s.scanned_at DESC, s.id DESC
      LIMIT $3`, [cursor ? cursor.at : null, cursor ? cursor.id : null, size + 1, today]);

  /* One row more than asked for, purely to know whether there is another page. */
  const hasMore = rows.length > size;
  const page = hasMore ? rows.slice(0, size) : rows;

  return {
    rows: page,
    hasMore,
    nextCursor: hasMore && page.length ? cursorOf(page[page.length - 1]) : null,
  };
}

const shapeActivity = (r) => ({
  id: String(r.id),
  at: r.scanned_at,
  verdict: r.verdict,
  staff: r.staff_name,
  checkpost: r.checkpost_name,
  regNo: r.reg_no,
  ticketNo: r.ticket_no,
  type: r.category_label,
  typeCode: r.category_code,
  visitor: r.customer_name || r.wa_profile_name || null,
  durationMs: r.duration_ms,
});

/** How many checks there have been at all, and today — for the pager's footing. */
async function activityCounts(today) {
  const [row] = await rowsOf(
    `SELECT count(*) AS today,
            count(*) FILTER (WHERE verdict IN ('valid','valid_override')) AS entered,
            count(*) FILTER (WHERE verdict NOT IN ('valid','valid_override')) AS refused
       FROM scans WHERE (scanned_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date`, [today]);
  return { today: n(row.today), entered: n(row.entered), refused: n(row.refused) };
}

/** Who is on duty, and how each of them is working. */
async function staff(today) {
  const rows = await rowsOf(
    `SELECT st.id, st.name, st.is_active,
            ss.started_at, ss.last_seen_at, ss.ended_at,
            cp.name AS checkpost_name,
            count(sc.id)                                              AS checks,
            count(sc.id) FILTER (WHERE sc.verdict IN ('valid','valid_override')) AS entries,
            avg(sc.duration_ms) FILTER (WHERE sc.duration_ms IS NOT NULL)        AS avg_ms,
            min(sc.duration_ms) FILTER (WHERE sc.duration_ms IS NOT NULL)        AS fastest_ms,
            max(sc.duration_ms) FILTER (WHERE sc.duration_ms IS NOT NULL)        AS slowest_ms,
            max(sc.scanned_at)                                        AS last_check_at
       FROM staff st
       LEFT JOIN staff_sessions ss ON ss.staff_id = st.id AND ss.ended_at IS NULL
       LEFT JOIN checkposts cp ON cp.id = ss.checkpost_id
       LEFT JOIN scans sc ON sc.staff_id = st.id
                         AND (sc.scanned_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date
      WHERE st.is_active
      GROUP BY st.id, st.name, st.is_active, ss.started_at, ss.last_seen_at, ss.ended_at, cp.name
      ORDER BY (ss.started_at IS NULL), st.name`, [today]);

  const now = Date.now();
  return rows.map((r) => {
    const seen = r.last_seen_at ? new Date(r.last_seen_at).getTime() : null;
    const sinceSeen = seen ? Math.round((now - seen) / 1000) : null;
    const lastCheck = r.last_check_at ? Math.round((now - new Date(r.last_check_at).getTime()) / 1000) : null;
    return {
      id: String(r.id),
      name: r.name,
      checkpost: r.checkpost_name,
      /* On duty means a shift is open; online means their phone has spoken to us
         within the last two minutes. A phone in a pocket on a hill goes quiet
         without anybody leaving the gate. */
      onDuty: Boolean(r.started_at),
      online: sinceSeen !== null && sinceSeen <= 120,
      secondsSinceSeen: sinceSeen,
      shiftStartedAt: r.started_at,
      /* "Currently checking" is not a state anything reports; a check in the
         last half-minute is the closest honest reading. */
      checkingNow: lastCheck !== null && lastCheck <= 30,
      lastCheckAt: r.last_check_at,
      checks: n(r.checks),
      entries: n(r.entries),
      averageMs: r.avg_ms === null ? null : Math.round(Number(r.avg_ms)),
      fastestMs: r.fastest_ms === null ? null : n(r.fastest_ms),
      slowestMs: r.slowest_ms === null ? null : n(r.slowest_ms),
    };
  });
}

/** How fast the gate is working, as a whole. */
async function performance(today, nowMinutes) {
  const [row] = await rowsOf(
    `SELECT count(*) AS checks,
            count(*) FILTER (WHERE verdict IN ('valid','valid_override')) AS entries,
            count(duration_ms) AS measured,
            avg(duration_ms) AS avg_ms,
            min(duration_ms) AS fastest_ms,
            max(duration_ms) AS slowest_ms,
            min(scanned_at) AS first_at,
            max(scanned_at) AS last_at
       FROM scans
      WHERE (scanned_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date`, [today]);

  const [peak] = await rowsOf(
    `SELECT extract(hour FROM (scanned_at AT TIME ZONE 'Asia/Kolkata'))::int AS hour, count(*) AS n
       FROM scans
      WHERE verdict IN ('valid','valid_override')
        AND (scanned_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date
      GROUP BY 1 ORDER BY n DESC, hour LIMIT 1`, [today]);

  /* Rate is measured across the window the gate was actually working, not across
     the whole day: a gate that opened an hour ago has not been idle since
     midnight. */
  const first = row.first_at ? new Date(row.first_at).getTime() : null;
  const workedMinutes = first ? Math.max(1, (Date.now() - first) / 60000) : null;
  const entries = n(row.entries);

  return {
    checks: n(row.checks),
    entries,
    measured: n(row.measured),
    averageMs: row.avg_ms === null ? null : Math.round(Number(row.avg_ms)),
    fastestMs: row.fastest_ms === null ? null : n(row.fastest_ms),
    slowestMs: row.slowest_ms === null ? null : n(row.slowest_ms),
    perMinute: workedMinutes ? Math.round((entries / workedMinutes) * 100) / 100 : null,
    perHour: workedMinutes ? Math.round((entries / workedMinutes) * 60) : null,
    firstAt: row.first_at,
    lastAt: row.last_at,
    peak: peak ? { hour: n(peak.hour), label: `${((n(peak.hour) + 11) % 12) + 1} ${n(peak.hour) < 12 ? 'AM' : 'PM'}`, entries: n(peak.n) } : null,
    nowMinutes,
  };
}

/** Today's verdicts, counted — the live tally the event feed adds up to. */
async function verdicts(today) {
  const rows = await rowsOf(
    `SELECT verdict, count(*) AS n
       FROM scans
      WHERE (scanned_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date
      GROUP BY verdict`, [today]);

  const counts = Object.fromEntries(rows.map((r) => [r.verdict, n(r.n)]));
  const [repeat] = await rowsOf(
    `SELECT COALESCE(sum(attempts - 1), 0) AS repeats
       FROM (SELECT reg_no, count(*) AS attempts FROM scans
              WHERE (scanned_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date
                AND reg_no IS NOT NULL AND verdict <> ALL($2::text[])
              GROUP BY reg_no HAVING count(*) > 1) r`, [today, ['valid', 'valid_override']]);

  return {
    valid: (counts.valid || 0) + (counts.valid_override || 0),
    allowedLate: counts.valid_override || 0,
    alreadyUsed: counts.already_used || 0,
    invalid: REFUSALS.reduce((sum, v) => sum + (counts[v] || 0), 0),
    unknownTicket: counts.unknown_ticket || 0,
    wrongDay: counts.wrong_day || 0,
    wrongPlace: counts.wrong_place || 0,
    notPaid: counts.not_paid || 0,
    cancelled: counts.cancelled || 0,
    outsideSlot: counts.wrong_slot || 0,
    repeatAttempt: n(repeat.repeats),
    /* Staff look a vehicle up by its own number: nothing to mismatch. */
    vehicleMismatch: null,
  };
}

/**
 * The vehicle being dealt with right now — in practice, the most recent check.
 *
 * Everything an officer would otherwise have to go and search for, including how
 * many times this vehicle has been here before, so a regular is visible as one.
 */
async function currentVehicle(today) {
  const [row] = await rowsOf(
    `SELECT s.verdict, s.scanned_at, s.duration_ms, s.ticket_no, s.reg_no,
            t.id AS ticket_id, t.travel_date, t.status, t.created_at AS booked_at, t.mobile,
            p.name AS place_name, cp.name AS checkpost_name, st.name AS staff_name,
            regexp_replace(sl.label, '[[:space:]]+', ' ', 'g') AS slot_label,
            c.label AS category_label, c.code AS category_code,
            v.maker, v.model, v.fuel, v.colour,
            cu.name AS customer_name, cu.wa_profile_name
       FROM scans s
       LEFT JOIN tickets t ON t.id = s.ticket_id
       LEFT JOIN places p ON p.id = t.place_id
       LEFT JOIN place_slots sl ON sl.id = t.slot_id
       LEFT JOIN vehicle_categories c ON c.id = t.category_id
       LEFT JOIN vehicles v ON v.id = t.vehicle_id
       LEFT JOIN customers cu ON cu.id = t.customer_id
       LEFT JOIN checkposts cp ON cp.id = s.checkpost_id
       LEFT JOIN staff st ON st.id = s.staff_id
      WHERE (s.scanned_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date
      ORDER BY s.scanned_at DESC LIMIT 1`, [today]);

  if (!row) return null;

  /* A refused check has no pass, so the vehicle could not be reached through
     one — and that is exactly the moment an officer wants to know what is
     sitting at the barrier. Look the plate up in the vehicle cache directly. */
  let cached = null;
  if (!row.ticket_id && row.reg_no) {
    /* The registration class as VAHAN states it — not a Pravesha category, since
       classifying a vehicle is the booking's job and matching its patterns here
       would be a second, quietly diverging copy of that rule. */
    [cached] = await rowsOf(
      `SELECT maker, model, fuel, colour, vehicle_class, vehicle_category
         FROM vehicles WHERE reg_no = $1`, [row.reg_no]);
  }

  /* How often this vehicle has been admitted before today's visit. */
  const [visits] = await rowsOf(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE travel_date < $2::date) AS previous
       FROM tickets WHERE reg_no = $1 AND status = 'used'`, [row.reg_no, row.travel_date || new Date()]);

  return {
    at: row.scanned_at,
    verdict: row.verdict,
    durationMs: row.duration_ms,
    staff: row.staff_name,
    checkpost: row.checkpost_name,
    vehicle: {
      regNo: row.reg_no,
      type: row.category_label || cached?.vehicle_category || cached?.vehicle_class || null,
      typeCode: row.category_code || null,
      description: [row.maker || cached?.maker, row.model || cached?.model].filter(Boolean).join(' ') || null,
      fuel: row.fuel || cached?.fuel || null,
      colour: row.colour || cached?.colour || null,
      /* True when the details came from the cache rather than from a pass: the
         vehicle is known to us, but this visit was not booked. */
      fromCache: Boolean(!row.ticket_id && cached),
    },
    pass: row.ticket_id ? {
      ticketNo: row.ticket_no,
      status: row.status,
      place: row.place_name,
      travelDate: row.travel_date instanceof Date ? row.travel_date.toISOString().slice(0, 10) : row.travel_date,
      slot: row.slot_label,
      bookedAt: row.booked_at,
    } : null,
    visitor: row.ticket_id ? {
      name: row.customer_name || row.wa_profile_name || null,
      /* Masked here, not in the browser: the panel should never hold a number it
         does not need, and an officer only needs to read the last four back. */
      mobile: row.mobile ? `••••${String(row.mobile).slice(-4)}` : null,
    } : null,
    visits: {
      previous: n(visits.previous),
      current: n(visits.previous) + 1,
      totalRecorded: n(visits.total),
    },
  };
}

/**
 * Has anything actually happened?
 *
 * WHY THIS EXISTS. The live screen used to rebuild itself every five seconds
 * whether or not a single vehicle had moved — a dozen queries, a redrawn table,
 * and numbers that rolled from 41 to 41. On a quiet Tuesday afternoon that is
 * all cost and no information. A gate is not a clock: the things worth
 * redrawing are somebody being checked at the barrier and somebody buying a
 * pass, and both of them are writes this server made itself.
 *
 * So this is the cheap question asked often, and the expensive one asked only
 * when the answer changes. Three counters and three newest rows, no joins: it
 * costs a fraction of a full refresh, and a screen sitting on a wall in an empty
 * office settles into asking a tiny question and being told "nothing".
 *
 * WHAT COUNTS AS SOMETHING. A check at a gate, a pass sold by any route — the
 * robot, the panel, or the barrier — and a member of staff starting or ending a
 * shift. Deliberately not the heartbeat a phone sends while it sits in a
 * pocket: that would tick forever and make the whole idea pointless.
 */
async function pulse(date = null) {
  const today = date || slotTime.nowIST().date;
  const [row] = await rowsOf(
    `SELECT (SELECT count(*) FROM scans
              WHERE (scanned_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date)      AS checks,
            (SELECT COALESCE(max(id), 0) FROM scans
              WHERE (scanned_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date)      AS last_check,
            (SELECT count(*) FROM tickets
              WHERE travel_date = $1::date
                 OR (created_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date)      AS passes,
            (SELECT COALESCE(max(id), 0) FROM tickets
              WHERE travel_date = $1::date
                 OR (created_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date)      AS last_pass,
            /* A booking succeeds by a held pass turning paid, which adds no row
               and no id — so the newest change to any of today's passes is part
               of the answer too. Paid, used, released and expired all move it. */
            (SELECT COALESCE(floor(extract(epoch FROM max(modified_at)) * 1000), 0) FROM tickets
              WHERE travel_date = $1::date
                 OR (created_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date)      AS pass_changed,
            /* Capacity changed or a slot closed for today: every screen showing
               places left must catch up, the booking form's numbers included. */
            (SELECT COALESCE(floor(extract(epoch FROM max(modified_at)) * 1000), 0) FROM slot_inventory
              WHERE travel_date = $1::date)                                         AS capacity_changed,
            (SELECT count(*) FROM staff_sessions
              WHERE (started_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date)      AS shifts,
            (SELECT count(*) FROM staff_sessions
              WHERE ended_at IS NULL AND started_at > now() - interval '18 hours')   AS on_duty,
            /*
             * WHATEVER DATE IT IS FOR (user, 2026-09-16). The markers above
             * watch today; money does not. A pass booked today for next week, a
             * refund of last week's, an invoice, a sale at the barrier, a failed
             * checkout — each changes what the money screens show, and the
             * GST & Invoices list stayed as it was until it was reloaded by hand.
             * Each of these is an index lookup (migration 060).
             */
            (SELECT COALESCE(max(id), 0) FROM tickets)                              AS any_pass,
            (SELECT COALESCE(floor(extract(epoch FROM max(modified_at)) * 1000), 0) FROM tickets) AS any_pass_changed,
            (SELECT COALESCE(max(id), 0) FROM payments)                             AS any_payment,
            (SELECT COALESCE(floor(extract(epoch FROM max(paid_at)) * 1000), 0) FROM payments)     AS any_paid,
            (SELECT COALESCE(floor(extract(epoch FROM max(refunded_at)) * 1000), 0) FROM payments) AS any_refund,
            (SELECT count(*) FROM payments WHERE status = 'failed')                 AS failed_payments,
            (SELECT COALESCE(max(id), 0) FROM invoices)                             AS any_invoice,
            (SELECT COALESCE(max(id), 0) FROM ticket_grants)                        AS any_grant`,
    [today]);

  /* One short string the screen can compare with the last one it saw. Its shape
     is nobody's business but this file's — it is an "is it still the same?",
     not a report. */
  const beat = [row.checks, row.last_check, row.passes, row.last_pass, row.pass_changed, row.capacity_changed, row.shifts, row.on_duty,
    row.any_pass, row.any_pass_changed, row.any_payment, row.any_paid, row.any_refund, row.failed_payments, row.any_invoice, row.any_grant].join('.');
  return {
    date: today,
    pulse: beat,
    checks: n(row.checks),
    passes: n(row.passes),
    onDuty: n(row.on_duty),
    serverTime: slotTime.hhmm(slotTime.nowIST().minutes),
  };
}

/**
 * Each of today's slots: the first vehicle through the gate, and the latest.
 *
 * WHY THESE TWO. The first entry says when the slot really started moving — a
 * morning slot that opens at six and sees its first car at twenty to eight is a
 * different morning from one that queues at the barrier. The latest says the
 * slot is still flowing, or that it stopped an hour ago. Together, per slot,
 * they are what an officer reads off a wall screen without opening the feed.
 *
 * An entry is an admitted check at a gate — valid, or admitted anyway — or a
 * visitor who recorded themselves at the gate when paying, which writes the
 * same row. The pass decides the slot, not the clock: a morning pass admitted
 * late still belongs to the morning.
 */
async function slotEntries(today) {
  const slots = await rowsOf(
    `SELECT s.id, s.code, regexp_replace(s.label, '[[:space:]]+', ' ', 'g') AS label, s.starts_at, s.ends_at,
            p.id AS place_id, p.name AS place_name
       FROM place_slots s
       JOIN places p ON p.id = s.place_id AND p.is_active
      WHERE s.is_active
        AND (s.valid_from IS NULL OR s.valid_from <= $1::date)
        AND (s.valid_to IS NULL OR s.valid_to >= $1::date)
      ORDER BY p.id, s.starts_at, s.sort_order`, [today]);
  if (!slots.length) return [];

  const entries = await rowsOf(
    `WITH admitted AS (
       SELECT sc.id, sc.scanned_at, sc.reg_no, sc.ticket_no, sc.verdict, sc.staff_id, sc.checkpost_id,
              t.slot_id, t.entry_source, t.category_id, t.customer_id
         FROM scans sc JOIN tickets t ON t.id = sc.ticket_id
        WHERE (sc.scanned_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date
          AND sc.verdict IN ('valid', 'valid_override')
          AND t.travel_date = $1::date
     ),
     /* A pass checked twice is still one vehicle in. */
     per_slot AS (
       SELECT slot_id, count(DISTINCT ticket_no) AS entered FROM admitted GROUP BY slot_id
     ),
     ranked AS (
       SELECT a.*,
              row_number() OVER (PARTITION BY slot_id ORDER BY scanned_at ASC, id ASC)   AS from_first,
              row_number() OVER (PARTITION BY slot_id ORDER BY scanned_at DESC, id DESC) AS from_last
         FROM admitted a
     )
     SELECT r.*, ps.entered, c.label AS category_label, c.code AS category_code,
            st.name AS staff_name, cp.name AS checkpost_name,
            cu.name AS customer_name, cu.wa_profile_name
       FROM ranked r
       JOIN per_slot ps ON ps.slot_id = r.slot_id
       LEFT JOIN vehicle_categories c ON c.id = r.category_id
       LEFT JOIN staff st ON st.id = r.staff_id
       LEFT JOIN checkposts cp ON cp.id = r.checkpost_id
       LEFT JOIN customers cu ON cu.id = r.customer_id
      WHERE r.from_first = 1 OR r.from_last = 1`, [today]);

  const booked = await rowsOf(
    `SELECT slot_id, count(*) AS n FROM tickets
      WHERE travel_date = $1::date AND status IN ('paid', 'used')
      GROUP BY slot_id`, [today]);
  const bookedBy = Object.fromEntries(booked.map((b) => [String(b.slot_id), n(b.n)]));

  /* Closed for today from live monitoring, or by an announcement's closure. */
  const openness = await rowsOf(
    `SELECT slot_id, bool_and(is_open) AS open, max(closed_note) AS note
       FROM slot_inventory WHERE travel_date = $1::date GROUP BY slot_id`, [today]);
  const closedBy = Object.fromEntries(openness.map((o) => [String(o.slot_id), { closed: o.open === false, note: o.note }]));

  const shape = (r) => (r ? {
    at: r.scanned_at,
    regNo: r.reg_no,
    ticketNo: r.ticket_no,
    type: r.category_label,
    typeCode: r.category_code,
    visitor: r.customer_name || r.wa_profile_name || null,
    staff: r.staff_name || null,
    checkpost: r.checkpost_name || null,
    /* Recorded by the visitor at the gate when paying, rather than by staff. */
    selfDeclared: r.entry_source === 'self' && !r.staff_name,
    admittedAnyway: r.verdict === 'valid_override',
  } : null);

  const now = slotTime.nowIST();
  return slots.map((s) => {
    const mine = entries.filter((e) => String(e.slot_id) === String(s.id));
    const first = mine.find((e) => n(e.from_first) === 1) || null;
    const latest = mine.find((e) => n(e.from_last) === 1) || null;
    const starts = slotTime.toMinutes(String(s.starts_at).slice(0, 5));
    const ends = slotTime.toMinutes(String(s.ends_at).slice(0, 5));
    return {
      slotId: String(s.id),
      code: s.code,
      label: s.label,
      placeName: s.place_name,
      startsAt: slotTime.hhmm(starts),
      endsAt: slotTime.hhmm(ends),
      state: now.minutes < starts ? 'upcoming' : now.minutes >= ends ? 'over' : 'open',
      closed: Boolean((closedBy[String(s.id)] || {}).closed),
      closedNote: (closedBy[String(s.id)] || {}).note || null,
      booked: bookedBy[String(s.id)] || 0,
      entered: first ? n(first.entered) : 0,
      first: shape(first),
      /* One entry so far is both the first and the latest; the screen says so
         rather than showing the same car twice. */
      latest: latest && first && latest.id === first.id ? null : shape(latest),
      onlyOne: Boolean(first && latest && latest.id === first.id),
    };
  });
}

/** Everything the live screen needs, in one call. */
async function live() {
  const now = slotTime.nowIST();
  const today = now.date;
  const yesterday = previousDay(today);
  const nowTime = `${slotTime.hhmm(now.minutes)}:59`;

  const [v, veh, hours, byCat, acts, people, perf, verds, current, counts, bySlot] = await Promise.all([
    visitors(today, yesterday, nowTime, slotTime.hhmm(now.minutes)),
    vehicles(today, yesterday, nowTime),
    hourly(today, yesterday),
    hourlyByCategory(today),
    activity({ limit: 25, date: today }),
    staff(today),
    performance(today, now.minutes),
    verdicts(today),
    currentVehicle(today),
    activityCounts(today),
    slotEntries(today),
  ]);

  return {
    date: today,
    comparedWith: yesterday,
    serverTime: slotTime.hhmm(now.minutes),
    visitors: v,
    vehicles: veh,
    traffic: hours,
    trafficByCategory: byCat,
    activity: {
      rows: acts.rows.map(shapeActivity),
      hasMore: acts.hasMore,
      nextCursor: acts.nextCursor,
      counts,
    },
    staff: people,
    performance: perf,
    verdicts: verds,
    current,
    slots: bySlot,
  };
}

module.exports = { live, pulse, activity, shapeActivity, activityCounts, visitors, vehicles, hourly, staff, performance, verdicts, currentVehicle, slotEntries };
