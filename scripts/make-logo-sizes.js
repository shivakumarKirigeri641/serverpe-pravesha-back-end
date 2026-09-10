/**
 * scripts/make-logo-sizes.js — one source logo, every size it is needed at.
 *
 *   node scripts/make-logo-sizes.js
 *
 * The two supplied files are a 594x336 JPEG letterboxed in black and a
 * 1254x1254 PNG. Neither can be dropped straight onto a ticket: the black bars
 * would print, and scaling a 1254px logo down to 40px inside a PDF renderer
 * gives a soft, aliased mess.
 *
 * So each is trimmed of its uniform border once, then re-rendered at every size
 * the system actually asks for, with high-quality resampling. Downstream code
 * picks a file rather than scaling on the fly.
 *
 * Outputs land in assets/logos/ and are committed — a build that depends on
 * regenerating them is a build that breaks on the machine that has not run this.
 */

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const SRC = path.join(__dirname, '..', 'src', 'images');
const OUT = path.join(__dirname, '..', 'assets', 'logos');

/* Widths, chosen from where each is used rather than from a round-number habit:
   40-64px inside a PDF or ticket header, 96-192 in the admin panel and slides,
   384-1024 for print and for the deck's title slide. */
const WIDTHS = [40, 64, 96, 128, 192, 256, 384, 512, 768, 1024];

/* Square icons for browser tabs and home screens. */
const ICONS = [16, 32, 48, 64, 128, 180, 192, 256, 512];

/**
 * Cut away a uniform border.
 *
 * The tourism logo arrives letterboxed in black; the ServerPe mark sits on
 * white with generous padding. Both are trimmed by walking in from each edge
 * while every pixel on that row or column still matches the corner colour.
 *
 * The tolerance is deliberately loose: JPEG compression means "black" is
 * actually a scatter of near-black pixels, and an exact match would trim
 * nothing at all.
 */
function trim(img, { tolerance = 18 } = {}) {
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, img.width, img.height);

  const at = (x, y) => {
    const i = (y * width + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };
  const bg = at(0, 0);
  const same = (p) => p[3] === 0
    || (Math.abs(p[0] - bg[0]) <= tolerance
     && Math.abs(p[1] - bg[1]) <= tolerance
     && Math.abs(p[2] - bg[2]) <= tolerance);

  const rowUniform = (y) => { for (let x = 0; x < width; x++) if (!same(at(x, y))) return false; return true; };
  const colUniform = (x) => { for (let y = 0; y < height; y++) if (!same(at(x, y))) return false; return true; };

  let top = 0, bottom = height - 1, left = 0, right = width - 1;
  while (top < bottom && rowUniform(top)) top++;
  while (bottom > top && rowUniform(bottom)) bottom--;
  while (left < right && colUniform(left)) left++;
  while (right > left && colUniform(right)) right--;

  /* Inset by a couple of pixels. JPEG ringing leaves a faint grey line just
     inside the black bars it was asked to remove, and that line is visible as a
     hairline rule when the logo is placed on white. */
  const inset = 3;
  return {
    x: left + inset, y: top + inset,
    w: Math.max(1, right - left + 1 - inset * 2),
    h: Math.max(1, bottom - top + 1 - inset * 2),
  };
}

/** Draw a region of an image into a new canvas of the given width. */
function resize(img, box, width, { square = false, pad = 0, background = null } = {}) {
  const ratio = box.h / box.w;
  const height = square ? width : Math.round(width * ratio);

  const c = createCanvas(width, height);
  const ctx = c.getContext('2d');
  ctx.quality = 'best';

  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, width, height); }

  const inner = width - pad * 2;
  const dw = square ? Math.min(inner, inner / ratio) : inner;
  const dh = square ? dw * ratio : height - pad * 2;
  const dx = (width - dw) / 2;
  const dy = (height - dh) / 2;

  ctx.drawImage(img, box.x, box.y, box.w, box.h, dx, dy, dw, dh);
  return c.toBuffer('image/png');
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const jobs = [
    { file: 'karnatakatoursimdept_logo.jpg', name: 'karnataka-tourism',
      emblem: true,
      note: 'the department mark, letterboxed in black at source' },
    { file: 'ServerPe_Logo.png', name: 'serverpe',
      note: 'our own mark, square with white padding' },
  ];

  for (const job of jobs) {
    const src = path.join(SRC, job.file);
    if (!fs.existsSync(src)) { console.log(`  missing: ${job.file}`); continue; }

    const img = await loadImage(fs.readFileSync(src));
    const box = trim(img);

    console.log(`\n  ${job.name}`);
    console.log(`    source ${img.width}x${img.height}  ->  trimmed ${box.w}x${box.h}`);

    for (const w of WIDTHS) {
      if (w > box.w * 2) continue;            // never upscale past 2x — it only blurs
      fs.writeFileSync(path.join(OUT, `${job.name}-${w}.png`),
        resize(img, box, w, { background: '#ffffff' }));
    }
    // A transparent-background set, for placing on a coloured band.
    for (const w of [64, 128, 256, 512]) {
      if (w > box.w * 2) continue;
      fs.writeFileSync(path.join(OUT, `${job.name}-${w}-clear.png`),
        resize(img, box, w));
    }
    for (const s of ICONS) {
      fs.writeFileSync(path.join(OUT, `${job.name}-icon-${s}.png`),
        resize(img, box, s, { square: true, pad: Math.round(s * 0.08), background: '#ffffff' }));
    }

    /*
     * The emblem on its own.
     *
     * The supplied tourism logo is a letterhead block: state emblem, wordmark,
     * department name and the word "ಅರ್ಪಿಸುವ" — which reads as "presents" and
     * belongs on a poster, not on a ticket. What a ticket wants is the emblem
     * alone, with the department name and tagline set as text beside it.
     *
     * The emblem is the leftmost square of the artwork, so it is cut by taking
     * a box as wide as the logo is tall from the left edge.
     */
    if (job.emblem) {
      // Cut the left square, then trim it a second time. The emblem does not
      // sit centred in that square, and an off-centre mark on a ticket header
      // reads as a mistake even when nobody can say why.
      const rough = { x: box.x, y: box.y, w: box.h, h: box.h };
      const roughPng = resize(img, rough, rough.w, { background: '#ffffff' });
      const roughImg = await loadImage(roughPng);
      const tight = trim(roughImg, { tolerance: 12 });

      for (const s of [64, 96, 128, 192, 256, 512]) {
        fs.writeFileSync(path.join(OUT, `${job.name}-emblem-${s}.png`),
          resize(roughImg, tight, s, { background: '#ffffff' }));
        fs.writeFileSync(path.join(OUT, `${job.name}-emblem-${s}-clear.png`),
          resize(roughImg, tight, s));
      }
      console.log(`    plus the emblem alone, ${tight.w}x${tight.h} at six sizes`);
    }
    console.log(`    written ${WIDTHS.filter((w) => w <= box.w * 2).length} widths, `
      + `${ICONS.length} icons, and a transparent set`);
  }

  const total = fs.readdirSync(OUT).length;
  console.log(`\n  ${total} files in assets/logos/\n`);
  process.exit(0);
})().catch((e) => { console.error('\n', e, '\n'); process.exit(1); });
