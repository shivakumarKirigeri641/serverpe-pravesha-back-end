/**
 * adminDestinations.js — Destinations: every entry location Pravesha runs, and
 * everything that has to be true before one can sell a pass.
 *
 * A DESTINATION IS READY OR IT IS NOT. Selling a pass needs four things: a
 * price for every vehicle type, at least one slot, places in that slot, and a
 * checkpost where the pass is checked. A destination missing any of them cannot
 * be activated — the alternative is a visitor paying for a pass nobody can
 * check, which is worse than a destination that is not open yet. The checklist
 * is shown either way, so "what is left to do" is never a guess.
 *
 * WHAT IS EDITED HERE AND WHAT IS NOT. Name, description, rules, images,
 * location and status live here. Prices, slots, capacity and staff have their
 * own screens and their own permissions, and this one links to them rather than
 * copying their forms — two ways to change a price is one way too many.
 */

const { query, one } = require('./db');
const slotTime = require('./slotTime');

const n = (v) => Number(v || 0);
const rupees = (paise) => Math.round(n(paise)) / 100;
const rowsOf = async (text, params) => (await query(text, params)).rows;

class Refusal extends Error {
  constructor(message, { status = 400, code = 'invalid', detail = null } = {}) {
    super(message); this.status = status; this.code = code; this.detail = detail;
  }
}
const refuse = (message, opts) => { throw new Refusal(message, opts); };

const CODE = /^[A-Z][A-Z0-9]{2,19}$/;
const textList = (v, max = 12) => (Array.isArray(v) ? v : [])
  .map((x) => String(x || '').trim()).filter(Boolean).slice(0, max);

/** Every destination with enough beside it to see how each is doing. */
async function list() {
  const today = slotTime.nowIST().date;
  const rows = await rowsOf(
    `SELECT p.*,
            (SELECT count(*) FROM place_slots s WHERE s.place_id = p.id AND s.is_active) AS slots,
            (SELECT count(*) FROM checkposts c WHERE c.place_id = p.id AND c.is_active) AS checkposts,
            (SELECT count(*) FROM place_pricing pr WHERE pr.place_id = p.id AND pr.is_active) AS prices,
            (SELECT COALESCE(sum(sc.capacity), 0) FROM slot_capacity sc JOIN place_slots s ON s.id = sc.slot_id
              WHERE sc.place_id = p.id AND s.is_active) AS daily_capacity,
            (SELECT count(*) FROM tickets t WHERE t.place_id = p.id AND t.status IN ('paid','used')
                AND t.travel_date BETWEEN $1::date - 29 AND $1::date) AS passes_30d,
            (SELECT COALESCE(sum(t.total_paise), 0) FROM tickets t WHERE t.place_id = p.id AND t.status IN ('paid','used')
                AND t.travel_date BETWEEN $1::date - 29 AND $1::date) AS value_30d,
            (SELECT count(*) FROM tickets t WHERE t.place_id = p.id AND t.status = 'used'
                AND t.travel_date BETWEEN $1::date - 29 AND $1::date) AS entries_30d,
            (SELECT count(*) FROM tickets t WHERE t.place_id = p.id AND t.status = 'paid' AND t.travel_date >= $1::date) AS upcoming,
            (SELECT count(*) FROM closures c WHERE c.place_id = p.id AND c.lifted_at IS NULL AND c.travel_date >= $1::date) AS closed_days
       FROM places p ORDER BY p.is_active DESC, p.id`, [today]);

  const cats = await rowsOf('SELECT count(*) AS c FROM vehicle_categories WHERE is_active');
  return {
    today,
    vehicleTypes: n(cats[0].c),
    destinations: rows.map((p) => shape(p, n(cats[0].c))),
  };
}

function readiness(p, vehicleTypes) {
  const checks = [
    { key: 'prices', label: 'A price for every vehicle type', done: n(p.prices) >= vehicleTypes, where: '/settings/pricing' },
    { key: 'slots', label: 'At least one slot', done: n(p.slots) > 0, where: '/settings/slots' },
    { key: 'capacity', label: 'Places to sell in those slots', done: n(p.daily_capacity) > 0, where: '/settings/slots' },
    { key: 'checkpost', label: 'A checkpost to check passes at', done: n(p.checkposts) > 0, where: '/checkposts' },
  ];
  return { checks, ready: checks.every((c) => c.done), missing: checks.filter((c) => !c.done).map((c) => c.label) };
}

