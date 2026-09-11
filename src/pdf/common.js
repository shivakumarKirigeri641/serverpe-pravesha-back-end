/**
 * pdf/common.js — what the pass and the invoice share: the letterhead, the
 * footer, the fonts, and a way to draw a labelled table.
 *
 * TWO FACES, CHOSEN BY THE TEXT. PDFKit's built-in Helvetica has no rupee sign,
 * and a pass that prints "₹" as an empty box looks forged. Noto Sans Kannada has
 * one, and was used for everything at first -- but its digits are drawn at
 * Kannada stroke weight, so "PRV-7K3M-9Q2A" came out with bold digits between
 * regular letters, which read as uneven spacing in exactly the numbers a gate
 * reads. Latin text now uses Noto Sans (same family, has ₹), and any string
 * containing Kannada switches to the Kannada face. The switch happens inside
 * text() itself, so no call site can forget it.
 *
 * Rendered to a Buffer, never to disk. Two passes issued in the same second
 * cannot overwrite each other's file if there is no file; the buffer is uploaded
 * straight to WhatsApp and the filename only exists as a label on the upload.
 */

const path = require('path');
const PDFDocument = require('pdfkit');

const ASSETS = path.join(__dirname, '..', '..', 'assets');
const FONT = path.join(ASSETS, 'fonts', 'NotoSans-Regular.ttf');
const FONT_BOLD = path.join(ASSETS, 'fonts', 'NotoSans-Bold.ttf');
const FONT_KN = path.join(ASSETS, 'fonts', 'NotoSansKannada-Regular.ttf');
const FONT_KN_BOLD = path.join(ASSETS, 'fonts', 'NotoSansKannada-Bold.ttf');
/* The square mark, not the wordmark: the wordmark is a 256x51 strip and
   shrank to an unreadable sliver when fitted into the header's square. */
const LOGO = path.join(ASSETS, 'logos', 'pravesha-icon-256.png');
const EMBLEM = path.join(ASSETS, 'logos', 'karnataka-tourism-emblem-256-clear.png');

const C = {
  brand: '#075e54',
  brand2: '#008069',
  accent: '#00a884',
  ink: '#111b21',
  muted: '#667781',
  line: '#d7dee2',
  shade: '#f3f6f7',
  okbg: '#e7f8ef',
  ok: '#0b7a3f',
  warnbg: '#fff6e5',
  warn: '#8a5a00',
};

const ZONE = 'Asia/Kolkata';

/** "11 Sep 2026, 12:45 PM IST" — every timestamp a visitor reads, in their zone. */
function istDateTime(d) {
  if (!d) return '—';
  const s = new Date(d).toLocaleString('en-IN', {
    timeZone: ZONE, day: '2-digit', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
  return `${s.replace(/\bam\b/i, 'AM').replace(/\bpm\b/i, 'PM')} IST`;
}

/** "Saturday, 12 Sep 2026" from a DATE column that arrives as '2026-09-12'. */
function longDate(yyyyMmDd) {
  const [y, m, d] = String(yyyyMmDd).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    timeZone: 'UTC', weekday: 'long', day: '2-digit', month: 'short', year: 'numeric',
  });
}

const rupee = (paise) => `₹${(Number(paise) / 100).toFixed(2)}`;

const maskMobile = (m) => {
  const d = String(m || '').replace(/\D/g, '');
  return d.length > 4 ? `${'•'.repeat(d.length - 4)}${d.slice(-4)}` : d;
};

const KANNADA = /[ಀ-೿]/;

