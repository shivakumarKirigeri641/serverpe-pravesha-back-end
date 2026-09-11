/**
 * inbox.js — what to do with a message that has arrived.
 *
 * Kept apart from the route so that the route's only job is HTTP: verify,
 * acknowledge, hand over. Everything about what a message means lives here.
 */

const { query } = require('../gatepass/db');
const customers = require('../gatepass/customers');
const session = require('./session');
const welcome = require('./welcome');
const phone = require('./phone');

/* Anything a person might open with. Matched loosely because they will not type
   it the way we expect: "Hi", "hii", "hello sir", "ನಮಸ್ಕಾರ". */
const GREETING = /^\s*(hi+|hey+|hello+|hallo|namaste|namaskara|start|menu|ನಮಸ್ಕಾರ|ಹಾಯ್)\b/i;

/**
 * Record the inbound message and say whether it is new.
 *
 * Meta retries until it gets a 200 and will redeliver a message it has already
 * sent, so the unique index on wa_message_id is what stops a second welcome.
 * The insert returns no row when it collides, which is the whole test.
 */
async function accept(msg, mobile) {
  const r = await query(
    `INSERT INTO wa_messages (mobile, direction, message_type, body, payload, wa_message_id)
     VALUES ($1, 'in', $2, $3, $4, $5)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [mobile, msg.type || null, textOf(msg), JSON.stringify(msg), msg.id || null]);
  return r.rows.length > 0;
}

/** The words in a message, whatever shape it arrived in. */
function textOf(msg) {
  if (msg.type === 'text') return msg.text?.body || null;
  if (msg.type === 'interactive') {
    const i = msg.interactive || {};
    return i.button_reply?.title || i.list_reply?.title || null;
  }
  if (msg.type === 'button') return msg.button?.text || null;
  return null;
}

/** The id behind a tap, which is what we actually branch on. */
function actionOf(msg) {
  if (msg.type !== 'interactive') return null;
  const i = msg.interactive || {};
  return i.button_reply?.id || i.list_reply?.id || null;
}

async function handle(msg, contact) {
  if (!msg.from) return;

  /* Two spellings of the same number, and both are needed: the database stores
     ten digits and WhatsApp is addressed with the country code. See phone.js. */
  const mobile = phone.toLocal(msg.from);
  const to = msg.from;
  if (!mobile) return;

  if (!await accept(msg, mobile)) {
    console.log('[wa] duplicate delivery ignored', msg.id);
    return;
  }

  const customer = await customers.touch({
    mobile,
    waId: contact?.wa_id,
    profileName: contact?.profile?.name,
  });

  if (customer.is_blocked) {
    console.log('[wa] blocked number, ignoring', mobile);
    return;
  }

  await session.touch({ mobile, customerId: customer.id,
    waId: contact?.wa_id, profileName: contact?.profile?.name });

  const action = actionOf(msg);
  const body = textOf(msg) || '';

  /* A greeting always starts over. Someone who types "hi" halfway through a
     booking means it -- they are lost, or starting again -- and dropping them
     back into a half-finished flow is the wrong reading of a plain word. */
  if (action === 'RESTART' || GREETING.test(body)) {
    await session.reset(mobile, 'greeting');
    await welcome.send(to, customer);
    return;
  }

  /* Consent, recorded with its version and the moment it happened. Writing it
     before replying means a failure to send the next message cannot leave a
     visitor who did agree looking as though they never did. */
  if (action === 'AGREE') {
    await query(
      `UPDATE customers SET terms_accepted_at = now(), terms_version = $2, modified_at = now()
        WHERE id = $1`, [customer.id, welcome.TERMS_VERSION]);
    await require('./send').text(to,
      '✅ Thank you. / ಧನ್ಯವಾದಗಳು.');
    await welcome.send(to, { ...customer, terms_accepted_at: new Date(), terms_version: welcome.TERMS_VERSION });
    return;
  }

  if (action === 'BOOK') {
    await require('./send').text(to,
      'Booking opens next — place, slot, date and vehicle.\nಕಾಯ್ದಿರಿಸುವಿಕೆ ಶೀಘ್ರದಲ್ಲೇ.');
    return;
  }

  if (action === 'HELP' || /^\s*help\b/i.test(body)) {
    await require('./send').text(to,
      '*Pravesha help*\n\nSend *hi* at any time to start over.\n\nEntry passes are issued for two-wheelers, cars, Toofans and Tempo Travellers. Autos, buses, trucks, tractors and trailers are not permitted on these routes.');
    return;
  }

  /* Not understood, and not silently dropped: a reply that goes nowhere reads
     as a broken service. */
  await welcome.send(to, customer);
}

module.exports = { handle, textOf, actionOf };
