#!/usr/bin/env node
/**
 * seed-test-data.js — invented vehicles and bookings, for testing the screens.
 *
 *   node scripts/seed-test-data.js                    300 vehicles, 7 days of bookings
 *   node scripts/seed-test-data.js --vehicles 1000 --days 14
 *   node scripts/seed-test-data.js --vehicles 500 --no-bookings
 *   node scripts/seed-test-data.js --remove           delete every seeded row
 *
 * IT NEVER CALLS ULIP, AND CANNOT CAUSE A CALL LATER. Vehicles are written
 * straight into the cache with a recent rc_fetched_at, which is the same
 * condition vehicle.resolve() checks before deciding whether to ask upstream —
 * so a seeded plate is answered from the database and no paid lookup happens for
 * it, during seeding or during a demo.
 *
 * EVERY ROW IS MARKED is_test. Invented registration details must never be
 * mistaken for a government record, and --remove deletes exactly these rows.
 *
 * THE PLATES ARE DELIBERATELY IMPROBABLE: series 'ZZ' in each district code
 * (KA01ZZ0001 and so on). A real vehicle could in principle carry one, which is
 * why the flag exists and why --remove is one command.
 *
 * Bookings are spread across the days given, weighted so weekends are busier
 * and so most passes are bought a few days ahead — otherwise every chart in the
 * admin panel is a flat line and nothing about it can be judged.
 */

require('dotenv').config();
const crypto = require('crypto');
const { pool: getPool, query, one, tx } = require('../src/gatepass/db');
const passCodec = require('../src/gatepass/passCodec');
const slotTime = require('../src/gatepass/slotTime');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};

const VEHICLES = Math.max(1, Math.min(5000, opt('vehicles', 300)));
const DAYS = Math.max(1, Math.min(60, opt('days', 7)));
const WITH_BOOKINGS = !flag('no-bookings');

/* Districts that actually issue Karnataka plates, with 'ZZ' as the series. */
const RTO = ['01', '02', '03', '04', '05', '09', '13', '18', '19', '20', '21', '25', '31', '32', '41', '42', '50', '51', '53'];

/* Make and model per category, so the screens show something plausible. */
const MODELS = {
  BIKE: [['HERO MOTOCORP LTD', 'SPLENDOR PLUS'], ['HONDA MOTORCYCLE', 'ACTIVA 6G'], ['BAJAJ AUTO LTD', 'PULSAR 150'], ['TVS MOTOR COMPANY', 'JUPITER'], ['ROYAL ENFIELD', 'CLASSIC 350']],
  CAR: [['MARUTI SUZUKI INDIA LTD', 'SWIFT VDI'], ['HYUNDAI MOTOR INDIA', 'CRETA SX'], ['TATA MOTORS LTD', 'NEXON XZ'], ['MAHINDRA & MAHINDRA', 'SCORPIO N'], ['TOYOTA KIRLOSKAR', 'INNOVA CRYSTA']],
  TOOFAN: [['FORCE MOTORS LTD', 'TRAX CRUISER'], ['MAHINDRA & MAHINDRA', 'BOLERO MAXX'], ['CHEVROLET INDIA', 'TAVERA NEO']],
  TT: [['FORCE MOTORS LTD', 'TRAVELLER 3350'], ['TATA MOTORS LTD', 'WINGER 3488']],
};

const CLASS = {
  BIKE: ['M-Cycle/Scooter', 'Motor Cycle'],
  CAR: ['Motor Car(LMV)', 'Motor Car'],
  TOOFAN: ['Maxi Cab', 'Motor Car'],
  TT: ['Omni Bus', 'Omni Bus'],
};

/* How the visitors divide, roughly as a hill road actually sees them. */
const MIX = [['BIKE', 0.32], ['CAR', 0.52], ['TOOFAN', 0.1], ['TT', 0.06]];

const pick = (arr) => arr[crypto.randomInt(arr.length)];
const chance = (p) => Math.random() < p;

function weighted(mix) {
  const r = Math.random();
  let acc = 0;
  for (const [code, p] of mix) { acc += p; if (r <= acc) return code; }
  return mix[mix.length - 1][0];
}

const shiftDay = (date, days) => {
  const [y, m, d] = String(date).split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
};

/* How long a check takes in practice: a few seconds to read a plate and press a
   button, with the occasional slow one where somebody had to be talked to. */
const checkDuration = () => (chance(0.12) ? crypto.randomInt(12000, 45000) : crypto.randomInt(1800, 9000));

