/**
 * vehicle.js — what the registration says, without holding what it should not.
 *
 * ULIP authorises by source IP, so only the deployed GaadiPe server may talk to
 * it. This app therefore asks that server's public API with an API key instead
 * of holding ULIP credentials of its own — one integration, one place where
 * upstream data is fetched and cached.
 *
 * Only the RC dataset is fetched. Challans and FASTag are irrelevant to letting
 * a vehicle up a hill, and every unnecessary upstream call is cost and latency
 * in front of a paying customer.
 *
 * WHAT IS DELIBERATELY NOT STORED: owner name, address, chassis and engine.
 * Selling entry to a hill needs the vehicle's class and nothing about its
 * owner. The snapshot keeps the raw response for re-deriving a mapping later,
 * but nothing sensitive is lifted into a column that a screen might render by
 * accident.
 */

const { query, one } = require('./db');

const BASE = () => (process.env.GATEWAY_BASE_URL || '').replace(/\/+$/, '');
const KEY = () => process.env.VEHICLE_LOOKUP_KEY;
const TIMEOUT_MS = 8000;

/** How long a stored RC is trusted before we ask again. */
const SNAPSHOT_HOURS = 24 * 30;

async function fetchDataset(regNo, dataset) {
  const url = `${BASE()}/api/v1/vehicle/${encodeURIComponent(regNo)}/${dataset}`;
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { 'x-api-key': KEY() },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await res.json().catch(() => ({}));
    return { body, ms: Date.now() - started, status: res.status };
  } catch (e) {
    // A timeout is not "no such vehicle". Telling a customer their vehicle does
    // not exist because our network was slow would be a lie that costs a sale.
    const reason = e.name === 'TimeoutError' ? 'gateway_timeout' : 'gateway_unreachable';
    return { body: { success: false, error: reason }, ms: Date.now() - started, status: 0 };
  }
}

const fetchRc = (regNo) => fetchDataset(regNo, 'rc');

/**
 * The two datasets that are not needed to sell a pass, fetched anyway.
 *
 * Only the RC decides whether a vehicle may enter and what it pays. Challans and
 * FASTag decide nothing here -- but they are fetched and kept for every plate
 * that is ever typed in, including plates that are refused, misspelt or belong
 * to a vehicle that turns out not to exist.
 *
 * WHY, GIVEN THEY ARE UNUSED. The upstream is authorised by source IP and
 * charged per call, so this cache is the only copy we will ever be able to build
 * cheaply. A plate typed once during a booking is a free opportunity to hold its
 * record; asking again later, in bulk, is neither free nor quick. The cost of
 * keeping them now is one row. The cost of not having them later is another
 * round of paid calls.
 *
 * THEY ARE FETCHED IN PARALLEL WITH THE RC, NOT AFTER IT. RC is the slow call --
 * a live VAHAN read has taken three and a half seconds -- and challans and
 * FASTag come back in about half a second each. Run together they finish inside
 * the RC's own window, so the visitor waits exactly as long as they did before.
 * Run in sequence they would add a second to every booking, which is the kind of
 * cost that is invisible in testing and obvious in a queue.
 *
 * A FAILURE HERE IS NOT A FAILURE OF THE BOOKING. Nothing downstream reads these.
 * If the gateway refuses them the outcome is logged and the pass is sold anyway.
 */
async function fetchExtras(regNo) {
  const [challans, fastag] = await Promise.all([
    fetchDataset(regNo, 'challans'),
    fetchDataset(regNo, 'fastag'),
  ]);
  return { challans, fastag };
}

async function logCall({ regNo, vehicleId, customerId, ok, outcome, ms, cacheHit, dataset }) {
  await query(
    `INSERT INTO api_calls (customer_id, vehicle_id, reg_no, provider, dataset,
                            cache_hit, ok, outcome, duration_ms)
     VALUES ($1, $2, $3, 'ulip-gateway', $4, $5, $6, $7, $8)`,
    [customerId || null, vehicleId || null, regNo, dataset || 'rc',
     !!cacheHit, !!ok, outcome || null, ms || null]);
}

