/**
 * pricing.js — what a pass costs.
 *
 * Two amounts, always kept apart: the entry fee, which belongs to the
 * department, and the platform fee, which does not. They are stored separately,
 * displayed separately and settled separately, so that no screen anywhere can
 * present one number and leave the split to be worked out later.
 *
 * Paise throughout. Rupees as floats is how a settlement report ends up short
 * by a few paise a thousand times over.
 */

const { one, query } = require('./db');
const settings = require('./settings');

async function forPlaceCategory(placeId, categoryId) {
  const r = await one(
    `SELECT entry_paise, platform_paise
       FROM place_pricing
      WHERE place_id = $1 AND category_id = $2 AND is_active
        AND effective_from <= now()
      ORDER BY effective_from DESC
      LIMIT 1`,
    [placeId, categoryId]);
  if (!r) return null;
  return {
    entryPaise: Number(r.entry_paise),
    platformPaise: Number(r.platform_paise),
    totalPaise: Number(r.entry_paise) + Number(r.platform_paise),
  };
}

/** Every category's price at one place — for showing the tariff up front. */
async function tariff(placeId) {
  const r = await query(
    `SELECT c.id, c.code, c.label, c.label_kn, p.entry_paise, p.platform_paise
       FROM place_pricing p
       JOIN vehicle_categories c ON c.id = p.category_id
      WHERE p.place_id = $1 AND p.is_active AND c.is_active
      ORDER BY c.sort_order`, [placeId]);
  return r.rows.map((x) => ({
    categoryId: String(x.id), code: x.code, label: x.label, labelKn: x.label_kn || null,
    entryPaise: Number(x.entry_paise),
    platformPaise: Number(x.platform_paise),
    totalPaise: Number(x.entry_paise) + Number(x.platform_paise),
  }));
}

/**
 * The platform fee as a percentage, for display.
 *
 * Read from app_settings rather than written into the page, so the number the
 * visitor is shown is the one the business case was argued on. Note it is a
 * label, not the arithmetic: the charged amounts live per category in
 * place_pricing and are rounded to whole rupees (13% of Rs.50 is Rs.6.50, and
 * the visitor pays Rs.7). Changing this setting alone changes the label and not
 * the price.
 */
async function platformPercent() {
  const r = await one("SELECT value FROM app_settings WHERE key = 'platform_fee_percent'");
  const n = r ? Number(r.value) : NaN;
  return Number.isFinite(n) ? n : null;
}

const rupees = (paise) => (Number(paise) / 100).toFixed(2).replace(/\.00$/, '');

/**
 * The split a ticket and a receipt have to show.
 *
 * The platform fee is GST-inclusive: the visitor pays Rs.13 and Rs.13 is the
 * number on every screen. The GST inside it is worked backwards from the rate
 * rather than added on top, and stored on the ticket so the receipt states what
 * was charged on the day, not what today's rate would make it.
 *
 * The entry fee carries no GST. It is collected for the department and passed
 * on whole.
 */
async function breakdown(price) {
  const gstPct = await settings.num('gst_percent_on_platform', 18);
  const base = Math.round(price.platformPaise * 100 / (100 + gstPct));
  return {
    entry_paise: price.entryPaise,
    platform_paise: price.platformPaise,
    platform_base_paise: base,
    gst_paise: price.platformPaise - base,
    gst_percent: gstPct,
    total_paise: price.entryPaise + price.platformPaise,
  };
}

/** "113" or "113.50" — for places that print their own currency symbol. */
const rs = (paise) => rupees(paise);

module.exports = { forPlaceCategory, tariff, platformPercent, breakdown, rupees, rs };