function newDoc(meta) {
  const doc = new PDFDocument({
    size: 'A4', margins: { top: 36, bottom: 36, left: 36, right: 36 },
    info: { Title: meta.title, Author: 'ServerPe App Solutions', Subject: meta.subject,
      Creator: 'Pravesha', Producer: 'Pravesha' },
    bufferPages: true,
  });
  doc.registerFont('R', FONT);
  doc.registerFont('B', FONT_BOLD);
  doc.registerFont('KR', FONT_KN);
  doc.registerFont('KB', FONT_KN_BOLD);

  /* 'R' and 'B' are logical weights. Whenever a string about to be drawn or
     measured contains Kannada, the matching Kannada face is used for that call
     and the Latin face restored after. Measuring and drawing go through the
     same switch, so a cell's height is computed with the face it is drawn in. */
  let weight = 'R';
  const setFont = doc.font.bind(doc);
  doc.font = (name, ...rest) => {
    if (name === 'R' || name === 'B') weight = name;
    return setFont(name, ...rest);
  };
  /* RE-ENTRANT ON PURPOSE. text() measures words through widthOfString() while
     it lays out a line. An earlier version switched and restored on every call,
     so the inner measurement restored the Latin face halfway through the outer
     text() — and the rest of the line was drawn in a font with no Kannada
     glyphs, as a row of empty boxes. Only the outermost call switches now; calls
     made from inside it inherit whatever face it chose. */
  let depth = 0;
  for (const m of ['text', 'heightOfString', 'widthOfString']) {
    const orig = doc[m].bind(doc);
    doc[m] = (str, ...args) => {
      if (depth > 0) return orig(str, ...args);
      const kn = KANNADA.test(String(str ?? ''));
      depth += 1;
      if (kn) setFont(weight === 'B' ? 'KB' : 'KR');
      try { return orig(str, ...args); } finally {
        depth -= 1;
        if (kn) setFont(weight);
      }
    };
  }

  doc.font('R');
  return doc;
}

function toBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/**
 * The letterhead. "Pravesha — <tagline>" over "Department of Tourism, Government
 * of Karnataka", with the product mark on the left and the department's emblem
 * on the right, and the document's own title in a band beneath.
 */
function header(doc, { heading, dept, title, chip }) {
  const W = doc.page.width;
  const M = doc.page.margins.left;

  doc.save().rect(0, 0, W, 92).fill(C.brand).restore();
  doc.save().roundedRect(M - 2, 16, 60, 60, 12).fill('#ffffff').restore();
  try { doc.image(LOGO, M + 2, 20, { fit: [52, 52] }); } catch { /* logo missing: header still reads */ }
  try { doc.image(EMBLEM, W - M - 56, 18, { fit: [56, 56] }); } catch { /* same */ }

  const tx = M + 68;
  const tw = W - 2 * M - 136;
  doc.fillColor('#ffffff').font('B').fontSize(19)
     .text(heading, tx, 24, { width: tw, align: 'center', lineBreak: false });
  doc.font('R').fontSize(11).fillColor('#d9fdd3')
     .text(dept, tx, 53, { width: tw, align: 'center', lineBreak: false });

  doc.save().rect(0, 92, W, 30).fill(C.brand2).restore();
  doc.fillColor('#ffffff').font('B').fontSize(12)
     .text(title, M, 99, { width: W - 2 * M, characterSpacing: 1.5, lineBreak: false });
  if (chip) {
    doc.font('B').fontSize(10);
    const cw = doc.widthOfString(chip) + 18;
    const cx = W - M - cw;
    doc.save().roundedRect(cx, 98, cw, 18, 9).fill('#ffffff').restore();
    doc.fillColor(C.brand).text(chip, cx, 101, { width: cw, align: 'center', lineBreak: false });
  }
  doc.fillColor(C.ink).font('R');
  return 136;
}

/**
 * The footer on every page: when this copy was generated, and whose product it
 * is. Drawn after the content, over buffered pages, so a document that runs to
 * a second page carries it on both.
 */
