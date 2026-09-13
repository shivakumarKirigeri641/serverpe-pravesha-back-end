#!/usr/bin/env node
/**
 * temp-seed-occupancy.js — TEMPORARY demonstration data, to a given occupancy.
 *
 *   node scripts/temp-seed-occupancy.js              1 August to today
 *   node scripts/temp-seed-occupancy.js --from=2026-08-01 --to=2026-09-12
 *   node scripts/temp-seed-occupancy.js --holidays=2026-08-15,2026-08-28
 *   node scripts/temp-seed-occupancy.js --keep-prices
 *   node scripts/temp-seed-occupancy.js --remove     take it all out again
 *
 * THIS FILE IS DISPOSABLE. It exists to fill a demonstration database and is
 * not part of the product: nothing in src/ calls it, and deleting it changes
 * nothing. It writes rows directly rather than going through booking.js,
 * because a day at 100% occupancy is 1,500 bookings and the real path is one
 * transaction each.
 *
 * SAFETY, WHICH IS NOT NEGOTIABLE HERE:
 *   * no vehicle is ever looked up — every vehicle is written straight into the
 *     cache with a fresh rc_fetched_at, so no ULIP or gateway call can happen;
 *   * no message is ever sent — conversations are written into wa_messages as
 *     history, the same rows a real conversation would have left behind;
 *   * every visitor is in the reserved 000 range, which cannot be a real
 *     Indian number and which whatsapp/send.js refuses outright;
 *   * every row is flagged is_test, so --remove and the other test scripts can
 *     take it out again;
 *   * the one real conversation (KEEP_MOBILE) is never touched.
 *
 * WHAT IT PRODUCES
 *   Prices     car 100, bike 50, toofan 150, tempo traveller 150, plus a 10%
 *              service fee (GST inside it).
 *   Capacity   per slot: 400 cars, 150 bikes, 100 toofans, 100 tempo travellers.
 *   Occupancy  per slot, by the day of the week, as asked:
 *              Sun 95-100, Mon 75-90, Tue 60-80, Wed 50-65, Thu 60-80,
 *              Fri 75-90, Sat 95-100, holidays 98-100.
 *   Everything else follows from that: who booked when, who turned up, who was
 *   refused at the gate, what was paid, and what was said on WhatsApp.
 */

require('dotenv').config();
const crypto = require('crypto');
const { query, one } = require('../src/gatepass/db');
const slotTime = require('../src/gatepass/slotTime');
const passCodec = require('../src/gatepass/passCodec');
const arrivals = require('../src/simulation/arrivals');

/* ─────────────────────────────────────────────────────────── settings ── */

const KEEP_MOBILE = '9886122415';           // the one real conversation, never touched

const PRICES = {                            // rupees; the fee is 10% of the entry price
  CAR: 100, BIKE: 50, TOOFAN: 150, TT: 150,
};
const FEE_PERCENT = 10;
const GST_PERCENT = 18;

const CAPACITY = { CAR: 400, BIKE: 150, TOOFAN: 100, TT: 100 };   // per slot

const OCCUPANCY = {                         // [low, high] of capacity, per slot
  0: [0.95, 1.00],   // Sunday
  1: [0.75, 0.90],
  2: [0.60, 0.80],
  3: [0.50, 0.65],
  4: [0.60, 0.80],
  5: [0.75, 0.90],
  6: [0.95, 1.00],   // Saturday
  holiday: [0.98, 1.00],
};

/* Only dates that are certain are defaulted; pass --holidays to add more. */
const DEFAULT_HOLIDAYS = ['2026-08-15'];    // Independence Day

const SHOW_UP = [0.86, 0.94];               // share of passes actually used
const OVERRIDE_RATE = 0.04;                 // admitted after a warning
const REPEAT_RATE = 0.05;                   // presented again after entering
const UNKNOWN_PER_DAY = [2, 9];             // vehicles at the gate with no pass
const WRONG_DAY_RATE = 0.012;
const FAILED_PAYMENT_RATE = 0.015;
const CONVERSATIONS = 220;                  // visitors with a WhatsApp history

const RTO = ['01', '02', '03', '04', '05', '09', '13', '14', '18', '19', '20', '21', '25', '31', '41', '50', '51', '53'];
const MODELS = {
  CAR: [['MARUTI SUZUKI', 'SWIFT VDI'], ['HYUNDAI', 'CRETA SX'], ['TATA MOTORS', 'NEXON XZ'], ['MAHINDRA', 'SCORPIO N'],
    ['TOYOTA', 'INNOVA CRYSTA'], ['KIA', 'SELTOS HTK'], ['HONDA', 'CITY ZX'], ['MARUTI SUZUKI', 'BALENO ZETA']],
  BIKE: [['HERO MOTOCORP LTD', 'SPLENDOR PLUS'], ['HONDA', 'ACTIVA 6G'], ['BAJAJ AUTO LTD', 'PULSAR 150'],
    ['ROYAL ENFIELD', 'CLASSIC 350'], ['TVS MOTOR', 'JUPITER'], ['YAMAHA', 'FZ-S']],
  TOOFAN: [['FORCE MOTORS LTD', 'TRAX TOOFAN'], ['MAHINDRA', 'BOLERO MAXI'], ['CHEVROLET INDIA', 'TAVERA NEO']],
  TT: [['FORCE MOTORS LTD', 'TRAVELLER 3350'], ['TATA MOTORS', 'WINGER'], ['MAHINDRA', 'SUPRO SCHOOL VAN']],
};
const CLASS = {
  CAR: ['Motor Car', 'LMV'], BIKE: ['M-Cycle/Scooter', 'MC'],
  TOOFAN: ['Maxi Cab', 'LMV'], TT: ['Omni Bus', 'LMV'],
};
const FIRST = ['Manjunath', 'Prakash', 'Shruti', 'Deepa', 'Nagaraj', 'Rohit', 'Divya', 'Sameer', 'Pooja', 'Kiran',
  'Ravi', 'Anitha', 'Suresh', 'Lakshmi', 'Vinay', 'Sneha', 'Girish', 'Rekha', 'Mahesh', 'Chaitra',
  'Arun', 'Bhavya', 'Harish', 'Jyothi', 'Naveen', 'Priya', 'Santosh', 'Usha', 'Vikram', 'Yashoda'];
