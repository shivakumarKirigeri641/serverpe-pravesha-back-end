/**
 * pdf/passPdf.js — the entry pass, in the visitor's language.
 *
 * What a visitor might show at a barrier, and what they keep afterwards. It has
 * to answer three questions at a glance, in this order: is it valid, for which
 * vehicle, for when. Everything else — the payment, the timestamps — sits below
 * for the one time somebody needs it.
 *
 * ENGLISH OR KANNADA, AS CHOSEN IN THE CHAT. A visitor who reads Kannada gets a
 * Kannada pass: labels, place names, dates, slots and the notes. Identifiers —
 * the plate, the pass number, payment ids — and the maker's own model names stay
 * as written, because that is how they appear on the vehicle and at the gate.
 *
 * THE QR IS INFORMATION ONLY. It plays no part in entry: staff read the number
 * plate and record the entry, and nobody at the gate scans anything. Migration
 * 016 removed a signed QR for exactly that reason. This one links to the pass's
 * details page, read live from the database. There is nothing in it to forge,
 * and a pass whose phone has died is still a pass.
 */

const QRCode = require('qrcode');
const { details } = require('../gatepass/vehicle');
const slotTime = require('../gatepass/slotTime');
const L = require('../localize');
const {
  C, newDoc, toBuffer, header, footer, kvTable, noteBox, noteHeight, rupee, maskMobile,
} = require('./common');

const TYPE = { BIKE: 'Bike', CAR: 'Car', TOOFAN: 'Toofan', TT: 'Tempo Traveller (TT)' };

const METHOD = {
  en: { upi: 'UPI', card: 'Card', netbanking: 'Net banking', wallet: 'Wallet', emi: 'EMI',
    cardless_emi: 'Cardless EMI', paylater: 'Pay later', bank_transfer: 'Bank transfer', online: 'Online (Razorpay)' },
  kn: { upi: 'UPI', card: 'ಕಾರ್ಡ್', netbanking: 'ನೆಟ್ ಬ್ಯಾಂಕಿಂಗ್', wallet: 'ವಾಲೆಟ್', emi: 'EMI',
    cardless_emi: 'ಕಾರ್ಡ್‌ರಹಿತ EMI', paylater: 'ನಂತರ ಪಾವತಿ', bank_transfer: 'ಬ್ಯಾಂಕ್ ವರ್ಗಾವಣೆ', online: 'ಆನ್‌ಲೈನ್ (Razorpay)' },
};

