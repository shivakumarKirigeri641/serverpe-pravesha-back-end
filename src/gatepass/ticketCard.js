/**
 * ticketCard.js — the image a visitor actually holds up at the barrier.
 *
 * What arrives on WhatsApp has to look like a government ticket at a glance,
 * from a metre away — it is the thing a visitor opens at 7 a.m. to check they
 * are at the right place on the right day, and the thing they show a relative
 * who asks whether it is genuine.
 *
 * So the card is composed rather than dumped:
 *
 *   the issuing authority at the top — the visitor is entering a state tourism
 *   site, and that is whose ticket this is;
 *
 *   THE NUMBER PLATE in the middle, as large as the card allows. It is the
 *   only thing at the barrier that matters: the staff member reads the last few
 *   characters off the bumper, types them, and the gate answers. The plate is
 *   printed here so the visitor can confirm at a glance that the booking is for
 *   the vehicle they actually brought — which is the one mistake that cannot be
 *   fixed at the gate;
 *
 *   the visit — place, date, entry time — beneath it;
 *
 *   one line telling the visitor there is nothing to show and to let the staff
 *   member type the number;
 *
 *   and the vendor line at the bottom, small.
 *
 * THERE IS NO QR CODE, and that is the point. A ticket is bound to a vehicle,
 * not to a person, so the plate was always the thing being checked and the code
 * was an elaborate way of restating it. Removing it also removed every failure
 * that had nothing to do with entry — a flat battery, a cracked screen, a
 * deleted chat, sunlight on glass. What the visitor now receives is a receipt,
 * not a credential.
 */

const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
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
const H = 1180;
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
  warn: '#8a2b20',
};

/**
 * The plate, spaced for reading.
 *
 * Stored unspaced everywhere — one vehicle is one string, and "KA31N8147" and
 * "KA 31 N 8147" must never become two rows. But this is the one place a human
 * reads it off a screen at arm's length and compares it to a bumper, and the
 * grouped form is materially easier to check. Anything that does not parse as a
 * modern plate (an old MYE 3033, a Bharat series) is left exactly as it is.
 */
