/**
 * vehicle.js — what the registration says, without holding what it should not.
 *
 * ULIP authorises by source IP. On the deployed Pravesha server, whitelisted
 * with ULIP, vehicle data comes straight from ULIP (VEHICLE_SOURCE=ulip, the
 * modules in src/ulip ported from the GaadiPe gateway). Anywhere else it comes
 * from the gateway's public API (VEHICLE_SOURCE=gateway), with the same
 * responses either way.
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

/**
 * One dataset for one plate, from wherever VEHICLE_SOURCE says.
 *
 *   ulip     straight from ULIP, in this process (src/ulip) — the deployed
 *            server, which ULIP has whitelisted
 *   gateway  over HTTP from GATEWAY_BASE_URL — any machine ULIP does not allow
 *
 * Both return the same body, so everything after this line is one code path.
 * A ULIP failure is answered as 'upstream_unavailable', which is deliberately
 * not in TRANSIENT: vahan.js has already tried its fallback dataset, and a
 * second round here would only double the calls to be told the same thing.
 */
/*
 * `timeoutMs` and `query` are for the super administrator's own vehicle checks
 * (user, 2026-09-16): a fleet vehicle with hundreds of challans takes ULIP well
 * over the eight seconds a booking can afford to wait, and the gateway pages its
 * challans. Bookings pass neither and keep the short wait.
 */
async function fetchDataset(regNo, dataset, { timeoutMs = TIMEOUT_MS, query = null } = {}) {
  if (require('../ulip/config').config.source() === 'ulip') {
    const started = Date.now();
    /* Asked for fresh: forget what the in-process cache holds, so the call
       below goes to ULIP and stores the new answer. The cache keys are
       rc / challan / fastag. */
    if (query && String(query.refresh) === '1') {
      require('../ulip/cache').drop(`${dataset === 'challans' ? 'challan' : dataset}:${regNo}`);
    }
    try {
      const body = await require('../ulip/lookup').byDataset[dataset](regNo);
      return { body, ms: Date.now() - started, status: body.success ? 200 : 0 };
    } catch (e) {
      console.error('[vehicle] ulip %s %s: %s', dataset, regNo, e.message);
      return { body: { success: false, error: 'upstream_unavailable' }, ms: Date.now() - started, status: 0 };
    }
  }

  const qs = query ? `?${new URLSearchParams(query)}` : '';
  const url = `${BASE()}/api/v1/vehicle/${encodeURIComponent(regNo)}/${dataset}${qs}`;
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { 'x-api-key': KEY() },
      signal: AbortSignal.timeout(timeoutMs),
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
 * THE BOOKING DOES NOT WAIT FOR THEM. They start alongside the RC and are left
 * to finish on their own; resolve() returns as soon as the RC is in.
 *
 * This began as an awaited Promise.all, on the reasoning that the RC is the slow
 * call and the other two would finish inside its window. That reasoning was
 * wrong in the first live test: KA13AA6804 returned its RC in 27ms from the
 * gateway's own cache while its challan lookup took 3830ms, so the visitor sat
 * for nearly four seconds waiting on a dataset that decides nothing. Whichever
 * call happens to be slowest is not something we control, so the booking is not
 * tied to any of them.
 *
 * WHAT THIS COSTS. The write lands after the reply, so a caller that exits
 * immediately -- a script, not the server -- may end before it does. In the
 * server, which is the only place this runs in earnest, the process outlives the
 * request and the row arrives a moment later.
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

  /* Everything the gateway has on this plate, asked for at once. The RC is the
     only answer the booking waits on; the other two ride along in the same
     window and are stored for their own sake. */
  const extrasPromise = fetchExtras(regNo).catch(() => null);
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

    /* A plate with no registration can still carry a FASTag, and a plate typed
       by mistake is worth holding so the same mistake tomorrow costs nothing.
       So a row is created even here, purely to hang the extras off. */
    const row = existing || await upsertBare(regNo);
    keepExtras(row.id, regNo, extrasPromise, customerId);

    // Stale data beats no data: an RC from last month still says "Motor Car".
    if (existing) return { vehicle: existing, fresh: false, ok: true, stale: true };
    return { vehicle: row, fresh: false, ok: false, reason };
  }

  const v = await upsert(regNo, body.rc);
  await saveSnapshot(v.id, body.rc, body.source, 'rc');
  await logCall({ regNo, vehicleId: v.id, customerId, ok: true, outcome: 'fetched', ms, dataset: 'rc' });
  keepExtras(v.id, regNo, extrasPromise, customerId);
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
/**
 * Wait for the extras in the background and store them. Returns immediately.
 *
 * Exposed as a promise on `pending` so a test or a script can await what the
 * server is content to leave running.
 */
