/**
 * eligibility.js — may this vehicle buy a pass, and at which rate.
 *
 * Two questions, asked in this order and never the other way round:
 *
 *   1. Is it barred? Autos, goods vehicles, buses, tractors and trailers do not
 *      go up these hills at all.
 *   2. If not, what is it? The category sets the price.
 *
 * Order matters because the allow map is deliberately loose -- it matches on
 * words like CAR and LMV -- and a loose match on a vehicle that should have been
 * refused sells a pass that the checkpost then has to take back.
 *
 * WHICH FIELDS ARE READ. vehicle_category first, vehicle_class second. Nothing
 * else. See 018_vehicle_eligibility.sql for the live lookups that ruled out
 * seats, body_type and gross_weight -- briefly: a Hero Splendor and a 15-metre
 * Volvo coach both report 2 seats, and a Hero Pleasure scooter reports a body
 * type of 'PICK UP'.
 */

const { query } = require('./db');

/* Rules are rows so they can be fixed without a deploy, and cached so that
   fixing them without a deploy does not mean a query per booking. A minute is
   short enough that an INSERT at a checkpost is live before anyone has finished
   telling someone it has been done. */
const TTL_MS = 60_000;
let cache = { at: 0, deny: [], allow: [] };

async function rules() {
  if (Date.now() - cache.at < TTL_MS) return cache;
  const [deny, allow] = await Promise.all([
    query(`SELECT code, pattern, reason_en, reason_kn
             FROM vehicle_deny_rules
            WHERE is_active ORDER BY priority DESC`),
    query(`SELECT m.category_id, m.pattern, m.model_pattern, c.code, c.label
             FROM vehicle_class_map m
             JOIN vehicle_categories c ON c.id = m.category_id
            WHERE c.is_active ORDER BY m.priority DESC`),
  ]);
  cache = { at: Date.now(), deny: deny.rows, allow: allow.rows };
  return cache;
}

/** Drop the cache — for tests, and for an admin screen that has just edited a rule. */
function invalidate() { cache = { at: 0, deny: [], allow: [] }; }

/* Both fields are tried against every pattern. VAHAN puts the same information
   in different columns depending on the vehicle: a bus says 'Bus' in the class
   and 'HEAVY PASSENGER VEHICLE' in the category, while a goods carrier says
   'Goods Carrier' in the class and the weight band in the category. Matching
   both means one rule covers both spellings. */
function hits(pattern, v) {
  if (!pattern) return false;
  let re;
  try { re = new RegExp(pattern, 'i'); } catch { return false; }
  return re.test(v.vehicle_category || '') || re.test(v.vehicle_class || '');
}

/* The maker and the model are matched as one string, because which of the two
   carries the identifying word is not consistent: "FORCE MOTORS LIMITED" +
   "TRAVELLER T1" puts it in the model, while other makers put the range in the
   maker field. Joining them means a pattern does not have to know which. */
function hitsModel(pattern, v) {
  if (!pattern) return false;
  let re;
  try { re = new RegExp(pattern, 'i'); } catch { return false; }
  return re.test(`${v.maker || ''} ${v.model || ''}`);
}

/**
 * Decide. Returns one of three shapes, and the caller must handle all three:
 *
 *   { allowed: false, ... }                  -- refuse, with a reason to show
 *   { allowed: true, categoryId, ... }       -- sell at that category's price
 *   { allowed: true, unclassified: true }    -- ask the visitor what it is
 *
 * The third is not a failure. A pre-1989 registration is genuinely not in the
 * database and a gateway outage is not the visitor's fault; migration 017 exists
 * so that those bookings go ahead with a declared category and a flag for the
 * gate. What must never happen is the fourth shape this used to have -- a silent
 * guess of 'car' -- which both overcharged two-wheelers and let barred vehicles
 * through.
 */
async function decide(vehicle) {
  const v = vehicle || {};
  const { deny, allow } = await rules();

  for (const r of deny) {
    if (hits(r.pattern, v)) {
      return {
        allowed: false,
        denyCode: r.code,
        reason: r.reason_en,
        reasonKn: r.reason_kn,
      };
    }
  }

  /* Nothing to match on at all -- a bare row from a failed lookup. Not refused:
     we simply do not know, and the visitor is asked. */
  if (!v.vehicle_category && !v.vehicle_class) {
    return { allowed: true, unclassified: true, reason: 'no_vehicle_class' };
  }

  /* A row matches on its class pattern or on its model pattern. Model rows are
     seeded at a higher priority precisely so they are reached first: a Force
     Cruiser has to be recognised as a Toofan before the broad "Motor Car" row
     prices it as a car. */
  for (const m of allow) {
    if (hits(m.pattern, v) || hitsModel(m.model_pattern, v)) {
      return {
        allowed: true,
        categoryId: String(m.category_id),
        categoryCode: m.code,
        categoryLabel: m.label,
      };
    }
  }

  /* Known to VAHAN, matched by nothing we recognise. Neither refused nor priced
     by guesswork: asked. Worth watching in the logs -- a class that shows up
     here repeatedly is a missing row in vehicle_class_map. */
  return { allowed: true, unclassified: true, reason: 'unmapped_class' };
}

/** Persist the verdict on the vehicle so the checkpost need not re-derive it. */
async function remember(vehicleId, verdict) {
  if (!vehicleId) return;
  await query('UPDATE vehicles SET is_allowed = $2, deny_code = $3 WHERE id = $1',
    [vehicleId, verdict.allowed, verdict.denyCode || null]);
}

module.exports = { decide, remember, invalidate };
