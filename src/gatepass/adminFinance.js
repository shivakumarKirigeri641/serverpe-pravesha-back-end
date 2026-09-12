/**
 * adminFinance.js — My GST & Invoices: what Pravesha earned, what it owes in
 * GST, what it spent, and every invoice behind it.
 *
 * TWO BASES, BOTH NAMED. Collections, fees, gateway charges and refunds are
 * counted by the day the money moved (payment date) — the basis that reconciles
 * with the bank. GST liability is counted from invoices by their issue date —
 * the basis a GST return is filed on. For a pass paid and invoiced in the same
 * moment the two agree; the screen says which is which rather than pretending
 * there is one number.
 *
 * WHAT IS PRAVESHA'S. The entry fee is collected as a pure agent for the
 * Department of Tourism and passed on in full: it is shown, but it is not
 * Pravesha's revenue and carries no GST. Pravesha's revenue is the service fee,
 * which includes GST.
 *
 *   Net revenue       = service fee − output GST − gateway charges − refunded fees (net of GST)
 *   GST payable       = output GST − refunded GST − input tax credit claimed (not below zero)
 *   Take-home revenue = service fee − refunded fees − gateway charges − expenses − GST payable
 *
 * INPUT TAX CREDIT is only ever what finance has recorded as eligible: GST on
 * expense bills marked ITC-eligible, and — only if switched on — the GST inside
 * the gateway's charges. Whether a credit may actually be claimed depends on the
 * supplier's tax invoice and the return; the screen states that, and the figure
 * is an estimate for the accountant, not a filing.
 */

const { query, one } = require('./db');
const settings = require('./settings');
const slotTime = require('./slotTime');
const analytics = require('./adminAnalytics');
const booking = require('./booking');

const n = (v) => Number(v || 0);
const rupees = (paise) => Math.round(n(paise)) / 100;
const rowsOf = async (text, params) => (await query(text, params)).rows;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

class Refusal extends Error {
  constructor(message, { status = 400, code = 'invalid' } = {}) { super(message); this.status = status; this.code = code; }
}
const refuse = (message, opts) => { throw new Refusal(message, opts); };

/* ───────────────────────────────────────────────────────────── periods ── */

const PRESETS = {
  today: 'Today',
  yesterday: 'Yesterday',
  last7: 'Last 7 days',
  thisMonth: 'This month',
  prevMonth: 'Previous month',
  custom: 'Custom',
};

function periodFor({ preset = 'today', from, to } = {}) {
  const today = slotTime.nowIST().date;
  const [y, m] = today.split('-').map(Number);
  const monthStart = (yy, mm) => `${yy}-${String(mm).padStart(2, '0')}-01`;
  let f;
  let t;
  switch (preset) {
    case 'yesterday': f = analytics.shiftDay(today, -1); t = f; break;
    case 'last7': f = analytics.shiftDay(today, -6); t = today; break;
    case 'thisMonth': f = monthStart(y, m); t = today; break;
    case 'prevMonth': {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      f = monthStart(py, pm);
      t = analytics.shiftDay(monthStart(y, m), -1);
      break;
    }
    case 'custom':
      f = DATE.test(String(from || '')) ? from : today;
      t = DATE.test(String(to || '')) ? to : f;
      break;
    default: preset = 'today'; f = today; t = today;
  }
  if (t > today) t = today;
  if (f > t) [f, t] = [t, f];
  return { preset, label: PRESETS[preset], from: f, to: t, today, presets: Object.entries(PRESETS).map(([key, label]) => ({ key, label })) };
}

const IST_DAY = (col) => `(${col} AT TIME ZONE 'Asia/Kolkata')::date`;

/*
 * A refund is taken from the entry fee first, then from the service fee: a
 * partial refund is almost always the Department's entry fee being returned
 * (a closure after booking), while the booking service was still delivered.
 * GST is reversed only on the part of the service fee that went back.
 */
const FEE_REFUNDED = 'LEAST(platform_paise, GREATEST(0, refunded_paise - entry_paise))';
const GST_REFUNDED = `CASE WHEN platform_paise > 0 THEN round(gst_paise::numeric * ${FEE_REFUNDED} / platform_paise)::bigint ELSE 0 END`;
const ENTRY_REFUNDED = 'LEAST(entry_paise, refunded_paise)';

