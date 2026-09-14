/**
 * adminSettings.js — changing how Pravesha runs, from the panel.
 *
 * Every function here changes something a visitor, a gate or an invoice depends
 * on, so every one of them:
 *
 *   * validates before it writes, and refuses with a sentence;
 *   * writes inside a transaction, so a half-applied change cannot exist;
 *   * returns what it was and what it became, for the audit log;
 *   * clears the settings cache, so the next booking uses the new value now.
 *
 * PRICES ARE NEVER EDITED IN PLACE. A price change deactivates the current row
 * and inserts a new one effective from this moment, so the history of what a
 * vehicle cost, and when, survives — and a pass already held or paid for keeps
 * the amounts stored on it.
 *
 * THE SERVICE FEE PERCENTAGE IS ARITHMETIC, NOT A LABEL. Until this existed it
 * only changed a caption; the charged fee was a separate number per vehicle.
 * Setting it here recomputes each vehicle's fee from its entry price, rounded to
 * the whole rupee exactly as the original prices were (13% of ₹50 is ₹6.50,
 * charged as ₹7).
 */

const crypto = require('crypto');
const { query, one, tx } = require('./db');
const settings = require('./settings');
const slotTime = require('./slotTime');
const staffModule = require('./staff');
const admin = require('./admin');
const permissions = require('./permissions');

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

const requireReason = (reason) => {
  const r = String(reason || '').trim();
  if (r.length < 5) refuse('Give a reason for this change — it is recorded in the audit log.', { code: 'reason_required' });
  return r;
};

async function defaultPlace(placeId) {
  const p = placeId
    ? await one(`SELECT * FROM places WHERE id = $1`, [placeId])
    : await one(`SELECT * FROM places WHERE is_active ORDER BY id LIMIT 1`);
  if (!p) refuse('No such destination.', { status: 404, code: 'not_found' });
  return p;
}

/* ─────────────────────────────────────────────────────────────── pricing ── */

async function pricing({ placeId } = {}) {
  const place = await defaultPlace(placeId);
  const [feePercent, gstPercent, rows, history, places] = await Promise.all([
    settings.num('platform_fee_percent', 13),
    settings.num('gst_percent_on_platform', 18),
    rowsOf(
      `SELECT c.id AS category_id, c.code, c.label, p.entry_paise, p.platform_paise, p.effective_from
         FROM vehicle_categories c
         LEFT JOIN LATERAL (
           SELECT entry_paise, platform_paise, effective_from FROM place_pricing
            WHERE place_id = $1 AND category_id = c.id AND is_active
            ORDER BY effective_from DESC LIMIT 1) p ON true
        WHERE c.is_active ORDER BY c.sort_order`, [place.id]),
    rowsOf(
      `SELECT c.code, c.label, p.entry_paise, p.platform_paise, p.effective_from, p.is_active
         FROM place_pricing p JOIN vehicle_categories c ON c.id = p.category_id
        WHERE p.place_id = $1 ORDER BY p.effective_from DESC, c.sort_order LIMIT 40`, [place.id]),
    rowsOf(`SELECT id, name, is_active FROM places ORDER BY is_active DESC, id`),
  ]);

  return {
    place: { id: String(place.id), name: place.name },
    places: places.map((p) => ({ id: String(p.id), name: p.name, active: p.is_active })),
    serviceFeePercent: feePercent,
    gstPercent,
    gstInclusive: true,
    categories: rows.map((r) => {
      const entry = Math.round(n(r.entry_paise) / 100);
      const fee = Math.round(n(r.platform_paise) / 100);
      const base = Math.round((n(r.platform_paise) * 100) / (100 + gstPercent)) / 100;
      return {
        code: r.code, label: r.label, entry, serviceFee: fee, total: entry + fee,
        gstWithinFee: Math.round((fee - base) * 100) / 100,
        effectiveFrom: r.effective_from,
      };
    }),
    history: history.map((h) => ({
      code: h.code, label: h.label, entry: Math.round(n(h.entry_paise) / 100),
      serviceFee: Math.round(n(h.platform_paise) / 100), effectiveFrom: h.effective_from, current: h.is_active,
    })),
    /* Not in the product: a separately itemised charge. Stated, so nobody looks for it. */
    otherCharges: null,
  };
}

/** The fee a price carries at a percentage, rounded to the whole rupee. */
const feeFor = (entryRupees, percent) => Math.round((entryRupees * percent) / 100);

