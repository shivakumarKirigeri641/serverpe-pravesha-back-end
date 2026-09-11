/**
 * roadmap.js — what comes after the first season, and why it is not in it.
 *
 * Two kinds of thing, kept apart on purpose:
 *
 *   ENHANCEMENTS cost the visitor nothing and earn us nothing. They exist
 *   because the first season will show where the friction is, and each one
 *   removes a specific complaint the department would otherwise field.
 *
 *   REVENUE FEATURES charge somebody for something. Every one of them needs the
 *   department's approval before it can exist, and each is listed with what it
 *   would charge and what it would take to run — because a roadmap that shows
 *   only upside is a sales document, not a plan.
 *
 * Nothing here is promised for the first season. A proposal that commits to a
 * waitlist before the gate has admitted its first vehicle is a proposal that
 * will be quoted back when the waitlist slips.
 */

const ENHANCEMENTS = [
  {
    kn: 'ಟಿಕೆಟ್ ದಿನಾಂಕ ಬದಲಾವಣೆ — ಒಮ್ಮೆ ಮಾತ್ರ',
    title: 'Postpone a ticket, once',
    status: 'built',
    what: 'A visitor whose plans change moves the ticket to another day themselves, in the same '
        + 'WhatsApp conversation, at no cost. The booking simply carries the new date and a new '
        + 'is issued.',
    why: 'Without it every change of plan is either a refund or a wasted place. One free move '
        + 'is the limit the department has asked for — enough for a genuine change, not enough '
        + 'to hold a place indefinitely.',
    needs: 'Already working. The limit is a setting, not a code change.',
  },
  {
    kn: 'ವಾಹನ ಬದಲಾವಣೆ — ನಿಯಂತ್ರಿತ, ಒಮ್ಮೆ ಮಾತ್ರ',
    title: 'Change the vehicle, once, up to 24 hours before',
    status: 'planned',
    what: 'The family car goes to the garage and they take the other one. Today that means the '
        + 'ticket is unusable, because the registration number is sealed inside the signature. '
        + 'The change would re-issue the ticket against the new vehicle and invalidate the old '
        + 'code — the same mechanism postponement already uses.',
    why: 'It is the commonest reason a genuine visitor arrives with a ticket the gate must '
        + 'refuse, and refusing a genuine visitor is the failure that damages the system\'s '
        + 'reputation fastest.',
    needs: 'Locked 24 hours before the slot opens, once per ticket, and the new vehicle must '
         + 'not already hold a ticket for that date. The window is what stops it becoming a way '
         + 'to sell a ticket on at the barrier.',
  },
  {
    kn: 'ಹಣ ಮರುಪಾವತಿ — ಅಧಿಕಾರಿಗಳ ಅನುಮೋದನೆಯಿಂದ ಮಾತ್ರ',
    title: 'Refund, from the panel only',
    status: 'planned',
    what: 'A refund raised by the department or by ServerPe from the admin panel, with the '
        + 'reason recorded. Never a button the visitor can press.',
    why: 'Postponement answers almost every case, but not the visitor who refuses one — a '
       + 'closure over a date they cannot travel again, or a payment taken where no ticket '
       + 'issued. Today there is no mechanism at all, and a system with no answer to that is a '
       + 'system that ends up arguing at the barrier.',
    needs: 'The entry fee has already been remitted to the department in full by the time a '
         + 'refund is asked for. ServerPe therefore returns it from its own funds and recovers '
         + 'it in a later settlement, so the department is never asked for money back. Kept out '
         + 'of the visitor\'s hands deliberately: a self-service refund turns every change of '
         + 'mind into a gateway charge and a freed place nobody can resell in time.',
  },
  {
    kn: 'ಕಾಯುವ ಪಟ್ಟಿ',
    title: 'Waitlist on a full slot',
    status: 'planned',
    what: 'When a slot is full, a visitor may join a waitlist instead of being turned away. If '
        + 'somebody postpones out of that slot, the next person on the list is offered the place '
        + 'for a short window and books in the same conversation.',
    why: 'A place freed by a postponement is currently silently resold to whoever happens to '
       + 'look next. A waitlist turns that into an orderly queue and recovers demand the site '
       + 'is losing today.',
    needs: 'A holding window — an offer that never expires blocks the place as effectively as a '
         + 'booking. Places are released by postponement, which is the only thing that frees '
         + 'one under the present arrangement.',
  },
];

const REVENUE = [
  {
    kn: 'ತತ್ಕಾಲ್ / ಸ್ಥಳದಲ್ಲೇ ಬುಕಿಂಗ್ ಶುಲ್ಕ',
    title: 'Tatkal and at-the-gate booking',
    what: 'A visitor who arrives without a ticket scans a poster at the barrier and books on the '
        + 'spot, against a small reserved allocation held back from each slot. Charged at a '
        + 'higher service fee than an advance booking.',
    why: 'Somebody who has driven three hours is turned away today. This admits them, at a fee '
       + 'that reflects the place being held in reserve for exactly that case.',
    upside: 'A reserved allocation of even a few per cent, sold at a premium, on the days that '
          + 'fill.',
    caution: 'The allocation must be small and published, or it becomes a way to sell around the '
           + 'capacity limit the system exists to enforce.',
  },
  {
    kn: 'ಎರಡನೇ ಬಾರಿಯ ದಿನಾಂಕ ಬದಲಾವಣೆಗೆ ಶುಲ್ಕ',
    title: 'A fee on the second and later postponement',
    what: 'The first move stays free. A second or third change of date carries a small '
        + 'rescheduling fee.',
    why: 'A ticket walked around the calendar holds a place it never intends to use. A small fee '
       + 'is a fairer answer than refusing outright, and it prices the place being held.',
    upside: 'Modest in rupees; its real value is that it stops the behaviour.',
    caution: 'The first move must remain free, or the enhancement above becomes a charge and the '
           + 'department is answering complaints about it.',
  },
  {
    kn: 'ಹಬ್ಬ ಮತ್ತು ದಟ್ಟಣೆಯ ದಿನಗಳಿಗೆ ಆದ್ಯತಾ ಶುಲ್ಕ',
    title: 'Priority allocation on festival and peak days',
    what: 'On days the department designates as peak — a long weekend, a festival — a portion of '
        + 'each slot is offered at a higher service fee, with the ordinary allocation unchanged '
        + 'and unchanged in price.',
    why: 'Those are the days that fill within hours of opening and the days visitors travel '
       + 'furthest for. The entry fee itself does not change; only the convenience fee does.',
    upside: 'The largest of the three, because it applies precisely when demand exceeds supply.',
    caution: 'Requires the department to designate the days, and the ordinary allocation must '
           + 'stay untouched. Anything else reads as pricing the public out of a public place.',
  },
];

module.exports = { ENHANCEMENTS, REVENUE };