const isWeekend = (date) => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());

async function removeAll() {
  /* Children first; tickets reference vehicles and customers. */
  const counts = {};
  for (const table of ['scans', 'invoices', 'tickets', 'payments', 'vehicles', 'customers']) {
    const { rowCount } = await query(`DELETE FROM ${table} WHERE is_test`).catch(async (e) => {
      /* invoices has no flag: remove the ones pointing at test tickets. */
      if (table !== 'invoices') throw e;
      return query(`DELETE FROM invoices WHERE ticket_id IN (SELECT id FROM tickets WHERE is_test)`);
    });
    counts[table] = rowCount;
  }
  /* The inventory counters were incremented by the seeded bookings. */
  await query(`UPDATE slot_inventory SET booked = 0, held = 0 WHERE travel_date >= current_date - 60`);
  console.log('\n  removed:', Object.entries(counts).map(([t, c]) => `${c} ${t}`).join(', '));
  console.log('  slot counters reset for the last 60 days\n');
}

async function seedVehicles(categories) {
  const made = [];
  const used = new Set();

  while (made.length < VEHICLES) {
    const code = weighted(MIX);
    const regNo = `KA${pick(RTO)}ZZ${String(crypto.randomInt(1, 10000)).padStart(4, '0')}`;
    if (used.has(regNo)) continue;
    used.add(regNo);

    const [maker, model] = pick(MODELS[code]);
    const [vehicleClass, vehicleCategory] = CLASS[code];

    const row = await one(
      `INSERT INTO vehicles (reg_no, maker, model, fuel, vehicle_class, vehicle_category, seats,
                             colour, reg_date, rc_status, rc_fetched_at, is_allowed, is_test)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ACTIVE', now(), true, true)
       ON CONFLICT (reg_no) DO UPDATE SET rc_fetched_at = now(), is_test = true
       RETURNING id, reg_no`,
      [regNo, maker, model, pick(['PETROL', 'DIESEL', 'ELECTRIC(BOV)']), vehicleClass, vehicleCategory,
        code === 'TT' ? 13 : code === 'TOOFAN' ? 10 : code === 'CAR' ? 5 : 2,
        pick(['WHITE', 'SILVER', 'BLACK', 'RED', 'BLUE']),
        `20${String(crypto.randomInt(12, 25)).padStart(2, '0')}-${String(crypto.randomInt(1, 13)).padStart(2, '0')}-${String(crypto.randomInt(1, 28)).padStart(2, '0')}`]);

    made.push({ ...row, code, categoryId: categories[code].id });
  }
  return made;
}

/** One paid pass, written the way the booking writes it, minus the gateway. */
async function bookOne({ vehicle, customer, place, slot, price, travelDate, boughtAt, willEnter, enterAt }) {
  return tx(async (client) => {
    const claimed = await client.query(
      `INSERT INTO slot_inventory (place_id, slot_id, category_id, travel_date, capacity, booked, held)
       VALUES ($1,$2,$3,$4,
               COALESCE((SELECT capacity FROM slot_capacity WHERE place_id=$1 AND slot_id=$2 AND category_id=$3), 0),
               1, 0)
       ON CONFLICT (place_id, slot_id, category_id, travel_date) DO UPDATE
          SET booked = slot_inventory.booked + 1
        WHERE slot_inventory.booked + slot_inventory.held < slot_inventory.capacity
       RETURNING id`,
      [place.id, slot.id, vehicle.categoryId, travelDate]);
    if (!claimed.rows.length) return null;          // that slot is full: fine, skip

    const seq = (await client.query(
      `INSERT INTO pass_day_counters (travel_date, last_seq) VALUES ($1, 1)
       ON CONFLICT (travel_date) DO UPDATE SET last_seq = pass_day_counters.last_seq + 1
       RETURNING last_seq`, [travelDate])).rows[0].last_seq;

    const payment = (await client.query(
      `INSERT INTO payments (customer_id, amount_paise, entry_paise, platform_paise, gst_paise,
                             status, gateway, order_id, payment_id, created_at, paid_at, raw, is_test)
       VALUES ($1,$2,$3,$4,$5,'paid','razorpay',$6,$7,$8,$8,$9,true)
       RETURNING id`,
      [customer.id, price.total, price.entry, price.platform, price.gst,
        `order_TEST${crypto.randomBytes(6).toString('hex')}`,
        `pay_TEST${crypto.randomBytes(6).toString('hex')}`,
        boughtAt,
        /* The gateway's own fee, so the revenue card has something to show. */
        JSON.stringify({ gateway: { fee: Math.round(price.total * 0.02), tax: Math.round(price.total * 0.0036), test: true } })])).rows[0];

    const ticket = (await client.query(
      `INSERT INTO tickets (ticket_no, pass_seq, reference_id, customer_id, vehicle_id, place_id, slot_id,
                            category_id, payment_id, travel_date, reg_no, mobile,
                            entry_paise, platform_paise, gst_paise, total_paise, status, used_at, created_at, is_test)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,true)
       RETURNING id, ticket_no`,
      [passCodec.encode(travelDate, seq), seq,
        `TEST-${crypto.randomBytes(8).toString('hex')}`,
        customer.id, vehicle.id, place.id, slot.id, vehicle.categoryId, payment.id, travelDate,
        vehicle.reg_no, customer.mobile,
        price.entry, price.platform, price.gst, price.total,
        willEnter ? 'used' : 'paid', willEnter ? enterAt : null, boughtAt])).rows[0];

    await client.query(`UPDATE payments SET raw = raw || jsonb_build_object('ticket_id', $2::bigint) WHERE id = $1`,
      [payment.id, ticket.id]);

    return { ticket, willEnter, enterAt };
  });
}