const LAST = ['R', 'K', 'B', 'S', 'P', 'V', 'M', 'N', 'G', 'H', 'D', 'T'];

/* ───────────────────────────────────────────────────────────── helpers ── */

const arg = (name, fallback = null) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const has = (name) => process.argv.includes(`--${name}`);
const rnd = (lo, hi) => lo + Math.random() * (hi - lo);
const int = (lo, hi) => Math.floor(rnd(lo, hi + 1));
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const chance = (p) => Math.random() < p;
const shiftDay = (date, days) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
const weekday = (date) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};
/** An IST wall-clock moment as a real instant. */
const ist = (date, minutes) => new Date(`${date}T${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:${String(int(0, 59)).padStart(2, '0')}+05:30`);

/** Insert many rows in one statement, in batches Postgres is happy with. */
async function bulk(table, columns, rows, { returning = null, batch = 800, onConflict = '' } = {}) {
  const out = [];
  for (let i = 0; i < rows.length; i += batch) {
    const slice = rows.slice(i, i + batch);
    const params = [];
    const values = slice.map((row) => {
      const marks = row.map((v) => { params.push(v); return `$${params.length}`; });
      return `(${marks.join(',')})`;
    });
    const r = await query(
      `INSERT INTO ${table} (${columns.join(',')}) VALUES ${values.join(',')} ${onConflict}${returning ? ` RETURNING ${returning}` : ''}`,
      params);
    if (returning) out.push(...r.rows);
  }
  return out;
}

/* ───────────────────────────────────────────────────────────── remove ── */

async function remove() {
  const keep = `(SELECT id FROM customers WHERE mobile = '${KEEP_MOBILE}')`;
  const counts = {};
  const run = async (label, sql) => { counts[label] = (await query(sql)).rowCount; };

  await run('wa_messages', `DELETE FROM wa_messages WHERE mobile <> '${KEEP_MOBILE}' AND mobile LIKE '000%'`);
  await run('wa_sessions', `DELETE FROM wa_sessions WHERE mobile LIKE '000%'`);
  await run('scans', `DELETE FROM scans WHERE is_test AND (ticket_id IS NULL OR ticket_id IN (SELECT id FROM tickets WHERE is_test AND customer_id IS DISTINCT FROM ${keep}))`);
  await run('invoices', `DELETE FROM invoices WHERE is_test AND ticket_id IN (SELECT id FROM tickets WHERE is_test AND customer_id IS DISTINCT FROM ${keep})`);
  await run('ticket_grants', `DELETE FROM ticket_grants WHERE ticket_id IN (SELECT id FROM tickets WHERE is_test AND customer_id IS DISTINCT FROM ${keep})`);
  await run('tickets', `DELETE FROM tickets WHERE is_test AND customer_id IS DISTINCT FROM ${keep}`);
  await run('payments', `DELETE FROM payments WHERE is_test AND customer_id IS DISTINCT FROM ${keep}`);
  await run('remittances', 'DELETE FROM department_remittances WHERE is_test');
  await run('vehicles', `DELETE FROM vehicles WHERE is_test AND id NOT IN (SELECT vehicle_id FROM tickets WHERE vehicle_id IS NOT NULL)`);
  await run('customers', `DELETE FROM customers WHERE is_test AND mobile <> '${KEEP_MOBILE}' AND id NOT IN (SELECT customer_id FROM tickets WHERE customer_id IS NOT NULL)`);
  await query('UPDATE slot_inventory SET booked = 0, held = 0, modified_at = now()');

  console.log('removed:', Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', '));
  console.log('slot counters reset');
}

/* ──────────────────────────────────────────────────────── the seeding ── */

async function pricing(place, categories, keepPrices) {
  if (keepPrices) return;
  for (const [code, cat] of Object.entries(categories)) {
    const entry = PRICES[code] * 100;
    const fee = Math.round((PRICES[code] * FEE_PERCENT) / 100) * 100;
    await query('UPDATE place_pricing SET is_active = false WHERE place_id = $1 AND category_id = $2 AND is_active', [place.id, cat.id]);
    await query(
      `INSERT INTO place_pricing (place_id, category_id, entry_paise, platform_paise, effective_from, is_active)
       VALUES ($1,$2,$3,$4, now(), true)`, [place.id, cat.id, entry, fee]);
  }
  await query(
    `INSERT INTO app_settings (key, value) VALUES ('platform_fee_percent', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, modified_at = now()`, [String(FEE_PERCENT)]);
  console.log(`prices set: ${Object.entries(PRICES).map(([c, v]) => `${c} ₹${v}+₹${(v * FEE_PERCENT) / 100}`).join(', ')}`);
}

async function capacity(place, slots, categories) {
  for (const slot of slots) {
    for (const [code, cat] of Object.entries(categories)) {
      await query(
        `INSERT INTO slot_capacity (place_id, slot_id, category_id, capacity) VALUES ($1,$2,$3,$4)
         ON CONFLICT (place_id, slot_id, category_id) DO UPDATE SET capacity = EXCLUDED.capacity`,
        [place.id, slot.id, cat.id, CAPACITY[code]]);
    }
  }
  console.log(`capacity per slot: ${Object.entries(CAPACITY).map(([c, v]) => `${c} ${v}`).join(', ')} (${Object.values(CAPACITY).reduce((a, b) => a + b, 0)} a slot)`);
}

