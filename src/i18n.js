/**
 * i18n.js — every line the visitor reads, in both languages.
 *
 * ONE CATALOGUE, NOT STRINGS SCATTERED THROUGH THE FLOW. A booking runs across
 * a dozen messages, and the failure this prevents is the conversation that
 * switches language halfway because one reply was written inline in English.
 * Anything the visitor sees is defined here or it is a bug.
 *
 * KANNADA IS THE DEFAULT, AND THAT IS DELIBERATE. The column defaults to 'kn':
 * this is a Karnataka Tourism service and the larger share of visitors read
 * Kannada first. English is a choice people make, not the baseline everyone
 * else is measured against.
 *
 * WHATSAPP BUTTON TITLES ARE CAPPED AT 20 CHARACTERS and Meta rejects the whole
 * message when one is longer -- not the button, the message. Kannada runs longer
 * than English for the same words, so every title here is checked at load rather
 * than discovered in front of a customer. See assertTitles() at the bottom.
 */

const LANGS = ['en', 'kn'];
const FALLBACK = 'en';

const S = {
  /* Asked before we know the answer, so this one line is the only place both
     languages are deliberately shown together after the welcome. */
  chooseLanguage: {
    en: 'Which language would you like to continue in?\nಯಾವ ಭಾಷೆಯಲ್ಲಿ ಮುಂದುವರಿಸಲು ಬಯಸುತ್ತೀರಿ?',
    kn: 'Which language would you like to continue in?\nಯಾವ ಭಾಷೆಯಲ್ಲಿ ಮುಂದುವರಿಸಲು ಬಯಸುತ್ತೀರಿ?',
  },
  btnEnglish: { en: 'English', kn: 'English' },
  btnKannada: { en: 'ಕನ್ನಡ', kn: 'ಕನ್ನಡ' },

  languageSet: {
    en: '✅ Continuing in English.',
    kn: '✅ ಕನ್ನಡದಲ್ಲಿ ಮುಂದುವರಿಯುತ್ತಿದೆ.',
  },

  menuHeader: { en: 'Pravesha', kn: 'ಪ್ರವೇಶ' },
  menuGreet: {
    en: 'Namaste {name}! 🙏',
    kn: 'ನಮಸ್ಕಾರ {name}! 🙏',
  },
  menuGreetNoName: { en: 'Namaste! 🙏', kn: 'ನಮಸ್ಕಾರ! 🙏' },
  menuBody: {
    en: '*Pravesha* — entry passes for Karnataka’s hill destinations.\n\nWhat would you like to do?',
    kn: '*ಪ್ರವೇಶ* — ಕರ್ನಾಟಕದ ಗಿರಿಧಾಮಗಳಿಗೆ ಪ್ರವೇಶ ಪಾಸ್.\n\nನೀವು ಏನು ಮಾಡಲು ಬಯಸುತ್ತೀರಿ?',
  },

  btnBook: { en: '🎟️ Book pass', kn: '🎟️ ಪಾಸ್ ಪಡೆಯಿರಿ' },
  btnMyPasses: { en: '📋 My passes', kn: '📋 ನನ್ನ ಪಾಸ್‌ಗಳು' },
  btnHelp: { en: '❓ Help', kn: '❓ ಸಹಾಯ' },
  btnAgree: { en: '✅ Agree & continue', kn: '✅ ಒಪ್ಪಿ ಮುಂದುವರಿಸಿ' },

  thanks: { en: '✅ Thank you.', kn: '✅ ಧನ್ಯವಾದಗಳು.' },

  help: {
    en: '*Pravesha help*\n\nSend *hi* at any time to start over.\n\nEntry passes are issued for two-wheelers, cars, Toofans and Tempo Travellers.\n\nAutos, buses, trucks, tractors and trailers are not permitted on these routes.',
    kn: '*ಪ್ರವೇಶ ಸಹಾಯ*\n\nಮತ್ತೆ ಪ್ರಾರಂಭಿಸಲು ಯಾವಾಗ ಬೇಕಾದರೂ *hi* ಎಂದು ಕಳುಹಿಸಿ.\n\nದ್ವಿಚಕ್ರ ವಾಹನ, ಕಾರು, ಟೂಫಾನ್ ಮತ್ತು ಟೆಂಪೋ ಟ್ರಾವೆಲರ್‌ಗಳಿಗೆ ಪ್ರವೇಶ ಪಾಸ್ ನೀಡಲಾಗುತ್ತದೆ.\n\nಆಟೋ, ಬಸ್, ಟ್ರಕ್, ಟ್ರ್ಯಾಕ್ಟರ್ ಮತ್ತು ಟ್ರೇಲರ್‌ಗಳಿಗೆ ಈ ಮಾರ್ಗಗಳಲ್ಲಿ ಅನುಮತಿ ಇಲ್ಲ.',
  },

  bookHeader: { en: 'Book your entry pass', kn: 'ಪ್ರವೇಶ ಪಾಸ್ ಕಾಯ್ದಿರಿಸಿ' },
  bookBody: {
    en: 'Tap below to choose your destination, date, time slot and vehicle.\n\nThe link works once and is valid for 2 hours.',
    kn: 'ನಿಮ್ಮ ಸ್ಥಳ, ದಿನಾಂಕ, ಸಮಯ ಮತ್ತು ವಾಹನವನ್ನು ಆಯ್ಕೆ ಮಾಡಲು ಕೆಳಗೆ ಒತ್ತಿರಿ.\n\nಈ ಲಿಂಕ್ 2 ಗಂಟೆಗಳವರೆಗೆ ಮಾತ್ರ ಮಾನ್ಯ.',
  },
  bookFooter: { en: 'Pravesha · Karnataka Tourism', kn: 'ಪ್ರವೇಶ · ಕರ್ನಾಟಕ ಪ್ರವಾಸೋದ್ಯಮ' },
  bookCta: { en: 'Open booking form', kn: 'ಫಾರಮ್ ತೆರೆಯಿರಿ' },

  /* ── the pass, as it arrives in the chat after payment ── */
  passConfirmed: {
    en: '✅ *Payment successful — your entry pass is confirmed*',
    kn: '✅ *ಪಾವತಿ ಯಶಸ್ವಿಯಾಗಿದೆ — ನಿಮ್ಮ ಪ್ರವೇಶ ಪಾಸ್ ದೃಢಪಟ್ಟಿದೆ*',
  },
  passResent: { en: '🎟️ *Here is your entry pass*', kn: '🎟️ *ಇಲ್ಲಿದೆ ನಿಮ್ಮ ಪ್ರವೇಶ ಪಾಸ್*' },
  passUsedStatus: { en: 'USED', kn: 'ಬಳಸಲಾಗಿದೆ' },
  passTitle: { en: '🎟️ *PRAVESHA ENTRY PASS*', kn: '🎟️ *ಪ್ರವೇಶ ಪಾಸ್*' },
  passNo: { en: 'Pass No', kn: 'ಪಾಸ್ ಸಂಖ್ಯೆ' },
  passStatus: { en: 'Status', kn: 'ಸ್ಥಿತಿ' },
  passValid: { en: 'PAID · VALID', kn: 'ಪಾವತಿಸಲಾಗಿದೆ · ಮಾನ್ಯ' },
  secVehicle: { en: '🚗 *Vehicle*', kn: '🚗 *ವಾಹನ*' },
  vehType: { en: 'Type', kn: 'ಪ್ರಕಾರ' },
  secVisit: { en: '📍 *Visit*', kn: '📍 *ಭೇಟಿ*' },
  lastEntry: { en: 'Last entry', kn: 'ಕೊನೆಯ ಪ್ರವೇಶ' },
  secPayment: { en: '💳 *Payment*', kn: '💳 *ಪಾವತಿ*' },
  entryFee: { en: 'Entry fee', kn: 'ಪ್ರವೇಶ ಶುಲ್ಕ' },
  platformFee: { en: 'Platform fee', kn: 'ಪ್ಲಾಟ್‌ಫಾರ್ಮ್ ಶುಲ್ಕ' },
  totalPaid: { en: 'Total paid', kn: 'ಒಟ್ಟು ಪಾವತಿ' },
  paymentId: { en: 'Payment ID', kn: 'ಪಾವತಿ ಐಡಿ' },
  secCheckpost: { en: '🛂 *At the checkpost*', kn: '🛂 *ಚೆಕ್‌ಪೋಸ್ಟ್‌ನಲ್ಲಿ*' },
  checkpostNote: {
    en: 'No printout needed. Just drive up to the checkpost — staff will read your vehicle number and record your entry digitally.',
    kn: 'ಮುದ್ರಿತ ಪ್ರತಿ ಬೇಕಿಲ್ಲ. ನೇರವಾಗಿ ಚೆಕ್‌ಪೋಸ್ಟ್‌ಗೆ ಬನ್ನಿ — ಸಿಬ್ಬಂದಿ ನಿಮ್ಮ ವಾಹನ ಸಂಖ್ಯೆಯನ್ನು ನೋಡಿ ಪ್ರವೇಶವನ್ನು ಡಿಜಿಟಲ್ ಆಗಿ ದಾಖಲಿಸುತ್ತಾರೆ.',
  },
  pdfAttached: { en: '📄 Your pass PDF is attached below.', kn: '📄 ನಿಮ್ಮ ಪಾಸ್ PDF ಕೆಳಗೆ ಲಗತ್ತಿಸಲಾಗಿದೆ.' },
  pdfCaption: {
    en: 'Pravesha entry pass {ticket} · {plate} · {date}',
    kn: 'ಪ್ರವೇಶ ಪಾಸ್ {ticket} · {plate} · {date}',
  },

  /* ── My passes ── */
  myHeader: { en: 'My passes', kn: 'ನನ್ನ ಪಾಸ್‌ಗಳು' },
  myBody: {
    en: 'You have {up} upcoming pass(es).\n\nTap *View passes* and choose one to get its pass and PDF again.',
    kn: 'ನಿಮ್ಮ ಬಳಿ {up} ಮುಂಬರುವ ಪಾಸ್(ಗಳು) ಇವೆ.\n\n*ಪಾಸ್‌ಗಳನ್ನು ನೋಡಿ* ಒತ್ತಿ, ಒಂದನ್ನು ಆಯ್ಕೆ ಮಾಡಿದರೆ ಅದರ ಪಾಸ್ ಮತ್ತು PDF ಮತ್ತೆ ಬರುತ್ತದೆ.',
  },
  myBodyPastOnly: {
    en: 'You have no upcoming passes. Your recent passes are listed below.',
    kn: 'ನಿಮ್ಮ ಬಳಿ ಮುಂಬರುವ ಪಾಸ್‌ಗಳಿಲ್ಲ. ನಿಮ್ಮ ಇತ್ತೀಚಿನ ಪಾಸ್‌ಗಳು ಕೆಳಗಿವೆ.',
  },
  myButton: { en: 'View passes', kn: 'ಪಾಸ್‌ಗಳನ್ನು ನೋಡಿ' },
  mySecUpcoming: { en: 'Upcoming', kn: 'ಮುಂಬರುವ' },
  mySecPast: { en: 'Past', kn: 'ಹಿಂದಿನ' },
  myUsed: { en: 'Used', kn: 'ಬಳಸಲಾಗಿದೆ' },
  myExpired: { en: 'Date passed', kn: 'ದಿನಾಂಕ ಮುಗಿದಿದೆ' },
  myFooter: { en: 'Pravesha · Karnataka Tourism', kn: 'ಪ್ರವೇಶ · ಕರ್ನಾಟಕ ಪ್ರವಾಸೋದ್ಯಮ' },
  myNotYours: {
    en: 'That pass could not be found in your account. Send *hi* to see your passes again.',
    kn: 'ಆ ಪಾಸ್ ನಿಮ್ಮ ಖಾತೆಯಲ್ಲಿ ಕಂಡುಬಂದಿಲ್ಲ. ನಿಮ್ಮ ಪಾಸ್‌ಗಳನ್ನು ಮತ್ತೆ ನೋಡಲು *hi* ಕಳುಹಿಸಿ.',
  },
  noPassesYet: {
    en: 'You have no passes yet.\n\nBook your first entry pass below.',
    kn: 'ನಿಮ್ಮ ಬಳಿ ಇನ್ನೂ ಯಾವುದೇ ಪಾಸ್ ಇಲ್ಲ.\n\nಕೆಳಗೆ ನಿಮ್ಮ ಮೊದಲ ಪ್ರವೇಶ ಪಾಸ್ ಪಡೆಯಿರಿ.',
  },

  bookingSoon: {
    en: 'Booking opens next — place, slot, date and vehicle.',
    kn: 'ಕಾಯ್ದಿರಿಸುವಿಕೆ ಶೀಘ್ರದಲ್ಲೇ — ಸ್ಥಳ, ಸಮಯ, ದಿನಾಂಕ ಮತ್ತು ವಾಹನ.',
  },
  noPasses: {
    en: 'You have no passes yet.',
    kn: 'ನಿಮ್ಮ ಬಳಿ ಇನ್ನೂ ಯಾವುದೇ ಪಾಸ್ ಇಲ್ಲ.',
  },
};

