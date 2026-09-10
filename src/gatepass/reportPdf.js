/**
 * reportPdf.js — the report an officer prints and puts in a folder.
 *
 * The CSV beside this holds the same facts, but a spreadsheet is not something
 * anyone carries into a meeting. This is the version with the department's
 * logo at the top, the headline numbers where they can be read at a glance, and
 * the detail behind them.
 *
 * Bilingual throughout: Kannada label, English label under it. The figures
 * themselves are numerals, which need no translation and must not be
 * transliterated — an officer reconciling a total should never have to think
 * about which script a digit is in.
 */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { kn } = require('./kn');
const { rs, titleFor } = require('./periodReport');

const FONTS = path.join(__dirname, '..', '..', 'assets', 'fonts');
const LOGOS = path.join(__dirname, '..', '..', 'assets', 'logos');

const INK = '#111827';
const MUTED = '#4b5563';
const RULE = '#c9d2cf';
const HAIR = '#e8ecea';
const ACCENT = '#0f4f48';
const BAD = '#b91c1c';
const GOOD = '#15803d';

const W = 595.28;
const M = 46;
const TEXT_W = W - M * 2;

const inr = (n) => Number(n).toLocaleString('en-IN');
const money = (paise) => `Rs. ${inr(((Number(paise) || 0) / 100).toFixed(2))}`;
const dateOnly = (d) => String(d || '').slice(0, 10);

/**
 * Render the report.
 *
 * @param d  the object from periodReport.gather()
 * @returns  a Buffer, because the caller is an HTTP response and a temporary
 *           file on disk would be one more thing to clean up.
 */
