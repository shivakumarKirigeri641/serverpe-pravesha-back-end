/**
 * adminVehicles.js — the register as this service has come to know it.
 *
 * Every other screen is organised around a moment: a pass, a payment, a check at
 * a barrier. This one is organised around a vehicle, because some questions are
 * only answerable that way. "That red Seltos is here every Sunday" is a fact
 * about a vehicle, not about any one of its passes, and it cannot be seen by
 * reading passes one at a time.
 *
 * WHAT IT IS ACTUALLY FOR. Three things, in the order they come up at a gate.
 * Somebody at the barrier disputes a refusal and the staff member wants the
 * vehicle's history, not one pass. A vehicle turns up repeatedly with a type
 * declared by a person rather than the register, which is worth noticing because
 * the type sets the price. And a vehicle is barred, or should be, and whoever is
 * deciding needs to see everything it has done here first.
 *
 * REVENUE IS WHAT IT PAID, NOT WHAT IT IS WORTH. The figure against a vehicle is
 * the money actually collected on its passes, less refunds — the same arithmetic
 * the finance screens use, so the two cannot drift apart and quietly disagree.
 * It is withheld entirely from anybody without finance.view, exactly as it is on
 * every other screen.
 *
 * THE MOBILE NUMBER IS NOT SHOWN IN FULL. A vehicle's page would otherwise be a
 * convenient way to collect the phone numbers of everybody who has ever driven
 * it. The last four digits are enough to match a visitor reading theirs out.
 */

const { query, one } = require('./db');
const slotTime = require('./slotTime');

const n = (v) => Number(v || 0);
const rupees = (paise) => Math.round(n(paise)) / 100;
const rowsOf = async (text, params) => (await query(text, params)).rows;
const asDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : (d ? String(d).slice(0, 10) : null));
const mask = (m) => (m ? `••••${String(m).slice(-4)}` : null);

/* How the service knows what this vehicle is. */
const IDENTIFIED = {
  rc: 'Verified with the register',
  declared: 'Type declared at a gate',
  no_plate: 'No number plate — identified by hand',
};

/*
 * The money a vehicle has brought in, in one place.
 *
 * Counted from the passes rather than the payments, because a pass is what a
 * vehicle has; refunds are subtracted where they landed. Kept as a fragment so
 * the list and the detail cannot compute it two different ways.
 */
const MONEY = `
  COALESCE(sum(t.total_paise) FILTER (WHERE t.status IN ('paid','used')), 0)   AS paid_paise,
  COALESCE(sum(t.entry_paise) FILTER (WHERE t.status IN ('paid','used')), 0)   AS entry_paise,
  COALESCE(sum(t.platform_paise) FILTER (WHERE t.status IN ('paid','used')), 0) AS fee_paise,
  COALESCE(sum(t.gst_paise) FILTER (WHERE t.status IN ('paid','used')), 0)     AS gst_paise,
  COALESCE(sum(p.refunded_paise), 0)                                          AS refunded_paise`;

/**
 * The list. One row per vehicle, newest visitor first by default.
 *
 * Ordered by when it was last here rather than alphabetically: somebody opening
 * this screen is nearly always looking for something recent, and a register
 * sorted by registration number is a filing cabinet, not a screen.
 */
