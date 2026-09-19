/**
 * pdf/invoicePdf.js — the tax invoice.
 *
 * A separate document from the pass because the two readers have almost nothing
 * in common. The pass is read at a barrier. This is read by an accountant, and
 * needs a GSTIN, a SAC code, a place of supply and the pure-agent split stated
 * in a way that survives a scrutiny notice.
 *
 * THE ENTRY FEE IS NOT OUR SUPPLY. It is collected for the Department of Tourism
 * as a pure agent (Rule 33, CGST Rules 2017) and passed on whole, so it appears
 * as a line with no taxable value. Only the service fee is taxed, and its GST is
 * shown as CGST + SGST because a visitor is an unregistered person whose place
 * of supply is our own state.
 */

const {
  C, newDoc, toBuffer, header, footer, kvTable, istDateTime, longDate, rupee, maskMobile,
} = require('./common');

const TYPE = { BIKE: 'Bike', CAR: 'Car', TOOFAN: 'Toofan', TT: 'Tempo Traveller' };

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven',
  'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function upto99(n) { return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`; }
function upto999(n) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', r ? upto99(r) : ''].filter(Boolean).join(' ');
}
/** Indian grouping: lakh and crore, the way the amount is actually said. */
function words(n) {
  if (n === 0) return 'Zero';
  const crore = Math.floor(n / 1e7);
  const lakh = Math.floor((n % 1e7) / 1e5);
  const thousand = Math.floor((n % 1e5) / 1e3);
  const rest = n % 1e3;
  return [crore ? `${upto999(crore)} Crore` : '', lakh ? `${upto99(lakh)} Lakh` : '',
    thousand ? `${upto99(thousand)} Thousand` : '', rest ? upto999(rest) : ''].filter(Boolean).join(' ');
}
function amountInWords(paise) {
  const r = Math.floor(paise / 100);
  const p = paise % 100;
  return `Rupees ${words(r)}${p ? ` and ${upto99(p)} Paise` : ''} Only`;
}

