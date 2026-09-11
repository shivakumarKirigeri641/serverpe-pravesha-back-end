/**
 * adminPayments.js — Payments & Settlements: every payment attempt, and where
 * the money went after it.
 *
 * A payment row moves through created → paid (or failed), and a paid payment
 * may later be refunded in part or in full. After that, two settlements:
 *
 *   gateway     Razorpay pays Pravesha's bank, less its fee. Settled when the
 *               settlement id and UTR from Razorpay's report are recorded.
 *   department  Pravesha remits the entry fees to the Tourism Department in
 *               batches. Remitted when a recorded remittance covers the payment
 *               date.
 *
 * "Pending" is a checkout that was opened and not completed. Nothing here
 * changes a payment: refunds are made in Razorpay, and settlements come from
 * its report. Only remittances to the Department are recorded here.
 */

const { query, one } = require('./db');
const slotTime = require('./slotTime');
const booking = require('./booking');
const finance = require('./adminFinance');

const n = (v) => Number(v || 0);
const rupees = (paise) => Math.round(n(paise)) / 100;
const rowsOf = async (text, params) => (await query(text, params)).rows;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : (d ? String(d).slice(0, 10) : null));
const mask = (m) => (m ? `••••${String(m).slice(-4)}` : null);
const { FEE_REFUNDED, GST_REFUNDED, ENTRY_REFUNDED, IST_DAY } = finance;

class Refusal extends Error {
  constructor(message, { status = 400, code = 'invalid' } = {}) { super(message); this.status = status; this.code = code; }
}
const refuse = (message, opts) => { throw new Refusal(message, opts); };

/*
 * The moment that places a payment in a period: when it was paid, or — for a
 * checkout that never completed — when it was opened.
 */
const WHEN = 'COALESCE(p.paid_at, p.created_at)';

const STATE = `CASE
  WHEN p.status = 'refunded' THEN 'refunded'
  WHEN p.status = 'paid' AND p.refunded_paise > 0 THEN 'partial_refund'
  WHEN p.status = 'paid' THEN 'successful'
  WHEN p.status = 'failed' THEN 'failed'
  ELSE 'pending' END`;

const TICKET = `COALESCE(
  (SELECT t.id FROM tickets t WHERE t.payment_id = p.id LIMIT 1),
  CASE WHEN p.raw ? 'ticket_id' THEN (p.raw->>'ticket_id')::bigint END)`;

const REMITTED = `(SELECT r.id FROM department_remittances r
                    WHERE ${IST_DAY('p.paid_at')} BETWEEN r.covers_from AND r.covers_to
                    ORDER BY r.remitted_on LIMIT 1)`;

/* ────────────────────────────────────────────────────────── overview ── */