/* Every word on the pass. The rules match the booking form's four, word for word. */
const LBL = {
  en: {
    dept: 'Department of Tourism, Government of Karnataka',
    title: 'ENTRY PASS',
    chip: { paid: 'PAID · VALID', used: 'USED' },
    passNumber: 'PASS NUMBER', vehicleNumber: 'VEHICLE NUMBER', validFor: 'VALID FOR',
    lastEntry: 'Last entry', scan: 'Scan for pass details',
    secVehicle: 'Vehicle details', secVisit: 'Visit details', secVisitor: 'Visitor & pass details',
    secPayment: 'Payment details', secTrack: 'Date & time track',
    vehicleNo: 'Vehicle number', maker: 'Manufacturer', model: 'Model', variant: 'Variant', type: 'Vehicle type',
    destination: 'Destination', district: 'District', date: 'Date of visit', slot: 'Time slot',
    name: 'Name', whatsapp: 'WhatsApp number', passNo: 'Pass number', reference: 'Booking reference', passStatus: 'Pass status',
    entryFee: 'Entry fee', platformFee: (g) => `Platform fee (incl. ${g}% GST)`, totalPaid: 'Total paid',
    method: 'Payment method', payStatus: 'Payment status', paid: 'Successful', paymentId: 'Payment ID',
    booked: 'Booking started', initiated: 'Payment initiated', confirmed: 'Payment confirmed', issued: 'Pass issued',
    checkpost: 'At the checkpost',
    checkpostLines: [
      'No printout or phone needed at the gate — just drive up to the checkpost.',
      'Checkpost staff will read your vehicle number and record your entry digitally.',
      'Please arrive within your time slot. Last entry is one hour before the slot ends.',
    ],
    note: 'Please note',
    rules: [
      'The pass is valid only for the vehicle number shown. Changing the vehicle at the checkpost is not allowed.',
      'Vehicles without a clear, readable number plate will not be allowed entry.',
      'One pass per vehicle for a date and slot. Repeat or duplicate bookings will be cancelled.',
      'Editing, copying or reselling a pass is illegal. Legal action will be taken against the vehicle and its owner.',
    ],
    generated: (at) => `Generated on ${at}`,
    pageOf: (i, n) => `Page ${i} of ${n}`,
    product: (s) => `Pravesha is a product of ServerPe App Solutions — ${s.vendorTagline} (${s.website})`,
    heading: (s) => `Pravesha — ${s.productTagline}`,
  },
  kn: {
    dept: 'ಪ್ರವಾಸೋದ್ಯಮ ಇಲಾಖೆ, ಕರ್ನಾಟಕ ಸರ್ಕಾರ',
    title: 'ಪ್ರವೇಶ ಪಾಸ್',
    chip: { paid: 'ಪಾವತಿಸಲಾಗಿದೆ · ಮಾನ್ಯ', used: 'ಬಳಸಲಾಗಿದೆ' },
    passNumber: 'ಪಾಸ್ ಸಂಖ್ಯೆ', vehicleNumber: 'ವಾಹನ ಸಂಖ್ಯೆ', validFor: 'ಮಾನ್ಯತೆ',
    lastEntry: 'ಕೊನೆಯ ಪ್ರವೇಶ', scan: 'ಪಾಸ್ ವಿವರಗಳಿಗೆ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ',
    secVehicle: 'ವಾಹನದ ವಿವರಗಳು', secVisit: 'ಭೇಟಿಯ ವಿವರಗಳು', secVisitor: 'ಸಂದರ್ಶಕ ಮತ್ತು ಪಾಸ್ ವಿವರಗಳು',
    secPayment: 'ಪಾವತಿ ವಿವರಗಳು', secTrack: 'ದಿನಾಂಕ ಮತ್ತು ಸಮಯದ ದಾಖಲೆ',
    vehicleNo: 'ವಾಹನ ಸಂಖ್ಯೆ', maker: 'ತಯಾರಕರು', model: 'ಮಾದರಿ', variant: 'ಆವೃತ್ತಿ', type: 'ವಾಹನದ ಪ್ರಕಾರ',
    destination: 'ಸ್ಥಳ', district: 'ಜಿಲ್ಲೆ', date: 'ಭೇಟಿಯ ದಿನಾಂಕ', slot: 'ಸಮಯದ ಸ್ಲಾಟ್',
    name: 'ಹೆಸರು', whatsapp: 'ವಾಟ್ಸ್‌ಆ್ಯಪ್ ಸಂಖ್ಯೆ', passNo: 'ಪಾಸ್ ಸಂಖ್ಯೆ', reference: 'ಬುಕಿಂಗ್ ಉಲ್ಲೇಖ', passStatus: 'ಪಾಸ್ ಸ್ಥಿತಿ',
    entryFee: 'ಪ್ರವೇಶ ಶುಲ್ಕ', platformFee: (g) => `ಪ್ಲಾಟ್‌ಫಾರ್ಮ್ ಶುಲ್ಕ (${g}% ಜಿಎಸ್‌ಟಿ ಸೇರಿ)`, totalPaid: 'ಒಟ್ಟು ಪಾವತಿ',
    method: 'ಪಾವತಿ ವಿಧಾನ', payStatus: 'ಪಾವತಿ ಸ್ಥಿತಿ', paid: 'ಯಶಸ್ವಿ', paymentId: 'ಪಾವತಿ ಐಡಿ',
    booked: 'ಬುಕಿಂಗ್ ಆರಂಭ', initiated: 'ಪಾವತಿ ಆರಂಭ', confirmed: 'ಪಾವತಿ ದೃಢೀಕರಣ', issued: 'ಪಾಸ್ ನೀಡಲಾಗಿದೆ',
    checkpost: 'ಚೆಕ್‌ಪೋಸ್ಟ್‌ನಲ್ಲಿ',
    checkpostLines: [
      'ಗೇಟ್‌ನಲ್ಲಿ ಮುದ್ರಿತ ಪ್ರತಿ ಅಥವಾ ಫೋನ್ ಬೇಕಿಲ್ಲ — ನೇರವಾಗಿ ಚೆಕ್‌ಪೋಸ್ಟ್‌ಗೆ ಬನ್ನಿ.',
      'ಚೆಕ್‌ಪೋಸ್ಟ್ ಸಿಬ್ಬಂದಿ ನಿಮ್ಮ ವಾಹನ ಸಂಖ್ಯೆಯನ್ನು ನೋಡಿ ಪ್ರವೇಶವನ್ನು ಡಿಜಿಟಲ್ ಆಗಿ ದಾಖಲಿಸುತ್ತಾರೆ.',
      'ನಿಮ್ಮ ಸಮಯದ ಸ್ಲಾಟ್‌ನೊಳಗೆ ಬನ್ನಿ. ಸ್ಲಾಟ್ ಮುಗಿಯುವ ಒಂದು ಗಂಟೆ ಮೊದಲು ಕೊನೆಯ ಪ್ರವೇಶ.',
    ],
    note: 'ದಯವಿಟ್ಟು ಗಮನಿಸಿ',
    rules: [
      'ಪಾಸ್ ಇಲ್ಲಿ ತೋರಿಸಿರುವ ವಾಹನ ಸಂಖ್ಯೆಗೆ ಮಾತ್ರ ಮಾನ್ಯ. ಚೆಕ್‌ಪೋಸ್ಟ್‌ನಲ್ಲಿ ವಾಹನ ಬದಲಾಯಿಸಲು ಅವಕಾಶವಿಲ್ಲ.',
      'ಸ್ಪಷ್ಟವಾಗಿ ಓದಬಹುದಾದ ನಂಬರ್ ಪ್ಲೇಟ್ ಇಲ್ಲದ ವಾಹನಗಳಿಗೆ ಪ್ರವೇಶವಿಲ್ಲ.',
      'ಒಂದು ದಿನಾಂಕ ಮತ್ತು ಸ್ಲಾಟ್‌ಗೆ ಒಂದು ವಾಹನಕ್ಕೆ ಒಂದೇ ಪಾಸ್. ಪುನರಾವರ್ತಿತ ಅಥವಾ ನಕಲಿ ಬುಕಿಂಗ್‌ಗಳನ್ನು ರದ್ದುಗೊಳಿಸಲಾಗುತ್ತದೆ.',
      'ಪಾಸ್ ಅನ್ನು ತಿದ್ದುವುದು, ನಕಲಿಸುವುದು ಅಥವಾ ಮರುಮಾರಾಟ ಮಾಡುವುದು ಕಾನೂನುಬಾಹಿರ. ವಾಹನ ಮತ್ತು ಅದರ ಮಾಲೀಕರ ವಿರುದ್ಧ ಕಾನೂನು ಕ್ರಮ ಕೈಗೊಳ್ಳಲಾಗುವುದು.',
    ],
    generated: (at) => `ರಚಿಸಿದ ಸಮಯ: ${at}`,
    pageOf: (i, n) => `ಪುಟ ${i} / ${n}`,
    product: (s) => `ಪ್ರವೇಶ, ಸರ್ವರ್‌ಪೇ ಆ್ಯಪ್ ಸೊಲ್ಯೂಷನ್ಸ್‌ನ ಉತ್ಪನ್ನ — ${s.vendorTagline} (${s.website})`,
    heading: (s) => `ಪ್ರವೇಶ — ${s.productTaglineKn || s.productTagline}`,
  },
};