async function seedBookings(vehicles, categories) {
  const today = slotTime.nowIST().date;
  const place = await one(`SELECT * FROM places WHERE code = 'MULLAYANAGIRI'`);
  const slots = (await query(`SELECT * FROM place_slots WHERE place_id = $1 AND is_active ORDER BY starts_at`, [place.id])).rows;
  const checkpost = await one(`SELECT * FROM checkposts WHERE place_id = $1 LIMIT 1`, [place.id]);
  const staff = await one(`SELECT * FROM staff ORDER BY id LIMIT 1`);

  const prices = {};
  for (const [code, cat] of Object.entries(categories)) {
    const p = await one(
      `SELECT entry_paise, platform_paise FROM place_pricing
        WHERE place_id = $1 AND category_id = $2 AND is_active
        ORDER BY effective_from DESC LIMIT 1`,
      [place.id, cat.id]);
    const entry = Number(p?.entry_paise || 10000);
    const platform = Number(p?.platform_paise || Math.round(entry * 0.13));
    const gstPct = 18;
    prices[code] = { entry, platform, gst: platform - Math.round((platform * 100) / (100 + gstPct)), total: entry + platform };
  }

  let made = 0; let entered = 0; let skipped = 0; let clashes = 0; const scans = [];
  /* One pass per vehicle per date is a real rule with a unique index behind it,
     so the seeder must respect it rather than discover it: a vehicle already
     booked for a date is simply passed over. */
  const taken = new Set();

  for (let d = DAYS - 1; d >= 0; d -= 1) {
    const travelDate = shiftDay(today, -d);
    const past = travelDate < today;
    /* Weekends busier; the demo should not look like a flat line. */
    const base = isWeekend(travelDate) ? 0.5 : 0.28;
    const wanted = Math.max(1, Math.round(vehicles.length * base * (0.75 + Math.random() * 0.5) / DAYS));

    for (let i = 0; i < wanted; i += 1) {
      const vehicle = pick(vehicles);
      if (taken.has(`${vehicle.id}:${travelDate}`)) { clashes += 1; continue; }
      taken.add(`${vehicle.id}:${travelDate}`);
      const slot = pick(slots);
      const mobile = `9${String(crypto.randomInt(100000000, 999999999)).padStart(9, '0')}`;

      const customer = await one(
        `INSERT INTO customers (mobile, name, language, is_test)
         VALUES ($1,$2,$3,true)
         ON CONFLICT (mobile) DO UPDATE SET name = EXCLUDED.name
         RETURNING id, mobile`,
        [mobile, pick(['Anita R', 'Suresh K', 'Nagaraj B', 'Divya S', 'Imran P', 'Lakshmi V', 'Girish M', 'Pooja N']),
          chance(0.35) ? 'kn' : 'en']);

      /* Most people book a few days ahead; some on the morning itself. */
      const daysAhead = chance(0.35) ? 0 : crypto.randomInt(1, 8);
      const boughtOn = shiftDay(travelDate, -daysAhead);
      const boughtAt = `${boughtOn}T${String(crypto.randomInt(6, 22)).padStart(2, '0')}:${String(crypto.randomInt(0, 60)).padStart(2, '0')}:00+05:30`;

      /* Most arrive; a few do not. A past day's unused pass is a no-show. */
      const willEnter = past ? chance(0.86) : (chance(0.45) && slot.starts_at < `${slotTime.hhmm(slotTime.nowIST().minutes)}:00`);
      const enterAt = willEnter
        ? `${travelDate}T${String(Number(String(slot.starts_at).slice(0, 2)) + crypto.randomInt(0, 4)).padStart(2, '0')}:${String(crypto.randomInt(0, 60)).padStart(2, '0')}:00+05:30`
        : null;

      /* A clash can still happen if the database already holds a pass for this
         vehicle and date from an earlier run; that is the same rule speaking, so
         it is counted and stepped over. */
      const out = await bookOne({
        vehicle, customer, place, slot, price: prices[vehicle.code], travelDate, boughtAt, willEnter, enterAt,
      }).catch((e) => {
        if (e.code === '23505') { clashes += 1; return null; }
        throw e;
      });
      if (!out) continue;
      made += 1;
      if (willEnter) { entered += 1; scans.push({ ticket: out.ticket, vehicle, at: enterAt, verdict: chance(0.05) ? 'valid_override' : 'valid' }); }
      else if (past) skipped += 1;
    }
  }

  /* The gate's own record, including the refusals that make the dashboard's
     duplicate and invalid figures mean something. */
  for (const s of scans) {
    await query(
      `INSERT INTO scans (ticket_id, ticket_no, reg_no, checkpost_id, staff_id, verdict, scanned_at,
                          raw_payload, duration_ms, is_test)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)`,
      [s.ticket.id, s.ticket.ticket_no, s.vehicle.reg_no, checkpost?.id || null, staff?.id || null,
        s.verdict, s.at, JSON.stringify({ seeded: true }), checkDuration()]);

    /* Roughly one in twelve is presented a second time — the duplicate case. */
    if (chance(0.08)) {
      await query(
        `INSERT INTO scans (ticket_id, ticket_no, reg_no, checkpost_id, staff_id, verdict, scanned_at, raw_payload, is_test)
         VALUES ($1,$2,$3,$4,$5,'already_used',$6,$7,$8,true)`,
        [s.ticket.id, s.ticket.ticket_no, s.vehicle.reg_no, checkpost?.id || null, staff?.id || null,
          s.at, JSON.stringify({ seeded: true }), checkDuration()]);
    }
  }

  /* A handful of vehicles that turn up with no pass at all. */
  const today0 = slotTime.nowIST().date;
  for (let i = 0; i < Math.max(2, Math.round(made * 0.03)); i += 1) {
    const v = pick(vehicles);
    await query(
      `INSERT INTO scans (reg_no, checkpost_id, staff_id, verdict, scanned_at, raw_payload, duration_ms, is_test)
       VALUES ($1,$2,$3,'unknown_ticket', $4, $5, $6, true)`,
      [v.reg_no, checkpost?.id || null, staff?.id || null,
        `${today0}T${String(crypto.randomInt(7, 17)).padStart(2, '0')}:${String(crypto.randomInt(0, 60)).padStart(2, '0')}:00+05:30`,
        JSON.stringify({ seeded: true }), checkDuration()]);
  }

  return { made, entered, skipped, clashes, scans: scans.length };
}

(async () => {
  if (flag('remove')) { await removeAll(); await getPool().end(); return; }

  const cats = Object.fromEntries(
    (await query(`SELECT id, code FROM vehicle_categories WHERE is_active`)).rows.map((r) => [r.code, r]));

  console.log(`\n  seeding ${VEHICLES} test vehicles (no ULIP calls — written straight to the cache)`);
  const vehicles = await seedVehicles(cats);
  console.log(`  ${vehicles.length} vehicles ready`);

  if (WITH_BOOKINGS) {
    console.log(`  seeding bookings across the last ${DAYS} days…`);
    const out = await seedBookings(vehicles, cats);
    console.log(`  ${out.made} passes · ${out.entered} entered · ${out.skipped} no-shows · ${out.scans} gate records`
      + (out.clashes ? ` · ${out.clashes} skipped (vehicle already booked that date)` : ''));
  }

  console.log('\n  every row is marked is_test — remove with: node scripts/seed-test-data.js --remove\n');
  await getPool().end();
})().catch(async (e) => {
  console.error('\n  ' + (e.stack || e.message) + '\n');
  await getPool().end();
  process.exit(1);
});