function footer(doc, { generated, pageOf, productLine }) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const W = doc.page.width;
    const M = doc.page.margins.left;
    const y = doc.page.height - 50;
    /* The footer sits inside the bottom margin; lift the margin while drawing so
       PDFKit does not treat it as overflow and start a page for it. */
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.save().moveTo(M, y).lineTo(W - M, y).lineWidth(0.6).stroke(C.line).restore();
    doc.font('R').fontSize(8).fillColor(C.muted)
       .text(generated, M, y + 7, { width: 300, lineBreak: false });
    doc.text(pageOf(i - range.start + 1, range.count), W - M - 100, y + 7,
      { width: 100, align: 'right', lineBreak: false });
    doc.font('B').fontSize(8.5).fillColor(C.brand)
       .text(productLine, M, y + 20, { width: W - 2 * M, align: 'center', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
}

/**
 * A titled key/value table with gridlines. Returns the y below it.
 * Values may wrap; each row takes the height its longest cell needs.
 */
function kvTable(doc, x, y, w, title, rows, { labelW = 0.42, pad = 4, fs = 8.5 } = {}) {
  const lw = Math.round(w * labelW);
  const vw = w - lw;

  doc.font('B').fontSize(8.5).fillColor(C.brand2)
     .text(title.toUpperCase(), x, y, { width: w, characterSpacing: 0.8, lineBreak: false });
  y += 13;

  rows.forEach(([k, v, opts = {}]) => {
    const vs = opts.size || fs;
    doc.font('R').fontSize(fs - 0.5);
    const kh = doc.heightOfString(String(k), { width: lw - 2 * pad });
    doc.font('B').fontSize(vs);
    const vh = doc.heightOfString(String(v ?? '—'), { width: vw - 2 * pad });
    const h = Math.max(kh, vh) + 2 * pad;

    doc.save().rect(x, y, lw, h).fill(opts.highlight ? '#dcf5e8' : C.shade).restore();
    if (opts.highlight) doc.save().rect(x + lw, y, vw, h).fill('#dcf5e8').restore();
    doc.save().rect(x, y, w, h).lineWidth(0.6).stroke(C.line).restore();
    doc.save().moveTo(x + lw, y).lineTo(x + lw, y + h).lineWidth(0.6).stroke(C.line).restore();

    doc.font('R').fontSize(fs - 0.5).fillColor(C.muted).text(String(k), x + pad, y + pad, { width: lw - 2 * pad });
    doc.font('B').fontSize(vs).fillColor(opts.color || C.ink)
       .text(String(v ?? '—'), x + lw + pad, y + pad, { width: vw - 2 * pad, align: opts.align || 'left' });
    y += h;
  });
  doc.fillColor(C.ink).font('R');
  return y + 10;
}

/** A tinted note box with a heading. Returns the y below it. */
function noteBox(doc, x, y, w, { title, lines, bg = C.okbg, fg = C.ok, fs = 8, minH = 0 }) {
  const pad = 8;
  doc.font('R').fontSize(fs);
  const body = lines.map((l) => `•  ${l}`).join('\n');
  const bh = doc.heightOfString(body, { width: w - 2 * pad - 2, lineGap: 1.5 });
  const h = Math.max(minH, bh + 2 * pad + 14);
  doc.save().roundedRect(x, y, w, h, 6).fill(bg).restore();
  doc.save().rect(x, y, 3, h).fill(fg).restore();
  doc.font('B').fontSize(9).fillColor(fg).text(title, x + pad + 2, y + pad, { width: w - 2 * pad, lineBreak: false });
  doc.font('R').fontSize(fs).fillColor(C.ink)
     .text(body, x + pad + 2, y + pad + 14, { width: w - 2 * pad - 2, lineGap: 1.5 });
  return y + h + 10;
}

/** Height a noteBox would take, so two can be drawn side by side at equal height. */
function noteHeight(doc, w, lines, fs = 8) {
  doc.font('R').fontSize(fs);
  const body = lines.map((l) => `•  ${l}`).join('\n');
  return doc.heightOfString(body, { width: w - 18, lineGap: 1.5 }) + 30;
}

module.exports = {
  C, newDoc, toBuffer, header, footer, kvTable, noteBox, noteHeight,
  istDateTime, longDate, rupee, maskMobile, ZONE,
};
