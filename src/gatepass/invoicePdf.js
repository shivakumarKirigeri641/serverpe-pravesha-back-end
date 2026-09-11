/**
 * invoicePdf.js — the GST tax invoice, as a document of its own.
 *
 * WHY THIS IS NOT PART OF THE TICKET. The ticket PDF is held up at a barrier at
 * 7 a.m.: a big plate, a date, the conditions. The invoice is filed by an
 * accountant: a GSTIN, a SAC code, a taxable value and a tax split. Trying to
 * serve both from one page produced a document that was cluttered for the gate
 * and incomplete for the books — the ticket carried a summary of the money but
 * none of the particulars Rule 46 requires on a tax invoice.
 *
 * THE PART THAT IS EASY TO GET WRONG. Of the Rs.113 a visitor pays, Rs.100 is
 * the department's entry fee and Rs.13 is ours. GST is charged on the Rs.13
 * ALONE. The entry fee is collected as a PURE AGENT under Rule 33 of the CGST
 * Rules 2017 and is excluded from our taxable value — it is the department's
 * money moving through our account, never our revenue. An invoice that showed
 * Rs.113 as the taxable value would have us paying tax on the state's
 * collections and would overstate our turnover by roughly eight times.
 *
 * Rule 33 allows that exclusion only if the document SAYS so, which is why the
 * entry-fee line is labelled as a reimbursement, kept out of the taxable
 * column, and carries the declaration at the foot. The line has to be on the
 * invoice — the visitor paid it to us — but it must sit outside the tax.
 *
 * PLACE OF SUPPLY. A visitor is an unregistered person whose address is not on
 * our records, so under s.12(2)(b) of the IGST Act the place of supply is the
 * supplier's location: Karnataka. Supplier and recipient are therefore always
 * in the same state and the tax is always CGST + SGST. There is deliberately no
 * IGST branch here — adding one would be dead code pretending to be prudence.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const PDFDocument = require('pdfkit');
const { query, one, tx } = require('./db');
const pricing = require('./pricing');
const settings = require('./settings');

/* Pravesha's teal, the same one the ticket and the gate signage use. */
const BRAND  = '#0f766e';
const ACCENT = '#14b8a6';
const INK    = '#111827';
const MUTED  = '#6b7280';
const LINE   = '#e2e6e9';
const SOFT   = '#f3f6f6';

const W = 595.28;   // A4 width in points
const M = 46;

/* The default is the residual travel-arrangement bucket rather than a more
   specific reservation code: what we sell is a booking and collection service
   for someone else's ticket, which does not sit cleanly under any of the
   narrower headings. It is a setting so a CA can change it without a deploy. */
const DEFAULT_SAC = '998559';

const money = (paise) => `Rs. ${Number(paise / 100).toFixed(2)}`;

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
             'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * '2026-09-11' -> '11 Sep 2026'.
 *
 * Written here rather than imported from deliver.js, which has one already:
 * deliver requires this module, so requiring it back would give us a
 * half-initialised module object and an undefined function at render time.
 * It also carries the year, which deliver's chat-facing version omits — on a
 * document that will be filed, the year is not optional.
 *
 * Parsed from the string parts rather than through Date(str): a bare
 * 'YYYY-MM-DD' is read as UTC, and a visit on the 11th would print as the 10th
 * for anyone reading it west of Greenwich.
 */
function longDate(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  if (!y || !m || !d) return String(s);
  return `${d} ${MON[m - 1]} ${y}`;
}

/**
 * Indian financial year for a date: 10 Sep 2026 -> '26-27'.
 *
 * The series restarts each April, which is what a GST series is expected to do
 * and what makes an invoice number readable to whoever files the return.
 */
