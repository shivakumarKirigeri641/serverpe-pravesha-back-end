/**
 * policy.js — the terms of use and privacy policy, in one place.
 *
 * Held as data rather than as a page so the same words can be served at
 * /policy, quoted in the WhatsApp consent step, and printed into a document
 * without three versions drifting apart. A policy that says one thing in the
 * chat and another on the website is worse than no policy at all.
 *
 * Two things are deliberately NOT said here, and both were asked for:
 *
 *   That this is a partnership with, or endorsed by, the tourism department.
 *   It is not, until something is signed — and the draft MoU expressly says no
 *   partnership is created. Claiming otherwise in public is a misrepresentation
 *   that would be quoted back at exactly the wrong moment.
 *
 *   That there are no refunds in any circumstance whatever. A blanket refusal
 *   is not enforceable where the failure is ours — payment taken, no valid
 *   ticket issued — and asserting it invites the one complaint that reaches a
 *   consumer forum. The refusal that IS defensible is narrower and is stated:
 *   no refund for a change of mind or a no-show.
 *
 * Everything else the proprietor asked for is here, phrased to hold up.
 */

/**
 * Each section carries Kannada first. The Kannada is the version most visitors
 * will read; the English is what a lawyer or an officer will read. They must
 * say the same thing — a mismatch between them is the defect that matters most
 * in this file, and it is the thing to check on the native-speaker review.
 */
