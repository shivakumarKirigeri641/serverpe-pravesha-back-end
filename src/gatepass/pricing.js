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
    `SELECT c.id, c.code, c.label, p.entry_paise, p.platform_paise
       FROM place_pricing p
       JOIN vehicle_categories c ON c.id = p.category_id
      WHERE p.place_id = $1 AND p.is_active AND c.is_active
      ORDER BY c.sort_order`, [placeId]);
  return r.rows.map((x) => ({
    categoryId: String(x.id), code: x.code, label: x.label,
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

module.exports = { forPlaceCategory, tariff, platformPercent, rupees };
