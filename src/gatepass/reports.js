/**
 * reports.js — the operational and financial report for a period.
 *
 * ONE DATASET, THREE RENDERINGS. The screen, the PDF and the CSV are all drawn
 * from what build() returns, so a figure on the printed page cannot differ from
 * the same figure on the screen or in the spreadsheet somebody makes from it.
 *
 * TWO DATES, AND THE REPORT SAYS WHICH IT USES WHERE:
 *
 *   travel date   Operations — bookings, entries, no-shows, vehicles, slots.
 *                 A pass belongs to the day the vehicle drives up.
 *   payment date  Money — what was collected, and how it divides. This is the
 *                 figure that reconciles with the bank statement, and a pass
 *                 bought on Monday for Saturday is Monday's money.
 *
 * Mixing the two is how a revenue figure ends up matching neither the gate nor
 * the bank, so every financial table is labelled with its basis.
 *
 * NOT REPORTED: cancellations and a cancellation rate. A visitor cannot cancel
 * a pass anywhere in the product, so the figure could only ever be zero, and a
 * zero in a printed report reads as a fact about the period.
 */

const crypto = require('crypto');
const { query, one } = require('./db');
const slotTime = require('./slotTime');
const settings = require('./settings');
const analytics = require('./adminAnalytics');

const rowsOf = async (text, params) => (await query(text, params)).rows;
const n = (v) => Number(v || 0);
const rupees = (paise) => Math.round(n(paise) / 100);
const asDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const pct = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

const shiftDay = analytics.shiftDay;
const daysBetween = (from, to) => Math.round((Date.UTC(...to.split('-').map((x, i) => (i === 1 ? x - 1 : +x)))
  - Date.UTC(...from.split('-').map((x, i) => (i === 1 ? x - 1 : +x)))) / 86400000) + 1;

const CATS = ['BIKE', 'CAR', 'TOOFAN', 'TT'];

/**
 * The period a kind of report covers, around a chosen date, never past today.
 *
 * Weekly is the calendar week, Monday to Sunday; monthly is the calendar month.
 * A report for the current week or month runs to today and says so, rather than
 * padding the future with zeros that look like a collapse.
 */
function periodFor(kind, { date, from, to } = {}) {
  const today = slotTime.nowIST().date;
  const clamp = (d) => (d > today ? today : d);
  const anchor = clamp(/^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : today);

  if (kind === 'daily') return { kind, from: anchor, to: anchor, today };

  if (kind === 'weekly') {
    const [y, m, d] = anchor.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();         // 0 = Sunday
    const monday = shiftDay(anchor, -((dow + 6) % 7));
    return { kind, from: monday, to: clamp(shiftDay(monday, 6)), fullTo: shiftDay(monday, 6), today };
  }

  if (kind === 'monthly') {
    const [y, m] = anchor.split('-').map(Number);
    const first = `${y}-${String(m).padStart(2, '0')}-01`;
    const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    return { kind, from: first, to: clamp(last), fullTo: last, today };
  }

  /* Custom: as given, ordered, clamped, and at most a year. */
  let f = /^\d{4}-\d{2}-\d{2}$/.test(String(from || '')) ? from : shiftDay(today, -6);
  let t = clamp(/^\d{4}-\d{2}-\d{2}$/.test(String(to || '')) ? to : today);
  if (f > t) [f, t] = [t, f];
  if (daysBetween(f, t) > 366) f = shiftDay(t, -365);
  return { kind: 'custom', from: f, to: t, today };
}