async function render(d) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true,
    info: {
      Title: `${d.place.name} — ${titleFor(d.period)} report ${d.from} to ${d.to}`,
      Author: d.cfg.merchant_name || 'ServerPe App Solutions',
    } });

  /* Kannada needs an embedded face; the PDF base fourteen has no Kannada at
     all and would silently drop every glyph. */
  const KN = fs.existsSync(path.join(FONTS, 'NotoSansKannada-Regular.ttf'));
  if (KN) {
    doc.registerFont('kn', path.join(FONTS, 'NotoSansKannada-Regular.ttf'));
    doc.registerFont('kn-bold', path.join(FONTS, 'NotoSansKannada-Bold.ttf'));
  }

  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks))));

  /* ── Heading ────────────────────────────────────────────────────────── */

  const logo = path.join(LOGOS, 'karnataka-tourism-384.png');
  if (fs.existsSync(logo)) doc.image(logo, M, 30, { width: 150 });

  doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(9)
     .text((d.cfg.collecting_for || 'Karnataka Tourism Department').toUpperCase(),
           M + 170, 36, { width: TEXT_W - 170, characterSpacing: 1 });

  if (KN) {
    doc.font('kn-bold').fontSize(14).fillColor(INK)
       .text(`${d.place.name} — ${knPeriod(d.period)}`, M + 170, 52,
             { width: TEXT_W - 170 });
  }
  doc.font('Helvetica-Bold').fontSize(15).fillColor(INK)
     .text(`${d.place.name} — ${titleFor(d.period)} report`, M + 170, KN ? 72 : 56,
           { width: TEXT_W - 170 });

  doc.font('Helvetica').fontSize(9.5).fillColor(MUTED)
     .text(d.from === d.to ? longDate(d.from) : `${longDate(d.from)} to ${longDate(d.to)}`,
           M + 170, KN ? 92 : 76, { width: TEXT_W - 170 });

  doc.y = 128;
  doc.moveTo(M, doc.y).lineTo(W - M, doc.y).lineWidth(1.2).strokeColor(ACCENT).stroke();
  doc.y += 18;

  /* ── The four numbers that get quoted ───────────────────────────────── */

  const t = d.revenue.totals;
  tiles(doc, [
    { kn: 'ಟಿಕೆಟ್‌ಗಳು', en: 'Tickets sold', value: inr(t.tickets || 0) },
    { kn: 'ಸಂಗ್ರಹ', en: 'Collected', value: money(t.gross_paise) },
    { kn: 'ಇಲಾಖೆಯ ಶುಲ್ಕ', en: 'Department entry fee', value: money(t.entry_paise), tone: ACCENT },
    { kn: 'ತಿರಸ್ಕೃತ', en: 'Refused at the gate', value: inr(d.gate.refused),
      tone: d.gate.refused ? BAD : MUTED },
  ], KN);

  /* The line that justifies the system's existence, when there is one. */
  if (d.gate.fraudulent > 0) {
    doc.y += 6;
    doc.rect(M, doc.y, TEXT_W, 30).fill('#fdecec');
    doc.fillColor(BAD).font('Helvetica-Bold').fontSize(10)
       .text(`${inr(d.gate.fraudulent)} altered or duplicated ticket(s) were stopped at the gate `
           + 'in this period. Under a printed-ticket system these would have been admitted.',
             M + 10, doc.y + 9, { width: TEXT_W - 20 });
    doc.y += 40;
  } else {
    doc.y += 10;
  }

  /* ── Money ──────────────────────────────────────────────────────────── */

  H(doc, KN, 'ಹಣಕಾಸು ವಿವರ', 'Money');

  table(doc, [
    { label: 'Date', w: 90 },
    { label: 'Tickets', w: 55, align: 'right' },
    { label: 'Collected', w: 85, align: 'right' },
    { label: 'Department', w: 85, align: 'right' },
    { label: 'Booking fee', w: 78, align: 'right' },
    { label: 'GST', w: 60, align: 'right' },
    { label: 'Take-home', w: TEXT_W - 453, align: 'right' },
  ], d.revenue.days.map((x) => [
    dateOnly(x.date), inr(x.tickets), money(x.gross_paise), money(x.entry_paise),
    money(x.platform_paise), money(x.gst_paise), money(x.take_home_paise),
  ]), [
    'Total', inr(t.tickets || 0), money(t.gross_paise), money(t.entry_paise),
    money(t.platform_paise), money(t.gst_paise), money(t.take_home_paise),
  ]);

  note(doc, 'The entry fee is collected on behalf of the department as a pure agent under '
    + 'Rule 33 of the CGST Rules and is not part of ServerPe\'s taxable value. GST applies to '
    + 'the booking fee alone. Take-home is an estimate after the payment gateway\'s charge.');

  /* ── The gate ───────────────────────────────────────────────────────── */

  H(doc, KN, 'ಗೇಟ್‌ನಲ್ಲಿ ಪರಿಶೀಲನೆ', 'What the gate saw');

  const VERDICT_WORDS = {
    valid: 'Allowed through', already_used: 'Already used — a copied ticket',
    invalid_signature: 'Altered or fake ticket', wrong_day: 'Genuine, wrong date',
    wrong_slot: 'Genuine, presented too early', wrong_place: 'Genuine, wrong gate',
    unknown_ticket: 'Not on record', cancelled: 'Cancelled ticket',
  };

  table(doc, [
    { label: 'Verdict', w: 300 },
    { label: 'Count', w: 80, align: 'right' },
    { label: 'Share', w: TEXT_W - 380, align: 'right' },
  ], Object.keys(VERDICT_WORDS).filter((k) => d.gate[k]).map((k) => [
    VERDICT_WORDS[k], inr(d.gate[k]),
    d.gate.scanned ? `${Math.round((d.gate[k] / d.gate.scanned) * 100)}%` : '-',
  ]), ['Scanned in total', inr(d.gate.scanned), '100%']);

  if (d.staff.length) {
    sub(doc, 'Staff on duty');
    table(doc, [
      { label: 'Staff member', w: 180 },
      { label: 'Scans', w: 70, align: 'right' },
      { label: 'Allowed', w: 70, align: 'right' },
      { label: 'Refused', w: 70, align: 'right' },
      { label: 'Offline', w: TEXT_W - 390, align: 'right' },
    ], d.staff.map((s) => [s.name, inr(s.scans), inr(s.allowed), inr(s.refused), inr(s.offline)]));
  }

  /* ── The mix ────────────────────────────────────────────────────────── */

  H(doc, KN, 'ವಾಹನ ಪ್ರಕಾರ ಮತ್ತು ಸಮಯ', 'By vehicle type and slot');

  table(doc, [
    { label: 'Vehicle type', w: 200 },
    { label: 'Tickets', w: 80, align: 'right' },
    { label: 'Collected', w: TEXT_W - 280, align: 'right' },
  ], d.categories.map((c) => [c.label, inr(c.tickets), money(c.gross_paise)]));

  sub(doc, 'By slot');
  table(doc, [
    { label: 'Slot', w: 200 },
    { label: 'Tickets', w: 80, align: 'right' },
    { label: 'Collected', w: TEXT_W - 280, align: 'right' },
  ], d.slots.map((s) => [s.label, inr(s.tickets), money(s.gross_paise)]));

  /* ── Exceptions ─────────────────────────────────────────────────────── */

  if (d.closures.length || d.refunds.length) {
    H(doc, KN, 'ರದ್ದತಿ ಮತ್ತು ಮರುಪಾವತಿ', 'Closures and refunds');

    if (d.closures.length) {
      table(doc, [
        { label: 'Date', w: 80 },
        { label: 'Slot', w: 110 },
        { label: 'Reason', w: 180 },
        { label: 'Affected', w: 55, align: 'right' },
        { label: 'Moved', w: 50, align: 'right' },
        { label: 'Refunded', w: TEXT_W - 475, align: 'right' },
      ], d.closures.map((c) => [
        dateOnly(c.travel_date), c.slot_label || 'Whole day', c.reason,
        inr(c.tickets_affected), inr(c.tickets_postponed), inr(c.tickets_refunded),
      ]));
    }

    if (d.refunds.length) {
      sub(doc, 'Refunds issued');
      table(doc, [
        { label: 'Ticket', w: 80 },
        { label: 'Vehicle', w: 110 },
        { label: 'Travel date', w: 100 },
        { label: 'Amount', w: 90, align: 'right' },
        { label: 'Refund reference', w: TEXT_W - 380 },
      ], d.refunds.map((r) => [
        r.ticket_no, r.reg_no, dateOnly(r.travel_date), money(r.total_paise), r.refund_id || '-',
      ]), ['', '', 'Total',
        money(d.refunds.reduce((n, r) => n + r.total_paise, 0)), '']);
    }
  }

  /* ── Every ticket ───────────────────────────────────────────────────── */

  doc.addPage(); doc.y = M;
  H(doc, KN, 'ಎಲ್ಲಾ ಟಿಕೆಟ್‌ಗಳು', `Every ticket (${inr(d.tickets.length)})`);

  table(doc, [
    { label: 'Ticket', w: 62 },
    { label: 'Date', w: 66 },
    { label: 'Slot', w: 46 },
    { label: 'Vehicle', w: 82 },
    { label: 'Type', w: 60 },
    { label: 'Mobile', w: 74 },
    { label: 'Paid', w: 72, align: 'right' },
    { label: 'Status', w: TEXT_W - 462 },
  ], d.tickets.map((x) => [
    x.ticket_no, dateOnly(x.travel_date),
    x.slot_code === '0612' ? 'AM' : 'PM',
    x.reg_no, x.category_label.split(' ')[0], x.mobile,
    money(x.total_paise),
    x.status === 'used' ? 'Entered' : x.status === 'cancelled' ? 'Refunded' : 'Booked',
  ]), null, { size: 8 });

  /* ── Every scan ─────────────────────────────────────────────────────── */

  if (d.scans.length) {
    doc.addPage(); doc.y = M;
    H(doc, KN, 'ಎಲ್ಲಾ ಸ್ಕ್ಯಾನ್‌ಗಳು', `Every scan (${inr(d.scans.length)})`);

    table(doc, [
      { label: 'Time', w: 96 },
      { label: 'Verdict', w: 118 },
      { label: 'Ticket', w: 62 },
      { label: 'Vehicle', w: 82 },
      { label: 'Scanned by', w: 100 },
      { label: 'Offline', w: TEXT_W - 458 },
    ], d.scans.map((s) => [
      when(s.scanned_at),
      VERDICT_WORDS[s.verdict] || s.verdict,
      s.ticket_no || '-', s.reg_no || '-', s.staff_name || '-',
      s.was_offline ? 'yes' : '',
    ]), null, { size: 8, highlight: (r, i) => d.scans[i].verdict !== 'valid' });
  }

  /* ── Visitor messages ───────────────────────────────────────────────── */

  if (d.messages.length) {
    H(doc, KN, 'ಸಂದರ್ಶಕರ ಸಂದೇಶಗಳು', 'Visitor messages');
    for (const m of d.messages) {
      if (doc.y > 720) { doc.addPage(); doc.y = M; }
      doc.fillColor(MUTED).font('Helvetica').fontSize(8)
         .text(`${when(m.created_at)} · ${m.kind === 'feedback' ? 'Feedback' : 'Support'} · ${m.mobile || ''}`,
               M, doc.y, { width: TEXT_W });
      doc.fillColor(INK).font('Helvetica').fontSize(9.5)
         .text(m.detail?.message || '', M, doc.y + 2, { width: TEXT_W });
      doc.y += 10;
    }
  }

  /* ── Footer on every page ───────────────────────────────────────────── */

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.fillColor(MUTED).font('Helvetica').fontSize(7)
       .text(`${d.place.name} · ${titleFor(d.period)} report · ${d.from} to ${d.to}`,
             M, 806, { width: TEXT_W / 2 });
    doc.text(`Page ${i - range.start + 1} of ${range.count}   ·   `
           + `Generated ${new Date().toLocaleString('en-IN')}`,
             W / 2 - M, 806, { width: TEXT_W / 2, align: 'right' });
    doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(7)
       .text(`Powered by ${d.cfg.merchant_name || 'ServerPe App Solutions'} — `
           + `${d.cfg.vendor_tagline || 'Smart Clicks, Smart Taps.'}`,
             M, 818, { width: TEXT_W });
  }

  doc.end();
  return done;
}

