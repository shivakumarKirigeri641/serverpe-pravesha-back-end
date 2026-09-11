/**
 * pdf/passPdf.js — the entry pass.
 *
 * What a visitor might show at a barrier, and what they keep afterwards. It has
 * to answer three questions at a glance, in this order: is it valid, for which
 * vehicle, for when. Everything else — the payment, the timestamps — is below
 * the fold of the page for the one time somebody needs it.
 *
 * THE QR IS INFORMATION ONLY. It plays no part in entry: staff read the number
 * plate and record the entry, and nobody at the gate scans anything. Migration
 * 016 removed a signed QR for exactly that reason. This one is a link to the
 * pass's details page, read live from the database, for a visitor or anyone
 * they share it with who wants to see the booking. There is nothing in it to
 * forge, and a pass whose phone has died is still a pass.
 */

const QRCode = require('qrcode');
const { details } = require('../gatepass/vehicle');
const slotTime = require('../gatepass/slotTime');
const {
  C, newDoc, toBuffer, header, footer, kvTable, noteBox, noteHeight,
  istDateTime, longDate, rupee, maskMobile,
} = require('./common');

const TYPE = { BIKE: 'Bike', CAR: 'Car', TOOFAN: 'Toofan', TT: 'Tempo Traveller (TT)' };

const METHOD = {
  upi: 'UPI', card: 'Card', netbanking: 'Net banking', wallet: 'Wallet', emi: 'EMI',
  cardless_emi: 'Cardless EMI', paylater: 'Pay later', bank_transfer: 'Bank transfer',
};

/** The checkpost lines, shared with the WhatsApp message so the two never disagree. */
const CHECKPOST_LINES = [
  'No printout or phone needed at the gate — just drive up to the checkpost.',
  'Checkpost staff will read your vehicle number and record your entry digitally.',
  'Please arrive within your time slot. Last entry is one hour before the slot ends.',
];

const RULES = [
  'The pass is valid only for the vehicle number shown. Changing the vehicle at the checkpost is not allowed.',
  'Vehicles without a clear, readable number plate will not be allowed entry.',
  'One pass per vehicle for a date and slot. Repeat or duplicate bookings will be cancelled.',
  'Editing, copying or reselling a pass is illegal. Legal action will be taken against the vehicle and its owner.',
];

/** How the payment was made, in words, from whatever Razorpay told us. */
function paymentMethod(raw) {
  const g = (raw && (raw.entity || raw.gateway)) || {};
  const m = METHOD[g.method] || (g.method ? String(g.method).toUpperCase() : null);
  if (!m) return 'Online (Razorpay)';
  if (g.method === 'upi' && g.vpa) return `UPI · ${g.vpa}`;
  if (g.method === 'card' && g.card) return `Card · ${g.card.network || ''} •••• ${g.card.last4 || ''}`.trim();
  if (g.method === 'netbanking' && g.bank) return `Net banking · ${g.bank}`;
  if (g.method === 'wallet' && g.wallet) return `Wallet · ${g.wallet}`;
  return m;
}

