/**
 * periodReport.js — the day, the week or the month, in eleven lines.
 *
 * WHO IT IS FOR. Somebody who does not open the panel: a Deputy Commissioner, a
 * range officer, whoever has to answer for the hill at a meeting. They will read
 * it on a phone, once, and it must be complete enough to act on and short enough
 * to finish. Eleven lines is the whole design constraint.
 *
 * IT IS THE SAME ARITHMETIC AS EVERY OTHER SCREEN, deliberately. Every figure
 * here is computed by the modules the panel already uses — the traffic counts
 * from analytics, the money from finance, the gate takings from the on-spot
 * screen. A report that ran its own queries would eventually disagree with the
 * panel, and the version in somebody's WhatsApp is the one they would quote.
 *
 * DAILY, WEEKLY AND MONTHLY ARE THE SAME REPORT over different dates, so there
 * is one template, one sender and one set of sums. The period is a variable in
 * the template rather than three templates to keep approved and in step.
 *
 * WHAT IS DELIBERATELY IN IT. Not only the good numbers: vehicles that booked
 * and never arrived, and vehicles turned away at the barrier. A report that
 * carried revenue and nothing else would be a sales figure, and the questions
 * that matter at a gate are usually about the other two.
 */

const { query, one } = require('./db');
const slotTime = require('./slotTime');
const analytics = require('./adminAnalytics');
const finance = require('./adminFinance');
const onspot = require('./adminOnspot');

const n = (v) => Number(v || 0);
const rowsOf = async (text, params) => (await query(text, params)).rows;

/* Indian grouping, because these are read in India. 128400 → 1,28,400 */
const inr = (rupees) => Math.round(n(rupees)).toLocaleString('en-IN');
const money = (rupees) => `Rs ${inr(rupees)}`;

const KINDS = ['daily', 'weekly', 'monthly'];

/* "12 Sep", not the locale's "12 Sept," — en-IN adds a comma and a fourth
   letter that read oddly in a one-line report. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const parts = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
};
const ddmm = (iso) => { const p = parts(iso); return `${p.d} ${MONTHS[p.m - 1]}`; };
const longDate = (iso) => { const p = parts(iso); return `${DAYS[p.dow]}, ${p.d} ${MONTHS[p.m - 1]} ${p.y}`; };

/**
 * The dates a report covers, and how a person would name that stretch of time.
 *
 * A daily report is about yesterday when sent in the morning and about today
 * when sent in the evening, so the caller says which date it is anchored to and
 * this does the arithmetic rather than each caller inventing it.
 */