/* ───────────────────────────────────────────────────── 8.1 and 8.2 ── */

async function summary(period) {
  const { from, to } = period;
  const includeGatewayItc = String(await settings.str('itc_include_gateway_gst', 'false')) === 'true';

  const [pay] = await rowsOf(
    `SELECT count(*) AS payments,
            COALESCE(sum(amount_paise), 0)   AS gross,
            COALESCE(sum(entry_paise), 0)    AS department,
            COALESCE(sum(platform_paise), 0) AS service,
            COALESCE(sum(gst_paise), 0)      AS gst,
            COALESCE(sum((raw->'gateway'->>'fee')::bigint), 0) AS gateway_fee,
            COALESCE(sum((raw->'gateway'->>'tax')::bigint), 0) AS gateway_tax,
            count(*) FILTER (WHERE raw->'gateway'->>'fee' IS NOT NULL) AS with_fee,
            /* Money taken at a barrier in cash, by UPI or on a card machine
               never passes through the payment gateway, so it never carries a
               gateway charge. Counting it among the payments that ought to have
               one would mean the screen said "these charges may be incomplete"
               for ever, from the first on-spot sale onwards. */
            count(*) FILTER (WHERE gateway <> 'counter') AS gateway_payments,
            count(*) FILTER (WHERE gateway = 'counter')  AS counter_payments,
            COALESCE(sum(amount_paise) FILTER (WHERE gateway = 'counter'), 0) AS counter_gross
       FROM payments
      WHERE status <> 'failed' AND paid_at IS NOT NULL AND ${IST_DAY('paid_at')} BETWEEN $1::date AND $2::date`, [from, to]);

  const [ref] = await rowsOf(
    `SELECT count(*) AS refunds, COALESCE(sum(refunded_paise), 0) AS amount,
            COALESCE(sum(${FEE_REFUNDED}), 0) AS service,
            COALESCE(sum(${GST_REFUNDED}), 0) AS gst
       FROM payments
      WHERE refunded_at IS NOT NULL AND ${IST_DAY('refunded_at')} BETWEEN $1::date AND $2::date`, [from, to]);

  const [inv] = await rowsOf(
    `SELECT count(*) AS invoices,
            COALESCE(sum(taxable_paise), 0) AS taxable,
            COALESCE(sum(gst_paise), 0)     AS gst,
            COALESCE(sum(service_paise), 0) AS service,
            COALESCE(sum(entry_paise), 0)   AS entry,
            COALESCE(sum(total_paise), 0)   AS total,
            count(*) FILTER (WHERE is_test) AS test_invoices
       FROM invoices
      WHERE ${IST_DAY('issued_at')} BETWEEN $1::date AND $2::date`, [from, to]);

  const [exp] = await rowsOf(
    `SELECT count(*) AS expenses, COALESCE(sum(amount_paise), 0) AS amount,
            COALESCE(sum(gst_paise) FILTER (WHERE itc_eligible), 0) AS itc,
            count(*) FILTER (WHERE itc_eligible) AS itc_bills
       FROM finance_expenses
      WHERE removed_at IS NULL AND spent_on BETWEEN $1::date AND $2::date`, [from, to]);

  const [paidWithoutInvoice] = await rowsOf(
    `SELECT count(*) AS c FROM tickets t JOIN payments p ON p.id = t.payment_id
      WHERE p.status = 'paid' AND t.total_paise > 0 AND t.status IN ('paid','used')
        AND ${IST_DAY('p.paid_at')} BETWEEN $1::date AND $2::date
        AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.ticket_id = t.id)`, [from, to]);

  const daily = await rowsOf(
    `SELECT d::date AS day,
            COALESCE(sum(p.amount_paise), 0)   AS gross,
            COALESCE(sum(p.platform_paise), 0) AS service,
            COALESCE(sum(p.gst_paise), 0)      AS gst,
            COALESCE(sum((p.raw->'gateway'->>'fee')::bigint), 0) AS gateway
       FROM generate_series($1::date, $2::date, '1 day') AS d
       LEFT JOIN payments p ON p.status <> 'failed' AND p.paid_at IS NOT NULL AND ${IST_DAY('p.paid_at')} = d::date
      GROUP BY d ORDER BY d`, [from, to]);

  /* Arithmetic in paise, rounded once at the end. */
  const refundedFeeNet = n(ref.service) - n(ref.gst);
  const outputGst = n(pay.gst) - n(ref.gst);
  const net = n(pay.service) - n(pay.gst) - n(pay.gateway_fee) - refundedFeeNet;
  const itcExpenses = n(exp.itc);
  const itcGateway = n(pay.gateway_tax);
  const itcClaimed = itcExpenses + (includeGatewayItc ? itcGateway : 0);
  const invoiceGstNet = n(inv.gst) - n(ref.gst);
  const gstPayable = Math.max(0, invoiceGstNet - itcClaimed);
  const excessItc = Math.max(0, itcClaimed - invoiceGstNet);
  const takeHome = n(pay.service) - n(ref.service) - n(pay.gateway_fee) - n(exp.amount) - gstPayable;
  const gstPercent = await settings.num('gst_percent_on_platform', 18);

  return {
    period,
    revenue: {
      basis: 'payment date',
      payments: n(pay.payments),
      grossCollection: rupees(pay.gross),
      departmentAmount: rupees(pay.department),
      praveshaGross: rupees(pay.service),
      gst: rupees(pay.gst),
      gatewayCharges: rupees(pay.gateway_fee),
      gatewayChargesKnown: n(pay.with_fee) === n(pay.gateway_payments),
      /* Collected at a barrier rather than through the gateway. The same money
         in the same totals — it is a sale either way — but whoever reconciles a
         bank statement needs to know which part of it never went near a bank. */
      collectedAtGate: rupees(pay.counter_gross),
      collectedAtGateCount: n(pay.counter_payments),
      refunds: rupees(ref.amount),
      refundCount: n(ref.refunds),
      netRevenue: rupees(net),
      expenses: rupees(exp.amount),
      expenseCount: n(exp.expenses),
      takeHome: rupees(takeHome),
      /* Settlements are not fetched from Razorpay yet. */
      settlement: null,
    },
    gst: {
      basis: 'invoice date',
      rate: gstPercent,
      invoices: n(inv.invoices),
      testInvoices: n(inv.test_invoices),
      revenueExcludingGst: rupees(n(pay.service) - n(pay.gst)),
      taxableValue: rupees(inv.taxable),
      outputGst: rupees(inv.gst),
      cgst: rupees(Math.floor(n(inv.gst) / 2)),
      sgst: rupees(n(inv.gst) - Math.floor(n(inv.gst) / 2)),
      serviceInvoiceValue: rupees(inv.service),
      pureAgentEntry: rupees(inv.entry),
      totalInvoiceValue: rupees(inv.total),
      refundedGst: rupees(ref.gst),
      itc: {
        expenses: rupees(itcExpenses),
        expenseBills: n(exp.itc_bills),
        gatewayGst: rupees(itcGateway),
        includeGateway: includeGatewayItc,
        claimed: rupees(itcClaimed),
      },
      payable: rupees(gstPayable),
      excessItc: rupees(excessItc),
      paymentBasisGst: rupees(outputGst),
      paidWithoutInvoice: n(paidWithoutInvoice.c),
    },
    daily: daily.map((d) => ({
      day: asDate(d.day),
      gross: rupees(d.gross),
      service: rupees(d.service),
      gst: rupees(d.gst),
      gateway: rupees(d.gateway),
      net: rupees(n(d.service) - n(d.gst) - n(d.gateway)),
    })),
  };
}