async function updatePricing({ placeId, serviceFeePercent, entries = {}, reason }) {
  const why = requireReason(reason);
  const place = await defaultPlace(placeId);
  const pct = Number(serviceFeePercent);
  if (!Number.isFinite(pct) || pct < 0 || pct > 50) refuse('The service fee must be between 0% and 50%.');

  const before = await pricing({ placeId: place.id });
  const cats = await rowsOf(`SELECT id, code, label FROM vehicle_categories WHERE is_active ORDER BY sort_order`);

  const plan = cats.map((c) => {
    const current = before.categories.find((x) => x.code === c.code) || {};
    const asked = entries[c.code] === undefined || entries[c.code] === '' ? current.entry : Number(entries[c.code]);
    if (!Number.isInteger(asked) || asked < 1 || asked > 100000) {
      refuse(`${c.label}: the entry price must be a whole number of rupees between ₹1 and ₹1,00,000.`);
    }
    const fee = feeFor(asked, pct);
    return { id: c.id, code: c.code, label: c.label, entry: asked, serviceFee: fee,
      changed: asked !== current.entry || fee !== current.serviceFee, was: { entry: current.entry, serviceFee: current.serviceFee } };
  });

  const changed = plan.filter((p) => p.changed);
  if (!changed.length && pct === before.serviceFeePercent) {
    refuse('Nothing has changed.', { code: 'no_change' });
  }

  await tx(async (client) => {
    for (const p of changed) {
      await client.query(`UPDATE place_pricing SET is_active = false WHERE place_id = $1 AND category_id = $2 AND is_active`, [place.id, p.id]);
      await client.query(
        `INSERT INTO place_pricing (place_id, category_id, entry_paise, platform_paise, effective_from, is_active)
         VALUES ($1,$2,$3,$4, now(), true)`, [place.id, p.id, p.entry * 100, p.serviceFee * 100]);
    }
    await client.query(
      `INSERT INTO app_settings (key, value) VALUES ('platform_fee_percent', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, modified_at = now()`, [String(pct)]);
  });
  settings.clear();

  const after = await pricing({ placeId: place.id });
  return {
    reason: why,
    audit: {
      subject: `pricing:${place.code || place.id}`,
      before: { serviceFeePercent: before.serviceFeePercent, prices: before.categories.map(({ code, entry, serviceFee }) => ({ code, entry, serviceFee })) },
      after: { serviceFeePercent: after.serviceFeePercent, prices: after.categories.map(({ code, entry, serviceFee }) => ({ code, entry, serviceFee })) },
    },
    pricing: after,
    changed: changed.map(({ code, label, entry, serviceFee, was }) => ({ code, label, entry, serviceFee, was })),
  };
}

/* ───────────────────────────────────────────────────────────────── slots ── */

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const hm = (t) => String(t || '').slice(0, 5);

async function slots({ placeId } = {}) {
  const place = await defaultPlace(placeId);
  const today = slotTime.nowIST().date;
  const rows = await rowsOf(
    `SELECT s.*, (SELECT count(*) FROM tickets t WHERE t.slot_id = s.id) AS tickets_ever,
            (SELECT count(*) FROM tickets t WHERE t.slot_id = s.id AND t.status IN ('paid','held') AND t.travel_date >= $2::date) AS upcoming
       FROM place_slots s WHERE s.place_id = $1 ORDER BY s.is_active DESC, s.starts_at`, [place.id, today]);
  const caps = await rowsOf(
    `SELECT sc.slot_id, c.code, c.label, sc.capacity FROM slot_capacity sc
       JOIN vehicle_categories c ON c.id = sc.category_id WHERE sc.place_id = $1 ORDER BY c.sort_order`, [place.id]);
  const cats = await rowsOf(`SELECT code, label FROM vehicle_categories WHERE is_active ORDER BY sort_order`);

  return {
    place: { id: String(place.id), name: place.name },
    categories: cats,
    slots: rows.map((s) => {
      const mine = caps.filter((c) => String(c.slot_id) === String(s.id));
      const capacities = Object.fromEntries(cats.map((c) => [c.code, n(mine.find((m) => m.code === c.code)?.capacity)]));
      return {
        id: String(s.id), code: s.code, label: s.label, labelKn: s.label_kn,
        startsAt: hm(s.starts_at), endsAt: hm(s.ends_at),
        validFrom: s.valid_from ? String(s.valid_from instanceof Date ? s.valid_from.toISOString() : s.valid_from).slice(0, 10) : null,
        validTo: s.valid_to ? String(s.valid_to instanceof Date ? s.valid_to.toISOString() : s.valid_to).slice(0, 10) : null,
        active: s.is_active,
        capacities,
        capacity: Object.values(capacities).reduce((a, b) => a + b, 0),
        ticketsEver: n(s.tickets_ever),
        upcoming: n(s.upcoming),
        deletable: n(s.tickets_ever) === 0,
      };
    }),
  };
}

