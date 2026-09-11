#!/usr/bin/env node
/**
 * seed-negative.js — invented bad behaviour, for testing Negative Tracking.
 *
 *   node scripts/seed-negative.js            add a fortnight of negative activity
 *   node scripts/seed-negative.js --days 30
 *
 * Works only on data already marked is_test (run seed-test-data.js first), and
 * everything it writes is marked is_test too, so seed-test-data.js --remove
 * clears it. It never calls ULIP and cannot send a message: every visitor it
 * touches has a number in the reserved 000 range, which whatsapp/send.js
 * refuses to message.
 *
 * What it creates, and why each looks the way it does:
 *
 *   expired passes presented     a pass for a past date shown at the gate later
 *   early passes presented       a pass for a future date shown too soon
 *   reuse attempts               a used pass presented again hours afterwards
 *   double checks                a used pass looked up again within minutes
 *   unpaid passes presented      an abandoned hold shown as if it were a pass
 *   repeat offenders             a handful of vehicles refused three to six times
 *   payment failures             declined, timed out, cancelled at the bank
 *   abandoned holds              places held and never paid for, some in bursts
 *   booking abuse                one number booking many vehicles for one date
 */

require('dotenv').config();
const crypto = require('crypto');
const { pool: getPool, query, one, tx } = require('../src/gatepass/db');
const passCodec = require('../src/gatepass/passCodec');
const slotTime = require('../src/gatepass/slotTime');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};
const DAYS = Math.max(3, Math.min(60, opt('days', 14)));

const pick = (arr) => arr[crypto.randomInt(arr.length)];
const chance = (p) => Math.random() < p;
const rand = (a, b) => crypto.randomInt(a, b + 1);
const duration = () => (chance(0.2) ? rand(15000, 60000) : rand(2500, 12000));

const shiftDay = (date, days) => {
  const [y, m, d] = String(date).split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
};
const at = (date, hour, minute) => `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+05:30`;

async function scan({ ticket = null, regNo, staffId, checkpostId, verdict, when }) {
  await query(
    `INSERT INTO scans (ticket_id, ticket_no, reg_no, checkpost_id, staff_id, verdict, scanned_at, raw_payload, duration_ms, is_test)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)`,
    [ticket ? ticket.id : null, ticket ? ticket.ticket_no : null, regNo, checkpostId, staffId, verdict, when,
      JSON.stringify({ seeded: 'negative' }), duration()]);
}

