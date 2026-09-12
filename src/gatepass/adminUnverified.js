/**
 * adminUnverified.js — vehicles the register could not vouch for.
 *
 * Every pass normally rests on VAHAN: the register says what the vehicle is,
 * and the type sets the price. These are the ones where it could not — a
 * temporary registration on a car bought last week, a dealer plate, a gateway
 * outage, or a vehicle with no number plate at all — and a person at the barrier
 * said what it was instead.
 *
 * WHY THEY GET A SCREEN OF THEIR OWN. A declared Toofan and a verified Toofan
 * look identical in every other report, and the difference is money: whoever
 * declares the type sets the price. One member of staff declaring far more than
 * the others, or a run of expensive vehicles declared as two-wheelers, is worth
 * seeing — not because staff are dishonest, but because nobody can look for a
 * pattern they cannot see. The same screen is also how a genuine temporary
 * registration gets checked again later, once the permanent number exists.
 *
 * IDENTIFICATION IS THE POINT. When the register cannot answer, the only record
 * of what came through is what somebody wrote down — a chassis number, a TR
 * paper, a licence — so it is shown on every row, and a pass sold without one
 * cannot exist: the sale refuses it.
 */

const { query, one } = require('./db');
const slotTime = require('./slotTime');

const n = (v) => Number(v || 0);
const rupees = (paise) => Math.round(n(paise)) / 100;
const rowsOf = async (text, params) => (await query(text, params)).rows;
const asDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : (d ? String(d).slice(0, 10) : null));
const mask = (m) => (m ? `••••${String(m).slice(-4)}` : null);

const KINDS = {
  declared: 'Type declared at the gate',
  no_plate: 'No number plate',
};

/** Totals for the period, and who has been declaring. */
async function overview({ from, to }) {
  const [totals] = await rowsOf(
    `SELECT count(*)                                            AS passes,
            count(*) FILTER (WHERE v.identified_by = 'declared') AS declared,
            count(*) FILTER (WHERE v.identified_by = 'no_plate') AS no_plate,
            COALESCE(sum(t.total_paise), 0)                      AS value,
            count(DISTINCT v.id)                                 AS vehicles,
            count(*) FILTER (WHERE t.status = 'used')            AS entered
       FROM tickets t JOIN vehicles v ON v.id = t.vehicle_id
      WHERE v.identified_by <> 'rc' AND t.travel_date BETWEEN $1::date AND $2::date`, [from, to]);

  const byType = await rowsOf(
    `SELECT c.code, c.label, count(*) AS passes, COALESCE(sum(t.total_paise), 0) AS value
       FROM tickets t JOIN vehicles v ON v.id = t.vehicle_id JOIN vehicle_categories c ON c.id = t.category_id
      WHERE v.identified_by <> 'rc' AND t.travel_date BETWEEN $1::date AND $2::date
      GROUP BY c.code, c.label, c.sort_order ORDER BY c.sort_order`, [from, to]);

  /*
   * Who declared them, against everything else they sold. A staff member who
   * sells thirty passes and declares two is ordinary; one who declares nearly
   * everything they sell is worth a conversation.
   */
  const byStaff = await rowsOf(
    `SELECT s.id, s.name,
            count(*) FILTER (WHERE v.identified_by <> 'rc') AS declared,
            count(*)                                        AS sold,
            COALESCE(sum(t.total_paise) FILTER (WHERE v.identified_by <> 'rc'), 0) AS value
       FROM ticket_grants g
       JOIN tickets t ON t.id = g.ticket_id
       JOIN vehicles v ON v.id = t.vehicle_id
       JOIN staff s ON s.id = g.issued_by_staff
      WHERE g.kind = 'onspot' AND t.travel_date BETWEEN $1::date AND $2::date
      GROUP BY s.id, s.name
      HAVING count(*) FILTER (WHERE v.identified_by <> 'rc') > 0
      ORDER BY declared DESC LIMIT 20`, [from, to]);

  const daily = await rowsOf(
    `SELECT d::date AS day, count(t.id) AS passes
       FROM generate_series($1::date, $2::date, '1 day') d
       LEFT JOIN tickets t ON t.travel_date = d::date
        AND t.vehicle_id IN (SELECT id FROM vehicles WHERE identified_by <> 'rc')
      GROUP BY d ORDER BY d`, [from, to]);

  return {
    totals: {
      passes: n(totals.passes),
      declared: n(totals.declared),
      noPlate: n(totals.no_plate),
      vehicles: n(totals.vehicles),
      entered: n(totals.entered),
      value: rupees(totals.value),
    },
    byType: byType.map((r) => ({ code: r.code, label: r.label, passes: n(r.passes), value: rupees(r.value) })),
    byStaff: byStaff.map((r) => ({
      id: String(r.id), name: r.name, declared: n(r.declared), sold: n(r.sold),
      share: n(r.sold) ? Math.round((n(r.declared) / n(r.sold)) * 100) : 0,
      value: rupees(r.value),
    })),
    daily: daily.map((r) => ({ day: asDate(r.day), passes: n(r.passes) })),
  };
}