function shape(p, vehicleTypes) {
  return {
    id: String(p.id),
    code: p.code,
    name: p.name,
    nameKn: p.name_kn,
    district: p.district,
    districtKn: p.district_kn,
    description: p.description,
    descriptionKn: p.description_kn,
    rules: p.rules || [],
    rulesKn: p.rules_kn || [],
    images: p.images || [],
    latitude: p.latitude === null || p.latitude === undefined ? null : Number(p.latitude),
    longitude: p.longitude === null || p.longitude === undefined ? null : Number(p.longitude),
    address: p.address,
    howToReach: p.how_to_reach,
    contactNumber: p.contact_number,
    bookingDaysAhead: n(p.booking_days_ahead),
    active: p.is_active,
    slots: n(p.slots),
    checkposts: n(p.checkposts),
    prices: n(p.prices),
    dailyCapacity: n(p.daily_capacity),
    upcoming: n(p.upcoming),
    closedDays: n(p.closed_days),
    last30Days: { passes: n(p.passes_30d), entries: n(p.entries_30d), value: rupees(p.value_30d) },
    readiness: readiness(p, vehicleTypes),
  };
}

/** One destination, with the slots, prices, checkposts and staff behind it. */
async function detail(id) {
  const today = slotTime.nowIST().date;
  const p = await one(
    `SELECT p.*,
            (SELECT count(*) FROM place_slots s WHERE s.place_id = p.id AND s.is_active) AS slots,
            (SELECT count(*) FROM checkposts c WHERE c.place_id = p.id AND c.is_active) AS checkposts,
            (SELECT count(*) FROM place_pricing pr WHERE pr.place_id = p.id AND pr.is_active) AS prices,
            (SELECT COALESCE(sum(sc.capacity), 0) FROM slot_capacity sc JOIN place_slots s ON s.id = sc.slot_id
              WHERE sc.place_id = p.id AND s.is_active) AS daily_capacity,
            (SELECT count(*) FROM tickets t WHERE t.place_id = p.id AND t.status IN ('paid','used')
                AND t.travel_date BETWEEN $2::date - 29 AND $2::date) AS passes_30d,
            (SELECT COALESCE(sum(t.total_paise), 0) FROM tickets t WHERE t.place_id = p.id AND t.status IN ('paid','used')
                AND t.travel_date BETWEEN $2::date - 29 AND $2::date) AS value_30d,
            (SELECT count(*) FROM tickets t WHERE t.place_id = p.id AND t.status = 'used'
                AND t.travel_date BETWEEN $2::date - 29 AND $2::date) AS entries_30d,
            (SELECT count(*) FROM tickets t WHERE t.place_id = p.id AND t.status = 'paid' AND t.travel_date >= $2::date) AS upcoming,
            (SELECT count(*) FROM closures c WHERE c.place_id = p.id AND c.lifted_at IS NULL AND c.travel_date >= $2::date) AS closed_days
       FROM places p WHERE p.id = $1`, [id, today]);
  if (!p) return null;
  const [cats] = await rowsOf('SELECT count(*) AS c FROM vehicle_categories WHERE is_active');

  const slots = await rowsOf(
    `SELECT s.id, s.code, regexp_replace(s.label, '[[:space:]]+', ' ', 'g') AS label, s.starts_at, s.ends_at, s.is_active,
            s.valid_from, s.valid_to,
            (SELECT COALESCE(sum(capacity), 0) FROM slot_capacity sc WHERE sc.slot_id = s.id) AS capacity
       FROM place_slots s WHERE s.place_id = $1 ORDER BY s.is_active DESC, s.starts_at`, [p.id]);

  const prices = await rowsOf(
    `SELECT c.code, c.label, pr.entry_paise, pr.platform_paise
       FROM vehicle_categories c
       LEFT JOIN place_pricing pr ON pr.category_id = c.id AND pr.place_id = $1 AND pr.is_active
      WHERE c.is_active ORDER BY c.sort_order`, [p.id]);

  const checkposts = await rowsOf(
    `SELECT c.id, c.name, c.is_active, c.note,
            (SELECT count(*) FROM staff_checkposts sc WHERE sc.checkpost_id = c.id) AS staff,
            (SELECT count(*) FROM staff_sessions ss WHERE ss.checkpost_id = c.id AND ss.ended_at IS NULL) AS on_duty,
            (SELECT count(*) FROM scans s WHERE s.checkpost_id = c.id
              AND (s.scanned_at AT TIME ZONE 'Asia/Kolkata')::date = $2::date) AS checks_today
       FROM checkposts c WHERE c.place_id = $1 ORDER BY c.is_active DESC, c.id`, [p.id, today]);

  const staff = await rowsOf(
    `SELECT DISTINCT s.id, s.name, s.is_active FROM staff s
       JOIN staff_checkposts sc ON sc.staff_id = s.id
       JOIN checkposts c ON c.id = sc.checkpost_id
      WHERE c.place_id = $1 ORDER BY s.is_active DESC, s.name`, [p.id]);

  const closures = await rowsOf(
    `SELECT c.travel_date, c.reason, c.created_at, a.title FROM closures c
       LEFT JOIN announcements a ON a.id = c.announcement_id
      WHERE c.place_id = $1 AND c.lifted_at IS NULL AND c.travel_date >= $2::date
      ORDER BY c.travel_date LIMIT 30`, [p.id, today]);

  const trend = await rowsOf(
    `SELECT d::date AS day,
            count(t.id) FILTER (WHERE t.status IN ('paid','used')) AS booked,
            count(t.id) FILTER (WHERE t.status = 'used') AS entered
       FROM generate_series($2::date - 29, $2::date, '1 day') d
       LEFT JOIN tickets t ON t.place_id = $1 AND t.travel_date = d::date
      GROUP BY d ORDER BY d`, [p.id, today]);

  return {
    destination: shape(p, n(cats.c)),
    slots: slots.map((s) => ({
      id: String(s.id), code: s.code, label: s.label,
      startsAt: String(s.starts_at).slice(0, 5), endsAt: String(s.ends_at).slice(0, 5),
      active: s.is_active, capacity: n(s.capacity),
      validFrom: s.valid_from ? String(s.valid_from instanceof Date ? s.valid_from.toISOString() : s.valid_from).slice(0, 10) : null,
      validTo: s.valid_to ? String(s.valid_to instanceof Date ? s.valid_to.toISOString() : s.valid_to).slice(0, 10) : null,
    })),
    prices: prices.map((r) => ({
      code: r.code, label: r.label,
      entry: r.entry_paise === null ? null : rupees(r.entry_paise),
      serviceFee: r.platform_paise === null ? null : rupees(r.platform_paise),
      total: r.entry_paise === null ? null : rupees(n(r.entry_paise) + n(r.platform_paise)),
    })),
    checkposts: checkposts.map((c) => ({
      id: String(c.id), name: c.name, active: c.is_active, note: c.note,
      staff: n(c.staff), onDuty: n(c.on_duty), checksToday: n(c.checks_today),
    })),
    staff: staff.map((s) => ({ id: String(s.id), name: s.name, active: s.is_active })),
    closures: closures.map((c) => ({
      date: String(c.travel_date instanceof Date ? c.travel_date.toISOString() : c.travel_date).slice(0, 10),
      title: c.title, reason: c.reason,
    })),
    trend: trend.map((t) => ({
      day: String(t.day instanceof Date ? t.day.toISOString() : t.day).slice(0, 10),
      booked: n(t.booked), entered: n(t.entered),
    })),
  };
}

