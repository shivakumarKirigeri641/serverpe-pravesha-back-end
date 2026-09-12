/**
 * adminOnspot.js — passes sold at a barrier, and the money that came with them.
 *
 * WHY THIS IS ITS OWN SCREEN. Every other sale is a card payment that arrives in
 * a bank account whether anybody watches it or not. These are different: cash in
 * somebody's hand, a UPI reference read off a stranger's phone, a card slip in a
 * drawer. Nothing about them reconciles itself. The money exists only as what a
 * staff member wrote down, and the gap between what was sold and what was banked
 * is the whole risk — so it needs a screen where that gap is visible rather than
 * a filter on a screen about something else.
 *
 * IT IS THE SAME MONEY AS EVERYWHERE ELSE. A gate sale writes a payment marked
 * 'counter', a pass, and a tax invoice from the one unbroken series, exactly as
 * an online sale does. So these totals are a view of the same rows the finance
 * and GST screens count, not a second ledger kept alongside them — if the two
 * ever disagree, one of them is wrong, and that is worth being able to see.
 *
 * WHAT IT ANSWERS, IN THE ORDER IT COMES UP. How much cash should this staff
 * member be holding at the end of their shift. Which sales were to vehicles the
 * register could not identify, and who decided what they were. And which UPI
 * references have a photograph behind them, because a reference typed from
 * somebody else's screen is the weakest fact in the system.
 */

const { query, one } = require('./db');
const slotTime = require('./slotTime');

const n = (v) => Number(v || 0);
const rupees = (paise) => Math.round(n(paise)) / 100;
const rowsOf = async (text, params) => (await query(text, params)).rows;
const asDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : (d ? String(d).slice(0, 10) : null));
const mask = (m) => (m ? `••••${String(m).slice(-4)}` : null);

const METHODS = ['cash', 'upi', 'card'];

/* Both kinds of gate sale, named the way staff would name them. */
const IDENTITY = {
  rc: 'The register identified it',
  declared: 'Type declared at the gate',
  no_plate: 'No number plate',
};

const PERIOD = (from, to) => ({
  from: from || slotTime.nowIST().date,
  to: to || from || slotTime.nowIST().date,
});

/**
 * The totals a shift is reconciled against: what was taken, by what means, by
 * whom. Cash first, because cash is the only one somebody has to physically
 * hand over at the end of the day.
 */
