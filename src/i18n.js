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
