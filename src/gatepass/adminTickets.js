/**
 * adminTickets.js — passes issued from the panel: free, and on the spot.
 *
 * Both are real passes, made the way a WhatsApp booking makes one: the vehicle's
 * type comes from its registration and the same eligibility rules, a place is
 * claimed against the same capacity, the pass number comes from the same daily
 * sequence, and one vehicle still gets one pass a day. What differs is recorded
 * beside the ticket in ticket_grants — why, who asked, who approved, how it was
 * paid — so a free pass is never mistaken for a sold one in a report, and an
 * on-spot sale is never mistaken for a free one.
 *
 * FREE PASSES need a written reason and an approving officer, always. The
 * database refuses a free grant without a reason, so no screen can skip it.
 *
 * ON-SPOT PASSES are for a visitor who arrives without booking. The money is
 * collected at the counter — cash, UPI or card — and recorded as a payment with
 * its reference, so it appears in collections and reports like any other.
 * Nothing here takes a card number or a UPI PIN.
 *
 * NEITHER SENDS A MESSAGE BY DEFAULT. A visitor at a gate may have no WhatsApp,
 * or a number outside the 24-hour window; the pass is shown and printed from the
 * panel, and sending it on WhatsApp is an explicit choice.
 */

const crypto = require('crypto');
const { query, one, tx } = require('./db');
const slotTime = require('./slotTime');
const settings = require('./settings');
const inventory = require('./inventory');
const pricing = require('./pricing');
const booking = require('./booking');
const passCodec = require('./passCodec');
const plateParser = require('../ulip/plate');

const rowsOf = async (text, params) => (await query(text, params)).rows;
const n = (v) => Number(v || 0);