/** The language to write in — never null, never something not in LANGS. */
const langOf = (customer) => {
  const l = customer?.language;
  return LANGS.includes(l) ? l : FALLBACK;
};

/** Has this visitor been asked yet? Null means no, whatever the column defaults to. */
const hasChosen = (customer) => !!customer?.language_asked_at;

function t(key, lang = FALLBACK, vars = {}) {
  const entry = S[key];
  if (!entry) throw new Error(`i18n: no string named "${key}"`);
  const raw = entry[LANGS.includes(lang) ? lang : FALLBACK] ?? entry[FALLBACK];
  return String(raw).replace(/\{(\w+)\}/g, (m, k) =>
    (vars[k] === undefined || vars[k] === null ? '' : String(vars[k])));
}

/**
 * Fail at startup, not at a customer.
 *
 * Meta rejects an entire interactive message when any button title exceeds 20
 * characters, so a too-long Kannada title does not degrade -- the visitor gets
 * nothing at all. Checking here means a bad translation stops the process on
 * boot instead of silently breaking one language in production.
 */
function assertTitles() {
  const bad = [];
  for (const [key, entry] of Object.entries(S)) {
    if (!key.startsWith('btn')) continue;
    for (const lang of LANGS) {
      const v = entry[lang];
      if (v && [...v].length > 20) bad.push(`${key}.${lang} is ${[...v].length} chars: "${v}"`);
    }
  }
  if (bad.length) throw new Error(`i18n: button titles over WhatsApp's 20-character limit:\n  ${bad.join('\n  ')}`);
}
assertTitles();

module.exports = { t, langOf, hasChosen, LANGS, FALLBACK, S };
