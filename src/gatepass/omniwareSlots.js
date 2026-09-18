/**
 * omniwareSlots.js — take Omniware's sold counts into availability, live.
 *
 *   SLOTS_TYPE unset   availability comes from our own database only
 *   SLOTS_TYPE=1       before a date's availability is read, Omniware is asked
 *                      how many places are left there, and what it has sold is
 *                      counted in (user, 2026-09-17)
 *
 * THE SOURCE is the department's current booking site, one question per call —
 * places left for a date, location, half-day and vehicle type:
 *
 *   GET https://pgbiz.omniware.in/getavailableslots
 *       ?date=2026-09-26&location=Mullayanagiri Peak ,Inam Dattathreya Peeta
 *       &time_slot=First Half (6AM-12PM)&vehicle_type=Car/SUV&merc_id=570375
 *   → {"availableSlots":380}
 *
 * sold = our capacity − Omniware's places left. It lands exactly as
 * scripts/sync-omniware-slots.js lands it: slot_inventory.omniware_booked holds
 * Omniware's figure and is also counted inside `booked`, so the slot grid, the
 * claim in inventory.hold() and every admin screen see the combined limit. A
 * refresh replaces the previous figure, never adds to it, and never pushes a row
 * over capacity — our own passes and holds come first.
 *
 * NEVER IN THE WAY OF A BOOKING. A date is asked about at most once a minute
 * (OMNIWARE_CACHE_SECONDS), simultaneous asks share one round of calls, each
 * call gives up after a few seconds, and if Omniware fails the page simply
 * shows our own figures. Only today and later dates are asked: Omniware answers
 * 0 for every past date, which would read as sold out.
 *
 * Reads Omniware only. Nothing is booked there.
 */

const axios = require('axios');
const { query, tx } = require('./db');
const slotTime = require('./slotTime');

const URL = 'https://pgbiz.omniware.in/getavailableslots';
const MERC_ID = '570375';

/* Our destination code → Omniware's location text, copied from its booking site. */
const LOCATIONS = { MULLAYANAGIRI: 'Mullayanagiri Peak ,Inam Dattathreya Peeta' };
/* Our slot start → Omniware's half-day. */
const HALVES = { '06:00': 'First Half (6AM-12PM)', '13:00': 'Second Half (1PM-6PM)' };
/* Our category → Omniware's vehicle type. 'Bike', not 'Bike/SUV': the latter answers 0. */
const TYPES = { BIKE: 'Bike', CAR: 'Car/SUV', TOOFAN: 'Toofan', TT: 'Tempo Traveler' };

const enabled = () => String(process.env.SLOTS_TYPE || '').trim() === '1';
const cacheMs = () => Math.max(0, Number(process.env.OMNIWARE_CACHE_SECONDS || 60)) * 1000;

async function ask(date, location, half, type, { timeoutMs = 4000 } = {}) {
  const { data } = await axios.get(URL, {
    params: { date, location, time_slot: half, vehicle_type: type, merc_id: MERC_ID },
    timeout: timeoutMs,
  });
  const n = Number(data && data.availableSlots);
  if (!Number.isFinite(n) || n < 0) throw new Error(`unexpected answer for ${date} ${half} ${type}: ${JSON.stringify(data)}`);
  return n;
}

/** Write Omniware's sold figure for one inventory row, never over capacity. */
async function applyRow(rowId, wanted) {
  return tx(async (client) => {
    const cur = (await client.query('SELECT * FROM slot_inventory WHERE id = $1 FOR UPDATE', [rowId])).rows[0];
    if (!cur) return null;
    const ours = Number(cur.booked) - Number(cur.omniware_booked);
    const room = Number(cur.capacity) - ours - Number(cur.held);
    const mirrored = Math.max(0, Math.min(wanted, room));
    await client.query(
      'UPDATE slot_inventory SET booked = $2, omniware_booked = $3, modified_at = now() WHERE id = $1',
      [cur.id, ours + mirrored, mirrored]);
    return { mirrored, trimmed: mirrored < wanted };
  });
}

const lastDone = new Map();   // "placeId:date" -> ms
const running = new Map();    // "placeId:date" -> promise

/**
 * Bring one destination's date up to date with Omniware. Returns what happened;
 * never throws.
 */
async function refreshDate(placeId, date, { ask: asker = ask } = {}) {
  /* Switched off: our own figures only, so anything copied in while it was on
     is taken back out of that date. */
  if (!enabled()) {
    const r = await query(
      `UPDATE slot_inventory SET booked = GREATEST(booked - omniware_booked, 0), omniware_booked = 0, modified_at = now()
        WHERE place_id = $1 AND travel_date = $2 AND omniware_booked > 0`, [placeId, date]).catch(() => ({ rowCount: 0 }));
    return { skipped: 'disabled', removed: r.rowCount };
  }
  if (date < slotTime.nowIST().date) return { skipped: 'past' };

  const key = `${placeId}:${date}`;
  if (running.has(key)) return running.get(key);
  if (Date.now() - (lastDone.get(key) || 0) < cacheMs()) return { skipped: 'fresh' };

  const work = (async () => {
    try {
      const place = (await query('SELECT id, code FROM places WHERE id = $1', [placeId])).rows[0];
      const location = place && LOCATIONS[place.code];
      if (!location) return { skipped: 'unmapped' };

      const inventory = require('./inventory');
      const slots = (await query('SELECT id, starts_at FROM place_slots WHERE place_id = $1 AND is_active', [placeId])).rows;
      const cats = (await query('SELECT id, code FROM vehicle_categories WHERE is_active')).rows;

      const jobs = [];
      for (const slot of slots) {
        const half = HALVES[String(slot.starts_at).slice(0, 5)];
        if (!half) continue;
        for (const cat of cats) {
          const type = TYPES[cat.code];
          if (type) jobs.push({ slot, cat, half, type });
        }
      }

      /* All at once: eight short reads, not eight in a row. */
      const answers = await Promise.allSettled(jobs.map((j) => asker(date, location, j.half, j.type)));
      let applied = 0; let failed = 0;
      for (let i = 0; i < jobs.length; i += 1) {
        if (answers[i].status !== 'fulfilled') { failed += 1; continue; }
        const row = await inventory.ensure(placeId, jobs[i].slot.id, jobs[i].cat.id, date);
        await applyRow(row.id, Math.max(0, Number(row.capacity) - answers[i].value));
        applied += 1;
      }
      if (failed) {
        const reason = answers.find((a) => a.status === 'rejected').reason;
        console.warn('[omniware] %s: %d of %d answers failed (%s) — own figures used for those', date, failed, jobs.length, reason && reason.message);
      }
      lastDone.set(key, Date.now());
      return { applied, failed };
    } catch (e) {
      console.warn('[omniware] %s not refreshed: %s — own figures used', date, e.message);
      return { error: e.message };
    } finally {
      running.delete(key);
    }
  })();
  running.set(key, work);
  return work;
}

module.exports = { enabled, ask, applyRow, refreshDate, LOCATIONS, HALVES, TYPES, URL, MERC_ID };
