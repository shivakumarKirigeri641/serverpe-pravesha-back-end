/**
 * scripts/test-flow.js — walk the WhatsApp conversation without a phone.
 *
 *   node scripts/test-flow.js
 *
 * Posts properly signed webhook bodies to the running server, exactly as Meta
 * does, and reads back what the bot decided to say from wa_messages.
 *
 * The number used is not a real one, so the outbound sends are rejected by Meta
 * — that is fine and expected. What this catches is everything before that: a
 * crash in the flow, a state that never advances, a button id nobody handles.
 * Those are the failures that would otherwise be found by typing "hi" on a
 * phone and getting silence.
 */

require('dotenv').config();
const crypto = require('crypto');
const db = require('../src/gatepass/db');
const inventory = require('../src/gatepass/inventory');

const { PREFIX } = require('../src/config/paths');
const BASE = `http://localhost:${process.env.PORT || 7777}`;
const MOBILE = process.env.TEST_MOBILE;
const REG = 'KA31N8147';

let failures = 0;
const check = (ok, msg) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures++; };

/** A webhook body shaped exactly like Meta's, signed with the app secret. */
async function inbound(payload, { toNumberId } = {}) {
  const message = Object.assign(
    { from: `91${MOBILE}`, id: `wamid.${crypto.randomBytes(8).toString('hex')}`, timestamp: '1' },
    payload);

  const body = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{
      id: 'test',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          // Which of our numbers the customer wrote to. Both products' numbers
          // share one WhatsApp Business Account, so this is what tells them
          // apart.
          metadata: {
            display_phone_number: '916363271302',
            phone_number_id: toNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID,
          },
          contacts: [{ profile: { name: 'Flow Test' }, wa_id: `91${MOBILE}` }],
          messages: [message],
        },
      }],
    }],
  });

  const sig = 'sha256=' + crypto
    .createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(body).digest('hex');

  const res = await fetch(`${BASE}${PREFIX}/whatsapp/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': sig },
    body,
  });
  if (res.status !== 200) throw new Error(`webhook returned ${res.status}`);

  // The route acknowledges before handling, so give the handler a moment.
  await new Promise((r) => setTimeout(r, 2500));
}

const text = (body) => inbound({ type: 'text', text: { body } });
const tap = (id, title) => inbound({
  type: 'interactive',
  interactive: { type: 'button_reply', button_reply: { id, title: title || id } },
});
const pick = (id, title) => inbound({
  type: 'interactive',
  interactive: { type: 'list_reply', list_reply: { id, title: title || id } },
});

/** What the bot last tried to say. */
async function lastOut() {
  const r = await db.one(
    `SELECT body, message_type, error_message FROM wa_messages
      WHERE mobile = $1 AND direction = 'out'
      ORDER BY id DESC LIMIT 1`, [MOBILE]);
  return r || {};
}

const state = async () =>
  (await db.one('SELECT state, context FROM wa_sessions WHERE mobile = $1', [MOBILE])) || {};

(async () => {
  console.log('\nWhatsApp booking conversation\n');

  await wipe();

  /* ------------------------------------- messages meant for the other number */

  // QuizPe's number lives on the same WhatsApp Business Account, so its
  // messages arrive here too. Answering one would send a hill-station booking
  // prompt to a parent asking about a quiz.
  await inbound({ type: 'text', text: { body: 'hi' } }, { toNumberId: '1275732515617880' });
  const strayReply = await lastOut();
  const straySession = await state();
  check(!strayReply.body && !straySession.state,
    'a message addressed to the QuizPe number is ignored, not answered');

  /* ------------------------------------------------------------- hello */

  await text('hi');
  let out = await lastOut();
  check(/ನಮಸ್ಕಾರ/.test(out.body || '') || /Namaskara/i.test(out.body || ''), `"hi" -> welcome (${(out.body || '').slice(0, 40)}…)`);
  check((await state()).state === 'consent', 'state: consent');

  /* ----------------------------------------------------------- consent */

  await tap('consent_yes', 'Agree & continue');
  check((await state()).state === 'menu', 'after agreeing -> the menu');
  out = await lastOut();
  check(/Book ticket/.test(out.body||'') || out.message_type==='interactive', 'menu offered');

  await pick('menu_book', 'Book ticket');
  check((await state()).state === 'awaiting_plate', 'Book ticket -> awaiting_plate');
  const consented = await db.one(
    `SELECT 1 FROM event_log e JOIN customers c ON c.id = e.customer_id
      WHERE c.mobile = $1 AND e.kind = 'consent_given'`, [MOBILE]);
  check(!!consented, 'consent recorded in event_log with a timestamp');

  /* ------------------------------------------------------------- plate */

  await text('not a plate');
  out = await lastOut();
  check(/does not look like/i.test(out.body || ''), 'nonsense plate rejected with a reason');

  await text('kh31n8147');
  out = await lastOut();
  check(/state code/i.test(out.body || ''), 'invalid state code caught before payment');

  await text('ka 31 n 8147');
  out = await lastOut();
  check(/KA 31 N 8147/.test(out.body || ''), 'plate echoed back in capitals for confirmation');
  check((await state()).state === 'confirm_plate', 'state: confirm_plate');

  await tap('plate_yes', 'Yes, correct');
  let st = await state();
  check(st.state === 'choose_date', `after confirming -> ${st.state}`);
  check(!!st.context?.category_id, `vehicle categorised (category_id ${st.context?.category_id})`);

  /* -------------------------------------------------------------- date */

  const day = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  await pick(`date_${day}`, day);
  st = await state();
  check(st.state === 'choose_slot' && st.context?.travel_date === day,
    `date chosen -> ${st.state} for ${st.context?.travel_date}`);
  out = await lastOut();
  check(/entry time/i.test(out.body || ''), 'slots offered');

  /* -------------------------------------------------------------- slot */

  await tap('slot_0612', 'Morning 6-12');
  st = await state();
  check(st.state === 'awaiting_payment', `slot chosen -> ${st.state}`);

  out = await lastOut();
  check(/₹113/.test(out.body || ''), 'price shown: ₹100 entry + ₹13 service fee = ₹113');
  check(/\/pay\//.test(out.body || ''), 'payment link sent');

  const ticket = await db.one(
    `SELECT * FROM tickets WHERE mobile = $1 ORDER BY id DESC LIMIT 1`, [MOBILE]);
  check(ticket?.status === 'held', `ticket ${ticket?.ticket_no} held, not yet paid`);
  check(!ticket?.qr_payload, 'NO signed QR exists before payment');

  const inv = await db.one(
    `SELECT held FROM slot_inventory WHERE place_id = $1 AND travel_date = $2
       AND slot_id = $3 AND category_id = $4`,
    [ticket.place_id, day, ticket.slot_id, ticket.category_id]);
  check(inv?.held === 1, `the place is held while payment is pending (held=${inv?.held})`);

  /* ---------------------------------------------------- paying for real */

  const booking = require('../src/gatepass/booking');
  const paid = await booking.markPaid(ticket.id, null);
  check(paid.ok && !!paid.ticket.qr_payload, 'payment issues the signed QR');

  const sign = require('../src/gatepass/sign');
  const v = sign.verifyTicket(paid.ticket.qr_payload);
  check(v.ok && v.ticket.reg_no === REG && v.ticket.travel_date === day,
    `QR carries the right plate and date: ${v.ticket?.reg_no} ${v.ticket?.travel_date}`);

  /* ------------------------------------------- the rule, from the outside */

  await text('hi');
  await pick('menu_book', 'Book ticket');
  await tap('plate_yes');           // same vehicle again
  await pick(`date_${day}`, day);
  out = await lastOut();
  check(/already has a ticket/i.test(out.body || ''),
    'booking the same vehicle for the same day is refused, politely');

  /* ------------------------------------------------------------ postpone */

  const newDay = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);

  await text('hi');
  await pick('menu_postpone', 'Postpone ticket');
  st = await state();
  check(st.state === 'pp_choose_date' && String(st.context?.pp_ticket_id) === String(ticket.id),
    `postpone found the one live ticket -> ${st.state}`);

  /* Absolute counts depend on whatever else is in the database, so the check
     below measures the change this move caused rather than the totals. */
  const booked = async (date, slotId) => (await db.one(
    `SELECT booked FROM slot_inventory
      WHERE place_id = $1 AND travel_date = $2 AND slot_id = $3 AND category_id = $4`,
    [ticket.place_id, date, slotId, ticket.category_id]))?.booked ?? 0;

  const oldBefore = await booked(day, ticket.slot_id);
  const newSlot = await db.one(
    `SELECT id FROM place_slots WHERE place_id = $1 AND code = '1206'`, [ticket.place_id]);
  const newBefore = await booked(newDay, newSlot.id);

  await pick(`ppdate_${newDay}`, newDay);
  check((await state()).state === 'pp_choose_slot', 'new date accepted, slots offered');

  await tap('ppslot_1206', 'Afternoon 12-6');
  const moved = await db.one('SELECT * FROM tickets WHERE id = $1', [ticket.id]);
  check(String(moved.travel_date) === newDay && moved.move_count === 1,
    `ticket moved ${day} -> ${moved.travel_date} (move #${moved.move_count})`);
  check(String(moved.moved_from_date) === day, `history kept: moved_from_date ${moved.moved_from_date}`);

  /* The old QR must stop working, and it must do so by itself. */
  const oldQr = paid.ticket.qr_payload;
  const oldStill = sign.verifyTicket(oldQr);
  check(oldStill.ok && oldStill.ticket.travel_date === day,
    'the old QR still carries a valid signature — for the OLD date');
  const scan = require('../src/gatepass/scan');
  const atOldDate = await scan.decide(oldQr, { place_id: moved.place_id }, new Date(`${day}T09:00:00`));
  check(atOldDate.verdict === 'wrong_day' || atOldDate.verdict === 'invalid_signature',
    `presented on the old date it now reads: ${atOldDate.verdict}`);

  const newQr = sign.verifyTicket(moved.qr_payload);
  check(newQr.ok && newQr.ticket.travel_date === newDay,
    `the re-signed QR carries the new date: ${newQr.ticket?.travel_date}`);

  /* Capacity must have followed the ticket, not been counted twice. Measured as
     a change rather than as totals, because the database may hold any amount of
     other traffic on those same dates. */
  const oldAfter = await booked(day, ticket.slot_id);
  const newAfter = await booked(newDay, moved.slot_id);
  check(oldAfter === oldBefore - 1 && newAfter === newBefore + 1,
    `the place moved with it: old day ${oldBefore}→${oldAfter}, new day ${newBefore}→${newAfter}`);

  /* --------------------------------------------------------- download again */

  await text('hi');
  await pick('menu_download', 'Download ticket');
  const dlEvent = await db.one(
    `SELECT detail FROM event_log e JOIN customers c ON c.id = e.customer_id
      WHERE c.mobile = $1 AND e.kind = 'ticket_sent' ORDER BY e.id DESC LIMIT 1`, [MOBILE]);
  check(!!dlEvent, 'Download ticket re-sends the QR and records that it did');

  /* ----------------------------------------------------- support & feedback */

  await text('hi');
  await pick('menu_support', 'Support');
  check((await state()).state === 'support_message', 'Support waits for the question');
  await text('My QR is not opening, please help.');
  const sup = await db.one(
    `SELECT detail FROM event_log e JOIN customers c ON c.id = e.customer_id
      WHERE c.mobile = $1 AND e.kind = 'support_request' ORDER BY e.id DESC LIMIT 1`, [MOBILE]);
  check(/not opening/.test(sup?.detail?.message || ''), 'the support message is stored verbatim');

  await text('hi');
  await pick('menu_feedback', 'Feedback');
  await text('Very smooth, no queue at the gate.');
  const fb = await db.one(
    `SELECT detail FROM event_log e JOIN customers c ON c.id = e.customer_id
      WHERE c.mobile = $1 AND e.kind = 'feedback' ORDER BY e.id DESC LIMIT 1`, [MOBILE]);
  check(/no queue/.test(fb?.detail?.message || ''), 'feedback is stored');

  await wipe();
  console.log(`\n  ${failures ? `${failures} FAILURE(S)` : 'all checks passed'}\n`);
  console.log('  (Outbound sends to this test number are rejected by Meta — that is expected.)\n');
  process.exit(failures ? 1 : 0);
})().catch(async (e) => { console.error('\n', e, '\n'); process.exit(1); });

