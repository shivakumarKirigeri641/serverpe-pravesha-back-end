/**
 * ogimage.js — the picture that appears when a Pravesha link is shared or
 * advertised.
 *
 *   GET /public/og.jpg          the site card
 *   GET /public/og.jpg?t=…&s=…  a card with its own title and subtitle
 *
 * WhatsApp, X, LinkedIn and every ad preview show this image, not the page. A
 * link with no card is a grey box with a domain name; a link with one is the
 * hills, the name and one line of promise. It is worth composing properly.
 *
 * Drawn with @napi-rs/canvas from the same photographs the site uses, at the
 * 1200×630 every platform crops to, and cached on disk: composed once, served
 * from the file afterwards.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const router = express.Router();

const IMAGES = path.join(__dirname, '..', 'images', 'marketingsite');
const ICON = path.join(__dirname, '..', '..', 'assets', 'logos', 'pravesha-icon-256.png');
const FONTS = path.join(__dirname, '..', '..', 'assets', 'fonts');
const CACHE = path.join(IMAGES, '.resized');

const W = 1200;
const H = 630;

const DEFAULT_TITLE = 'Entry passes for Karnataka’s destinations';
const DEFAULT_SUB = 'Book on WhatsApp in about a minute. No app, no queue, no printout.';

let fontsReady = false;
function ensureFonts() {
  if (fontsReady) return;
  const { GlobalFonts } = require('@napi-rs/canvas');
  for (const [file, name] of [
    ['NotoSans-Bold.ttf', 'PravBold'],
    ['NotoSans-Regular.ttf', 'PravRegular'],
    /* Latin fonts have no Kannada glyphs, and a missing glyph draws as a row of
       boxes — worse than leaving the word out. */
    ['NotoSansKannada-Regular.ttf', 'PravKannada'],
  ]) {
    const p = path.join(FONTS, file);
    if (fs.existsSync(p)) GlobalFonts.registerFromPath(p, name);
  }
  fontsReady = true;
}

/** Wrap to a width, in as many lines as allowed, ellipsising the rest. */
function wrap(ctx, text, maxWidth, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth || !line) { line = next; continue; }
    lines.push(line);
    line = word;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines) {
    while (lines[maxLines - 1] && ctx.measureText(`${lines[maxLines - 1]}…`).width > maxWidth) {
      lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S+$/, '');
    }
  }
  return lines;
}

async function compose({ photo, title, sub }) {
  ensureFonts();
  const { createCanvas, loadImage } = require('@napi-rs/canvas');
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  /*
   * DRAWN, NOT PHOTOGRAPHED (user, 2026-09-17), until the real photographs are
   * supplied: a dawn sky and five ridges, the same scene the website draws.
   * `photo` still picks a variation, so each card keeps its own look.
   */
  const v = Number(photo) % 4;
  const skies = [['#fde7c3', '#9ed4c4'], ['#e8f1ff', '#a9d8c6'], ['#ffe0d1', '#b9d9c9'], ['#e6f4ea', '#8fcbb6']][v];
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, skies[0]);
  sky.addColorStop(1, skies[1]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  const ridges = ['#a7cfc2', '#6fae9a', '#3f8a74', '#1f6552', '#0f3a2f'];
  ridges.forEach((colour, i) => {
    const base = H * (0.38 + i * 0.12);
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(0, base);
    for (let x = 0; x <= W; x += 40) {
      ctx.lineTo(x, base - 34 * Math.sin((x / W) * Math.PI * (2 + i) + v + i) - 18 * Math.cos((x / W) * Math.PI * 5 + i));
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fillStyle = colour;
    ctx.fill();
  });

  /* Dark from the bottom-left, so white type sits on it at any crop. */
  const shade = ctx.createLinearGradient(0, H, W * 0.9, 0);
  shade.addColorStop(0, 'rgba(5,44,38,0.94)');
  shade.addColorStop(0.55, 'rgba(7,63,55,0.72)');
  shade.addColorStop(1, 'rgba(10,60,50,0.25)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);

  /* The mark and the name. */
  try {
    const icon = await loadImage(ICON);
    const size = 64;
    ctx.save();
    ctx.beginPath();
    const r = 16;
    const x = 72; const y = 62;
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + size, y, x + size, y + size, r);
    ctx.arcTo(x + size, y + size, x, y + size, r);
    ctx.arcTo(x, y + size, x, y, r);
    ctx.arcTo(x, y, x + size, y, r);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(icon, x, y, size, size);
    ctx.restore();
  } catch { /* the name carries it alone */ }

  ctx.fillStyle = '#ffffff';
  ctx.font = '600 38px PravBold, sans-serif';
  ctx.fillText('Pravesha', 152, 108);

  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.font = '26px PravKannada, PravRegular, sans-serif';
  ctx.fillText('ಪ್ರವೇಶ', 152, 142);

  /* The promise. */
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 62px PravBold, sans-serif';
  const titleLines = wrap(ctx, title, W - 144, 3);
  let y = H - 190 - (titleLines.length - 1) * 72;
  for (const line of titleLines) { ctx.fillText(line, 72, y); y += 72; }

  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '30px PravRegular, sans-serif';
  ctx.fillText(wrap(ctx, sub, W - 144, 1)[0] || '', 72, H - 96);

  /* A WhatsApp-green rule, the one brand cue that survives a thumbnail. */
  ctx.fillStyle = '#25d366';
  ctx.fillRect(72, H - 62, 120, 6);

  return canvas.encode('jpeg', 86);
}

router.get(['/public/og.jpg', '/public/og.png'], async (req, res) => {
  const title = String(req.query.t || DEFAULT_TITLE).slice(0, 120);
  const sub = String(req.query.s || DEFAULT_SUB).slice(0, 140);
  const photo = /^[1-5]$/.test(String(req.query.p)) ? String(req.query.p) : '4';

  const key = crypto.createHash('sha1').update(`drawn|${photo}|${title}|${sub}`).digest('hex').slice(0, 16);
  const cached = path.join(CACHE, `og-${key}.jpg`);

  try {
    let buf;
    if (fs.existsSync(cached)) {
      buf = await fs.promises.readFile(cached);
    } else {
      buf = await compose({ photo, title, sub });
      await fs.promises.mkdir(CACHE, { recursive: true });
      await fs.promises.writeFile(cached, buf);
      console.log('[og] composed %s (%dKB)', key, Math.round(buf.length / 1024));
    }
    res.set({
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
    }).send(buf);
  } catch (e) {
    console.error('[og] %s', e.message);
    res.status(500).json({ success: false, error: 'og_failed' });
  }
});

module.exports = router;
