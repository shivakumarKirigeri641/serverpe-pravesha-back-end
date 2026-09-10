/**
 * reports.js — the numbers the department will ask for.
 *
 * Written as queries rather than as counters kept up to date by application
 * code, because a counter that drifts is worse than no counter: nobody notices
 * until a government officer is looking at it in a meeting. These recompute
 * from the tickets and scans every time. The volumes involved — a few thousand
 * rows a day — make that cheap.
 *
 * THE MONEY IS SPLIT THREE WAYS AND MUST STAY SPLIT:
 *
 *   entry_paise      the department's. Collected as a pure agent under Rule 33
 *                    of the CGST Rules — it passes through our account and is
 *                    never our revenue.
 *   platform_paise   ours, GST-inclusive.
 *   gst_paise        the tax inside our fee, payable to the government.
 *
 * "Take home" is what is left after the payment gateway's cut, which nobody
 * gets back on a refund. Showing it separately is the difference between a
 * founder who knows what the business earns and one who finds out at year end.
 */

const { query, one } = require('./db');
const settings = require('./settings');

/** Live tickets: paid or already used. Cancelled ones are not revenue. */
const LIVE = `t.status IN ('paid','used')`;

/* ───────────────────────────────────────────────────────────── dashboard */

/**
 * Everything the front page shows, in one round trip.
 *
 * Deliberately includes yesterday alongside today: a number with nothing to
 * compare it to tells a viewer almost nothing.
 */
async function dashboard(placeId) {
  const [todayRow, tomorrowRow, yesterdayRow, monthRow, gate, capacity, recent] =
    await Promise.all([
      dayTotals(placeId, 'CURRENT_DATE'),
      dayTotals(placeId, "CURRENT_DATE + 1"),
      dayTotals(placeId, "CURRENT_DATE - 1"),
      rangeTotals(placeId, "date_trunc('month', CURRENT_DATE)::date", 'CURRENT_DATE'),
      gateToday(placeId),
      occupancyToday(placeId),
      recentBookings(placeId, 8),
    ]);

  return {
    today: todayRow,
    tomorrow: tomorrowRow,
    yesterday: yesterdayRow,
    month: monthRow,
    gate,
    capacity,
    recent,
  };
}

async function dayTotals(placeId, dateExpr) {
  return one(
    `SELECT (${dateExpr})::date AS date,
            count(*)::int                       AS tickets,
            COALESCE(sum(t.total_paise),0)::int AS gross_paise,
            COALESCE(sum(t.entry_paise),0)::int AS entry_paise,
            COALESCE(sum(t.platform_paise),0)::int AS platform_paise,
            COALESCE(sum(t.gst_paise),0)::int   AS gst_paise,
            count(*) FILTER (WHERE t.status = 'used')::int AS used
       FROM tickets t
      WHERE t.place_id = $1 AND t.travel_date = (${dateExpr})::date AND ${LIVE}`,
    [placeId]);
}

async function rangeTotals(placeId, fromExpr, toExpr) {
  return one(
    `SELECT count(*)::int                          AS tickets,
            COALESCE(sum(t.total_paise),0)::int    AS gross_paise,
            COALESCE(sum(t.entry_paise),0)::int    AS entry_paise,
            COALESCE(sum(t.platform_paise),0)::int AS platform_paise,
            COALESCE(sum(t.gst_paise),0)::int      AS gst_paise
       FROM tickets t
      WHERE t.place_id = $1 AND t.travel_date BETWEEN (${fromExpr}) AND (${toExpr})
        AND ${LIVE}`,
    [placeId]);
}

/** What the gate has seen today, including everything it turned away. */
async function gateToday(placeId) {
  const r = await query(
    `SELECT s.verdict, count(*)::int AS n
       FROM scans s
       LEFT JOIN checkposts c ON c.id = s.checkpost_id
      WHERE s.scanned_at::date = CURRENT_DATE
        AND (c.place_id = $1 OR c.place_id IS NULL)
      GROUP BY s.verdict`, [placeId]);

  const out = { total: 0, valid: 0, already_used: 0, invalid_signature: 0,
                wrong_day: 0, wrong_slot: 0, wrong_place: 0, unknown_ticket: 0, cancelled: 0 };
  for (const row of r.rows) { out[row.verdict] = row.n; out.total += row.n; }
  // The headline the department cares about: how many attempts were refused.
  out.refused = out.total - out.valid;
  return out;
}

/** How full each slot is today, per vehicle type. */
async function occupancyToday(placeId, travelDate = null) {
  const r = await query(
    `SELECT s.code AS slot_code, s.label AS slot_label,
            vc.code AS category_code, vc.label AS category_label,
            i.capacity, i.booked, i.held, i.is_open, i.closed_note,
            GREATEST(i.capacity - i.booked - i.held, 0) AS available
       FROM slot_inventory i
       JOIN place_slots s ON s.id = i.slot_id
       JOIN vehicle_categories vc ON vc.id = i.category_id
      WHERE i.place_id = $1 AND i.travel_date = COALESCE($2::date, CURRENT_DATE)
      ORDER BY s.sort_order, vc.sort_order`, [placeId, travelDate]);
  return r.rows;
}