async function overview(period) {
  const { from, to } = period;
  const [s] = await rowsOf(
    `SELECT count(*) FILTER (WHERE p.status IN ('paid','refunded'))                         AS successful,
            COALESCE(sum(p.amount_paise) FILTER (WHERE p.status IN ('paid','refunded')), 0) AS successful_paise,
            count(*) FILTER (WHERE p.status = 'failed')                                    AS failed,
            COALESCE(sum(p.amount_paise) FILTER (WHERE p.status = 'failed'), 0)            AS failed_paise,
            count(*) FILTER (WHERE p.status = 'created')                                   AS pending,
            COALESCE(sum(p.amount_paise) FILTER (WHERE p.status = 'created'), 0)           AS pending_paise,
            count(*) FILTER (WHERE p.status = 'refunded')                                  AS refunded,
            COALESCE(sum(p.refunded_paise) FILTER (WHERE p.status = 'refunded'), 0)        AS refunded_paise,
            count(*) FILTER (WHERE p.status = 'paid' AND p.refunded_paise > 0)             AS partial,
            COALESCE(sum(p.refunded_paise) FILTER (WHERE p.status = 'paid' AND p.refunded_paise > 0), 0) AS partial_paise,

            COALESCE(sum(p.entry_paise) FILTER (WHERE p.status IN ('paid','refunded')), 0)    AS entry,
            COALESCE(sum(p.platform_paise) FILTER (WHERE p.status IN ('paid','refunded')), 0) AS fee,
            COALESCE(sum(p.gst_paise) FILTER (WHERE p.status IN ('paid','refunded')), 0)      AS gst,
            COALESCE(sum((p.raw->'gateway'->>'fee')::bigint) FILTER (WHERE p.status IN ('paid','refunded')), 0) AS gateway,
            COALESCE(sum(${ENTRY_REFUNDED.replace(/(entry_paise|refunded_paise)/g, 'p.$1')}) FILTER (WHERE p.status IN ('paid','refunded')), 0) AS entry_refunded,
            COALESCE(sum(${FEE_REFUNDED.replace(/(platform_paise|refunded_paise|entry_paise)/g, 'p.$1')}) FILTER (WHERE p.status IN ('paid','refunded')), 0) AS fee_refunded,
            COALESCE(sum(${GST_REFUNDED.replace(/(platform_paise|refunded_paise|entry_paise|gst_paise)/g, 'p.$1')}) FILTER (WHERE p.status IN ('paid','refunded')), 0) AS gst_refunded,

            count(*) FILTER (WHERE p.status IN ('paid','refunded') AND p.settled_at IS NOT NULL) AS settled,
            COALESCE(sum(p.amount_paise - COALESCE((p.raw->'gateway'->>'fee')::bigint, 0)) FILTER (WHERE p.status IN ('paid','refunded') AND p.settled_at IS NOT NULL), 0) AS settled_paise,
            count(*) FILTER (WHERE p.status IN ('paid','refunded') AND p.settled_at IS NULL) AS unsettled,
            COALESCE(sum(p.amount_paise - COALESCE((p.raw->'gateway'->>'fee')::bigint, 0)) FILTER (WHERE p.status IN ('paid','refunded') AND p.settled_at IS NULL), 0) AS unsettled_paise,

            COALESCE(sum(p.entry_paise - ${ENTRY_REFUNDED.replace(/(entry_paise|refunded_paise)/g, 'p.$1')}) FILTER (WHERE p.status IN ('paid','refunded') AND ${REMITTED} IS NOT NULL), 0) AS remitted_paise,
            COALESCE(sum(p.entry_paise - ${ENTRY_REFUNDED.replace(/(entry_paise|refunded_paise)/g, 'p.$1')}) FILTER (WHERE p.status IN ('paid','refunded') AND ${REMITTED} IS NULL), 0) AS remit_due_paise
       FROM payments p
      WHERE ${IST_DAY(WHEN)} BETWEEN $1::date AND $2::date`, [from, to]);

  const reasons = await rowsOf(
    `SELECT COALESCE(p.raw->>'failed_reason', p.raw->'gateway'->>'error_description', 'Not given') AS reason, count(*) AS c
       FROM payments p WHERE p.status = 'failed' AND ${IST_DAY('p.created_at')} BETWEEN $1::date AND $2::date
      GROUP BY 1 ORDER BY c DESC LIMIT 5`, [from, to]);

  const daily = await rowsOf(
    `SELECT d::date AS day,
            count(p.id) FILTER (WHERE p.status IN ('paid','refunded')) AS successful,
            count(p.id) FILTER (WHERE p.status = 'failed') AS failed,
            count(p.id) FILTER (WHERE p.status = 'created') AS pending
       FROM generate_series($1::date, $2::date, '1 day') d
       LEFT JOIN payments p ON ${IST_DAY(WHEN)} = d::date
      GROUP BY d ORDER BY d`, [from, to]);

  const attempts = n(s.successful) + n(s.failed);
  const netFee = n(s.fee) - n(s.fee_refunded);
  const netGst = n(s.gst) - n(s.gst_refunded);

  return {
    period,
    counts: {
      successful: { count: n(s.successful), amount: rupees(s.successful_paise) },
      failed: { count: n(s.failed), amount: rupees(s.failed_paise) },
      pending: { count: n(s.pending), amount: rupees(s.pending_paise) },
      refunded: { count: n(s.refunded), amount: rupees(s.refunded_paise) },
      partial: { count: n(s.partial), amount: rupees(s.partial_paise) },
      successRate: attempts ? Math.round((n(s.successful) / attempts) * 1000) / 10 : null,
    },
    split: {
      visitorPaid: rupees(s.successful_paise),
      refunded: rupees(n(s.refunded_paise) + n(s.partial_paise)),
      department: rupees(n(s.entry) - n(s.entry_refunded)),
      pravesha: rupees(netFee),
      gst: rupees(netGst),
      gateway: rupees(s.gateway),
      net: rupees(netFee - netGst - n(s.gateway)),
    },
    settlement: {
      gateway: { settled: n(s.settled), settledAmount: rupees(s.settled_paise), pending: n(s.unsettled), pendingAmount: rupees(s.unsettled_paise) },
      department: { remitted: rupees(s.remitted_paise), due: rupees(s.remit_due_paise) },
    },
    failureReasons: reasons.map((r) => ({ reason: r.reason, count: n(r.c) })),
    daily: daily.map((d) => ({ day: asDate(d.day), successful: n(d.successful), failed: n(d.failed), pending: n(d.pending) })),
  };
}