async function summary({ from, to }) {
  const period = PERIOD(from, to);

  const [totals] = await rowsOf(
    `SELECT count(*)                                                        AS sales,
            COALESCE(sum(g.amount_paise), 0)                                AS collected,
            COALESCE(sum(t.entry_paise), 0)                                 AS department,
            COALESCE(sum(t.platform_paise), 0)                              AS service,
            COALESCE(sum(t.gst_paise), 0)                                   AS gst,
            count(*) FILTER (WHERE g.payment_method = 'cash')               AS cash_count,
            COALESCE(sum(g.amount_paise) FILTER (WHERE g.payment_method = 'cash'), 0) AS cash,
            count(*) FILTER (WHERE g.payment_method = 'upi')                AS upi_count,
            COALESCE(sum(g.amount_paise) FILTER (WHERE g.payment_method = 'upi'), 0)  AS upi,
            count(*) FILTER (WHERE g.payment_method = 'card')               AS card_count,
            COALESCE(sum(g.amount_paise) FILTER (WHERE g.payment_method = 'card'), 0) AS card,
            count(*) FILTER (WHERE v.identified_by <> 'rc')                 AS declared,
            count(*) FILTER (WHERE v.identified_by = 'no_plate')            AS no_plate,
            count(*) FILTER (WHERE t.status = 'used')                       AS entered,
            count(DISTINCT g.issued_by_staff)                               AS staff
       FROM ticket_grants g
       JOIN tickets t ON t.id = g.ticket_id
       JOIN vehicles v ON v.id = t.vehicle_id
      WHERE g.kind = 'onspot' AND t.travel_date BETWEEN $1::date AND $2::date`,
    [period.from, period.to]);

  /* Who took the money. The number that matters is cash: the rest arrives in an
     account by itself, and this does not. */
  const byStaff = await rowsOf(
    `SELECT COALESCE(s.name, u.name, 'Unknown') AS name,
            s.id AS staff_id,
            cp.name AS checkpost,
            count(*) AS sales,
            COALESCE(sum(g.amount_paise), 0) AS collected,
            COALESCE(sum(g.amount_paise) FILTER (WHERE g.payment_method = 'cash'), 0) AS cash,
            COALESCE(sum(g.amount_paise) FILTER (WHERE g.payment_method = 'upi'), 0)  AS upi,
            COALESCE(sum(g.amount_paise) FILTER (WHERE g.payment_method = 'card'), 0) AS card,
            count(*) FILTER (WHERE v.identified_by <> 'rc') AS declared,
            max(g.created_at) AS last_sale
       FROM ticket_grants g
       JOIN tickets t ON t.id = g.ticket_id
       JOIN vehicles v ON v.id = t.vehicle_id
       LEFT JOIN staff s ON s.id = g.issued_by_staff
       LEFT JOIN admin_users u ON u.id = g.issued_by
       LEFT JOIN checkposts cp ON cp.id = g.checkpost_id
      WHERE g.kind = 'onspot' AND t.travel_date BETWEEN $1::date AND $2::date
      GROUP BY s.id, s.name, u.name, cp.name
      ORDER BY sum(g.amount_paise) DESC`,
    [period.from, period.to]);

  const daily = await rowsOf(
    `SELECT d::date AS day,
            count(g.*) AS sales,
            COALESCE(sum(g.amount_paise), 0) AS collected,
            COALESCE(sum(g.amount_paise) FILTER (WHERE g.payment_method = 'cash'), 0) AS cash
       FROM generate_series($1::date, $2::date, '1 day') d
       LEFT JOIN tickets t ON t.travel_date = d::date
       LEFT JOIN ticket_grants g ON g.ticket_id = t.id AND g.kind = 'onspot'
      GROUP BY d ORDER BY d`,
    [period.from, period.to]);

  return {
    period,
    totals: {
      sales: n(totals.sales),
      collected: rupees(totals.collected),
      department: rupees(totals.department),
      serviceFee: rupees(totals.service),
      gst: rupees(totals.gst),
      entered: n(totals.entered),
      declared: n(totals.declared),
      noPlate: n(totals.no_plate),
      staff: n(totals.staff),
    },
    byMethod: [
      { method: 'cash', label: 'Cash', sales: n(totals.cash_count), amount: rupees(totals.cash) },
      { method: 'upi', label: 'UPI', sales: n(totals.upi_count), amount: rupees(totals.upi) },
      { method: 'card', label: 'Card', sales: n(totals.card_count), amount: rupees(totals.card) },
    ],
    byStaff: byStaff.map((r) => ({
      staffId: r.staff_id ? String(r.staff_id) : null,
      name: r.name,
      checkpost: r.checkpost,
      sales: n(r.sales),
      collected: rupees(r.collected),
      cash: rupees(r.cash),
      upi: rupees(r.upi),
      card: rupees(r.card),
      declared: n(r.declared),
      lastSale: r.last_sale,
    })),
    daily: daily.map((r) => ({
      day: asDate(r.day), sales: n(r.sales), collected: rupees(r.collected), cash: rupees(r.cash),
    })),
  };
}