const SECTIONS = [
  {
    id: 'what',
    kn: 'ಈ ಸೇವೆ ಏನು',
    en: 'What this service is',
    body_kn: 'ಇದು ವಾಟ್ಸ್ಆ್ಯಪ್ ಮೂಲಕ ಪ್ರವಾಸಿ ತಾಣಗಳಿಗೆ ವಾಹನ ಪ್ರವೇಶ ಟಿಕೆಟ್ ಕಾಯ್ದಿರಿಸುವ ಸೇವೆ. '
           + 'ಇದನ್ನು ಸರ್ವರ್‌ಪೇ ಆ್ಯಪ್ ಸೊಲ್ಯೂಷನ್ಸ್ ನಡೆಸುತ್ತದೆ.',
    body_en: 'A WhatsApp-based service for booking vehicle entry tickets to tourist places, '
           + 'operated by ServerPe App Solutions, a sole proprietorship registered in India.',
  },
  {
    id: 'fees',
    kn: 'ಶುಲ್ಕ ಯಾರು ನಿಗದಿಪಡಿಸುತ್ತಾರೆ',
    en: 'Who sets the fees',
    body_kn: 'ಪ್ರವೇಶ ಶುಲ್ಕವನ್ನು ಸಂಬಂಧಪಟ್ಟ ಇಲಾಖೆ ನಿಗದಿಪಡಿಸುತ್ತದೆ. ನಾವು ಅದನ್ನು ಅವರ ಪರವಾಗಿ '
           + 'ಸಂಗ್ರಹಿಸಿ ಪೂರ್ಣವಾಗಿ ಅವರಿಗೆ ಪಾವತಿಸುತ್ತೇವೆ. ಅದರ ಮೇಲೆ ನಾವು ಪ್ರತ್ಯೇಕ ಸೇವಾ ಮತ್ತು '
           + 'ಅನುಕೂಲ ಶುಲ್ಕ ವಿಧಿಸುತ್ತೇವೆ. ಇದನ್ನು ಪಾವತಿಸುವ ಮೊದಲೇ ಪ್ರತ್ಯೇಕವಾಗಿ ತೋರಿಸಲಾಗುತ್ತದೆ.',
    body_en: 'The entry fee is fixed by the department having charge of the site, not by us. We '
           + 'collect it as pure agent of that department and remit it in full, without '
           + 'deduction. Our own service and convenience fee is charged separately, is shown to '
           + 'you before you pay, and is printed separately on your ticket and receipt. It is '
           + 'not a charge of the department.',
  },
  {
    id: 'consent_wa',
    kn: 'ವಾಟ್ಸ್ಆ್ಯಪ್ ಸಂದೇಶಗಳಿಗೆ ಒಪ್ಪಿಗೆ',
    en: 'You agree to be contacted on WhatsApp',
    body_kn: 'ಈ ಸೇವೆಯನ್ನು ಬಳಸುವ ಮೂಲಕ, ನಿಮ್ಮ ಬುಕಿಂಗ್, ಟಿಕೆಟ್, ಪಾವತಿ ಮತ್ತು ತಾಣ ಮುಚ್ಚುವಿಕೆಯ '
           + 'ಬಗ್ಗೆ ವಾಟ್ಸ್ಆ್ಯಪ್‌ನಲ್ಲಿ ಸಂದೇಶ ಪಡೆಯಲು ನೀವು ಒಪ್ಪುತ್ತೀರಿ. ನಾವು ಜಾಹೀರಾತು ಸಂದೇಶ '
           + 'ಕಳುಹಿಸುವುದಿಲ್ಲ. "STOP" ಎಂದು ಕಳುಹಿಸಿ ನಿಲ್ಲಿಸಬಹುದು.',
    body_en: 'By using this service you agree to receive WhatsApp messages relating to your '
           + 'booking — the ticket itself, payment confirmation, reminders, and notice if the '
           + 'site closes. These are service messages, not marketing. We do not send '
           + 'promotional messages, and you may stop messages at any time by replying STOP, '
           + 'though we cannot then deliver a ticket you have paid for.',
  },
  {
    id: 'consent_rc',
    kn: 'ವಾಹನ ವಿವರ ಪರಿಶೀಲನೆಗೆ ಒಪ್ಪಿಗೆ',
    en: 'You permit us to look up the vehicle',
    body_kn: 'ನೀವು ನೀಡುವ ವಾಹನ ಸಂಖ್ಯೆಯನ್ನು ಬಳಸಿ, ಸರಿಯಾದ ಪ್ರವೇಶ ಶುಲ್ಕ ವಿಧಿಸಲು ವಾಹನದ ಪ್ರಕಾರವನ್ನು '
           + 'ಸರ್ಕಾರಿ ದಾಖಲೆಗಳಿಂದ ಪರಿಶೀಲಿಸಲು ನೀವು ಅನುಮತಿ ನೀಡುತ್ತೀರಿ. ಮಾಲೀಕರ ಹೆಸರು, ವಿಳಾಸ, ಚಾಸಿಸ್ '
           + 'ಅಥವಾ ಎಂಜಿನ್ ಸಂಖ್ಯೆಯನ್ನು ನಾವು ಸಂಗ್ರಹಿಸುವುದಿಲ್ಲ.',
    body_en: 'When you give us a registration number you permit us to check the vehicle '
           + 'category against government records, so that the correct entry fee is charged. '
           + 'We use the category only. We do not store the owner name, address, chassis '
           + 'number or engine number, and we do not use the lookup for any other purpose.',
  },
  {
    id: 'accuracy',
    kn: 'ವಾಹನ ಸಂಖ್ಯೆ ಸರಿಯಾಗಿರಬೇಕು',
    en: 'The registration number must be correct',
    body_kn: 'ಟಿಕೆಟ್ ನೀವು ನೀಡಿದ ವಾಹನ ಸಂಖ್ಯೆಗೆ ಮಾತ್ರ ಮಾನ್ಯ. ತಪ್ಪು ಸಂಖ್ಯೆ ನೀಡಿದರೆ ಗೇಟ್‌ನಲ್ಲಿ '
           + 'ಪ್ರವೇಶ ನಿರಾಕರಿಸಲಾಗುತ್ತದೆ ಮತ್ತು ಅದಕ್ಕೆ ಹಣ ಮರುಪಾವತಿ ಇಲ್ಲ. ಪಾವತಿಸುವ ಮೊದಲು '
           + 'ಪರಿಶೀಲಿಸಿಕೊಳ್ಳಿ.',
    body_en: 'The ticket is valid only for the registration number you entered, and that number '
           + 'is sealed inside the ticket. If you enter it wrongly, entry will be refused at the '
           + 'barrier and no refund is due. Please check it before paying. It is your '
           + 'responsibility to book for a vehicle you are entitled to bring.',
  },
  {
    id: 'one_ticket',
    kn: 'ಒಂದು ವಾಹನ, ಒಂದು ಟಿಕೆಟ್',
    en: 'One vehicle, one ticket, not transferable',
    body_kn: 'ಒಂದು ವಾಹನಕ್ಕೆ ಒಂದು ದಿನಕ್ಕೆ ಒಂದೇ ಟಿಕೆಟ್. ಟಿಕೆಟ್ ವರ್ಗಾವಣೆ ಮಾಡಲಾಗದು ಮತ್ತು ಮಾರಾಟ '
           + 'ಮಾಡಲಾಗದು. ಒಂದೇ ಟಿಕೆಟ್ ಎರಡನೇ ಬಾರಿ ಬಳಸಲು ಪ್ರಯತ್ನಿಸಿದರೆ ತಿರಸ್ಕರಿಸಲಾಗುತ್ತದೆ.',
    body_en: 'One ticket admits one vehicle, once, on the date and in the time slot shown. A '
           + 'ticket may not be transferred, resold or shared. Presenting the same ticket a '
           + 'second time will be refused and recorded. Reselling a ticket, or presenting one '
           + 'that has been altered, may be reported to the authorities.',
  },
  {
    id: 'entry',
    kn: 'ಪ್ರವೇಶದ ಅಂತಿಮ ನಿರ್ಧಾರ ಗೇಟ್‌ನಲ್ಲಿ',
    en: 'Entry is decided at the gate, not by us',
    body_kn: 'ಟಿಕೆಟ್ ಇದ್ದರೂ ಪ್ರವೇಶವನ್ನು ಖಾತರಿಪಡಿಸಲಾಗುವುದಿಲ್ಲ. ಹವಾಮಾನ, ಸುರಕ್ಷತೆ, ಪೊಲೀಸ್ ಅಥವಾ '
           + 'ಇಲಾಖೆಯ ಆದೇಶದ ಕಾರಣ ಪ್ರವೇಶ ನಿರಾಕರಿಸಬಹುದು. ತಾಣದಲ್ಲಿ ಅಧಿಕಾರಿಗಳ ನಿರ್ಧಾರವೇ ಅಂತಿಮ.',
    body_en: 'A ticket is permission to be admitted, not a guarantee of entry. Entry may be '
           + 'refused or the site closed for weather, road conditions, safety, police or '
           + 'departmental orders. The decision of the officers at the site is final. We do not '
           + 'control access to the site and are not responsible for a refusal made by them.',
  },
  {
    id: 'change',
    kn: 'ದಿನಾಂಕ ಬದಲಾವಣೆ',
    en: 'Changing your date',
    body_kn: 'ಟಿಕೆಟ್ ಬುಕ್ ಆದ ನಂತರ ರದ್ದುಪಡಿಸಲಾಗದು. ಆದರೆ ಸ್ಥಳ ಲಭ್ಯವಿದ್ದರೆ, ಪ್ರಯಾಣದ ದಿನಾಂಕದ '
           + 'ಮೊದಲು ಒಮ್ಮೆ ದಿನಾಂಕವನ್ನು ಉಚಿತವಾಗಿ ಬದಲಾಯಿಸಬಹುದು. ಬದಲಾಯಿಸಿದ ನಂತರ ಹಳೆಯ ಟಿಕೆಟ್ '
           + 'ತಾನಾಗಿಯೇ ಅಮಾನ್ಯವಾಗುತ್ತದೆ.',
    body_en: 'A booking cannot be cancelled. It can, however, be moved: you may change the date '
           + 'once, free of charge, before your travel date, subject to places being available '
           + 'on the new date. The booking simply carries the new date from then on. The '
           + 'number of free changes is set by the department and may change.',
  },
  {
    id: 'refunds',
    kn: 'ಹಣ ಮರುಪಾವತಿ',
    en: 'Refunds',
    body_kn: 'ಮನಸ್ಸು ಬದಲಾದರೆ, ಬಾರದಿದ್ದರೆ, ತಡವಾಗಿ ಬಂದರೆ ಅಥವಾ ತಪ್ಪಾಗಿ ಬುಕ್ ಮಾಡಿದರೆ ಹಣ ಮರುಪಾವತಿ '
           + 'ಇಲ್ಲ. ಬದಲಿಗೆ ದಿನಾಂಕ ಬದಲಾವಣೆಯ ಆಯ್ಕೆ ಇದೆ. ಪ್ರಾಧಿಕಾರದ ಆದೇಶದಿಂದ ತಾಣ ಮುಚ್ಚಿದಾಗ, ಅಥವಾ '
           + 'ಪಾವತಿಯಾದರೂ ಮಾನ್ಯ ಟಿಕೆಟ್ ದೊರೆಯದಿದ್ದಾಗ ಮಾತ್ರ ಮರುಪಾವತಿ ಪರಿಗಣಿಸಲಾಗುತ್ತದೆ. ಸೇವಾ '
           + 'ಶುಲ್ಕ ಮರುಪಾವತಿಯಾಗುವುದಿಲ್ಲ.',
    body_en: 'No refund is due for a change of mind, a no-show, late arrival, an incorrect '
           + 'booking, or a refusal at the gate caused by something you did. Postponement is '
           + 'offered instead. A refund will be considered only where the site is closed by '
           + 'order of the authorities and the booking cannot be moved, or where payment '
           + 'succeeded but no valid ticket was issued to you. The service and convenience fee '
           + 'is not refundable, because the service it pays for has been performed. Approved '
           + 'refunds are returned to the original payment method within 5 to 7 working days.',
  },
  {
    id: 'payment',
    kn: 'ಪಾವತಿ',
    en: 'Payment',
    body_kn: 'ಪಾವತಿಯನ್ನು ನೋಂದಾಯಿತ ಪಾವತಿ ಗೇಟ್‌ವೇ ಮೂಲಕ ಸ್ವೀಕರಿಸಲಾಗುತ್ತದೆ. ನಿಮ್ಮ ಕಾರ್ಡ್ ಅಥವಾ '
           + 'ಬ್ಯಾಂಕ್ ವಿವರಗಳನ್ನು ನಾವು ನೋಡುವುದಿಲ್ಲ, ಸಂಗ್ರಹಿಸುವುದಿಲ್ಲ. ಪಾವತಿ ಪೂರ್ಣಗೊಂಡ ನಂತರವೇ '
           + 'ಟಿಕೆಟ್ ದೊರೆಯುತ್ತದೆ.',
    body_en: 'Payments are taken through a licensed payment gateway. We never see or store your '
           + 'card, UPI or bank details. Your place is held only briefly while payment is in '
           + 'progress; if payment does not complete, the place is released. If money leaves '
           + 'your account and no ticket arrives, contact us and we will resolve it.',
  },
  {
    id: 'data',
    kn: 'ನಿಮ್ಮ ಮಾಹಿತಿ',
    en: 'Your data',
    body_kn: 'ನಾವು ಸಂಗ್ರಹಿಸುವುದು: ನಿಮ್ಮ ಮೊಬೈಲ್ ಸಂಖ್ಯೆ, ವಾಹನ ಸಂಖ್ಯೆ, ವಾಹನದ ಪ್ರಕಾರ, ನಿಮ್ಮ ಟಿಕೆಟ್ '
           + 'ಮತ್ತು ಪಾವತಿಯ ಉಲ್ಲೇಖ. ನಿಮ್ಮ ಸಂಖ್ಯೆಯನ್ನು ನಾವು ಯಾರಿಗೂ ಮಾರುವುದಿಲ್ಲ, ಹಂಚುವುದಿಲ್ಲ. '
           + 'ಬುಕಿಂಗ್ ವಿವರಗಳು ಸಂಬಂಧಪಟ್ಟ ಇಲಾಖೆಗೆ ಕಾಣುತ್ತವೆ.',
    body_en: 'We collect your mobile number, the registration number and category of your '
           + 'vehicle, your ticket and a payment reference. We use them to issue and verify '
           + 'your ticket and to answer your questions. We do not sell or share your number, '
           + 'and we do not send marketing. Booking and scan records are visible to the '
           + 'department having charge of the site, which owns those records. We keep data as '
           + 'long as the law and the department require, and you may ask us to delete what is '
           + 'not required to be kept. Processing is on the basis of your consent, which you '
           + 'may withdraw by writing to us.',
  },
  {
    id: 'conduct',
    kn: 'ದುರುಪಯೋಗ',
    en: 'Misuse',
    body_kn: 'ಟಿಕೆಟ್ ಅಥವಾ ಕ್ಯೂಆರ್ ಕೋಡ್ ತಿದ್ದುವುದು, ನಕಲಿ ಮಾಡುವುದು, ಮಾರಾಟ ಮಾಡುವುದು, ಸುಳ್ಳು ವಾಹನ '
           + 'ಸಂಖ್ಯೆ ನೀಡುವುದು ಅಥವಾ ವ್ಯವಸ್ಥೆಯನ್ನು ಸ್ವಯಂಚಾಲಿತವಾಗಿ ಬಳಸುವುದು ನಿಷೇಧಿಸಲಾಗಿದೆ. ಇಂತಹ '
           + 'ಸಂದರ್ಭದಲ್ಲಿ ಟಿಕೆಟ್ ರದ್ದುಗೊಳಿಸಿ, ಹಣ ಮರುಪಾವತಿ ಮಾಡದೆ, ಅಧಿಕಾರಿಗಳಿಗೆ ವರದಿ ಮಾಡಬಹುದು.',
    body_en: 'You must not resell a ticket, give a registration '
           + 'number that is not the vehicle you will bring, book on behalf of others for '
           + 'payment, or use automated means to make bookings or hold places. We may cancel '
           + 'tickets without refund, refuse further bookings from a number, and report the '
           + 'matter to the police or the department.',
  },
  {
    id: 'availability',
    kn: 'ಸೇವೆಯ ಲಭ್ಯತೆ',
    en: 'Availability of the service',
    body_kn: 'ಈ ಸೇವೆ ಯಾವಾಗಲೂ ಲಭ್ಯವಿರುತ್ತದೆ ಎಂದು ನಾವು ಖಾತರಿ ನೀಡುವುದಿಲ್ಲ. ವಾಟ್ಸ್ಆ್ಯಪ್, ಪಾವತಿ '
           + 'ಗೇಟ್‌ವೇ, ಇಂಟರ್ನೆಟ್ ಅಥವಾ ಸರ್ಕಾರಿ ವ್ಯವಸ್ಥೆಗಳ ತೊಂದರೆಗೆ ನಾವು ಜವಾಬ್ದಾರರಲ್ಲ.',
    body_en: 'We do not guarantee uninterrupted availability. The service depends on WhatsApp, '
           + 'the payment gateway, mobile networks and government systems, none of which we '
           + 'control. We are not liable for their failure, but we will not keep money for a '
           + 'ticket we did not deliver.',
  },
  {
    id: 'liability',
    kn: 'ಹೊಣೆಗಾರಿಕೆಯ ಮಿತಿ',
    en: 'Limitation of liability',
    body_kn: 'ಪ್ರಯಾಣ, ವಸತಿ, ಸಮಯ ನಷ್ಟ, ಅಥವಾ ತಾಣದಲ್ಲಿ ಸಂಭವಿಸುವ ಯಾವುದೇ ಘಟನೆಗೆ ನಾವು ಜವಾಬ್ದಾರರಲ್ಲ. '
           + 'ನಮ್ಮ ಗರಿಷ್ಠ ಹೊಣೆಗಾರಿಕೆ ನೀವು ಆ ಬುಕಿಂಗ್‌ಗೆ ಪಾವತಿಸಿದ ಮೊತ್ತಕ್ಕೆ ಸೀಮಿತ.',
    body_en: 'We are not liable for travel or accommodation costs, lost time, or anything that '
           + 'happens to you at the site — your safety there, and your compliance with the '
           + 'rules of the site, are your own responsibility and that of the authorities in '
           + 'charge. To the extent permitted by law, our total liability for any claim is '
           + 'limited to the amount you paid for that booking. Nothing here excludes liability '
           + 'that cannot lawfully be excluded.',
  },
  {
    id: 'ip',
    kn: 'ಸ್ವಾಮ್ಯ',
    en: 'Ownership',
    body_kn: 'ಈ ವ್ಯವಸ್ಥೆ, ತಂತ್ರಾಂಶ, ವಿನ್ಯಾಸ ಮತ್ತು ಬ್ರಾಂಡ್ ಸರ್ವರ್‌ಪೇ ಆ್ಯಪ್ ಸೊಲ್ಯೂಷನ್ಸ್‌ಗೆ ಸೇರಿದೆ. '
           + 'ಎಲ್ಲ ಹಕ್ಕುಗಳನ್ನು ಕಾಯ್ದಿರಿಸಲಾಗಿದೆ.',
    body_en: 'The system, its software, design and branding belong to ServerPe App Solutions. '
           + 'All rights reserved. Booking and scan data belongs to the department having charge '
           + 'of the site. Departmental names and emblems appearing on a ticket remain the '
           + 'property of that department and are used only to identify the site.',
  },
  {
    id: 'changes',
    kn: 'ನಿಯಮಗಳ ಬದಲಾವಣೆ',
    en: 'Changes to these terms',
    body_kn: 'ಈ ನಿಯಮಗಳನ್ನು ನಾವು ಬದಲಾಯಿಸಬಹುದು. ಬುಕಿಂಗ್ ಮಾಡುವ ದಿನದಂದು ಪ್ರಕಟವಾಗಿರುವ ನಿಯಮಗಳು '
           + 'ನಿಮ್ಮ ಬುಕಿಂಗ್‌ಗೆ ಅನ್ವಯಿಸುತ್ತವೆ.',
    body_en: 'We may change these terms. The version published on the day you book is the '
           + 'version that applies to that booking.',
  },
  {
    id: 'law',
    kn: 'ಅನ್ವಯವಾಗುವ ಕಾನೂನು',
    en: 'Governing law',
    body_kn: 'ಈ ನಿಯಮಗಳಿಗೆ ಭಾರತದ ಕಾನೂನು ಅನ್ವಯಿಸುತ್ತದೆ. ವಿವಾದಗಳು ಬೆಂಗಳೂರು ನ್ಯಾಯಾಲಯಗಳ '
           + 'ವ್ಯಾಪ್ತಿಗೆ ಒಳಪಡುತ್ತವೆ.',
    body_en: 'These terms are governed by the laws of India, and disputes are subject to the '
           + 'courts at Bengaluru, Karnataka.',
  },
];