class Refusal extends Error {
  constructor(message, { status = 400, code = 'invalid', detail = null } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}
const refuse = (message, opts) => { throw new Refusal(message, opts); };

const localMobile = (m) => String(m || '').replace(/\D/g, '').replace(/^(?:0|91)(\d{10})$/, '$1');

/**
 * The vehicle and what it is, by the booking's own rules.
 *
 * Uses the vehicle cache first, as a booking does; a plate never seen before is
 * looked up the same way a WhatsApp booking would look it up.
 */
/**
 * A vehicle type somebody has read off the vehicle, because the register could
 * not tell us.
 *
 * A temporary registration on a car bought last week, a dealer plate, or a
 * lookup that failed — none of them are reasons to turn a visitor away at the
 * barrier, but the price depends on what the vehicle is, so somebody has to
 * say. That somebody is named on the pass, and the vehicle is marked as
 * declared rather than verified, so no report ever confuses the two.
 */
/*
 * What may be written down against a vehicle the register cannot vouch for,
 * and how much of it is enough. The chassis number leads because it is stamped
 * on the vehicle, printed on the invoice and the temporary registration paper,
 * and stays with it for life — when a TR becomes a permanent number, the
 * chassis is what ties the two together.
 */
const IDENTITY = {
  chassis: { label: 'Chassis number', min: 6, hint: 'Last 6 characters are enough' },
  engine: { label: 'Engine number', min: 6, hint: 'From the invoice or the engine block' },
  tr_paper: { label: 'Temporary registration paper', min: 4, hint: 'The number on the TR paper' },
  invoice: { label: 'Invoice number', min: 4, hint: 'Dealer invoice for a new vehicle' },
  licence: { label: 'Driving licence', min: 6, hint: 'Identifies the driver, not the vehicle' },
  other: { label: 'Something else', min: 4, hint: 'Write what you can see' },
};

async function declaredVehicle({ regNo, typeCode, note, kind = 'chassis', noPlate = false }) {
  const cat = await one(`SELECT id, code, label FROM vehicle_categories WHERE code = $1 AND is_active`, [String(typeCode || '').toUpperCase()]);
  if (!cat) refuse('Choose what kind of vehicle it is.', { code: 'type_required' });

  /*
   * SOMETHING UNIQUE, ALWAYS. When the register cannot vouch for a vehicle,
   * the only record of what came through the gate is what the staff member
   * writes down — so it is mandatory, for a temporary registration as much as
   * for a vehicle with no plate at all. The visitor's mobile is taken too, on
   * every sale, which gives a second way back to whoever this was.
   */
  const identityKind = IDENTITY[kind] ? kind : 'other';
  const rule = IDENTITY[identityKind];
  const identity = String(note || '').trim().toUpperCase();
  if (identity.length < rule.min) {
    refuse(`This vehicle is not in the register, so it needs something unique written against it. ${rule.label}: ${rule.hint.toLowerCase()}.`,
      { code: 'identity_required' });
  }

  const shape = { kind: identityKind, label: rule.label, value: identity };

  /* A vehicle WITH a number is that number: the same plate is the same vehicle,
     and one pass per vehicle per day follows from it. */
  if (!noPlate) {
    const row = await one(
      `INSERT INTO vehicles (reg_no, vehicle_class, rc_status, identified_by, identity_kind, identity_note, is_allowed)
       VALUES ($1, $2, 'NOT_VERIFIED', 'declared', $3, $4, true)
       ON CONFLICT (reg_no) DO UPDATE SET identified_by = 'declared',
         identity_kind = EXCLUDED.identity_kind, identity_note = EXCLUDED.identity_note,
         /* A failed look-up can leave a shell row with no class at all; the
            staff member's answer fills it, but never overwrites the register. */
         vehicle_class = COALESCE(vehicles.vehicle_class, EXCLUDED.vehicle_class), last_seen_at = now()
       RETURNING *`,
      [regNo, cat.label, identityKind, identity]);
    return { vehicle: row, category: cat, declared: true, noPlate: false, identity: shape };
  }

  /*
   * A vehicle with NO number is whatever was written against it — so the same
   * chassis presented twice is the same vehicle, and the one-pass-a-day rule
   * still bites. Only when it is genuinely new is an identifier minted, short
   * enough for the column and retried in the unlikely event of a clash.
   */
  const seen = await one(
    `SELECT * FROM vehicles WHERE identified_by = 'no_plate' AND identity_kind = $1 AND identity_note = $2 LIMIT 1`,
    [identityKind, identity]);
  if (seen) return { vehicle: seen, category: cat, declared: true, noPlate: true, identity: shape };

  const stamp = slotTime.nowIST().date.slice(2).replace(/-/g, '');   // YYMMDD
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const minted = `NP${stamp}${crypto.randomBytes(2).toString('hex').toUpperCase().slice(0, 3)}`;
    const row = await one(
      `INSERT INTO vehicles (reg_no, vehicle_class, rc_status, identified_by, identity_kind, identity_note, is_allowed)
       VALUES ($1, $2, 'NOT_VERIFIED', 'no_plate', $3, $4, true)
       ON CONFLICT (reg_no) DO NOTHING
       RETURNING *`,
      [minted, cat.label, identityKind, identity]);
    if (row) return { vehicle: row, category: cat, declared: true, noPlate: true, identity: shape };
  }
  refuse('Could not record this vehicle. Try again.', { status: 500, code: 'no_identifier' });
}

async function vehicleFor(regNoInput, { declare = null } = {}) {
  /* Nothing to look up: the staff member is telling us what this is. */
  if (declare && declare.noPlate) return declaredVehicle({ ...declare, noPlate: true });

  const parsed = plateParser.parse(regNoInput);
  if (!parsed.ok) refuse(String(parsed.error || 'Check the vehicle number.').replace(/\*/g, ''), { code: 'bad_plate' });
  const vehicles = require('./vehicle');
  const eligibility = require('./eligibility');
  const resolved = await vehicles.resolve(parsed.regNo, {});
  if (!resolved.ok || !resolved.vehicle || !vehicles.isClassified(resolved.vehicle)) {
    /* The register has nothing — a temporary registration, or a lookup that
       failed. If somebody has said what it is, sell them a pass; if not, say so
       plainly and let the screen offer the choice. */
    if (declare && declare.typeCode) return declaredVehicle({ ...declare, regNo: parsed.regNo });
    refuse('That registration number is not in the vehicle register. It may be a temporary registration — choose the vehicle type to carry on.',
      { status: 404, code: 'vehicle_not_found' });
  }
  const verdict = await eligibility.decide(resolved.vehicle);
  if (!verdict.allowed) refuse(verdict.reason || 'This vehicle is not permitted.', { code: 'not_permitted' });
  if (verdict.unclassified || !verdict.categoryId) {
    if (declare && declare.typeCode) return declaredVehicle({ ...declare, regNo: parsed.regNo });
    refuse('The register does not say what kind of vehicle this is — choose the type to carry on.', { code: 'unclassified' });
  }
  const cat = await one(`SELECT id, code, label FROM vehicle_categories WHERE id = $1`, [verdict.categoryId]);
  return { vehicle: resolved.vehicle, category: cat, description: vehicles.describe ? vehicles.describe(resolved.vehicle) : null };
}

