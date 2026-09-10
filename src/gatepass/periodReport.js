/**
 * periodReport.js — the daily, weekly and monthly report, in full.
 *
 * "Pin to pin" is the requirement: an officer downloading Sunday's report
 * should be able to answer any question about Sunday from that one file,
 * without asking us for anything. So it carries the summary AND the underlying
 * rows — every ticket, every scan, every refusal, every refund — rather than
 * the totals alone.
 *
 * The three periods are the same report over different windows. Nothing about a
 * month's report differs from a day's except the dates it spans, so there is
 * one implementation and three ways of choosing `from` and `to`.
 *
 * Two output shapes, because two different people ask:
 *
 *   PDF  for the file that goes into a meeting or a folder. Bilingual heading,
 *        the department's logo, and totals that can be read across a table.
 *   CSV  for the officer who will re-total it in Excel by Tuesday. Multi-section
 *        so one file still holds everything.
 */

const { query, one } = require('./db');
const settings = require('./settings');
const reports = require('./reports');

/* ─────────────────────────────────────────────────────────── the window */

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Turn a period and an anchor date into a window.
 *
 * A week runs Monday to Sunday, which is how a district office reads one — not
 * a rolling seven days. A month is a calendar month for the same reason.
 */
function windowFor(period, anchor) {
  const d = anchor ? new Date(`${anchor}T00:00:00`) : new Date();

  if (period === 'weekly') {
    const day = (d.getDay() + 6) % 7;          // Monday = 0
    const from = new Date(d); from.setDate(d.getDate() - day);
    const to = new Date(from); to.setDate(from.getDate() + 6);
    return { from: iso(from), to: iso(to), label: `Week of ${iso(from)}` };
  }

  if (period === 'monthly') {
    const from = new Date(d.getFullYear(), d.getMonth(), 1);
    const to = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return { from: iso(from), to: iso(to),
      label: from.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) };
  }

  return { from: iso(d), to: iso(d), label: iso(d) };
}

/* ─────────────────────────────────────────────────────────── gathering */

/**
 * Everything about a period, in one object.
 *
 * Deliberately one round of queries rather than a lazy structure: a report is
 * generated once and read many times, and a half-loaded report is worse than a
 * slow one.
 */
