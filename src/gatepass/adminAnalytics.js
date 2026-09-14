/**
 * adminAnalytics.js — who comes here, in what, how often, and when.
 *
 * The dashboard answers "how is today going" and live monitoring answers "what
 * is happening this minute". This answers the questions that need history: which
 * visitors come back, which vehicles are regulars, when the road is busy, and
 * how one period compares with another.
 *
 * A VISITOR IS A MOBILE NUMBER and a vehicle is a registration. There is no
 * account, so "the same visitor" can only mean the same number — which is what
 * the booking proved over WhatsApp, and is exactly as much identity as this
 * product should hold.
 *
 * FREQUENCY IS COUNTED FROM ENTRIES, NOT BOOKINGS. A pass bought and not used
 * says nothing about how often somebody actually comes.
 *
 * NUMBERS ARE MASKED EVERYWHERE THEY LEAVE THIS FILE. The panel shows the last
 * four digits; support reaches a visitor through WhatsApp, not by reading a
 * number off an analytics screen. The privacy policy promises exactly this.
 */

const { query } = require('./db');
const slotTime = require('./slotTime');

const rowsOf = async (text, params) => (await query(text, params)).rows;
const n = (v) => Number(v || 0);
const rupees = (paise) => Math.round(n(paise) / 100);
const mask = (mobile) => (mobile ? `••••${String(mobile).slice(-4)}` : null);
const asDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : (d ? String(d).slice(0, 10) : null));

const shiftDay = (date, days) => {
  const [y, m, d] = String(date).split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
};

const hourLabel = (h) => `${((n(h) + 11) % 12) + 1} ${n(h) < 12 ? 'AM' : 'PM'}`;

/**
 * How a visitor is described, from how often they have actually been.
 *
 * The bands are deliberately coarse. A department will act on "this number has
 * been here eleven times" and not on a decimal visits-per-month figure, and a
 * finer scale would imply a precision that four visits cannot carry.
 */
function classify(visits, firstVisit, lastVisit) {
  if (visits <= 1) return 'first_time';
  if (visits >= 8) return 'frequent';
  if (visits >= 4) return 'returning';
  return 'occasional';
}

/** Visits per month across the span somebody has been visiting. */
function frequency(visits, firstVisit, lastVisit) {
  if (!firstVisit || !lastVisit || visits < 2) return null;
  const days = Math.max(1, (new Date(lastVisit) - new Date(firstVisit)) / 86400000);
  return Math.round((visits / (days / 30)) * 10) / 10;
}

/* ─────────────────────────────────────────────────────── 3.1 visitors ── */

/**
 * Visitors, ranked by how often they have entered.
 *
 * `q` searches a mobile number, a name or a vehicle — the three things somebody
 * at a desk actually has in front of them when a question arrives.
 */