/**
 * A fleet big enough that a busy Sunday never runs out of vehicles.
 *
 * Whatever is already in the test fleet is reused, so running this again for a
 * single day tops up the same vehicles instead of inventing thousands more.
 */
async function fleet(categories) {
  const need = { CAR: 3400, BIKE: 1300, TOOFAN: 900, TT: 900 };
  const made = { CAR: [], BIKE: [], TOOFAN: [], TT: [] };
  const seen = new Set();

  const existing = (await query(
    `SELECT id, reg_no, vehicle_class FROM vehicles WHERE is_test AND rc_fetched_at IS NOT NULL ORDER BY id`)).rows;
  const byClass = Object.fromEntries(Object.entries(CLASS).map(([code, [cls]]) => [cls, code]));
  for (const v of existing) {
    const code = byClass[v.vehicle_class];
    if (!code) continue;
    seen.add(v.reg_no);
    made[code].push({ id: v.id, regNo: v.reg_no, code, categoryId: categories[code].id });
  }

  for (const [code, count] of Object.entries(need)) {
    const rows = [];
    while (made[code].length + rows.length < count) {
      const regNo = `KA${pick(RTO)}ZZ${String(int(1, 9999)).padStart(4, '0')}`;
      if (seen.has(regNo)) continue;
      seen.add(regNo);
      const [maker, model] = pick(MODELS[code]);
      const [vClass, vCat] = CLASS[code];
      rows.push([regNo, maker, model, pick(['PETROL', 'DIESEL', 'ELECTRIC(BOV)']), vClass, vCat,
        code === 'TT' ? 13 : code === 'TOOFAN' ? 10 : code === 'CAR' ? 5 : 2,
        pick(['WHITE', 'SILVER', 'BLACK', 'RED', 'BLUE', 'GREY']),
        `20${String(int(12, 24)).padStart(2, '0')}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`]);
    }
    if (rows.length) {
      const inserted = await bulk('vehicles',
        ['reg_no', 'maker', 'model', 'fuel', 'vehicle_class', 'vehicle_category', 'seats', 'colour', 'reg_date',
          'rc_status', 'rc_fetched_at', 'is_allowed', 'is_test'],
        rows.map((r) => [...r, 'ACTIVE', new Date(), true, true]),
        { returning: 'id, reg_no', onConflict: 'ON CONFLICT (reg_no) DO UPDATE SET rc_fetched_at = now(), is_test = true' });
      made[code].push(...inserted.map((v) => ({ id: v.id, regNo: v.reg_no, code, categoryId: categories[code].id })));
    }
  }
  /* A plate that already existed comes back from the upsert, so the pool can
     hold the same vehicle twice — and the same vehicle twice in one day is a
     unique-index violation. Dedupe by id. */
  for (const code of Object.keys(made)) {
    const byId = new Map(made[code].map((v) => [String(v.id), v]));
    made[code] = [...byId.values()];
  }
  console.log(`fleet: ${Object.entries(made).map(([c, v]) => `${v.length} ${c}`).join(', ')}`);
  return made;
}

/** Owners, with a long tail: a few regulars, many occasional, most once or twice. */
async function visitors(count) {
  const have = (await query(
    `SELECT id, mobile, name, language FROM customers WHERE is_test AND mobile LIKE '000%' ORDER BY id`)).rows;
  const rows = [];
  const seen = new Set(have.map((c) => c.mobile));
  while (have.length + rows.length < count) {
    const mobile = `000${String(int(0, 9999999)).padStart(7, '0')}`;
    if (seen.has(mobile) || mobile === KEEP_MOBILE) continue;
    seen.add(mobile);
    rows.push([mobile, `${pick(FIRST)} ${pick(LAST)}`, chance(0.35) ? 'kn' : 'en', true,
      chance(0.7) ? `${pick(FIRST)}` : null]);
  }
  const made = rows.length ? await bulk('customers', ['mobile', 'name', 'language', 'is_test', 'wa_profile_name'], rows,
    { returning: 'id, mobile, name, language', onConflict: 'ON CONFLICT (mobile) DO UPDATE SET is_test = true' }) : [];
  const all = [...have, ...made].map((c) => ({ id: c.id, mobile: c.mobile, name: c.name, language: c.language }));
  console.log(`visitors: ${all.length}${made.length ? ` (${made.length} new)` : ''}`);
  return all;
}

/**
 * Weighted draw without replacement: regulars come back, and nobody gets two
 * passes for the same day. The cumulative weights are worked out once and drawn
 * from by binary search — fifty thousand bookings is too many for a linear scan.
 */
function chooser(items) {
  const cumulative = [];
  let acc = 0;
  items.forEach((_, i) => { acc += 1 / (i + 1) ** 0.85; cumulative[i] = acc; });
  const total = acc;
  const one = () => {
    const r = Math.random() * total;
    let lo = 0;
    let hi = cumulative.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cumulative[mid] < r) lo = mid + 1; else hi = mid; }
    return items[lo];
  };

  return (taken, wanted) => {
    const out = [];
    const guard = taken instanceof Set ? taken : new Set(taken);
    const mine = new Set();
    let attempts = 0;
    while (out.length < wanted && attempts < wanted * 30) {
      attempts += 1;
      const item = one();
      if (guard.has(item.id) || mine.has(item.id)) continue;
      mine.add(item.id);
      out.push(item);
    }
    /* A busy Sunday wants most of the fleet; take whoever is left, in order. */
    for (let i = 0; out.length < wanted && i < items.length; i += 1) {
      const item = items[i];
      if (guard.has(item.id) || mine.has(item.id)) continue;
      mine.add(item.id);
      out.push(item);
    }
    return out;
  };
}

