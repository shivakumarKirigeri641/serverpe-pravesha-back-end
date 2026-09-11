/**
 * media.js — the website's photographs, resized on demand.
 *
 *   GET /public/img/:name.webp?w=1280   a WebP at that width (or the nearest one)
 *   GET /public/img/:name.png           the original, as a fallback
 *
 * The originals live in src/images/marketingsite and are large — one of them is
 * 2 MB, which is a poor thing to send to somebody on a phone halfway up a ghat
 * road. Each requested width is rendered once with @napi-rs/canvas (already a
 * dependency, for the pass PDFs), written to a cache directory and served from
 * there afterwards: 1.5 MB becomes about 46 KB at 640px.
 *
 * ONLY THE FILES WE SHIPPED. The name is matched against the directory listing
 * at startup, so no path a visitor invents can reach anything else, and only a
 * fixed set of widths is rendered — an open resizer is a way to spend a server's
 * CPU for free.
 *
 * The bytes are immutable: a different photograph gets a different name rather
 * than replacing one in place, so responses are cached for a year.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const router = express.Router();

const DIR = path.join(__dirname, '..', 'images', 'marketingsite');
const CACHE = path.join(DIR, '.resized');
const WIDTHS = [480, 768, 1024, 1400, 1920];
const QUALITY = 78;
const YEAR = 60 * 60 * 24 * 365;

/* What exists, read once. A photograph added to the folder needs a restart,
   which is the same as any other asset the server ships. */
const originals = new Map();
try {
  for (const file of fs.readdirSync(DIR)) {
    const m = /^([\w-]+)\.(png|jpe?g|webp)$/i.exec(file);
    if (m) originals.set(m[1].toLowerCase(), path.join(DIR, file));
  }
} catch (e) {
  console.warn('[media] no marketing images: %s', e.message);
}

const nearest = (want) => WIDTHS.reduce((best, w) =>
  (Math.abs(w - want) < Math.abs(best - want) ? w : best), WIDTHS[WIDTHS.length - 1]);

async function variant(name, width) {
  const source = originals.get(name);
  const out = path.join(CACHE, `${name}-${width}.webp`);
  if (fs.existsSync(out)) return fs.promises.readFile(out);

  const { loadImage, createCanvas } = require('@napi-rs/canvas');
  const img = await loadImage(source);
  const w = Math.min(width, img.width);
  const h = Math.round((w / img.width) * img.height);

  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  const buf = await canvas.encode('webp', QUALITY);

  await fs.promises.mkdir(CACHE, { recursive: true });
  await fs.promises.writeFile(out, buf);
  console.log('[media] rendered %s at %dpx (%dKB)', name, w, Math.round(buf.length / 1024));
  return buf;
}

function serve(res, buf, type) {
  const etag = `"${crypto.createHash('sha1').update(buf).digest('base64url').slice(0, 20)}"`;
  res.set({
    'Content-Type': type,
    'Cache-Control': `public, max-age=${YEAR}, immutable`,
    ETag: etag,
    'Access-Control-Allow-Origin': '*',
  });
  res.send(buf);
}

router.get('/public/img/:file', async (req, res) => {
  const m = /^([\w-]+)\.(webp|png|jpe?g)$/i.exec(String(req.params.file));
  if (!m) return res.status(404).json({ success: false, error: 'not_found' });

  const name = m[1].toLowerCase();
  const ext = m[2].toLowerCase();
  if (!originals.has(name)) return res.status(404).json({ success: false, error: 'not_found' });

  try {
    if (ext === 'webp') {
      const width = nearest(Number(req.query.w) || 1024);
      return serve(res, await variant(name, width), 'image/webp');
    }
    /* The original, for a browser without WebP — every current one has it, so
       this is a courtesy rather than the main path. */
    const buf = await fs.promises.readFile(originals.get(name));
    return serve(res, buf, ext === 'png' ? 'image/png' : 'image/jpeg');
  } catch (e) {
    console.error('[media] %s: %s', req.params.file, e.message);
    return res.status(500).json({ success: false, error: 'image_failed' });
  }
});

/** What the website can use, so the front-end need not hard-code the list. */
router.get('/public/images', (req, res) => {
  res.set('Cache-Control', 'public, max-age=3600').json({
    success: true,
    widths: WIDTHS,
    images: [...originals.keys()].sort().map((name) => ({ name, webp: `/public/img/${name}.webp`, original: `/public/img/${name}.png` })),
  });
});

module.exports = router;

/** The same list, for code inside the server (the destinations screen). */
module.exports.available = () => [...originals.keys()].sort()
  .map((name) => ({ name, webp: `/public/img/${name}.webp` }));