/** Every gate sale in the period, with everything recorded about it. */
async function list({ from, to, method = null, kind = null, staffId = null, q = null, limit = 50, offset = 0 } = {}) {
  const period = PERIOD(from, to);
  const term = String(q || '').trim();
  const plate = term.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const digits = term.replace(/\D/g, '');
  const size = Math.max(1, Math.min(200, Number(limit) || 50));
  const skip = Math.max(0, Number(offset) || 0);

  const rows = await rowsOf(
    `SELECT t.id, t.ticket_no, t.reg_no, t.travel_date, t.status, t.used_at, t.mobile,
            t.entry_paise, t.platform_paise, t.gst_paise, t.total_paise, t.entry_source,
            g.payment_method, g.payment_reference, g.amount_paise, g.created_at AS sold_at, g.declared,
            v.identified_by, v.identity_kind, v.identity_note, v.maker, v.model, v.colour,
            c.label AS type_label, c.code AS type_code,
            regexp_replace(sl.label, '[[:space:]]+', ' ', 'g') AS slot,
            cu.name AS visitor,
            s.name AS staff, s.id AS staff_id, cp.name AS checkpost, u.name AS admin,
            i.invoice_no, i.id AS invoice_id,
            (SELECT COALESCE(json_agg(json_build_object('id', ph.id, 'kind', ph.kind) ORDER BY ph.id), '[]')
               FROM gate_photos ph WHERE ph.ticket_id = t.id) AS photos,
            count(*) OVER () AS total_rows
       FROM ticket_grants g
       JOIN tickets t ON t.id = g.ticket_id
       JOIN vehicles v ON v.id = t.vehicle_id
       JOIN vehicle_categories c ON c.id = t.category_id
       JOIN place_slots sl ON sl.id = t.slot_id
       LEFT JOIN customers cu ON cu.id = t.customer_id
       LEFT JOIN staff s ON s.id = g.issued_by_staff
       LEFT JOIN admin_users u ON u.id = g.issued_by
       LEFT JOIN checkposts cp ON cp.id = g.checkpost_id
       LEFT JOIN invoices i ON i.ticket_id = t.id
      WHERE g.kind = 'onspot'
        AND t.travel_date BETWEEN $1::date AND $2::date
        AND ($3::text IS NULL OR g.payment_method = $3)
        AND ($4::text IS NULL
             OR ($4 = 'declared' AND v.identified_by = 'declared')
             OR ($4 = 'no_plate' AND v.identified_by = 'no_plate')
             OR ($4 = 'rc' AND v.identified_by = 'rc'))
        AND ($5::bigint IS NULL OR g.issued_by_staff = $5::bigint)
        AND ($6::text IS NULL
             OR t.reg_no LIKE '%' || $6 || '%'
             OR t.ticket_no ILIKE '%' || $6 || '%'
             OR g.payment_reference ILIKE '%' || $6 || '%'
             OR v.identity_note ILIKE '%' || $6 || '%'
             OR ($7::text IS NOT NULL AND t.mobile LIKE '%' || $7))
      ORDER BY g.created_at DESC
      LIMIT $8 OFFSET $9`,
    [period.from, period.to,
      METHODS.includes(method) ? method : null,
      ['rc', 'declared', 'no_plate'].includes(kind) ? kind : null,
      /^\d+$/.test(String(staffId || '')) ? staffId : null,
      plate || null, digits.length >= 4 ? digits : null,
      size, skip]);

  return {
    period,
    total: rows.length ? n(rows[0].total_rows) : 0,
    limit: size,
    offset: skip,
    sales: rows.map((r) => ({
      id: String(r.id),
      ticketNo: r.ticket_no,
      regNo: r.reg_no,
      vehicle: [r.maker, r.model].filter(Boolean).join(' ') || null,
      colour: r.colour,
      type: r.type_label,
      typeCode: r.type_code,
      /* How the vehicle was identified, which is also who decided the price. */
      kind: r.identified_by,
      kindLabel: IDENTITY[r.identified_by] || r.identified_by,
      declaredByStaff: r.declared === true || r.identified_by !== 'rc',
      identity: r.identity_note ? { kind: r.identity_kind, value: r.identity_note } : null,
      travelDate: asDate(r.travel_date),
      slot: r.slot,
      visitor: r.visitor,
      mobile: mask(r.mobile),
      status: r.status,
      entered: r.used_at ? { at: r.used_at, source: r.entry_source } : null,
      soldAt: r.sold_at,
      soldBy: r.staff || r.admin || null,
      staffId: r.staff_id ? String(r.staff_id) : null,
      checkpost: r.checkpost,
      payment: {
        method: r.payment_method,
        reference: r.payment_reference,
        amount: rupees(r.amount_paise ?? r.total_paise),
        entry: rupees(r.entry_paise),
        serviceFee: rupees(r.platform_paise),
        gst: rupees(r.gst_paise),
      },
      invoiceNo: r.invoice_no,
      invoiceId: r.invoice_id ? String(r.invoice_id) : null,
      photos: (r.photos || []).map((p) => ({ id: String(p.id), kind: p.kind })),
    })),
  };
}

/**
 * Does this screen agree with the finance screen?
 *
 * Same rows, two paths: this one counts what staff recorded as taken, the other
 * counts payments marked 'counter'. They must match to the rupee. Showing the
 * check rather than assuming it means a divergence is noticed by whoever is
 * reconciling, on the day, instead of by an accountant months later.
 */
async function reconcile({ from, to }) {
  const period = PERIOD(from, to);
  const [grants] = await rowsOf(
    `SELECT count(*) AS sales, COALESCE(sum(g.amount_paise), 0) AS amount
       FROM ticket_grants g JOIN tickets t ON t.id = g.ticket_id
      WHERE g.kind = 'onspot' AND t.travel_date BETWEEN $1::date AND $2::date`, [period.from, period.to]);

  const [payments] = await rowsOf(
    `SELECT count(*) AS payments, COALESCE(sum(p.amount_paise), 0) AS amount
       FROM payments p JOIN tickets t ON t.payment_id = p.id
      WHERE p.gateway = 'counter' AND t.travel_date BETWEEN $1::date AND $2::date`, [period.from, period.to]);

  const [invoices] = await rowsOf(
    `SELECT count(*) AS invoices
       FROM invoices i JOIN tickets t ON t.id = i.ticket_id
       JOIN ticket_grants g ON g.ticket_id = t.id
      WHERE g.kind = 'onspot' AND t.travel_date BETWEEN $1::date AND $2::date`, [period.from, period.to]);

  const sales = n(grants.sales);
  return {
    period,
    sales,
    recorded: rupees(grants.amount),
    payments: n(payments.payments),
    banked: rupees(payments.amount),
    invoices: n(invoices.invoices),
    /* Every sale must have a payment row and a tax invoice. */
    agrees: n(grants.amount) === n(payments.amount) && sales === n(payments.payments),
    invoicesMissing: Math.max(0, sales - n(invoices.invoices)),
  };
}

module.exports = { METHODS, IDENTITY, summary, list, reconcile };
