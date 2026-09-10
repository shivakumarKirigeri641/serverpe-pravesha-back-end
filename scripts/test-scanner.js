/**
 * scripts/test-scanner.js — the gate, exercised end to end.
 *
 *   node scripts/test-scanner.js
 *
 * Runs against the live server over HTTP, because that is what a phone does.
 * It proves the three things the department asked about — a fake ticket is
 * caught, a shared ticket is caught the second time, and one staff member
 * cannot hold two gates — and cleans up the tickets it creates.
 */

require('dotenv').config();
const db = require('../src/gatepass/db');
const customers = require('../src/gatepass/customers');
const vehicles = require('../src/gatepass/vehicle');
const booking = require('../src/gatepass/booking');
const pricing = require('../src/gatepass/pricing');
const inventory = require('../src/gatepass/inventory');
const staffMod = require('../src/gatepass/staff');
const scan = require('../src/gatepass/scan');
const settings = require('../src/gatepass/settings');

const BASE = `http://localhost:${process.env.PORT || 7777}`;
let failures = 0;
const check = (ok, msg) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures++; };

const get = async (path, token) => {
  const r = await fetch(BASE + path, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
  return r.json();
};

const post = async (path, body, token) => {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' },
      token ? { Authorization: `Bearer ${token}` } : {}),
    body: JSON.stringify(body),
  });
  return r.json();
};

/**
 * Remove everything a previous run of this script created.
 *
 * A run that dies part-way leaves a live staff session holding the gate, and
 * the next run then discovers "gate busy" and reports a failure that is really
 * just yesterday's mess.
 */
async function wipeTestRows() {
  const ids = (await db.query(
    `SELECT id FROM staff WHERE name LIKE 'Test Staff %'`)).rows.map((r) => r.id);
  if (ids.length) {
    await db.query('DELETE FROM scans WHERE staff_id = ANY($1::bigint[])', [ids]);
    await db.query('DELETE FROM staff_sessions WHERE staff_id = ANY($1::bigint[])', [ids]);
    await db.query('DELETE FROM staff_checkposts WHERE staff_id = ANY($1::bigint[])', [ids]);
    await db.query('DELETE FROM staff WHERE id = ANY($1::bigint[])', [ids]);
  }
  const devs = (await db.query(
    `SELECT id FROM devices WHERE label LIKE 'test-phone-%'`)).rows.map((r) => r.id);
  if (devs.length) {
    await db.query('DELETE FROM scans WHERE device_id = ANY($1::bigint[])', [devs]);
    await db.query('DELETE FROM staff_sessions WHERE device_id = ANY($1::bigint[])', [devs]);
    await db.query('DELETE FROM devices WHERE id = ANY($1::bigint[])', [devs]);
  }
  // Tickets from an interrupted run still hold their places in the slot.
  const stale = (await db.query(
    `SELECT * FROM tickets WHERE reg_no LIKE 'KA51AA10%'`)).rows;
  for (const t of stale) {
    if (t.status === 'paid' || t.status === 'used') {
      await inventory.unbook(null, { placeId: t.place_id, travelDate: t.travel_date,
        slotId: t.slot_id, categoryId: t.category_id });
    } else if (t.status === 'held') {
      await inventory.release(null, { placeId: t.place_id, travelDate: t.travel_date,
        slotId: t.slot_id, categoryId: t.category_id });
    }
  }
  if (stale.length) {
    const tids = stale.map((t) => t.id);
    await db.query('DELETE FROM scans WHERE ticket_id = ANY($1::bigint[])', [tids]);
    await db.query('DELETE FROM tickets WHERE id = ANY($1::bigint[])', [tids]);
  }
}

/** A paid ticket for a given date, ready to scan. */
async function makeTicket(regNo, travelDate, slotCode = '0612') {
  const place = await booking.placeByCode('MULLAYANAGIRI');
  const slot = await booking.slotByCode(place.id, slotCode);
  const category = await pricing.categoryByCode('CAR');
  const customer = await customers.upsert(process.env.TEST_MOBILE, { name: 'Scanner Test' });
  const vehicle = await vehicles.upsertBare(regNo);
  const h = await booking.hold({ customer, vehicle, place, slot, category, travelDate });
  if (!h.ok) throw new Error('could not hold: ' + h.reason);
  const paid = await booking.markPaid(h.ticket.id, null);
  return paid.ticket;
}

