/**
 * pricing.js — what a vehicle is, and what that costs.
 *
 * Two jobs that belong together because the second depends entirely on the
 * first: decide which gate category a vehicle falls into, then read the price
 * for that category at that place.
 *
 * The category comes from the registration record, not from the customer. A
 * person asked "is this a car or a Toofan?" will answer whichever is cheaper,
 * and the gate then has an argument on its hands. Reading the class from the
 * RC removes the question.
 */

const { query, one } = require('./db');
const settings = require('./settings');

/**
 * Map a vehicle's class words to a gate category.
 *
 * The patterns live in vehicle_class_map rather than here because the first
 * genuinely unusual vehicle will arrive on a Sunday, and correcting it must be
 * an admin edit, not a deploy. Highest priority wins, and a catch-all at
 * priority 1 charges anything unrecognised as a car — turning a visitor away
 * over an unmapped class string would be a far worse failure than a few rupees.
 */
async function categoryForVehicle(vehicle) {
  const text = [vehicle?.vehicle_class, vehicle?.vehicle_category, vehicle?.body_type]
    .filter(Boolean).join(' ').toUpperCase();

  const row = await one(
    `SELECT c.*, m.pattern
       FROM vehicle_class_map m
       JOIN vehicle_categories c ON c.id = m.category_id
      WHERE c.is_active AND $1 ~* m.pattern
      ORDER BY m.priority DESC
      LIMIT 1`,
    [text || 'UNKNOWN']);

  if (row) return row;
  // Only reachable if the catch-all row was deleted. Fail towards letting a
  // paying visitor in rather than towards a blank screen.
  return one(`SELECT * FROM vehicle_categories WHERE code = 'CAR'`);
}

async function categoryByCode(code) {
  return one('SELECT * FROM vehicle_categories WHERE code = $1', [code]);
}

/**
 * The price in force for this place and category today.
 *
 * effective_from lets a new price be entered in advance and take over on its
 * own date, so nobody has to be awake at midnight to change a number.
 */
async function priceFor(placeId, categoryId) {
  const row = await one(
    `SELECT * FROM place_pricing
      WHERE place_id = $1 AND category_id = $2 AND is_active
        AND effective_from <= CURRENT_DATE
      ORDER BY effective_from DESC
      LIMIT 1`,
    [placeId, categoryId]);
  if (!row) throw new Error(`no price configured for category ${categoryId}`);
  return row;
}

/**
 * Break a booking into the four numbers that appear on the invoice.
 *
 * GST IS CHARGED ON THE PLATFORM FEE ALONE. The entry fee is collected on
 * behalf of Karnataka Tourism and is excluded from our taxable value as a pure
 * agent under Rule 33 of the CGST Rules — it is their money passing through our
 * account, not our revenue. Getting this wrong would mean paying tax on the
 * department's collections.
 *
 * The platform fee is treated as GST-inclusive, so the customer sees one round
 * number and our share is what is left after tax.
 */
async function breakdown(price) {
  const gstPct = await settings.num('gst_percent_on_platform', 18);
  const entry = price.entry_paise;
  const platformInclusive = price.platform_paise;

  const base = Math.round(platformInclusive * 100 / (100 + gstPct));
  const gst = platformInclusive - base;

  return {
    entry_paise: entry,
    platform_paise: platformInclusive,
    platform_base_paise: base,
    gst_paise: gst,
    gst_percent: gstPct,
    total_paise: entry + platformInclusive,
  };
}

/** Paise to a display string: 11000 -> "110". */
const rs = (paise) => (paise % 100 === 0
  ? String(paise / 100)
  : (paise / 100).toFixed(2));

module.exports = { categoryForVehicle, categoryByCode, priceFor, breakdown, rs };