async function visitors({ q = null, limit = 50, offset = 0, band = null } = {}) {
  const size = Math.max(1, Math.min(200, Number(limit) || 50));
  const term = q ? String(q).trim() : null;
  const digits = term ? term.replace(/\D/g, '') : '';
  const plate = term ? term.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';

  const rows = await rowsOf(
    `WITH visits AS (
       SELECT t.customer_id,
              count(*) FILTER (WHERE t.status = 'used')                  AS visits,
              count(*)                                                    AS passes,
              min(t.travel_date) FILTER (WHERE t.status = 'used')         AS first_visit,
              max(t.travel_date) FILTER (WHERE t.status = 'used')         AS last_visit,
              max(t.travel_date) FILTER (WHERE t.status = 'used'
                    AND t.travel_date < (SELECT max(travel_date) FROM tickets x
                                          WHERE x.customer_id = t.customer_id AND x.status = 'used')) AS previous_visit,
              sum(t.total_paise) FILTER (WHERE t.status IN ('paid','used')) AS paid_paise,
              max(t.created_at)                                            AS last_booked_at
         FROM tickets t
        GROUP BY t.customer_id)
     SELECT c.id, c.name, c.wa_profile_name, c.mobile, c.language,
            v.visits, v.passes, v.first_visit, v.last_visit, v.previous_visit,
            v.paid_paise, v.last_booked_at,
            (SELECT string_agg(DISTINCT t2.reg_no, ', ') FROM tickets t2 WHERE t2.customer_id = c.id) AS vehicles,
            (SELECT regexp_replace(s.label, '[[:space:]]+', ' ', 'g')
               FROM tickets t3 JOIN place_slots s ON s.id = t3.slot_id
              WHERE t3.customer_id = c.id
              GROUP BY s.id, s.label ORDER BY count(*) DESC LIMIT 1) AS usual_slot
       FROM customers c
       JOIN visits v ON v.customer_id = c.id
      WHERE v.visits > 0
        /* The band is applied here, before the page is cut: filtering the top
           twenty-five afterwards would find no "returning" visitors among a page
           of the most frequent ones. Same bands as classify(). */
        AND ($6::text IS NULL
             OR ($6 = 'first_time' AND v.visits = 1)
             OR ($6 = 'occasional' AND v.visits BETWEEN 2 AND 3)
             OR ($6 = 'returning'  AND v.visits BETWEEN 4 AND 7)
             OR ($6 = 'frequent'   AND v.visits >= 8))
        AND ($1::text IS NULL
             OR ($2 <> '' AND c.mobile LIKE '%' || $2 || '%')
             OR c.name ILIKE '%' || $1 || '%'
             OR ($3 <> '' AND EXISTS (SELECT 1 FROM tickets t4
                                       WHERE t4.customer_id = c.id AND t4.reg_no LIKE '%' || $3 || '%')))
      /* The id is the tiebreak: without it, two visitors with the same count and
         last visit swap places between queries and show up on two pages. */
      ORDER BY v.visits DESC, v.last_visit DESC NULLS LAST, c.id
      LIMIT $4 OFFSET $5`,
    [term, digits, plate, size, Math.max(0, Number(offset) || 0),
      ['first_time', 'occasional', 'returning', 'frequent'].includes(band) ? band : null]);

  const list = rows.map((r) => {
    const visits = n(r.visits);
    const first = asDate(r.first_visit);
    const last = asDate(r.last_visit);
    return {
      id: String(r.id),
      name: r.name || r.wa_profile_name || null,
      mobile: mask(r.mobile),
      language: r.language,
      vehicles: r.vehicles ? r.vehicles.split(', ') : [],
      passes: n(r.passes),
      visits,
      firstVisit: first,
      lastVisit: last,
      previousVisit: asDate(r.previous_visit),
      usualSlot: r.usual_slot,
      visitsPerMonth: frequency(visits, first, last),
      band: classify(visits, first, last),
      paid: rupees(r.paid_paise),
      lastBookedAt: r.last_booked_at,
    };
  });

  return list;
}

/** How the visitor base divides — the summary above the table. */
async function visitorBands() {
  const rows = await rowsOf(
    `SELECT visits, count(*) AS people FROM (
       SELECT customer_id, count(*) FILTER (WHERE status = 'used') AS visits
         FROM tickets GROUP BY customer_id) v
      WHERE visits > 0 GROUP BY visits`);

  const bands = { first_time: 0, occasional: 0, returning: 0, frequent: 0 };
  let people = 0;
  let entries = 0;
  for (const r of rows) {
    const visits = n(r.visits);
    const count = n(r.people);
    bands[classify(visits)] += count;
    people += count;
    entries += visits * count;
  }
  return {
    people,
    entries,
    repeatShare: people ? Math.round(((people - bands.first_time) / people) * 1000) / 10 : 0,
    visitsPerVisitor: people ? Math.round((entries / people) * 100) / 100 : 0,
    bands,
  };
}

