/**
 * scripts/seed-demo-data.js — a season of plausible history, for review and demo.
 *
 *   node scripts/seed-demo-data.js            60 days of history
 *   node scripts/seed-demo-data.js 120        a longer season
 *   node scripts/seed-demo-data.js --wipe     remove all of it
 *
 * WHY THIS EXISTS: an analytics page with no data is unreviewable, and a
 * dashboard showing zeroes in front of a Deputy Commissioner is worse than no
 * dashboard. This fills the tables with a season that behaves like a real one —
 * busy weekends, a morning peak, some people who come back, and a handful of
 * forged tickets caught at the gate.
 *
 * ON THE MOBILE NUMBERS. Indian mobile numbers begin with 6, 7, 8 or 9. Every
 * number generated here begins with 5, so it is structurally incapable of
 * belonging to a real person. Nothing is ever sent to them — this script writes
 * to the database and never calls WhatsApp. Both halves of that matter: an
 * invented number that could be real risks reaching a stranger, and a send to a
 * dead number drags down the quality rating of the WhatsApp account QuizPe also
 * runs on.
 *
 * Everything it creates is removable with --wipe, which finds it by that same
 * 5-prefix rather than by a flag that might not have been set.
 */

require('dotenv').config();
const crypto = require('crypto');
const db = require('./../src/gatepass/db');
const booking = require('../src/gatepass/booking');
const pricing = require('../src/gatepass/pricing');
const inventory = require('../src/gatepass/inventory');

const DEMO_PREFIX = '5';                 // cannot be a real Indian mobile
const WIPE = process.argv.includes('--wipe');
const DAYS = Number(process.argv.find((a) => /^\d+$/.test(a))) || 60;

/* Vehicle registrations drawn from a fixed pool, so the same vehicles recur and
   the "how many times has this one come" column has something to say. */
const SERIES = ['KA01', 'KA02', 'KA03', 'KA05', 'KA09', 'KA18', 'KA20', 'KA31', 'KA51',
                'MH12', 'TN10', 'KL07', 'AP28', 'TS09'];
const LETTERS = ['AA', 'AB', 'BC', 'CJ', 'HA', 'JK', 'MM', 'NP', 'PQ', 'ZX'];

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const chance = (p) => Math.random() < p;
const between = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

function plateFor(i) {
  const s = SERIES[i % SERIES.length];
  const l = LETTERS[Math.floor(i / SERIES.length) % LETTERS.length];
  return `${s}${l}${String(1000 + (i * 7) % 9000)}`;
}

const iso = (d) => d.toISOString().slice(0, 10);

/* ─────────────────────────────────────────────────────────────── wipe */

async function wipe() {
  const custs = (await db.query(
    `SELECT id FROM customers WHERE mobile LIKE '${DEMO_PREFIX}%'`)).rows.map((r) => r.id);

  if (!custs.length) { console.log('\n  Nothing to remove.\n'); return; }

  const tickets = (await db.query(
    'SELECT * FROM tickets WHERE customer_id = ANY($1::bigint[])', [custs])).rows;

  for (const t of tickets) {
    if (t.status === 'paid' || t.status === 'used') {
      await inventory.unbook(null, { placeId: t.place_id, travelDate: t.travel_date,
        slotId: t.slot_id, categoryId: t.category_id });
    } else if (t.status === 'held') {
      await inventory.release(null, { placeId: t.place_id, travelDate: t.travel_date,
        slotId: t.slot_id, categoryId: t.category_id });
    }
  }

  const ids = tickets.map((t) => t.id);
  if (ids.length) {
    await db.query('DELETE FROM scans WHERE ticket_id = ANY($1::bigint[])', [ids]);
    await db.query('DELETE FROM tickets WHERE id = ANY($1::bigint[])', [ids]);
  }
  await db.query(`DELETE FROM scans WHERE reg_no IS NOT NULL AND ticket_id IS NULL
                    AND raw_payload LIKE '%DEMO%'`);
  await db.query('DELETE FROM payments WHERE customer_id = ANY($1::bigint[])', [custs]);
  await db.query('DELETE FROM event_log WHERE customer_id = ANY($1::bigint[])', [custs]);
  await db.query(`DELETE FROM wa_messages WHERE mobile LIKE '${DEMO_PREFIX}%'`);
  await db.query(`DELETE FROM wa_sessions WHERE mobile LIKE '${DEMO_PREFIX}%'`);
  await db.query('DELETE FROM customers WHERE id = ANY($1::bigint[])', [custs]);

  console.log(`\n  Removed ${custs.length} demo visitors and ${ids.length} tickets.\n`);
}