/**
 * Was this a vehicle the database does not have, or a supplier we could not
 * reach? Two facts that look identical downstream and are not the same thing.
 *
 * 'no_record'     the lookup answered, and there is no such vehicle. Expected
 *                 and permanent — a pre-1989 plate, a dealer's temporary
 *                 number, a registration that has not propagated yet.
 * 'lookup_failed' we never got an answer. Temporary, and if it shows up in
 *                 bulk it means every booking that hour was priced by the
 *                 person paying, which is worth knowing about.
 *
 * LIVES HERE, NOT IN THE ROUTE. This mapping was written twice at the call site
 * and got the outage case wrong both times — once by inferring it from
 * rc_fetched_at (null in both cases) and once by matching the literal string
 * 'lookup_failed' when what fetchRc actually reports is 'gateway_timeout'. A
 * classification that depends on knowing every reason string belongs next to
 * the code that produces them.
 */
const TRANSIENT = new Set(['gateway_timeout', 'gateway_unreachable', 'lookup_failed']);
const lookupOutcome = (reason) => (TRANSIENT.has(String(reason)) ? 'lookup_failed' : 'no_record');

/**
 * Return what we know about a vehicle, fetching if needed.
 *
 * Returns { vehicle, fresh, ok, reason }. `vehicle` may be a bare row with only
 * a registration number when the lookup failed — the booking can still go ahead
 * with the customer choosing their own vehicle type, because a gateway outage
 * must not close the counter.
 */
async function resolve(regNo, { customerId, force = false } = {}) {
  const existing = await one('SELECT * FROM vehicles WHERE reg_no = $1', [regNo]);

  if (existing && !force && existing.rc_fetched_at) {
    const ageHours = (Date.now() - new Date(existing.rc_fetched_at).getTime()) / 3600000;
    if (ageHours < SNAPSHOT_HOURS) {
      await query('UPDATE vehicles SET last_seen_at = now() WHERE id = $1', [existing.id]);
      await logCall({ regNo, vehicleId: existing.id, customerId, ok: true, outcome: 'cache', cacheHit: true, ms: 0 });
      return { vehicle: existing, fresh: false, ok: true };
    }
  }

  let { body, ms } = await fetchRc(regNo);

  /* ONE RETRY, AND ONLY FOR A FAILURE TO REACH THEM.
     A single slow response used to drop the visitor straight into choosing
     their own vehicle type — and with it, their own price. Asking twice costs
     one more second on the rare bad call and nothing at all on a good one.
     A definite "no such vehicle" is NOT retried: the answer will not change,
     and a second call only makes the visitor wait to be told the same thing. */
  if (body && body.success !== true && TRANSIENT.has(String(body.error))) {
    const again = await fetchRc(regNo);
    ms += again.ms;
    if (again.body?.success === true) body = again.body;
    else body = again.body || body;
  }

  if (!body || body.success !== true || !body.rc) {
    const reason = body?.error || 'lookup_failed';
    await logCall({ regNo, vehicleId: existing?.id, customerId, ok: false, outcome: reason, ms });
    // Stale data beats no data: an RC from last month still says "Motor Car".
    if (existing) return { vehicle: existing, fresh: false, ok: true, stale: true };
    const bare = await upsertBare(regNo);
    return { vehicle: bare, fresh: false, ok: false, reason };
  }

  const v = await upsert(regNo, body.rc);
  await saveSnapshot(v.id, body.rc, body.source);
  await logCall({ regNo, vehicleId: v.id, customerId, ok: true, outcome: 'fetched', ms });
  return { vehicle: v, fresh: true, ok: true };
}

/** A row with only the plate — enough to sell a ticket the customer classifies. */
async function upsertBare(regNo) {
  const r = await query(
    `INSERT INTO vehicles (reg_no) VALUES ($1)
     ON CONFLICT (reg_no) DO UPDATE SET last_seen_at = now()
     RETURNING *`, [regNo]);
  return r.rows[0];
}