/** A visitor is a mobile number; a name typed at the desk fills in a missing one. */
async function visitorFor(mobileInput, name) {
  const mobile = localMobile(mobileInput);
  if (mobile.length !== 10) refuse('The visitor’s mobile number must be ten digits.', { code: 'bad_mobile' });
  const row = await one(
    `INSERT INTO customers (mobile, name) VALUES ($1, $2)
     ON CONFLICT (mobile) DO UPDATE SET name = COALESCE(customers.name, EXCLUDED.name), last_seen_at = now(), modified_at = now()
     RETURNING *`, [mobile, String(name || '').trim() || null]);
  if (row.is_blocked) refuse(`This number is blocked: ${row.blocked_reason || 'no reason recorded'}.`, { status: 403, code: 'blocked' });
  return row;
}

/** Everything the desk needs before issuing: prices, and places left per slot and type. */
async function availability({ placeId, date }) {
  const place = placeId
    ? await one(`SELECT * FROM places WHERE id = $1`, [placeId])
    : await one(`SELECT * FROM places WHERE is_active ORDER BY id LIMIT 1`);
  if (!place) refuse('No such destination.', { status: 404 });
  const today = slotTime.nowIST().date;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : today;
  const cats = await rowsOf(`SELECT id, code, label FROM vehicle_categories WHERE is_active ORDER BY sort_order`);
  const [tariff, byCat, reasons] = await Promise.all([
    pricing.tariff(place.id),
    Promise.all(cats.map((c) => inventory.forDate(place.id, c.id, day))),
    settings.str('free_ticket_reasons', '[]'),
  ]);

  const slots = (byCat[0] || []).map((s, i) => ({
    slotId: s.slotId, label: s.label, lastEntry: s.lastEntry, timeClosed: s.timeClosed, timeReason: s.timeReason,
    isOpen: s.isOpen,
    types: cats.map((c, k) => ({ code: c.code, label: c.label, capacity: byCat[k][i].capacity, remaining: byCat[k][i].remaining })),
  }));

  const admins = await rowsOf(`SELECT id, name, role FROM admin_users WHERE is_active AND role IN ('super_admin','admin') ORDER BY name`);
  let reasonList = [];
  try { reasonList = JSON.parse(reasons); } catch { reasonList = []; }

  return {
    place: { id: String(place.id), name: place.name },
    date: day,
    today,
    prices: tariff.map((t) => ({ code: t.code, label: t.label, entry: Math.round(t.entryPaise / 100), serviceFee: Math.round(t.platformPaise / 100), total: Math.round(t.totalPaise / 100) })),
    slots,
    freeReasons: reasonList,
    approvers: admins.map((a) => ({ id: String(a.id), name: a.name })),
  };
}

/**
 * Write the pass. Shared by free and on-spot: claim capacity, take the next
 * number, insert the ticket, record the grant and — for on-spot — the payment.
 */