/** The passes themselves, newest first. */
async function list({ q = null, kind = null, from = null, to = null, limit = 25, offset = 0 } = {}) {
  const term = String(q || '').trim();
  const digits = term.replace(/\D/g, '');
  const plate = term.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const size = Math.max(1, Math.min(100, Number(limit) || 25));
  const skip = Math.max(0, Number(offset) || 0);

  const rows = await rowsOf(
    `SELECT t.id, t.ticket_no, t.reg_no, t.mobile, t.travel_date, t.status, t.total_paise, t.used_at, t.created_at,
            v.identified_by, v.identity_kind, v.identity_note, v.vehicle_class,
            c.label AS type_label, cu.name AS visitor,
            regexp_replace(sl.label, '[[:space:]]+', ' ', 'g') AS slot_label,
            g.payment_method, g.payment_reference, g.created_at AS sold_at,
            s.name AS staff_name, u.name AS admin_name, cp.name AS checkpost_name,
            i.invoice_no,
            count(*) OVER () AS total_rows
       FROM tickets t
       JOIN vehicles v ON v.id = t.vehicle_id
       JOIN vehicle_categories c ON c.id = t.category_id
       JOIN place_slots sl ON sl.id = t.slot_id
       LEFT JOIN customers cu ON cu.id = t.customer_id
       LEFT JOIN ticket_grants g ON g.ticket_id = t.id
       LEFT JOIN staff s ON s.id = g.issued_by_staff
       LEFT JOIN admin_users u ON u.id = g.issued_by
       LEFT JOIN checkposts cp ON cp.id = g.checkpost_id
       LEFT JOIN invoices i ON i.ticket_id = t.id
      WHERE v.identified_by <> 'rc'
        AND ($1::text IS NULL OR v.identified_by = $1)
        AND ($2::date IS NULL OR t.travel_date >= $2::date)
        AND ($3::date IS NULL OR t.travel_date <= $3::date)
        AND ($4::text IS NULL
             OR t.reg_no ILIKE '%' || $5 || '%'
             OR v.identity_note ILIKE '%' || $5 || '%'
             OR t.ticket_no ILIKE '%' || $5 || '%'
             OR cu.name ILIKE '%' || $4 || '%'
             OR ($6::text IS NOT NULL AND t.mobile LIKE '%' || $6))
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT $7 OFFSET $8`,
    [['declared', 'no_plate'].includes(kind) ? kind : null,
      /^\d{4}-\d{2}-\d{2}$/.test(String(from || '')) ? from : null,
      /^\d{4}-\d{2}-\d{2}$/.test(String(to || '')) ? to : null,
      term || null, plate || null, digits.length >= 4 ? digits : null, size, skip]);

  return {
    total: rows.length ? n(rows[0].total_rows) : 0,
    limit: size,
    offset: skip,
    passes: rows.map((r) => ({
      id: String(r.id),
      ticketNo: r.ticket_no,
      regNo: r.reg_no,
      kind: r.identified_by,
      kindLabel: KINDS[r.identified_by] || r.identified_by,
      identity: r.identity_note ? { kind: r.identity_kind, value: r.identity_note } : null,
      type: r.type_label,
      declaredClass: r.vehicle_class,
      visitor: r.visitor,
      mobile: mask(r.mobile),
      travelDate: asDate(r.travel_date),
      slot: r.slot_label,
      amount: rupees(r.total_paise),
      status: r.status,
      enteredAt: r.used_at,
      soldAt: r.sold_at || r.created_at,
      soldBy: r.staff_name || r.admin_name || null,
      soldAtGate: r.checkpost_name,
      paymentMethod: r.payment_method,
      paymentReference: r.payment_reference,
      invoiceNo: r.invoice_no,
    })),
  };
}

/**
 * Ask the register again.
 *
 * A temporary registration becomes a permanent one, and a gateway that was down
 * comes back. This looks the vehicle up now: if the register answers, the row
 * stops being declared and says what it really is. It is deliberately a button
 * somebody presses rather than a job that runs — a look-up costs money, and
 * nobody should be surprised by a bill.
 */
async function recheck({ regNo }) {
  const vehicles = require('./vehicle');
  const eligibility = require('./eligibility');
  const before = await one('SELECT * FROM vehicles WHERE reg_no = $1', [regNo]);
  if (!before) return { ok: false, message: 'No such vehicle.' };
  if (before.identified_by === 'no_plate') {
    return { ok: false, message: 'This vehicle has no registration number to look up.' };
  }

  const resolved = await vehicles.resolve(before.reg_no, { force: true });
  if (!resolved.ok || !resolved.vehicle || !vehicles.isClassified(resolved.vehicle)) {
    return { ok: true, verified: false, message: 'The register still has nothing for this number.' };
  }
  const verdict = await eligibility.decide(resolved.vehicle);
  const category = verdict.categoryId
    ? await one('SELECT code, label FROM vehicle_categories WHERE id = $1', [verdict.categoryId])
    : null;

  await query(
    `UPDATE vehicles SET identified_by = 'rc', modified_at = now() WHERE id = $1`, [before.id]).catch(() => {});

  return {
    ok: true,
    verified: true,
    regNo: before.reg_no,
    was: before.vehicle_class,
    now: category ? category.label : resolved.vehicle.vehicle_class,
    matches: category ? String(category.label) === String(before.vehicle_class) : null,
    message: category
      ? `The register now says this is a ${category.label}.`
      : 'The register answered, but does not say what kind of vehicle it is.',
  };
}

module.exports = { KINDS, overview, list, recheck };