/** Everything the report needs for one period. */
async function build(period) {
  const { from, to, today } = period;
  const days = daysBetween(from, to);
  const now = slotTime.nowIST();
  const nowTime = `${slotTime.hhmm(now.minutes)}:00`;
  const buffer = slotTime.LAST_ENTRY_BUFFER_MIN;

  const [dayRows, gateRows, moneyRows, slotRows, catRevenue, traffic, staff, visitorsNow, visitorsBefore,
    refundRows, feePercent, gstPercent] = await Promise.all([

    /* Operations, per travel date, by vehicle type. */
    rowsOf(
      `SELECT d::date AS day,
              count(t.id) FILTER (WHERE t.status IN ('paid','used'))                     AS bookings,
              count(t.id) FILTER (WHERE t.status = 'used')                               AS entries,
              count(t.id) FILTER (WHERE t.status = 'paid' AND (d::date > $3::date
                   OR (d::date = $3::date AND (s.ends_at - make_interval(mins => $5::int)) > $4::time))) AS yet_to_arrive,
              count(t.id) FILTER (WHERE t.status = 'paid' AND (d::date < $3::date
                   OR (d::date = $3::date AND (s.ends_at - make_interval(mins => $5::int)) <= $4::time))) AS skipped,
              count(t.id) FILTER (WHERE t.status = 'expired')                            AS abandoned,
              count(DISTINCT t.customer_id) FILTER (WHERE t.status = 'used')             AS visitors,
              ${CATS.map((c) => `count(t.id) FILTER (WHERE t.status = 'used' AND c.code = '${c}') AS e_${c.toLowerCase()},
              count(t.id) FILTER (WHERE t.status IN ('paid','used') AND c.code = '${c}') AS b_${c.toLowerCase()}`).join(',\n              ')},
              COALESCE(sum(t.total_paise)    FILTER (WHERE t.status IN ('paid','used')), 0) AS value_paise,
              COALESCE(sum(t.entry_paise)    FILTER (WHERE t.status IN ('paid','used')), 0) AS entry_paise,
              COALESCE(sum(t.platform_paise) FILTER (WHERE t.status IN ('paid','used')), 0) AS platform_paise
         FROM generate_series($1::date, $2::date, '1 day') AS d
         LEFT JOIN tickets t ON t.travel_date = d::date
         LEFT JOIN place_slots s ON s.id = t.slot_id
         LEFT JOIN vehicle_categories c ON c.id = t.category_id
        GROUP BY d ORDER BY d`, [from, to, today, nowTime, buffer]),

    /* The gate, per day it happened. */
    rowsOf(
      `SELECT (scanned_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
              count(*)                                                            AS lookups,
              count(*) FILTER (WHERE verdict IN ('valid','valid_override'))       AS valid,
              count(*) FILTER (WHERE verdict = 'valid_override')                  AS admitted_anyway,
              count(*) FILTER (WHERE verdict = 'already_used')                    AS duplicate,
              count(*) FILTER (WHERE verdict IN ('unknown_ticket','wrong_day','wrong_place','not_paid','cancelled')) AS invalid,
              count(*) FILTER (WHERE verdict = 'wrong_slot')                      AS outside_slot,
              avg(duration_ms)                                                    AS avg_ms
         FROM scans
        WHERE (scanned_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1::date AND $2::date
        GROUP BY 1 ORDER BY 1`, [from, to]),

    /* Money, per payment date. */
    rowsOf(
      `SELECT (paid_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
              count(*) AS payments,
              COALESCE(sum(amount_paise), 0)   AS collected_paise,
              COALESCE(sum(entry_paise), 0)    AS entry_paise,
              COALESCE(sum(platform_paise), 0) AS platform_paise,
              COALESCE(sum(gst_paise), 0)      AS gst_paise,
              COALESCE(sum(COALESCE((raw->'gateway'->>'fee')::bigint, 0)), 0) AS gateway_paise,
              count(*) FILTER (WHERE (raw->'gateway'->>'fee') IS NOT NULL)    AS with_fee
         FROM payments
        WHERE status = 'paid' AND (paid_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1::date AND $2::date
        GROUP BY 1 ORDER BY 1`, [from, to]),

    /* Slots across the period: places offered, booked and used. */
    rowsOf(
      `SELECT s.id, regexp_replace(s.label, '[[:space:]]+', ' ', 'g') AS label, s.starts_at, p.name AS place,
              (SELECT COALESCE(sum(capacity), 0) FROM slot_capacity sc WHERE sc.slot_id = s.id) AS daily_capacity,
              (SELECT count(*) FROM tickets t WHERE t.slot_id = s.id AND t.status IN ('paid','used')
                  AND t.travel_date BETWEEN $1::date AND $2::date) AS booked,
              (SELECT count(*) FROM tickets t WHERE t.slot_id = s.id AND t.status = 'used'
                  AND t.travel_date BETWEEN $1::date AND $2::date) AS entered
         FROM place_slots s JOIN places p ON p.id = s.place_id
        WHERE s.is_active AND p.is_active
        ORDER BY p.id, s.starts_at`, [from, to]),

    /* Revenue by vehicle type, per travel date. */
    rowsOf(
      `SELECT c.code, c.label,
              count(t.id) FILTER (WHERE t.status IN ('paid','used'))                       AS passes,
              count(t.id) FILTER (WHERE t.status = 'used')                                 AS entries,
              COALESCE(sum(t.total_paise)    FILTER (WHERE t.status IN ('paid','used')), 0) AS value_paise,
              COALESCE(sum(t.entry_paise)    FILTER (WHERE t.status IN ('paid','used')), 0) AS entry_paise,
              COALESCE(sum(t.platform_paise) FILTER (WHERE t.status IN ('paid','used')), 0) AS platform_paise
         FROM vehicle_categories c
         LEFT JOIN tickets t ON t.category_id = c.id AND t.travel_date BETWEEN $1::date AND $2::date
        WHERE c.is_active
        GROUP BY c.id, c.code, c.label, c.sort_order ORDER BY c.sort_order`, [from, to]),

    analytics.traffic(from, to),
    analytics.staff(from, to),

    /* Visitors this period: how many, how many new, how many had been before. */
    one(
      `WITH here AS (
         SELECT customer_id, count(*) AS entries FROM tickets
          WHERE status = 'used' AND travel_date BETWEEN $1::date AND $2::date GROUP BY customer_id),
       earlier AS (
         SELECT DISTINCT customer_id FROM tickets WHERE status = 'used' AND travel_date < $1::date)
       SELECT count(*)                                                     AS visitors,
              count(*) FILTER (WHERE h.customer_id NOT IN (SELECT customer_id FROM earlier)) AS new_visitors,
              count(*) FILTER (WHERE h.customer_id IN (SELECT customer_id FROM earlier))     AS returning_visitors,
              count(*) FILTER (WHERE h.entries > 1)                        AS repeat_within_period
         FROM here h`, [from, to]),

    /* The same length of time immediately before, for growth. */
    one(
      `SELECT count(DISTINCT customer_id) AS visitors FROM tickets
        WHERE status = 'used' AND travel_date BETWEEN $1::date AND $2::date`,
      [shiftDay(from, -days), shiftDay(from, -1)]),

    rowsOf(
      `SELECT (refunded_at AT TIME ZONE 'Asia/Kolkata')::date AS day, count(*) AS refunds,
              COALESCE(sum(amount_paise), 0) AS refunded_paise
         FROM payments
        WHERE refunded_at IS NOT NULL AND (refunded_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1::date AND $2::date
        GROUP BY 1`, [from, to]),

    settings.num('platform_fee_percent', 13),
    settings.num('gst_percent_on_platform', 18),
  ]);

  const gateOf = Object.fromEntries(gateRows.map((g) => [asDate(g.day), g]));
  const moneyOf = Object.fromEntries(moneyRows.map((m) => [asDate(m.day), m]));
  const refundOf = Object.fromEntries(refundRows.map((r) => [asDate(r.day), r]));

  /* A row per day, joining operations, the gate and money on the calendar. */
  const daily = dayRows.map((r) => {
    const day = asDate(r.day);
    const g = gateOf[day] || {};
    const m = moneyOf[day] || {};
    const rf = refundOf[day] || {};
    return {
      day,
      bookings: n(r.bookings),
      entries: n(r.entries),
      yetToArrive: n(r.yet_to_arrive),
      skipped: n(r.skipped),
      abandoned: n(r.abandoned),
      visitors: n(r.visitors),
      bikes: n(r.e_bike), cars: n(r.e_car), toofans: n(r.e_toofan), tts: n(r.e_tt),
      bookedByType: { BIKE: n(r.b_bike), CAR: n(r.b_car), TOOFAN: n(r.b_toofan), TT: n(r.b_tt) },
      passValue: rupees(r.value_paise),
      lookups: n(g.lookups), valid: n(g.valid), duplicate: n(g.duplicate), invalid: n(g.invalid),
      admittedAnyway: n(g.admitted_anyway), outsideSlot: n(g.outside_slot),
      collected: rupees(m.collected_paise),
      department: rupees(m.entry_paise),
      serviceFee: rupees(m.platform_paise),
      gst: rupees(m.gst_paise),
      gateway: rupees(m.gateway_paise),
      refunds: rupees(rf.refunded_paise),
    };
  });

  const sum = (key) => daily.reduce((s, d) => s + n(d[key]), 0);

  /* Totals. */
  const totals = {
    bookings: sum('bookings'), entries: sum('entries'), yetToArrive: sum('yetToArrive'),
    skipped: sum('skipped'), abandoned: sum('abandoned'),
    lookups: sum('lookups'), valid: sum('valid'), duplicate: sum('duplicate'), invalid: sum('invalid'),
    admittedAnyway: sum('admittedAnyway'), outsideSlot: sum('outsideSlot'),
  };

  /* Money: payment-date basis. Net is the service fee after GST and the gateway's
     charges; refunds leave the total collected and are reported beside it. */
  const gatewayKnown = moneyRows.some((m) => n(m.with_fee) > 0);
  const finance = {
    basis: 'payment date',
    payments: moneyRows.reduce((s, m) => s + n(m.payments), 0),
    collected: sum('collected'),
    department: sum('department'),
    serviceFee: sum('serviceFee'),
    gst: sum('gst'),
    gateway: gatewayKnown ? sum('gateway') : null,
    refunds: sum('refunds'),
    refundCount: refundRows.reduce((s, r) => s + n(r.refunds), 0),
    serviceFeePercent: feePercent,
    gstPercent,
  };
  finance.netPravesha = finance.serviceFee - finance.gst - (finance.gateway || 0);
  finance.netCollected = finance.collected - finance.refunds;

  const vehicles = catRevenue.map((c) => ({
    code: c.code,
    label: c.label,
    passes: n(c.passes),
    entries: n(c.entries),
    shareOfEntries: pct(n(c.entries), totals.entries),
    passValue: rupees(c.value_paise),
    department: rupees(c.entry_paise),
    serviceFee: rupees(c.platform_paise),
  }));

  const slots = slotRows.map((s) => {
    const capacity = n(s.daily_capacity) * days;
    return {
      label: s.label,
      place: s.place,
      capacity,
      booked: n(s.booked),
      entered: n(s.entered),
      occupancy: pct(n(s.booked), capacity),
      showUp: pct(n(s.entered), n(s.booked)),
    };
  });
  const capacityTotal = slots.reduce((s, x) => s + x.capacity, 0);

  /* Weeks, for the monthly report: Monday-starting, labelled by their Monday. */
  const weekMap = new Map();
  for (const d of daily) {
    const [y, m, dd] = d.day.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, dd)).getUTCDay();
    const monday = shiftDay(d.day, -((dow + 6) % 7));
    if (!weekMap.has(monday)) weekMap.set(monday, { week: monday, days: 0, bookings: 0, entries: 0, collected: 0, serviceFee: 0, department: 0 });
    const w = weekMap.get(monday);
    w.days += 1; w.bookings += d.bookings; w.entries += d.entries;
    w.collected += d.collected; w.serviceFee += d.serviceFee; w.department += d.department;
  }

  const visitors = {
    total: n(visitorsNow?.visitors),
    new: n(visitorsNow?.new_visitors),
    returning: n(visitorsNow?.returning_visitors),
    repeatWithinPeriod: n(visitorsNow?.repeat_within_period),
    previousPeriod: n(visitorsBefore?.visitors),
  };
  visitors.growth = visitors.previousPeriod ? pct(visitors.total - visitors.previousPeriod, visitors.previousPeriod) : null;
  visitors.returningShare = pct(visitors.returning, visitors.total);

  const ranked = [...daily].filter((d) => d.day <= today).sort((a, b) => b.entries - a.entries);

  const report = {
    period: { kind: period.kind, from, to, days, fullTo: period.fullTo || to, today, partial: Boolean(period.fullTo && period.fullTo > to) },
    summary: {
      ...totals,
      visitors: visitors.total,
      occupancy: pct(totals.bookings, capacityTotal),
      showUpRate: pct(totals.entries, totals.bookings),
      noShowRate: pct(totals.skipped, totals.bookings),
      invalidRate: pct(totals.invalid, totals.lookups),
      duplicateRate: pct(totals.duplicate, totals.lookups),
      averagePerDay: Math.round((totals.entries / days) * 10) / 10,
      /* Places offered on one day, so a day's occupancy can be drawn. */
      dailyCapacity: days ? Math.round(capacityTotal / days) : 0,
    },
    peaks: {
      highestDay: ranked[0] ? { day: ranked[0].day, entries: ranked[0].entries } : null,
      lowestDay: ranked.length ? { day: ranked[ranked.length - 1].day, entries: ranked[ranked.length - 1].entries } : null,
      peakHour: traffic.peak.busiestHour,
      quietestHour: traffic.peak.quietestHour,
      busiestSlot: traffic.peak.busiestSlot,
    },
    hours: traffic.hours,
    daily,
    weekly: [...weekMap.values()],
    vehicles,
    slots,
    staff: staff.filter((s) => s.checks > 0),
    visitors,
    finance,
  };

  report.fingerprint = crypto.createHash('sha256').update(JSON.stringify({ ...report, period: { ...report.period, today: undefined } })).digest('hex');
  return report;
}

