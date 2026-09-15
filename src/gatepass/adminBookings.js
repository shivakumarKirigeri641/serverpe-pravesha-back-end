/**
 * adminBookings.js — Ticket Management: find any pass, see all of it, and the
 * few things an administrator may do to one.
 *
 * ONE STATE, DERIVED. A pass has a stored status (held, paid, used, expired,
 * cancelled), but the question people actually ask is different: is it waiting
 * to be paid, is it coming today, did they turn up, did they skip it, was the
 * money returned? That state is worked out here from the status, the travel
 * date and the payment — in SQL, so a search can filter on it — and every
 * screen uses the same words for it.
 *
 * CONTROL IS DELIBERATELY SMALL. A pass can be cancelled (with a reason, which
 * gives the place back to the next visitor) and it can be sent to the visitor
 * again. Everything else about a pass — its price, its slot, its vehicle — is
 * what the visitor bought and is not editable: a changed pass at the gate is a
 * pass nobody can trust. Money is not moved here either; a refund is made in
 * Razorpay and appears under Payments & Settlements.
 */

const { query, one, tx } = require('./db');
const slotTime = require('./slotTime');
const booking = require('./booking');
const inventory = require('./inventory');

const n = (v) => Number(v || 0);
const rupees = (paise) => Math.round(n(paise)) / 100;
const rowsOf = async (text, params) => (await query(text, params)).rows;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : (d ? String(d).slice(0, 10) : null));
const mask = (m) => (m ? `••••${String(m).slice(-4)}` : null);

class Refusal extends Error {
  constructor(message, { status = 400, code = 'invalid' } = {}) { super(message); this.status = status; this.code = code; }
}
const refuse = (message, opts) => { throw new Refusal(message, opts); };

/* The states, in the order a pass moves through them. */
const STATES = [
  { key: 'booked', label: 'Booked', hint: 'Payment not completed yet' },
  { key: 'upcoming', label: 'Paid — upcoming', hint: 'Paid, for a later date' },
  { key: 'yet_to_arrive', label: 'Yet to arrive', hint: 'For today, not entered yet' },
  { key: 'entered', label: 'Entered', hint: 'Used at the gate' },
  { key: 'skipped', label: 'Skipped', hint: 'Paid, date passed, never entered' },
  { key: 'cancelled', label: 'Cancelled', hint: 'Cancelled from the panel' },
  { key: 'expired', label: 'Expired', hint: 'Booking abandoned before payment' },
  { key: 'refunded', label: 'Refunded', hint: 'Money returned in full' },
];

/* Refunded comes before cancelled: a pass that was cancelled and refunded is
   asked about as "the one we gave the money back for". */
const STATE_SQL = `CASE
  WHEN t.status = 'held'      THEN 'booked'
  WHEN t.status = 'expired'   THEN 'expired'
  WHEN pay.status = 'refunded' THEN 'refunded'
  WHEN t.status = 'cancelled' THEN 'cancelled'
  WHEN t.status = 'used'      THEN 'entered'
  WHEN t.travel_date > $1::date THEN 'upcoming'
  WHEN t.travel_date = $1::date THEN 'yet_to_arrive'
  ELSE 'skipped' END`;

/**
 * Search. One box for everything a person might quote — pass number, mobile,
 * vehicle, visitor name, reference or payment id — with the date, state and
 * destination as separate filters.
 */