async function gather(placeId, period, anchor) {
  const w = windowFor(period, anchor);
  const cfg = await settings.all();
  const { from, to } = w;

  const [place, revenue, categories, slots, staff, tickets, scans,
         closures, refunds, occupancy, api, messages] = await Promise.all([
    one('SELECT * FROM places WHERE id = $1', [placeId]),
    reports.revenue(placeId, { from, to }),
    reports.categoryMix(placeId, { from, to }),
    reports.slotMix(placeId, { from, to }),
    reports.staffActivity(placeId, { from, to }),

    // Every ticket in the window, with the columns a reconciliation needs.
    query(
      `SELECT t.ticket_no, t.reference_id, t.reg_no, t.mobile, t.travel_date,
              t.status, t.entry_paise, t.platform_paise, t.gst_paise, t.total_paise,
              t.created_at, t.used_at, t.move_count, t.moved_from_date,
              s.label AS slot_label, s.code AS slot_code,
              vc.label AS category_label, vc.code AS category_code,
              v.maker, v.model,
              p.payment_id AS gateway_payment_id, p.refund_id
         FROM tickets t
         JOIN place_slots s ON s.id = t.slot_id
         JOIN vehicle_categories vc ON vc.id = t.category_id
         JOIN vehicles v ON v.id = t.vehicle_id
         LEFT JOIN payments p ON p.id = t.payment_id
        WHERE t.place_id = $1 AND t.travel_date BETWEEN $2 AND $3
          AND t.status <> 'expired'
        ORDER BY t.travel_date, s.sort_order, t.created_at`, [placeId, from, to]),

    // Every scan, including the refusals — the part that justifies the system.
    query(
      `SELECT sc.scanned_at, sc.synced_at, sc.was_offline, sc.verdict,
              sc.ticket_no, sc.reg_no,
              st.name AS staff_name, c.name AS checkpost_name, d.label AS device_label
         FROM scans sc
         LEFT JOIN checkposts c ON c.id = sc.checkpost_id
         LEFT JOIN staff st ON st.id = sc.staff_id
         LEFT JOIN devices d ON d.id = sc.device_id
        WHERE (c.place_id = $1 OR c.place_id IS NULL)
          AND sc.scanned_at::date BETWEEN $2 AND $3
        ORDER BY sc.scanned_at`, [placeId, from, to]),

    query(
      `SELECT cl.*, s.label AS slot_label, a.name AS created_by_name
         FROM closures cl
         LEFT JOIN place_slots s ON s.id = cl.slot_id
         LEFT JOIN admin_users a ON a.id = cl.created_by
        WHERE cl.place_id = $1 AND cl.travel_date BETWEEN $2 AND $3
        ORDER BY cl.travel_date`, [placeId, from, to]),

    query(
      `SELECT t.ticket_no, t.reg_no, t.travel_date, t.total_paise,
              p.refund_id, p.refunded_at
         FROM tickets t
         JOIN payments p ON p.id = t.payment_id
        WHERE t.place_id = $1 AND t.travel_date BETWEEN $2 AND $3
          AND t.status = 'cancelled'
        ORDER BY p.refunded_at`, [placeId, from, to]),

    query(
      `SELECT i.travel_date, s.code AS slot_code, s.label AS slot_label,
              vc.code AS category_code, vc.label AS category_label,
              i.capacity, i.booked, i.held, i.is_open
         FROM slot_inventory i
         JOIN place_slots s ON s.id = i.slot_id
         JOIN vehicle_categories vc ON vc.id = i.category_id
        WHERE i.place_id = $1 AND i.travel_date BETWEEN $2 AND $3
        ORDER BY i.travel_date, s.sort_order, vc.sort_order`, [placeId, from, to]),

    reports.apiCosts(placeId, { from, to }),

    query(
      `SELECT e.kind, e.detail, e.created_at, c.mobile
         FROM event_log e
         LEFT JOIN customers c ON c.id = e.customer_id
        WHERE e.kind IN ('support_request', 'feedback')
          AND e.created_at::date BETWEEN $1 AND $2
        ORDER BY e.created_at`, [from, to]),
  ]);

  /* The verdict tally, computed from the rows we already have rather than by
     asking the database a second time. */
  const verdicts = {};
  for (const s of scans.rows) verdicts[s.verdict] = (verdicts[s.verdict] || 0) + 1;
  const scanned = scans.rows.length;
  const allowed = verdicts.valid || 0;

  /* Occupancy as a single percentage per day is the number an officer quotes. */
  const occByDate = {};
  for (const o of occupancy.rows) {
    const k = String(o.travel_date).slice(0, 10);
    occByDate[k] = occByDate[k] || { capacity: 0, booked: 0 };
    occByDate[k].capacity += o.capacity;
    occByDate[k].booked += o.booked;
  }

  return {
    period, ...w, place, cfg,
    revenue, categories, slots,
    staff,
    tickets: tickets.rows,
    scans: scans.rows,
    closures: closures.rows,
    refunds: refunds.rows,
    occupancy: occupancy.rows,
    occupancyByDate: occByDate,
    messages: messages.rows,
    api,
    gate: {
      scanned, allowed,
      refused: scanned - allowed,
      ...verdicts,
      // The headline: attempts that a paper ticket would have let through.
      fraudulent: (verdicts.invalid_signature || 0) + (verdicts.already_used || 0),
    },
  };
}

/* ───────────────────────────────────────────────────────────────── CSV */

const cell = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const section = (title, cols, rows) => {
  const out = [`# ${title}`];
  if (!rows.length) { out.push('(none)'); return out.join('\n') + '\n'; }
  out.push(cols.join(','));
  for (const r of rows) out.push(cols.map((c) => cell(r[c])).join(','));
  return out.join('\n') + '\n';
};

const rs = (p) => ((Number(p) || 0) / 100).toFixed(2);

/**
 * The whole report as one CSV with named sections.
 *
 * Excel opens it, and a reader scrolling down finds the summary first and the
 * detail beneath — the same order as the PDF, so the two never feel like
 * different documents.
 */