/** Register a generated report and hand back its number. */
async function register({ report, format, adminId, bytes }) {
  const row = await one(
    `INSERT INTO admin_reports (report_no, kind, period_from, period_to, format, generated_by, figures_sha256, bytes)
     VALUES ('pending-' || gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)
     RETURNING id, generated_at`,
    [report.period.kind, report.period.from, report.period.to, format, adminId || null, report.fingerprint, bytes || null]);
  const year = new Date(row.generated_at).getFullYear();
  const reportNo = `PRV-RPT-${year}-${String(row.id).padStart(6, '0')}`;
  await query(`UPDATE admin_reports SET report_no = $2 WHERE id = $1`, [row.id, reportNo]);
  return { reportNo, generatedAt: row.generated_at };
}

const finishRegistration = (reportNo, bytes) =>
  query(`UPDATE admin_reports SET bytes = $2 WHERE report_no = $1`, [reportNo, bytes]);

/* ────────────────────────────────────────────────────────────────── CSV ── */

/**
 * The report as a spreadsheet: one section per table, a blank line between.
 *
 * UTF-8 with a byte-order mark and CRLF endings, which is what Excel needs to
 * open the rupee sign and Kannada names correctly on a double-click; every cell
 * is quoted, so a place name with a comma cannot shift a column.
 */
