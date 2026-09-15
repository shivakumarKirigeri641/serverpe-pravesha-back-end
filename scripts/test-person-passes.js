/*
 * Per-person passes (056), end to end, through the real modules.
 *
 * A destination that charges per person — Nandi Hills, ₹10 each plus ₹5 for the
 * pass, one pool of a thousand for the day — books people rather than a
 * vehicle. This checks what that changes and, just as important, what it must
 * not change for Mullayanagiri:
 *
 *   * a pass for four takes four places, not one, and gives four back
 *   * the price is entry × people plus one platform fee
 *   * the pass carries no vehicle and still loads for payment, delivery and the gate
 *   * the gate finds it by pass number, records how many came in, and refuses
 *     more people than were booked
 *   * a vehicle destination still takes exactly one place per pass
 *
 * It writes to the database it is pointed at and puts back everything it
 * touched. Run it against a development database.
 *
 *   node scripts/test-person-passes.js
 */
require('dotenv').config({ quiet: true });
const { query, one } = require('../src/gatepass/db');
const places = require('../src/gatepass/places');
const inventory = require('../src/gatepass/inventory');
const booking = require('../src/gatepass/booking');
const checkin = require('../src/gatepass/checkin');
const personPage = require('../src/web/personBookingPage');

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  PASS  ${name}`); } else { failed += 1; console.log(`  FAIL  ${name}${detail ? `\n          ${detail}` : ''}`); }
};

const made = { ticketIds: [], staffId: null, sessionId: null, customerId: null, inventoryKeys: [] };

const heldOf = async (placeId, slotId, categoryId, date) => {
  const r = await one(
    `SELECT booked, held, capacity FROM slot_inventory
      WHERE place_id=$1 AND slot_id=$2 AND category_id=$3 AND travel_date=$4`, [placeId, slotId, categoryId, date]);
  return r || { booked: 0, held: 0, capacity: 0 };
};

async function fixtures() {
  const place = await one(`SELECT * FROM places WHERE code = 'NANDI_HILLS'`);
  if (!place) throw new Error('Nandi Hills is not seeded — run scripts/seed-nandi-hills.js');
  if (place.booking_mode !== 'person') throw new Error('Nandi Hills is not a per-person destination');
  const cat = await personPage.personCategory();
  const slot = await one(`SELECT * FROM place_slots WHERE place_id = $1 AND is_active ORDER BY sort_order LIMIT 1`, [place.id]);
  const gate = await one(`SELECT id, name, place_id FROM checkposts WHERE place_id = $1 AND is_active ORDER BY id LIMIT 1`, [place.id]);

  /* A date this destination is actually selling. */
  const dates = await places.bookableDates(place, (await places.list()).find((p) => String(p.id) === String(place.id)).slots);
  if (!dates.length) throw new Error('no bookable dates at Nandi Hills');
  const travelDate = dates[dates.length > 1 ? 1 : 0].value;

  /* A visitor, and a staff member on duty at the gate — both thrown away at the end. */
  let customer = await one(`SELECT * FROM customers WHERE mobile = '9886122415'`);
  if (!customer) {
    customer = await one(`INSERT INTO customers (mobile, name) VALUES ('9886122415', 'Person pass test') RETURNING *`);
    made.customerId = customer.id;
  }
  const staff = await one(
    `INSERT INTO staff (name, mobile, is_active) VALUES ('Person pass test', '0000000099', true) RETURNING *`);
  made.staffId = staff.id;
  await query(`INSERT INTO staff_checkposts (staff_id, checkpost_id) VALUES ($1,$2)`, [staff.id, gate.id]);
  const session = await one(
    `INSERT INTO staff_sessions (staff_id, checkpost_id, token) VALUES ($1,$2,$3) RETURNING id`,
    [staff.id, gate.id, require('crypto').randomBytes(24).toString('base64url')]);
  made.sessionId = session.id;

  made.inventoryKeys.push({ placeId: place.id, slotId: slot.id, categoryId: cat.id, travelDate });
  return { place, cat, slot, gate, travelDate, customer, session: { staff_id: staff.id, session_id: session.id } };
}

async function run() {
  const f = await fixtures();
  const { place, cat, slot, gate, travelDate, customer, session } = f;
  console.log(`\nNandi Hills · ${travelDate} · slot ${slot.code} · gate ${gate.name}`);

  console.log('\n1. What the form shows before anybody books');
  /* The pool row is created on first read, so the baseline is taken after it. */
  const avail = await personPage.availability({ placeId: place.id, travelDate });
  const before = await heldOf(place.id, slot.id, cat.id, travelDate);
  check('availability answers', avail.ok === true && avail.bookable === true, JSON.stringify(avail));
  check('places left match the pool', avail.remaining === Number(before.capacity) - Number(before.booked) - Number(before.held),
    `${avail.remaining} vs ${before.capacity}-${before.booked}-${before.held}`);

  console.log('\n2. A pass for four people');
  const held = await booking.hold({ customer, place, slot, categoryId: cat.id, travelDate, persons: 4 });
  check('held', held.ok === true, JSON.stringify(held).slice(0, 160));
  if (!held.ok) return;
  made.ticketIds.push(held.ticket.id);
  const t = held.ticket;
  check('recorded as a per-person pass', t.pass_kind === 'person' && Number(t.persons) === 4, `${t.pass_kind} / ${t.persons}`);
  check('no vehicle and no plate', t.vehicle_id === null && t.reg_no === null, `${t.vehicle_id} / ${t.reg_no}`);
  check('entry fee is per person (4 × ₹10)', Number(t.entry_paise) === 4000, `${t.entry_paise} paise`);
  check('platform fee is per pass (₹5)', Number(t.platform_paise) === 500, `${t.platform_paise} paise`);
  check('total is ₹45', Number(t.total_paise) === 4500, `${t.total_paise} paise`);
  const afterHold = await heldOf(place.id, slot.id, cat.id, travelDate);
  check('four places held, not one', Number(afterHold.held) === Number(before.held) + 4,
    `held ${before.held} -> ${afterHold.held}`);

  console.log('\n3. Paid');
  const paid = await booking.markPaid(t.id, null);
  check('pass issued', paid.ok === true && paid.ticket.status === 'paid', JSON.stringify(paid).slice(0, 140));
  const afterPaid = await heldOf(place.id, slot.id, cat.id, travelDate);
  check('four places booked, hold given back', Number(afterPaid.booked) === Number(before.booked) + 4 && Number(afterPaid.held) === Number(before.held),
    `booked ${before.booked} -> ${afterPaid.booked}, held ${afterPaid.held}`);

  console.log('\n4. The pass loads without a vehicle');
  const loaded = await booking.byTicketNo(t.ticket_no);
  check('found by pass number', Boolean(loaded) && loaded.id === t.id);
  check('carries the people and the place', Number(loaded.persons) === 4 && loaded.place_name === place.name,
    `${loaded && loaded.persons} / ${loaded && loaded.place_name}`);

  console.log('\n5. At the gate');
  /* The gate only admits today's pass, so this one is for today. Run after the
     slot's last entry, that is a late arrival: the staff member overrides, which
     is exactly the path a real gate uses in the evening. */
  const today = require('../src/gatepass/slotTime').nowIST().date;
  made.inventoryKeys.push({ placeId: place.id, slotId: slot.id, categoryId: cat.id, travelDate: today });
  const atGate = await booking.hold({ customer, place, slot, categoryId: cat.id, travelDate: today, persons: 4 });
  check('a pass for today, for four', atGate.ok === true, JSON.stringify(atGate).slice(0, 140));
  if (!atGate.ok) return;
  made.ticketIds.push(atGate.ticket.id);
  await booking.markPaid(atGate.ticket.id, null);
  const g = atGate.ticket;

  const found = await checkin.search(gate, g.ticket_no);
  check('gate search finds it by pass number', found.ok === true && found.passes.some((p) => p.ticketNo === g.ticket_no),
    JSON.stringify(found).slice(0, 140));
  const listed = (await checkin.arrivals(gate, today)).passes.find((p) => p.ticketNo === g.ticket_no);
  check('it is on the day\'s list', Boolean(listed) && listed.persons === 4 && listed.passKind === 'person',
    JSON.stringify(listed || {}).slice(0, 140));

  const tooMany = await checkin.record({ session, checkpost: gate, ticketNo: g.ticket_no, persons: 6, override: true });
  check('six cannot enter on a pass for four', tooMany.ok === false && tooMany.verdict === 'too_many_people', JSON.stringify(tooMany).slice(0, 160));

  const entered = await checkin.record({ session, checkpost: gate, ticketNo: g.ticket_no, persons: 3, override: true });
  check('three of the four are let in', entered.ok === true, JSON.stringify(entered).slice(0, 160));
  const scan = await one(`SELECT persons, verdict FROM scans WHERE ticket_id = $1 ORDER BY id DESC LIMIT 1`, [g.id]);
  check('the head count is on the record', scan && Number(scan.persons) === 3, JSON.stringify(scan));
  const used = await booking.byTicketNo(g.ticket_no);
  check('the pass is used', used.status === 'used');

  console.log('\n6. A hold that is given up returns every place');
  const second = await booking.hold({ customer, place, slot, categoryId: cat.id, travelDate, persons: 2 });
  check('held two', second.ok === true);
  if (second.ok) {
    made.ticketIds.push(second.ticket.id);
    const mid = await heldOf(place.id, slot.id, cat.id, travelDate);
    await booking.releaseHold(second.ticket.id);
    const back = await heldOf(place.id, slot.id, cat.id, travelDate);
    check('both places came back', Number(mid.held) - Number(back.held) === 2, `held ${mid.held} -> ${back.held}`);
  }

  console.log('\n7. More people than the pass allows are refused before anything is held');
  const tooBig = await booking.hold({ customer, place, slot, categoryId: cat.id, travelDate, persons: 99 });
  if (tooBig.ok) {
    made.ticketIds.push(tooBig.ticket.id);
    check('a request for 99 is capped at the destination limit', Number(tooBig.ticket.persons) === Number(place.max_persons_per_pass),
      `${tooBig.ticket.persons} vs max ${place.max_persons_per_pass}`);
    await booking.releaseHold(tooBig.ticket.id);
  } else {
    check('a request for 99 is refused', true);
  }

  console.log('\n8. Mullayanagiri is unchanged');
  const mull = await one(`SELECT * FROM places WHERE code = 'MULLAYANAGIRI'`);
  const mullSlot = await one(`SELECT * FROM place_slots WHERE place_id = $1 AND is_active ORDER BY sort_order LIMIT 1`, [mull.id]);
  const car = await one(`SELECT id FROM vehicle_categories WHERE code = 'CAR'`);
  check('it books by vehicle', mull.booking_mode === 'vehicle');
  const catsShown = (await query(`SELECT code FROM vehicle_categories WHERE is_active ORDER BY sort_order`)).rows.map((r) => r.code);
  check('the per-person type is not offered as a vehicle type', !catsShown.includes('PERSON'), catsShown.join(', '));
  const mullBefore = await heldOf(mull.id, mullSlot.id, car.id, travelDate);
  made.inventoryKeys.push({ placeId: mull.id, slotId: mullSlot.id, categoryId: car.id, travelDate });
  const client = { query: (text, params) => query(text, params) };
  const oneHold = await inventory.hold(client, { placeId: mull.id, slotId: mullSlot.id, categoryId: car.id, travelDate });
  check('a vehicle hold still takes one place', Boolean(oneHold) && Number(oneHold.held) === Number(mullBefore.held) + 1,
    `held ${mullBefore.held} -> ${oneHold && oneHold.held}`);
  await inventory.release(null, { placeId: mull.id, slotId: mullSlot.id, categoryId: car.id, travelDate });
  const mullAfter = await heldOf(mull.id, mullSlot.id, car.id, travelDate);
  check('and gives it back', Number(mullAfter.held) === Number(mullBefore.held), `held ${mullAfter.held}`);
}

async function cleanup() {
  if (made.ticketIds.length) {
    await query(`DELETE FROM scans WHERE ticket_id = ANY($1::bigint[])`, [made.ticketIds]);
    await query(`DELETE FROM web_tokens WHERE ticket_id = ANY($1::bigint[])`, [made.ticketIds]);
    await query(`DELETE FROM invoices WHERE ticket_id = ANY($1::bigint[])`, [made.ticketIds]);
    await query(`DELETE FROM tickets WHERE id = ANY($1::bigint[])`, [made.ticketIds]);
  }
  /* The counts these passes moved, back to what they were. */
  for (const k of made.inventoryKeys) {
    await query(
      `UPDATE slot_inventory SET booked = 0, held = 0, modified_at = now()
        WHERE place_id=$1 AND slot_id=$2 AND category_id=$3 AND travel_date=$4
          AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.place_id=$1 AND t.slot_id=$2 AND t.category_id=$3
                            AND t.travel_date=$4 AND t.status IN ('held','paid','used'))`,
      [k.placeId, k.slotId, k.categoryId, k.travelDate]);
  }
  if (made.sessionId) await query(`DELETE FROM staff_sessions WHERE id = $1`, [made.sessionId]);
  if (made.staffId) await query(`DELETE FROM staff WHERE id = $1`, [made.staffId]);
  if (made.customerId) await query(`DELETE FROM customers WHERE id = $1`, [made.customerId]);
  console.log(`\nput back: ${made.ticketIds.length} passes, ${made.inventoryKeys.length} pools, the test staff member`);
}

(async () => {
  try {
    await run();
  } catch (e) {
    failed += 1;
    console.error(`\n  ERROR  ${e.stack || e.message}`);
  } finally {
    await cleanup().catch((e) => console.error(`cleanup failed: ${e.message}`));
  }
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