/* ─────────────────────────────────────────────────── 8.3 and 8.5 ── */

const mask = (m) => (m ? `••••${String(m).slice(-4)}` : null);

/**
 * Invoices, searchable by anything a visitor might quote: mobile, vehicle,
 * pass number, invoice number, name or payment ID. One box; each term is tried
 * against every field it could be, so nobody has to say which it is.
 */
async function invoices({ q = null, from = null, to = null, status = null, limit = 25, offset = 0 } = {}) {
  const term = String(q || '').trim();
  const digits = term.replace(/\D/g, '');
  const plate = term.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const size = Math.max(1, Math.min(100, Number(limit) || 25));
  const skip = Math.max(0, Number(offset) || 0);

  const rows = await rowsOf(
    `SELECT i.id, i.invoice_no, i.issued_at, i.total_paise, i.gst_paise, i.service_paise, i.entry_paise, i.taxable_paise, i.is_test,
            t.id AS ticket_id, t.ticket_no, t.reg_no, t.mobile, t.travel_date, t.status AS ticket_status,
            cu.name AS customer_name, cu.wa_profile_name,
            p.payment_id, p.order_id, p.refunded_at, p.refunded_paise, p.status AS payment_status,
            c.label AS vehicle_type,
            count(*) OVER () AS total_rows
       FROM invoices i
       JOIN tickets t ON t.id = i.ticket_id
       LEFT JOIN customers cu ON cu.id = t.customer_id
       LEFT JOIN payments p ON p.id = t.payment_id
       LEFT JOIN vehicle_categories c ON c.id = t.category_id
      WHERE ($1::date IS NULL OR ${IST_DAY('i.issued_at')} >= $1::date)
        AND ($2::date IS NULL OR ${IST_DAY('i.issued_at')} <= $2::date)
        AND ($3::text IS NULL
             OR i.invoice_no ILIKE '%' || $3 || '%'
             OR t.reg_no = $4
             OR t.ticket_no = ANY($5::text[])
             OR ($6::text IS NOT NULL AND t.mobile LIKE '%' || $6)
             OR p.payment_id = $3 OR p.order_id = $3
             OR cu.name ILIKE '%' || $3 || '%'
             OR cu.wa_profile_name ILIKE '%' || $3 || '%')
        AND ($7::text IS NULL
             OR ($7 = 'refunded' AND p.status = 'refunded')
             OR ($7 = 'partial_refund' AND p.status = 'paid' AND p.refunded_paise > 0)
             OR ($7 = 'paid' AND p.status = 'paid' AND p.refunded_paise = 0))
      ORDER BY i.issued_at DESC, i.id DESC
      LIMIT $8 OFFSET $9`,
    [DATE.test(String(from || '')) ? from : null, DATE.test(String(to || '')) ? to : null,
      term || null, plate || null, booking.passNumberCandidates(term), digits.length >= 4 ? digits : null,
      ['paid', 'refunded', 'partial_refund'].includes(status) ? status : null, size, skip]);

  return {
    total: rows.length ? n(rows[0].total_rows) : 0,
    limit: size,
    offset: skip,
    invoices: rows.map((r) => ({
      id: String(r.id),
      invoiceNo: r.invoice_no,
      issuedAt: r.issued_at,
      visitor: r.customer_name || r.wa_profile_name || null,
      mobile: mask(r.mobile),
      regNo: r.reg_no,
      vehicleType: r.vehicle_type,
      ticketNo: r.ticket_no,
      travelDate: asDate(r.travel_date),
      amount: rupees(r.total_paise),
      serviceFee: rupees(r.service_paise),
      taxable: rupees(r.taxable_paise),
      gst: rupees(r.gst_paise),
      entry: rupees(r.entry_paise),
      paymentId: r.payment_id,
      status: r.payment_status === 'refunded' ? 'refunded' : n(r.refunded_paise) > 0 ? 'partial_refund' : 'paid',
      refunded: rupees(r.refunded_paise),
      test: r.is_test,
    })),
  };
}

