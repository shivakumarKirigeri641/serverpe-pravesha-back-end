/**
 * welcome.js — the first thing anyone sees, and the consent gate.
 *
 * THE WELCOME IS IN ENGLISH. Language is chosen on the next screen, and that
 * question is the one line carried in both -- everything after it is written in
 * whichever was picked. Pairing a translation with every message afterwards
 * doubles the length of each one on a phone and reads as though the choice was
 * not taken seriously.
 *
 * THE TERMS ARE SHOWN HERE AND NOWHERE ELSE. Putting them at the end, next to
 * the payment button, is how consent becomes a thing people tap past to get
 * their money's worth. At the start it costs one tap, before anyone has
 * invested anything in the booking.
 *
 * AGREEING IS ASKED ONCE. A returning visitor who has already accepted this
 * version goes straight to booking — re-consenting on every "hi" trains people
 * to tap without reading, which is the opposite of what the gate is for.
 */

const send = require('./send');
const { greetingName } = require('../gatepass/customers');
const { t, langOf, hasChosen } = require('../i18n');

/** Bump when the wording changes; 022 stores this against each acceptance. */
const TERMS_VERSION = 'v1';

const base = () => (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const termsUrl = () => `${base()}/policy/terms`;
const privacyUrl = () => `${base()}/policy/privacy`;

function firstTime(customer) {
  const name = greetingName(customer);
  const hello = name ? `Namaste ${name}! 🙏` : 'Namaste! 🙏';

  return [
    hello,
    '',
    '*Pravesha* — entry passes for Karnataka’s hill destinations.',
    'Karnataka Tourism Department',
    '',
    'Book your vehicle’s entry pass right here — pick a place, a time slot and a date, and pay online. It takes about a minute.',
    '',
    '_Two-wheelers, cars, Toofans and Tempo Travellers only. Autos, buses, trucks, tractors and trailers are not permitted._',
    '',
    'To continue, please read and accept:',
    `📄 Terms & Conditions — ${termsUrl()}`,
    `🔒 Privacy Policy — ${privacyUrl()}`,
    '',
    '_We look up your vehicle’s registration details to set the correct entry fee. We do not store the owner’s name or address._',
  ].join('\n');
}

/**
 * The main menu, in the visitor's own language.
 *
 * Nothing here is bilingual. Once someone has told us they read Kannada,
 * continuing to attach an English line to every message says their choice was
 * not taken seriously -- and it doubles the length of every message on a phone.
 */
function menu(customer) {
  const lang = langOf(customer);
  const name = greetingName(customer);
  return [
    name ? t('menuGreet', lang, { name }) : t('menuGreetNoName', lang),
    '',
    t('menuBody', lang),
  ].join('\n');
}

/** Sent once, after consent: the only question asked before a language is known. */
const askLanguage = (to, customer) =>
  send.buttons(to, t('chooseLanguage', langOf(customer)), [
    { id: 'LANG_EN', title: t('btnEnglish', 'en') },
    { id: 'LANG_KN', title: t('btnKannada', 'kn') },
  ], 'Pravesha · ಪ್ರವೇಶ');

const sendMenu = (to, customer) => {
  const lang = langOf(customer);
  return send.buttons(to, menu(customer), [
    { id: 'BOOK', title: t('btnBook', lang) },
    { id: 'MY_PASSES', title: t('btnMyPasses', lang) },
    { id: 'HELP', title: t('btnHelp', lang) },
  ], t('menuHeader', lang));
};

/**
 * Where a visitor lands on "hi" depends on how far they have got before, and
 * the order is fixed: terms, then language, then the menu.
 *
 * Terms come first because they gate everything. Language comes second because
 * the terms message is the one thing that must be readable before anyone has
 * told us what they read -- so it is bilingual, and every message after it is
 * not.
 */
async function send_(to, customer) {
  const accepted = customer?.terms_accepted_at && customer?.terms_version === TERMS_VERSION;

  if (!accepted) {
    return send.buttons(to, firstTime(customer), [
      { id: 'AGREE', title: t('btnAgree', 'en') },
      { id: 'HELP', title: t('btnHelp', 'en') },
    ], 'Pravesha · ಪ್ರವೇಶ');
  }

  if (!hasChosen(customer)) return askLanguage(to, customer);

  return sendMenu(to, customer);
}

module.exports = { send: send_, firstTime, menu, askLanguage, sendMenu, TERMS_VERSION, termsUrl, privacyUrl };