async function search({ q = null, state = null, from = null, to = null, placeId = null, limit = 25, offset = 0 } = {}) {
  const today = slotTime.nowIST().date;
  const term = String(q || '').trim();
  const digits = term.replace(/\D/g, '');
  const plate = term.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const size = Math.max(1, Math.min(100, Number(limit) || 25));
  const skip = Math.max(0, Number(offset) || 0);

  const rows = await rowsOf(
    `SELECT t.id, t.ticket_no, t.reference_id, t.reg_no, t.mobile, t.travel_date, t.status, t.total_paise, t.used_at, t.created_at,
            ${STATE_SQL} AS state,
            pl.name AS place, regexp_replace(s.label, '[[:space:]]+', ' ', 'g') AS slot, c.label AS vehicle_type,
            cu.name AS visitor, cu.wa_profile_name,
            pay.status AS payment_status, pay.refunded_paise, pay.payment_id, pay.paid_at,
            i.invoice_no, g.kind AS grant_kind,
            (SELECT max(sc.scanned_at) FROM scans sc WHERE sc.ticket_id = t.id AND sc.verdict IN ('valid','valid_override')) AS entered_at,
            count(*) OVER () AS total_rows
       FROM tickets t
       JOIN places pl ON pl.id = t.place_id
       JOIN place_slots s ON s.id = t.slot_id
       JOIN vehicle_categories c ON c.id = t.category_id
       LEFT JOIN customers cu ON cu.id = t.customer_id
       LEFT JOIN payments pay ON pay.id = t.payment_id
       LEFT JOIN invoices i ON i.ticket_id = t.id
       LEFT JOIN ticket_grants g ON g.ticket_id = t.id
      WHERE ($2::date IS NULL OR t.travel_date >= $2::date)
        AND ($3::date IS NULL OR t.travel_date <= $3::date)
        AND ($4::bigint IS NULL OR t.place_id = $4)
        AND ($5::text IS NULL OR ${STATE_SQL} = $5)
        AND ($6::text IS NULL
             OR t.ticket_no = ANY($7::text[])
             OR t.reg_no = $8
             OR t.reference_id ILIKE $6 || '%'
             OR ($9::text IS NOT NULL AND t.mobile LIKE '%' || $9)
             OR cu.name ILIKE '%' || $6 || '%' OR cu.wa_profile_name ILIKE '%' || $6 || '%'
             OR pay.payment_id = $6 OR pay.order_id = $6 OR i.invoice_no ILIKE '%' || $6 || '%')
      ORDER BY t.travel_date DESC, t.created_at DESC
      LIMIT $10 OFFSET $11`,
    [today,
      DATE.test(String(from || '')) ? from : null,
      DATE.test(String(to || '')) ? to : null,
      /^\d+$/.test(String(placeId || '')) ? placeId : null,
      STATES.some((s) => s.key === state) ? state : null,
      term || null, booking.passNumberCandidates(term), plate || null,
      digits.length >= 4 ? digits : null, size, skip]);

  return {
    today,
    states: STATES,
    total: rows.length ? n(rows[0].total_rows) : 0,
    limit: size,
    offset: skip,
    tickets: rows.map((r) => ({
      id: String(r.id),
      ticketNo: r.ticket_no,
      state: r.state,
      status: r.status,
      partlyRefunded: n(r.refunded_paise) > 0 && r.payment_status !== 'refunded',
      visitor: r.visitor || r.wa_profile_name || null,
      mobile: mask(r.mobile),
      regNo: r.reg_no,
      vehicleType: r.vehicle_type,
      place: r.place,
      travelDate: asDate(r.travel_date),
      slot: r.slot,
      amount: rupees(r.total_paise),
      paid: Boolean(r.paid_at),
      enteredAt: r.entered_at || r.used_at,
      invoiceNo: r.invoice_no,
      issuedAs: r.grant_kind,
      bookedAt: r.created_at,
    })),
  };
}