async function render(t, inv, { settings, generatedAt = new Date() }) {
  const doc = newDoc({ title: `Pravesha tax invoice ${inv.invoice_no}`, subject: 'Tax invoice' });
  const W = doc.page.width;
  const M = doc.page.margins.left;
  const inner = W - 2 * M;
  const gap = 14;
  const colW = (inner - gap) / 2;

  let y = header(doc, { heading: `Pravesha — ${settings.productTagline}`,
    dept: 'Department of Tourism, Government of Karnataka', title: 'TAX INVOICE', chip: 'PAID' });

  /* The supplier as it was when the invoice was issued (062), not as it is today;
     an invoice from before that column falls back to the current settings. */
  const sup = { ...settings, ...(inv.supplier || {}) };
  const left = kvTable(doc, M, y, colW, 'Supplier', [
    ['Name', sup.legalName],
    ['Address', sup.address],
    ['GSTIN', sup.gstin],
    ['UDYAM', sup.udyam],
    ['Contact', `${sup.email} · ${sup.website}`],
  ], { labelW: 0.3 });
  const right = kvTable(doc, M + colW + gap, y, colW, 'Invoice', [
    ['Invoice number', inv.invoice_no],
    ['Invoice date', istDateTime(inv.issued_at)],
    ['Place of supply', inv.place_of_supply],
    ['Reverse charge', 'No'],
    ['Pass number', t.ticket_no],
  ], { labelW: 0.4 });
  y = Math.max(left, right);

  const l2 = kvTable(doc, M, y, colW, 'Billed to', [
    ['Name', t.customer_name || t.wa_profile_name || '—'],
    ['WhatsApp number', maskMobile(t.mobile)],
    ['GSTIN', 'Unregistered'],
  ], { labelW: 0.4 });
  const r2 = kvTable(doc, M + colW + gap, y, colW, 'Against', [
    ['Destination', t.place_name],
    ['Date of visit', longDate(t.travel_date)],
    ['Vehicle', `${t.reg_no} · ${TYPE[t.category_code] || t.category_label}`],
  ], { labelW: 0.4 });
  y = Math.max(l2, r2);

  /* ── line items ── */
  const half = Number(inv.gst_percent) / 2;
  const cgst = Math.floor(Number(inv.gst_paise) / 2);
  const sgst = Number(inv.gst_paise) - cgst;
  const cols = [
    { h: '#', w: 22, a: 'center' },
    { h: 'Description', w: 186, a: 'left' },
    { h: 'SAC', w: 50, a: 'center' },
    { h: 'Taxable value', w: 72, a: 'right' },
    { h: `CGST ${half}%`, w: 58, a: 'right' },
    { h: `SGST ${half}%`, w: 58, a: 'right' },
    { h: 'Amount', w: inner - 446, a: 'right' },
  ];
  const rows = [
    ['1', `Entry fee — collected as pure agent on behalf of the Department of Tourism, Government of Karnataka (Rule 33, CGST Rules). Not a taxable supply.`,
      '—', '—', '—', '—', rupee(inv.entry_paise)],
    ['2', `${settings.feeLabel} — online booking and payment facilitation`,
      inv.sac_code, rupee(inv.taxable_paise), rupee(cgst), rupee(sgst), rupee(inv.service_paise)],
  ];

  doc.font('B').fontSize(9).fillColor(C.brand2).text('PARTICULARS', M, y, { characterSpacing: 0.8 });
  y += 15;

  const pad = 6;
  const drawRow = (cells, { head = false, bold = false, fill = null } = {}) => {
    doc.font(head || bold ? 'B' : 'R').fontSize(head ? 8.5 : 9);
    const h = Math.max(...cells.map((c, i) => doc.heightOfString(String(c), { width: cols[i].w - 2 * pad }))) + 2 * pad;
    let x = M;
    if (fill) doc.save().rect(M, y, inner, h).fill(fill).restore();
    cells.forEach((c, i) => {
      doc.save().rect(x, y, cols[i].w, h).lineWidth(0.6).stroke(C.line).restore();
      doc.fillColor(head ? '#ffffff' : C.ink)
         .text(String(c), x + pad, y + pad, { width: cols[i].w - 2 * pad, align: cols[i].a });
      x += cols[i].w;
    });
    y += h;
  };

  const headH = 22;
  doc.save().rect(M, y, inner, headH).fill(C.brand2).restore();
  drawRow(cols.map((c) => c.h), { head: true });
  rows.forEach((r) => drawRow(r));
  drawRow(['', 'Total', '', rupee(inv.taxable_paise), rupee(cgst), rupee(sgst), rupee(inv.total_paise)],
    { bold: true, fill: '#dcf5e8' });
  y += 10;

  doc.font('R').fontSize(9).fillColor(C.muted).text('Amount in words', M, y);
  doc.font('B').fontSize(10).fillColor(C.ink).text(amountInWords(Number(inv.total_paise)), M, y + 12, { width: inner });
  y += 36;

  y = kvTable(doc, M, y, inner, 'Payment', [
    ['Payment status', t.payment_status === 'paid' ? 'Paid in full' : (t.payment_status || '—'), { color: C.ok }],
    ['Payment method', require('./passPdf').paymentMethod(t.payment_raw)],
    ['Payment ID', t.gateway_payment_id || '—'],
    ['Paid on', istDateTime(t.paid_at)],
  ], { labelW: 0.3 });

  doc.font('R').fontSize(8.5).fillColor(C.muted).text(
    'This is a computer-generated invoice and does not require a signature. '
    + 'The entry fee is remitted in full to the Department of Tourism, Government of Karnataka.',
    M, y, { width: inner });

  footer(doc, {
    generated: `Generated on ${istDateTime(generatedAt)}`,
    pageOf: (i, n) => `Page ${i} of ${n}`,
    productLine: `Pravesha is a product of ServerPe App Solutions — ${settings.vendorTagline} (${settings.website})`,
  });
  return toBuffer(doc);
}

/**
 * Unique by construction — the invoice number is UNIQUE and sequence-backed.
 * The slashes are GST's separators and not legal in a filename, so they become
 * hyphens here only.
 */
const filename = (inv) => `Pravesha-Invoice-${String(inv.invoice_no).replace(/\//g, '-')}.pdf`;

module.exports = { render, filename, amountInWords };