/* ───────────────────────────────────────────────────────── furniture */

function H(doc, KN, knText, enText) {
  if (doc.y > 690) { doc.addPage(); doc.y = M; }
  doc.y += 16;
  if (KN) {
    doc.font('kn-bold').fontSize(11).fillColor(ACCENT)
       .text(knText, M, doc.y, { width: TEXT_W });
  }
  doc.font('Helvetica-Bold').fontSize(12).fillColor(INK)
     .text(enText, M, doc.y + (KN ? 1 : 0), { width: TEXT_W });
  const y = doc.y + 4;
  doc.moveTo(M, y).lineTo(W - M, y).lineWidth(0.8).strokeColor(ACCENT).stroke();
  doc.y = y + 10;
}

function sub(doc, text) {
  doc.y += 10;
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(MUTED)
     .text(text.toUpperCase(), M, doc.y, { width: TEXT_W, characterSpacing: 0.8 });
  doc.y += 4;
}

function note(doc, text) {
  doc.y += 4;
  doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
     .text(text, M, doc.y, { width: TEXT_W, lineGap: 1 });
  doc.y += 6;
}

/** The four headline figures, as boxes across the page. */
function tiles(doc, items, KN) {
  const gap = 8;
  const w = (TEXT_W - gap * (items.length - 1)) / items.length;
  const top = doc.y;

  items.forEach((it, i) => {
    const x = M + i * (w + gap);
    doc.rect(x, top, w, 62).fillAndStroke('#f6f8f7', HAIR);

    if (KN) {
      doc.font('kn').fontSize(7.5).fillColor(MUTED)
         .text(it.kn, x + 8, top + 7, { width: w - 16 });
    }
    doc.font('Helvetica').fontSize(7).fillColor(MUTED)
       .text(it.en.toUpperCase(), x + 8, top + (KN ? 19 : 10),
             { width: w - 16, characterSpacing: 0.5 });
    doc.font('Helvetica-Bold').fontSize(15).fillColor(it.tone || INK)
       .text(it.value, x + 8, top + 34, { width: w - 16 });
  });

  doc.y = top + 72;
}

