#!/usr/bin/env node
/**
 * sync-omniware-slots.js — copy what Omniware has already sold into our
 * inventory, so booking tests run against the real limits.
 *
 *   node scripts/sync-omniware-slots.js                 today and the next 30 days
 *   node scripts/sync-omniware-slots.js --days 14
 *   node scripts/sync-omniware-slots.js --from=2026-09-20 --to=2026-09-30
 *   node scripts/sync-omniware-slots.js --dry           print, write nothing
 *   node scripts/sync-omniware-slots.js --remove        take the mirrored counts back out
 *
 * THE SOURCE. The department's current booking site answers one question per
 * call — places left for a date, location, half-day and vehicle type:
 *
 *   GET https://pgbiz.omniware.in/getavailableslots
 *       ?date=2026-09-26&location=Mullayanagiri Peak ,Inam Dattathreya Peeta
 *       &time_slot=First Half (6AM-12PM)&vehicle_type=Car/SUV&merc_id=570375
 *   → {"availableSlots":380}
 *
 * Its capacities are ours (bike 150, car 400, toofan 100, tempo traveller 100 a
 * slot), so sold = capacity - available.
 *
 * ONLY TODAY AND LATER. Every past date answers 0, which would read as sold out;
 * past dates are never asked for. The API also never errors: an unknown slot
 * label answers the full capacity and an unknown vehicle type answers 0, which is
 * why the labels below are fixed rather than built from our own.
 *
 * HOW IT LANDS. slot_inventory.omniware_booked holds Omniware's figure and is
 * also counted inside `booked`, so availability, the claim in inventory.hold()
 * and every admin screen see it without change. A re-sync swaps the old figure
 * for the new one, never adds to it. It never pushes a row over capacity: our
 * own passes and holds come first and Omniware's figure is cut to what is left.
 *
 * Reads Omniware only. Nothing is booked there, nobody is messaged, no vehicle
 * is looked up.
 */

require('dotenv').config({ quiet: true });
const axios = require('axios');
const { pool: getPool, query, one, tx } = require('../src/gatepass/db');
const inventory = require('../src/gatepass/inventory');
const slotTime = require('../src/gatepass/slotTime');

/* One set of mappings, shared with the live refresh (src/gatepass/omniwareSlots.js). */
const { URL, MERC_ID, LOCATIONS, HALVES, TYPES } = require('../src/gatepass/omniwareSlots');

const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const arg = (name, fallback) => {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};

const shiftDay = (date, days) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function askOmniware(date, location, half, type) {
  const { data } = await axios.get(URL, {
    params: { date, location, time_slot: half, vehicle_type: type, merc_id: MERC_ID },
    timeout: 20000,
  });
  const n = Number(data?.availableSlots);
  if (!Number.isFinite(n) || n < 0) throw new Error(`unexpected answer for ${date} ${half} ${type}: ${JSON.stringify(data)}`);
  return n;
}

async function remove() {
  const r = await query(
    `UPDATE slot_inventory
        SET booked = GREATEST(booked - omniware_booked, 0), omniware_booked = 0, modified_at = now()
      WHERE omniware_booked > 0`);
  console.log(`\n  removed Omniware counts from ${r.rowCount} inventory rows\n`);
}

async function sync() {
  const today = slotTime.nowIST().date;
  const days = Math.max(1, Math.min(90, Number(arg('days', 30))));
  const from = arg('from', today) < today ? today : arg('from', today);
  const to = arg('to', shiftDay(today, days));
  const dry = has('dry');

  const cats = (await query('SELECT id, code FROM vehicle_categories WHERE is_active')).rows;
  const places = (await query('SELECT id, code FROM places WHERE is_active')).rows.filter((p) => LOCATIONS[p.code]);
  if (!places.length) throw new Error('no active destination has an Omniware location mapped');

  console.log(`\n  Omniware → slot_inventory · ${from} → ${to}${dry ? ' · dry run, nothing written' : ''}\n`);
  let rows = 0; let sold = 0; let trimmed = 0;

  for (const place of places) {
    const slots = (await query('SELECT id, starts_at FROM place_slots WHERE place_id = $1 AND is_active ORDER BY sort_order', [place.id])).rows;
    for (let date = from; date <= to; date = shiftDay(date, 1)) {
      const line = [];
      for (const slot of slots) {
        const half = HALVES[String(slot.starts_at).slice(0, 5)];
        if (!half) { line.push(`slot ${slot.starts_at} has no Omniware half`); continue; }
        for (const cat of cats) {
          const type = TYPES[cat.code];
          if (!type) continue;

          const available = await askOmniware(date, LOCATIONS[place.code], half, type);
          await pause(150);

          const row = await inventory.ensure(place.id, slot.id, cat.id, date);
          const capacity = Number(row.capacity);
          const wanted = Math.max(0, capacity - available);
          line.push(`${half.startsWith('First') ? 'AM' : 'PM'} ${cat.code} ${wanted}/${capacity}`);
          sold += wanted;
          rows += 1;
          if (dry) continue;

          /* Locked, so a booking made meanwhile is not counted over. */
          await tx(async (client) => {
            const cur = (await client.query('SELECT * FROM slot_inventory WHERE id = $1 FOR UPDATE', [row.id])).rows[0];
            const ours = Number(cur.booked) - Number(cur.omniware_booked);
            const room = Number(cur.capacity) - ours - Number(cur.held);
            const mirrored = Math.max(0, Math.min(wanted, room));
            if (mirrored < wanted) trimmed += 1;
            await client.query(
              'UPDATE slot_inventory SET booked = $2, omniware_booked = $3, modified_at = now() WHERE id = $1',
              [cur.id, ours + mirrored, mirrored]);
          });
        }
      }
      console.log(`  ${place.code} ${date}  ${line.join(' · ')}`);
    }
  }

  console.log(`\n  ${rows} slot rows · ${sold} places sold on Omniware${trimmed ? ` · ${trimmed} rows cut to fit our own bookings` : ''}`);
  console.log(dry ? '  dry run: nothing written\n' : '  undo with: node scripts/sync-omniware-slots.js --remove\n');
}

(has('remove') ? remove() : sync())
  .then(() => getPool().end())
  .catch(async (e) => {
    console.error(`\n  ${e.message}\n`);
    await getPool().end();
    process.exit(1);
  });