async function list({ q = null, kind = null, type = null, from = null, to = null,
  sort = 'recent', limit = 25, offset = 0 } = {}) {
  const term = String(q || '').trim();
  const plate = term.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const digits = term.replace(/\D/g, '');
  const size = Math.max(1, Math.min(100, Number(limit) || 25));
  const skip = Math.max(0, Number(offset) || 0);

  const order = {
    recent: 'last_visit DESC NULLS LAST',
    visits: 'passes DESC',
    revenue: 'paid_paise DESC',
    plate: 'v.reg_no ASC',
  }[String(sort)] || 'last_visit DESC NULLS LAST';

  const rows = await rowsOf(
    `SELECT v.id, v.reg_no, v.vehicle_class, v.maker, v.model, v.colour,
            v.identified_by, v.identity_kind, v.identity_note, v.is_allowed, v.deny_code,
            v.rc_fetched_at, v.first_seen_at, v.last_seen_at,
            count(t.id)                                        AS passes,
            count(t.id) FILTER (WHERE t.status = 'used')       AS entries,
            max(t.travel_date)                                 AS last_visit,
            min(t.travel_date)                                 AS first_visit,
            count(DISTINCT t.customer_id)                      AS visitors,
            (array_agg(DISTINCT c.label) FILTER (WHERE c.label IS NOT NULL))[1] AS type_label,
            ${MONEY},
            count(*) OVER () AS total_rows
       FROM vehicles v
       LEFT JOIN tickets t ON t.vehicle_id = v.id
        AND ($3::date IS NULL OR t.travel_date >= $3::date)
        AND ($4::date IS NULL OR t.travel_date <= $4::date)
       LEFT JOIN payments p ON p.id = t.payment_id
       LEFT JOIN vehicle_categories c ON c.id = t.category_id
      WHERE ($1::text IS NULL
             OR v.reg_no LIKE '%' || $1 || '%'
             OR v.identity_note ILIKE '%' || $1 || '%'
             OR ($2::text IS NOT NULL AND EXISTS (
                  SELECT 1 FROM tickets tt WHERE tt.vehicle_id = v.id AND tt.mobile LIKE '%' || $2)))
        AND ($5::text IS NULL OR v.identified_by = $5)
        AND ($6::text IS NULL OR EXISTS (
              SELECT 1 FROM tickets t2 JOIN vehicle_categories c2 ON c2.id = t2.category_id
               WHERE t2.vehicle_id = v.id AND c2.code = $6))
      GROUP BY v.id
      ORDER BY ${order}
      LIMIT $7 OFFSET $8`,
    [plate || null, digits.length >= 4 ? digits : null,
      /^\d{4}-\d{2}-\d{2}$/.test(String(from || '')) ? from : null,
      /^\d{4}-\d{2}-\d{2}$/.test(String(to || '')) ? to : null,
      ['rc', 'declared', 'no_plate'].includes(kind) ? kind : null,
      type ? String(type).toUpperCase() : null,
      size, skip]);

  return {
    total: rows.length ? n(rows[0].total_rows) : 0,
    limit: size,
    offset: skip,
    vehicles: rows.map((r) => ({
      id: String(r.id),
      regNo: r.reg_no,
      type: r.type_label || r.vehicle_class || null,
      description: [r.maker, r.model].filter(Boolean).join(' ') || null,
      colour: r.colour || null,
      kind: r.identified_by,
      kindLabel: IDENTIFIED[r.identified_by] || r.identified_by,
      identity: r.identity_note ? { kind: r.identity_kind, value: r.identity_note } : null,
      allowed: r.is_allowed !== false,
      blockedReason: r.deny_code || null,
      verified: Boolean(r.rc_fetched_at),
      passes: n(r.passes),
      entries: n(r.entries),
      visitors: n(r.visitors),
      firstVisit: asDate(r.first_visit),
      lastVisit: asDate(r.last_visit),
      lastSeenAt: r.last_seen_at,
      revenue: rupees(n(r.paid_paise) - n(r.refunded_paise)),
    })),
  };
}

