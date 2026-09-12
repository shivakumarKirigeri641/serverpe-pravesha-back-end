/**
 * arrivals.js — when vehicles actually reach the hill.
 *
 * Most visitors to Mullayanagiri drive up from Bengaluru, and that is a four to
 * five hour journey. A car that leaves the city at five in the morning is at the
 * checkpost at ten, not at six — so the gate is quiet when it opens, builds
 * through the morning, and is busiest from mid-morning into the early
 * afternoon. The early hours belong to people who stayed in Chikkamagaluru
 * overnight, and the last hour to whoever is scraping in before entry closes.
 *
 * Spreading arrivals evenly, or bunching them at the moment each slot opens —
 * which is what the first version of the seeder did — produces a graph no
 * officer would recognise, and makes every "busiest hour" figure wrong.
 *
 * The weights are relative, not counts: they say a ten o'clock is worth six
 * sixes, and the code scales them to whatever the day actually holds.
 */

const WEIGHTS = {
  6: 0.5,    // the gate opens; only people already in Chikkamagaluru
  7: 0.9,
  8: 1.4,
  9: 2.2,
  10: 3.2,   // the Bengaluru cars start landing
  11: 3.4,   // morning entry closes at 11:00
  12: 3.0,
  13: 2.6,
  14: 2.1,
  15: 1.6,
  16: 1.1,
  17: 0.6,   // afternoon entry closes at 17:00
};

const weightAt = (hour) => WEIGHTS[hour] || 0;

/** The weights across a window of minutes, hour by hour. */
function hoursIn(fromMinute, toMinute) {
  const out = [];
  for (let hour = Math.floor(fromMinute / 60); hour <= Math.floor(toMinute / 60); hour += 1) {
    const w = weightAt(hour);
    if (w <= 0) continue;
    const start = Math.max(fromMinute, hour * 60);
    const end = Math.min(toMinute, hour * 60 + 59);
    if (end < start) continue;
    /* A part-hour carries a part of its weight. */
    out.push({ hour, start, end, weight: w * ((end - start + 1) / 60) });
  }
  return out;
}

/** One arrival time, in minutes past midnight, drawn from the curve. */
function pickMinute(fromMinute, toMinute) {
  const hours = hoursIn(fromMinute, toMinute);
  if (!hours.length) return Math.round((fromMinute + toMinute) / 2);
  const total = hours.reduce((sum, h) => sum + h.weight, 0);
  let r = Math.random() * total;
  for (const h of hours) {
    r -= h.weight;
    if (r <= 0) return h.start + Math.floor(Math.random() * (h.end - h.start + 1));
  }
  const last = hours[hours.length - 1];
  return last.start + Math.floor(Math.random() * (last.end - last.start + 1));
}

/**
 * What share of the arrivals still to come should happen in this hour.
 *
 * Used by the simulation to pace itself: at nine in the morning most of the day
 * is still ahead, so it holds back; at eleven it is working hard.
 */
function shareOfRemaining(nowMinute, lastEntryMinute) {
  const rest = hoursIn(nowMinute, lastEntryMinute);
  if (!rest.length) return 0;
  const total = rest.reduce((sum, h) => sum + h.weight, 0);
  return total > 0 ? rest[0].weight / total : 0;
}

module.exports = { WEIGHTS, pickMinute, shareOfRemaining, hoursIn };