/** Everything about one pass: the sale, the visit, the entry and the history. */
async function detail(id) {
  const today = slotTime.nowIST().date;
  const key = /^\d+$/.test(String(id)) ? { where: 't.id = $2', param: id } : { where: 't.ticket_no = ANY($2::text[])', param: booking.passNumberCandidates(id) };

  const t = await one(
    `SELECT t.*, ${STATE_SQL} AS state,
            pl.name AS place, pl.district, regexp_replace(s.label, '[[:space:]]+', ' ', 'g') AS slot, s.starts_at, s.ends_at,
            c.label AS vehicle_type, c.code AS vehicle_code,
            cu.id AS customer_id, cu.name AS visitor, cu.wa_profile_name, cu.language, cu.is_blocked,
            v.maker, v.model, v.fuel, v.colour, v.vehicle_class, v.reg_date,
            pay.id AS payment_row_id, pay.status AS payment_status, pay.payment_id, pay.order_id, pay.paid_at,
            pay.refunded_paise, pay.refunded_at, pay.refund_id, pay.refund_reason, pay.amount_paise, pay.raw AS payment_raw,
            i.invoice_no, i.issued_at AS invoice_at
       FROM tickets t
       JOIN places pl ON pl.id = t.place_id
       JOIN place_slots s ON s.id = t.slot_id
       JOIN vehicle_categories c ON c.id = t.category_id
       LEFT JOIN customers cu ON cu.id = t.customer_id
       LEFT JOIN vehicles v ON v.id = t.vehicle_id
       LEFT JOIN payments pay ON pay.id = t.payment_id
       LEFT JOIN invoices i ON i.ticket_id = t.id
      WHERE ${key.where}`, [today, key.param]);
  if (!t) return null;

  const scans = await rowsOf(
    `SELECT sc.verdict, sc.scanned_at, sc.duration_ms, st.name AS staff, cp.name AS checkpost
       FROM scans sc LEFT JOIN staff st ON st.id = sc.staff_id LEFT JOIN checkposts cp ON cp.id = sc.checkpost_id
      WHERE sc.ticket_id = $1 ORDER BY sc.scanned_at`, [t.id]);

  const grant = await one(
    `SELECT g.*, ap.name AS approved_by_name, iss.name AS issued_by_name FROM ticket_grants g
       LEFT JOIN admin_users ap ON ap.id = g.approved_by
       LEFT JOIN admin_users iss ON iss.id = g.issued_by
      WHERE g.ticket_id = $1`, [t.id]);

  const events = await rowsOf(
    `SELECT kind, detail, created_at FROM event_log
      WHERE customer_id = $1 AND detail->>'ticket_id' = $2::text ORDER BY created_at`, [t.customer_id, String(t.id)]);

  const audit = await rowsOf(
    `SELECT a.action, a.reason, a.created_at, u.name AS who FROM admin_audit a
       LEFT JOIN admin_users u ON u.id = a.admin_id
      WHERE a.subject IN ($1, $2) ORDER BY a.created_at`, [`ticket:${t.ticket_no}`, `ticket:${t.id}`]);

  const entered = scans.find((s) => s.verdict === 'valid' || s.verdict === 'valid_override');
  const refundedFull = t.payment_status === 'refunded';

  const timeline = [
    { at: t.created_at, what: grant ? `Pass issued from the panel (${grant.kind === 'free' ? 'free' : 'on-spot'})` : 'Pass booked', detail: t.reference_id },
    t.paid_at && { at: t.paid_at, what: grant?.kind === 'onspot' ? 'Paid at the counter' : 'Payment received', detail: [t.payment_id, grant?.payment_method].filter(Boolean).join(' · ') || null },
    t.invoice_at && { at: t.invoice_at, what: 'Tax invoice issued', detail: t.invoice_no },
    ...events.map((e) => ({ at: e.created_at, what: EVENTS[e.kind] || e.kind.replace(/_/g, ' '), detail: null })),
    ...scans.map((s) => ({
      at: s.scanned_at,
      what: VERDICTS[s.verdict] || s.verdict,
      detail: [s.checkpost, s.staff, s.duration_ms ? `${(s.duration_ms / 1000).toFixed(1)} sec` : null].filter(Boolean).join(' · ') || null,
    })),
    t.refunded_at && { at: t.refunded_at, what: refundedFull ? 'Refunded in full' : 'Partly refunded', detail: [`₹${rupees(t.refunded_paise)}`, t.refund_reason].filter(Boolean).join(' · ') },
    ...audit.map((a) => ({ at: a.created_at, what: `${AUDIT[a.action] || a.action.replace(/_/g, ' ')} by ${a.who || 'an administrator'}`, detail: a.reason })),
  ].filter(Boolean).sort((a, b) => new Date(a.at) - new Date(b.at));

  const state = STATES.find((s) => s.key === t.state);
  const timing = slotTime.check({ ends_at: t.ends_at, starts_at: t.starts_at }, asDate(t.travel_date));

  return {
    ticket: {
      id: String(t.id),
      ticketNo: t.ticket_no,
      reference: t.reference_id,
      state: t.state,
      stateLabel: state?.label || t.state,
      status: t.status,
      place: t.place,
      district: t.district,
      travelDate: asDate(t.travel_date),
      slot: t.slot,
      lastEntry: timing.lastEntry,
      bookedAt: t.created_at,
      issuedAs: grant ? grant.kind : 'whatsapp',
      cancellable: ['held', 'paid'].includes(t.status) && asDate(t.travel_date) >= today,
    },
    visitor: {
      id: t.customer_id ? String(t.customer_id) : null,
      name: t.visitor || t.wa_profile_name || null,
      mobile: mask(t.mobile),
      language: t.language,
      blocked: t.is_blocked,
    },
    vehicle: {
      regNo: t.reg_no,
      type: t.vehicle_type,
      maker: t.maker,
      model: t.model,
      fuel: t.fuel,
      colour: t.colour,
      vehicleClass: t.vehicle_class,
      registeredOn: asDate(t.reg_date),
    },
    payment: {
      id: t.payment_row_id ? String(t.payment_row_id) : null,
      status: t.payment_status || (grant?.kind === 'free' ? 'free' : null),
      method: grant?.payment_method || t.payment_raw?.gateway?.method || null,
      reference: grant?.payment_reference || null,
      paymentId: t.payment_id,
      orderId: t.order_id,
      paidAt: t.paid_at,
      amount: rupees(t.total_paise),
      entry: rupees(t.entry_paise),
      fee: rupees(t.platform_paise),
      gst: rupees(t.gst_paise),
      refunded: rupees(t.refunded_paise),
      refundedAt: t.refunded_at,
      refundId: t.refund_id,
      refundReason: t.refund_reason,
      invoiceNo: t.invoice_no,
    },
    grant: grant ? {
      kind: grant.kind, reasonCode: grant.reason_code, reason: grant.reason,
      approvedBy: grant.approved_by_name, issuedBy: grant.issued_by_name, at: grant.created_at,
    } : null,
    /* Photographs taken at the barrier: the UPI screen behind a counter payment,
       and the vehicle itself when it had no number plate to record. The panel is
       where somebody checking a payment or an unverified vehicle will look. */
    photos: await require('./photos').forTicket(t.id),
    entry: {
      status: entered
        ? (entered.verdict === 'valid_override' ? 'Admitted after a warning'
          : t.entry_source === 'self' ? 'Entered — recorded by the visitor' : 'Entered')
        : t.state === 'skipped' ? 'Never arrived' : 'Not yet',
      at: entered?.scanned_at || t.used_at || null,
      checkpost: entered?.checkpost || null,
      staff: entered?.staff || null,
      /*
       * Who says this vehicle came in.
       *
       * 'gate' is a staff member who looked at it. 'self' is the visitor, who
       * ticked "I am already at the checkpost" while paying and whose phone
       * agreed they were standing there — checked, but unwitnessed. The two are
       * not the same evidence, and anybody auditing a day's entries has to be
       * able to tell them apart without reading scan payloads.
       */
      source: t.entry_source || null,
      metresFromGate: t.self_checkin_m === null || t.self_checkin_m === undefined ? null : Number(t.self_checkin_m),
      attempts: scans.map((s) => ({ verdict: s.verdict, label: VERDICTS[s.verdict] || s.verdict, at: s.scanned_at, checkpost: s.checkpost, staff: s.staff })),
    },
    timeline,
  };
}

