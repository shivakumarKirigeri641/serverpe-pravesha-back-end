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

/**
 * Did we attempt an interactive message in the last few sends?
 *
 * Not "was the last message interactive": when Meta rejects a send — a pair
 * rate limit is the common one while testing — the handler falls back to a
 * plain text message, and that becomes the last row. The attempt is what this
 * file is testing; whether Meta accepted it is Meta's business.
 */
async function sentInteractive(n = 3) {
  const r = await db.query(
    `SELECT message_type FROM wa_messages
       WHERE mobile = $1 AND direction = 'out'
       ORDER BY id DESC LIMIT $2`, [MOBILE, n]);
  return r.rows.some((x) => x.message_type === 'interactive');
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
  /* The first message is the welcome and the language question, in English —
     it is asked before we know which language they want. */
  check(/Welcome to/i.test(out.body || '') && /language/i.test(out.body || ''),
    `"hi" -> welcome + language (${(out.body || '').slice(0, 40)}…)`);
  check((await state()).state === 'language', 'state: language');

  /* --------------------------------------------------------- language */

  /* English, so the rest of this file can assert on English strings. The
     Kannada path is the same code with a different column value. */
  await tap('lang_en', 'English');
  check((await state()).state === 'consent', 'after choosing a language -> consent');
  out = await lastOut();
  /* Site-neutral on purpose: the platform serves the department's places and
     the site is chosen inside the booking form, so the greeting names none. */
  check(/Book vehicle entry tickets/i.test(out.body || ''),
    'consent shown in English only, naming no single site');
  check(!/[ಀ-೿]/.test(out.body || ''), 'no Kannada in the English consent message');

  /* ----------------------------------------------------------- consent */

  await tap('consent_yes', 'Agree');
  check((await state()).state === 'menu', 'after agreeing -> the menu');
  out = await lastOut();
  check(/Book ticket/.test(out.body||'') || out.message_type==='interactive', 'menu offered');

  await pick('menu_book', 'Book ticket');
  check((await state()).state === 'in_web_form', 'Book ticket -> the booking form link');
  check(await sentInteractive(), 'a link button was sent, not a question');

  const consented = await db.one(
    `SELECT 1 FROM event_log e JOIN customers c ON c.id = e.customer_id
      WHERE c.mobile = $1 AND e.kind = 'consent_given'`, [MOBILE]);
  check(!!consented, 'consent recorded in event_log with a timestamp');

  /* --------------------------------------------- booking, via the form */

  /* The booking now happens on the web page the link opens, so the test drives
     that instead of the chat steps. Same server, same modules — this is the
     path a visitor actually takes. */
  const fe = require('../src/routes/flowEndpoint');
  const cust = await db.one('SELECT * FROM customers WHERE mobile = $1', [MOBILE]);
  const bookToken = fe.newToken(cust.id, MOBILE, 'booking', 120);
  await new Promise((r) => setTimeout(r, 300));

  const api = (p, b) => fetch(`${BASE}/book/${bookToken}/${p}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(b) }).then((r) => r.json());

  const page = await fetch(`${BASE}/book/${bookToken}`);
  check(page.status === 200, 'the booking page opens with a valid token');
  const forged = await fetch(`${BASE}/book/notatoken.xx`);
  check(forged.status === 410, `a forged token is refused (${forged.status})`);

  const day = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const place = await db.one("SELECT id FROM places WHERE code = 'MULLAYANAGIRI'");

  const bad = await api('vehicle', { reg_no: 'not a plate', place_id: place.id, travel_date: day });
  check(bad.ok === false && /does not look like/i.test(bad.error || ''),
    'nonsense plate rejected with a reason');

  const badState = await api('vehicle', { reg_no: 'kh31n8147', place_id: place.id, travel_date: day });
  check(badState.ok === false, 'invalid state code caught before payment');

  const veh = await api('vehicle', { reg_no: 'ka 31 n 8147', place_id: place.id, travel_date: day });
  /* Unspaced, everywhere: the plate reads the same on the form, in the chat,
     on the PDF and on the ticket card. */
  check(veh.ok === true && veh.reg_pretty === 'KA31N8147',
    'plate normalised to capitals, no spacing');
  check(!!veh.category_id, `vehicle categorised (category_id ${veh.category_id})`);
  check(veh.total === '113', `price: ₹${veh.entry} entry + ₹${veh.fee} fee = ₹${veh.total}`);

  const slots = await api('slots',
    { place_id: place.id, travel_date: day, category_id: veh.category_id });
  check(slots.ok && slots.slots.length >= 1 && /left/i.test(slots.slots[0].note || ''),
    `slots offered with live counts (${slots.slots[0]?.note})`);

  const noAgree = await api('confirm', { place_id: place.id, travel_date: day,
    reg_no: 'KA31N8147', category_id: veh.category_id, slot: '0612' });
  check(noAgree.ok === false, 'cannot pay without agreeing to the terms');

  const conf = await api('confirm', { place_id: place.id, travel_date: day,
    reg_no: 'KA31N8147', category_id: veh.category_id, slot: '0612', agree: true });
  check(conf.ok === true && /\/pay\//.test(conf.pay || ''), 'payment link returned');

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

  /* One vehicle, one ticket, one day — refused at the vehicle check, which is
     the only place where saying so is any use to the visitor: before they have
     picked a slot and long before they have paid. */
  /* The booking above spent that link, so this needs a new one — which is
     itself the proof that a spent link cannot book again. */
  const dupToken = fe.newToken(cust.id, MOBILE, 'booking', 120);
  const dup = await fetch(`${BASE}/book/${dupToken}/vehicle`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reg_no: 'KA31N8147', place_id: place.id, travel_date: day }),
  }).then((r) => r.json());
  check(dup.ok === false && /already has a ticket/i.test(dup.error || ''),
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

  /* Both now open a page rather than asking for a paragraph: support wants a
     query type it can be routed on, feedback wants a rating that can be
     counted. The chat still carries the link. */
  await text('hi');
  await pick('menu_support', 'Support');
  check(await sentInteractive(), 'Support sends the form link');

  const supToken = fe.newToken(cust.id, MOBILE, 'support', 1440);
  const fbToken = fe.newToken(cust.id, MOBILE, 'feedback', 1440);
  await new Promise((r) => setTimeout(r, 300));   // the token insert is not awaited
  const supPage = await fetch(`${BASE}/support/${supToken}`);
  check(supPage.status === 200, 'the support page opens');

  const form = (path, body, tk) => fetch(`${BASE}/${path}/${tk}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString() });

  await form('support', { query_type: 'ticket', message: 'My QR is not opening, please help.' }, supToken);
  const sup = await db.one(
    `SELECT detail FROM event_log e JOIN customers c ON c.id = e.customer_id
      WHERE c.mobile = $1 AND e.kind = 'support_request' ORDER BY e.id DESC LIMIT 1`, [MOBILE]);
  check(/not opening/.test(sup?.detail?.message || ''), 'the support message is stored verbatim');
  check(sup?.detail?.query_type === 'ticket', `support is categorised (${sup?.detail?.query_type})`);

  await text('hi');
  await pick('menu_feedback', 'Feedback');
  await form('feedback', { rating: '5', message: 'Very smooth, no queue at the gate.' }, fbToken);
  const fb = await db.one(
    `SELECT detail FROM event_log e JOIN customers c ON c.id = e.customer_id
      WHERE c.mobile = $1 AND e.kind = 'feedback' ORDER BY e.id DESC LIMIT 1`, [MOBILE]);
  check(/no queue/.test(fb?.detail?.message || ''), 'feedback is stored');
  check(Number(fb?.detail?.rating) === 5, `feedback carries a rating (${fb?.detail?.rating})`);

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
