/**
 * places.js — where you can go, and where you cannot yet.
 *
 * Inactive places are returned rather than hidden. The department is launching
 * one destination first and the others follow, and a dropdown showing a single
 * option makes the platform look like it does one thing. Showing all four with
 * three marked "coming soon" shows the shape of what is being built, and is
 * honest about what is live today.
 *
 * The flag is read from the row, never hardcoded: turning Kudremukha on is an
 * UPDATE, not a deploy.
 */

const { query, one } = require('./db');

async function list() {
  const r = await query(
    `SELECT p.id, p.code, p.name, p.district, p.booking_days_ahead, p.is_active,
            COALESCE(json_agg(json_build_object(
              'id', s.id, 'code', s.code, 'label', s.label,
              'starts_at', s.starts_at, 'ends_at', s.ends_at
            ) ORDER BY s.sort_order) FILTER (WHERE s.id IS NOT NULL), '[]') AS slots
       FROM places p
       LEFT JOIN place_slots s ON s.place_id = p.id AND s.is_active
      GROUP BY p.id
      ORDER BY p.is_active DESC, p.id`);
  return r.rows;
}

const byCode = (code) => one('SELECT * FROM places WHERE code = $1', [code]);
const byId = (id) => one('SELECT * FROM places WHERE id = $1', [id]);

/** The dates a visitor may pick: today through booking_days_ahead. */
function bookableDates(place) {
  const days = place?.booking_days_ahead || 14;
  const out = [];
  const today = new Date();
  for (let i = 0; i < days; i += 1) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    out.push({
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      label: d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }),
      isToday: i === 0,
    });
  }
  return out;
}

module.exports = { list, byCode, byId, bookableDates };
