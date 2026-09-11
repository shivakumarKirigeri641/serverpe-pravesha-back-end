/**
 * scripts/test-scanner.js — the gate, exercised end to end.
 *
 *   node scripts/test-scanner.js
 *
 * Runs against the live server over HTTP, because that is what a gate phone
 * does. It proves what the department asked about — a vehicle with no booking
 * is refused, a vehicle cannot come through twice, a booking for another day is
 * caught, and one staff member cannot hold two gates — and cleans up after
 * itself.
 *
 * There is no QR here any more. The staff member types the last characters of
 * the number plate and picks the vehicle from what comes back, so these tests
 * type too.
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
    `SELECT * FROM tickets WHERE reg_no LIKE 'KA51AA10%' OR reg_no LIKE 'KA52BB10%' OR reg_no LIKE 'KA01TR%'`)).rows;
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

  console.log('\nCheckpost gate\n');

  /* ---------------------------------------------------------- sign in */

  const bad = await post('/api/gate/signin', { device_token: d1.token, pin: '000000' });
  check(!bad.ok && bad.reason === 'bad_pin', `wrong PIN refused: ${bad.reason}`);

  const noDevice = await post('/api/gate/signin', { device_token: 'not-a-real-token', pin: a.pin });
  check(!noDevice.ok && noDevice.reason === 'unknown_device',
    `unregistered phone refused: ${noDevice.reason}`);

  const s1 = await post('/api/gate/signin', { device_token: d1.token, pin: a.pin });
  check(s1.ok && s1.staff.name === 'Test Staff A', `signed in as ${s1.staff?.name}`);
  check(!s1.public_key, 'no signing key goes to the phone — there is nothing left to verify');

  /* One gate, one scanning device. */
  const busy = await post('/api/gate/signin', { device_token: d2.token, pin: b.pin });
  check(!busy.ok && busy.reason === 'gate_busy',
    `second phone at the same gate blocked: held by ${busy.held_by}`);

  const took = await post('/api/gate/signin', { device_token: d2.token, pin: b.pin, takeover: true });
  check(took.ok && took.took_over_from === 'Test Staff A',
    `deliberate takeover recorded, from ${took.took_over_from}`);

  const dead = await get('/api/gate/status', s1.token);
  check(dead.error === 'session_ended', 'the phone that lost the gate is signed out');

  // Back to A for the scanning tests.
  const s = await post('/api/gate/signin', { device_token: d1.token, pin: a.pin, takeover: true });

  /* ------------------------------------------------------- looking up */

  // A booking is only valid inside its own half of the day, which would make
  // this script pass or fail depending on the clock. Widening the grace makes
  // the outcome depend on the code instead of the hour; the slot rule itself is
  // tested directly further down, at an explicit time.
  await settings.set('slot_grace_minutes', 720);
  await new Promise((r) => setTimeout(r, 16000));  // the server caches settings

  const today = new Date().toLocaleDateString('en-CA');
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-CA');

  const t1 = await makeTicket('KA51AA1001', today); made.push(t1.id);

  /* Two characters would return half the car park, so it is refused rather
     than answered — a list that long is slower than reading the whole plate. */
  const tooShort = await post('/api/gate/search', { typed: '01' }, s.token);
  check(!tooShort.ok && tooShort.reason === 'too_short', 'two characters refused as too short');

  const found = await post('/api/gate/search', { typed: '1001' }, s.token);
  check(found.ok && found.matches.length === 1 && found.matches[0].reg_no === 'KA51AA1001',
    `typing the last four finds the vehicle: ${found.matches?.[0]?.reg_no}`);
  check(found.matches[0].verdict === 'valid', `and it reads as ${found.matches[0].verdict}`);

  const r1 = await post('/api/gate/admit',
    { ticket_id: found.matches[0].id, typed: '1001' }, s.token);
  check(r1.verdict === 'valid', `genuine booking today: ${r1.verdict}`);

  const again = await post('/api/gate/search', { typed: '1001' }, s.token);
  check(again.matches[0].verdict === 'already_used',
    `the same vehicle, looked up again: ${again.matches[0].verdict}`);

  const r2 = await post('/api/gate/admit',
    { ticket_id: found.matches[0].id, typed: '1001' }, s.token);
  check(r2.verdict === 'already_used', `and cannot be admitted twice: ${r2.verdict}`);

  /* A vehicle nobody booked for. The commonest thing at a barrier, and it is
     written down: the count is what tells the department how many were coming
     up unticketed before any of this existed. */
  const none = await post('/api/gate/search', { typed: '9999' }, s.token);
  check(none.ok && none.matches.length === 0, 'a plate with no booking returns nothing');
  const refused = await post('/api/gate/refuse', { typed: '9999', verdict: 'not_found' }, s.token);
  check(refused.ok && refused.verdict === 'not_found', 'and the refusal is recorded');

  const t2 = await makeTicket('KA51AA1002', tomorrow); made.push(t2.id);
  const tm = await post('/api/gate/search', { typed: '1002' }, s.token);
  check(tm.matches?.[0]?.verdict === 'wrong_day',
    `tomorrow's booking, presented today: ${tm.matches?.[0]?.verdict}`);

  /* MORE THAN ONE MATCH. Four digits is not unique across a few hundred
     vehicles, which is the whole reason the staff member picks from a list
     rather than the gate deciding on their behalf. */
  const c1 = await makeTicket('KA51AA1007', today); made.push(c1.id);
  const c2 = await makeTicket('KA52BB1007', today); made.push(c2.id);
  const both = await post('/api/gate/search', { typed: '1007' }, s.token);
  check(both.ok && both.matches.length === 2,
    `two vehicles share the last four, both offered (${both.matches?.length})`);
  check(both.matches.every((m) => m.reg_no.endsWith('1007')), 'and both genuinely end in 1007');

  /* -------------------------------- the booking code, as the second way in */

  /* A temporary registration is long and unfamiliar to read off a windscreen;
     a plate can be caked in mud after a hill road. The six-character booking
     code printed on the visitor's ticket is the other way in, and both have to
     land on the SAME booking — one row, admitted once, whichever way it was
     found. */
  const tr = await makeTicket('KA01TR0042', today); made.push(tr.id);

  /* Compared through Number on both sides: node-postgres returns a bigint id as
     a STRING, so a strict === against the numeric id silently never matches. */
  const isTr = (m) => Number(m.id) === Number(tr.id);

  const byPlate = await post('/api/gate/search', { typed: '0042' }, s.token);
  check(byPlate.ok && byPlate.matches.some(isTr),
    'a temporary registration is findable by its plate');
  check(byPlate.matches.find(isTr).matched_on === 'plate',
    'and the gate says it matched on the plate');

  const byCode = await post('/api/gate/search', { typed: tr.ticket_no }, s.token);
  const codeRow = byCode.matches.find(isTr);
  check(!!codeRow, `the same booking is findable by its code (${tr.ticket_no})`);
  check(codeRow.matched_on === 'code', 'and the gate says it matched on the code');
  check(codeRow.reg_no === 'KA01TR0042',
    `showing the plate it belongs to: ${codeRow.reg_no}`);

  /* THE POINT OF THE WHOLE THING: one booking, one admission. Letting it in by
     code must close it for the plate too, because they were never two records.
     If this ever diverged, a vehicle could enter twice by switching which
     identifier the staff member typed. */
  const inByCode = await post('/api/gate/admit',
    { ticket_id: codeRow.id, typed: tr.ticket_no }, s.token);
  check(inByCode.verdict === 'valid', `admitted by code: ${inByCode.verdict}`);

  const plateAfter = await post('/api/gate/search', { typed: '0042' }, s.token);
  check(plateAfter.matches.find(isTr).verdict === 'already_used',
    'and looking it up by PLATE now reads already_used — the same record, closed');

  const twice = await post('/api/gate/admit', { ticket_id: tr.id, typed: '0042' }, s.token);
  check(twice.verdict === 'already_used',
    `so it cannot be admitted a second time by the other identifier: ${twice.verdict}`);

  /* The slot rule, judged at a stated time rather than at whatever o'clock the
     test happens to run. 04:30 is before the morning slot even with an hour of
     grace. judge() is pure, so it can be asked about a time that is not now. */
  const load = (id) => db.one(
    `SELECT t.*, s.starts_at, s.ends_at, s.label AS slot_label, p.name AS place_name
       FROM tickets t JOIN place_slots s ON s.id = t.slot_id
       JOIN places p ON p.id = t.place_id WHERE t.id = $1`, [id]);

  await settings.set('slot_grace_minutes', 60);
  const t3 = await makeTicket('KA51AA1003', today, '0612'); made.push(t3.id);

  const r4 = await scan.judge(await load(t3.id), { place_id: cp.place_id },
    new Date(`${today}T04:30:00`));
  check(r4.verdict === 'wrong_slot', `EARLY: morning booking at 04:30 -> ${r4.verdict}`);

  // Late is fine: they paid, their place was counted, and turning them away
  // gains the hill nothing.
  const r4b = await scan.judge(await load(t3.id), { place_id: cp.place_id },
    new Date(`${today}T16:00:00`));
  check(r4b.verdict === 'valid', `LATE: morning booking at 16:00 -> ${r4b.verdict}`);

  await settings.set('slot_grace_minutes', 720);

  /* ---------------------------------------------------- the day's list */

  /* What the phone holds against losing signal. It has to carry enough to
     decide with, and nothing that would matter if the phone were lost. */
  const man = await get('/api/gate/manifest?date=' + today, s.token);
  check(man.ok && Array.isArray(man.tickets) && man.tickets.length >= 3,
    `the day's list downloads (${man.tickets?.length} bookings)`);
  check(man.tickets.every((x) => x.reg_no && x.slot_label && x.starts_at),
    'each row carries what the gate needs to judge it offline');
  check(man.tickets.every((x) => !('mobile' in x) && !('customer_name' in x)),
    'and no mobile number or customer name — a lost phone is not a list of visitors');

  const per = Math.round(JSON.stringify(man.tickets).length / Math.max(man.tickets.length, 1));
  check(per < 400, `about ${per} bytes per booking — a whole day fits on the phone`);

  /* --------------------------------------------------- the offline queue */

  const t5 = await makeTicket('KA51AA1005', today); made.push(t5.id);
  const sync = await post('/api/gate/sync', {
    entries: [
      { client_id: 'q1', ticket_id: t5.id, typed: '1005', at: new Date().toISOString() },
      { client_id: 'q2', ticket_id: t5.id, typed: '1005', at: new Date().toISOString() },
    ],
  }, s.token);
  check(sync.results?.[0]?.verdict === 'valid' && sync.results?.[1]?.verdict === 'already_used',
    `offline queue synced: ${sync.results?.map((x) => x.verdict).join(', ')}`);

  const offline = await db.one(
    `SELECT count(*)::int AS n FROM scans WHERE was_offline AND ticket_no = $1`, [t5.ticket_no]);
  check(offline.n === 2, `both offline entries recorded and flagged as offline (${offline.n})`);

  /* -------------------------------------------------------- the numbers */

  const st = await get('/api/gate/status', s.token);
  /* The shape of the tally, not an arbitrary floor: what a supervisor is
     handed has to distinguish the vehicles let in from the ones turned away,
     and both kinds must actually be counted. */
  check(st.ok && st.today.valid >= 2 && st.today.already_used >= 1 && st.today.not_found >= 1,
    `gate tally today: ${JSON.stringify(st.today)}`);
  check(st.today.total === Object.entries(st.today)
      .filter(([k]) => k !== 'total').reduce((n, [, v]) => n + v, 0),
    'and the total is the sum of its parts');

  /* ----------------------------------------------------------- clean up */

  await post('/api/gate/signout', {}, s.token);
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