/* ────────────────────────────────────────────────────────────── seed */

async function seed() {
  const place = await booking.placeByCode('MULLAYANAGIRI');
  const slots = (await db.query(
    'SELECT * FROM place_slots WHERE place_id = $1 ORDER BY sort_order', [place.id])).rows;
  const cats = (await db.query('SELECT * FROM vehicle_categories ORDER BY sort_order')).rows;
  const checkpost = await db.one(
    'SELECT * FROM checkposts WHERE place_id = $1 ORDER BY id LIMIT 1', [place.id]);
  const staff = (await db.query(
    `SELECT s.* FROM staff s JOIN staff_checkposts sc ON sc.staff_id = s.id
      WHERE sc.checkpost_id = $1 AND s.is_active`, [checkpost?.id || 0])).rows;

  /* A pool of visitors, a few of whom come back often. */
  const POOL = Math.round(DAYS * 6);
  const customers = [];
  for (let i = 0; i < POOL; i++) {
    const mobile = DEMO_PREFIX + String(100000000 + i).slice(-9);
    const r = await db.query(
      `INSERT INTO customers (mobile, wa_profile_name)
       VALUES ($1, $2) ON CONFLICT (mobile) DO UPDATE SET last_seen_at = now()
       RETURNING *`, [mobile, `Visitor ${i + 1}`]);
    customers.push(r.rows[0]);
  }

  const vehicles = [];
  for (let i = 0; i < POOL; i++) {
    const r = await db.query(
      `INSERT INTO vehicles (reg_no, maker, model, fuel, vehicle_class)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (reg_no) DO UPDATE SET last_seen_at = now()
       RETURNING *`,
      [plateFor(i), pick(['Maruti Suzuki', 'Hyundai', 'Tata', 'Mahindra', 'Honda', 'Kia']),
       pick(['Swift', 'i20', 'Nexon', 'Scorpio', 'City', 'Seltos']),
       pick(['PETROL', 'DIESEL']), 'MOTOR CAR(LMV)']);
    vehicles.push(r.rows[0]);
  }

  console.log(`\n  ${customers.length} visitors and ${vehicles.length} vehicles in the pool.`);

  let made = 0, scanned = 0, caught = 0;
  const start = new Date();
  start.setDate(start.getDate() - DAYS);

  /* Past days for history, and a fortnight ahead so the upcoming board and the
     capacity charts have something in them too. */
  const AHEAD = 14;
  for (let day = 0; day <= DAYS + AHEAD; day++) {
    const date = new Date(start);
    date.setDate(start.getDate() + day);
    const travelDate = iso(date);
    const dow = date.getDay();
    const future = date > new Date();

    /* Weekends carry roughly three times a weekday. */
    const weekend = dow === 0 || dow === 6;
    const base = weekend ? between(70, 130) : between(20, 45);
    const count = future ? Math.round(base * 0.35) : base;

    for (let n = 0; n < count; n++) {
      /* A fifth of bookings come from the frequent-visitor end of the pool, so
         the repeat-visit distribution is not flat. */
      const idx = chance(0.2) ? between(0, 40) : between(0, customers.length - 1);
      const customer = customers[idx];
      const vehicle = vehicles[idx];

      const category = chance(0.75) ? cats.find((c) => c.code === 'CAR')
        : pick(cats);
      const slot = chance(weekend ? 0.62 : 0.5) ? slots[0] : slots[1];

      let price;
      try { price = await pricing.priceFor(place.id, category.id); } catch { continue; }
      const b = await pricing.breakdown(price);

      /* Booked a few days before travelling; same-day for about a fifth. */
      const lead = chance(0.2) ? 0 : between(1, 9);
      const createdAt = new Date(date);
      createdAt.setDate(date.getDate() - lead);
      createdAt.setHours(between(7, 21), between(0, 59), 0, 0);

      const held = await booking.hold({
        customer, vehicle, place, slot, category, travelDate });
      if (!held.ok) continue;                      // sold out or already booked

      const t = held.ticket;

      await db.query(
        `UPDATE tickets SET status = 'paid', held_until = NULL,
                created_at = $2, modified_at = $2 WHERE id = $1`, [t.id, createdAt]);
      // confirm() writes through a client; the pool exposes the same query method.
      await inventory.confirm({ query: db.query }, { placeId: place.id, travelDate,
        slotId: slot.id, categoryId: category.id });
      made++;

      /* Past days get scanned at the gate; about one in eight never turns up. */
      if (!future && staff.length && chance(0.88)) {
        const [sh, sm] = String(slot.starts_at).split(':').map(Number);
        const at = new Date(date);
        at.setHours(sh + between(0, 4), between(0, 59), 0, 0);

        const who = pick(staff);
        await db.query(
          `INSERT INTO scans (ticket_id, ticket_no, reg_no, checkpost_id, staff_id,
                              verdict, raw_payload, scanned_at, was_offline)
           VALUES ($1,$2,$3,$4,$5,'valid','DEMO',$6,$7)`,
          [t.id, t.ticket_no, t.reg_no, checkpost.id, who.id, at, chance(0.06)]);
        await db.query(
          `UPDATE tickets SET status = 'used', used_at = $2 WHERE id = $1`, [t.id, at]);
        scanned++;

        /* And occasionally the same vehicle is presented twice in a day. */
        if (chance(0.03)) {
          const again = new Date(at.getTime() + between(5, 90) * 60000);
          await db.query(
            `INSERT INTO scans (ticket_id, ticket_no, reg_no, checkpost_id, staff_id,
                                verdict, raw_payload, scanned_at)
             VALUES ($1,$2,$3,$4,$5,'already_used','DEMO',$6)`,
            [t.id, t.ticket_no, t.reg_no, checkpost.id, pick(staff).id, again]);
          caught++;
        }
        /* And a vehicle that simply never booked — the commonest refusal at a
           barrier, and the one whose monthly count is worth showing to the
           department. */
        if (chance(0.04)) {
          const walkUp = new Date(at.getTime() + between(5, 120) * 60000);
          const plate = plateFor(between(0, 200));
          await db.query(
            `INSERT INTO scans (reg_no, checkpost_id, staff_id,
                                verdict, raw_payload, scanned_at)
             VALUES ($1,$2,$3,'not_found',$4,$5)`,
            [plate, checkpost.id, pick(staff).id, plate.slice(-4), walkUp]);
          caught++;
        }
      }
    }

    if (day % 15 === 0) process.stdout.write(`  ${travelDate} … ${made} tickets\r`);
  }

  console.log(`\n  ${made} tickets, ${scanned} scanned through the gate, `
            + `${caught} refusals recorded.`);
  console.log('\n  Remove it all with:  node scripts/seed-demo-data.js --wipe\n');
}

(async () => {
  if (WIPE) { await wipe(); process.exit(0); }

  console.log(`\n  Seeding ${DAYS} days of demo history.`);
  console.log('  Mobile numbers all begin with 5, so none can belong to a real person,');
  console.log('  and nothing here is ever sent to WhatsApp.');
  await seed();
  process.exit(0);
})().catch((e) => { console.error('\n', e, '\n'); process.exit(1); });