async function recentBookings(placeId, limit = 20) {
  const r = await query(
    `SELECT t.ticket_no, t.reg_no, t.travel_date, t.total_paise, t.status,
            t.created_at, s.label AS slot_label, vc.label AS category_label
       FROM tickets t
       JOIN place_slots s ON s.id = t.slot_id
       JOIN vehicle_categories vc ON vc.id = t.category_id
      WHERE t.place_id = $1 AND ${LIVE}
      ORDER BY t.created_at DESC
      LIMIT $2`, [placeId, limit]);
  return r.rows;
}

/* ──────────────────────────────────────────────────────────────── revenue */

/**
 * The money, day by day, with our actual earnings worked out.
 *
 * The gateway fee is an ESTIMATE from a configured percentage, not a figure
 * read back from Razorpay. It is labelled as such wherever it is shown — a
 * number presented to a government officer must never look more precise than it
 * is.
 */
async function revenue(placeId, { from, to }) {
  const feePct = await settings.num('gateway_fee_percent', 2);
  const feeGstPct = await settings.num('gst_percent_on_platform', 18);

  const r = await query(
    `SELECT t.travel_date AS date,
            count(*)::int                          AS tickets,
            COALESCE(sum(t.total_paise),0)::int    AS gross_paise,
            COALESCE(sum(t.entry_paise),0)::int    AS entry_paise,
            COALESCE(sum(t.platform_paise),0)::int AS platform_paise,
            COALESCE(sum(t.gst_paise),0)::int      AS gst_paise
       FROM tickets t
      WHERE t.place_id = $1 AND t.travel_date BETWEEN $2 AND $3 AND ${LIVE}
      GROUP BY t.travel_date
      ORDER BY t.travel_date`, [placeId, from, to]);

  const days = r.rows.map((d) => withEarnings(d, feePct, feeGstPct));

  const totals = days.reduce((a, d) => {
    for (const k of ['tickets', 'gross_paise', 'entry_paise', 'platform_paise', 'gst_paise',
                     'gateway_fee_paise', 'platform_base_paise', 'take_home_paise']) {
      a[k] = (a[k] || 0) + (d[k] || 0);
    }
    return a;
  }, {});

  const refunds = await one(
    `SELECT count(*)::int AS n, COALESCE(sum(t.total_paise),0)::int AS amount_paise
       FROM tickets t
      WHERE t.place_id = $1 AND t.travel_date BETWEEN $2 AND $3
        AND t.status = 'cancelled'`, [placeId, from, to]);

  return { from, to, days, totals, refunds, assumptions: {
    gateway_fee_percent: feePct, gst_percent: feeGstPct,
    note: 'Gateway fee is an estimate at the configured percentage, not a figure read from Razorpay.',
  } };
}

function withEarnings(d, feePct, feeGstPct) {
  // Razorpay charges its percentage on the WHOLE amount collected — including
  // the department's entry fee, which is not our revenue. That is why the fee
  // can look large next to our own share.
  const fee = Math.round(d.gross_paise * feePct / 100 * (1 + feeGstPct / 100));
  const base = d.platform_paise - d.gst_paise;
  return {
    ...d,
    platform_base_paise: base,
    gateway_fee_paise: fee,
    take_home_paise: base - fee,
  };
}

/* ────────────────────────────────────────────────────────────── bookings */

async function bookings(placeId, { from, to, status, slotCode, categoryCode, q, limit = 200, offset = 0 }) {
  const where = ['t.place_id = $1'];
  const params = [placeId];
  const add = (clause, value) => { params.push(value); where.push(clause.replace('?', `$${params.length}`)); };

  if (from) add('t.travel_date >= ?', from);
  if (to) add('t.travel_date <= ?', to);
  if (status) add('t.status = ?', status);
  if (slotCode) add('s.code = ?', slotCode);
  if (categoryCode) add('vc.code = ?', categoryCode);
  // One search box for the three things anyone actually searches by. The same
  // parameter is referenced three times rather than passed three times — the
  // add() helper above fills a single placeholder, and this clause has three.
  if (q) {
    params.push(`%${String(q).replace(/\s/g, '').toUpperCase()}%`);
    const i = params.length;
    where.push(`(t.reg_no ILIKE $${i} OR t.ticket_no ILIKE $${i} OR t.mobile ILIKE $${i})`);
  }

  const sql =
    `SELECT t.*, s.label AS slot_label, s.code AS slot_code,
            vc.label AS category_label, vc.code AS category_code,
            v.maker, v.model
       FROM tickets t
       JOIN place_slots s ON s.id = t.slot_id
       JOIN vehicle_categories vc ON vc.id = t.category_id
       JOIN vehicles v ON v.id = t.vehicle_id
      WHERE ${where.join(' AND ')}
      ORDER BY t.travel_date DESC, t.created_at DESC
      LIMIT ${Number(limit)} OFFSET ${Number(offset)}`;

  const rows = (await query(sql, params)).rows;
  const total = await one(
    `SELECT count(*)::int AS n FROM tickets t
       JOIN place_slots s ON s.id = t.slot_id
       JOIN vehicle_categories vc ON vc.id = t.category_id
      WHERE ${where.join(' AND ')}`, params);

  return { rows, total: total.n };
}