async function upsert(regNo, rc) {
  const r = await query(
    `INSERT INTO vehicles
       (reg_no, maker, model, fuel, vehicle_class, vehicle_category, body_type,
        seats, colour, reg_date, registered_at, rc_status, rc_fetched_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
     ON CONFLICT (reg_no) DO UPDATE SET
        maker            = COALESCE(EXCLUDED.maker, vehicles.maker),
        model            = COALESCE(EXCLUDED.model, vehicles.model),
        fuel             = COALESCE(EXCLUDED.fuel, vehicles.fuel),
        vehicle_class    = COALESCE(EXCLUDED.vehicle_class, vehicles.vehicle_class),
        vehicle_category = COALESCE(EXCLUDED.vehicle_category, vehicles.vehicle_category),
        body_type        = COALESCE(EXCLUDED.body_type, vehicles.body_type),
        seats            = COALESCE(EXCLUDED.seats, vehicles.seats),
        colour           = COALESCE(EXCLUDED.colour, vehicles.colour),
        reg_date         = COALESCE(EXCLUDED.reg_date, vehicles.reg_date),
        registered_at    = COALESCE(EXCLUDED.registered_at, vehicles.registered_at),
        rc_status        = COALESCE(EXCLUDED.rc_status, vehicles.rc_status),
        rc_fetched_at    = now(),
        last_seen_at     = now()
     RETURNING *`,
    [regNo, rc.maker, rc.model, rc.fuel, rc.vehicle_class, rc.vehicle_category,
     rc.body_type, rc.seats, rc.colour, rc.reg_date, rc.registered_at, rc.status]);
  return r.rows[0];
}

/**
 * Keep the whole response, minus the fields we have no business retaining.
 * Stripping happens here, once, so no later code path can accidentally persist
 * an owner's name by reading the snapshot back.
 */
async function saveSnapshot(vehicleId, data, source, dataset = 'rc') {
  const clean = { ...(data || {}) };

  /* The RC is the only dataset that carries owner identity, and it is stripped
     here rather than at the point of display so that no later reader can
     resurrect it by going back to the snapshot. Challans and FASTag are kept
     whole: neither names a person, and both are only ever read as a record of
     the vehicle. */
  if (dataset === 'rc') {
    for (const k of ['owner_name', 'address', 'chassis', 'engine', 'owner_serial',
                     'owner_type', 'owner_category', 'sale_amount']) delete clean[k];
  }

  await query(
    `INSERT INTO vehicle_snapshots (vehicle_id, dataset, data, source, expires_at)
     VALUES ($1, $2, $3, $4, now() + interval '30 days')
     ON CONFLICT (vehicle_id, dataset) DO UPDATE
       SET data = EXCLUDED.data, source = EXCLUDED.source,
           fetched_at = now(), expires_at = EXCLUDED.expires_at`,
    [vehicleId, dataset, JSON.stringify(clean), source || 'ulip']);
}

/**
 * Store whatever the two extra datasets returned, and never throw.
 *
 * Called on every path that goes upstream, including the one where the RC said
 * the vehicle does not exist -- a plate with no registration can still have a
 * FASTag record, and a plate typed by mistake is worth caching precisely once so
 * that the same typo tomorrow costs nothing.
 */
async function saveExtras(vehicleId, regNo, extras, customerId) {
  if (!vehicleId || !extras) return;
  for (const [dataset, res] of Object.entries(extras)) {
    const ok = res?.body?.success === true;
    try {
      if (ok) {
        const payload = dataset === 'fastag' ? res.body.fastag : res.body;
        await saveSnapshot(vehicleId, payload, res.body.source || 'ulip', dataset);
      }
      await logCall({
        regNo, vehicleId, customerId, dataset, ok,
        outcome: ok ? 'fetched' : (res?.body?.error || 'lookup_failed'),
        ms: res?.ms, cacheHit: !!res?.body?.cached,
      });
    } catch {
      /* A cache write that fails must not take the booking with it. */
    }
  }
}