function keepExtras(vehicleId, regNo, extrasPromise, customerId) {
  const p = extrasPromise
    .then((extras) => saveExtras(vehicleId, regNo, extras, customerId))
    .catch(() => { /* logged inside saveExtras; never reaches the booking */ });
  keepExtras.pending.add(p);
  p.finally(() => keepExtras.pending.delete(p));
  return p;
}
keepExtras.pending = new Set();

/** Settle every background write — for tests and for a clean shutdown. */
const flushExtras = () => Promise.allSettled([...keepExtras.pending]);

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
const BODY_WORDS = new Set(['SCOOTER', 'MOTORCYCLE', 'MOTOR', 'CYCLE', 'BIKE', 'CAR', 'SUV', 'VAN']);

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
/*
 * A maker VAHAN does not actually know (user, 2026-09-16). Older registrations
 * often file the manufacturer as "OTHERS" and put the real make into the model:
 * KA02EX1481 is maker "OTHERS", model "HONDA ACTIVA". Shown as it came, the
 * gate read "Others Honda Activa". A placeholder is treated as no maker, and
 * the make is taken from the front of the model instead — "Honda Activa".
 */
const NO_MAKER = /^(OTHERS?|NA|N\/A|NOT AVAILABLE|UNKNOWN|NIL|-+)$/i;
const realMaker = (m) => (NO_MAKER.test(String(m || '').trim()) ? '' : String(m || ''));

function details(v) {
  if (!v) return {};
  if (!realMaker(v.maker) && v.maker) {
    /* The first word of the model is the make, when there is anything after it. */
    const parts = String(v.model || '').trim().split(/\s+/).filter(Boolean);
    v = parts.length > 1
      ? { ...v, maker: parts[0], model: parts.slice(1).join(' ') }
      : { ...v, maker: '' };
  }

  /* "KIA INDIA PRIVATE LIMITED" -> "Kia". Corporate words are stripped rather
     than the string being truncated, so "TATA MOTORS LTD" keeps "Tata Motors"
     while losing only "LTD". */
  const make = titleCase(String(v.maker || '').replace(CORPORATE, ' ').replace(/\s+/g, ' '))
    || null;

  /* The model field usually holds the model and the variant run together:
     "SELTOS D1.5 6AT HTX PLUS". The first word is the model everyone uses; the
     rest is the trim, which matters to an owner and to nobody else. */
  /* Two kinds of noise VAHAN puts in the model field, removed before splitting:
     a maker's abbreviation stuck to the front ("H/H.SPLENDOR PLUS" is Hero
     Honda's Splendor Plus), and a body word where a variant would be ("PLEASURE
     SCOOTER" has no variant -- "Scooter" is what it is, not which one). */
  const cleaned = String(v.model || '')
    .replace(/^\s*[A-Z]{1,3}\/[A-Z]{1,3}\.?\s*/i, '')
    .trim();
  let words = cleaned.split(/\s+/).filter(Boolean)
    .filter((w, i) => i === 0 || !BODY_WORDS.has(w.toUpperCase()));

  /* The maker's name again at the front of the model — "TATA MOTORS LTD" with
     "TATA ZEST XM QJET" — is not the model. Dropped, or the screen reads
     "Tata · Zest XM Qjet" and the model everybody uses becomes the variant. */
  const makerWords = String(v.maker || '').replace(CORPORATE, ' ').trim().split(/\s+/).filter(Boolean).map((w) => w.toUpperCase());
  while (words.length > 1 && makerWords.includes(words[0].toUpperCase())) words = words.slice(1);
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
    [realMaker(v.maker), v.model].filter(Boolean).join(' '),
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

module.exports = { resolve, describe, details, upsertBare, upsert, saveSnapshot, isClassified, lookupOutcome, flushExtras, fetchDataset };