async function issue({ kind, place, slot, vehicle, category, customer, travelDate, amounts, grant, recordEntry, checkpostId }) {
  try {
    return await tx(async (client) => {
      await inventory.ensure(place.id, slot.id, category.id, travelDate);
      const claimed = await client.query(
        `UPDATE slot_inventory SET booked = booked + 1, modified_at = now()
          WHERE place_id = $1 AND slot_id = $2 AND category_id = $3 AND travel_date = $4
            AND is_open AND booked + held < capacity RETURNING id`,
        [place.id, slot.id, category.id, travelDate]);
      if (!claimed.rows.length) refuse(`No ${category.label.toLowerCase()} places are left in that slot.`, { status: 409, code: 'sold_out' });

      const seq = await booking.nextSeq(client, travelDate);

      let paymentId = null;
      if (kind === 'onspot') {
        paymentId = (await client.query(
          `INSERT INTO payments (customer_id, amount_paise, entry_paise, platform_paise, gst_paise, status, gateway,
                                 payment_id, created_at, paid_at, raw)
           VALUES ($1,$2,$3,$4,$5,'paid','counter',$6, now(), now(), $7) RETURNING id`,
          [customer.id, amounts.total_paise, amounts.entry_paise, amounts.platform_paise, amounts.gst_paise,
            grant.paymentReference || `COUNTER-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
            JSON.stringify({ gateway: { method: grant.paymentMethod, counter: true } })])).rows[0].id;
      }

      const ticket = (await client.query(
        `INSERT INTO tickets (ticket_no, pass_seq, reference_id, customer_id, vehicle_id, place_id, slot_id, category_id,
                              payment_id, travel_date, reg_no, mobile, entry_paise, platform_paise, gst_paise, total_paise,
                              status, used_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
        [passCodec.encode(travelDate, seq), seq,
          `${kind === 'free' ? 'FREE' : 'SPOT'}-${String(customer.mobile).slice(-4)}-${vehicle.reg_no}-${String(travelDate).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
          customer.id, vehicle.id, place.id, slot.id, category.id, paymentId, travelDate, vehicle.reg_no, customer.mobile,
          amounts.entry_paise, amounts.platform_paise, amounts.gst_paise, amounts.total_paise,
          recordEntry ? 'used' : 'paid', recordEntry ? new Date() : null])).rows[0];

      if (paymentId) await client.query(`UPDATE payments SET raw = raw || jsonb_build_object('ticket_id', $2::bigint) WHERE id = $1`, [paymentId, ticket.id]);

      await client.query(
        `INSERT INTO ticket_grants (ticket_id, kind, reason_code, reason, approved_by, issued_by, payment_method,
                                    payment_reference, amount_paise, issued_by_staff, checkpost_id, declared)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [ticket.id, kind, grant.reasonCode || null, grant.reason || null, grant.approvedBy || null, grant.issuedBy || null,
          grant.paymentMethod || null, grant.paymentReference || null, amounts.total_paise,
          grant.issuedByStaff || null, grant.checkpostId || null, grant.declared === true]);

      /* An on-spot visitor is usually already at the barrier: record the entry now
         if asked, attributed to the checkpost, with no gate staff behind it. */
      if (recordEntry) {
        await client.query(
          `INSERT INTO scans (ticket_id, ticket_no, reg_no, checkpost_id, verdict, raw_payload)
           VALUES ($1,$2,$3,$4,'valid',$5)`,
          [ticket.id, ticket.ticket_no, vehicle.reg_no, checkpostId || null, JSON.stringify({ issuedFromPanel: kind, by: grant.issuedBy })]);
      }
      return ticket;
    });
  } catch (e) {
    if (e instanceof Refusal) throw e;
    if (e.code === '23505' && /one_per_vehicle/.test(e.constraint || '')) {
      refuse('This vehicle already has a pass for that date.', { status: 409, code: 'already_booked' });
    }
    if (e.code === '23514' && /free_needs_reason/.test(e.constraint || '')) refuse('A free pass needs a written reason.', { code: 'reason_required' });
    throw e;
  }
}

async function slotAndPlace(placeId, slotId, travelDate, { mustBeEnterable = false } = {}) {
  const place = await one(`SELECT * FROM places WHERE id = $1 AND is_active`, [placeId]);
  if (!place) refuse('Choose an open destination.', { code: 'place' });
  const slot = await one(
    `SELECT * FROM place_slots WHERE id = $1 AND place_id = $2 AND is_active
        AND (valid_from IS NULL OR valid_from <= $3::date) AND (valid_to IS NULL OR valid_to >= $3::date)`,
    [slotId, place.id, travelDate]);
  if (!slot) refuse('That slot is not open on that date.', { code: 'slot' });
  if (mustBeEnterable) {
    const t = slotTime.check(slot, travelDate);
    const why = { slot_over: 'the slot has ended', too_late: `last entry was at ${t.lastEntry}`, date_past: 'that date has passed' }[t.reason];
    if (!t.bookable) refuse(`That slot cannot be entered now — ${why || 'last entry has passed'}.`, { code: 'slot_closed' });
  }
  return { place, slot };
}

async function freeTicket({ body, adminId }) {
  const reason = String(body.reason || '').trim();
  const reasonCode = String(body.reasonCode || '').trim();
  if (!reasonCode) refuse('Choose the reason for the free pass.', { code: 'reason_required' });
  if (reason.length < 5) refuse('Explain why this pass is free — it is recorded against your name.', { code: 'reason_required' });
  if (!body.approvedBy) refuse('Choose the approving officer.', { code: 'approver_required' });
  const approver = await one(`SELECT id, name FROM admin_users WHERE id = $1 AND is_active AND role IN ('super_admin','admin')`, [body.approvedBy]);
  if (!approver) refuse('The approving officer must be an active admin.', { code: 'approver_required' });

  const today = slotTime.nowIST().date;
  const travelDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.travelDate || '')) ? body.travelDate : today;
  if (travelDate < today) refuse('A pass cannot be issued for a past date.', { code: 'past_date' });
  const maxDays = await settings.num('booking_days_ahead', 14);
  const [y, m, d] = today.split('-').map(Number);
  const limit = new Date(Date.UTC(y, m - 1, d + maxDays)).toISOString().slice(0, 10);
  if (travelDate > limit) refuse(`Passes can be issued up to ${maxDays} days ahead.`, { code: 'too_far' });

  const { place, slot } = await slotAndPlace(body.placeId, body.slotId, travelDate, { mustBeEnterable: travelDate === today });
  const { vehicle, category } = await vehicleFor(body.regNo);
  const customer = await visitorFor(body.mobile, body.name);

  const ticket = await issue({
    kind: 'free', place, slot, vehicle, category, customer, travelDate,
    amounts: { entry_paise: 0, platform_paise: 0, gst_paise: 0, total_paise: 0 },
    grant: { reasonCode, reason, approvedBy: approver.id, issuedBy: adminId },
    recordEntry: false,
  });

  return {
    ticket: summary(ticket, { place, slot, category, customer, vehicle }),
    audit: { subject: `ticket:${ticket.ticket_no}`, before: null,
      after: { kind: 'free', ticketNo: ticket.ticket_no, regNo: vehicle.reg_no, travelDate, slot: slot.label, reasonCode, approvedBy: approver.name },
      reason: `${reasonCode}: ${reason}` },
  };
}

const METHODS = ['cash', 'upi', 'card'];

/**
 * A pass sold on the spot — at the desk in the panel, or at the barrier itself.
 *
 * The gate passes its own staff member and checkpost instead of an
 * administrator, and may be selling to a vehicle the register cannot identify;
 * everything else is the same sale, through the same capacity, at the same
 * price, with the same tax invoice.
 */
async function onspotTicket({ body, adminId = null, staff = null, checkpost = null }) {
  const method = String(body.paymentMethod || '');
  if (!METHODS.includes(method)) refuse('Choose how the visitor paid: cash, UPI or card.', { code: 'payment_method' });
  const reference = String(body.paymentReference || '').trim();
  if (method !== 'cash' && reference.length < 4) refuse('Enter the UPI or card transaction reference.', { code: 'payment_reference' });

  /* On-spot means now: today, in a slot that can still be entered. */
  const travelDate = slotTime.nowIST().date;
  const { place, slot } = await slotAndPlace(body.placeId, body.slotId, travelDate, { mustBeEnterable: true });
  const declare = body.declaredType || body.noPlate
    ? { typeCode: body.declaredType, note: body.identityNote, kind: body.identityKind, noPlate: body.noPlate === true }
    : null;
  const { vehicle, category, declared, noPlate } = await vehicleFor(body.regNo, { declare });
  const customer = await visitorFor(body.mobile, body.name);

  const price = await pricing.forPlaceCategory(place.id, category.id);
  if (!price) refuse('No price is set for this vehicle type.', { code: 'no_price' });
  const b = await pricing.breakdown(price);

  const gate = checkpost || await one(`SELECT id FROM checkposts WHERE place_id = $1 AND is_active ORDER BY id LIMIT 1`, [place.id]);
  const ticket = await issue({
    kind: 'onspot', place, slot, vehicle, category, customer, travelDate,
    amounts: { entry_paise: b.entry_paise, platform_paise: b.platform_paise, gst_paise: b.gst_paise, total_paise: b.total_paise },
    grant: {
      paymentMethod: method, paymentReference: reference || null, issuedBy: adminId,
      issuedByStaff: staff ? staff.staff_id : null, checkpostId: gate?.id || null, declared: Boolean(declared),
    },
    recordEntry: body.recordEntry === true,
    checkpostId: gate?.id,
  });

  /* A sale, so a tax invoice — from the same unbroken series as online sales.
     Not sent anywhere; it is there for the visitor who asks and for the return. */
  let invoiceNo = null;
  try {
    invoiceNo = (await require('./invoices').issue(ticket.id)).invoice_no;
  } catch (e) {
    console.error('[adminTickets] invoice not issued for %s: %s', ticket.ticket_no, e.message);
  }

  return {
    ticket: { ...summary(ticket, { place, slot, category, customer, vehicle }), invoiceNo, declared: Boolean(declared), noPlate: Boolean(noPlate) },
    audit: { subject: `ticket:${ticket.ticket_no}`, before: null,
      after: { kind: 'onspot', invoiceNo, declaredType: declared ? category.code : null, noPlate: Boolean(noPlate), ticketNo: ticket.ticket_no, regNo: vehicle.reg_no, amount: Math.round(b.total_paise / 100), method, reference: reference || null, entered: body.recordEntry === true } },
  };
}

function summary(t, { place, slot, category, customer, vehicle }) {
  return {
    ticketNo: t.ticket_no, status: t.status, travelDate: String(t.travel_date instanceof Date ? t.travel_date.toISOString() : t.travel_date).slice(0, 10),
    place: place.name, slot: String(slot.label).replace(/\s+/g, ' '), vehicleType: category.label,
    regNo: vehicle.reg_no, vehicle: [vehicle.maker, vehicle.model].filter(Boolean).join(' ') || null,
    visitor: customer.name || null, mobile: `••••${String(customer.mobile).slice(-4)}`,
    amount: Math.round(n(t.total_paise) / 100), enteredAt: t.used_at,
  };
}

/** Recent free and on-spot passes, for the register under each form. */
async function grants({ kind, limit = 20 }) {
  const rows = await rowsOf(
    `SELECT g.kind, g.reason_code, g.reason, g.payment_method, g.payment_reference, g.amount_paise, g.created_at,
            t.ticket_no, t.reg_no, t.travel_date, t.status, cu.name AS visitor,
            ap.name AS approved_by, iss.name AS issued_by
       FROM ticket_grants g
       JOIN tickets t ON t.id = g.ticket_id
       LEFT JOIN customers cu ON cu.id = t.customer_id
       LEFT JOIN admin_users ap ON ap.id = g.approved_by
       LEFT JOIN admin_users iss ON iss.id = g.issued_by
      WHERE ($1::text IS NULL OR g.kind = $1)
      ORDER BY g.created_at DESC LIMIT $2`, [kind || null, Math.min(100, Number(limit) || 20)]);
  return rows.map((r) => ({
    kind: r.kind, ticketNo: r.ticket_no, regNo: r.reg_no,
    travelDate: String(r.travel_date instanceof Date ? r.travel_date.toISOString() : r.travel_date).slice(0, 10),
    status: r.status, visitor: r.visitor, reasonCode: r.reason_code, reason: r.reason,
    paymentMethod: r.payment_method, paymentReference: r.payment_reference, amount: Math.round(n(r.amount_paise) / 100),
    approvedBy: r.approved_by, issuedBy: r.issued_by, at: r.created_at,
  }));
}

module.exports = { Refusal, IDENTITY, availability, vehicleFor, freeTicket, onspotTicket, grants };
