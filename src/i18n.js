/**
 * i18n.js — every line the visitor reads, in both languages.
 *
 * ONE CATALOGUE, NOT STRINGS SCATTERED THROUGH THE FLOW. A booking runs across
 * a dozen messages, and the failure this prevents is the conversation that
 * switches language halfway because one reply was written inline in English.
 * Anything the visitor sees is defined here or it is a bug.
 *
 * ENGLISH UNTIL THEY CHOOSE. Every visitor is asked which language they want,
 * and that choice is kept. Somebody who has not chosen yet — a pass sold at the
 * gate to a number that never messaged us — is written to in English (049).
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

  /* The menu as a list (2026-09-19): five choices, more than WhatsApp's three
     buttons. Row titles 24 characters, descriptions 72. */
  menuButton: { en: 'Menu', kn: 'ಮೆನು' },
  menuSection: { en: 'Pravesha', kn: 'ಪ್ರವೇಶ' },
  rowBook: { en: '🎟️ Book pass', kn: '🎟️ ಪಾಸ್ ಪಡೆಯಿರಿ' },
  rowBookDesc: { en: 'Choose date, slot and vehicle, and pay', kn: 'ದಿನಾಂಕ, ಸ್ಲಾಟ್, ವಾಹನ ಆಯ್ಕೆಮಾಡಿ ಪಾವತಿಸಿ' },
  rowMyPasses: { en: '📋 My passes', kn: '📋 ನನ್ನ ಪಾಸ್‌ಗಳು' },
  rowMyPassesDesc: { en: 'Get your upcoming passes again', kn: 'ನಿಮ್ಮ ಮುಂಬರುವ ಪಾಸ್‌ಗಳನ್ನು ಮತ್ತೆ ಪಡೆಯಿರಿ' },
  rowPostpone: { en: '📅 Postpone pass', kn: '📅 ಪಾಸ್ ಮುಂದೂಡಿ' },
  rowPostponeDesc: { en: 'Move a pass to another date — once, no fee', kn: 'ಪಾಸ್ ಅನ್ನು ಬೇರೆ ದಿನಾಂಕಕ್ಕೆ — ಒಮ್ಮೆ, ಶುಲ್ಕವಿಲ್ಲ' },
  rowSupport: { en: '🛟 Support', kn: '🛟 ಬೆಂಬಲ' },
  rowSupportDesc: { en: 'Write to us about any problem', kn: 'ಯಾವುದೇ ಸಮಸ್ಯೆಯ ಬಗ್ಗೆ ನಮಗೆ ಬರೆಯಿರಿ' },
  rowHelp: { en: '❓ Help', kn: '❓ ಸಹಾಯ' },
  rowHelpDesc: { en: 'How Pravesha works', kn: 'ಪ್ರವೇಶ ಹೇಗೆ ಕೆಲಸ ಮಾಡುತ್ತದೆ' },

  /* Postpone: the terms are shown in the chat before the link (user, 2026-09-19),
     the same rules the page asks the visitor to agree to. */
  postponeIntro: {
    en: '📅 *Postpone your pass*\n\nBefore you continue, please read the postponement terms:\n\n'
      + '• A pass can be postponed *only once*.\n'
      + '• Allowed until *{hours} hours before* your booked slot starts.\n'
      + '• The new date must be within the next *{days} days*, in a slot that still has room.\n'
      + '• *No fee, no refund* and no difference in amount — the pass, vehicle and amount paid stay the same.\n'
      + '• The pass number stays the same; your old date and slot are released.\n'
      + '• Used passes cannot be postponed.\n\n'
      + 'By continuing you agree to these terms and to the Pravesha Terms & Privacy Policy. You will confirm again on the next page.',
    kn: '📅 *ನಿಮ್ಮ ಪಾಸ್ ಮುಂದೂಡಿ*\n\nಮುಂದುವರಿಯುವ ಮೊದಲು ದಯವಿಟ್ಟು ಮುಂದೂಡಿಕೆಯ ನಿಯಮಗಳನ್ನು ಓದಿ:\n\n'
      + '• ಒಂದು ಪಾಸ್ ಅನ್ನು *ಒಮ್ಮೆ ಮಾತ್ರ* ಮುಂದೂಡಬಹುದು.\n'
      + '• ನಿಮ್ಮ ಸ್ಲಾಟ್ ಆರಂಭಕ್ಕೆ *{hours} ಗಂಟೆ ಮುಂಚೆ*ವರೆಗೆ ಮಾತ್ರ.\n'
      + '• ಹೊಸ ದಿನಾಂಕ ಮುಂದಿನ *{days} ದಿನಗಳೊಳಗೆ*, ಸ್ಥಳವಿರುವ ಸ್ಲಾಟ್‌ನಲ್ಲಿ.\n'
      + '• *ಶುಲ್ಕವಿಲ್ಲ, ಮರುಪಾವತಿಯಿಲ್ಲ* — ಪಾಸ್, ವಾಹನ ಮತ್ತು ಪಾವತಿಸಿದ ಮೊತ್ತ ಬದಲಾಗುವುದಿಲ್ಲ.\n'
      + '• ಪಾಸ್ ಸಂಖ್ಯೆ ಅದೇ ಇರುತ್ತದೆ; ಹಳೆಯ ದಿನಾಂಕ ಮತ್ತು ಸ್ಲಾಟ್ ರದ್ದಾಗುತ್ತದೆ.\n'
      + '• ಬಳಸಿದ ಪಾಸ್‌ಗಳನ್ನು ಮುಂದೂಡಲಾಗುವುದಿಲ್ಲ.\n\n'
      + 'ಮುಂದುವರಿಯುವ ಮೂಲಕ ನೀವು ಈ ನಿಯಮಗಳು ಹಾಗೂ ಪ್ರವೇಶ ನಿಯಮಗಳು ಮತ್ತು ಗೌಪ್ಯತಾ ನೀತಿಗೆ ಒಪ್ಪುತ್ತೀರಿ. ಮುಂದಿನ ಪುಟದಲ್ಲಿ ಮತ್ತೆ ಖಚಿತಪಡಿಸುತ್ತೀರಿ.',
  },
  postponeCta: { en: 'Choose new date', kn: 'ಹೊಸ ದಿನಾಂಕ ಆಯ್ಕೆ' },
  postponeNone: {
    en: 'You have no pass that can be postponed right now. Only paid passes that have not been used or moved before can be postponed, until {hours} hours before the slot.',
    kn: 'ಈಗ ಮುಂದೂಡಬಹುದಾದ ಯಾವುದೇ ಪಾಸ್ ನಿಮ್ಮಲ್ಲಿಲ್ಲ. ಬಳಸದ ಮತ್ತು ಹಿಂದೆ ಮುಂದೂಡದ ಪಾವತಿಸಿದ ಪಾಸ್‌ಗಳನ್ನು ಮಾತ್ರ, ಸ್ಲಾಟ್‌ಗೆ {hours} ಗಂಟೆ ಮುಂಚೆವರೆಗೆ ಮುಂದೂಡಬಹುದು.',
  },
  postponedDone: {
    en: '✅ *Pass postponed*\n\nPass *{ticket}* is now for *{date}*, *{slot}*.\nYour updated pass follows. Your old date and slot are no longer valid.',
    kn: '✅ *ಪಾಸ್ ಮುಂದೂಡಲಾಗಿದೆ*\n\nಪಾಸ್ *{ticket}* ಈಗ *{date}*, *{slot}* ಕ್ಕೆ.\nಹೊಸ ಪಾಸ್ ಕೆಳಗಿದೆ. ಹಳೆಯ ದಿನಾಂಕ ಮತ್ತು ಸ್ಲಾಟ್ ಇನ್ನು ಮಾನ್ಯವಲ್ಲ.',
  },

  /* Support (user, 2026-09-19). */
  supportIntro: {
    en: '🛟 *Support*\n\nTell us about any problem — booking, payment, your pass or entry. Our team reads every message and replies here on WhatsApp.',
    kn: '🛟 *ಬೆಂಬಲ*\n\nಬುಕ್ಕಿಂಗ್, ಪಾವತಿ, ಪಾಸ್ ಅಥವಾ ಪ್ರವೇಶ — ಯಾವುದೇ ಸಮಸ್ಯೆಯ ಬಗ್ಗೆ ತಿಳಿಸಿ. ನಮ್ಮ ತಂಡ ಪ್ರತಿ ಸಂದೇಶವನ್ನು ಓದಿ ಇಲ್ಲಿಯೇ WhatsApp ನಲ್ಲಿ ಉತ್ತರಿಸುತ್ತದೆ.',
  },
  supportCta: { en: 'Write to us', kn: 'ನಮಗೆ ಬರೆಯಿರಿ' },
  supportReceived: {
    en: '🛟 We have received your message (ref *{ref}*). Our team will reply here on WhatsApp as soon as possible.',
    kn: '🛟 ನಿಮ್ಮ ಸಂದೇಶ ತಲುಪಿದೆ (ಉಲ್ಲೇಖ *{ref}*). ನಮ್ಮ ತಂಡ ಆದಷ್ಟು ಬೇಗ ಇಲ್ಲಿಯೇ WhatsApp ನಲ್ಲಿ ಉತ್ತರಿಸುತ್ತದೆ.',
  },
  /* Offered straight after a pass is delivered: families arrive in two cars and
     the second one should not mean finding the menu again. WhatsApp allows 20
     characters on a button, so the wording is short by necessity, not by
     choice. */
  btnBookAnother: { en: '🎟️ Book another', kn: '🎟️ ಇನ್ನೊಂದು ಪಾಸ್' },
  btnRate: { en: '⭐ Rate your visit', kn: '⭐ ಅನಿಸಿಕೆ ತಿಳಿಸಿ' },
  rateAsk: {
    en: 'You are through the gate — enjoy the hills. How was it? It takes two taps and it is read by the people who run the gate.',
    kn: 'ನೀವು ಗೇಟ್ ದಾಟಿದ್ದೀರಿ — ಪ್ರಯಾಣ ಸುಖಕರವಾಗಿರಲಿ. ಹೇಗಿತ್ತು? ಎರಡು ಟ್ಯಾಪ್ ಸಾಕು, ಗೇಟ್ ನಡೆಸುವವರು ಇದನ್ನು ಓದುತ್ತಾರೆ.',
  },
  rateLinkBody: {
    en: 'Tap below to rate your visit. It takes a moment, and nothing you write is made public unless we ask you first.',
    kn: 'ನಿಮ್ಮ ಭೇಟಿಗೆ ರೇಟಿಂಗ್ ನೀಡಲು ಕೆಳಗೆ ಟ್ಯಾಪ್ ಮಾಡಿ. ನೀವು ಬರೆದದ್ದನ್ನು ನಿಮ್ಮ ಒಪ್ಪಿಗೆಯಿಲ್ಲದೆ ಸಾರ್ವಜನಿಕಗೊಳಿಸುವುದಿಲ್ಲ.',
  },
  rateLinkCta: { en: 'Rate your visit', kn: 'ಅನಿಸಿಕೆ ತಿಳಿಸಿ' },
  rateThanks: {
    en: 'Thank you — that is recorded.',
    kn: 'ಧನ್ಯವಾದಗಳು — ದಾಖಲಾಗಿದೆ.',
  },
  afterPass: {
    en: 'Another vehicle to book, or want to see your passes?',
    kn: 'ಇನ್ನೊಂದು ವಾಹನಕ್ಕೆ ಪಾಸ್ ಬೇಕೇ, ಅಥವಾ ನಿಮ್ಮ ಪಾಸ್‌ಗಳನ್ನು ನೋಡಬೇಕೇ?',
  },
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

  /* ── choosing the destination first, and per-person passes (2026-09-15) ── */
  pickPlaceHeader: { en: 'Where are you visiting?', kn: 'ಯಾವ ಸ್ಥಳಕ್ಕೆ ಭೇಟಿ?' },
  pickPlaceBody: {
    en: 'Choose the place you are visiting. The booking form for that place opens next.',
    kn: 'ನೀವು ಭೇಟಿ ನೀಡುವ ಸ್ಥಳವನ್ನು ಆಯ್ಕೆಮಾಡಿ. ಆ ಸ್ಥಳದ ಬುಕಿಂಗ್ ಫಾರಮ್ ನಂತರ ತೆರೆಯುತ್ತದೆ.',
  },
  pickPlaceButton: { en: 'Choose place', kn: 'ಸ್ಥಳ ಆಯ್ಕೆ' },
  pickPlaceSection: { en: 'Destinations', kn: 'ಸ್ಥಳಗಳು' },
  pickPlaceVehicle: { en: 'Pass per vehicle', kn: 'ಪ್ರತಿ ವಾಹನಕ್ಕೆ ಪಾಸ್' },
  pickPlacePerson: { en: 'Pass per person', kn: 'ಪ್ರತಿ ವ್ಯಕ್ತಿಗೆ ಪಾಸ್' },
  bookBodyPerson: {
    en: 'Tap below to choose your date and the number of people (up to {max}).\n\nThe link works once and is valid for 2 hours.',
    kn: 'ದಿನಾಂಕ ಮತ್ತು ಜನರ ಸಂಖ್ಯೆಯನ್ನು (ಗರಿಷ್ಠ {max}) ಆಯ್ಕೆ ಮಾಡಲು ಕೆಳಗೆ ಒತ್ತಿರಿ.\n\nಈ ಲಿಂಕ್ 2 ಗಂಟೆಗಳವರೆಗೆ ಮಾತ್ರ ಮಾನ್ಯ.',
  },
  secPeople: { en: '👥 *Visitors*', kn: '👥 *ಪ್ರವಾಸಿಗರು*' },
  checkpostNotePerson: {
    en: 'No printout needed. At the checkpost, show this pass number — staff will confirm how many of you are entering.',
    kn: 'ಮುದ್ರಿತ ಪ್ರತಿ ಬೇಕಿಲ್ಲ. ಚೆಕ್‌ಪೋಸ್ಟ್‌ನಲ್ಲಿ ಈ ಪಾಸ್ ಸಂಖ್ಯೆಯನ್ನು ತೋರಿಸಿ — ಸಿಬ್ಬಂದಿ ಪ್ರವೇಶಿಸುವವರ ಸಂಖ್ಯೆಯನ್ನು ದೃಢೀಕರಿಸುತ್ತಾರೆ.',
  },

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

  deletionReceived: {
    en: '🗑️ *Data deletion request received*\n\nReference: *{ref}*\n\nYour data will be deleted or anonymised within {days} days. Records of paid passes must be kept for eight years under Indian tax law and are used for nothing else.\n\nWe will confirm here when it is done. Details: www.pravesha.in/policy/data-deletion',
    kn: '🗑️ *ಡೇಟಾ ಅಳಿಸುವಿಕೆ ವಿನಂತಿ ಸ್ವೀಕರಿಸಲಾಗಿದೆ*\n\nಉಲ್ಲೇಖ: *{ref}*\n\n{days} ದಿನಗಳೊಳಗೆ ನಿಮ್ಮ ಡೇಟಾವನ್ನು ಅಳಿಸಲಾಗುತ್ತದೆ ಅಥವಾ ಅನಾಮಧೇಯಗೊಳಿಸಲಾಗುತ್ತದೆ. ಪಾವತಿಸಿದ ಪಾಸ್‌ಗಳ ದಾಖಲೆಗಳನ್ನು ಭಾರತೀಯ ತೆರಿಗೆ ಕಾನೂನಿನಂತೆ ಎಂಟು ವರ್ಷ ಇಡಬೇಕು; ಅವನ್ನು ಬೇರೆ ಯಾವುದಕ್ಕೂ ಬಳಸುವುದಿಲ್ಲ.\n\nಪೂರ್ಣಗೊಂಡಾಗ ಇಲ್ಲಿ ತಿಳಿಸುತ್ತೇವೆ. ವಿವರ: www.pravesha.in/policy/data-deletion',
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
  myAutoIntro: {
    en: '📋 *My passes*\nYou have {up} upcoming pass(es). Sending them to you now:',
    kn: '📋 *ನನ್ನ ಪಾಸ್‌ಗಳು*\nನಿಮ್ಮ ಬಳಿ {up} ಮುಂಬರುವ ಪಾಸ್(ಗಳು) ಇವೆ. ಈಗ ಕಳುಹಿಸಲಾಗುತ್ತಿದೆ:',
  },
  noUpcoming: {
    en: 'You have no upcoming passes.\n\nBook an entry pass below.',
    kn: 'ನಿಮ್ಮ ಬಳಿ ಮುಂಬರುವ ಪಾಸ್‌ಗಳಿಲ್ಲ.\n\nಕೆಳಗೆ ಪ್ರವೇಶ ಪಾಸ್ ಪಡೆಯಿರಿ.',
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