function finYear(d = new Date()) {
  const y = d.getFullYear(), m = d.getMonth(); // 0 = January
  const start = m >= 3 ? y : y - 1;            // April onwards
  return `${String(start % 100).padStart(2, '0')}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/**
 * Reserve the next invoice number.
 *
 * nextval() and NOT count(*) + 1. Two payments confirming in the same second
 * both read the same count and build the same string; invoice_no is UNIQUE, so
 * one of them raises and a visitor who has PAID gets no invoice. A sequence
 * hands every caller its own number under any load, and a GST series that has
 * to be free of holes and repeats cannot be built any other way.
 */
async function nextNumber() {
  const { rows } = await query(`SELECT nextval('pravesha_invoice_seq')::bigint AS n`);
  return `PRV/${finYear()}/${String(rows[0].n).padStart(5, '0')}`;
}

/**
 * The invoice row for a ticket, creating it on first ask.
 *
 * Amounts are STORED rather than recomputed on each render. An invoice states
 * what was charged on a particular day under the rates in force that day;
 * re-deriving it from current settings would quietly rewrite history the first
 * time the fee percentage or the GST rate changes, and the copy the visitor
 * has would stop matching the copy in our books.
 */
async function ensureInvoice(t) {
  const existing = await one('SELECT * FROM invoices WHERE ticket_id = $1', [t.id]);
  if (existing) return existing;

  const cfg = await settings.all();
  const gstPct = Number(cfg.gst_percent_on_platform || 18);

  /* The fee is quoted GST-inclusive so the visitor sees one round number, so
     the taxable value is what is left after the tax inside it is taken out. */
  const service = t.platform_paise;
  const taxable = Math.round(service * 100 / (100 + gstPct));
  const gst = service - taxable;

  /* A race here is a genuine possibility: the payment webhook and a manual
     resend can both land on a ticket at once. ON CONFLICT lets the loser read
     the winner's row instead of failing, which is why this returns a row in
     every case rather than throwing. */
  return tx(async (c) => {
    const no = await nextNumber();
    const ins = await c.query(
      `INSERT INTO invoices
         (invoice_no, ticket_id, customer_id, entry_paise, service_paise,
          taxable_paise, gst_paise, total_paise, gst_percent, place_of_supply, sac_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (ticket_id) DO NOTHING
       RETURNING *`,
      [no, t.id, t.customer_id, t.entry_paise, service, taxable, gst, t.total_paise,
       gstPct, cfg.place_of_supply || '29-Karnataka', cfg.sac_code || DEFAULT_SAC]);

    if (ins.rows[0]) return ins.rows[0];
    const { rows } = await c.query('SELECT * FROM invoices WHERE ticket_id = $1', [t.id]);
    return rows[0];
  });
}

/* ──────────────────────────────────────────────────────────── the drawing */

function label(doc, text, x, y, w, align = 'left') {
  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(7)
     .text(String(text).toUpperCase(), x, y, { width: w, align, characterSpacing: 1.1 });
}

function value(doc, text, x, y, w, opts = {}) {
  doc.fillColor(opts.color || INK)
     .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
     .fontSize(opts.size || 9.5)
     .text(String(text), x, y, { width: w, align: opts.align || 'left', lineGap: 1.5 });
}

/**
 * Render the invoice for a ticket and return the file path.
 *
 * `t` is the joined ticket row deliver.js already has — passing it in rather
 * than re-querying keeps the two documents describing the same instant.
 */
async function invoicePdf(t) {
  const cfg = await settings.all();
  const inv = await ensureInvoice(t);

  const dir = path.join(os.tmpdir(), 'serverpe-invoices');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `invoice-${inv.invoice_no.replace(/\//g, '-')}.pdf`);

  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  const stream = fs.createWriteStream(file);
  doc.pipe(stream);

  /* ── header band ── */
  doc.rect(0, 0, W, 96).fill(BRAND);
  doc.rect(0, 96, W, 3).fill(ACCENT);

  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(22)
     .text(cfg.product_name || 'Pravesha', M, 28);
  doc.font('Helvetica').fontSize(8.5).fillColor('#d7f0ec')
     .text(cfg.vendor_tagline || 'Entry made simple.', M, 56);
  doc.font('Helvetica').fontSize(8).fillColor('#bfe4df')
     .text(cfg.legal_name || 'ServerPe App Solutions', M, 72);

  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(15)
     .text('TAX INVOICE', W - M - 220, 30, { width: 220, align: 'right', characterSpacing: 1.5 });
  doc.font('Helvetica').fontSize(8.5).fillColor('#d7f0ec')
     .text(inv.invoice_no, W - M - 220, 54, { width: 220, align: 'right' })
     .text(new Date(inv.issued_at).toLocaleDateString('en-IN',
       { day: '2-digit', month: 'short', year: 'numeric' }),
       W - M - 220, 68, { width: 220, align: 'right' });

  /* ── seller / buyer ── */
  let y = 126;
  const colW = (W - M * 2 - 24) / 2;
  const rightX = M + colW + 24;

  label(doc, 'Invoice from', M, y, colW);
  label(doc, 'Invoice to', rightX, y, colW);
  y += 14;

  value(doc, cfg.legal_name || 'ServerPe App Solutions', M, y, colW, { bold: true, size: 10.5 });
  value(doc, t.customer_name || 'Visitor', rightX, y, colW, { bold: true, size: 10.5 });
  y += 16;

  const sellerLines = [
    cfg.business_address || '',
    cfg.gstin ? `GSTIN: ${cfg.gstin}` : '',
    cfg.udyam_number ? `Udyam: ${cfg.udyam_number}` : '',
    cfg.contact_email || '',
  ].filter(Boolean);

  const buyerLines = [
    `Mobile: ${t.mobile}`,
    'Unregistered person (B2C)',
    `Place of supply: ${inv.place_of_supply}`,
  ];

  const yStart = y;
  value(doc, sellerLines.join('\n'), M, y, colW, { size: 8.5, color: MUTED });
  const afterSeller = doc.y;
  value(doc, buyerLines.join('\n'), rightX, yStart, colW, { size: 8.5, color: MUTED });
  y = Math.max(afterSeller, doc.y) + 16;

  /* ── what it was for ── */
  doc.rect(M, y, W - M * 2, 40).fill(SOFT);
  label(doc, 'Booking reference', M + 12, y + 8, 160);
  value(doc, t.ticket_no, M + 12, y + 19, 160, { bold: true, size: 9 });
  label(doc, 'Vehicle', M + 180, y + 8, 120);
  value(doc, t.reg_no, M + 180, y + 19, 120, { bold: true, size: 9 });
  label(doc, 'Visit', M + 310, y + 8, W - M * 2 - 322);
  value(doc, `${t.place_name} · ${longDate(t.travel_date)}${t.slot_label ? ` · ${t.slot_label}` : ''}`,
        M + 310, y + 19, W - M * 2 - 322, { size: 8 });
  y += 58;

  /* ── line items ──
     Two rows that must not be confused with each other: one is a supply we
     make, the other is money we handled for somebody else. The taxable column
     is what separates them, and it reads 0.00 on the entry fee on purpose. */
  const cols = [
    { x: M,       w: 232, align: 'left'  },  // description
    { x: M + 236, w: 56,  align: 'left'  },  // SAC
    { x: M + 296, w: 66,  align: 'right' },  // taxable
    { x: M + 366, w: 60,  align: 'right' },  // GST
    { x: M + 430, w: W - M * 2 - 430, align: 'right' }, // amount
  ];

  doc.rect(M, y, W - M * 2, 22).fill(BRAND);
  const heads = ['Description', 'SAC', 'Taxable', 'GST', 'Amount'];
  heads.forEach((h, i) => {
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7.5)
       .text(h.toUpperCase(), cols[i].x + 6, y + 7,
             { width: cols[i].w - 12, align: cols[i].align, characterSpacing: 0.8 });
  });
  y += 22;

  const rows = [
    {
      desc: `Entry fee — ${t.place_name} (${t.category_label})\n`
          + `Collected on behalf of ${cfg.collecting_for || 'Karnataka Tourism Department'}`,
      sac: '—',
      taxable: null,          // outside the taxable value, by design
      gst: '—',
      amount: inv.entry_paise,
    },
    {
      desc: 'Booking and convenience fee\n'
          + 'Online booking, vehicle verification and gate entry',
      sac: inv.sac_code,
      taxable: inv.taxable_paise,
      gst: `${Number(inv.gst_percent)}%`,
      amount: inv.service_paise,
    },
  ];

  for (const r of rows) {
    const h = 42;
    doc.rect(M, y, W - M * 2, h).fill('#ffffff');
    doc.moveTo(M, y + h).lineTo(W - M, y + h).lineWidth(0.5).strokeColor(LINE).stroke();

    const [d, note] = r.desc.split('\n');
    value(doc, d, cols[0].x + 6, y + 8, cols[0].w - 12, { size: 9, bold: true });
    value(doc, note, cols[0].x + 6, y + 21, cols[0].w - 12, { size: 7.5, color: MUTED });
    value(doc, r.sac, cols[1].x + 6, y + 12, cols[1].w - 12, { size: 8.5, color: MUTED });
    value(doc, r.taxable === null ? '—' : money(r.taxable),
          cols[2].x, y + 12, cols[2].w, { size: 8.5, align: 'right',
            color: r.taxable === null ? MUTED : INK });
    value(doc, r.gst, cols[3].x, y + 12, cols[3].w, { size: 8.5, align: 'right', color: MUTED });
    value(doc, money(r.amount), cols[4].x, y + 11, cols[4].w,
          { size: 9.5, align: 'right', bold: true });
    y += h;
  }

  /* ── totals ── */
  y += 14;
  const tx0 = W - M - 240;
  const tot = (lab, val, opts = {}) => {
    doc.fillColor(opts.bold ? INK : MUTED)
       .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.bold ? 10 : 8.5)
       .text(lab, tx0, y, { width: 150 });
    doc.fillColor(INK).font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
       .fontSize(opts.bold ? 10 : 8.5)
       .text(val, tx0 + 150, y, { width: 90, align: 'right' });
    y += opts.bold ? 18 : 15;
  };

  const half = Math.round(inv.gst_paise / 2);
  tot('Taxable value', money(inv.taxable_paise));
  tot(`CGST @ ${Number(inv.gst_percent) / 2}%`, money(half));
  tot(`SGST @ ${Number(inv.gst_percent) / 2}%`, money(inv.gst_paise - half));
  tot('Reimbursement (pure agent)', money(inv.entry_paise));

  doc.moveTo(tx0, y + 2).lineTo(W - M, y + 2).lineWidth(0.5).strokeColor(LINE).stroke();
  y += 10;
  doc.rect(tx0 - 10, y - 4, 250, 26).fill(SOFT);
  tot('TOTAL PAID', money(inv.total_paise), { bold: true });
  y += 12;

  /* ── payment reference ── */
  /* Kept to the left of the totals block, so it wraps rather than runs under
     the figures. How many lines it takes depends on the reference, which
     varies in length — so the next section starts from where this actually
     ended, not from a guess that is right for a short reference and collides
     with the rule for a long one. */
  doc.fillColor(MUTED).font('Helvetica').fontSize(8)
     .text(`Paid online · Reference ${t.reference_id}`
         + (t.payment_ref ? ` · Payment ${t.payment_ref}` : ''),
       M, y, { width: W - M * 2 - 250 });
  y = doc.y + 14;

  /* ── the declaration Rule 33 requires ── */
  doc.moveTo(M, y).lineTo(W - M, y).lineWidth(0.5).strokeColor(LINE).stroke();
  y += 12;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(8)
     .text('DECLARATION', M, y, { characterSpacing: 1 });
  y += 12;
  doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text(
    `The entry fee of ${money(inv.entry_paise)} shown above is collected on behalf of `
    + `${cfg.collecting_for || 'the Karnataka Tourism Department'} in the capacity of a pure `
    + 'agent under Rule 33 of the CGST Rules, 2017, and is excluded from the value of our '
    + 'supply. GST is charged only on the booking and convenience fee. '
    + 'This is a computer-generated invoice and needs no signature.',
    M, y, { width: W - M * 2, lineGap: 1.5 });

  /* ── footer ── */
  doc.rect(0, 782, W, 60).fill(SOFT);
  doc.fillColor(MUTED).font('Helvetica').fontSize(7.5)
     .text(`${cfg.legal_name || 'ServerPe App Solutions'} · ${cfg.business_address || ''}`,
       M, 796, { width: W - M * 2 });
  doc.fillColor(MUTED).font('Helvetica').fontSize(7.5)
     .text(`Support ${cfg.support_mobile || ''} · ${cfg.contact_email || ''}`
         + `   |   Queries about this invoice must be raised within 30 days.`,
       M, 810, { width: W - M * 2 });
  doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(7.5)
     .text(`${cfg.product_name || 'Pravesha'} · Powered by ${cfg.merchant_name || 'ServerPe App Solutions'}`,
       M, 823, { width: W - M * 2 });

  doc.end();

  /* Waiting for 'finish' rather than returning after end(). end() only starts
     the flush; a caller that reads or sends the file immediately gets a
     truncated PDF, and one that exits gets no file at all. */
  await new Promise((res, rej) => { stream.on('finish', res); stream.on('error', rej); });
  return { file, invoice: inv };
}

module.exports = { invoicePdf, ensureInvoice, nextNumber, finYear };