/* Pictures come from the media the back-end already serves; nothing is uploaded here. */
async function images() {
  const media = require('../routes/media');
  return typeof media.available === 'function' ? media.available() : [];
}

function validate(body, { creating = false } = {}) {
  const out = {};
  const name = String(body.name ?? '').trim();
  if (creating || body.name !== undefined) {
    if (name.length < 3) refuse('Give the destination a name.');
    out.name = name;
  }
  if (creating || body.district !== undefined) {
    const d = String(body.district ?? '').trim();
    if (d.length < 3) refuse('Which district is it in?');
    out.district = d;
  }
  if (creating) {
    const code = String(body.code ?? '').trim().toUpperCase() || name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
    if (!CODE.test(code)) refuse('The code must be 3 to 20 letters or digits, starting with a letter.');
    out.code = code;
  }
  for (const [field, column] of [['nameKn', 'name_kn'], ['districtKn', 'district_kn'], ['description', 'description'],
    ['descriptionKn', 'description_kn'], ['address', 'address'], ['howToReach', 'how_to_reach']]) {
    if (body[field] !== undefined) out[column] = String(body[field] || '').trim().slice(0, 2000) || null;
  }
  if (body.contactNumber !== undefined) {
    const c = String(body.contactNumber || '').replace(/[^\d+ ]/g, '').trim();
    out.contact_number = c || null;
  }
  if (body.rules !== undefined) out.rules = JSON.stringify(textList(body.rules).map((r) => r.slice(0, 300)));
  if (body.rulesKn !== undefined) out.rules_kn = JSON.stringify(textList(body.rulesKn).map((r) => r.slice(0, 300)));
  if (body.images !== undefined) out.images = JSON.stringify(textList(body.images, 8));
  for (const [field, column] of [['latitude', 'latitude'], ['longitude', 'longitude']]) {
    if (body[field] !== undefined) {
      const v = body[field] === '' || body[field] === null ? null : Number(body[field]);
      if (v !== null && !Number.isFinite(v)) refuse('The location must be a number, or empty.');
      if (v !== null && column === 'latitude' && (v < -90 || v > 90)) refuse('Latitude must be between −90 and 90.');
      if (v !== null && column === 'longitude' && (v < -180 || v > 180)) refuse('Longitude must be between −180 and 180.');
      out[column] = v;
    }
  }
  if (body.bookingDaysAhead !== undefined) {
    const d = Number(body.bookingDaysAhead);
    if (!Number.isInteger(d) || d < 1 || d > 90) refuse('Bookings can be opened between 1 and 90 days ahead.');
    out.booking_days_ahead = d;
  }
  return out;
}