/** One visitor's passes, newest first: what they booked, when, in what, and whether they came. */
async function visitorVisits(customerId) {
  if (!/^\d+$/.test(String(customerId || ''))) return null;
  const [c] = await rowsOf(`SELECT id, name, wa_profile_name, mobile, language, created_at FROM customers WHERE id = $1`, [customerId]);
  if (!c) return null;

  const rows = await rowsOf(
    `SELECT t.ticket_no, t.reg_no, t.travel_date, t.status, t.total_paise, t.created_at, t.used_at,
            regexp_replace(s.label, '[[:space:]]+', ' ', 'g') AS slot_label,
            cat.label AS category_label, p.name AS place_name
       FROM tickets t
       JOIN place_slots s ON s.id = t.slot_id
       JOIN vehicle_categories cat ON cat.id = t.category_id
       JOIN places p ON p.id = t.place_id
      WHERE t.customer_id = $1
      ORDER BY t.travel_date DESC, t.created_at DESC
      LIMIT 200`, [customerId]);

  const used = rows.filter((r) => r.status === 'used');
  const dates = used.map((r) => asDate(r.travel_date)).sort();
  return {
    visitor: {
      id: String(c.id),
      name: c.name || c.wa_profile_name || null,
      mobile: mask(c.mobile),
      language: c.language,
      since: c.created_at,
      visits: used.length,
      firstVisit: dates[0] || null,
      lastVisit: dates[dates.length - 1] || null,
      band: classify(used.length),
      visitsPerMonth: frequency(used.length, dates[0], dates[dates.length - 1]),
    },
    passes: rows.map((r) => ({
      ticketNo: r.ticket_no,
      regNo: r.reg_no,
      type: r.category_label,
      place: r.place_name,
      travelDate: asDate(r.travel_date),
      slot: r.slot_label,
      bookedAt: r.created_at,
      enteredAt: r.used_at,
      status: r.status,
      amount: rupees(r.total_paise),
    })),
  };
}

/* ─────────────────────────────────────────────────────── 3.2 vehicles ── */