const VERDICTS = {
  valid: 'Entered at the gate',
  valid_override: 'Admitted anyway, after a warning',
  already_used: 'Refused — pass already used',
  not_paid: 'Refused — pass not paid for',
  wrong_day: 'Refused — pass is for another day',
  wrong_slot: 'Refused — outside the slot',
  unknown_ticket: 'Refused — no pass for that vehicle',
  cancelled: 'Refused — pass cancelled',
  blocked: 'Refused — vehicle not permitted',
};

const EVENTS = {
  pass_delivered: 'Pass sent on WhatsApp',
  pass_resent: 'Pass sent again on WhatsApp',
  invoice_failed: 'Invoice could not be issued',
  payment_unissued: 'Paid but the pass could not be issued',
};

const AUDIT = {
  ticket_cancelled: 'Cancelled',
  free_ticket_issued: 'Issued free',
  onspot_ticket_issued: 'Sold on the spot',
  pass_resent: 'Pass resent',
};

/**
 * Cancel a pass: it stops working at the gate and its place goes back to the
 * slot. The money is not touched — a refund is made in Razorpay and shows up
 * under Payments & Settlements.
 */
async function cancel({ id, reason, adminId }) {
  const why = String(reason || '').trim();
  if (why.length < 5) refuse('Give a reason for cancelling this pass — the visitor may ask, and it is recorded.', { code: 'reason_required' });
  const today = slotTime.nowIST().date;

  return tx(async (c) => {
    const t = (await c.query('SELECT * FROM tickets WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!t) refuse('No such pass.', { status: 404, code: 'not_found' });
    if (t.status === 'cancelled') refuse('This pass is already cancelled.', { status: 409, code: 'already' });
    if (t.status === 'used') refuse('This pass has already been used at the gate, so it cannot be cancelled.', { status: 409, code: 'used' });
    if (t.status === 'expired') refuse('This booking expired before it was paid; there is nothing to cancel.', { status: 409, code: 'expired' });
    if (asDate(t.travel_date) < today) refuse('The date of visit has passed, so this pass can no longer be cancelled.', { status: 409, code: 'past' });

    await c.query("UPDATE tickets SET status = 'cancelled', modified_at = now() WHERE id = $1", [t.id]);
    /* The place goes back: a paid pass held a booked seat, an unpaid one a hold. */
    /* As many places as the pass took: one for a vehicle, the people on a per-person pass (056). */
    const units = inventory.unitsOf(t);
    if (t.status === 'paid') {
      await c.query(
        `UPDATE slot_inventory SET booked = GREATEST(booked - $5, 0), modified_at = now()
          WHERE place_id = $1 AND slot_id = $2 AND category_id = $3 AND travel_date = $4`,
        [t.place_id, t.slot_id, t.category_id, t.travel_date, units]);
    } else {
      await inventory.release(c, { placeId: t.place_id, slotId: t.slot_id, categoryId: t.category_id, travelDate: t.travel_date, units });
    }

    const paid = t.status === 'paid';
    return {
      reason: why,
      cancelled: { ticketNo: t.ticket_no, placeReturned: true, refundNeeded: paid && n(t.total_paise) > 0 },
      audit: {
        subject: `ticket:${t.ticket_no}`,
        before: { status: t.status, travelDate: asDate(t.travel_date), amount: rupees(t.total_paise) },
        after: { status: 'cancelled' },
      },
    };
  });
}

module.exports = { Refusal, STATES, search, detail, cancel };
