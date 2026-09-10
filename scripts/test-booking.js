/**
 * scripts/test-booking.js — prove the core before anything is built on it.
 *
 *   node scripts/test-booking.js
 *
 * Exercises the four things that must be true or the product does not work:
 * a ticket can be issued, its QR verifies, an altered QR does not, and one
 * vehicle cannot hold two tickets for the same date.
 *
 * It cleans up after itself, so it is safe to run against the demo database.
 */

require('dotenv').config();
const db = require('../src/gatepass/db');
const customers = require('../src/gatepass/customers');
const vehicles = require('../src/gatepass/vehicle');
const booking = require('../src/gatepass/booking');
const pricing = require('../src/gatepass/pricing');
const inventory = require('../src/gatepass/inventory');
const sign = require('../src/gatepass/sign');

const MOBILE = process.env.TEST_MOBILE;
const REG = 'KA31N8147';
const say = (ok, msg) => console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`);

(async () => {
  let failures = 0;
  const check = (ok, msg) => { say(ok, msg); if (!ok) failures++; };

  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const place = await booking.placeByCode('MULLAYANAGIRI');
  const slot = await booking.slotByCode(place.id, '0612');
  const customer = await customers.upsert(MOBILE, { name: 'Test Visitor' });
  const vehicle = await vehicles.upsertBare(REG);

  console.log(`\nBooking core — ${place.name}, ${tomorrow}, slot ${slot.code}\n`);

  // Category from the class words, with no RC present: the catch-all applies.
  const category = await pricing.categoryForVehicle({ vehicle_class: 'MOTOR CAR(LMV)' });
  check(category.code === 'CAR', `category resolved: ${category.code}`);

  const price = await pricing.priceFor(place.id, category.id);
  const b = await pricing.breakdown(price);
  check(b.total_paise === 11300, `total Rs.${pricing.rs(b.total_paise)} = entry ${pricing.rs(b.entry_paise)} + platform ${pricing.rs(b.platform_paise)}`);
  check(b.platform_base_paise + b.gst_paise === b.platform_paise,
    `GST splits the platform fee exactly: ${b.platform_base_paise} + ${b.gst_paise} = ${b.platform_paise}`);

  const before = (await inventory.availability(place.id, tomorrow, category.id))
    .find((r) => r.slot_id === slot.id);

  const held = await booking.hold({ customer, vehicle, place, slot, category, travelDate: tomorrow });
  check(held.ok, `hold taken: ${held.ok ? held.ticket.ticket_no : held.reason}`);
  if (!held.ok) { await finish(failures); return; }

  const during = (await inventory.availability(place.id, tomorrow, category.id))
    .find((r) => r.slot_id === slot.id);
  check(during.available === before.available - 1,
    `availability dropped ${before.available} -> ${during.available}`);

  // The rule the whole product rests on.
  const second = await booking.hold({ customer, vehicle, place, slot, category, travelDate: tomorrow });
  check(!second.ok && second.reason === 'already_booked',
    `same vehicle, same date refused: ${second.reason}`);

  // And refused for the OTHER slot too — a vehicle enters once a day.
  const otherSlot = await booking.slotByCode(place.id, '1206');
  const third = await booking.hold({ customer, vehicle, place, slot: otherSlot, category, travelDate: tomorrow });
  check(!third.ok && third.reason === 'already_booked',
    `same vehicle, second slot refused: ${third.reason}`);

  const paid = await booking.markPaid(held.ticket.id, null);
  check(paid.ok && paid.ticket.status === 'paid', 'payment marked, ticket issued');

  const after = (await inventory.availability(place.id, tomorrow, category.id))
    .find((r) => r.slot_id === slot.id);
  check(after.booked === before.booked + 1 && after.held === before.held,
    `hold became a booking: booked ${before.booked} -> ${after.booked}, held ${after.held}`);

  // Calling it twice is what actually happens in production.
  const again = await booking.markPaid(held.ticket.id, null);
  const afterAgain = (await inventory.availability(place.id, tomorrow, category.id))
    .find((r) => r.slot_id === slot.id);
  check(again.ok && again.already && afterAgain.booked === after.booked,
    'a repeated payment callback consumes no second place');

  /* ------------------------------------------------------- the signature */

  const qr = paid.ticket.qr_payload;
  console.log(`\n  QR (${qr.length} chars): ${qr}\n`);

  const v = sign.verifyTicket(qr);
  check(v.ok && v.ticket.reg_no === REG, `genuine ticket verifies, plate ${v.ticket?.reg_no}`);

  // The fraud, exactly as described: edit the plate and present it.
  const forged = qr.replace(REG, 'KA05MM9999');
  check(!sign.verifyTicket(forged).ok, 'plate-swapped ticket REJECTED');

  const dateShifted = qr.replace(tomorrow.replace(/-/g, ''), '20991231');
  check(!sign.verifyTicket(dateShifted).ok, 'date-shifted ticket REJECTED');

  const slotSwapped = qr.replace('|0612|', '|1206|');
  check(!sign.verifyTicket(slotSwapped).ok, 'slot-swapped ticket REJECTED');

  check(!sign.verifyTicket('literally anything').ok, 'garbage REJECTED');

  await finish(failures, held.ticket.id);
})().catch((e) => { console.error('\n', e, '\n'); process.exit(1); });

async function finish(failures, ticketId) {
  if (ticketId) {
    const t = await db.one('SELECT * FROM tickets WHERE id = $1', [ticketId]);
    if (t) {
      await inventory.unbook(null, { placeId: t.place_id, travelDate: t.travel_date,
        slotId: t.slot_id, categoryId: t.category_id });
      await db.query('DELETE FROM tickets WHERE id = $1', [ticketId]);
    }
  }
  await db.query('DELETE FROM api_calls WHERE reg_no = $1', [REG]);
  console.log(`\n  ${failures ? `${failures} FAILURE(S)` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}