/** Everything known about one registration number. */
async function vehicle(regNo) {
  const plate = String(regNo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (plate.length < 4) return null;

  const [v] = await rowsOf(
    `SELECT reg_no, maker, model, fuel, colour, vehicle_class, vehicle_category, seats,
            reg_date, rc_status, rc_fetched_at, is_allowed, deny_code, is_test
       FROM vehicles WHERE reg_no = $1`, [plate]);

  const passes = await rowsOf(
    `SELECT t.ticket_no, t.travel_date, t.status, t.total_paise, t.created_at, t.used_at,
            regexp_replace(s.label, '[[:space:]]+', ' ', 'g') AS slot_label,
            p.name AS place_name, c.label AS category_label,
            cu.name AS customer_name, cu.wa_profile_name, cu.mobile
       FROM tickets t
       JOIN place_slots s ON s.id = t.slot_id
       JOIN places p ON p.id = t.place_id
       JOIN vehicle_categories c ON c.id = t.category_id
       JOIN customers cu ON cu.id = t.customer_id
      WHERE t.reg_no = $1
      ORDER BY t.travel_date DESC, t.created_at DESC
      LIMIT 100`, [plate]);

  if (!v && !passes.length) return null;

  const used = passes.filter((p) => p.status === 'used');
  const slots = new Map();
  for (const p of passes) slots.set(p.slot_label, (slots.get(p.slot_label) || 0) + 1);
  const usualSlot = [...slots.entries()].sort((a, b) => b[1] - a[1])[0];

  const dates = used.map((p) => asDate(p.travel_date)).sort();
  const first = dates[0] || null;
  const last = dates[dates.length - 1] || null;

  /* Whoever books this vehicle most often — often, but not always, one person. */
  const bookers = new Map();
  for (const p of passes) {
    const key = p.mobile;
    if (!bookers.has(key)) {
      bookers.set(key, { name: p.customer_name || p.wa_profile_name || null, mobile: mask(p.mobile), passes: 0 });
    }
    bookers.get(key).passes += 1;
  }

  return {
    vehicle: v ? {
      regNo: v.reg_no,
      maker: v.maker,
      model: v.model,
      fuel: v.fuel,
      colour: v.colour,
      vehicleClass: v.vehicle_class,
      vehicleCategory: v.vehicle_category,
      seats: v.seats,
      registered: asDate(v.reg_date),
      rcStatus: v.rc_status,
      lookedUpAt: v.rc_fetched_at,
      allowed: v.is_allowed,
      denyCode: v.deny_code,
      isTest: v.is_test,
    } : { regNo: plate, unknown: true },
    category: passes[0]?.category_label || null,
    visits: used.length,
    passes: passes.length,
    firstVisit: first,
    lastVisit: last,
    previousVisit: dates.length > 1 ? dates[dates.length - 2] : null,
    visitsPerMonth: frequency(used.length, first, last),
    band: classify(used.length, first, last),
    usualSlot: usualSlot ? { label: usualSlot[0], times: usualSlot[1] } : null,
    totalPaid: rupees(passes.filter((p) => p.status !== 'expired').reduce((sum, p) => sum + n(p.total_paise), 0)),
    bookedBy: [...bookers.values()].sort((a, b) => b.passes - a.passes),
    history: passes.map((p) => ({
      ticketNo: p.ticket_no,
      travelDate: asDate(p.travel_date),
      status: p.status,
      slot: p.slot_label,
      place: p.place_name,
      amount: rupees(p.total_paise),
      bookedAt: p.created_at,
      enteredAt: p.used_at,
      visitor: p.customer_name || p.wa_profile_name || null,
    })),
  };
}

/* ──────────────────────────────────────────────────────── 3.3 traffic ── */

/** Totals, averages and the peaks, across a range of dates. */
async function traffic(from, to) {
  const [totals] = await rowsOf(
    `SELECT count(*) FILTER (WHERE t.status = 'used')                   AS vehicles,
            count(DISTINCT t.customer_id) FILTER (WHERE t.status = 'used') AS visitors,
            count(*) FILTER (WHERE t.status IN ('paid','used'))         AS passes,
            COALESCE(sum(t.total_paise) FILTER (WHERE t.status IN ('paid','used')), 0) AS value_paise
       FROM tickets t
      WHERE t.travel_date BETWEEN $1::date AND $2::date`, [from, to]);

  const byCategory = await rowsOf(
    `SELECT c.code, c.label,
            count(t.id) FILTER (WHERE t.status = 'used') AS entered,
            count(t.id) FILTER (WHERE t.status IN ('paid','used')) AS booked
       FROM vehicle_categories c
       LEFT JOIN tickets t ON t.category_id = c.id AND t.travel_date BETWEEN $1::date AND $2::date
      WHERE c.is_active
      GROUP BY c.id, c.code, c.label, c.sort_order ORDER BY c.sort_order`, [from, to]);

  const days = await rowsOf(
    `SELECT t.travel_date AS day, count(*) FILTER (WHERE t.status = 'used') AS entered
       FROM tickets t WHERE t.travel_date BETWEEN $1::date AND $2::date
      GROUP BY t.travel_date ORDER BY entered DESC`, [from, to]);

  const hours = await rowsOf(
    `SELECT extract(hour FROM (s.scanned_at AT TIME ZONE 'Asia/Kolkata'))::int AS hour, count(*) AS entries
       FROM scans s
      WHERE s.verdict IN ('valid','valid_override')
        AND (s.scanned_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1::date AND $2::date
      GROUP BY 1 ORDER BY entries DESC`, [from, to]);

  const bySlot = await rowsOf(
    `SELECT regexp_replace(s.label, '[[:space:]]+', ' ', 'g') AS label,
            count(*) FILTER (WHERE t.status = 'used') AS entered
       FROM tickets t JOIN place_slots s ON s.id = t.slot_id
      WHERE t.travel_date BETWEEN $1::date AND $2::date
      GROUP BY s.id, s.label ORDER BY entered DESC`, [from, to]);

  const spanDays = Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000) + 1);
  const vehicles = n(totals.vehicles);
  const cats = byCategory.map((c) => ({ code: c.code, label: c.label, entered: n(c.entered), booked: n(c.booked) }));
  const ranked = [...cats].sort((a, b) => b.entered - a.entered);

  return {
    from,
    to,
    days: spanDays,
    vehicles,
    visitors: n(totals.visitors),
    passes: n(totals.passes),
    value: rupees(totals.value_paise),
    byCategory: cats,
    averages: {
      perDay: Math.round((vehicles / spanDays) * 10) / 10,
      /* Across the twelve hours a gate is actually open, not across a calendar
         day: dividing by 24 would report a busy road as a quiet one. */
      perHour: Math.round((vehicles / spanDays / 12) * 10) / 10,
      perVisitor: n(totals.visitors) ? Math.round((vehicles / n(totals.visitors)) * 100) / 100 : 0,
    },
    peak: {
      busiestDay: days[0] ? { day: asDate(days[0].day), entered: n(days[0].entered) } : null,
      quietestDay: days.length ? { day: asDate(days[days.length - 1].day), entered: n(days[days.length - 1].entered) } : null,
      busiestHour: hours[0] ? { hour: n(hours[0].hour), label: hourLabel(hours[0].hour), entries: n(hours[0].entries) } : null,
      quietestHour: hours.length ? { hour: n(hours[hours.length - 1].hour), label: hourLabel(hours[hours.length - 1].hour), entries: n(hours[hours.length - 1].entries) } : null,
      busiestSlot: bySlot[0] ? { label: bySlot[0].label, entered: n(bySlot[0].entered) } : null,
      quietestSlot: bySlot.length ? { label: bySlot[bySlot.length - 1].label, entered: n(bySlot[bySlot.length - 1].entered) } : null,
      topCategory: ranked[0] || null,
      bottomCategory: ranked.length ? ranked[ranked.length - 1] : null,
    },
    hours: hours.map((h) => ({ hour: n(h.hour), label: hourLabel(h.hour), entries: n(h.entries) }))
      .sort((a, b) => a.hour - b.hour),
  };
}