/* ──────────────────────────────────────────────────────────── list ── */

const STATES = ['successful', 'failed', 'pending', 'refunded', 'partial_refund'];

async function list({ q = null, state = null, from = null, to = null, limit = 25, offset = 0 } = {}) {
  const term = String(q || '').trim();
  const digits = term.replace(/\D/g, '');
  const plate = term.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const size = Math.max(1, Math.min(100, Number(limit) || 25));
  const skip = Math.max(0, Number(offset) || 0);

  const rows = await rowsOf(
    `WITH base AS (
       SELECT p.*, ${STATE} AS state, ${TICKET} AS ticket_ref
         FROM payments p
        WHERE ($1::date IS NULL OR ${IST_DAY(WHEN)} >= $1::date)
          AND ($2::date IS NULL OR ${IST_DAY(WHEN)} <= $2::date)
     )
     SELECT b.id, b.state, b.status, b.amount_paise, b.entry_paise, b.platform_paise, b.gst_paise, b.refunded_paise,
            b.payment_id, b.order_id, b.refund_id, b.created_at, b.paid_at, b.refunded_at, b.settled_at, b.settlement_utr, b.is_test,
            (b.raw->'gateway'->>'fee')::bigint AS gateway_fee,
            t.ticket_no, t.reg_no, t.mobile, cu.name AS visitor,
            r.reference AS remittance_ref, r.remitted_on,
            count(*) OVER () AS total_rows
       FROM base b
       LEFT JOIN tickets t ON t.id = b.ticket_ref
       LEFT JOIN customers cu ON cu.id = b.customer_id
       LEFT JOIN LATERAL (SELECT reference, remitted_on FROM department_remittances r
                           WHERE b.paid_at IS NOT NULL AND ${IST_DAY('b.paid_at')} BETWEEN r.covers_from AND r.covers_to
                           ORDER BY r.remitted_on LIMIT 1) r ON true
      WHERE ($3::text IS NULL OR b.state = $3)
        AND ($4::text IS NULL
             OR b.payment_id = $4 OR b.order_id = $4 OR b.refund_id = $4
             OR t.ticket_no = ANY($5::text[]) OR t.reg_no = $6
             OR ($7::text IS NOT NULL AND (t.mobile LIKE '%' || $7 OR cu.mobile LIKE '%' || $7))
             OR cu.name ILIKE '%' || $4 || '%')
      ORDER BY COALESCE(b.paid_at, b.created_at) DESC, b.id DESC
      LIMIT $8 OFFSET $9`,
    [DATE.test(String(from || '')) ? from : null, DATE.test(String(to || '')) ? to : null,
      STATES.includes(state) ? state : null, term || null, booking.passNumberCandidates(term), plate || null,
      digits.length >= 4 ? digits : null, size, skip]);

  return {
    total: rows.length ? n(rows[0].total_rows) : 0,
    limit: size,
    offset: skip,
    payments: rows.map(shape),
  };
}

function shape(r) {
  const paid = r.status === 'paid' || r.status === 'refunded';
  const fee = n(r.gateway_fee);
  return {
    id: String(r.id),
    state: r.state,
    paymentId: r.payment_id,
    orderId: r.order_id,
    ticketNo: r.ticket_no || null,
    regNo: r.reg_no || null,
    visitor: r.visitor || null,
    mobile: mask(r.mobile),
    at: r.paid_at || r.created_at,
    amount: rupees(r.amount_paise),
    department: rupees(r.entry_paise),
    fee: rupees(r.platform_paise),
    gst: rupees(r.gst_paise),
    gatewayFee: r.gateway_fee === null || r.gateway_fee === undefined ? null : rupees(fee),
    refunded: rupees(r.refunded_paise),
    refundId: r.refund_id,
    gatewaySettlement: !paid ? null : r.settled_at ? { status: 'settled', at: r.settled_at, utr: r.settlement_utr } : { status: 'pending' },
    departmentSettlement: !paid ? null : r.remittance_ref ? { status: 'remitted', on: asDate(r.remitted_on), reference: r.remittance_ref } : { status: 'due' },
    test: r.is_test,
  };
}

/* ─────────────────────────────────────────────────────────── detail ── */