/** The short version, sent inside the WhatsApp consent step. */
const SHORT_KN = 'ನಿಮ್ಮ ಮೊಬೈಲ್ ಸಂಖ್ಯೆ, ವಾಹನ ಸಂಖ್ಯೆ ಮತ್ತು ಟಿಕೆಟ್ ಅನ್ನು ನಾವು ಸಂಗ್ರಹಿಸುತ್ತೇವೆ. '
  + 'ಸರಿಯಾದ ಶುಲ್ಕ ವಿಧಿಸಲು ವಾಹನದ ಪ್ರಕಾರವನ್ನು ಸರ್ಕಾರಿ ದಾಖಲೆಯಿಂದ ಪರಿಶೀಲಿಸುತ್ತೇವೆ. ಮಾಲೀಕರ ಹೆಸರು, '
  + 'ವಿಳಾಸ, ಚಾಸಿಸ್ ಅಥವಾ ಎಂಜಿನ್ ಸಂಖ್ಯೆ ಸಂಗ್ರಹಿಸುವುದಿಲ್ಲ. ನಿಮ್ಮ ಸಂಖ್ಯೆಯನ್ನು ಯಾರೊಂದಿಗೂ '
  + 'ಹಂಚಿಕೊಳ್ಳುವುದಿಲ್ಲ.';

const SHORT_EN = 'We store your mobile number, your vehicle number and your ticket. We look up '
  + 'the vehicle type from government records to charge the right entry fee. We do not store the '
  + 'owner name, address, chassis or engine number. We do not share your number with anyone, and '
  + 'we never message you unless you message us first. Bookings cannot be cancelled, but the date '
  + 'can be changed once, free.';

/**
 * The date this text last changed, stamped on every acceptance.
 *
 * The terms above promise that the version published on the day of booking is
 * the one that governs it. That promise is only keepable if each acceptance
 * records WHICH version was on the screen — otherwise, once the fee or the
 * postponement rule is edited, there is no way to show what a visitor actually
 * agreed to in a dispute, and the department has to take our word for it.
 *
 * BUMP THIS whenever SECTIONS, SHORT_KN or SHORT_EN change in substance. A
 * typo fix does not need it; a changed rule does.
 */
const VERSION = '2026-09-10';

module.exports = { SECTIONS, SHORT_KN, SHORT_EN, VERSION };
