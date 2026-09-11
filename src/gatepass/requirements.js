/**
 * requirements.js — what the department has to decide, permit or tell us.
 *
 * Written down as a list rather than raised in conversation, for three reasons:
 *
 *   A meeting produces agreement in principle and forgets the details. A sheet
 *   with a blank against each item produces answers.
 *
 *   Several of these are permissions, not preferences. Printing the state
 *   emblem on a ticket without written authority is not a small oversight, and
 *   it is the kind of thing that surfaces months later.
 *
 *   The list itself is an argument. A vendor who arrives knowing that
 *   settlement frequency, refund authority and signage all need deciding has
 *   evidently run something before.
 *
 * Grouped by what kind of answer each needs, because the DC decides some of
 * these personally and delegates the rest — and mixing the two wastes the time
 * of whoever is in the room.
 */

const REQUIREMENTS = [
  /* ── Decisions only the department can make ───────────────────────── */
  {
    group: 'decision',
    kn: 'ಪ್ರವೇಶ ಶುಲ್ಕದ ದೃಢೀಕರಣ',
    item: 'Confirm the entry fee for each vehicle type',
    why: 'Only the car rate has been given. Two-wheeler, Toofan and Tempo Traveller rates are '
       + 'assumed in this proposal and must be replaced with the department\'s own figures.',
    needed: 'Before go-live',
  },
  {
    group: 'decision',
    kn: 'ಅನುಕೂಲ ಶುಲ್ಕಕ್ಕೆ ಒಪ್ಪಿಗೆ',
    item: 'Approve the visitor convenience fee',
    why: 'The service and convenience fee is charged to the visitor and funds the whole system. '
       + 'It needs the department\'s explicit approval, and confirmation that it may be shown as '
       + 'a separate line on the ticket and invoice.',
    needed: 'Before go-live',
  },
  {
    group: 'decision',
    kn: 'ನಗದು ಕೌಂಟರ್ ಮುಂದುವರಿಯುತ್ತದೆಯೇ',
    item: 'Whether a cash counter remains at the gate',
    why: 'If it does, the convenience fee is a choice rather than a charge on entry. This is the '
       + 'single most useful protection against the fee being questioned publicly, and it costs '
       + 'the department nothing to keep.',
    needed: 'Before go-live',
  },
  {
    group: 'decision',
    kn: 'ಹಳೆಯ ವ್ಯವಸ್ಥೆಯ ಬಗ್ಗೆ',
    item: 'What happens to the existing booking arrangement',
    why: 'Run both in parallel for a period, or switch on a date? Either works, but the gate '
       + 'staff must be told which, and the existing vendor\'s position is the department\'s to '
       + 'settle, not ours.',
    needed: 'Before go-live',
  },
  {
    group: 'decision',
    kn: 'ಸಾಮರ್ಥ್ಯ ಮತ್ತು ಅವಧಿಗಳ ದೃಢೀಕರಣ',
    item: 'Confirm slot timings and capacity per vehicle type',
    why: 'The proposal assumes two slots and the numbers given verbally. Peak days, holidays and '
       + 'any VIP protocol should be stated now rather than discovered on a Sunday.',
    needed: 'Before go-live',
  },
  {
    group: 'decision',
    kn: 'ಮರುಪಾವತಿ ಮತ್ತು ರದ್ದತಿ ಅಧಿಕಾರ',
    item: 'Who may close a day and who may authorise refunds',
    why: 'Closing a date refunds or moves real bookings. The panel can restrict that to named '
       + 'officers, but the department must say which.',
    needed: 'Before go-live',
  },

  /* ── Permissions ──────────────────────────────────────────────────── */
  {
    group: 'permission',
    kn: 'ಲಾಂಛನ ಮತ್ತು ಲೋಗೋ ಬಳಕೆಗೆ ಅನುಮತಿ',
    item: 'Written permission to use the department emblem and name',
    why: 'The state emblem and the Karnataka Tourism wordmark appear on the ticket card '
       + 'and the reports. Using them without written authority is not a small oversight, and '
       + 'this is the item most often forgotten until it becomes a problem.',
    needed: 'Before go-live',
  },
  {
    group: 'permission',
    kn: 'ಚೆಕ್‌ಪೋಸ್ಟ್‌ನಲ್ಲಿ ಕಾರ್ಯನಿರ್ವಹಿಸಲು ಅನುಮತಿ',
    item: 'Authority to operate at the checkpost',
    why: 'A work order, letter of intent or MoU — whichever form the department prefers. The '
       + 'form matters less than having one before staff PINs are issued.',
    needed: 'Before pilot',
  },
  {
    group: 'permission',
    kn: 'ಪ್ರಚಾರ ಮತ್ತು ಪ್ರಸಿದ್ಧಿ',
    item: 'Publicity for the WhatsApp booking number',
    why: 'Nobody uses a booking system they have not heard of. Signage at the gate and on the '
       + 'approach road, the number on the department website and on any existing ticket, and a '
       + 'departmental announcement. This decides whether the system is used at all.',
    needed: 'At launch',
  },
  {
    group: 'permission',
    kn: 'ಮಾಹಿತಿ ನಿರ್ವಹಣೆಗೆ ಒಪ್ಪಿಗೆ',
    item: 'Acknowledgement of what data is held',
    why: 'Mobile number, vehicle number and vehicle type. Nothing about the owner. The department '
       + 'should record that it is satisfied with this, since the data is collected on its behalf.',
    needed: 'Before go-live',
  },

  /* ── Information we need ──────────────────────────────────────────── */
  {
    group: 'information',
    kn: 'ವಾಟ್ಸ್ಆ್ಯಪ್ ಸಂಖ್ಯೆ',
    item: 'Which WhatsApp number the public will use',
    why: 'Ours is ready and working today. If the department would rather the number belong to it '
       + '— which is reasonable, and better in the long run — it needs a number that is not '
       + 'already on WhatsApp, and the registration takes a few days at Meta. Decide early; this '
       + 'is the longest lead time on the list.',
    needed: 'Four weeks before launch',
  },
  {
    group: 'information',
    kn: 'ಬ್ಯಾಂಕ್ ಖಾತೆ ವಿವರ',
    item: 'The department bank account for entry-fee settlement',
    why: 'Account name, number and IFSC, in a form the payment gateway can be given. Without it '
       + 'the split-at-the-gateway arrangement cannot be set up and the collect-and-transfer '
       + 'arrangement applies instead.',
    needed: 'Before go-live',
  },
  {
    group: 'information',
    kn: 'ಇತ್ಯರ್ಥದ ಅವಧಿ',
    item: 'How often the entry fee is to be settled',
    why: 'Daily, weekly or monthly, and against what statement. If the split arrangement is used '
       + 'this is automatic, and the question becomes only what reporting the treasury wants.',
    needed: 'Before go-live',
  },
  {
    group: 'information',
    kn: 'ಸಿಬ್ಬಂದಿ ಪಟ್ಟಿ',
    item: 'Names of checkpost staff and their shifts',
    why: 'Each person is issued their own PIN and every scan is recorded against them. We need '
       + 'names, how many gates operate, and the shift pattern.',
    needed: 'Before pilot',
  },
  {
    group: 'information',
    kn: 'ಅಧಿಕಾರಿಗಳ ಪಟ್ಟಿ',
    item: 'Officers who should have panel access, and at what level',
    why: 'Full access, view-everything-change-nothing, or reports only. Most officers should have '
       + 'the second.',
    needed: 'Before pilot',
  },
  {
    group: 'information',
    kn: 'ಸಂಪರ್ಕ ಅಧಿಕಾರಿ',
    item: 'A single named officer to deal with',
    why: 'One person to approve changes and to call when something needs deciding at 6 a.m. on a '
       + 'Sunday. Plus an emergency contact for closures.',
    needed: 'Immediately',
  },
  {
    group: 'information',
    kn: 'ದೂರುಗಳ ಮಾರ್ಗ',
    item: 'Where a visitor complaint should go',
    why: 'Support requests arrive in the same WhatsApp conversation. Anything the department '
       + 'should answer rather than us needs a route and a name.',
    needed: 'Before go-live',
  },

  /* ── Practical arrangements ───────────────────────────────────────── */
  {
    group: 'practical',
    kn: 'ಗೇಟ್ ಮೊಬೈಲ್ ಫೋನ್‌ಗಳು',
    item: 'Two Android phones at the gate, with a data connection',
    why: 'Ordinary handsets; no scanner hardware. A connection is wanted but not required — '
       + 'verification works offline. Who provides and pays for these should be agreed.',
    needed: 'Before pilot',
  },
  {
    group: 'practical',
    kn: 'ಸಿಬ್ಬಂದಿ ತರಬೇತಿಗೆ ಸಮಯ',
    item: 'A slot to train the checkpost staff on site',
    why: 'Half a day at the gate, before the pilot. It is short because the app does one thing.',
    needed: 'Before pilot',
  },
  {
    group: 'practical',
    kn: 'ಪ್ರಾಯೋಗಿಕ ಪರೀಕ್ಷೆಗೆ ಅನುಮತಿ',
    item: 'Permission for a live beta at the checkpost',
    why: 'A period — a week is enough — running alongside the present system on real vehicles, so '
       + 'the staff use it before it is the only thing there is. This is the single most useful '
       + 'thing the department can agree to.',
    needed: 'As early as possible',
  },
  {
    group: 'practical',
    kn: 'ಗೇಟ್‌ನಲ್ಲಿ ಫಲಕಗಳು',
    item: 'Signage at the gate and on the approach road',
    why: 'What the boards say, in Kannada and English, and who prints them. A poster at the '
       + 'gate lets someone who arrives without a ticket book one on the spot.',
    needed: 'At launch',
  },
  {
    group: 'practical',
    kn: 'ಪರಿಶೀಲನಾ ಅಳತೆಗಳು',
    item: 'What the pilot will be judged on after three months',
    why: 'Agreed in advance: tickets sold, altered tickets refused, time at the barrier, '
       + 'collections reconciled, complaints. If it fails on these, the department stops it.',
    needed: 'Before pilot',
  },
];

const GROUPS = {
  decision:    { kn: 'ಇಲಾಖೆಯ ನಿರ್ಧಾರಗಳು', en: 'Decisions for the department' },
  permission:  { kn: 'ಅನುಮತಿಗಳು', en: 'Permissions required' },
  information: { kn: 'ಬೇಕಾದ ಮಾಹಿತಿ', en: 'Information we need' },
  practical:   { kn: 'ಪ್ರಾಯೋಗಿಕ ವ್ಯವಸ್ಥೆಗಳು', en: 'Practical arrangements' },
};

const byGroup = (g) => REQUIREMENTS.filter((r) => r.group === g);

/** The two with the longest lead times, which is what a meeting should settle. */
const urgent = () => REQUIREMENTS.filter((r) =>
  /Immediately|Four weeks|As early/.test(r.needed));

module.exports = { REQUIREMENTS, GROUPS, byGroup, urgent };
