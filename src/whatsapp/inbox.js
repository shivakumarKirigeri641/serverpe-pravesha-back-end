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
const send = require('./send');
const { t, langOf } = require('../i18n');
const webToken = require('../gatepass/webToken');

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
    `INSERT INTO wa_messages (session_id, mobile, direction, message_type, body, payload, wa_message_id)
     VALUES ((SELECT id FROM wa_sessions WHERE mobile = $1), $1, 'in', $2, $3, $4, $5)
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
    /* ONE WELCOME PER BURST. On a hill road with a bar of signal people tap
       "hi" again and again; WhatsApp holds every one and delivers them together
       when the phone reconnects — four greetings in the same second got four
       welcomes. A greeting within 30 seconds of the last welcome is not
       answered again.

       The claim is one conditional UPDATE, not a read and a write: the burst
       arrives as separate webhook calls handled at the same moment, and only
       the database can let exactly one of them through. It also resets the
       session, as a greeting always has. */
    const claimed = await query(
      `UPDATE wa_sessions
          SET state = $2, state_reason = 'greeting',
              context = jsonb_build_object('welcomedAt', now()), modified_at = now()
        WHERE mobile = $1
          AND (context->>'welcomedAt' IS NULL
               OR (context->>'welcomedAt')::timestamptz < now() - interval '30 seconds')
        RETURNING id`, [mobile, session.START]);
    if (!claimed.rowCount) {
      console.log('[wa] greeting burst from %s — already welcomed, not repeating', mobile);
      return;
    }
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

    /* Straight on to the language question. A separate thank-you would be the
       third notification in a row and says nothing the next screen does not. */
    await welcome.askLanguage(to, { ...customer, terms_accepted_at: new Date(),
      terms_version: welcome.TERMS_VERSION });
    return;
  }

  /* The language choice is stored on the customer, not the session: it is a
     fact about the person rather than about this conversation, and it has to
     survive a reset. language_asked_at is what separates "chose Kannada" from
     "was never asked and the column defaults to Kannada" -- without it every
     visitor looks as though they had chosen. */
  if (action === 'LANG_EN' || action === 'LANG_KN') {
    const lang = action === 'LANG_KN' ? 'kn' : 'en';
    const r = await query(
      `UPDATE customers SET language = $2, language_asked_at = now(), modified_at = now()
        WHERE id = $1 RETURNING *`, [customer.id, lang]);
    await send.text(to, t('languageSet', lang));
    await welcome.sendMenu(to, r.rows[0]);
    return;
  }

  /* A fresh single-use link per tap. Reusing one would mean the link in an old
     message still worked, and the visitor booking twice by scrolling up. */
  if (action === 'BOOK') {
    const lang = langOf(customer);
    const tok = await webToken.issue(customer.id, 'booking');
    await send.ctaUrl(to, {
      header: t('bookHeader', lang),
      body: t('bookBody', lang),
      footer: t('bookFooter', lang),
      displayText: t('bookCta', lang),
      url: webToken.linkFor(tok),
    });
    return;
  }

  /* My passes: the list, and a tapped row sends that pass again. Typed words
     reach it too — people ask for their passes in their own words, not by
     finding the button. */
  if (action === 'MY_PASSES' || /^\s*(my\s*)?(passes|pass|bookings?|tickets?)\s*$/i.test(body)) {
    await require('./myPasses').show(to, customer);
    return;
  }

  if (action && action.startsWith('PASS:')) {
    await require('./myPasses').resend(to, customer, action);
    return;
  }

  if (action === 'HELP' || /^\s*help/i.test(body)) {
    await send.text(to, t('help', langOf(customer)));
    return;
  }

  /* Not understood, and not silently dropped: a reply that goes nowhere reads
     as a broken service. */
  await welcome.send(to, customer);
}

module.exports = { handle, textOf, actionOf };
