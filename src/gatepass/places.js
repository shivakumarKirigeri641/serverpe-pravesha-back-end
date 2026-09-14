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
    `SELECT p.id, p.code, p.name, p.name_kn, p.district, p.district_kn, p.booking_days_ahead, p.is_active,
            COALESCE(json_agg(json_build_object(
              'id', s.id, 'code', s.code, 'label', s.label, 'label_kn', s.label_kn,
              'starts_at', s.starts_at, 'ends_at', s.ends_at,
              'valid_from', s.valid_from, 'valid_to', s.valid_to
            ) ORDER BY s.sort_order) FILTER (WHERE s.id IS NOT NULL), '[]') AS slots
       FROM places p
       LEFT JOIN place_slots s ON s.place_id = p.id AND s.is_active
      GROUP BY p.id
      ORDER BY p.is_active DESC, p.id`);
  return r.rows;
}

const byCode = (code) => one('SELECT * FROM places WHERE code = $1', [code]);
const byId = (id) => one('SELECT * FROM places WHERE id = $1', [id]);

/** Today plus n days, on the IST calendar, as 'YYYY-MM-DD'. */
function plusDays(todayIST, n) {
  const [y, m, d] = todayIST.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/**
 * How far ahead can be booked right now.
 *
 * THE WINDOW OPENS AT A FIXED HOUR, NOT AT MIDNIGHT. At the release hour each
 * evening (booking_release_hour, 18:00) the date exactly booking_days_ahead away
 * becomes bookable; before that hour the furthest date is one day nearer. So on
 * 11 September a visitor at 17:59 can book up to 24 September, and at 18:00 the
 * 25th opens. A release that everyone knows the time of is fair to the people
 * who plan ahead; one at midnight rewards whoever is awake.
 *
 * DERIVED FROM THE CLOCK, NOT SCHEDULED. A nightly job that opens the next date
 * can fail to fire, fire twice, or miss a restart; computing the window from the
 * current IST time is right the instant the process starts and after any outage.
 *
 * IST, EXPLICITLY. The code this replaces read the server's own hour, which on a
 * server running UTC would have opened the new date at 23:30 IST instead of 18:00.
 */
async function window(place, at = new Date()) {
  const settings = require('./settings');
  const days = (place && place.booking_days_ahead) || 14;
  const releaseHour = await settings.num('booking_release_hour', 18);
  const now = slotTime.nowIST(at);
  const released = now.minutes >= releaseHour * 60;
  return {
    today: now.date,
    reach: released ? days : days - 1,
    releaseHour,
    released,
    /* The next date to open, and when — told to the visitor rather than left for
       them to discover as a list that quietly ends a day short. */
    next: {
      date: plusDays(now.date, released ? days + 1 : days),
      opensOn: released ? plusDays(now.date, 1) : now.date,
      opensToday: !released,
    },
  };
}

/**
 * The dates a visitor may pick, from today to the edge of the booking window.
 *
 * Today is dropped once its last slot has closed. Leaving it selectable means
 * choosing it, entering a vehicle, and finding every slot greyed out -- a dead
 * end two steps in, which is worse than an option that was never offered.
 */
async function bookableDates(place, slots = [], at = new Date()) {
  const settings = require('./settings');
  const w = await window(place, at);
  const sameDay = String(await settings.str('same_day_booking', 'true')) !== 'false';

  const out = [];
  for (let i = sameDay ? 0 : 1; i <= w.reach; i += 1) {
    const value = plusDays(w.today, i);
    const isToday = i === 0;
    if (isToday && !slotTime.anyBookable(slots, value, at)) continue; // finished for the day

    const { shortDate } = require('../localize');
    out.push({
      value,
      label: shortDate(value, 'en'),
      labelKn: shortDate(value, 'kn'),
      isToday,
    });
  }
  return out;
}

module.exports = { list, byCode, byId, bookableDates, window, plusDays };