/* ─────────────────────────────────────────────────────────────── the gate */

/**
 * Scans, newest first, with the option of showing only the refusals.
 *
 * The refusals are the evidence the system works. A week with eleven altered
 * tickets caught is the single most persuasive number in any report to the
 * department.
 */
async function scans(placeId, { from, to, verdict, onlyRefused, limit = 200, offset = 0 }) {
  const where = ['(c.place_id = $1 OR c.place_id IS NULL)'];
  const params = [placeId];
  const add = (clause, value) => { params.push(value); where.push(clause.replace('?', `$${params.length}`)); };

  if (from) add('sc.scanned_at >= ?', from);
  if (to) add('sc.scanned_at < (?::date + 1)', to);
  if (verdict) add('sc.verdict = ?', verdict);
  if (onlyRefused) where.push(`sc.verdict <> 'valid'`);

  const rows = (await query(
    `SELECT sc.*, st.name AS staff_name, c.name AS checkpost_name, d.label AS device_label
       FROM scans sc
       LEFT JOIN checkposts c ON c.id = sc.checkpost_id
       LEFT JOIN staff st ON st.id = sc.staff_id
       LEFT JOIN devices d ON d.id = sc.device_id
      WHERE ${where.join(' AND ')}
      ORDER BY sc.scanned_at DESC
      LIMIT ${Number(limit)} OFFSET ${Number(offset)}`, params)).rows;

  const total = await one(
    `SELECT count(*)::int AS n FROM scans sc
       LEFT JOIN checkposts c ON c.id = sc.checkpost_id
      WHERE ${where.join(' AND ')}`, params);

  return { rows, total: total.n };
}

/** Who was on the gate, and what each of them saw. */
async function staffActivity(placeId, { from, to }) {
  const r = await query(
    `SELECT st.id, st.name,
            count(*)::int AS scans,
            count(*) FILTER (WHERE sc.verdict = 'valid')::int AS allowed,
            count(*) FILTER (WHERE sc.verdict <> 'valid')::int AS refused,
            count(*) FILTER (WHERE sc.was_offline)::int AS offline,
            min(sc.scanned_at) AS first_scan,
            max(sc.scanned_at) AS last_scan
       FROM scans sc
       JOIN staff st ON st.id = sc.staff_id
       JOIN checkposts c ON c.id = sc.checkpost_id
      WHERE c.place_id = $1 AND sc.scanned_at::date BETWEEN $2 AND $3
      GROUP BY st.id, st.name
      ORDER BY scans DESC`, [placeId, from, to]);
  return r.rows;
}

/* ───────────────────────────────────────────────────────────── the mix */

/** Which vehicle types come, and what each type is worth. */
async function categoryMix(placeId, { from, to }) {
  const r = await query(
    `SELECT vc.code, vc.label,
            count(*)::int AS tickets,
            COALESCE(sum(t.total_paise),0)::int AS gross_paise
       FROM tickets t
       JOIN vehicle_categories vc ON vc.id = t.category_id
      WHERE t.place_id = $1 AND t.travel_date BETWEEN $2 AND $3 AND ${LIVE}
      GROUP BY vc.code, vc.label, vc.sort_order
      ORDER BY vc.sort_order`, [placeId, from, to]);
  return r.rows;
}

/** Morning against afternoon — the question that decides whether to re-split. */
async function slotMix(placeId, { from, to }) {
  const r = await query(
    `SELECT s.code, s.label,
            count(*)::int AS tickets,
            COALESCE(sum(t.total_paise),0)::int AS gross_paise
       FROM tickets t
       JOIN place_slots s ON s.id = t.slot_id
      WHERE t.place_id = $1 AND t.travel_date BETWEEN $2 AND $3 AND ${LIVE}
      GROUP BY s.code, s.label, s.sort_order
      ORDER BY s.sort_order`, [placeId, from, to]);
  return r.rows;
}

/** What upstream lookups cost — zero today, and the column exists so it stays honest. */
async function apiCosts(placeId, { from, to }) {
  return one(
    `SELECT count(*)::int AS calls,
            count(*) FILTER (WHERE cache_hit)::int AS from_cache,
            count(*) FILTER (WHERE NOT ok)::int AS failed,
            COALESCE(sum(cost_paise),0)::int AS cost_paise
       FROM api_calls
      WHERE created_at::date BETWEEN $1 AND $2`, [from, to]);
}

module.exports = {
  dashboard, dayTotals, rangeTotals, gateToday, occupancyToday, recentBookings,
  revenue, bookings, scans, staffActivity, categoryMix, slotMix, apiCosts,
};