/* Kept for callers that read them directly. */
const CHECKPOST_LINES = LBL.en.checkpostLines;
const RULES = LBL.en.rules;

/** How the payment was made, in words, from whatever Razorpay told us. */
function paymentMethod(raw, lang = 'en') {
  const M = METHOD[lang === 'kn' ? 'kn' : 'en'];
  const g = (raw && (raw.entity || raw.gateway)) || {};
  if (!g.method) return M.online;
  if (g.method === 'upi' && g.vpa) return `UPI · ${g.vpa}`;
  if (g.method === 'card' && g.card) return `${M.card} · ${g.card.network || ''} •••• ${g.card.last4 || ''}`.trim();
  if (g.method === 'netbanking' && g.bank) return `${M.netbanking} · ${g.bank}`;
  if (g.method === 'wallet' && g.wallet) return `${M.wallet} · ${g.wallet}`;
  return M[g.method] || String(g.method).toUpperCase();
}

async function render(t, { settings, verifyUrl, generatedAt = new Date(), lang = 'en' }) {
  const lg = lang === 'kn' ? 'kn' : 'en';
  const X = LBL[lg];
  const doc = newDoc({ title: `Pravesha entry pass ${t.ticket_no}`, subject: 'Entry pass' });
  const W = doc.page.width;
  const M = doc.page.margins.left;
  const inner = W - 2 * M;

  const chip = t.status === 'used' ? X.chip.used : X.chip.paid;
  let y = header(doc, { heading: X.heading(settings), dept: X.dept, title: X.title, chip });

  /* ── the three answers: valid, which vehicle, when ── */
  const qrSize = 104;
  const heroH = 118;
  doc.save().roundedRect(M, y, inner, heroH, 8).lineWidth(1).fillAndStroke('#ffffff', C.line).restore();

  doc.font('R').fontSize(8.5).fillColor(C.muted).text(X.passNumber, M + 14, y + 12, { lineBreak: false });
  doc.font('B').fontSize(20).fillColor(C.brand).text(t.ticket_no, M + 14, y + 23, { lineBreak: false });

  doc.font('R').fontSize(8.5).fillColor(C.muted).text(X.vehicleNumber, M + 14, y + 58, { lineBreak: false });
  doc.font('B').fontSize(16);
  const plate = t.reg_no;
  const pw = doc.widthOfString(plate) + 26;
  doc.save().roundedRect(M + 14, y + 72, pw, 30, 4).lineWidth(1.6).fillAndStroke('#fffbe6', C.ink).restore();
  doc.fillColor(C.ink).text(plate, M + 14, y + 78, { width: pw, align: 'center', lineBreak: false });

  const last = slotTime.hhmm(slotTime.toMinutes(t.ends_at) - slotTime.LAST_ENTRY_BUFFER_MIN);
  const midX = M + 14 + Math.max(pw, 180) + 20;
  const midW = W - M - qrSize - 24 - midX;
  doc.font('R').fontSize(8.5).fillColor(C.muted).text(X.validFor, midX, y + 12, { lineBreak: false });
  doc.font('B').fontSize(11.5).fillColor(C.ink).text(L.longDate(t.travel_date, lg), midX, y + 23, { width: midW, lineBreak: false });
  doc.font('R').fontSize(9.5).fillColor(C.ink).text(L.slotLabel(t, lg), midX, y + 40, { width: midW, lineBreak: false });
  doc.font('R').fontSize(8.5).fillColor(C.muted).text(`${X.lastEntry} ${L.clock(last, lg)}`, midX, y + 55, { width: midW, lineBreak: false });
  doc.font('B').fontSize(11).fillColor(C.brand2).text(L.placeName(t, lg), midX, y + 74, { width: midW, lineBreak: false });
  doc.font('R').fontSize(8.5).fillColor(C.muted).text(`${L.district(t, lg)}, ${L.state(lg)}`, midX, y + 89, { width: midW, lineBreak: false });

  const qrPng = await QRCode.toBuffer(verifyUrl, { type: 'png', margin: 1, width: 320, errorCorrectionLevel: 'M' });
  const qx = W - M - qrSize - 8;
  doc.image(qrPng, qx, y + 4, { width: qrSize, height: qrSize });
  doc.font('R').fontSize(6.5).fillColor(C.muted)
     .text(X.scan, qx - 14, y + qrSize + 3, { width: qrSize + 28, align: 'center', lineBreak: false });

  y += heroH + 14;

  /* ── detail, two columns at a time ── */
  const gap = 12;
  const colW = (inner - gap) / 2;
  const d = details(t);
  const name = t.customer_name || t.wa_profile_name || '—';
  const pair = (a, b) => { y = Math.max(a, b); };
  const paid = t.payment_status === 'paid';

  pair(
    kvTable(doc, M, y, colW, X.secVehicle, [
      [X.vehicleNo, t.reg_no],
      [X.maker, d.make],
      [X.model, d.model],
      [X.variant, d.variant],
      [X.type, L.vehicleType(t, lg)],
    ]),
    kvTable(doc, M + colW + gap, y, colW, X.secVisit, [
      [X.destination, L.placeName(t, lg)],
      [X.district, `${L.district(t, lg)}, ${L.state(lg)}`],
      [X.date, L.longDate(t.travel_date, lg)],
      [X.slot, L.slotLabel(t, lg)],
      [X.lastEntry, L.clock(last, lg)],
    ]),
  );

  pair(
    kvTable(doc, M, y, colW, X.secVisitor, [
      [X.name, name],
      [X.whatsapp, maskMobile(t.mobile)],
      [X.passNo, t.ticket_no],
      [X.reference, t.reference_id],
      [X.passStatus, chip, { color: C.ok }],
    ]),
    kvTable(doc, M + colW + gap, y, colW, X.secPayment, [
      [X.entryFee, rupee(t.entry_paise), { align: 'right' }],
      [X.platformFee(settings.gstPercent), rupee(t.platform_paise), { align: 'right' }],
      [X.totalPaid, rupee(t.total_paise), { align: 'right', highlight: true, size: 10 }],
      [X.method, paymentMethod(t.payment_raw, lg)],
      [X.payStatus, paid ? X.paid : (t.payment_status || '—'), { color: paid ? C.ok : C.ink }],
      [X.paymentId, t.gateway_payment_id || '—'],
    ], { labelW: 0.5 }),
  );

  pair(
    kvTable(doc, M, y, colW, X.secTrack, [
      [X.booked, L.dateTime(t.created_at, lg)],
      [X.initiated, L.dateTime(t.payment_created_at, lg)],
    ]),
    kvTable(doc, M + colW + gap, y, colW, ' ', [
      [X.confirmed, L.dateTime(t.paid_at, lg)],
      [X.issued, L.dateTime(t.modified_at, lg)],
    ]),
  );

  /* The two notes side by side at one height, so neither looks like an afterthought. */
  const nh = Math.max(noteHeight(doc, colW, X.checkpostLines), noteHeight(doc, colW, X.rules));
  noteBox(doc, M, y, colW, { title: X.checkpost, lines: X.checkpostLines, minH: nh });
  noteBox(doc, M + colW + gap, y, colW, { title: X.note, lines: X.rules, bg: C.warnbg, fg: C.warn, minH: nh });

  footer(doc, {
    generated: X.generated(L.dateTime(generatedAt, lg)),
    pageOf: X.pageOf,
    productLine: X.product(settings),
  });
  return toBuffer(doc);
}

/** Unique by construction: the pass number is UNIQUE in the tickets table. */
const filename = (t) => `Pravesha-Pass-${t.ticket_no}.pdf`;

module.exports = { render, filename, CHECKPOST_LINES, RULES, paymentMethod, TYPE, LBL };