/** One invoice and the pass behind it, for the invoice view and its PDF. */
async function invoice(id) {
  if (!/^\d+$/.test(String(id))) return null;
  const inv = await one('SELECT * FROM invoices WHERE id = $1', [id]);
  if (!inv) return null;
  const t = await booking.byId(inv.ticket_id);
  return { inv, t };
}

/* ───────────────────────────────────────────────────────── expenses ── */

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

async function expenses({ from, to }) {
  const rows = await rowsOf(
    `SELECT e.*, u.name AS created_by_name
       FROM finance_expenses e LEFT JOIN admin_users u ON u.id = e.created_by
      WHERE e.removed_at IS NULL AND e.spent_on BETWEEN $1::date AND $2::date
      ORDER BY e.spent_on DESC, e.id DESC`, [from, to]);
  let categories = [];
  try { categories = JSON.parse(await settings.str('expense_categories', '[]')); } catch { categories = []; }
  return {
    categories,
    expenses: rows.map((e) => ({
      id: String(e.id), spentOn: asDate(e.spent_on), category: e.category, vendor: e.vendor, vendorGstin: e.vendor_gstin,
      billRef: e.bill_ref, description: e.description, amount: rupees(e.amount_paise), gst: rupees(e.gst_paise),
      itcEligible: e.itc_eligible, createdBy: e.created_by_name, createdAt: e.created_at,
    })),
  };
}