function toCsv(d) {
  const t = d.revenue.totals;
  const parts = [];

  parts.push(`# ${d.place.name} — ${titleFor(d.period)} report`);
  parts.push(`# ${d.from} to ${d.to}`);
  parts.push(`# Generated ${new Date().toISOString()}`);
  parts.push('');

  parts.push(section('SUMMARY', ['item', 'value'], [
    { item: 'Tickets sold', value: t.tickets || 0 },
    { item: 'Total collected (Rs.)', value: rs(t.gross_paise) },
    { item: 'Department entry fee (Rs.)', value: rs(t.entry_paise) },
    { item: 'Booking fee (Rs.)', value: rs(t.platform_paise) },
    { item: 'GST on booking fee (Rs.)', value: rs(t.gst_paise) },
    { item: 'Gateway charges, estimated (Rs.)', value: rs(t.gateway_fee_paise) },
    { item: 'Take-home, estimated (Rs.)', value: rs(t.take_home_paise) },
    { item: 'Vehicles scanned at the gate', value: d.gate.scanned },
    { item: 'Allowed through', value: d.gate.allowed },
    { item: 'Refused', value: d.gate.refused },
    { item: 'Altered or duplicated tickets caught', value: d.gate.fraudulent },
    { item: 'Refunds', value: d.refunds.length },
    { item: 'Refunded (Rs.)', value: rs(d.refunds.reduce((n, r) => n + r.total_paise, 0)) },
  ]));

  parts.push(section('BY DAY',
    ['date', 'tickets', 'collected', 'department', 'booking_fee', 'gst', 'gateway_est', 'take_home_est'],
    d.revenue.days.map((x) => ({
      date: x.date, tickets: x.tickets,
      collected: rs(x.gross_paise), department: rs(x.entry_paise),
      booking_fee: rs(x.platform_paise), gst: rs(x.gst_paise),
      gateway_est: rs(x.gateway_fee_paise), take_home_est: rs(x.take_home_paise),
    }))));

  parts.push(section('BY VEHICLE TYPE', ['type', 'tickets', 'collected'],
    d.categories.map((c) => ({ type: c.label, tickets: c.tickets, collected: rs(c.gross_paise) }))));

  parts.push(section('BY SLOT', ['slot', 'tickets', 'collected'],
    d.slots.map((s) => ({ slot: s.label, tickets: s.tickets, collected: rs(s.gross_paise) }))));

  parts.push(section('GATE VERDICTS', ['verdict', 'count'],
    Object.entries(d.gate)
      .filter(([k]) => !['scanned', 'allowed', 'refused', 'fraudulent'].includes(k))
      .map(([verdict, count]) => ({ verdict, count }))));

  parts.push(section('STAFF ON THE GATE',
    ['staff', 'scans', 'allowed', 'refused', 'offline', 'first_scan', 'last_scan'],
    d.staff.map((s) => ({
      staff: s.name, scans: s.scans, allowed: s.allowed, refused: s.refused,
      offline: s.offline, first_scan: s.first_scan, last_scan: s.last_scan,
    }))));

  parts.push(section('CAPACITY',
    ['date', 'slot', 'type', 'capacity', 'booked', 'held', 'open'],
    d.occupancy.map((o) => ({
      date: String(o.travel_date).slice(0, 10), slot: o.slot_label, type: o.category_label,
      capacity: o.capacity, booked: o.booked, held: o.held, open: o.is_open ? 'yes' : 'no',
    }))));

  parts.push(section('EVERY TICKET',
    ['ticket_no', 'reference', 'date', 'slot', 'vehicle', 'make', 'type', 'mobile',
     'entry', 'booking_fee', 'gst', 'total', 'status', 'booked_at', 'entered_at',
     'moved_from', 'gateway_payment_id', 'refund_id'],
    d.tickets.map((x) => ({
      ticket_no: x.ticket_no, reference: x.reference_id,
      date: String(x.travel_date).slice(0, 10), slot: x.slot_label,
      vehicle: x.reg_no, make: [x.maker, x.model].filter(Boolean).join(' '),
      type: x.category_label, mobile: x.mobile,
      entry: rs(x.entry_paise), booking_fee: rs(x.platform_paise),
      gst: rs(x.gst_paise), total: rs(x.total_paise),
      status: x.status, booked_at: x.created_at, entered_at: x.used_at,
      moved_from: x.moved_from_date ? String(x.moved_from_date).slice(0, 10) : '',
      gateway_payment_id: x.gateway_payment_id, refund_id: x.refund_id,
    }))));

  parts.push(section('EVERY SCAN',
    ['scanned_at', 'verdict', 'ticket_no', 'vehicle', 'staff', 'checkpost', 'device',
     'offline', 'synced_at'],
    d.scans.map((s) => ({
      scanned_at: s.scanned_at, verdict: s.verdict, ticket_no: s.ticket_no,
      vehicle: s.reg_no, staff: s.staff_name, checkpost: s.checkpost_name,
      device: s.device_label, offline: s.was_offline ? 'yes' : 'no', synced_at: s.synced_at,
    }))));

  parts.push(section('REFUNDS', ['ticket_no', 'vehicle', 'date', 'amount', 'refund_id', 'refunded_at'],
    d.refunds.map((r) => ({
      ticket_no: r.ticket_no, vehicle: r.reg_no,
      date: String(r.travel_date).slice(0, 10), amount: rs(r.total_paise),
      refund_id: r.refund_id, refunded_at: r.refunded_at,
    }))));

  parts.push(section('CLOSURES', ['date', 'slot', 'reason', 'affected', 'moved', 'refunded', 'by'],
    d.closures.map((c) => ({
      date: String(c.travel_date).slice(0, 10), slot: c.slot_label || 'whole day',
      reason: c.reason, affected: c.tickets_affected, moved: c.tickets_postponed,
      refunded: c.tickets_refunded, by: c.created_by_name,
    }))));

  parts.push(section('VISITOR MESSAGES', ['when', 'kind', 'mobile', 'message'],
    d.messages.map((m) => ({
      when: m.created_at, kind: m.kind, mobile: m.mobile, message: m.detail?.message,
    }))));

  return parts.join('\n');
}

const titleFor = (p) => (p === 'weekly' ? 'Weekly' : p === 'monthly' ? 'Monthly' : 'Daily');

module.exports = { windowFor, gather, toCsv, titleFor, rs };
