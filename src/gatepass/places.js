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
const slotTime = require('./slotTime');

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

/**
 * The dates a visitor may pick: today through booking_days_ahead.
 *
 * Today is dropped once its last slot has closed. Leaving it selectable means
 * choosing it, entering a vehicle, and finding every slot greyed out -- a dead
 * end two steps in, which is worse than an option that was never offered.
 *
 * Dates are built from the IST calendar rather than the server's, so "today"
 * means today on the hill. A server running UTC would otherwise roll the date
 * over five and a half hours late.
 */
function bookableDates(place, slots = []) {
  const days = (place && place.booking_days_ahead) || 14;
  const todayIST = slotTime.nowIST().date;
  const [ty, tm, td] = todayIST.split('-').map(Number);

  const out = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(Date.UTC(ty, tm - 1, td + i));
    const value = d.toISOString().slice(0, 10);
    const isToday = i === 0;
    const stillOpen = !isToday || slotTime.anyBookable(slots, value);

    if (isToday && !stillOpen) continue; // finished for the day

    out.push({
      value,
      label: d.toLocaleDateString('en-IN', {
        weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
      }),
      isToday,
    });
  }
  return out;
}

module.exports = { list, byCode, byId, bookableDates };