function csv(report, { reportNo, generatedAt }) {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const line = (arr) => arr.map(cell).join(',');
  const out = [];
  const section = (title, head, rows) => {
    out.push(line([title]));
    out.push(line(head));
    rows.forEach((r) => out.push(line(r)));
    out.push('');
  };

  out.push(line(['Pravesha report', reportNo]));
  out.push(line(['Period', `${report.period.from} to ${report.period.to}`, `${report.period.days} day(s)`, report.period.kind]));
  out.push(line(['Generated', new Date(generatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })]));
  out.push(line(['Operations are by travel date; money is by payment date.']));
  out.push('');

  const s = report.summary;
  section('Summary', ['Measure', 'Value'], [
    ['Bookings', s.bookings], ['Entries', s.entries], ['Yet to arrive', s.yetToArrive], ['Skipped (no-show)', s.skipped],
    ['Abandoned at payment', s.abandoned], ['Visitors', s.visitors], ['Gate look-ups', s.lookups],
    ['Duplicate presentations', s.duplicate], ['Invalid passes', s.invalid], ['Admitted outside slot', s.admittedAnyway],
    ['Occupancy %', s.occupancy], ['Show-up rate %', s.showUpRate], ['Invalid attempt rate %', s.invalidRate],
  ]);

  section('Day by day', ['Date', 'Bookings', 'Entries', 'Bikes', 'Cars', 'Toofan', 'TT', 'Skipped', 'Invalid', 'Duplicate',
    'Collected (₹)', 'Department (₹)', 'Service fee (₹)', 'GST (₹)'],
  report.daily.map((d) => [d.day, d.bookings, d.entries, d.bikes, d.cars, d.toofans, d.tts, d.skipped, d.invalid, d.duplicate,
    d.collected, d.department, d.serviceFee, d.gst]));

  section('Vehicles', ['Type', 'Passes', 'Entries', 'Share of entries %', 'Pass value (₹)', 'Department (₹)', 'Service fee (₹)'],
    report.vehicles.map((v) => [v.label, v.passes, v.entries, v.shareOfEntries, v.passValue, v.department, v.serviceFee]));

  section('Slots', ['Slot', 'Place', 'Capacity', 'Booked', 'Entered', 'Occupancy %', 'Show-up %'],
    report.slots.map((x) => [x.label, x.place, x.capacity, x.booked, x.entered, x.occupancy, x.showUp]));

  section('Staff', ['Staff', 'Checks', 'Valid', 'Invalid', 'Duplicate', 'Admitted outside slot', 'Average check (sec)', 'Peak hour'],
    report.staff.map((x) => [x.name, x.checks, x.valid, x.invalid, x.duplicate, x.admittedAnyway,
      x.averageMs === null ? '' : (x.averageMs / 1000).toFixed(1), x.peakHour ? x.peakHour.label : '']));

  const f = report.finance;
  section('Financial split (by payment date)', ['Line', '₹'], [
    ['Total collected', f.collected], ['Tourism Department (entry fees)', f.department],
    [`Pravesha service fee (${f.serviceFeePercent}%)`, f.serviceFee], [`GST within service fee (${f.gstPercent}%)`, f.gst],
    ['Payment gateway charges', f.gateway ?? 'not reported'], ['Refunds', f.refunds],
    ['Net Pravesha revenue', f.netPravesha],
  ]);

  out.push(line(['Fingerprint (SHA-256 of the figures)', report.fingerprint]));
  return `﻿${out.join('\r\n')}`;
}

module.exports = { periodFor, build, register, finishRegistration, csv, daysBetween };