async function main() {
  const started = Date.now();
  const today = slotTime.nowIST().date;
  const nowMinutes = slotTime.nowIST().minutes;
  const from = arg('from', `${today.slice(0, 4)}-08-01`);
  const to = arg('to', today) === 'today' ? today : arg('to', today);
  const holidays = new Set((arg('holidays', DEFAULT_HOLIDAYS.join(',')) || '').split(',').filter(Boolean));

  const place = await one(`SELECT * FROM places WHERE code = 'MULLAYANAGIRI'`);
  const slots = (await query('SELECT * FROM place_slots WHERE place_id = $1 AND is_active ORDER BY starts_at', [place.id])).rows;
  const cats = Object.fromEntries((await query('SELECT id, code FROM vehicle_categories WHERE is_active')).rows.map((c) => [c.code, c]));
  const checkpost = await one('SELECT * FROM checkposts WHERE place_id = $1 AND is_active ORDER BY id LIMIT 1', [place.id]);
  const staff = (await query('SELECT id, name FROM staff WHERE is_active ORDER BY id')).rows;

  console.log(`\nMullayanagiri · ${from} → ${to} · ${slots.length} slots · holidays: ${[...holidays].join(', ') || 'none'}\n`);

  await pricing(place, cats, has('keep-prices'));
  await capacity(place, slots, cats);

  const priced = {};
  for (const code of Object.keys(CAPACITY)) {
    const entry = PRICES[code] * 100;
    const fee = Math.round((PRICES[code] * FEE_PERCENT) / 100) * 100;
    const taxable = Math.round((fee * 100) / (100 + GST_PERCENT));
    priced[code] = { entry, fee, gst: fee - taxable, total: entry + fee };
  }

  const cars = await fleet(cats);
  const people = await visitors(4200);
  const draw = Object.fromEntries(Object.entries(cars).map(([code, list]) => [code, chooser(list)]));
  const pickPerson = chooser(people);

  /* Each vehicle has a usual owner; some households share one number. */
  const owners = new Map();
  for (const [, list] of Object.entries(cars)) {
    list.forEach((v, i) => { owners.set(v.id, people[(i * 7 + list.length) % people.length]); });
  }

  const days = [];
  for (let d = from; d <= to; d = shiftDay(d, 1)) days.push(d);

  let totals = { tickets: 0, entries: 0, refusals: 0, failed: 0, days: 0 };
  const madeForConversation = [];

  for (const date of days) {
    const band = holidays.has(date) ? OCCUPANCY.holiday : OCCUPANCY[weekday(date)];
    const takenVehicles = new Set();
    const payments = [];
    const tickets = [];
    const invHits = [];

    for (const slot of slots) {
      const startMin = slotTime.toMinutes(slot.starts_at);
      const endMin = slotTime.toMinutes(slot.ends_at);
      const lastEntry = endMin - 60;

      for (const code of Object.keys(CAPACITY)) {
        const cap = CAPACITY[code];
        const occupancy = rnd(band[0], band[1]);
        const wanted = Math.min(cap, Math.round(cap * occupancy));
        const chosen = draw[code](takenVehicles, wanted);
        chosen.forEach((v) => takenVehicles.add(v.id));
        invHits.push({ slotId: slot.id, categoryId: cats[code].id, booked: chosen.length, capacity: cap });

        for (const vehicle of chosen) {
          const owner = chance(0.85) ? owners.get(vehicle.id) : pickPerson([], 1)[0];
          const p = priced[code];

          /* Booked a few days ahead, in the evening more often than not. */
          const daysAhead = date === today ? 0 : [0, 1, 1, 2, 2, 3, 4, 5, 6][int(0, 8)];
          const bookedOn = shiftDay(date, -daysAhead);
          /* Nothing may be stamped later than this moment: a booking made at
             nine tonight has not happened yet at seven this morning. */
          const latest = bookedOn === today ? Math.max(1, nowMinutes) : 1320;
          const earliest = Math.min(daysAhead === 0 ? Math.max(300, startMin - 240) : 420, latest - 1);
          const boughtAt = ist(bookedOn, int(Math.max(1, earliest), latest));

          /* Most turn up, inside their slot, at the hour people really arrive:
             the drive from Bengaluru is four to five hours, so the hill fills
             late morning rather than the moment the gate opens. */
          const shows = chance(rnd(SHOW_UP[0], SHOW_UP[1]));
          const enterMin = arrivals.pickMinute(startMin, lastEntry - 5);
          const entered = shows && (date < today || (date === today && enterMin <= nowMinutes));
          const enterAt = entered ? ist(date, enterMin) : null;

          const orderId = `order_TS${crypto.randomBytes(6).toString('hex')}`;
          const payId = `pay_TS${crypto.randomBytes(6).toString('hex')}`;
          payments.push([owner.id, p.total, p.entry, p.fee, p.gst, 'paid', 'razorpay', orderId, payId, boughtAt, boughtAt,
            JSON.stringify({ gateway: { fee: Math.round(p.total * 0.02), tax: Math.round(p.total * 0.0036), method: pick(['upi', 'card', 'netbanking', 'upi', 'upi']), seeded: 'occupancy' } }), true]);
          tickets.push({
            payKey: payId, owner, vehicle, slot, code, price: p, date, boughtAt, entered, enterAt, categoryId: cats[code].id,
          });
        }
      }
    }

    /* Abandoned checkouts: a payment that failed, and no pass. */
    const failures = Math.round(tickets.length * FAILED_PAYMENT_RATE);
    for (let i = 0; i < failures; i += 1) {
      const person = pickPerson([], 1)[0];
      const code = pick(Object.keys(CAPACITY));
      const p = priced[code];
      const failAt = date === today ? int(Math.max(1, Math.min(420, nowMinutes - 1)), Math.max(2, nowMinutes)) : int(420, 1300);
      payments.push([person.id, p.total, p.entry, p.fee, p.gst, 'failed', 'razorpay',
        `order_TS${crypto.randomBytes(6).toString('hex')}`, null, ist(date, failAt), null,
        JSON.stringify({ failed_reason: pick(['Payment declined by the bank', 'Insufficient funds', 'UPI request timed out', 'Card authentication failed', 'Payment cancelled by the visitor']), seeded: 'occupancy' }), true]);
    }

    /* Write the day: payments, then passes, then what happened at the gate. */
    const insertedPayments = await bulk('payments',
      ['customer_id', 'amount_paise', 'entry_paise', 'platform_paise', 'gst_paise', 'status', 'gateway',
        'order_id', 'payment_id', 'created_at', 'paid_at', 'raw', 'is_test'],
      payments, { returning: 'id, payment_id' });
    const paymentByKey = new Map(insertedPayments.filter((r) => r.payment_id).map((r) => [r.payment_id, r.id]));

    /* Continue after any pass that already exists for this date — the one real
       booking on the demonstration database holds a number of its own. */
    let seq = Number((await one('SELECT COALESCE(max(pass_seq), 0) AS last FROM tickets WHERE travel_date = $1', [date])).last);
    const ticketRows = tickets.map((t) => {
      seq += 1;
      return [passCodec.encode(t.date, seq), seq, `TS-${crypto.randomBytes(8).toString('hex')}`,
        t.owner.id, t.vehicle.id, place.id, t.slot.id, t.categoryId, paymentByKey.get(t.payKey), t.date,
        t.vehicle.regNo, t.owner.mobile, t.price.entry, t.price.fee, t.price.gst, t.price.total,
        t.entered ? 'used' : 'paid', t.enterAt, t.boughtAt, true];
    });
    await query('INSERT INTO pass_day_counters (travel_date, last_seq) VALUES ($1,$2) ON CONFLICT (travel_date) DO UPDATE SET last_seq = EXCLUDED.last_seq', [date, seq]);

    const insertedTickets = await bulk('tickets',
      ['ticket_no', 'pass_seq', 'reference_id', 'customer_id', 'vehicle_id', 'place_id', 'slot_id', 'category_id',
        'payment_id', 'travel_date', 'reg_no', 'mobile', 'entry_paise', 'platform_paise', 'gst_paise', 'total_paise',
        'status', 'used_at', 'created_at', 'is_test'],
      ticketRows, { returning: 'id, ticket_no' });

    /* The gate. Valid entries, a few admitted after a warning, some presented
       twice, the odd wrong day, and vehicles with no pass at all. */
    const scans = [];
    const gateStaff = () => (staff.length ? pick(staff).id : null);
    insertedTickets.forEach((row, i) => {
      const t = tickets[i];
      if (!t.entered) return;
      const at = t.enterAt;
      scans.push([row.id, row.ticket_no, t.vehicle.regNo, checkpost?.id || null, gateStaff(),
        chance(OVERRIDE_RATE) ? 'valid_override' : 'valid', at, JSON.stringify({ seeded: 'occupancy' }), int(4000, 15000), true]);
      const notFuture = (when) => (when.getTime() <= Date.now() ? when : null);
      if (chance(REPEAT_RATE)) {
        const again = notFuture(new Date(at.getTime() + int(20, 240) * 60000));
        if (again) {
          scans.push([row.id, row.ticket_no, t.vehicle.regNo, checkpost?.id || null, gateStaff(),
            'already_used', again, JSON.stringify({ seeded: 'occupancy' }), int(3000, 9000), true]);
        }
      }
      if (chance(WRONG_DAY_RATE)) {
        const nextDay = notFuture(ist(shiftDay(t.date, 1), int(400, 900)));
        if (nextDay) {
          scans.push([row.id, row.ticket_no, t.vehicle.regNo, checkpost?.id || null, gateStaff(),
            'wrong_day', nextDay, JSON.stringify({ seeded: 'occupancy' }), int(3000, 9000), true]);
        }
      }
    });
    const unknowns = int(UNKNOWN_PER_DAY[0], UNKNOWN_PER_DAY[1]);
    for (let i = 0; i < unknowns; i += 1) {
      const upto = date === today ? Math.min(nowMinutes, 1020) : 1020;
      if (upto <= 380) break;
      scans.push([null, null, `KA${pick(RTO)}ZZ${String(int(1, 9999)).padStart(4, '0')}`, checkpost?.id || null, gateStaff(),
        'unknown_ticket', ist(date, arrivals.pickMinute(380, upto)), JSON.stringify({ seeded: 'occupancy' }), int(4000, 12000), true]);
    }
    await bulk('scans', ['ticket_id', 'ticket_no', 'reg_no', 'checkpost_id', 'staff_id', 'verdict', 'scanned_at', 'raw_payload', 'duration_ms', 'is_test'], scans);

    /* The day's inventory: capacity, and what went. */
    for (const hit of invHits) {
      await query(
        `INSERT INTO slot_inventory (place_id, slot_id, category_id, travel_date, capacity, booked, held)
         VALUES ($1,$2,$3,$4,$5,$6,0)
         ON CONFLICT (place_id, slot_id, category_id, travel_date)
         DO UPDATE SET capacity = EXCLUDED.capacity, booked = EXCLUDED.booked, held = 0, modified_at = now()`,
        [place.id, hit.slotId, hit.categoryId, date, hit.capacity, hit.booked]);
    }

    totals.tickets += insertedTickets.length;
    totals.entries += scans.filter((s) => s[5] === 'valid' || s[5] === 'valid_override').length;
    totals.refusals += scans.filter((s) => s[5] !== 'valid' && s[5] !== 'valid_override').length;
    totals.failed += failures;
    totals.days += 1;

    /* A sample to write conversations for, spread across the period. */
    if (madeForConversation.length < CONVERSATIONS && insertedTickets.length) {
      for (let i = 0; i < Math.ceil(CONVERSATIONS / days.length) && i < insertedTickets.length; i += 1) {
        const k = int(0, insertedTickets.length - 1);
        madeForConversation.push({ ...tickets[k], ticketNo: insertedTickets[k].ticket_no });
      }
    }

    const occupancyPct = Math.round((insertedTickets.length / (Object.values(CAPACITY).reduce((a, b) => a + b, 0) * slots.length)) * 100);
    process.stdout.write(`  ${date} ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekday(date)]}${holidays.has(date) ? ' (holiday)' : ''}  ${String(insertedTickets.length).padStart(5)} passes  ${String(occupancyPct).padStart(3)}% of capacity\n`);
  }

  await conversations(madeForConversation.slice(0, CONVERSATIONS), place, slots);

  console.log(`\n${totals.tickets} passes · ${totals.entries} entries · ${totals.refusals} refusals at the gate · ${totals.failed} failed payments · ${totals.days} days`);
  console.log(`took ${Math.round((Date.now() - started) / 1000)}s`);
  console.log('\nnext: node scripts/seed-test-invoices.js   (tax invoices, TST series)');
  console.log('      node scripts/seed-test-payments.js   (settlements, refunds, remittances)\n');
}