(async () => {
  const today = slotTime.nowIST().date;
  const staff = (await query(`SELECT id FROM staff WHERE is_active ORDER BY id`)).rows;
  const checkpost = await one(`SELECT id, place_id FROM checkposts ORDER BY id LIMIT 1`);
  const staffId = () => (staff.length ? pick(staff).id : null);
  const counts = {};
  const bump = (k, n = 1) => { counts[k] = (counts[k] || 0) + n; };

  const used = (await query(
    `SELECT id, ticket_no, reg_no, travel_date, used_at FROM tickets
      WHERE is_test AND status = 'used' AND travel_date BETWEEN $1::date AND $2::date
      ORDER BY random() LIMIT 400`, [shiftDay(today, -DAYS), shiftDay(today, -1)])).rows;
  const upcoming = (await query(
    `SELECT id, ticket_no, reg_no, travel_date FROM tickets
      WHERE is_test AND status = 'paid' AND travel_date > $1::date ORDER BY random() LIMIT 80`, [today])).rows;
  const vehicles = (await query(`SELECT reg_no FROM vehicles WHERE is_test ORDER BY random() LIMIT 60`)).rows;
  const customers = (await query(`SELECT id, mobile FROM customers WHERE is_test AND mobile ~ '^000' ORDER BY random() LIMIT 80`)).rows;

  if (!used.length || !customers.length) {
    console.log('\n  No test data to build on. Run: node scripts/seed-test-data.js --days 30 --future 14 --per-day 200\n');
    await getPool().end();
    return;
  }

  /* Expired: a pass for a past date, shown at the gate one to five days later. */
  for (const t of used.slice(0, 45)) {
    const day = shiftDay(t.travel_date instanceof Date ? t.travel_date.toISOString().slice(0, 10) : t.travel_date, rand(1, 5));
    if (day > today) continue;
    await scan({ ticket: t, regNo: t.reg_no, staffId: staffId(), checkpostId: checkpost.id, verdict: 'wrong_day', when: at(day, rand(6, 16), rand(0, 59)) });
    bump('expired passes presented');
  }

  /* Early: a pass for a future date, shown today or yesterday. */
  for (const t of upcoming.slice(0, 18)) {
    const day = shiftDay(today, -rand(0, 1));
    await scan({ ticket: t, regNo: t.reg_no, staffId: staffId(), checkpostId: checkpost.id, verdict: 'wrong_day', when: at(day, rand(6, 16), rand(0, 59)) });
    bump('early passes presented');
  }

  /* Reuse: a used pass presented again, hours to a day after its entry. */
  for (const t of used.slice(45, 110)) {
    const later = new Date(new Date(t.used_at).getTime() + rand(2, 26) * 3600 * 1000);
    if (later.toISOString().slice(0, 10) > today) continue;
    await scan({ ticket: t, regNo: t.reg_no, staffId: staffId(), checkpostId: checkpost.id, verdict: 'already_used', when: later.toISOString() });
    bump('reuse attempts');
  }

  /* Double checks: looked up again within a few minutes — usually a staff slip. */
  for (const t of used.slice(110, 150)) {
    const soon = new Date(new Date(t.used_at).getTime() + rand(1, 9) * 60 * 1000);
    await scan({ ticket: t, regNo: t.reg_no, staffId: staffId(), checkpostId: checkpost.id, verdict: 'already_used', when: soon.toISOString() });
    bump('double checks');
  }

  /* Repeat offenders: a few vehicles refused again and again over the fortnight. */
  for (const v of vehicles.slice(0, 9)) {
    const attempts = rand(3, 6);
    const firstDay = rand(1, DAYS - 1);
    for (let i = 0; i < attempts; i += 1) {
      const day = shiftDay(today, -Math.max(0, firstDay - Math.floor(i * rand(0, 2))));
      await scan({ regNo: v.reg_no, staffId: staffId(), checkpostId: checkpost.id,
        /* No pass to be early or late for, so these are invalid attempts. */
        verdict: 'unknown_ticket', when: at(day, rand(6, 16), rand(0, 59)) });
    }
    bump('repeat-offender vehicles');
    bump('repeat-offender attempts', attempts);
  }

  /* Abandoned holds, and for a few numbers, a burst of them in one day. */
  const slots = (await query(`SELECT id FROM place_slots WHERE place_id = $1 AND is_active`, [checkpost.place_id])).rows;
  const cats = (await query(`SELECT id FROM vehicle_categories WHERE is_active`)).rows;
  const holdFor = async (customer, regNo, travelDate, heldAt) => {
    const veh = await one(`SELECT id FROM vehicles WHERE reg_no = $1`, [regNo]);
    if (!veh) return null;
    return tx(async (client) => {
      const seq = (await client.query(
        `INSERT INTO pass_day_counters (travel_date, last_seq) VALUES ($1, 1)
         ON CONFLICT (travel_date) DO UPDATE SET last_seq = pass_day_counters.last_seq + 1 RETURNING last_seq`, [travelDate])).rows[0].last_seq;
      const r = await client.query(
        `INSERT INTO tickets (ticket_no, pass_seq, reference_id, customer_id, vehicle_id, place_id, slot_id, category_id,
                              travel_date, reg_no, mobile, entry_paise, platform_paise, gst_paise, total_paise,
                              status, held_until, created_at, is_test)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,10000,1300,198,11300,'expired',$12,$13,true)
         RETURNING id, ticket_no`,
        [passCodec.encode(travelDate, seq), seq, `TEST-NEG-${crypto.randomBytes(8).toString('hex')}`,
          customer.id, veh.id, checkpost.place_id, pick(slots).id, pick(cats).id, travelDate, regNo, customer.mobile,
          new Date(new Date(heldAt).getTime() + 10 * 60 * 1000).toISOString(), heldAt]);
      return r.rows[0];
    }).catch((e) => (e.code === '23505' ? null : Promise.reject(e)));
  };

  const abandoned = [];
  for (const c of customers.slice(0, 30)) {
    const bursts = customers.indexOf(c) < 4 ? rand(3, 5) : 1;
    const day = shiftDay(today, -rand(0, DAYS - 1));
    for (let i = 0; i < bursts; i += 1) {
      const h = await holdFor(c, pick(vehicles).reg_no, shiftDay(day, rand(1, 7)), at(day, rand(8, 20), rand(0, 59)));
      if (h) { abandoned.push(h); bump(bursts > 1 ? 'abandoned holds (bursts)' : 'abandoned holds'); }
    }
  }

  /* An abandoned hold's number shown at the gate as if it were a pass. */
  for (const h of abandoned.slice(0, 8)) {
    const t = await one(`SELECT id, ticket_no, reg_no, travel_date FROM tickets WHERE id = $1`, [h.id]);
    const day = t.travel_date instanceof Date ? t.travel_date.toISOString().slice(0, 10) : String(t.travel_date).slice(0, 10);
    if (day > today) continue;
    await scan({ ticket: t, regNo: t.reg_no, staffId: staffId(), checkpostId: checkpost.id, verdict: 'not_paid', when: at(day, rand(6, 16), rand(0, 59)) });
    bump('unpaid passes presented');
  }

  /* Payment failures, with the reasons a bank actually gives. */
  const REASONS = ['Payment declined by the bank', 'UPI request timed out', 'Payment cancelled by the visitor',
    'Insufficient funds', 'Bank server unavailable', 'Card authentication failed'];
  for (const c of customers.slice(10, 45)) {
    const n = customers.indexOf(c) < 14 ? rand(3, 4) : 1;
    const day = shiftDay(today, -rand(0, DAYS - 1));
    for (let i = 0; i < n; i += 1) {
      await query(
        `INSERT INTO payments (customer_id, amount_paise, entry_paise, platform_paise, gst_paise, status, gateway,
                               order_id, created_at, raw, is_test)
         VALUES ($1, 11300, 10000, 1300, 198, 'failed', 'razorpay', $2, $3, $4, true)`,
        [c.id, `order_TESTNEG${crypto.randomBytes(5).toString('hex')}`, at(day, rand(7, 21), rand(0, 59)),
          JSON.stringify({ failed_reason: pick(REASONS), seeded: 'negative' })]);
      bump('payment failures');
    }
  }

  /* Booking abuse: one number buying passes for many vehicles on one date. */
  const abuser = customers[customers.length - 1];
  const abuseDate = shiftDay(today, rand(2, 6));
  let abuseCount = 0;
  for (const v of vehicles.slice(20, 26)) {
    const veh = await one(`SELECT id FROM vehicles WHERE reg_no = $1`, [v.reg_no]);
    const booked = await tx(async (client) => {
      const seq = (await client.query(
        `INSERT INTO pass_day_counters (travel_date, last_seq) VALUES ($1, 1)
         ON CONFLICT (travel_date) DO UPDATE SET last_seq = pass_day_counters.last_seq + 1 RETURNING last_seq`, [abuseDate])).rows[0].last_seq;
      const pay = (await client.query(
        `INSERT INTO payments (customer_id, amount_paise, entry_paise, platform_paise, gst_paise, status, gateway, order_id,
                               payment_id, created_at, paid_at, raw, is_test)
         VALUES ($1, 11300, 10000, 1300, 198, 'paid', 'razorpay', $2, $3, now(), now(), $4, true) RETURNING id`,
        [abuser.id, `order_TESTABUSE${crypto.randomBytes(5).toString('hex')}`, `pay_TESTABUSE${crypto.randomBytes(5).toString('hex')}`,
          JSON.stringify({ gateway: { fee: 226, simulated: true }, seeded: 'negative' })])).rows[0];
      return client.query(
        `INSERT INTO tickets (ticket_no, pass_seq, reference_id, customer_id, vehicle_id, place_id, slot_id, category_id, payment_id,
                              travel_date, reg_no, mobile, entry_paise, platform_paise, gst_paise, total_paise, status, created_at, is_test)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,10000,1300,198,11300,'paid', now(), true) RETURNING id`,
        [passCodec.encode(abuseDate, seq), seq, `TEST-ABUSE-${crypto.randomBytes(8).toString('hex')}`, abuser.id, veh.id,
          checkpost.place_id, pick(slots).id, cats[1] ? cats[1].id : cats[0].id, pay.id, abuseDate, v.reg_no, abuser.mobile]);
    }).catch((e) => (e.code === '23505' ? null : Promise.reject(e)));
    if (booked) abuseCount += 1;
  }
  bump('booking-abuse passes (one number)', abuseCount);

  console.log(`\n  negative activity added across the last ${DAYS} days (test data only, nothing sent, no ULIP):`);
  Object.entries(counts).forEach(([k, v]) => console.log(`    ${String(v).padStart(4)}  ${k}`));
  console.log('\n  remove everything seeded with: node scripts/seed-test-data.js --remove\n');
  await getPool().end();
})().catch(async (e) => {
  console.error('\n  ' + (e.stack || e.message) + '\n');
  await getPool().end();
  process.exit(1);
});