/** Everything known about one vehicle. */
async function detail(regNoOrId) {
  const key = /^\d+$/.test(String(regNoOrId))
    ? { where: 'v.id = $1', param: regNoOrId }
    : { where: 'v.reg_no = $1', param: String(regNoOrId).toUpperCase().replace(/[^A-Z0-9]/g, '') };

  const v = await one(`SELECT * FROM vehicles v WHERE ${key.where}`, [key.param]);
  if (!v) return null;

  const [totals] = await rowsOf(
    `SELECT count(*)                                            AS passes,
            count(*) FILTER (WHERE t.status = 'used')           AS entries,
            count(*) FILTER (WHERE t.status = 'paid')           AS unused,
            count(*) FILTER (WHERE t.status = 'cancelled')      AS cancelled,
            count(*) FILTER (WHERE t.status = 'expired')        AS abandoned,
            count(DISTINCT t.customer_id)                       AS visitors,
            count(DISTINCT t.travel_date)                       AS days,
            min(t.travel_date)                                  AS first_visit,
            max(t.travel_date)                                  AS last_visit,
            ${MONEY}
       FROM tickets t LEFT JOIN payments p ON p.id = t.payment_id
      WHERE t.vehicle_id = $1`, [v.id]);

  /* Who has booked it. A vehicle is not a person: the same car comes back with a
     different phone, and that is worth seeing rather than hiding. */
  const visitors = await rowsOf(
    `SELECT cu.id, cu.name, cu.wa_profile_name, t.mobile,
            count(*) AS passes, max(t.travel_date) AS last_visit
       FROM tickets t JOIN customers cu ON cu.id = t.customer_id
      WHERE t.vehicle_id = $1
      GROUP BY cu.id, cu.name, cu.wa_profile_name, t.mobile
      ORDER BY count(*) DESC, max(t.travel_date) DESC LIMIT 10`, [v.id]);

  const passes = await rowsOf(
    `SELECT t.id, t.ticket_no, t.travel_date, t.status, t.total_paise, t.used_at, t.created_at,
            t.entry_source, t.category_declared,
            regexp_replace(s.label, '[[:space:]]+', ' ', 'g') AS slot, c.label AS type,
            cu.name AS visitor, t.mobile, i.invoice_no,
            p.refunded_paise, p.status AS payment_status, g.kind AS grant_kind
       FROM tickets t
       JOIN place_slots s ON s.id = t.slot_id
       JOIN vehicle_categories c ON c.id = t.category_id
       LEFT JOIN customers cu ON cu.id = t.customer_id
       LEFT JOIN payments p ON p.id = t.payment_id
       LEFT JOIN invoices i ON i.ticket_id = t.id
       LEFT JOIN ticket_grants g ON g.ticket_id = t.id
      WHERE t.vehicle_id = $1
      ORDER BY t.travel_date DESC, t.created_at DESC LIMIT 50`, [v.id]);

  /* Every time somebody looked at it at a barrier, refusals included — the
     refusals are usually the interesting ones. */
  const checks = await rowsOf(
    `SELECT sc.id, sc.verdict, sc.scanned_at, sc.ticket_no, sc.duration_ms,
            st.name AS staff, cp.name AS checkpost
       FROM scans sc
       LEFT JOIN staff st ON st.id = sc.staff_id
       LEFT JOIN checkposts cp ON cp.id = sc.checkpost_id
      WHERE sc.reg_no = $1 ORDER BY sc.scanned_at DESC LIMIT 50`, [v.reg_no]);

  /* When it comes. A vehicle that is always here on a Sunday morning is a
     pattern; one pass is not. */
  const byDay = await rowsOf(
    `SELECT to_char(t.travel_date, 'Dy') AS day, extract(dow from t.travel_date) AS dow, count(*) AS passes
       FROM tickets t WHERE t.vehicle_id = $1 AND t.status IN ('paid','used')
      GROUP BY 1, 2 ORDER BY 2`, [v.id]);

  const bySlot = await rowsOf(
    `SELECT regexp_replace(s.label, '[[:space:]]+', ' ', 'g') AS slot, count(*) AS passes
       FROM tickets t JOIN place_slots s ON s.id = t.slot_id
      WHERE t.vehicle_id = $1 AND t.status IN ('paid','used')
      GROUP BY 1 ORDER BY count(*) DESC`, [v.id]);

  const photos = await rowsOf(
    `SELECT ph.id, ph.kind FROM gate_photos ph
       JOIN tickets t ON t.id = ph.ticket_id
      WHERE t.vehicle_id = $1 ORDER BY ph.id DESC LIMIT 12`, [v.id]);

  return {
    vehicle: {
      id: String(v.id),
      regNo: v.reg_no,
      maker: v.maker,
      model: v.model,
      seats: v.seats || null,
      colour: v.colour,
      fuel: v.fuel,
      vehicleClass: v.vehicle_class,
      bodyType: v.body_type || null,
      registeredOn: asDate(v.reg_date),
      registeredAt: v.registered_at || null,
      rcStatus: v.rc_status,
      category: v.vehicle_category || null,
      kind: v.identified_by,
      kindLabel: IDENTIFIED[v.identified_by] || v.identified_by,
      identity: v.identity_note ? { kind: v.identity_kind, value: v.identity_note } : null,
      allowed: v.is_allowed !== false,
      blockedReason: v.deny_code || null,
      verifiedAt: v.rc_fetched_at,
      firstSeenAt: v.first_seen_at,
      lastSeenAt: v.last_seen_at,
    },
    totals: {
      passes: n(totals.passes),
      entries: n(totals.entries),
      unused: n(totals.unused),
      cancelled: n(totals.cancelled),
      abandoned: n(totals.abandoned),
      visitors: n(totals.visitors),
      days: n(totals.days),
      firstVisit: asDate(totals.first_visit),
      lastVisit: asDate(totals.last_visit),
      /* Came and never arrived: worth seeing, because a vehicle that books and
         never turns up is holding places other people wanted. */
      noShows: Math.max(0, n(totals.passes) - n(totals.entries) - n(totals.cancelled) - n(totals.abandoned)),
      revenue: rupees(n(totals.paid_paise) - n(totals.refunded_paise)),
      collected: rupees(totals.paid_paise),
      department: rupees(totals.entry_paise),
      serviceFee: rupees(totals.fee_paise),
      gst: rupees(totals.gst_paise),
      refunded: rupees(totals.refunded_paise),
    },
    visitors: visitors.map((r) => ({
      name: r.name || r.wa_profile_name || null,
      mobile: mask(r.mobile),
      passes: n(r.passes),
      lastVisit: asDate(r.last_visit),
    })),
    passes: passes.map((r) => ({
      id: String(r.id),
      ticketNo: r.ticket_no,
      travelDate: asDate(r.travel_date),
      slot: r.slot,
      type: r.type,
      status: r.status,
      declaredType: r.category_declared === true,
      entrySource: r.entry_source || null,
      enteredAt: r.used_at,
      bookedAt: r.created_at,
      visitor: r.visitor,
      mobile: mask(r.mobile),
      amount: rupees(r.total_paise),
      refunded: rupees(r.refunded_paise),
      invoiceNo: r.invoice_no,
      soldAs: r.grant_kind || null,
    })),
    checks: checks.map((r) => ({
      id: String(r.id),
      verdict: r.verdict,
      at: r.scanned_at,
      ticketNo: r.ticket_no,
      staff: r.staff,
      checkpost: r.checkpost,
      seconds: r.duration_ms === null || r.duration_ms === undefined ? null : Math.round(n(r.duration_ms) / 100) / 10,
    })),
    pattern: {
      byDay: byDay.map((r) => ({ day: String(r.day).trim(), passes: n(r.passes) })),
      bySlot: bySlot.map((r) => ({ slot: r.slot, passes: n(r.passes) })),
    },
    photos: photos.map((r) => ({ id: String(r.id), kind: r.kind })),
    today: slotTime.nowIST().date,
  };
}

/** The money keys this screen carries, for redaction where finance is not allowed. */
const MONEY_KEYS = ['revenue', 'collected', 'department', 'serviceFee', 'gst', 'refunded', 'amount', 'refunded'];

module.exports = { IDENTIFIED, MONEY_KEYS, list, detail };