async function wipe() {
  const c = await db.one('SELECT id FROM customers WHERE mobile = $1', [MOBILE]);
  const tickets = (await db.query('SELECT * FROM tickets WHERE mobile = $1', [MOBILE])).rows;
  for (const t of tickets) {
    if (t.status === 'held') {
      await inventory.release(null, { placeId: t.place_id, travelDate: t.travel_date,
        slotId: t.slot_id, categoryId: t.category_id });
    } else if (t.status === 'paid' || t.status === 'used') {
      await inventory.unbook(null, { placeId: t.place_id, travelDate: t.travel_date,
        slotId: t.slot_id, categoryId: t.category_id });
    }
  }
  await db.query('DELETE FROM scans WHERE ticket_id IN (SELECT id FROM tickets WHERE mobile = $1)', [MOBILE]);
  await db.query('DELETE FROM tickets WHERE mobile = $1', [MOBILE]);
  if (c) {
    await db.query('DELETE FROM payments WHERE customer_id = $1', [c.id]);
    await db.query('DELETE FROM event_log WHERE customer_id = $1', [c.id]);
  }
  await db.query('DELETE FROM wa_messages WHERE mobile = $1', [MOBILE]);
  await db.query('DELETE FROM wa_sessions WHERE mobile = $1', [MOBILE]);
  await db.query('DELETE FROM api_calls WHERE reg_no = $1', [REG]);
  if (c) await db.query('DELETE FROM customers WHERE id = $1', [c.id]);
}
