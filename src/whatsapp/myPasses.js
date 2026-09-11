/**
 * myPasses.js — "My passes": the visitor's upcoming passes, delivered again.
 *
 * The earlier version sent a list to pick from. That asked the visitor to do
 * work the system can do for them: their number already says whose passes they
 * are, so the passes are simply sent.
 *
 * resend() is kept for rows in lists already sitting in people's chats from the
 * earlier version; tapping one still works.
 *
 * A ROW ID IS NOT PROOF OF OWNERSHIP. It comes back from the phone, and a list
 * forwarded or crafted by hand can carry any pass number. So the pass is looked
 * up against the visitor who tapped it, and a pass that is not theirs is not
 * sent.
 */

const { one } = require('../gatepass/db');
const booking = require('../gatepass/booking');
const L = require('../localize');
const send = require('./send');
const { t, langOf } = require('../i18n');

const fit = (s, n) => {
  const chars = [...String(s ?? '')];
  return chars.length <= n ? chars.join('') : `${chars.slice(0, n - 1).join('')}…`;
};

/** "24/09" — a row title has 24 characters, and the plate already takes nine. */
const shortDate = (d) => {
  const [, m, day] = String(d).slice(0, 10).split('-');
  return `${day}/${m}`;
};

function row(p, lang, pastNote) {
  const desc = [L.placeName(p, lang), L.slotLabel(p, lang), pastNote].filter(Boolean).join(' · ');
  return {
    id: `PASS:${p.ticket_no}`,
    title: fit(`${p.reg_no} · ${shortDate(p.travel_date)}`, 24),
    description: fit(desc, 72),
  };
}

/**
 * My passes: every upcoming pass, sent straight into the chat.
 *
 * NOTHING TO CHOOSE. The visitor is identified by the number they are messaging
 * from, so "My passes" needs no input: a short note saying how many are coming,
 * then each pass — its message and its PDF — soonest first. Somebody standing at
 * the gate with a deleted chat taps once and has their pass.
 *
 * Only upcoming passes are sent. Past ones are a record, not something anyone
 * needs delivered again, and sending a year of history on one tap would bury the
 * pass that matters today.
 *
 * Passes at different places arrive the same way, each saying where it is for:
 * the list is by visitor, not by destination.
 *
 * SENT ONE AFTER ANOTHER, NOT IN PARALLEL. WhatsApp shows messages in the order
 * they arrive, and a PDF that overtakes its own message — or another pass's —
 * pairs the wrong document with the wrong words.
 */
async function show(to, customer) {
  const lang = langOf(customer);
  const { upcoming } = await booking.forCustomer(customer.id, { upcomingLimit: 10, total: 10 });

  if (!upcoming.length) {
    return send.buttons(to, t('noUpcoming', lang), [
      { id: 'BOOK', title: t('btnBook', lang) },
    ], t('myHeader', lang));
  }

  const lines = upcoming.map((p, i) => `${i + 1}. *${p.reg_no}* · ${L.placeName(p, lang)} · ${L.longDate(p.travel_date, lang)}`);
  await send.text(to, [t('myAutoIntro', lang, { up: upcoming.length }), '', ...lines].join('\n'));

  const deliver = require('./deliver');
  for (const p of upcoming) {
    // eslint-disable-next-line no-await-in-loop -- order in the chat is the point
    await deliver.resendPass(p.id);
  }
  return { ok: true, sent: upcoming.length };
}

/** A row was tapped: send that pass again, if it belongs to whoever tapped it. */
async function resend(to, customer, action) {
  const lang = langOf(customer);
  const ticketNo = String(action).slice('PASS:'.length).trim().toUpperCase();

  const owned = await one(
    `SELECT id FROM tickets
      WHERE ticket_no = $1 AND customer_id = $2 AND status IN ('paid', 'used')`,
    [ticketNo, customer.id]);
  if (!owned) return send.text(to, t('myNotYours', lang));

  return require('./deliver').resendPass(owned.id);
}

module.exports = { show, resend };