/* ─────────────────────────────────────────────────────── 3.4 day-wise ── */

/** A row per day: visitors, vehicles by type, and what was collected. */
const daily = (from, to) => rowsOf(
  `SELECT d::date AS day,
          (SELECT count(DISTINCT t.customer_id) FROM tickets t
            WHERE t.travel_date = d::date AND t.status = 'used') AS visitors,
          (SELECT count(*) FROM tickets t WHERE t.travel_date = d::date AND t.status = 'used') AS vehicles,
          (SELECT count(*) FROM tickets t WHERE t.travel_date = d::date AND t.status IN ('paid','used')) AS booked,
          (SELECT count(*) FROM tickets t JOIN vehicle_categories c ON c.id = t.category_id
            WHERE t.travel_date = d::date AND t.status = 'used' AND c.code = 'BIKE') AS bikes,
          (SELECT count(*) FROM tickets t JOIN vehicle_categories c ON c.id = t.category_id
            WHERE t.travel_date = d::date AND t.status = 'used' AND c.code = 'CAR') AS cars,
          (SELECT count(*) FROM tickets t JOIN vehicle_categories c ON c.id = t.category_id
            WHERE t.travel_date = d::date AND t.status = 'used' AND c.code = 'TOOFAN') AS toofans,
          (SELECT count(*) FROM tickets t JOIN vehicle_categories c ON c.id = t.category_id
            WHERE t.travel_date = d::date AND t.status = 'used' AND c.code = 'TT') AS tts,
          (SELECT COALESCE(sum(t.total_paise),0) FROM tickets t
            WHERE t.travel_date = d::date AND t.status IN ('paid','used')) AS value_paise
     FROM generate_series($1::date, $2::date, '1 day') AS d
    ORDER BY day DESC`, [from, to]).then((rows) => rows.map((r) => ({
  day: asDate(r.day),
  visitors: n(r.visitors),
  vehicles: n(r.vehicles),
  booked: n(r.booked),
  bikes: n(r.bikes),
  cars: n(r.cars),
  toofans: n(r.toofans),
  tts: n(r.tts),
  revenue: rupees(r.value_paise),
})));