function plateGroups(reg) {
  const s = String(reg || '').toUpperCase();
  const m = s.match(/^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/);
  return m ? [m[1], m[2], m[3], m[4]].filter(Boolean).join(' ') : s;
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

/**
 * A centred paragraph, wrapped to a width.
 *
 * Canvas has no text box, so the breaking is done here. Words are joined back
 * into whole lines before drawing — never character by character — because a
 * Kannada line drawn glyph at a time loses its vowel signs, and because this is
 * the one paragraph on the card that a visitor actually reads.
 */
function wrap(ctx, text, y, maxWidth, { font, color, lineHeight = 20 }) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';

  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = w; }
    else line = next;
  }
  if (line) lines.push(line);

  lines.forEach((l, i) => ctx.fillText(l, W / 2, y + i * lineHeight));
  return y + lines.length * lineHeight;
}

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
 *           category_label and ticket_no; maker and model if the RC knew them
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

  /* ── The plate ──────────────────────────────────────────────────────── */

  /* The hero of the card, because it is the only thing checked at the barrier.
     Framed and set large enough to read from the passenger seat: the visitor's
     job here is to notice, before they set off, that the booking is for the
     vehicle they actually brought. That is the one mistake the gate cannot fix
     for them — a booking against a plate that is sitting in the driveway at
     home is a booking nobody can honour. */
  const PB = { x: 70, y: BAND + 130, w: W - 140, h: 132 };

  ctx.fillStyle = '#f4f8f7';
  ctx.fillRect(PB.x, PB.y, PB.w, PB.h);
  ctx.strokeStyle = C.band;
  ctx.lineWidth = 2;
  ctx.strokeRect(PB.x + 1, PB.y + 1, PB.w - 2, PB.h - 2);

  centre(ctx, kn('vehicle_number'), PB.y + 30,
    { font: '600 13px NotoKannada, Segoe UI, sans-serif', color: C.muted });

  /* Sized to fit rather than fixed: KA31N8147 and 22 BH 1234 AA are different
     lengths, and a plate that overflows its frame looks like a fault. */
  const plate = plateGroups(t.reg_no);
  let plateSize = 54;
  ctx.font = `700 ${plateSize}px Segoe UI, Arial, sans-serif`;
  while (ctx.measureText(plate).width > PB.w - 48 && plateSize > 28) {
    plateSize -= 2;
    ctx.font = `700 ${plateSize}px Segoe UI, Arial, sans-serif`;
  }
  centre(ctx, plate, PB.y + 92,
    { font: `700 ${plateSize}px Segoe UI, Arial, sans-serif`, color: C.ink, spacing: 2 });

  centre(ctx, [t.maker, t.model].filter(Boolean).join(' ') || t.category_label,
    PB.y + 118, { font: '13px Segoe UI, Arial, sans-serif', color: C.muted });

  /* ── The visit ──────────────────────────────────────────────────────── */

  let y = PB.y + PB.h + 46;

  ctx.strokeStyle = C.rule;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(60, y - 26); ctx.lineTo(W - 60, y - 26); ctx.stroke();

  /* Two columns, because date and time are read together and a stacked list of
     four labels is slower to scan than two pairs side by side. */
  const col = (x, knLabel, enLabel, value) => {
    ctx.textAlign = 'center';
    ctx.font = '11px NotoKannada, Segoe UI, sans-serif';
    ctx.fillStyle = C.muted;
    ctx.fillText(knLabel, x, y);
    ctx.font = '600 8.5px Segoe UI, Arial, sans-serif';
    ctx.fillText(enLabel, x, y + 15);
    ctx.font = '600 19px Segoe UI, Arial, sans-serif';
    ctx.fillStyle = C.ink;
    ctx.fillText(value, x, y + 42);
  };

  col(W * 0.30, kn('travel_date'), 'DATE', shortDate(t.travel_date));
  col(W * 0.70, kn('entry_time'), 'ENTRY TIME', slotShort(t.slot_label));

  y += 78;
  col(W * 0.30, kn('vehicle_type'), 'VEHICLE TYPE', t.category_label);
  col(W * 0.70, kn('booking_code'), 'BOOKING CODE', t.ticket_no);

  /* ── What the visitor has to do ─────────────────────────────────────── */

  /* Cleared of the value row above by a full line, not by a few pixels: the
     tinted panel drawn below starts at y-26, and a gap measured too finely put
     its top edge through the descenders of "Car / Jeep / SUV". */
  y += 112;

  ctx.fillStyle = '#eef5f3';
  ctx.fillRect(50, y - 28, W - 100, 150);

  centre(ctx, kn('nothing_to_show'), y,
    { font: '600 17px NotoKannadaBold, NotoKannada, Segoe UI, sans-serif', color: C.band });
  centre(ctx, 'NOTHING TO SHOW AT THE GATE', y + 20,
    { font: '600 9px Segoe UI, Arial, sans-serif', color: C.muted, spacing: 2.2 });

  const after = wrap(ctx, kn('staff_will_type'), y + 44, W - 140,
    { font: '13px NotoKannada, Segoe UI, sans-serif', color: C.ink, lineHeight: 20 });

  /* THE WARNING THAT EARNS ITS PLACE INSIDE THE PANEL: arriving in a different
     vehicle from the one booked is the single mistake the gate cannot fix, so
     it sits with the instruction rather than down among the conditions. */
  centre(ctx, kn('bring_this_vehicle'), after + 16,
    { font: '600 13.5px NotoKannadaBold, NotoKannada, Segoe UI, sans-serif', color: C.warn });
  centre(ctx, 'BRING THIS VEHICLE — ANOTHER VEHICLE WILL NOT BE ALLOWED IN',
    after + 35, { font: '600 9px Segoe UI, Arial, sans-serif', color: C.warn, spacing: 1.1 });

  /* ── The conditions ─────────────────────────────────────────────────── */

  /* Flowed from a running y rather than placed at fixed offsets, because the
     Kannada wraps to a different number of lines than the English and a fixed
     layout would collide on one of them. */
  y = after + 78;

  centre(ctx, 'PLEASE NOTE', y,
    { font: '600 9.5px Segoe UI, Arial, sans-serif', color: C.muted, spacing: 2.4 });
  y += 22;

  for (const [knKey, en] of [
    ['note_only_number',
      'The checkpost checks only your vehicle number. Make sure you booked with the '
      + 'number plate of the vehicle you will actually bring.'],
    ['note_no_swap',
      'Do not change the vehicle at the last moment. This number is what the staff '
      + 'enter and validate at the checkpost — a different vehicle will not be allowed in.'],
    ['note_one_entry', 'One entry per vehicle per day.'],
  ]) {
    y = wrap(ctx, kn(knKey), y, W - 120,
      { font: '12px NotoKannada, Segoe UI, sans-serif', color: C.ink, lineHeight: 19 });
    y = wrap(ctx, en, y + 2, W - 120,
      { font: '10.5px Segoe UI, Arial, sans-serif', color: C.muted, lineHeight: 15 });
    y += 12;
  }

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

module.exports = { render, plateGroups };