async function create({ body, adminId, reason }) {
  const why = String(reason || '').trim();
  if (why.length < 5) refuse('Say why this destination is being added — it is recorded in the audit log.', { code: 'reason_required' });
  const fields = validate(body, { creating: true });
  if (await one('SELECT 1 FROM places WHERE code = $1', [fields.code])) refuse('A destination with that code already exists.', { status: 409, code: 'exists' });

  const cols = Object.keys(fields);
  const row = await one(
    `INSERT INTO places (${cols.join(', ')}, is_active) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}, false) RETURNING *`,
    cols.map((c) => fields[c]));

  return {
    destination: { id: String(row.id), code: row.code, name: row.name },
    reason: why,
    audit: { subject: `place:${row.code}`, before: null, after: { name: row.name, district: row.district, code: row.code, active: false } },
  };
}

async function update({ id, body, adminId, reason }) {
  const why = String(reason || '').trim();
  if (why.length < 5) refuse('Say what changed and why — it is recorded in the audit log.', { code: 'reason_required' });
  const before = await one('SELECT * FROM places WHERE id = $1', [id]);
  if (!before) refuse('No such destination.', { status: 404, code: 'not_found' });
  const fields = validate(body);
  if (!Object.keys(fields).length) refuse('Nothing has changed.', { code: 'no_change' });

  const cols = Object.keys(fields);
  const after = await one(
    `UPDATE places SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, modified_at = now() WHERE id = $1 RETURNING *`,
    [id, ...cols.map((c) => fields[c])]);

  const pick = (row) => Object.fromEntries(cols.map((c) => [c, row[c]]));
  return {
    reason: why,
    destination: shape(after, 0),
    audit: { subject: `place:${before.code}`, before: pick(before), after: pick(after) },
  };
}

/**
 * Open or close a destination for booking.
 *
 * Activating checks that it can actually take a visitor: prices, slots, places
 * and a checkpost. Deactivating does not touch passes already sold — it stops
 * new ones — and says how many are still to come.
 */
async function setActive({ id, active, reason, adminId }) {
  const why = String(reason || '').trim();
  if (why.length < 5) refuse('Say why — it is recorded in the audit log.', { code: 'reason_required' });
  const today = slotTime.nowIST().date;
  const p = await one(
    `SELECT p.*,
            (SELECT count(*) FROM place_slots s WHERE s.place_id = p.id AND s.is_active) AS slots,
            (SELECT count(*) FROM checkposts c WHERE c.place_id = p.id AND c.is_active) AS checkposts,
            (SELECT count(*) FROM place_pricing pr WHERE pr.place_id = p.id AND pr.is_active) AS prices,
            (SELECT COALESCE(sum(sc.capacity), 0) FROM slot_capacity sc JOIN place_slots s ON s.id = sc.slot_id
              WHERE sc.place_id = p.id AND s.is_active) AS daily_capacity,
            (SELECT count(*) FROM tickets t WHERE t.place_id = p.id AND t.status = 'paid' AND t.travel_date >= $2::date) AS upcoming
       FROM places p WHERE p.id = $1`, [id, today]);
  if (!p) refuse('No such destination.', { status: 404, code: 'not_found' });
  if (p.is_active === active) refuse(active ? 'It is already open.' : 'It is already closed.', { code: 'no_change' });

  const [cats] = await rowsOf('SELECT count(*) AS c FROM vehicle_categories WHERE is_active');
  const state = readiness(p, n(cats.c));
  if (active && !state.ready) {
    refuse(`This destination cannot open yet — it still needs ${state.missing.join(', and ').toLowerCase()}.`, { code: 'not_ready', detail: state.checks });
  }

  await query('UPDATE places SET is_active = $2, modified_at = now() WHERE id = $1', [id, active]);
  return {
    reason: why,
    upcoming: n(p.upcoming),
    audit: { subject: `place:${p.code}`, before: { active: p.is_active }, after: { active, upcomingPasses: n(p.upcoming) } },
  };
}

module.exports = { Refusal, list, detail, images, create, update, setActive, readiness };