function periodFor(kind, anchor = null) {
  const today = anchor || slotTime.nowIST().date;
  const at = new Date(`${today}T06:00:00+05:30`);

  if (kind === 'weekly') {
    /* Monday to Sunday: the week as the office keeps it, not as JavaScript
       numbers it. */
    const dow = (at.getDay() + 6) % 7;
    const from = new Date(at.getTime() - dow * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const to = new Date(at.getTime() + (6 - dow) * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    return { kind, from, to, label: `${ddmm(from)} – ${ddmm(to)} ${to.slice(0, 4)}` };
  }

  if (kind === 'monthly') {
    const [y, m] = today.split('-').map(Number);
    const from = `${y}-${String(m).padStart(2, '0')}-01`;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const to = `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
    return {
      kind,
      from,
      to,
      label: `${['January', 'February', 'March', 'April', 'May', 'June', 'July',
        'August', 'September', 'October', 'November', 'December'][m - 1]} ${y}`,
    };
  }

  return {
    kind: 'daily',
    from: today,
    to: today,
    label: longDate(today),
  };
}

/**
 * Booked and never arrived, and turned away at the barrier.
 *
 * The first is capacity somebody else wanted and could not have. The second is
 * the count that generates every complaint a DC ever hears, so it is in the
 * report whether or not it flatters anybody.
 */
async function shortfall({ from, to, placeId }) {
  const [missed] = await rowsOf(
    `SELECT count(*) FILTER (WHERE status = 'paid')      AS never_came,
            count(*) FILTER (WHERE status IN ('paid','used')) AS sold
       FROM tickets
      WHERE travel_date BETWEEN $1::date AND $2::date
        AND NOT is_test
        AND ($3::bigint IS NULL OR place_id = $3::bigint)`, [from, to, placeId || null]);

  const [refused] = await rowsOf(
    `SELECT count(*) AS refused
       FROM scans sc
      WHERE (sc.scanned_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1::date AND $2::date
        AND sc.verdict NOT IN ('valid', 'valid_override')
        AND NOT sc.is_test`, [from, to]);

  return { neverCame: n(missed.never_came), sold: n(missed.sold), refused: n(refused.refused) };
}

/** How full the slots were, as the fraction of places that were taken. */
async function occupancy({ from, to, placeId }) {
  const rows = await rowsOf(
    `SELECT regexp_replace(s.label, '[[:space:]]+', ' ', 'g') AS slot,
            COALESCE(sum(si.capacity), 0) AS capacity,
            COALESCE(sum(si.booked), 0)   AS booked
       FROM slot_inventory si
       JOIN place_slots s ON s.id = si.slot_id
      WHERE si.travel_date BETWEEN $1::date AND $2::date
        AND ($3::bigint IS NULL OR si.place_id = $3::bigint)
      GROUP BY s.label, s.starts_at ORDER BY s.starts_at`, [from, to, placeId || null]);

  return rows.map((r) => ({
    slot: String(r.slot).split(' ')[0],
    capacity: n(r.capacity),
    booked: n(r.booked),
    percent: n(r.capacity) ? Math.round((n(r.booked) / n(r.capacity)) * 100) : 0,
  }));
}

/**
 * Everything the template needs, and the same figures the panel shows.
 */
async function build({ kind = 'daily', anchor = null, placeId = null } = {}) {
  const period = periodFor(KINDS.includes(kind) ? kind : 'daily', anchor);

  const place = placeId
    ? await one(`SELECT id, name FROM places WHERE id = $1`, [placeId])
    : await one(`SELECT id, name FROM places WHERE is_active ORDER BY id LIMIT 1`);

  const [traffic, revenue, gate, miss, slots] = await Promise.all([
    analytics.traffic(period.from, period.to),
    finance.summary({ from: period.from, to: period.to }),
    onspot.summary({ from: period.from, to: period.to }),
    shortfall({ from: period.from, to: period.to, placeId: place ? place.id : null }),
    occupancy({ from: period.from, to: period.to, placeId: place ? place.id : null }),
  ]);

  /* The short names everyone at the gate actually uses, rather than the first
     word of the official label — which turns "Tempo Traveller" into "tempo". */
  const SHORT = { BIKE: 'bike', CAR: 'car', TOOFAN: 'toofan', TT: 'TT' };
  const split = (traffic.byCategory || [])
    .filter((c) => c.entered > 0)
    .map((c) => `${SHORT[c.code] || c.label} ${inr(c.entered)}`)
    .join(', ');

  const peak = traffic.peak && traffic.peak.busiestHour ? traffic.peak.busiestHour : null;

  return {
    period,
    place: place ? place.name : 'Pravesha',
    figures: {
      entered: n(traffic.vehicles),
      split,
      sold: miss.sold,
      neverCame: miss.neverCame,
      neverCamePercent: miss.sold ? Math.round((miss.neverCame / miss.sold) * 100) : 0,
      refused: miss.refused,
      department: revenue.revenue.departmentAmount,
      gateTakings: gate.totals.collected,
      gateSales: gate.totals.sales,
      peakHour: peak ? peak.label : null,
      peakEntries: peak ? n(peak.entries) : 0,
      occupancy: slots,
    },
  };
}

/**
 * The values the approved template expects, split the way WhatsApp splits them.
 *
 * A template has three parts and they are numbered independently: the header has
 * its own {{1}}, the body starts again at {{1}}, and the footer may not have
 * variables at all. Returning them in one flat list is how a report ends up with
 * the month in the vehicle count.
 *
 *   header  {{1}}  daily | weekly | monthly
 *   body    {{1}}  the period in words        {{6}}  turned away
 *           {{2}}  the place                  {{7}}  department collection
 *           {{3}}  vehicles entered           {{8}}  taken at the gate
 *           {{4}}  passes sold                {{9}}  busiest hour
 *           {{5}}  booked, never arrived      {{10}} slot occupancy
 *
 * Built here rather than at the send site so the template and the numbers are
 * described in one place: if it is ever re-registered in a different order,
 * exactly one function changes.
 */
function variables(report) {
  const f = report.figures;
  return {
    header: [report.period.kind],
    body: [
      report.period.label,                                                     //  1
      report.place,                                                            //  2
      f.split ? `${inr(f.entered)} (${f.split})` : inr(f.entered),             //  3
      inr(f.sold),                                                             //  4
      `${inr(f.neverCame)} (${f.neverCamePercent}%)`,                          //  5
      inr(f.refused),                                                          //  6
      money(f.department),                                                     //  7
      f.gateSales                                                              //  8
        ? `${money(f.gateTakings)} (${inr(f.gateSales)} sale${f.gateSales === 1 ? '' : 's'})`
        : money(0),
      f.peakHour ? `${f.peakHour} — ${inr(f.peakEntries)} vehicles` : 'no entries', // 9
      f.occupancy.length                                                       // 10
        ? f.occupancy.map((s) => `${s.slot} ${s.percent}%`).join(', ')
        : 'no slots configured',
    ],
  };
}

/**
 * The same report as plain text — for the preview in the panel, for a copy
 * somebody pastes into an email, and for the day WhatsApp is down and this has
 * to go by some other road.
 */
function asText(report) {
  const v = variables(report);
  return [
    `*Pravesha ${v.header[0]} report*`,
    '',
    `For ${v.body[0]} at ${v.body[1]}.`,
    '',
    `Vehicles entered: ${v.body[2]}`,
    `Passes sold: ${v.body[3]}`,
    `Booked but did not arrive: ${v.body[4]}`,
    `Turned away at the barrier: ${v.body[5]}`,
    '',
    `Department collection: ${v.body[6]}`,
    `Collected at the gate: ${v.body[7]}`,
    '',
    `Busiest hour: ${v.body[8]}`,
    `Slot occupancy: ${v.body[9]}`,
    '',
    'Figures from the Pravesha entry system.',
  ].join('\n');
}

module.exports = { KINDS, periodFor, build, variables, asText };