/**
 * A table.
 *
 * Every cell is drawn at an explicit y and the row advances by the tallest of
 * them, so a wrapping cell cannot drag the rest of the row out of line.
 */
function table(doc, cols, rows, total = null, { size = 9, highlight = null } = {}) {
  if (!rows.length) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(MUTED)
       .text('None in this period.', M, doc.y, { width: TEXT_W });
    doc.y += 16;
    return;
  }

  const header = () => {
    let x = M;
    const top = doc.y;
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED);
    for (const c of cols) {
      doc.text(c.label.toUpperCase(), x, top,
        { width: c.w, align: c.align || 'left', characterSpacing: 0.5 });
      x += c.w;
    }
    doc.y = top + 12;
    doc.moveTo(M, doc.y).lineTo(W - M, doc.y).lineWidth(0.7).strokeColor(RULE).stroke();
    doc.y += 6;
  };

  header();

  rows.forEach((r, i) => {
    if (doc.y > 762) { doc.addPage(); doc.y = M; header(); }

    const top = doc.y;
    if (highlight && highlight(r, i)) {
      doc.rect(M - 3, top - 2, TEXT_W + 6, size + 7).fill('#fdf4f4');
    }

    let x = M;
    let tallest = 0;
    cols.forEach((c, ci) => {
      const text = String(r[ci] ?? '');
      doc.font('Helvetica').fontSize(size)
         .fillColor(highlight && highlight(r, i) ? BAD : INK);
      const h = doc.heightOfString(text, { width: c.w, align: c.align || 'left' });
      doc.text(text, x, top, { width: c.w, align: c.align || 'left', ellipsis: true, height: size * 2.4 });
      tallest = Math.max(tallest, Math.min(h, size * 2.4));
      x += c.w;
    });

    doc.y = top + Math.max(tallest, size + 2) + 4;
    doc.moveTo(M, doc.y - 2).lineTo(W - M, doc.y - 2).lineWidth(0.35).strokeColor(HAIR).stroke();
  });

  if (total) {
    if (doc.y > 750) { doc.addPage(); doc.y = M; }
    const top = doc.y + 2;
    let x = M;
    doc.font('Helvetica-Bold').fontSize(size).fillColor(INK);
    cols.forEach((c, ci) => {
      doc.text(String(total[ci] ?? ''), x, top, { width: c.w, align: c.align || 'left' });
      x += c.w;
    });
    doc.y = top + size + 6;
    doc.moveTo(M, doc.y - 3).lineTo(W - M, doc.y - 3).lineWidth(0.8).strokeColor(RULE).stroke();
  }

  doc.y += 8;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

function longDate(d) {
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
  return `${day} ${MONTHS[m - 1]} ${y}`;
}

function when(ts) {
  const d = new Date(ts);
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}, `
       + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

const knPeriod = (p) => (p === 'weekly' ? 'ಸಾಪ್ತಾಹಿಕ ವರದಿ'
  : p === 'monthly' ? 'ಮಾಸಿಕ ವರದಿ' : 'ದೈನಂದಿನ ವರದಿ');

module.exports = { render };