const toPaise = (v, label, { min = 0 } = {}) => {
  const x = Number(v);
  if (!Number.isFinite(x) || x < min || x > 10000000) refuse(`${label} must be an amount in rupees.`);
  return Math.round(x * 100);
};

async function addExpense({ body, adminId }) {
  const today = slotTime.nowIST().date;
  const spentOn = String(body.spentOn || '');
  if (!DATE.test(spentOn) || spentOn > today) refuse('Choose the bill date — today or earlier.');
  const category = String(body.category || '').trim();
  if (!category) refuse('Choose a category.');
  const amount = toPaise(body.amount, 'The bill total', { min: 0.01 });
  const gst = body.gst === '' || body.gst === undefined ? 0 : toPaise(body.gst, 'The GST on the bill');
  if (gst > amount) refuse('The GST cannot be more than the bill total.');
  const vendorGstin = String(body.vendorGstin || '').trim().toUpperCase() || null;
  if (vendorGstin && !GSTIN.test(vendorGstin)) refuse('The vendor GSTIN is not valid.');
  const itc = body.itcEligible === true;
  if (itc && !gst) refuse('Input tax credit needs the GST amount on the bill.');
  if (itc && (!vendorGstin || !String(body.billRef || '').trim())) {
    refuse('Input tax credit needs the vendor’s GSTIN and the bill number — without them it cannot be claimed.');
  }

  const row = await one(
    `INSERT INTO finance_expenses (spent_on, category, vendor, vendor_gstin, bill_ref, description, amount_paise, gst_paise, itc_eligible, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [spentOn, category, String(body.vendor || '').trim() || null, vendorGstin, String(body.billRef || '').trim() || null,
      String(body.description || '').trim().slice(0, 500) || null, amount, gst, itc, adminId]);

  const after = { spentOn, category, vendor: row.vendor, billRef: row.bill_ref, amount: rupees(amount), gst: rupees(gst), itcEligible: itc };
  return { expense: { id: String(row.id), ...after }, audit: { subject: `expense:${row.id}`, before: null, after } };
}

async function removeExpense({ id, reason, adminId }) {
  const why = String(reason || '').trim();
  if (why.length < 5) refuse('Give a reason for removing this expense — it is recorded in the audit log.', { code: 'reason_required' });
  const e = await one('SELECT * FROM finance_expenses WHERE id = $1 AND removed_at IS NULL', [id]);
  if (!e) refuse('No such expense.', { status: 404, code: 'not_found' });
  await query('UPDATE finance_expenses SET removed_at = now(), removed_by = $2, remove_reason = $3 WHERE id = $1', [id, adminId, why]);
  return {
    reason: why,
    audit: { subject: `expense:${id}`, after: null,
      before: { spentOn: asDate(e.spent_on), category: e.category, vendor: e.vendor, amount: rupees(e.amount_paise), gst: rupees(e.gst_paise), itcEligible: e.itc_eligible } },
  };
}

async function setGatewayItc({ include, reason }) {
  const why = String(reason || '').trim();
  if (why.length < 5) refuse('Give a reason for this change — it is recorded in the audit log.', { code: 'reason_required' });
  const before = String(await settings.str('itc_include_gateway_gst', 'false')) === 'true';
  if (before === include) refuse('Nothing has changed.', { code: 'no_change' });
  await query(
    `INSERT INTO app_settings (key, value, note) VALUES ('itc_include_gateway_gst', $1, 'Count GST inside payment gateway charges as input tax credit')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, modified_at = now()`, [String(include)]);
  settings.clear();
  return { reason: why, audit: { subject: 'settings:itc_include_gateway_gst', before: { includeGatewayGst: before }, after: { includeGatewayGst: include } } };
}

module.exports = { Refusal, PRESETS, FEE_REFUNDED, GST_REFUNDED, ENTRY_REFUNDED, IST_DAY, periodFor, summary, invoices, invoice, expenses, addExpense, removeExpense, setGatewayItc };