/* ────────────────────────────────────────────────────── 3.5 compare ── */

const change = (now, before) => ({
  value: now,
  previous: before,
  diff: now - before,
  percent: before === 0 ? null : Math.round(((now - before) / before) * 1000) / 10,
  direction: now === before ? 'flat' : now > before ? 'up' : 'down',
});

/** Two ranges, side by side, on the figures a department argues about. */
async function compare(aFrom, aTo, bFrom, bTo) {
  const [a, b] = await Promise.all([traffic(aFrom, aTo), traffic(bFrom, bTo)]);
  const cat = (t, code) => t.byCategory.find((c) => c.code === code)?.entered || 0;

  return {
    current: { from: aFrom, to: aTo, days: a.days },
    against: { from: bFrom, to: bTo, days: b.days },
    visitors: change(a.visitors, b.visitors),
    vehicles: change(a.vehicles, b.vehicles),
    passes: change(a.passes, b.passes),
    revenue: change(a.value, b.value),
    perDay: change(a.averages.perDay, b.averages.perDay),
    byCategory: a.byCategory.map((c) => ({ code: c.code, label: c.label, ...change(c.entered, cat(b, c.code)) })),
  };
}

/** The ready-made comparisons, so nobody has to pick four dates to see them. */
function presets(today) {
  const yesterday = shiftDay(today, -1);
  return {
    today_vs_yesterday: { a: [today, today], b: [yesterday, yesterday], label: 'Today vs yesterday' },
    week_vs_week: { a: [shiftDay(today, -6), today], b: [shiftDay(today, -13), shiftDay(today, -7)], label: 'This week vs last' },
    month_vs_month: { a: [shiftDay(today, -29), today], b: [shiftDay(today, -59), shiftDay(today, -30)], label: 'This month vs last' },
  };
}

/* ──────────────────────────────────────────────────────── 3.6 staff ── */

