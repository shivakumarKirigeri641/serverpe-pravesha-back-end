/**
 * ticketCard.js — the image a visitor actually holds up at the barrier.
 *
 * A bare QR code was the first version and it was wrong. What arrives on
 * WhatsApp is the thing a person shows to a uniformed officer at 7 a.m.: it has
 * to look official at a glance, from a metre away, before anyone scans
 * anything.
 *
 * So the card is composed rather than dumped:
 *
 *   the issuing authority at the top — the visitor is entering a state tourism
 *   site, and that is whose ticket this is;
 *
 *   the QR in the middle, DELIBERATELY NOT HUGE. A 140-character payload at
 *   this size still scans instantly, and leaving air around it makes the card
 *   read as a document rather than as a barcode;
 *
 *   a verification code beneath it — visible, meaningless to a reader, and
 *   derived from the signature so that it changes whenever the ticket does. It
 *   exists to be looked at, not decoded;
 *
 *   and the vendor line at the bottom, small.
 *
 * Rendered at 2x and drawn at whole pixels, because a QR resampled by a
 * messaging app is a QR that stops scanning.
 */

const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const QRCode = require('qrcode');
const crypto = require('crypto');
const path = require('path');
const { kn } = require('./kn');

/*
 * Kannada needs a font that has Kannada in it, and neither the PDF base
 * fourteen nor a Linux server's default set does. The face is bundled with the
 * repository rather than installed on the machine, so the ticket looks
 * identical on a laptop in Chikkamagaluru and on a server in a data centre.
 */
const FONT_DIR = path.join(__dirname, '..', '..', 'assets', 'fonts');
const LOGO_DIR = path.join(__dirname, '..', '..', 'assets', 'logos');

/* Logos are read once and kept. A ticket render happens while a customer is
   watching a chat window, and re-reading two PNGs from disk each time is
   latency spent for nothing. */
const logoCache = new Map();
async function logo(name) {
  if (logoCache.has(name)) return logoCache.get(name);
  const file = path.join(LOGO_DIR, name);
  let img = null;
  try { img = await loadImage(require('fs').readFileSync(file)); }
  catch { console.warn('[ticket] logo missing:', name); }
  logoCache.set(name, img);
  return img;
}
GlobalFonts.registerFromPath(path.join(FONT_DIR, 'NotoSansKannada-Regular.ttf'), 'NotoKannada');
GlobalFonts.registerFromPath(path.join(FONT_DIR, 'NotoSansKannada-Bold.ttf'), 'NotoKannadaBold');

/* Logical size; everything below is in these units and scaled at the end. */
const W = 620;
const H = 1000;
const SCALE = 2;

const C = {
  ink: '#0d1a18',
  paper: '#ffffff',
  band: '#0f4f48',
  bandText: '#ffffff',
  bandSub: '#9ecfc9',
  muted: '#6b7975',
  rule: '#d9e0dd',
  code: '#0f4f48',
  footer: '#8b9793',
};

/**
 * The visible verification code.
 *
 * Taken from the ticket's own signature, so it cannot be produced without the
 * private key and it changes the moment anything about the ticket changes — a
 * postponed ticket gets a new one, which is exactly right.
 *
 * Grouped in fours because that is how people read a code aloud over a phone,
 * and drawn from an alphabet without O/0 or I/1 for the same reason.
 */
function verificationCode(qrPayload) {
  const sig = String(qrPayload).split('|').pop() || '';
  const digest = crypto.createHash('sha256').update(sig).digest();
  const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  let out = '';
  for (let i = 0; i < 16; i++) {
    out += ALPHABET[digest[i] % ALPHABET.length];
    if (i % 4 === 3 && i !== 15) out += ' ';
  }
  return out;
}

/**
 * Centre a line of text.
 *
 * Letter-spacing is done by hand because canvas has no property for it, and
 * wide-set capitals are most of what makes the card look official.
 *
 * BUT NEVER ON KANNADA. Kannada is written with combining vowel signs and
 * reordered glyphs: drawing it character by character pulls those marks away
 * from the consonants they belong to and produces something that is not
 * merely ugly but unreadable. So any string outside the Latin range is drawn
 * as one run and lets the text shaper do its job.
 */