async function detail(id) {
  if (!/^\d+$/.test(String(id))) return null;
  const p = await one(
    `SELECT p.*, ${STATE} AS state, ${TICKET} AS ticket_ref, cu.name AS visitor, cu.mobile AS customer_mobile
       FROM payments p LEFT JOIN customers cu ON cu.id = p.customer_id WHERE p.id = $1`, [id]);
  if (!p) return null;
  const t = p.ticket_ref ? await booking.byId(p.ticket_ref) : null;
  const remittance = p.paid_at ? await one(
    `SELECT * FROM department_remittances WHERE $1::date BETWEEN covers_from AND covers_to ORDER BY remitted_on LIMIT 1`,
    [slotTime.nowIST(p.paid_at).date]) : null;
  const inv = t ? await one('SELECT invoice_no, issued_at FROM invoices WHERE ticket_id = $1', [t.id]) : null;

  const entryRefunded = Math.min(n(p.entry_paise), n(p.refunded_paise));
  const feeRefunded = Math.min(n(p.platform_paise), Math.max(0, n(p.refunded_paise) - n(p.entry_paise)));
  const gstRefunded = n(p.platform_paise) ? Math.round((n(p.gst_paise) * feeRefunded) / n(p.platform_paise)) : 0;
  const gateway = p.raw?.gateway?.fee !== undefined ? n(p.raw.gateway.fee) : null;
  const gatewayTax = p.raw?.gateway?.tax !== undefined ? n(p.raw.gateway.tax) : null;
  const fee = n(p.platform_paise) - feeRefunded;
  const gst = n(p.gst_paise) - gstRefunded;
  const paid = p.status === 'paid' || p.status === 'refunded';

  const timeline = [
    { at: p.created_at, what: 'Checkout opened', detail: p.order_id ? `Order ${p.order_id}` : null },
    p.paid_at && { at: p.paid_at, what: 'Payment received', detail: [p.payment_id, p.raw?.gateway?.method].filter(Boolean).join(' · ') || null },
    p.status === 'failed' && { at: p.created_at, what: 'Payment failed', detail: p.raw?.failed_reason || p.raw?.gateway?.error_description || null },
    inv && { at: inv.issued_at, what: 'Tax invoice issued', detail: inv.invoice_no },
    p.refunded_at && { at: p.refunded_at, what: p.status === 'refunded' ? 'Refunded in full' : 'Partly refunded', detail: [`₹${rupees(p.refunded_paise)}`, p.refund_id, p.refund_reason].filter(Boolean).join(' · ') },
    p.settled_at && { at: p.settled_at, what: 'Settled to Pravesha’s bank', detail: [p.settlement_id, p.settlement_utr && `UTR ${p.settlement_utr}`].filter(Boolean).join(' · ') },
    remittance && { at: remittance.remitted_on, what: 'Entry fee remitted to the Department', detail: `${remittance.reference} · covers ${asDate(remittance.covers_from)} to ${asDate(remittance.covers_to)}` },
  ].filter(Boolean).sort((a, b) => new Date(a.at) - new Date(b.at));

  return {
    payment: {
      id: String(p.id), state: p.state, paymentId: p.payment_id, orderId: p.order_id, refundId: p.refund_id,
      method: p.raw?.gateway?.method || null, visitor: p.visitor, mobile: mask(p.customer_mobile), test: p.is_test,
      createdAt: p.created_at, paidAt: p.paid_at,
    },
    ticket: t ? {
      ticketNo: t.ticket_no, regNo: t.reg_no, place: t.place_name, slot: t.slot_label, travelDate: asDate(t.travel_date),
      vehicleType: t.category_label, status: t.status, invoiceNo: inv?.invoice_no || null,
    } : null,
    split: {
      visitorPaid: rupees(p.amount_paise),
      refunded: rupees(p.refunded_paise),
      department: rupees(n(p.entry_paise) - entryRefunded),
      pravesha: rupees(fee),
      gst: rupees(gst),
      gateway: gateway === null ? null : rupees(gateway),
      gatewayTax: gatewayTax === null ? null : rupees(gatewayTax),
      net: rupees(fee - gst - (gateway || 0)),
      counted: paid,
    },
    settlement: {
      gateway: !paid ? null : p.settled_at ? { status: 'settled', at: p.settled_at, id: p.settlement_id, utr: p.settlement_utr, amount: rupees(n(p.amount_paise) - (gateway || 0)) } : { status: 'pending' },
      department: !paid ? null : remittance ? { status: 'remitted', on: asDate(remittance.remitted_on), reference: remittance.reference } : { status: 'due', amount: rupees(n(p.entry_paise) - entryRefunded) },
    },
    timeline,
  };
}