async function render(t, { settings, verifyUrl, generatedAt = new Date() }) {
  const doc = newDoc({ title: `Pravesha entry pass ${t.ticket_no}`, subject: 'Entry pass' });
  const W = doc.page.width;
  const M = doc.page.margins.left;
  const inner = W - 2 * M;

  const statusChip = t.status === 'used' ? 'USED' : (t.status === 'paid' ? 'PAID · VALID' : String(t.status).toUpperCase());
  let y = header(doc, { tagline: settings.productTagline, title: 'ENTRY PASS', chip: statusChip });

  /* ── the three answers: valid, which vehicle, when ── */
  const qrSize = 104;
  const heroH = 118;
  doc.save().roundedRect(M, y, inner, heroH, 8).lineWidth(1).fillAndStroke('#ffffff', C.line).restore();

  doc.font('R').fontSize(8.5).fillColor(C.muted).text('PASS NUMBER', M + 14, y + 12, { lineBreak: false });
  doc.font('B').fontSize(20).fillColor(C.brand).text(t.ticket_no, M + 14, y + 23, { lineBreak: false });

  doc.font('R').fontSize(8.5).fillColor(C.muted).text('VEHICLE NUMBER', M + 14, y + 58, { lineBreak: false });
  doc.font('B').fontSize(15);
  const plate = t.reg_no;
  const pw = doc.widthOfString(plate, { characterSpacing: 2 }) + 24;
  doc.save().roundedRect(M + 14, y + 72, pw, 30, 4).lineWidth(1.6).fillAndStroke('#fffbe6', C.ink).restore();
  doc.fillColor(C.ink).text(plate, M + 14, y + 77, { width: pw, align: 'center', characterSpacing: 2, lineBreak: false });

  const last = slotTime.hhmm(slotTime.toMinutes(t.ends_at) - slotTime.LAST_ENTRY_BUFFER_MIN);
  const midX = M + 14 + Math.max(pw, 180) + 20;
  const midW = W - M - qrSize - 24 - midX;
  doc.font('R').fontSize(8.5).fillColor(C.muted).text('VALID FOR', midX, y + 12, { lineBreak: false });
  doc.font('B').fontSize(11.5).fillColor(C.ink).text(longDate(t.travel_date), midX, y + 23, { width: midW, lineBreak: false });
  doc.font('R').fontSize(9.5).fillColor(C.ink).text(t.slot_label, midX, y + 40, { width: midW, lineBreak: false });
  doc.font('R').fontSize(8.5).fillColor(C.muted).text(`Last entry ${last}`, midX, y + 55, { width: midW, lineBreak: false });
  doc.font('B').fontSize(11).fillColor(C.brand2).text(t.place_name, midX, y + 74, { width: midW, lineBreak: false });
  doc.font('R').fontSize(8.5).fillColor(C.muted).text(`${t.district}, Karnataka`, midX, y + 89, { width: midW, lineBreak: false });

  const qrPng = await QRCode.toBuffer(verifyUrl, { type: 'png', margin: 1, width: 320, errorCorrectionLevel: 'M' });
  const qx = W - M - qrSize - 8;
  doc.image(qrPng, qx, y + 4, { width: qrSize, height: qrSize });
  doc.font('R').fontSize(6.5).fillColor(C.muted).text('Scan for pass details', qx - 10, y + qrSize + 3, { width: qrSize + 20, align: 'center', lineBreak: false });

  y += heroH + 14;

  /* ── detail, two columns at a time ── */
  const gap = 12;
  const colW = (inner - gap) / 2;
  const d = details(t);
  const name = t.customer_name || t.wa_profile_name || '—';
  const pair = (a, b) => { y = Math.max(a, b); };

  pair(
    kvTable(doc, M, y, colW, 'Vehicle details', [
      ['Vehicle number', t.reg_no],
      ['Manufacturer', d.make],
      ['Model', d.model],
      ['Variant', d.variant],
      ['Vehicle type', TYPE[t.category_code] || t.category_label],
    ]),
    kvTable(doc, M + colW + gap, y, colW, 'Visit details', [
      ['Destination', t.place_name],
      ['District', `${t.district}, Karnataka`],
      ['Date of visit', longDate(t.travel_date)],
      ['Time slot', t.slot_label],
      ['Last entry', last],
    ]),
  );

  pair(
    kvTable(doc, M, y, colW, 'Visitor & pass details', [
      ['Name', name],
      ['WhatsApp number', maskMobile(t.mobile)],
      ['Pass number', t.ticket_no],
      ['Booking reference', t.reference_id],
      ['Pass status', statusChip, { color: C.ok }],
    ]),
    kvTable(doc, M + colW + gap, y, colW, 'Payment details', [
      ['Entry fee', rupee(t.entry_paise), { align: 'right' }],
      [`Platform fee (incl. ${settings.gstPercent}% GST)`, rupee(t.platform_paise), { align: 'right' }],
      ['Total paid', rupee(t.total_paise), { align: 'right', highlight: true, size: 10 }],
      ['Payment method', paymentMethod(t.payment_raw)],
      ['Payment status', t.payment_status === 'paid' ? 'Successful' : (t.payment_status || '—'),
        { color: t.payment_status === 'paid' ? C.ok : C.ink }],
      ['Payment ID', t.gateway_payment_id || '—'],
    ], { labelW: 0.5 }),
  );

  pair(
    kvTable(doc, M, y, colW, 'Date & time track', [
      ['Booking started', istDateTime(t.created_at)],
      ['Payment initiated', istDateTime(t.payment_created_at)],
    ]),
    kvTable(doc, M + colW + gap, y, colW, ' ', [
      ['Payment confirmed', istDateTime(t.paid_at)],
      ['Pass issued', istDateTime(t.modified_at)],
    ]),
  );

  /* The two notes side by side at one height, so neither looks like an afterthought. */
  const nh = Math.max(noteHeight(doc, colW, CHECKPOST_LINES), noteHeight(doc, colW, RULES));
  noteBox(doc, M, y, colW, { title: 'At the checkpost', lines: CHECKPOST_LINES, minH: nh });
  noteBox(doc, M + colW + gap, y, colW, { title: 'Please note', lines: RULES, bg: C.warnbg, fg: C.warn, minH: nh });

  footer(doc, { generatedAt, vendorTagline: settings.vendorTagline, website: settings.website });
  return toBuffer(doc);
}

/** Unique by construction: the pass number is UNIQUE in the tickets table. */
const filename = (t) => `Pravesha-Pass-${t.ticket_no}.pdf`;

module.exports = { render, filename, CHECKPOST_LINES, RULES, paymentMethod, TYPE };