(async () => {
  const made = [];

  // A previous run that died mid-way leaves a live session holding the gate and
  // its staff rows behind. Clear them first, or this run tests the wreckage.
  await wipeTestRows();

  const cp = await db.one(
    `SELECT c.* FROM checkposts c JOIN places p ON p.id = c.place_id
      WHERE p.code = 'MULLAYANAGIRI' ORDER BY c.id LIMIT 1`);

  // Fresh PINs and a device, so the test never depends on what was seeded.
  const d1 = await staffMod.registerDevice({ checkpostId: cp.id, label: 'test-phone-1' });
  const d2 = await staffMod.registerDevice({ checkpostId: cp.id, label: 'test-phone-2' });
  const a = await staffMod.create({ name: 'Test Staff A', checkpostIds: [cp.id] });
  const b = await staffMod.create({ name: 'Test Staff B', checkpostIds: [cp.id] });

  console.log('\nCheckpost scanner\n');

  /* ---------------------------------------------------------- sign in */

  const bad = await post('/api/scan/signin', { device_token: d1.token, pin: '000000' });
  check(!bad.ok && bad.reason === 'bad_pin', `wrong PIN refused: ${bad.reason}`);

  const noDevice = await post('/api/scan/signin', { device_token: 'not-a-real-token', pin: a.pin });
  check(!noDevice.ok && noDevice.reason === 'unknown_device',
    `unregistered phone refused: ${noDevice.reason}`);

  const s1 = await post('/api/scan/signin', { device_token: d1.token, pin: a.pin });
  check(s1.ok && s1.staff.name === 'Test Staff A', `signed in as ${s1.staff?.name}`);
  check(!!s1.public_key && s1.public_key.length === 44,
    'phone received the PUBLIC key only (32 bytes)');

  /* One gate, one scanning device. */
  const busy = await post('/api/scan/signin', { device_token: d2.token, pin: b.pin });
  check(!busy.ok && busy.reason === 'gate_busy',
    `second phone at the same gate blocked: held by ${busy.held_by}`);

  const took = await post('/api/scan/signin', { device_token: d2.token, pin: b.pin, takeover: true });
  check(took.ok && took.took_over_from === 'Test Staff A',
    `deliberate takeover recorded, from ${took.took_over_from}`);

  const dead = await get('/api/scan/status', s1.token);
  check(dead.error === 'session_ended', 'the phone that lost the gate is signed out');

  // Back to A for the scanning tests.
  const s = await post('/api/scan/signin', { device_token: d1.token, pin: a.pin, takeover: true });

  /* ---------------------------------------------------------- scanning */

  // A ticket is only valid inside its own half of the day, which means this
  // script would pass or fail depending on the clock. Widening the grace makes
  // the outcome depend on the code instead of the hour; the slot rule itself is
  // tested directly further down, with an explicit time.
  await settings.set('slot_grace_minutes', 720);
  await new Promise((r) => setTimeout(r, 16000));  // the server caches settings

  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  const t1 = await makeTicket('KA51AA1001', today); made.push(t1.id);
  const r1 = await post('/api/scan/verify', { payload: t1.qr_payload }, s.token);
  check(r1.verdict === 'valid', `genuine ticket today: ${r1.verdict}`);

  const r2 = await post('/api/scan/verify', { payload: t1.qr_payload }, s.token);
  check(r2.verdict === 'already_used', `SAME ticket scanned twice: ${r2.verdict}`);

  const t2 = await makeTicket('KA51AA1002', tomorrow); made.push(t2.id);
  const r3 = await post('/api/scan/verify', { payload: t2.qr_payload }, s.token);
  check(r3.verdict === 'wrong_day', `tomorrow's ticket presented today: ${r3.verdict}`);

  /* The slot rule, judged at a stated time rather than at whatever o'clock the
     test happens to run. 05:00 is before the morning slot's window even with an
     hour of grace. */
  await settings.set('slot_grace_minutes', 60);
  const t3 = await makeTicket('KA51AA1003', today, '0612'); made.push(t3.id);
  const early = new Date(`${today}T04:30:00`);
  const r4 = await scan.decide(t3.qr_payload, { place_id: cp.place_id }, early);
  check(r4.verdict === 'wrong_slot',
    `EARLY: morning ticket at 04:30 -> ${r4.verdict}`);

  // Late is fine: they paid, their place was counted, and turning them away
  // gains the hill nothing.
  const late = new Date(`${today}T16:00:00`);
  const r4b = await scan.decide(t3.qr_payload, { place_id: cp.place_id }, late);
  check(r4b.verdict === 'valid',
    `LATE: morning ticket at 16:00 -> ${r4b.verdict}`);

  await settings.set('slot_grace_minutes', 720);

  /* THE FRAUD: take a real ticket and edit the plate. */
  const t4 = await makeTicket('KA51AA1004', today); made.push(t4.id);
  const forged = t4.qr_payload.replace('KA51AA1004', 'KA51ZZ9999');
  const r5 = await post('/api/scan/verify', { payload: forged }, s.token);
  check(r5.verdict === 'invalid_signature', `EDITED plate: ${r5.verdict}`);

  const dateForged = t2.qr_payload.replace(tomorrow.replace(/-/g, ''), today.replace(/-/g, ''));
  const r6 = await post('/api/scan/verify', { payload: dateForged }, s.token);
  check(r6.verdict === 'invalid_signature', `EDITED date: ${r6.verdict}`);

  const r7 = await post('/api/scan/verify', { payload: 'not a ticket at all' }, s.token);
  check(r7.verdict === 'invalid_signature', `random text: ${r7.verdict}`);

  /* --------------------------------------------------- the offline queue */

  const t5 = await makeTicket('KA51AA1005', today); made.push(t5.id);
  const sync = await post('/api/scan/sync', {
    scans: [
      { client_id: 'q1', payload: t5.qr_payload, scanned_at: new Date().toISOString() },
      { client_id: 'q2', payload: t5.qr_payload, scanned_at: new Date().toISOString() },
    ],
  }, s.token);
  check(sync.results?.[0]?.verdict === 'valid' && sync.results?.[1]?.verdict === 'already_used',
    `offline queue synced: ${sync.results?.map(x => x.verdict).join(', ')}`);

  const offline = await db.one(
    `SELECT count(*)::int AS n FROM scans WHERE was_offline AND ticket_no = $1`, [t5.ticket_no]);
  check(offline.n === 2, `both offline scans recorded and flagged as offline (${offline.n})`);

  /* -------------------------------------------------------- the numbers */

  const st = await get('/api/scan/status', s.token);
  check(st.ok && st.today.total >= 8,
    `gate tally today: ${JSON.stringify(st.today)}`);

  /* ----------------------------------------------------------- clean up */

  await post('/api/scan/signout', {}, s.token);
  // Put the real rule back — a widened grace left behind would quietly admit
  // afternoon tickets in the morning.
  await settings.set('slot_grace_minutes', 60);
  await db.query('DELETE FROM scans WHERE ticket_id = ANY($1::bigint[])', [made]);
  for (const id of made) {
    const t = await db.one('SELECT * FROM tickets WHERE id = $1', [id]);
    if (t) {
      await inventory.unbook(null, { placeId: t.place_id, travelDate: t.travel_date,
        slotId: t.slot_id, categoryId: t.category_id });
    }
  }
  await db.query('DELETE FROM tickets WHERE id = ANY($1::bigint[])', [made]);
  await db.query(`DELETE FROM scans WHERE session_id IN
    (SELECT id FROM staff_sessions WHERE staff_id IN ($1, $2))`, [a.staff.id, b.staff.id]);
  await db.query('DELETE FROM staff_sessions WHERE staff_id IN ($1, $2)', [a.staff.id, b.staff.id]);
  await db.query('DELETE FROM staff_checkposts WHERE staff_id IN ($1, $2)', [a.staff.id, b.staff.id]);
  await db.query('DELETE FROM staff WHERE id IN ($1, $2)', [a.staff.id, b.staff.id]);
  await db.query('DELETE FROM devices WHERE id IN ($1, $2)', [d1.device.id, d2.device.id]);

  console.log(`\n  ${failures ? `${failures} FAILURE(S)` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('\n', e, '\n'); process.exit(1); });