/* ────────────────────────────────────────────────────── remittances ── */

async function remittances() {
  const rows = await rowsOf(
    `SELECT r.*, u.name AS created_by_name FROM department_remittances r
       LEFT JOIN admin_users u ON u.id = r.created_by ORDER BY r.covers_to DESC LIMIT 30`);
  const [last] = await rowsOf('SELECT max(covers_to) AS d FROM department_remittances');
  const since = last?.d ? asDate(last.d) : null;
  const [due] = await rowsOf(
    `SELECT COALESCE(sum(p.entry_paise - LEAST(p.entry_paise, p.refunded_paise)), 0) AS due,
            min(${IST_DAY('p.paid_at')}) AS first_day, max(${IST_DAY('p.paid_at')}) AS last_day
       FROM payments p
      WHERE p.status IN ('paid','refunded') AND p.paid_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM department_remittances r WHERE ${IST_DAY('p.paid_at')} BETWEEN r.covers_from AND r.covers_to)`);
  return {
    remittances: rows.map((r) => ({
      id: String(r.id), coversFrom: asDate(r.covers_from), coversTo: asDate(r.covers_to), amount: rupees(r.amount_paise),
      reference: r.reference, remittedOn: asDate(r.remitted_on), note: r.note, createdBy: r.created_by_name, test: r.is_test,
    })),
    outstanding: { amount: rupees(due.due), from: asDate(due.first_day), to: asDate(due.last_day), lastCovered: since },
  };
}

/** What a remittance for a date range should be: entry fees net of refunds, not already remitted. */
async function remittanceDue(from, to) {
  const [r] = await rowsOf(
    `SELECT COALESCE(sum(p.entry_paise - LEAST(p.entry_paise, p.refunded_paise)), 0) AS due, count(*) AS payments
       FROM payments p
      WHERE p.status IN ('paid','refunded') AND p.paid_at IS NOT NULL AND ${IST_DAY('p.paid_at')} BETWEEN $1::date AND $2::date`, [from, to]);
  return { amount: rupees(r.due), payments: n(r.payments) };
}

async function addRemittance({ body, adminId }) {
  const today = slotTime.nowIST().date;
  const { coversFrom, coversTo, remittedOn } = body;
  if (![coversFrom, coversTo, remittedOn].every((d) => DATE.test(String(d || '')))) refuse('Give the dates the remittance covers and the date it was paid.');
  if (coversFrom > coversTo) refuse('The period must start before it ends.');
  if (coversTo > today || remittedOn > today) refuse('Dates cannot be in the future.');
  if (remittedOn < coversFrom) refuse('A remittance cannot be paid before the period it covers begins.');
  const reference = String(body.reference || '').trim();
  if (reference.length < 4) refuse('Enter the bank reference (UTR or NEFT/RTGS number).');
  const overlap = await one(
    `SELECT reference, covers_from, covers_to FROM department_remittances WHERE covers_from <= $2::date AND covers_to >= $1::date LIMIT 1`,
    [coversFrom, coversTo]);
  if (overlap) refuse(`These dates overlap remittance ${overlap.reference} (${asDate(overlap.covers_from)} to ${asDate(overlap.covers_to)}).`, { status: 409, code: 'overlap' });

  const due = await remittanceDue(coversFrom, coversTo);
  const amount = Math.round(Number(body.amount) * 100);
  if (!Number.isFinite(amount) || amount <= 0) refuse('Enter the amount remitted.');
  const note = String(body.note || '').trim().slice(0, 500) || null;
  if (Math.abs(amount - Math.round(due.amount * 100)) > 100 && !note) {
    refuse(`The entry fees due for these dates are ₹${due.amount.toLocaleString('en-IN')}. Explain the difference in the note.`, { code: 'amount_mismatch' });
  }

  const row = await one(
    `INSERT INTO department_remittances (covers_from, covers_to, amount_paise, reference, remitted_on, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [coversFrom, coversTo, amount, reference, remittedOn, note, adminId]);
  const after = { coversFrom, coversTo, amount: amount / 100, due: due.amount, reference, remittedOn, note };
  return { remittance: { id: String(row.id), ...after }, audit: { subject: `remittance:${row.id}`, before: null, after }, reason: note };
}

module.exports = { Refusal, overview, list, detail, remittances, remittanceDue, addRemittance };