function validateSlot(body, cats) {
  const label = String(body.label || '').trim();
  if (label.length < 3) refuse('Give the slot a name, e.g. "Morning 6:00 AM - 12:00 PM".');
  if (!TIME.test(String(body.startsAt || '')) || !TIME.test(String(body.endsAt || ''))) refuse('Start and end must be times like 06:00.');
  if (body.startsAt >= body.endsAt) refuse('The slot must end after it starts.');
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  if (toMin(body.endsAt) - toMin(body.startsAt) < 90) refuse('A slot must be at least 90 minutes long — entry closes an hour before it ends.');
  if (body.validFrom && !DATE.test(body.validFrom)) refuse('The opening date is not a date.');
  if (body.validTo && !DATE.test(body.validTo)) refuse('The closing date is not a date.');
  if (body.validFrom && body.validTo && body.validFrom > body.validTo) refuse('The slot must open before it closes.');

  const capacities = {};
  for (const c of cats) {
    const v = body.capacities?.[c.code];
    const num = v === undefined || v === '' ? 0 : Number(v);
    if (!Number.isInteger(num) || num < 0 || num > 100000) refuse(`${c.label}: capacity must be a whole number, 0 or more.`);
    capacities[c.code] = num;
  }
  if (Object.values(capacities).every((x) => x === 0)) refuse('Give at least one vehicle type some capacity.');

  return {
    label, labelKn: String(body.labelKn || '').trim() || null,
    startsAt: body.startsAt, endsAt: body.endsAt,
    validFrom: body.validFrom || null, validTo: body.validTo || null,
    active: body.active !== false, capacities,
  };
}

/**
 * Another active slot at the same place whose hours overlap these on at least
 * one shared date. A slot that only runs in October does not clash with one
 * that closed in September, even at the same hours.
 */
async function overlapping(client, placeId, { startsAt, endsAt, validFrom, validTo }, exceptId = null) {
  const r = await client.query(
    `SELECT label FROM place_slots WHERE place_id = $1 AND is_active AND ($4::bigint IS NULL OR id <> $4)
        AND starts_at < $3::time AND ends_at > $2::time
        AND COALESCE(valid_from, '-infinity'::date) <= COALESCE($6::date, 'infinity'::date)
        AND COALESCE(valid_to, 'infinity'::date) >= COALESCE($5::date, '-infinity'::date)
      LIMIT 1`, [placeId, startsAt, endsAt, exceptId, validFrom, validTo]);
  return r.rows[0] || null;
}

/**
 * Apply per-type capacity to the slot's defaults and to every open date ahead.
 *
 * Dates already open carry their own copy of the capacity (slot_inventory), so
 * changing only the default would reach new dates and leave next weekend on the
 * old number. A date that has already sold more than the new capacity keeps what
 * it sold — nobody's pass is taken away — and is reported back.
 */
async function applyCapacity(client, placeId, slotId, capacities, cats) {
  const today = slotTime.nowIST().date;
  const oversold = [];
  for (const c of cats) {
    const cap = capacities[c.code];
    const cat = (await client.query(`SELECT id FROM vehicle_categories WHERE code = $1`, [c.code])).rows[0];
    await client.query(
      `INSERT INTO slot_capacity (place_id, slot_id, category_id, capacity) VALUES ($1,$2,$3,$4)
       ON CONFLICT (place_id, slot_id, category_id) DO UPDATE SET capacity = EXCLUDED.capacity`,
      [placeId, slotId, cat.id, cap]).catch(async (e) => {
      /* No unique index to conflict on in older schemas: update, then insert. */
      if (e.code !== '42P10') throw e;
      const u = await client.query(`UPDATE slot_capacity SET capacity = $4 WHERE place_id = $1 AND slot_id = $2 AND category_id = $3`, [placeId, slotId, cat.id, cap]);
      if (!u.rowCount) await client.query(`INSERT INTO slot_capacity (place_id, slot_id, category_id, capacity) VALUES ($1,$2,$3,$4)`, [placeId, slotId, cat.id, cap]);
    });
    const hit = await client.query(
      `UPDATE slot_inventory SET capacity = GREATEST($4::int, booked + held), modified_at = now()
        WHERE place_id = $1 AND slot_id = $2 AND category_id = $3 AND travel_date >= $5::date
        RETURNING travel_date, booked, held, capacity`, [placeId, slotId, cat.id, cap, today]);
    hit.rows.filter((r) => n(r.booked) + n(r.held) > cap).forEach((r) => oversold.push({
      code: c.code, label: c.label, date: String(r.travel_date instanceof Date ? r.travel_date.toISOString() : r.travel_date).slice(0, 10),
      sold: n(r.booked) + n(r.held), capacity: cap,
    }));
  }
  return oversold;
}