/** Each staff member's work across a range: volume, verdicts and speed. */
async function staff(from, to) {
  const rows = await rowsOf(
    `SELECT st.id, st.name,
            count(sc.id)                                                          AS checks,
            count(sc.id) FILTER (WHERE sc.verdict IN ('valid','valid_override'))  AS valid,
            count(sc.id) FILTER (WHERE sc.verdict = 'valid_override')             AS admitted_anyway,
            count(sc.id) FILTER (WHERE sc.verdict = 'already_used')               AS duplicate,
            count(sc.id) FILTER (WHERE sc.verdict IN ('unknown_ticket','wrong_day','wrong_place','not_paid','cancelled')) AS invalid,
            avg(sc.duration_ms) FILTER (WHERE sc.duration_ms IS NOT NULL)         AS avg_ms,
            min(sc.duration_ms)                                                    AS fastest_ms,
            max(sc.duration_ms)                                                    AS slowest_ms,
            min(sc.scanned_at)                                                     AS first_check,
            max(sc.scanned_at)                                                     AS last_check
       FROM staff st
       LEFT JOIN scans sc ON sc.staff_id = st.id
                         AND (sc.scanned_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1::date AND $2::date
      GROUP BY st.id, st.name
      ORDER BY checks DESC, st.name`, [from, to]);

  /* Each person's busiest hour, and the repeat attempts they saw. */
  const peaks = await rowsOf(
    `SELECT staff_id, hour, entries FROM (
       SELECT sc.staff_id,
              extract(hour FROM (sc.scanned_at AT TIME ZONE 'Asia/Kolkata'))::int AS hour,
              count(*) AS entries,
              row_number() OVER (PARTITION BY sc.staff_id ORDER BY count(*) DESC) AS rank
         FROM scans sc
        WHERE (sc.scanned_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1::date AND $2::date
          AND sc.staff_id IS NOT NULL
        GROUP BY sc.staff_id, 2) ranked
      WHERE rank = 1`, [from, to]);
  const peakOf = Object.fromEntries(peaks.map((p) => [String(p.staff_id), p]));

  const shifts = await rowsOf(
    `SELECT staff_id, min(started_at) AS first_in, max(COALESCE(ended_at, last_seen_at)) AS last_out,
            count(*) AS shifts
       FROM staff_sessions
      WHERE (started_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1::date AND $2::date
      GROUP BY staff_id`, [from, to]);
  const shiftOf = Object.fromEntries(shifts.map((s) => [String(s.staff_id), s]));

  return rows.map((r) => {
    const id = String(r.id);
    const peak = peakOf[id];
    const shift = shiftOf[id];
    return {
      id,
      name: r.name,
      checks: n(r.checks),
      valid: n(r.valid),
      admittedAnyway: n(r.admitted_anyway),
      duplicate: n(r.duplicate),
      invalid: n(r.invalid),
      averageMs: r.avg_ms === null ? null : Math.round(Number(r.avg_ms)),
      fastestMs: r.fastest_ms === null ? null : n(r.fastest_ms),
      slowestMs: r.slowest_ms === null ? null : n(r.slowest_ms),
      firstCheck: r.first_check,
      lastCheck: r.last_check,
      peakHour: peak ? { hour: n(peak.hour), label: hourLabel(peak.hour), entries: n(peak.entries) } : null,
      shifts: shift ? { count: n(shift.shifts), firstIn: shift.first_in, lastOut: shift.last_out } : null,
    };
  });
}

/* ───────────────────────────────────────────────────── when they come ── */

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Entries by hour and day of the week.
 *
 * WHY BOTH AT ONCE. "Busiest at eleven" and "busiest on Sunday" are each half an
 * answer; the useful one is "Sunday at eleven", which is when staff are needed
 * and when a slot sells out. A grid says that in one look.
 *
 * COUNTED PER OCCURRENCE, NOT PER RANGE. Thirty days holds four Sundays and five
 * Mondays, so a plain total makes Monday look busier. The average for each
 * weekday-hour is what a rota is planned from, and it is what the screen shows;
 * the totals come with it for anybody who wants the raw count.
 */
async function heatmap(from, to) {
  const cells = await rowsOf(
    `SELECT extract(dow FROM (s.scanned_at AT TIME ZONE 'Asia/Kolkata'))::int  AS dow,
            extract(hour FROM (s.scanned_at AT TIME ZONE 'Asia/Kolkata'))::int AS hour,
            count(*) AS entries
       FROM scans s
      WHERE s.verdict IN ('valid', 'valid_override')
        AND (s.scanned_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1::date AND $2::date
      GROUP BY 1, 2`, [from, to]);

  /* How many of each weekday the range actually holds, so an average means
     something. Counted from the calendar, not from the entries. */
  const occurrences = await rowsOf(
    `SELECT extract(dow FROM d)::int AS dow, count(*) AS days
       FROM generate_series($1::date, $2::date, interval '1 day') d
      GROUP BY 1`, [from, to]);
  const daysOf = Object.fromEntries(occurrences.map((o) => [n(o.dow), n(o.days)]));

  const grid = new Map(cells.map((c) => [`${n(c.dow)}:${n(c.hour)}`, n(c.entries)]));
  const total = cells.reduce((s, c) => s + n(c.entries), 0);
  let busiest = null;
  const rows = DOW.map((label, dow) => {
    const hours = [];
    for (let hour = 0; hour < 24; hour += 1) {
      const entries = grid.get(`${dow}:${hour}`) || 0;
      const days = daysOf[dow] || 0;
      const average = days ? Math.round((entries / days) * 10) / 10 : 0;
      hours.push({ hour, label: hourLabel(hour), entries, average });
      if (entries && (!busiest || entries > busiest.entries)) busiest = { dow, day: label, hour, label: hourLabel(hour), entries, average };
    }
    return {
      dow, day: label, days: daysOf[dow] || 0,
      entries: hours.reduce((s, h) => s + h.entries, 0),
      hours,
    };
  });

  const byHour = [];
  for (let hour = 0; hour < 24; hour += 1) {
    byHour.push({ hour, label: hourLabel(hour), entries: rows.reduce((s, r) => s + r.hours[hour].entries, 0) });
  }

  return {
    from, to, total,
    max: Math.max(0, ...cells.map((c) => n(c.entries))),
    maxAverage: Math.max(0, ...rows.flatMap((r) => r.hours.map((h) => h.average))),
    busiest,
    busiestDay: rows.reduce((best, r) => (!best || r.entries > best.entries ? r : best), null),
    rows,
    byHour,
  };
}

