/**
 * myPasses.js — "My passes": what a visitor has booked, and the pass again.
 *
 * A WhatsApp list, not a web page. The visitor is already in the chat, the list
 * opens over it, and choosing a pass sends that pass's message and PDF straight
 * back into the same thread — which is exactly where somebody who deleted the
 * chat, or changed phones, expects to find it.
 *
 * WHATSAPP'S LIST LIMITS ARE HARD, AND BREAKING ONE FAILS THE WHOLE MESSAGE:
 * ten rows in total, 24 characters for a row title and a section title, 72 for
 * a description, 20 for the button. Every string is fitted here, counting
 * characters as WhatsApp does, rather than trusted to be short.
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

async function show(to, customer) {
  const lang = langOf(customer);
  const { upcoming, past } = await booking.forCustomer(customer.id);

  if (!upcoming.length && !past.length) {
    return send.buttons(to, t('noPassesYet', lang), [
      { id: 'BOOK', title: t('btnBook', lang) },
    ], t('myHeader', lang));
  }

  const sections = [];
  if (upcoming.length) {
    sections.push({ title: fit(t('mySecUpcoming', lang), 24), rows: upcoming.map((p) => row(p, lang)) });
  }
  if (past.length) {
    sections.push({
      title: fit(t('mySecPast', lang), 24),
      rows: past.map((p) => row(p, lang, p.status === 'used' ? t('myUsed', lang) : t('myExpired', lang))),
    });
  }

  return send.list(to, {
    header: fit(t('myHeader', lang), 60),
    body: upcoming.length ? t('myBody', lang, { up: upcoming.length }) : t('myBodyPastOnly', lang),
    footer: fit(t('myFooter', lang), 60),
    button: fit(t('myButton', lang), 20),
    sections,
  });
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
