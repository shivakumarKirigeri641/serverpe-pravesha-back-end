/**
 * slotTime.js — a slot you can still turn up for.
 *
 * The morning slot runs 06:00 to 12:00. At 12:08 it is over, and offering it
 * for today is offering something that cannot happen. Capacity says nothing
 * about this: four hundred places are still free in a slot that ended eight
 * minutes ago.
 *
 * LAST ENTRY IS AN HOUR BEFORE THE SLOT ENDS. Not at the end of it. A pass sold
 * at 17:55 for a slot closing at 18:00 is sold to somebody who cannot reach the
 * gate, let alone drive up and come back down. An hour is the smallest buffer
 * that is honest about the drive; it is one constant here rather than a number
 * repeated in the form and the checkpost.
 *
 * EVERYTHING IS COMPUTED IN IST, EXPLICITLY. The server's clock may be UTC, in
 * a container, on a laptop that travelled. "Today" for a hill in Chikkamagaluru
 * is not whatever the process thinks midnight is -- and getting this wrong
 * closes today's booking five and a half hours early, or opens tomorrow's just
 * as far in advance.
 */

const ZONE = 'Asia/Kolkata';

/** Last entry, in minutes before the slot's end time. */
const LAST_ENTRY_BUFFER_MIN = 60;

/** The current date and time-of-day in IST, regardless of the server's zone. */
function nowIST(at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(at).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** '18:00:00' or '18:00' -> 1080 */
function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

const hhmm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

/**
 * Can this slot still be booked for this date?
 *
 * Returns { bookable, reason, lastEntry } — the reason is shown to the visitor,
 * so "the morning slot has finished" and "that date has passed" stay distinct.
 */
function check(slot, travelDate, at = new Date()) {
  const now = nowIST(at);
  const lastEntryMin = toMinutes(slot.ends_at) - LAST_ENTRY_BUFFER_MIN;
  const lastEntry = hhmm(Math.max(0, lastEntryMin));

  if (travelDate > now.date) return { bookable: true, lastEntry };
  if (travelDate < now.date) return { bookable: false, reason: 'date_past', lastEntry };

  if (now.minutes >= lastEntryMin) {
    return {
      bookable: false,
      reason: now.minutes >= toMinutes(slot.ends_at) ? 'slot_over' : 'too_late',
      lastEntry,
    };
  }
  return { bookable: true, lastEntry };
}

/**
 * Is any slot at this place still bookable today?
 *
 * Used to grey today out in the date list rather than letting somebody pick it
 * and find every slot closed — a dead end two steps in is worse than an option
 * that was never offered.
 */
function anyBookable(slots, travelDate, at = new Date()) {
  return (slots || []).some((s) => check(s, travelDate, at).bookable);
}

module.exports = { check, anyBookable, nowIST, toMinutes, hhmm, LAST_ENTRY_BUFFER_MIN, ZONE };
