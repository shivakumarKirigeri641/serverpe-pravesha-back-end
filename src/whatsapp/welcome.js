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
 * version is not asked again — re-consenting on every "hi" trains people to tap
 * without reading, which is the opposite of what the gate is for.
 *
 * THE LANGUAGE IS ASKED ON EVERY "hi". Unlike consent, a language is not a
 * decision made once for ever: the same phone is handed between a family, a
 * driver books for an owner, and somebody who chose English last month may want
 * Kannada today. Asking costs one tap, and it is asked only on a greeting — never
 * in the middle of a booking, and never in reply to a stray message.
 */

const send = require('./send');
const { greetingName } = require('../gatepass/customers');
const { t, langOf, hasChosen } = require('../i18n');

/**
 * The version recorded against each acceptance (022).
 *
 * It is the version of the terms document itself, read from legal_documents, so
 * the consent record names the text the visitor actually read rather than a
 * constant that somebody must remember to bump. Cached for a few minutes — a
 * policy version changes when a policy is edited, not per message — and falls
 * back to the last known value if the database is briefly unreachable, because a
 * welcome message must not fail over a version string.
 */
let termsVersion = { value: '1.0', at: 0 };
const TERMS_VERSION_TTL_MS = 5 * 60 * 1000;

async function termsVersionNow() {
  if (Date.now() - termsVersion.at < TERMS_VERSION_TTL_MS) return termsVersion.value;
  try {
    const row = await require('../gatepass/db').one(
      `SELECT version FROM legal_documents WHERE doc_code = 'terms' AND is_active`);
    if (row && row.version) termsVersion = { value: String(row.version), at: Date.now() };
  } catch (e) {
    console.warn('[welcome] terms version lookup failed: %s', e.message);
  }
  return termsVersion.value;
}

/* The website's policy pages once it is live (SITE_URL, e.g. https://www.pravesha.in
   → www.pravesha.in/policy/terms, user 2026-09-19); until then this app's own
   copy of the same text (routes/policy.js), so the link never 404s. */
const base = () => (process.env.SITE_URL || process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
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

/*
 * A LIST, NOT BUTTONS (user, 2026-09-19). Postpone and Support joined Book, My
 * passes and Help — five choices, and WhatsApp allows three buttons. One "Menu"
 * button opens all five, each with a line saying what it does.
 */
const sendMenu = (to, customer) => {
  const lang = langOf(customer);
  const row = (id, key) => ({ id, title: t(key, lang), description: t(`${key}Desc`, lang) });
  return send.list(to, {
    header: t('menuHeader', lang),
    body: menu(customer),
    button: t('menuButton', lang),
    sections: [{
      title: t('menuSection', lang),
      rows: [
        row('BOOK', 'rowBook'),
        row('MY_PASSES', 'rowMyPasses'),
        row('POSTPONE', 'rowPostpone'),
        row('SUPPORT', 'rowSupport'),
        row('HELP', 'rowHelp'),
      ],
    }],
  });
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
  const version = await termsVersionNow();
  const accepted = customer?.terms_accepted_at && customer?.terms_version === version;

  if (!accepted) {
    return send.buttons(to, firstTime(customer), [
      { id: 'AGREE', title: t('btnAgree', 'en') },
      { id: 'HELP', title: t('btnHelp', 'en') },
    ], 'Pravesha · ಪ್ರವೇಶ');
  }

  if (!hasChosen(customer)) return askLanguage(to, customer);

  return sendMenu(to, customer);
}

/**
 * What a "hi" gets: the terms if this version has not been accepted, otherwise
 * the language question — every time.
 *
 * Kept apart from send_() on purpose. send_() also answers messages nobody
 * recognised, and a visitor who types "ok" mid-conversation should get the menu
 * back, not be asked which language they speak.
 */
async function greet(to, customer) {
  const version = await termsVersionNow();
  const accepted = customer?.terms_accepted_at && customer?.terms_version === version;
  if (!accepted) return send_(to, customer);
  return askLanguage(to, customer);
}

/**
 * NO REPLY IS A DEAD END (user, 2026-09-20).
 *
 * Several messages used to be the last word in the thread: "you have no pass
 * that can be postponed", "we have received your message", the postponed
 * confirmation, Help. Each one left the visitor on a screen with nothing to
 * tap, and the only way on was to know that typing "hi" starts again — which
 * nobody knows the first time. So every one of them now carries the way back
 * to the menu.
 *
 * It is sent as buttons rather than appended as text because a sentence saying
 * "type menu" is an instruction, and a button is a tap. `extra` takes the one
 * or two choices that are obvious in that particular spot — "Book pass" after
 * being told there is nothing to postpone — and More options always comes
 * last, since WhatsApp allows three buttons and the menu behind it holds five.
 */
/* `who` is a customer row, or just the language where the caller already has
   it — the postpone and support pages know the language and not much else. */
function withMenu(to, who, body, extra = [], header) {
  const lang = typeof who === 'string' ? who : langOf(who);
  /* Three is WhatsApp's limit, and More options is the one that must survive
     it — it is the only button here that leads anywhere else. So the extras
     give way, not the menu. */
  const buttons = [...extra.slice(0, 2), { id: 'MENU', title: t('btnMore', lang) }];
  return send.buttons(to, body, buttons, header);
}

module.exports = { send: send_, greet, firstTime, menu, askLanguage, sendMenu, withMenu, termsVersionNow, termsUrl, privacyUrl };
