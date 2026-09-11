/**
 * welcome.js — the first thing anyone sees, and the consent gate.
 *
 * BILINGUAL FROM THE FIRST MESSAGE, not after asking. This is a Karnataka
 * Tourism service and a good share of visitors read Kannada first. Asking
 * "English or Kannada?" before saying anything useful spends the opening
 * message on a question; leading with both means nobody has to ask for their
 * own language.
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
    'ಕರ್ನಾಟಕ ಪ್ರವಾಸೋದ್ಯಮ ಇಲಾಖೆ',
    '',
    'Book your vehicle’s entry pass right here — pick a place, a time slot and a date, and pay online. It takes about a minute.',
    'ಗಿರಿಧಾಮಗಳಿಗೆ ಪ್ರವೇಶ ಪಾಸ್ ಅನ್ನು ವಾಟ್ಸ್‌ಆ್ಯಪ್‌ನಲ್ಲಿಯೇ ಕಾಯ್ದಿರಿಸಿ.',
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

function returning(customer) {
  const name = greetingName(customer);
  return [
    name ? `Welcome back, ${name}! 🙏` : 'Welcome back! 🙏',
    '',
    '*Pravesha* — entry passes for Karnataka’s hill destinations.',
    '',
    'What would you like to do?',
    'ನೀವು ಏನು ಮಾಡಲು ಬಯಸುತ್ತೀರಿ?',
  ].join('\n');
}

/**
 * Buttons rather than "reply with 1, 2 or 3". A tap cannot be misspelt, and it
 * arrives as a stable id instead of text we would have to interpret.
 *
 * Meta allows three, and the consent screen spends one of them on the agreement
 * itself — so the first-time menu deliberately does not offer "My passes". A
 * visitor who has never accepted the terms has no passes to look at.
 */
async function send_(to, customer) {
  const accepted = customer?.terms_accepted_at && customer?.terms_version === TERMS_VERSION;

  if (!accepted) {
    return send.buttons(to, firstTime(customer), [
      { id: 'AGREE', title: '✅ Agree & continue' },
      { id: 'HELP', title: '❓ Help' },
    ], 'Pravesha · ಪ್ರವೇಶ');
  }

  return send.buttons(to, returning(customer), [
    { id: 'BOOK', title: '🎟️ Book pass' },
    { id: 'MY_PASSES', title: '📋 My passes' },
    { id: 'HELP', title: '❓ Help' },
  ], 'Pravesha · ಪ್ರವೇಶ');
}

module.exports = { send: send_, firstTime, returning, TERMS_VERSION, termsUrl, privacyUrl };
