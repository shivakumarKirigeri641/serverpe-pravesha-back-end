/**
 * adminOutlook.js — what is already booked for the days ahead.
 *
 * WHAT IT IS FOR. Every other screen looks at today or at what has happened.
 * Nothing answered the question the office actually asks on a Thursday
 * afternoon: how full is the coming fortnight? A long weekend that is already
 * sold out needs staff rostered and the road people warned; a Wednesday sitting
 * at a tenth of its places is worth a post.
 *
 * READ ONLY, AND IT CREATES NOTHING. slot_inventory rows are made the first time
 * somebody asks about a date (see inventory.js), so asking about three weeks of
 * dates must not be what brings four hundred rows into being. This reads the
 * defaults in slot_capacity and lets a date's own row override them where one
 * exists. A date with no row has nothing booked, by definition — the row is
 * written before the pass is.
 *
 * ONE QUERY FOR THE WHOLE RANGE. Day by day would be a few hundred round trips
 * for a screen somebody refreshes while watching it.
 */

const { query, one } = require('./db');
const slotTime = require('./slotTime');

const n = (v) => Number(v || 0);
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MAX_DAYS = 60;

const addDays = (date, days) => {
  const [y, m, d] = String(date).split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d + days));
  return at.toISOString().slice(0, 10);
};
const weekdayOf = (date) => {
  const [y, m, d] = String(date).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

/**
 * The days ahead, each with its slots, each slot with its vehicle types.
 *
 * `days` counts from today inclusive, so 21 is today and the next twenty.
 */
async function outlook({ placeId = null, days = 21, from = null } = {}) {
  const count = Math.min(MAX_DAYS, Math.max(1, Math.round(Number(days) || 21)));
  const today = slotTime.nowIST().date;
  const start = from && /^\d{4}-\d{2}-\d{2}$/.test(String(from)) ? String(from) : today;
  const end = addDays(start, count - 1);

  const place = placeId
    ? await one(`SELECT * FROM places WHERE id = $1`, [placeId])
    : await one(`SELECT * FROM places WHERE is_active ORDER BY id LIMIT 1`);
  if (!place) return { from: start, to: end, today, place: null, days: [], totals: null };

  const rows = (await query(
    `SELECT d.day::date::text AS day,
            s.id AS slot_id, s.code AS slot_code,
            regexp_replace(s.label, '[[:space:]]+', ' ', 'g') AS slot_label,
            s.starts_at, s.ends_at, s.sort_order AS slot_order,
            c.id AS category_id, c.code AS category_code, c.label AS category_label, c.sort_order AS category_order,
            COALESCE(i.capacity, cap.capacity, 0) AS capacity,
            COALESCE(i.booked, 0) AS booked,
            COALESCE(i.held, 0) AS held,
            COALESCE(i.is_open, TRUE) AS is_open,
            i.closed_note
       FROM generate_series($2::date, $3::date, interval '1 day') AS d(day)
       CROSS JOIN place_slots s
       CROSS JOIN vehicle_categories c
       LEFT JOIN slot_capacity cap
              ON cap.place_id = s.place_id AND cap.slot_id = s.id AND cap.category_id = c.id
       LEFT JOIN slot_inventory i
              ON i.place_id = s.place_id AND i.slot_id = s.id AND i.category_id = c.id
             AND i.travel_date = d.day::date
      WHERE s.place_id = $1 AND s.is_active AND c.is_active
        AND (s.valid_from IS NULL OR s.valid_from <= d.day::date)
        AND (s.valid_to   IS NULL OR s.valid_to   >= d.day::date)
      ORDER BY d.day, s.starts_at, s.sort_order, c.sort_order`,
    [place.id, start, end])).rows;

  /* Group day → slot → categories, keeping the order the query already gave. */
  const byDay = new Map();
  for (const r of rows) {
    if (!byDay.has(r.day)) byDay.set(r.day, new Map());
    const slots = byDay.get(r.day);
    if (!slots.has(String(r.slot_id))) {
      slots.set(String(r.slot_id), {
        slotId: String(r.slot_id), code: r.slot_code, label: r.slot_label,
        startsAt: r.starts_at, endsAt: r.ends_at,
        isOpen: r.is_open !== false, closedNote: r.closed_note || null,
        categories: [], capacity: 0, booked: 0, held: 0, remaining: 0,
      });
    }
    const slot = slots.get(String(r.slot_id));
    /* A slot is closed only if every one of its types is. */
    if (r.is_open === false) slot.closedNote = slot.closedNote || r.closed_note || null;
    else slot.isOpen = true;

    const capacity = n(r.capacity);
    const booked = n(r.booked);
    const held = n(r.held);
    slot.categories.push({
      categoryId: String(r.category_id), code: r.category_code, label: r.category_label,
      capacity, booked, held,
      remaining: Math.max(0, capacity - booked - held),
      occupancy: capacity ? Math.round(((booked + held) / capacity) * 100) : null,
      isOpen: r.is_open !== false,
    });
    slot.capacity += capacity;
    slot.booked += booked;
    slot.held += held;
  }

  const totals = { capacity: 0, booked: 0, held: 0, remaining: 0 };
  const byCategory = new Map();
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const day = addDays(start, i);
    const slots = [...(byDay.get(day)?.values() || [])];
    for (const s of slots) {
      s.remaining = Math.max(0, s.capacity - s.booked - s.held);
      s.occupancy = s.capacity ? Math.round(((s.booked + s.held) / s.capacity) * 100) : null;
      for (const c of s.categories) {
        if (!byCategory.has(c.code)) byCategory.set(c.code, { code: c.code, label: c.label, capacity: 0, booked: 0, held: 0 });
        const agg = byCategory.get(c.code);
        agg.capacity += c.capacity; agg.booked += c.booked; agg.held += c.held;
      }
    }
    const capacity = slots.reduce((a, s) => a + s.capacity, 0);
    const booked = slots.reduce((a, s) => a + s.booked, 0);
    const held = slots.reduce((a, s) => a + s.held, 0);
    totals.capacity += capacity; totals.booked += booked; totals.held += held;

    const weekday = weekdayOf(day);
    out.push({
      day,
      weekday,
      weekdayName: DAY_NAMES[weekday],
      isWeekend: weekday === 0 || weekday === 6,
      isToday: day === today,
      daysAway: Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000),
      slots,
      capacity,
      booked,
      held,
      remaining: Math.max(0, capacity - booked - held),
      occupancy: capacity ? Math.round(((booked + held) / capacity) * 100) : null,
      anyClosed: slots.some((s) => !s.isOpen),
    });
  }

  totals.remaining = Math.max(0, totals.capacity - totals.booked - totals.held);
  totals.occupancy = totals.capacity ? Math.round(((totals.booked + totals.held) / totals.capacity) * 100) : null;
  totals.busiest = out.reduce((best, d) => (d.occupancy !== null && (!best || d.occupancy > best.occupancy) ? d : best), null);
  totals.quietest = out.reduce((worst, d) => (d.occupancy !== null && (!worst || d.occupancy < worst.occupancy) ? d : worst), null);
  totals.full = out.filter((d) => d.occupancy !== null && d.occupancy >= 95).length;
  totals.categories = [...byCategory.values()].map((c) => ({
    ...c,
    remaining: Math.max(0, c.capacity - c.booked - c.held),
    occupancy: c.capacity ? Math.round(((c.booked + c.held) / c.capacity) * 100) : null,
  }));

  return {
    from: start, to: end, today,
    place: { id: String(place.id), name: place.name },
    days: out,
    totals: { ...totals, busiest: totals.busiest && { day: totals.busiest.day, occupancy: totals.busiest.occupancy }, quietest: totals.quietest && { day: totals.quietest.day, occupancy: totals.quietest.occupancy } },
  };
}

module.exports = { outlook };