/**
 * Each staff member, day by day: how much they checked and how long it took.
 *
 * The staff table says what somebody did across a whole range, which hides the
 * thing worth seeing — a person getting faster, or a day where checks took twice
 * as long because the queue was in the rain. Shaped for a chart: one row per day,
 * one column per person.
 */
async function staffTrend(from, to) {
  const rows = await rowsOf(
    `SELECT st.id, st.name,
            (sc.scanned_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
            count(*)                                                             AS checks,
            count(*) FILTER (WHERE sc.verdict IN ('valid', 'valid_override'))    AS entries,
            count(*) FILTER (WHERE sc.verdict = 'valid_override')                AS admitted_anyway,
            avg(sc.duration_ms) FILTER (WHERE sc.duration_ms IS NOT NULL)        AS avg_ms
       FROM scans sc JOIN staff st ON st.id = sc.staff_id
      WHERE (sc.scanned_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1::date AND $2::date
      GROUP BY st.id, st.name, 3
      ORDER BY 3`, [from, to]);

  const people = [];
  const seen = new Set();
  for (const r of rows) {
    if (seen.has(String(r.id))) continue;
    seen.add(String(r.id));
    people.push({ id: String(r.id), name: r.name });
  }

  const byDay = new Map();
  for (const r of rows) {
    const day = asDate(r.day);
    if (!byDay.has(day)) byDay.set(day, { day, entries: { day }, seconds: { day }, checks: { day } });
    const slot = byDay.get(day);
    slot.entries[r.name] = n(r.entries);
    slot.checks[r.name] = n(r.checks);
    slot.seconds[r.name] = r.avg_ms === null ? null : Math.round(n(r.avg_ms) / 100) / 10;
  }

  const days = [...byDay.values()].sort((a, b) => String(a.day).localeCompare(String(b.day)));
  return {
    from, to,
    staff: people,
    entries: days.map((d) => d.entries),
    seconds: days.map((d) => d.seconds),
    checks: days.map((d) => d.checks),
  };
}

/* ─────────────────────────────────────────────────────────── bundle ── */

/** The analytics screen's opening state: one range, everything about it. */
async function overview({ from, to } = {}) {
  const today = slotTime.nowIST().date;
  const end = to || today;
  const start = from || shiftDay(end, -29);

  const [t, day, people, staffRows] = await Promise.all([
    traffic(start, end),
    daily(start, end),
    visitorBands(),
    staff(start, end),
  ]);

  return { from: start, to: end, today, traffic: t, daily: day, visitors: people, staff: staffRows };
}

module.exports = {
  overview, traffic, daily, compare, presets, staff, staffTrend, heatmap,
  visitors, visitorBands, visitorVisits, vehicle, classify, frequency, shiftDay,
};