const isLatin = (s) => /^[\x20-\x7E]*$/.test(s);

function centre(ctx, text, y, { font, color, spacing = 0 }) {
  ctx.font = font;
  ctx.fillStyle = color;

  if (!spacing || !isLatin(text)) {
    ctx.textAlign = 'center';
    ctx.fillText(text, W / 2, y);
    return y;
  }

  ctx.textAlign = 'left';
  const chars = [...text];
  const width = chars.reduce((n, ch) => n + ctx.measureText(ch).width + spacing, -spacing);
  let x = (W - width) / 2;
  for (const ch of chars) {
    ctx.fillText(ch, x, y);
    x += ctx.measureText(ch).width + spacing;
  }
  return y;
}

/**
 * Build the PNG.
 *
 * @param t  a ticket row with place_name, reg_no, travel_date, slot_label,
 *           category_label, ticket_no and qr_payload
 * @param cfg  app_settings, for the authority line and the vendor line
 */
async function render(t, cfg = {}) {
  const canvas = createCanvas(W * SCALE, H * SCALE);
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);

  /* Card */
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, W, H);

  /* ── Authority ──────────────────────────────────────────────────────── */

  /* The state emblem, then the department's name and tagline set as text.
     The supplied artwork is a letterhead block — emblem, wordmark, department
     name and the word "ಅರ್ಪಿಸುವ" — which is right on a poster and wrong on a
     ticket. The emblem is the part that carries authority; the rest is
     typography, and typography we can set at the size a ticket needs. */
  const emblem = await logo('karnataka-tourism-emblem-256.png');
  const EM = 82;
  if (emblem) {
    ctx.drawImage(emblem, Math.round((W - EM) / 2), 24, EM,
      Math.round(EM * (emblem.height / emblem.width)));
  }

  let head = emblem ? 24 + Math.round(EM * (emblem.height / emblem.width)) + 22 : 46;

  centre(ctx, cfg.collecting_for_kn || kn('department'), head,
    { font: '600 20px NotoKannadaBold, NotoKannada, Segoe UI, sans-serif', color: C.ink });
  centre(ctx, cfg.authority_tagline || kn('tagline'), head + 24,
    { font: '15px NotoKannada, Segoe UI, sans-serif', color: C.muted });
  centre(ctx, (cfg.collecting_for || 'Karnataka Tourism Department').toUpperCase(), head + 44,
    { font: '600 9.5px Segoe UI, Arial, sans-serif', color: C.muted, spacing: 2 });

  const BAND = head + 62;

  ctx.fillStyle = C.band;
  ctx.fillRect(0, BAND, W, 60);

  centre(ctx, kn('vehicle_entry_ticket'), BAND + 25,
    { font: '600 19px NotoKannadaBold, NotoKannada, Segoe UI, sans-serif', color: C.bandText });
  centre(ctx, 'VEHICLE ENTRY TICKET', BAND + 46,
    { font: '600 10.5px Segoe UI, Arial, sans-serif', color: C.bandSub, spacing: 3 });

  /* ── Site ───────────────────────────────────────────────────────────── */

  centre(ctx, t.place_name, BAND + 100,
    { font: '600 26px Segoe UI, Arial, sans-serif', color: C.ink });

  /* ── The QR ─────────────────────────────────────────────────────────── */

  const QR = 300;
  const qrPng = await QRCode.toBuffer(t.qr_payload, {
    errorCorrectionLevel: 'L', type: 'png', margin: 1, scale: 10,
    color: { dark: '#0d1a18', light: '#ffffff' },
  });

  // loadImage, not `new Image().src = buffer` — the latter returns before the
  // bytes are decoded, and drawImage then quietly paints nothing at all. A
  // ticket that renders with a blank square where its QR should be is the worst
  // possible failure here, because it looks fine until someone tries to scan it.
  const img = await loadImage(qrPng);

  const qx = Math.round((W - QR) / 2);
  const qy = BAND + 134;

  // A hairline frame: it separates the code from the paper on a bright screen
  // and stops a scanner from wandering off the edge of it.
  ctx.strokeStyle = C.rule;
  ctx.lineWidth = 1;
  ctx.strokeRect(qx - 14.5, qy - 14.5, QR + 29, QR + 29);
  ctx.drawImage(img, qx, qy, QR, QR);

  /* Kannada first, English under it — the rule the whole ticket follows. */
  centre(ctx, kn('show_at_checkpost'), qy + QR + 42,
    { font: '600 15px NotoKannadaBold, NotoKannada, Segoe UI, sans-serif', color: C.ink });
  centre(ctx, 'SHOW THIS AT THE CHECKPOST', qy + QR + 62,
    { font: '600 10px Segoe UI, Arial, sans-serif', color: C.muted, spacing: 2.4 });

  /* ── The verification code ──────────────────────────────────────────── */

  let y = qy + QR + 116;

  ctx.strokeStyle = C.rule;
  ctx.beginPath(); ctx.moveTo(60, y - 26); ctx.lineTo(W - 60, y - 26); ctx.stroke();

  centre(ctx, kn('secure_code'), y,
    { font: '600 13px NotoKannada, Segoe UI, sans-serif', color: C.muted });
  centre(ctx, 'SECURE VERIFICATION CODE', y + 18,
    { font: '600 9px Segoe UI, Arial, sans-serif', color: C.muted, spacing: 2.2 });

  centre(ctx, verificationCode(t.qr_payload), y + 52,
    { font: '600 25px Consolas, "Courier New", monospace', color: C.code, spacing: 1.5 });

  centre(ctx, kn('ticket_no'), y + 78,
    { font: '12px NotoKannada, Segoe UI, sans-serif', color: C.muted });
  centre(ctx, `TICKET  ${t.ticket_no}`, y + 96,
    { font: '600 13px Consolas, "Courier New", monospace', color: C.muted, spacing: 2 });

  /* One line of human detail. The visitor is standing at a barrier and needs to
     know this is the right day without opening the PDF. */
  centre(ctx, `${spaced(t.reg_no)}   ·   ${shortDate(t.travel_date)}   ·   ${slotShort(t.slot_label)}`,
    y + 130, { font: '600 16px Segoe UI, Arial, sans-serif', color: C.ink });

  /* ── Footer ─────────────────────────────────────────────────────────── */

  const F = H - 74;
  ctx.fillStyle = '#f2f5f4';
  ctx.fillRect(0, F, W, 74);

  const mark = await logo('serverpe-icon-64.png');
  /* "EntryPe - Powered by: ServerPe App Solutions." — the product carries the
     ticket, the firm stands behind it. Both come from settings so a rename is
     one row in the database, not a hunt through the drawing code. */
  const label = `${cfg.product_name || 'EntryPe'} - Powered by: `
              + `${cfg.merchant_name || 'ServerPe App Solutions'}`;
  ctx.font = '600 12px Segoe UI, Arial, sans-serif';
  const labelW = ctx.measureText(label).width;
  const markSize = mark ? 26 : 0;
  const startX = (W - (labelW + markSize + (mark ? 8 : 0))) / 2;

  if (mark) ctx.drawImage(mark, startX, F + 18, markSize, markSize);
  ctx.textAlign = 'left';
  ctx.fillStyle = C.band;
  ctx.fillText(label, startX + markSize + (mark ? 8 : 0), F + 35);

  centre(ctx, cfg.vendor_tagline || 'Smart Clicks, Smart Taps.', F + 58,
    { font: 'italic 12px Georgia, serif', color: C.footer });

  return canvas.toBuffer('image/png');
}

const spaced = (reg) => String(reg)
  .replace(/([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})/, '$1 $2 $3 $4')
  .replace(/\s+/g, ' ').trim();

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shortDate(d) {
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
  return `${day} ${MON[m - 1]} ${y}`;
}

/** "6:00 AM - 12:00 PM" -> "6 AM - 12 PM", which fits on one line. */
const slotShort = (label) => String(label || '')
  .replace(/:00/g, '').replace(/\s+/g, ' ').trim();

module.exports = { render, verificationCode };