async function createSlot({ placeId, body, reason }) {
  const why = requireReason(reason);
  const place = await defaultPlace(placeId);
  const cats = await rowsOf(`SELECT code, label FROM vehicle_categories WHERE is_active ORDER BY sort_order`);
  const s = validateSlot(body, cats);

  const created = await tx(async (client) => {
    if (s.active) {
      const clash = await overlapping(client, place.id, s);
      if (clash) refuse(`These hours overlap "${clash.label}". Visitors could not tell the two apart.`, { code: 'overlap' });
    }
    const code = `${s.startsAt.replace(':', '').slice(0, 2)}${s.endsAt.replace(':', '').slice(0, 2)}`;
    const exists = (await client.query(`SELECT 1 FROM place_slots WHERE place_id = $1 AND code = $2`, [place.id, code])).rows[0];
    const finalCode = exists ? `${code}${crypto.randomBytes(1).toString('hex')}` : code;
    const order = (await client.query(`SELECT COALESCE(max(sort_order), 0) + 10 AS o FROM place_slots WHERE place_id = $1`, [place.id])).rows[0].o;
    const row = (await client.query(
      `INSERT INTO place_slots (place_id, code, label, label_kn, starts_at, ends_at, sort_order, is_active, valid_from, valid_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [place.id, finalCode, s.label, s.labelKn, s.startsAt, s.endsAt, order, s.active, s.validFrom, s.validTo])).rows[0];
    await applyCapacity(client, place.id, row.id, s.capacities, cats);
    return row;
  });

  const after = (await slots({ placeId: place.id })).slots.find((x) => x.id === String(created.id));
  return { reason: why, slot: after, audit: { subject: `slot:${created.id}`, before: null, after } };
}

async function updateSlot({ slotId, body, reason }) {
  const why = requireReason(reason);
  const existing = await one(`SELECT * FROM place_slots WHERE id = $1`, [slotId]);
  if (!existing) refuse('No such slot.', { status: 404, code: 'not_found' });
  const cats = await rowsOf(`SELECT code, label FROM vehicle_categories WHERE is_active ORDER BY sort_order`);
  const before = (await slots({ placeId: existing.place_id })).slots.find((x) => x.id === String(slotId));
  const s = validateSlot(body, cats);

  /* A slot with passes sold must keep its hours: changing them would move
     somebody's booked morning to an afternoon they did not choose. */
  const today = slotTime.nowIST().date;
  const sold = n((await one(`SELECT count(*) AS c FROM tickets WHERE slot_id = $1 AND status IN ('paid','held') AND travel_date >= $2::date`, [slotId, today])).c);
  if (sold && (s.startsAt !== before.startsAt || s.endsAt !== before.endsAt)) {
    refuse(`${sold} upcoming pass${sold === 1 ? ' is' : 'es are'} booked in this slot, so its hours cannot change. Close it on a date and create a new slot instead.`, { code: 'has_bookings' });
  }

  const oversold = await tx(async (client) => {
    if (s.active) {
      const clash = await overlapping(client, existing.place_id, s, slotId);
      if (clash) refuse(`These hours overlap "${clash.label}".`, { code: 'overlap' });
    }
    await client.query(
      `UPDATE place_slots SET label = $2, label_kn = $3, starts_at = $4, ends_at = $5, is_active = $6,
              valid_from = $7, valid_to = $8, modified_at = now() WHERE id = $1`,
      [slotId, s.label, s.labelKn, s.startsAt, s.endsAt, s.active, s.validFrom, s.validTo]);
    return applyCapacity(client, existing.place_id, slotId, s.capacities, cats);
  });

  const after = (await slots({ placeId: existing.place_id })).slots.find((x) => x.id === String(slotId));
  return { reason: why, slot: after, oversold, audit: { subject: `slot:${slotId}`, before, after } };
}

async function deleteSlot({ slotId, reason }) {
  const why = requireReason(reason);
  const existing = await one(`SELECT * FROM place_slots WHERE id = $1`, [slotId]);
  if (!existing) refuse('No such slot.', { status: 404, code: 'not_found' });
  const before = (await slots({ placeId: existing.place_id })).slots.find((x) => x.id === String(slotId));
  if (before.ticketsEver > 0) {
    refuse(`This slot has ${before.ticketsEver} pass${before.ticketsEver === 1 ? '' : 'es'} on record, which must stay traceable. Mark it inactive or give it a closing date instead.`,
      { status: 409, code: 'has_history' });
  }
  await tx(async (client) => {
    await client.query(`DELETE FROM slot_inventory WHERE slot_id = $1`, [slotId]);
    await client.query(`DELETE FROM slot_capacity WHERE slot_id = $1`, [slotId]);
    await client.query(`DELETE FROM place_slots WHERE id = $1`, [slotId]);
  });
  return { reason: why, audit: { subject: `slot:${slotId}`, before, after: null } };
}

/* ─────────────────────────────────────────────────────── checkpost staff ── */

/* No PIN is issued. An enabled mobile number is the access: the gate app sends
   a code only to an active staff member's number (staffOtp.js). */

async function staffList() {
  const today = slotTime.nowIST().date;
  const rows = await rowsOf(
    `SELECT s.id, s.name, s.mobile, s.is_active, s.locked_until, s.failed_attempts, s.created_at,
            COALESCE(json_agg(json_build_object('id', c.id, 'name', c.name)) FILTER (WHERE c.id IS NOT NULL), '[]') AS checkposts,
            (SELECT started_at FROM staff_sessions ss WHERE ss.staff_id = s.id AND ss.ended_at IS NULL LIMIT 1) AS on_duty_since,
            (SELECT max(scanned_at) FROM scans sc WHERE sc.staff_id = s.id) AS last_check,
            (SELECT count(*) FROM scans sc WHERE sc.staff_id = s.id AND (sc.scanned_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date) AS checks_today,
            (SELECT count(*) FROM scans sc WHERE sc.staff_id = s.id AND sc.scanned_at > now() - interval '7 days') AS checks_week
       FROM staff s
       LEFT JOIN staff_checkposts sc ON sc.staff_id = s.id
       LEFT JOIN checkposts c ON c.id = sc.checkpost_id
      GROUP BY s.id ORDER BY s.is_active DESC, s.name`, [today]);
  const checkposts = await rowsOf(`SELECT c.id, c.name, p.name AS place FROM checkposts c JOIN places p ON p.id = c.place_id WHERE c.is_active ORDER BY c.id`);
  return {
    checkposts: checkposts.map((c) => ({ id: String(c.id), name: c.name, place: c.place })),
    staff: rows.map((r) => ({
      id: String(r.id), name: r.name, mobile: r.mobile ? `••••${String(r.mobile).slice(-4)}` : null,
      active: r.is_active, locked: Boolean(r.locked_until && new Date(r.locked_until) > new Date()),
      checkposts: r.checkposts.map((c) => ({ id: String(c.id), name: c.name })),
      onDutySince: r.on_duty_since, lastCheck: r.last_check,
      checksToday: n(r.checks_today), checksWeek: n(r.checks_week), since: r.created_at,
    })),
  };
}

async function validateCheckposts(ids) {
  const list = [...new Set((ids || []).map(String))];
  if (!list.length) refuse('Assign at least one checkpost.');
  const found = await rowsOf(`SELECT id FROM checkposts WHERE id = ANY($1::bigint[]) AND is_active`, [list]);
  if (found.length !== list.length) refuse('One of those checkposts does not exist.');
  return list;
}

async function addStaff({ body, reason }) {
  const why = requireReason(reason);
  const name = String(body.name || '').trim();
  if (name.length < 2) refuse('Give the staff member’s name.');
  const mobile = staffModule.localMobile(body.mobile);
  if (mobile.length !== 10) refuse('The mobile number must be ten digits.');
  if (await one(`SELECT 1 FROM staff WHERE mobile = $1`, [mobile])) refuse('Staff with that mobile number already exist.', { status: 409, code: 'exists' });
  const checkpostIds = await validateCheckposts(body.checkpostIds);
  const row = await staffModule.upsert({ name, mobile, checkpostIds });
  return { reason: why, staff: { id: String(row.id), name: row.name },
    audit: { subject: `staff:${row.id}`, before: null, after: { name, mobile: `••••${mobile.slice(-4)}`, checkpostIds } } };
}

async function updateStaff({ staffId, body, reason }) {
  const why = requireReason(reason);
  const s = await one(`SELECT * FROM staff WHERE id = $1`, [staffId]);
  if (!s) refuse('No such staff member.', { status: 404, code: 'not_found' });
  const before = (await staffList()).staff.find((x) => x.id === String(staffId));
  const name = String(body.name || s.name).trim();
  const mobile = body.mobile ? staffModule.localMobile(body.mobile) : s.mobile;
  if (mobile.length !== 10) refuse('The mobile number must be ten digits.');
  if (mobile !== s.mobile && await one(`SELECT 1 FROM staff WHERE mobile = $1`, [mobile])) refuse('Another staff member has that mobile number.', { status: 409 });
  const checkpostIds = body.checkpostIds ? await validateCheckposts(body.checkpostIds) : null;
  await tx(async (client) => {
    await client.query(`UPDATE staff SET name = $2, mobile = $3, modified_at = now() WHERE id = $1`, [staffId, name, mobile]);
    if (checkpostIds) {
      await client.query(`DELETE FROM staff_checkposts WHERE staff_id = $1`, [staffId]);
      for (const id of checkpostIds) await client.query(`INSERT INTO staff_checkposts (staff_id, checkpost_id) VALUES ($1,$2)`, [staffId, id]);
      /* A shift open at a gate they are no longer posted to ends now. */
      await client.query(`UPDATE staff_sessions SET ended_at = now(), ended_reason = 'signed_out'
                           WHERE staff_id = $1 AND ended_at IS NULL AND NOT (checkpost_id = ANY($2::bigint[]))`, [staffId, checkpostIds]);
    }
  });
  const after = (await staffList()).staff.find((x) => x.id === String(staffId));
  return { reason: why, staff: after, audit: { subject: `staff:${staffId}`, before, after } };
}

async function setStaffActive({ staffId, active, reason }) {
  const why = requireReason(reason);
  const s = await one(`SELECT id, name, is_active FROM staff WHERE id = $1`, [staffId]);
  if (!s) refuse('No such staff member.', { status: 404, code: 'not_found' });
  await tx(async (client) => {
    await client.query(`UPDATE staff SET is_active = $2, modified_at = now() WHERE id = $1`, [staffId, active]);
    /* Disabling ends the shift, or the phone in their hand keeps working. */
    if (!active) await client.query(`UPDATE staff_sessions SET ended_at = now(), ended_reason = 'signed_out' WHERE staff_id = $1 AND ended_at IS NULL`, [staffId]);
  });
  return { reason: why, audit: { subject: `staff:${staffId}`, before: { active: s.is_active }, after: { active } } };
}

async function staffActivity(staffId) {
  const rows = await rowsOf(
    `SELECT sc.verdict, sc.scanned_at, sc.ticket_no, sc.reg_no, sc.duration_ms, cp.name AS checkpost
       FROM scans sc LEFT JOIN checkposts cp ON cp.id = sc.checkpost_id
      WHERE sc.staff_id = $1 ORDER BY sc.scanned_at DESC LIMIT 50`, [staffId]);
  const shifts = await rowsOf(
    `SELECT ss.started_at, ss.ended_at, ss.ended_reason, cp.name AS checkpost
       FROM staff_sessions ss LEFT JOIN checkposts cp ON cp.id = ss.checkpost_id
      WHERE ss.staff_id = $1 ORDER BY ss.started_at DESC LIMIT 20`, [staffId]);
  return {
    checks: rows.map((r) => ({ verdict: r.verdict, at: r.scanned_at, ticketNo: r.ticket_no, regNo: r.reg_no, durationMs: r.duration_ms, checkpost: r.checkpost })),
    shifts: shifts.map((s) => ({ startedAt: s.started_at, endedAt: s.ended_at, endedReason: s.ended_reason, checkpost: s.checkpost })),
  };
}

/* ─────────────────────────────────────────────────────────── panel users ── */

const WORDS = ['ridge', 'monsoon', 'summit', 'coffee', 'cloud', 'valley', 'shola', 'peak', 'trail', 'mist'];
const newPassword = () => `${WORDS[crypto.randomInt(WORDS.length)]}-${WORDS[crypto.randomInt(WORDS.length)]}-${crypto.randomInt(10, 100)}`;

async function users() {
  const rows = await rowsOf(
    `SELECT u.id, u.name, u.mobile, u.role, u.is_active, u.last_login_at, u.locked_until, u.created_at,
            (SELECT count(*) FROM admin_sessions s WHERE s.admin_id = u.id AND s.ended_at IS NULL) AS open_sessions
       FROM admin_users u ORDER BY u.is_active DESC, u.id`);
  return {
    roles: Object.entries(permissions.ROLES).filter(([k]) => k !== 'department')
      .map(([key, r]) => ({ key, label: r.label, description: r.description })),
    users: rows.map((u) => ({
      id: String(u.id), name: u.name, mobile: `••••${String(u.mobile).slice(-4)}`, role: u.role,
      roleLabel: permissions.ROLES[u.role]?.label || u.role, active: u.is_active,
      locked: Boolean(u.locked_until && new Date(u.locked_until) > new Date()),
      lastLogin: u.last_login_at, since: u.created_at, openSessions: n(u.open_sessions),
    })),
  };
}

const validRole = (role) => {
  if (!permissions.ROLES[role] || role === 'department') refuse('Choose a role.');
  return role;
};

async function activeSuperAdmins(client, exceptId) {
  const r = await client.query(`SELECT count(*) AS c FROM admin_users WHERE role = 'super_admin' AND is_active AND id <> $1`, [exceptId]);
  return n(r.rows[0].c);
}

async function addUser({ body, reason }) {
  const why = requireReason(reason);
  const name = String(body.name || '').trim();
  if (name.length < 2) refuse('Give the user’s name.');
  const mobile = admin.localMobile(body.mobile);
  if (mobile.length !== 10) refuse('The mobile number must be ten digits.');
  if (await one(`SELECT 1 FROM admin_users WHERE mobile = $1`, [mobile])) refuse('A panel user with that mobile already exists.', { status: 409 });
  const role = validRole(body.role);
  const password = newPassword();
  const row = await admin.upsert({ name, mobile, password, role });
  return { reason: why, password, user: { id: String(row.id), name: row.name, role },
    audit: { subject: `admin_user:${row.id}`, before: null, after: { name, role } } };
}

async function updateUser({ userId, body, reason, actorId }) {
  const why = requireReason(reason);
  const u = await one(`SELECT * FROM admin_users WHERE id = $1`, [userId]);
  if (!u) refuse('No such user.', { status: 404, code: 'not_found' });
  const role = body.role ? validRole(body.role) : u.role;
  const name = String(body.name || u.name).trim();
  if (String(userId) === String(actorId) && role !== u.role) refuse('You cannot change your own role.', { code: 'self' });
  await tx(async (client) => {
    if (u.role === 'super_admin' && role !== 'super_admin' && await activeSuperAdmins(client, u.id) === 0) {
      refuse('This is the last super administrator. Make someone else super admin first.', { code: 'last_super_admin' });
    }
    await client.query(`UPDATE admin_users SET name = $2, role = $3, modified_at = now() WHERE id = $1`, [userId, name, role]);
  });
  return { reason: why, audit: { subject: `admin_user:${userId}`, before: { name: u.name, role: u.role }, after: { name, role } } };
}

async function setUserActive({ userId, active, reason, actorId }) {
  const why = requireReason(reason);
  const u = await one(`SELECT * FROM admin_users WHERE id = $1`, [userId]);
  if (!u) refuse('No such user.', { status: 404, code: 'not_found' });
  if (String(userId) === String(actorId) && !active) refuse('You cannot disable your own account.', { code: 'self' });
  await tx(async (client) => {
    if (!active && u.role === 'super_admin' && await activeSuperAdmins(client, u.id) === 0) {
      refuse('This is the last active super administrator.', { code: 'last_super_admin' });
    }
    await client.query(`UPDATE admin_users SET is_active = $2, modified_at = now() WHERE id = $1`, [userId, active]);
    if (!active) await client.query(`UPDATE admin_sessions SET ended_at = now() WHERE admin_id = $1 AND ended_at IS NULL`, [userId]);
  });
  return { reason: why, audit: { subject: `admin_user:${userId}`, before: { active: u.is_active }, after: { active } } };
}

async function resetUserPassword({ userId, reason }) {
  const why = requireReason(reason);
  const u = await one(`SELECT id FROM admin_users WHERE id = $1`, [userId]);
  if (!u) refuse('No such user.', { status: 404, code: 'not_found' });
  const password = newPassword();
  await tx(async (client) => {
    await client.query(`UPDATE admin_users SET password_hash = $2, failed_attempts = 0, locked_until = NULL, modified_at = now() WHERE id = $1`,
      [userId, await admin.hashPassword(password)]);
    await client.query(`UPDATE admin_sessions SET ended_at = now() WHERE admin_id = $1 AND ended_at IS NULL`, [userId]);
  });
  return { reason: why, password, audit: { subject: `admin_user:${userId}`, before: null, after: { passwordReset: true } } };
}

/* ─────────────────────────────────────────────────────── GST and business ── */

const GST_FIELDS = {
  gst_percent_on_platform: 'gstPercent',
  gstin: 'gstin',
  legal_name: 'legalName',
  legal_form: 'legalForm',
  business_address: 'address',
  udyam_number: 'udyam',
  contact_email: 'email',
  website: 'website',
  invoice_prefix: 'invoicePrefix',
  sac_code: 'sacCode',
  place_of_supply: 'placeOfSupply',
};

async function gst() {
  const all = await settings.all();
  const get = (k, fb = '') => (all.get(k) === undefined ? fb : all.get(k));
  const seq = await one(`SELECT last_value, is_called FROM pravesha_invoice_seq`).catch(() => null);
  const nextSeq = seq ? (seq.is_called ? n(seq.last_value) + 1 : n(seq.last_value)) : 1;
  const invoices = require('./invoices');
  const out = {
    gstInclusive: true,
    gstInclusiveNote: 'The service fee shown to a visitor includes GST. Consumer prices in India are displayed tax-inclusive, and '
      + 'switching to tax-exclusive would change the amount on every booking screen, pass and invoice, so it is not offered.',
    nextInvoiceNo: invoices.formatNo(nextSeq, undefined, get('invoice_prefix', 'PRV')),
  };
  for (const [key, field] of Object.entries(GST_FIELDS)) out[field] = get(key, key === 'sac_code' ? '998559' : key === 'place_of_supply' ? '29-Karnataka' : '');
  out.gstPercent = Number(out.gstPercent || 18);
  return out;
}

async function updateGst({ body, reason }) {
  const why = requireReason(reason);
  const before = await gst();
  const next = { ...before };

  if (body.gstPercent !== undefined) {
    const g = Number(body.gstPercent);
    if (![0, 5, 12, 18, 28].includes(g)) refuse('GST must be one of the notified rates: 0, 5, 12, 18 or 28%.');
    next.gstPercent = g;
  }
  if (body.gstin !== undefined) {
    const g = String(body.gstin).trim().toUpperCase();
    if (g && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) refuse('That is not a valid GSTIN (15 characters, e.g. 29ABCDE1234F1Z5).');
    next.gstin = g;
  }
  if (body.invoicePrefix !== undefined) {
    const p = String(body.invoicePrefix).trim().toUpperCase();
    /* PREFIX/YY-YY/000000 must fit the sixteen characters a GST invoice number may carry. */
    if (!/^[A-Z0-9]{1,3}$/.test(p)) refuse('The invoice prefix must be one to three letters or digits, so the number stays within 16 characters.');
    next.invoicePrefix = p;
  }
  for (const f of ['legalName', 'legalForm', 'address', 'udyam', 'email', 'website', 'sacCode', 'placeOfSupply']) {
    if (body[f] !== undefined) next[f] = String(body[f]).trim().slice(0, 300);
  }
  if (next.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(next.email)) refuse('The contact email is not valid.');
  if (!next.legalName) refuse('The legal name cannot be empty — it is printed on every invoice.');

  const changes = Object.entries(GST_FIELDS).filter(([, field]) => String(next[field]) !== String(before[field]));
  if (!changes.length) refuse('Nothing has changed.', { code: 'no_change' });

  await tx(async (client) => {
    for (const [key, field] of changes) {
      await client.query(
        `INSERT INTO app_settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, modified_at = now()`, [key, String(next[field])]);
    }
  });
  settings.clear();
  const after = await gst();
  const pick = (o) => Object.fromEntries(changes.map(([, f]) => [f, o[f]]));
  return { reason: why, gst: after, audit: { subject: 'settings:gst_business', before: pick(before), after: pick(after) } };
}

/* ─────────────────────────────────────────────────────────────── audit ── */

async function auditLog({ q = null, action = null, adminId = null, from = null, to = null, before = null, limit = 50 } = {}) {
  const size = Math.max(1, Math.min(200, Number(limit) || 50));
  const rows = await rowsOf(
    `SELECT a.id, a.action, a.subject, a.detail, a.ip, a.before_value, a.after_value, a.reason, a.session_id, a.created_at,
            u.name AS admin_name, u.role AS admin_role
       FROM admin_audit a LEFT JOIN admin_users u ON u.id = a.admin_id
      WHERE ($1::text IS NULL OR a.action ILIKE '%' || $1 || '%' OR a.subject ILIKE '%' || $1 || '%' OR a.reason ILIKE '%' || $1 || '%' OR u.name ILIKE '%' || $1 || '%')
        AND ($2::text IS NULL OR a.action = $2)
        AND ($3::bigint IS NULL OR a.admin_id = $3)
        AND ($4::date IS NULL OR (a.created_at AT TIME ZONE 'Asia/Kolkata')::date >= $4::date)
        AND ($5::date IS NULL OR (a.created_at AT TIME ZONE 'Asia/Kolkata')::date <= $5::date)
        AND ($6::bigint IS NULL OR a.id < $6)
      ORDER BY a.id DESC LIMIT $7`,
    [q || null, action || null, adminId || null, from || null, to || null, before || null, size + 1]);
  const actions = await rowsOf(`SELECT action, count(*) AS c FROM admin_audit GROUP BY action ORDER BY c DESC`);
  const people = await rowsOf(`SELECT DISTINCT u.id, u.name FROM admin_audit a JOIN admin_users u ON u.id = a.admin_id ORDER BY u.name`);
  const hasMore = rows.length > size;
  const page = hasMore ? rows.slice(0, size) : rows;
  return {
    entries: page.map((r) => ({
      id: String(r.id), action: r.action, subject: r.subject, at: r.created_at,
      who: r.admin_name || 'System', role: permissions.ROLES[r.admin_role]?.label || r.admin_role || null,
      before: r.before_value, after: r.after_value, reason: r.reason, detail: r.detail,
      ip: r.ip, sessionId: r.session_id ? String(r.session_id) : null,
    })),
    hasMore,
    nextCursor: hasMore ? String(page[page.length - 1].id) : null,
    actions: actions.map((a) => ({ action: a.action, count: n(a.c) })),
    people: people.map((p) => ({ id: String(p.id), name: p.name })),
  };
}

module.exports = {
  Refusal, pricing, updatePricing, slots, createSlot, updateSlot, deleteSlot,
  staffList, addStaff, updateStaff, setStaffActive, staffActivity,
  users, addUser, updateUser, setUserActive, resetUserPassword, gst, updateGst, auditLog, feeFor,
};