/** One line a customer can check at a glance: "Maruti Swift · Petrol · 2019". */
/**
 * The RC record shouts. People do not.
 *
 * What arrives is "KIA INDIA PRIVATE LIMITED" and "SELTOS D1.5 6AT HTX PLUS" —
 * accurate, and unreadable on a phone. This turns it into the four things a
 * visitor recognises as their own vehicle: make, model, variant, type.
 *
 * Tokens carrying digits are left in capitals. "D1.5", "6AT" and "XUV700" are
 * codes, not words, and title-casing them produces "6at" and "Xuv700".
 */
const CORPORATE = /\b(INDIA|PRIVATE|PVT|LIMITED|LTD|LLP|COMPANY|CORP|INC)\b/g;

function titleCase(s) {
  return String(s || '').trim().split(/\s+/).map((w) => {
    if (!w) return w;
    // A token with a digit in it is a code: VXI stays VXi-ish, 6AT stays 6AT.
    if (/\d/.test(w)) return w.toUpperCase();
    return w[0].toUpperCase() + w.slice(1).toLowerCase();
  }).join(' ').trim();
}

/**
 * @returns { make, model, variant, type, fuel, seats, colour } — any of which
 *          may be null when the RC record did not carry it.
 */
function details(v) {
  if (!v) return {};

  /* "KIA INDIA PRIVATE LIMITED" -> "Kia". Corporate words are stripped rather
     than the string being truncated, so "TATA MOTORS LTD" keeps "Tata Motors"
     while losing only "LTD". */
  const make = titleCase(String(v.maker || '').replace(CORPORATE, ' ').replace(/\s+/g, ' '))
    || null;

  /* The model field usually holds the model and the variant run together:
     "SELTOS D1.5 6AT HTX PLUS". The first word is the model everyone uses; the
     rest is the trim, which matters to an owner and to nobody else. */
  const words = String(v.model || '').trim().split(/\s+/).filter(Boolean);
  const model = words.length ? titleCase(words[0]) : null;

  /* Trim codes are acronyms, not words: HTX, VXI, ZXI, LXI, AT, MT. A short
     all-capitals token of three characters or fewer stays as it is — "Htx Plus" is wrong in
     a way an owner notices immediately. */
  const variant = words.length > 1
    ? words.slice(1).map((w) => (/^[A-Z0-9.]{1,3}$/.test(w) ? w : titleCase(w))).join(' ')
    : null;

  /* vehicle_class is the readable one ("Motor Car"); body_type is the shape
     ("STATION WAGON"). Prefer the class and fall back to the body. */
  const type = titleCase(v.vehicle_class || v.body_type || v.vehicle_category) || null;

  return {
    make, model, variant, type,
    fuel: v.fuel ? titleCase(v.fuel) : null,
    seats: v.seats || null,
    colour: v.colour ? titleCase(v.colour) : null,
  };
}

/** One line: "Kia Seltos · Diesel · 2023". Kept for the chat and the caption. */
function describe(v) {
  const bits = [
    [v.maker, v.model].filter(Boolean).join(' '),
    v.fuel,
    v.reg_date ? String(v.reg_date).slice(0, 4) : null,
  ].filter(Boolean);
  return bits.join(' · ') || null;
}

/**
 * Did the RC lookup actually tell us what this vehicle IS?
 *
 * A row can exist with nothing but a plate — upsertBare() creates one whenever
 * the lookup fails, which is the normal outcome for a pre-1989 registration
 * that predates the database. Those rows must not be run through
 * categoryForVehicle(): it matches on class words, finds none, and falls
 * through to the catch-all, which charges car rates. A visitor on an old
 * two-wheeler would pay a hundred rupees instead of fifty and have no way to
 * say so.
 *
 * So the question is asked explicitly, and where the answer is no, the visitor
 * is asked what they are driving instead of being quietly guessed at.
 */
function isClassified(v) {
  return !!(v && (v.vehicle_class || v.vehicle_category || v.body_type));
}

module.exports = { resolve, describe, details, upsertBare, isClassified, lookupOutcome };