/* ─────────────────────────────────────────────────── conversations ── */

/**
 * The WhatsApp history a booking leaves behind: the welcome, the terms, the
 * language, the vehicle, the slot, the payment link, the pass — and, for some,
 * a question afterwards. Written as rows; nothing is sent.
 */
async function conversations(samples, place, slots) {
  if (!samples.length) return;
  const rows = [];
  const sessions = [];
  const seen = new Set();

  const out = (mobile, at, type, body, payload, template = null) =>
    rows.push([mobile, 'out', type, body, JSON.stringify(payload), template, `wamid.TS${crypto.randomBytes(8).toString('hex')}`, null, at]);
  const inbound = (mobile, at, type, body, payload) =>
    rows.push([mobile, 'in', type, body, JSON.stringify(payload), null, `wamid.TSin${crypto.randomBytes(8).toString('hex')}`, null, at]);

  const buttons = (text, list, footer = null) => ({ type: 'interactive', interactive: { type: 'button', body: { text }, footer: footer ? { text: footer } : undefined, action: { buttons: list.map((t, i) => ({ reply: { id: `b${i}`, title: t } })) } } });
  const listMsg = (header, text, button, options) => ({ type: 'interactive', interactive: { type: 'list', header: { text }, body: { text }, action: { button, sections: [{ rows: options.map((t, i) => ({ id: `o${i}`, title: t })) }] } } });
  const link = (text, display, url) => ({ type: 'interactive', interactive: { type: 'cta_url', body: { text }, action: { parameters: { display_text: display, url } } } });
  const text = (body) => ({ type: 'text', text: { body } });
  const doc = (filename, caption) => ({ type: 'document', document: { filename, caption } });

  for (const s of samples) {
    if (seen.has(s.owner.mobile)) continue;
    seen.add(s.owner.mobile);
    const kn = s.owner.language === 'kn';
    const m = s.owner.mobile;
    const start = new Date(s.boughtAt.getTime() - int(6, 20) * 60000);
    const step = (mins) => new Date(start.getTime() + mins * 60000);
    const typeLabel = { CAR: 'Car / Jeep / SUV', BIKE: 'Two-wheeler', TOOFAN: 'Toofan / Maxi Cab', TT: 'Tempo Traveller' }[s.code];
    const slotLabel = String(s.slot.label).replace(/\s+/g, ' ');
    const day = new Date(`${s.date}T00:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

    inbound(m, step(0), 'text', pick(['Hi', 'hi', 'Hello', 'Namaskara', 'Booking']), text('Hi'));
    out(m, step(0.2), 'interactive', null, buttons(
      'Welcome to *Pravesha* — entry passes for Mullayanagiri.\n\nBy continuing you agree to our terms and privacy policy.',
      ['Agree & continue', 'Read terms'], 'Karnataka Tourism'));
    inbound(m, step(1), 'interactive', 'Agree & continue', { interactive: { button_reply: { id: 'agree', title: 'Agree & continue' } } });
    out(m, step(1.2), 'interactive', null, buttons('Choose your language / ಭಾಷೆ ಆಯ್ಕೆಮಾಡಿ', ['English', 'ಕನ್ನಡ']));
    inbound(m, step(2), 'interactive', kn ? 'ಕನ್ನಡ' : 'English', { interactive: { button_reply: { id: kn ? 'kn' : 'en', title: kn ? 'ಕನ್ನಡ' : 'English' } } });
    out(m, step(2.2), 'text', kn ? '✅ ಕನ್ನಡದಲ್ಲಿ ಮುಂದುವರಿಯುತ್ತಿದೆ.' : '✅ Continuing in English.', text(kn ? '✅ ಕನ್ನಡದಲ್ಲಿ ಮುಂದುವರಿಯುತ್ತಿದೆ.' : '✅ Continuing in English.'));
    out(m, step(2.4), 'interactive', null, buttons(kn ? 'ಏನು ಮಾಡಬೇಕು?' : 'What would you like to do?', kn ? ['ಪಾಸ್ ಬುಕ್ ಮಾಡಿ', 'ನನ್ನ ಬುಕಿಂಗ್‌ಗಳು', 'ಸಹಾಯ'] : ['Book pass', 'My bookings', 'Help']));
    inbound(m, step(3), 'interactive', kn ? 'ಪಾಸ್ ಬುಕ್ ಮಾಡಿ' : 'Book pass', { interactive: { button_reply: { id: 'book', title: kn ? 'ಪಾಸ್ ಬುಕ್ ಮಾಡಿ' : 'Book pass' } } });
    out(m, step(3.2), 'text', kn ? 'ನಿಮ್ಮ ವಾಹನ ಸಂಖ್ಯೆ ಕಳುಹಿಸಿ (ಉದಾ: KA05AB1234)' : 'Send your vehicle number (for example KA05AB1234)',
      text(kn ? 'ನಿಮ್ಮ ವಾಹನ ಸಂಖ್ಯೆ ಕಳುಹಿಸಿ' : 'Send your vehicle number (for example KA05AB1234)'));
    inbound(m, step(4), 'text', s.vehicle.regNo, text(s.vehicle.regNo));
    out(m, step(4.4), 'interactive', null, buttons(
      `*${s.vehicle.regNo}*\n${typeLabel}\n\n${kn ? 'ಇದು ಸರಿಯೇ?' : 'Is this correct?'}`, kn ? ['ಹೌದು', 'ಇಲ್ಲ'] : ['Yes, continue', 'No, change']));
    inbound(m, step(5), 'interactive', kn ? 'ಹೌದು' : 'Yes, continue', { interactive: { button_reply: { id: 'yes', title: kn ? 'ಹೌದು' : 'Yes, continue' } } });
    out(m, step(5.2), 'interactive', null, listMsg(kn ? 'ದಿನಾಂಕ ಆಯ್ಕೆಮಾಡಿ' : 'Choose the date', kn ? 'ಭೇಟಿಯ ದಿನಾಂಕ ಆಯ್ಕೆಮಾಡಿ' : 'Which day are you visiting?', kn ? 'ದಿನಾಂಕಗಳು' : 'Dates', [day, 'Tomorrow', 'Day after']));
    inbound(m, step(6), 'interactive', day, { interactive: { list_reply: { id: s.date, title: day } } });
    out(m, step(6.2), 'interactive', null, listMsg(kn ? 'ಸಮಯ ಆಯ್ಕೆಮಾಡಿ' : 'Choose the slot', `${day}`, kn ? 'ಸಮಯಗಳು' : 'Slots', slots.map((x) => String(x.label).replace(/\s+/g, ' '))));
    inbound(m, step(7), 'interactive', slotLabel, { interactive: { list_reply: { id: String(s.slot.id), title: slotLabel } } });
    out(m, step(7.3), 'interactive', null, link(
      `*${typeLabel}* · ${day}\n${slotLabel}\n\n${kn ? 'ಪ್ರವೇಶ ಶುಲ್ಕ' : 'Entry fee'} ₹${s.price.entry / 100}\n${kn ? 'ಸೇವಾ ಶುಲ್ಕ' : 'Service fee'} ₹${s.price.fee / 100}\n*${kn ? 'ಒಟ್ಟು' : 'Total'} ₹${s.price.total / 100}*`,
      kn ? 'ಪಾವತಿಸಿ' : 'Pay now', `https://pravesha.in/pay/${crypto.randomBytes(8).toString('base64url')}`));

    const paid = new Date(s.boughtAt.getTime());
    out(m, paid, 'text', `✅ *${kn ? 'ಪಾವತಿ ಯಶಸ್ವಿ — ನಿಮ್ಮ ಪಾಸ್ ದೃಢಪಟ್ಟಿದೆ' : 'Payment successful — your entry pass is confirmed'}*\n\n━━━━━━━━━━━━━━\n${kn ? 'ಪಾಸ್ ಸಂಖ್ಯೆ' : 'Pass number'}: *${s.ticketNo}*\n${kn ? 'ವಾಹನ' : 'Vehicle'}: ${s.vehicle.regNo}\n${kn ? 'ದಿನಾಂಕ' : 'Date'}: ${day}\n${slotLabel}\n━━━━━━━━━━━━━━`,
      text(`Payment successful — pass ${s.ticketNo}`));
    out(m, new Date(paid.getTime() + 4000), 'document', null, doc(`Pravesha-Pass-${s.ticketNo}.pdf`, `${s.ticketNo} · ${s.vehicle.regNo} · ${day}`));

    if (s.entered) {
      out(m, s.enterAt, 'template', null, { type: 'template', template: { name: kn ? 'pv_checkpostentry_kn_v3' : 'pv_checkpostentry_en_v2' } }, kn ? 'pv_checkpostentry_kn_v3' : 'pv_checkpostentry_en_v2');
    }

    /* One in four asks something afterwards. */
    if (chance(0.25)) {
      const after = new Date(Math.min(paid.getTime() + int(30, 900) * 60000, Date.now() - 60000));
      if (after.getTime() > paid.getTime()) {
      const [q, a] = pick([
        ['Can I change the date of my pass?', 'A pass is for the date and slot it was booked for and cannot be moved. You can book another pass for the new date; write to support@pravesha.in if you have paid twice by mistake.'],
        ['Is the pass for each person or for the vehicle?', 'The pass is for the vehicle. Everyone travelling in it is covered.'],
        ['What time does the gate close?', 'Entry closes one hour before the slot ends. Reach the checkpost before then — the pass will not work after it.'],
        ['I did not get the PDF', 'Send *My bookings* and we will send the pass again.'],
        ['Is parking included?', 'The pass covers entry for the vehicle. Parking at the summit is limited and is managed by the department on the day.'],
        ['Can I take my drone?', 'Drones are not allowed without written permission from the district administration.'],
      ]);
      inbound(m, after, 'text', q, text(q));
      out(m, new Date(after.getTime() + 90000), 'text', a, text(a));
      }
    }

    sessions.push([s.owner.id, m, `91${m}`, s.owner.name, 'idle',
      JSON.stringify({ seeded: 'occupancy', lastTicket: s.ticketNo }),
      rows.filter((r) => r[0] === m && r[1] === 'in').slice(-1)[0]?.[8] || start,
      rows.filter((r) => r[0] === m && r[1] === 'out').slice(-1)[0]?.[8] || start]);
  }

  await bulk('wa_messages', ['mobile', 'direction', 'message_type', 'body', 'payload', 'template_name', 'wa_message_id', 'error_message', 'created_at'], rows);
  await bulk('wa_sessions', ['customer_id', 'mobile', 'wa_id', 'profile_name', 'state', 'context', 'last_inbound_at', 'last_outbound_at'], sessions);
  console.log(`conversations: ${seen.size} visitors · ${rows.length} messages (written as history — nothing sent)`);
}

/**
 * Conversations for passes that already exist, spread across the period — for
 * topping up a database seeded before this step existed.
 */
async function conversationsOnly() {
  const from = arg('from', '2026-08-01');
  const to = arg('to', slotTime.nowIST().date);
  const wanted = Number(arg('count', '200'));
  const place = await one(`SELECT * FROM places WHERE code = 'MULLAYANAGIRI'`);
  const slots = (await query('SELECT * FROM place_slots WHERE place_id = $1 AND is_active ORDER BY starts_at', [place.id])).rows;

  const rows = (await query(
    `SELECT t.ticket_no, t.travel_date, t.created_at, t.used_at, t.status, t.entry_paise, t.platform_paise, t.total_paise,
            t.reg_no, t.slot_id, c.id AS customer_id, c.mobile, c.name, c.language, cat.code
       FROM tickets t
       JOIN customers c ON c.id = t.customer_id
       JOIN vehicle_categories cat ON cat.id = t.category_id
      WHERE t.is_test AND t.travel_date BETWEEN $1::date AND $2::date
        AND NOT EXISTS (SELECT 1 FROM wa_messages m WHERE m.mobile = c.mobile)
      ORDER BY random() LIMIT $3`, [from, to, wanted])).rows;

  const samples = rows.map((r) => ({
    owner: { id: r.customer_id, mobile: r.mobile, name: r.name, language: r.language },
    vehicle: { regNo: r.reg_no },
    slot: slots.find((s) => String(s.id) === String(r.slot_id)) || slots[0],
    code: r.code,
    price: { entry: Number(r.entry_paise), fee: Number(r.platform_paise), total: Number(r.total_paise) },
    date: r.travel_date instanceof Date ? r.travel_date.toISOString().slice(0, 10) : String(r.travel_date).slice(0, 10),
    boughtAt: new Date(r.created_at),
    entered: r.status === 'used',
    enterAt: r.used_at ? new Date(r.used_at) : null,
    ticketNo: r.ticket_no,
  }));

  await conversations(samples, place, slots);
}

/**
 * Checkouts that failed, for days that already have passes.
 *
 * A failed payment has no pass by design, which makes it indistinguishable
 * from a half-written day — so it is generated separately and marked
 * seeded=occupancy at the top level, where a clean-up can see it.
 */
async function failuresOnly() {
  const from = arg('from', '2026-08-01');
  const to = arg('to', slotTime.nowIST().date);
  const today = slotTime.nowIST().date;
  const nowMinutes = slotTime.nowIST().minutes;

  const days = (await query(
    `SELECT travel_date, count(*) AS passes FROM tickets
      WHERE is_test AND travel_date BETWEEN $1::date AND $2::date GROUP BY 1 ORDER BY 1`, [from, to])).rows;
  const people = (await query(`SELECT id FROM customers WHERE is_test AND mobile LIKE '000%' ORDER BY random() LIMIT 2000`)).rows;
  const cats = Object.fromEntries((await query('SELECT id, code FROM vehicle_categories WHERE is_active')).rows.map((c) => [c.code, c]));
  const priced = {};
  for (const code of Object.keys(CAPACITY)) {
    const entry = PRICES[code] * 100;
    const fee = Math.round((PRICES[code] * FEE_PERCENT) / 100) * 100;
    priced[code] = { entry, fee, gst: fee - Math.round((fee * 100) / (100 + GST_PERCENT)), total: entry + fee };
  }

  const rows = [];
  for (const day of days) {
    const date = day.travel_date instanceof Date ? day.travel_date.toISOString().slice(0, 10) : String(day.travel_date).slice(0, 10);
    const count = Math.max(1, Math.round(Number(day.passes) * FAILED_PAYMENT_RATE));
    for (let i = 0; i < count; i += 1) {
      const p = priced[pick(Object.keys(CAPACITY))];
      const at = date === today ? int(Math.max(1, Math.min(420, nowMinutes - 1)), Math.max(2, nowMinutes)) : int(420, 1300);
      rows.push([pick(people).id, p.total, p.entry, p.fee, p.gst, 'failed', 'razorpay',
        `order_TS${crypto.randomBytes(6).toString('hex')}`, null, ist(date, at), null,
        JSON.stringify({ seeded: 'occupancy', failed_reason: pick(['Payment declined by the bank', 'Insufficient funds', 'UPI request timed out', 'Card authentication failed', 'Payment cancelled by the visitor', 'Bank server unavailable']) }), true]);
    }
  }
  await bulk('payments', ['customer_id', 'amount_paise', 'entry_paise', 'platform_paise', 'gst_paise', 'status', 'gateway',
    'order_id', 'payment_id', 'created_at', 'paid_at', 'raw', 'is_test'], rows);
  console.log(`failed checkouts: ${rows.length} across ${days.length} days`);
}

(has('remove') ? remove()
  : has('conversations-only') ? conversationsOnly()
    : has('failures-only') ? failuresOnly()
      : main())
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
