/**
 * scripts/make-brand-logo.js — the Pravesha mark and lockup, at every size.
 *
 *   node scripts/make-brand-logo.js
 *
 * Drawn with canvas rather than rasterised from an SVG, for one reason: the
 * monogram is Kannada. SVG text is rendered by the image loader's own font
 * stack, which has no Kannada face and silently draws empty boxes — a failure
 * that looks fine in the build log and wrong on the ticket. Registering the
 * bundled Noto Sans Kannada with the canvas and drawing the glyph directly is
 * the only way to be sure of what comes out.
 *
 * THE MARK keeps the badge, the teal gradient and the verify check from the
 * house style, so Pravesha still looks like it came from the same shop as the
 * other products. What changes is the monogram: ಪ್ರ — the first syllable of
 * ಪ್ರವೇಶ. A Karnataka government product whose own mark is in Kannada is making
 * the point without saying anything.
 *
 * THE LOCKUP carries no tagline. The house tagline belongs to ServerPe and is
 * already on the ticket footer under "Powered by".
 */

const fs = require('fs');
const path = require('path');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'logos');
const FONTS = path.join(ROOT, 'assets', 'fonts');
fs.mkdirSync(OUT, { recursive: true });

const KN_FONT = 'Noto Sans Kannada';
let hasKannada = false;
for (const f of ['NotoSansKannada-Bold.ttf', 'NotoSansKannada-Regular.ttf']) {
  const p = path.join(FONTS, f);
  if (fs.existsSync(p)) { GlobalFonts.registerFromPath(p, KN_FONT); hasKannada = true; }
}

const TEAL_TOP = '#0A9E8E';
const TEAL_BOT = '#075E54';
const MINT = '#3BE8B0';
const INK = '#0F172A';
const ACCENT = '#00A884';

/** The badge: rounded square, gradient, Kannada monogram, verify check. */
function mark(size) {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  const S = size / 512;                       // everything below is in 512-space

  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, TEAL_TOP);
  g.addColorStop(1, TEAL_BOT);
  ctx.fillStyle = g;
  roundRect(ctx, 0, 0, size, size, 116 * S);
  ctx.fill();

  // The monogram sits high so the check has room beneath it without crowding.
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  if (hasKannada) {
    ctx.font = `700 ${Math.round(188 * S)}px "${KN_FONT}"`;
    ctx.fillText("ಪ್ರ", size / 2, 300 * S);
  } else {
    // Only reached if the font is missing; better a Latin P than empty boxes.
    ctx.font = `900 ${Math.round(250 * S)}px Arial, Helvetica, sans-serif`;
    ctx.fillText('P', size / 2, 330 * S);
  }

  ctx.strokeStyle = MINT;
  ctx.lineWidth = 28 * S;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(122 * S, 396 * S);
  ctx.lineTo(214 * S, 436 * S);
  ctx.lineTo(400 * S, 354 * S);
  ctx.stroke();

  return c;
}

/** Badge on the left, "Pravesha" beside it. No tagline. */
function lockup(width) {
  const H = Math.round(width * 0.2);          // 800 x 160 proportions
  const c = createCanvas(width, H);
  const ctx = c.getContext('2d');
  const S = width / 800;

  const badge = mark(Math.round(128 * S));
  ctx.drawImage(badge, Math.round(24 * S), Math.round(16 * S));

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = INK;
  ctx.font = `700 ${Math.round(62 * S)}px "Segoe UI", Arial, Helvetica, sans-serif`;
  ctx.fillText('Pravesha', Math.round(180 * S), Math.round(102 * S));

  if (hasKannada) {
    const w = ctx.measureText('Pravesha').width;
    ctx.fillStyle = ACCENT;
    ctx.font = `400 ${Math.round(40 * S)}px "${KN_FONT}"`;
    ctx.fillText('ಪ್ರವೇಶ', Math.round(180 * S) + w + Math.round(20 * S), Math.round(100 * S));
  }
  return c;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const ICONS = [16, 32, 48, 64, 128, 180, 192, 256, 512, 1024];
const WIDTHS = [40, 64, 96, 128, 192, 256, 384, 512, 768, 1024];

let n = 0;
for (const s of ICONS) {
  fs.writeFileSync(path.join(OUT, `pravesha-icon-${s}.png`), mark(s).toBuffer('image/png'));
  n++;
}
for (const w of WIDTHS) {
  fs.writeFileSync(path.join(OUT, `pravesha-${w}.png`), lockup(w).toBuffer('image/png'));
  n++;
}

console.log(`\n  wrote ${n} files to assets/logos/`);
console.log(`  Kannada monogram: ${hasKannada ? 'yes (ಪ್ರ)' : 'NO — font missing, fell back to "P"'}\n`);
