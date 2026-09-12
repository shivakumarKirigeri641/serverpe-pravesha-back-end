#!/usr/bin/env node
/**
 * temp-retime-arrivals.js — TEMPORARY. Move the seeded arrivals to the hours
 * people actually arrive.
 *
 *   node scripts/temp-retime-arrivals.js            do it
 *   node scripts/temp-retime-arrivals.js --dry-run  show the before and after
 *
 * The first seeding bunched every arrival at the moment its slot opened, which
 * put 18% of a day's entries in the 6 o'clock hour. Most visitors drive up from
 * Bengaluru — four to five hours — so the hill fills late morning instead. This
 * moves the times that already exist onto the curve in src/simulation/arrivals.js
 * rather than reseeding the whole database.
 *
 * Only test rows are touched. Nothing is sent and no vehicle is looked up; the
 * times of gate checks change, and nothing else.
 */

require('dotenv').config();
const { query } = require('../src/gatepass/db');
const slotTime = require('../src/gatepass/slotTime');
const arrivals = require('../src/simulation/arrivals');

const DRY = process.argv.includes('--dry-run');
const n = (v) => Number(v || 0);
const asDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const istAt = (date, minutes) => new Date(
  `${date}T${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}+05:30`);

async function histogram(label) {
  const rows = (await query(
    `SELECT extract(hour FROM scanned_at AT TIME ZONE 'Asia/Kolkata')::int AS h, count(*) AS c
       FROM scans WHERE verdict IN ('valid','valid_override') GROUP BY 1 ORDER BY 1`)).rows;
  const total = rows.reduce((a, r) => a + n(r.c), 0) || 1;
  console.log(`\n${label}`);
  for (const r of rows) {
    const pct = (n(r.c) / total) * 100;
    console.log(`  ${String(r.h).padStart(2)}:00  ${String(n(r.c)).padStart(6)}  ${pct.toFixed(1).padStart(5)}%  ${'█'.repeat(Math.round(pct))}`);
  }
}

/** UPDATE many rows in one statement. */
async function apply(table, column, pairs, cast = 'timestamptz') {
  for (let i = 0; i < pairs.length; i += 1000) {
    const slice = pairs.slice(i, i + 1000);
    const params = [];
    const values = slice.map(([id, value]) => {
      params.push(id, value);
      return `($${params.length - 1}::bigint, $${params.length}::${cast})`;
    });
    await query(
      `UPDATE ${table} SET ${column} = v.value FROM (VALUES ${values.join(',')}) AS v(id, value) WHERE ${table}.id = v.id`,
      params);
  }
}

(async () => {
  const now = Date.now();
  await histogram('before:');
  if (DRY) { console.log('\n(dry run — nothing changed)'); process.exit(0); }

  /* 1. Entries: onto the curve, inside their own slot's entry window. */
  const entries = (await query(
    `SELECT s.id, s.ticket_id, t.travel_date, sl.starts_at, sl.ends_at
       FROM scans s
       JOIN tickets t ON t.id = s.ticket_id
       JOIN place_slots sl ON sl.id = t.slot_id
      WHERE s.is_test AND s.verdict IN ('valid','valid_override')`)).rows;

  const moved = new Map();                      // ticket id → new entry time
  const scanTimes = [];
  for (const e of entries) {
    const date = asDate(e.travel_date);
    const from = slotTime.toMinutes(e.starts_at);
    const to = slotTime.toMinutes(e.ends_at) - slotTime.LAST_ENTRY_BUFFER_MIN - 5;
    let at = istAt(date, arrivals.pickMinute(from, to));
    /* Today's arrivals cannot be in the future. */
    if (at.getTime() > now) at = new Date(now - Math.floor(Math.random() * 45 * 60000));
    scanTimes.push([e.id, at.toISOString()]);
    moved.set(String(e.ticket_id), at.toISOString());
  }
  await apply('scans', 'scanned_at', scanTimes);
  await apply('tickets', 'used_at', [...moved.entries()]);
  console.log(`\nmoved ${scanTimes.length} entries onto the curve`);

  /* 2. A pass presented again comes after its entry, not before. */
  const repeats = (await query(
    `SELECT s.id, s.ticket_id FROM scans s
      WHERE s.is_test AND s.verdict = 'already_used' AND s.ticket_id IS NOT NULL`)).rows;
  const repeatTimes = [];
  for (const r of repeats) {
    const entry = moved.get(String(r.ticket_id));
    if (!entry) continue;
    let at = new Date(new Date(entry).getTime() + (20 + Math.floor(Math.random() * 220)) * 60000);
    if (at.getTime() > now) at = new Date(new Date(entry).getTime() + 15 * 60000);
    if (at.getTime() > now) continue;
    repeatTimes.push([r.id, at.toISOString()]);
  }
  await apply('scans', 'scanned_at', repeatTimes);
  console.log(`moved ${repeatTimes.length} repeat presentations to after their entry`);

  /* 3. Vehicles with no pass at all: the same curve across the open day. */
  const unknown = (await query(
    `SELECT id, (scanned_at AT TIME ZONE 'Asia/Kolkata')::date AS day FROM scans
      WHERE is_test AND ticket_id IS NULL`)).rows;
  const unknownTimes = [];
  for (const u of unknown) {
    let at = istAt(asDate(u.day), arrivals.pickMinute(380, 1020));
    if (at.getTime() > now) at = new Date(now - Math.floor(Math.random() * 90 * 60000));
    unknownTimes.push([u.id, at.toISOString()]);
  }
  await apply('scans', 'scanned_at', unknownTimes);
  console.log(`moved ${unknownTimes.length} vehicles that arrived without a pass`);

  await histogram('after:');
  console.log('');
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
