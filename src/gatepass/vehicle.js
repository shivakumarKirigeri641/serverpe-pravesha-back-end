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

async function fetchRc(regNo) {
  const url = `${BASE()}/api/v1/vehicle/${encodeURIComponent(regNo)}/rc`;
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

async function logCall({ regNo, vehicleId, customerId, ok, outcome, ms, cacheHit }) {
  await query(
    `INSERT INTO api_calls (customer_id, vehicle_id, reg_no, provider, dataset,
                            cache_hit, ok, outcome, duration_ms)
     VALUES ($1, $2, $3, 'ulip-gateway', 'rc', $4, $5, $6, $7)`,
    [customerId || null, vehicleId || null, regNo, !!cacheHit, !!ok, outcome || null, ms || null]);
}

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

  const { body, ms } = await fetchRc(regNo);

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
async function saveSnapshot(vehicleId, rc, source) {
  const clean = { ...rc };
  for (const k of ['owner_name', 'address', 'chassis', 'engine', 'owner_serial',
                   'owner_type', 'owner_category', 'sale_amount']) delete clean[k];

  await query(
    `INSERT INTO vehicle_snapshots (vehicle_id, data, source, expires_at)
     VALUES ($1, $2, $3, now() + interval '30 days')
     ON CONFLICT (vehicle_id) DO UPDATE
       SET data = EXCLUDED.data, source = EXCLUDED.source,
           fetched_at = now(), expires_at = EXCLUDED.expires_at`,
    [vehicleId, JSON.stringify(clean), source || 'ulip']);
}

/** One line a customer can check at a glance: "Maruti Swift · Petrol · 2019". */
function describe(v) {
  const bits = [
    [v.maker, v.model].filter(Boolean).join(' '),
    v.fuel,
    v.reg_date ? String(v.reg_date).slice(0, 4) : null,
  ].filter(Boolean);
  return bits.join(' · ') || null;
}

module.exports = { resolve, describe, upsertBare };
