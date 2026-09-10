/**
 * scripts/check-deck-layout.js — find content that falls off the slide.
 *
 *   node scripts/check-deck-layout.js docs/Entry-ticketing-Mullayanagiri.pptx
 *
 * A slide has no scrollbar. A table one row too long, or a note placed below
 * the footer, simply is not there when it matters — and the deck still builds,
 * still validates, and still looks fine until the projector is on.
 *
 * So the geometry is measured rather than eyeballed: every shape's position and
 * extent is read straight out of the slide XML and compared against the slide
 * box and the footer line.
 *
 * EMU is the unit PowerPoint stores: 914,400 to the inch.
 */

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const FILE = process.argv[2];
if (!FILE) {
  console.error('\n  usage: node scripts/check-deck-layout.js <file.pptx>\n');
  process.exit(1);
}

const EMU = 914400;
const SLIDE_W = 10;        // 16:9 at 10 x 5.625 inches
const SLIDE_H = 5.625;
const FOOTER_TOP = 5.14;   // where the footer line sits
const SLOP = 0.03;         // rounding in PowerPoint's own numbers

(async () => {
  const zip = await JSZip.loadAsync(fs.readFileSync(FILE));
  const names = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => (+a.match(/\d+/)[0]) - (+b.match(/\d+/)[0]));

  const problems = [];

  for (const name of names) {
    const xml = await zip.file(name).async('string');
    const no = +name.match(/\d+/)[0];

    /* Each shape carries <a:off x y/> and <a:ext cx cy/> inside its xfrm. */
    const re = /<a:off x="(-?\d+)" y="(-?\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>/g;
    let m;
    let idx = 0;
    while ((m = re.exec(xml))) {
      idx++;
      const x = +m[1] / EMU;
      const y = +m[2] / EMU;
      const w = +m[3] / EMU;
      const h = +m[4] / EMU;
      const right = x + w;
      const bottom = y + h;

      /* A full-height band down the edge of a slide is decoration — the cover's
         accent rule — and is meant to run the whole height. */
      const fullHeightBand = y <= SLOP && h >= SLIDE_H - 0.1 && w < 0.4;

      if (bottom > SLIDE_H + SLOP && !fullHeightBand) {
        problems.push(`slide ${no}: shape ${idx} runs ${(bottom - SLIDE_H).toFixed(2)}" `
          + `past the bottom edge (ends at ${bottom.toFixed(2)}" of ${SLIDE_H}")`);
      } else if (bottom > FOOTER_TOP + SLOP && h > 0.3 && !fullHeightBand) {
        problems.push(`slide ${no}: shape ${idx} overlaps the footer `
          + `(ends at ${bottom.toFixed(2)}", footer starts ${FOOTER_TOP}")`);
      }
      if (right > SLIDE_W + SLOP) {
        problems.push(`slide ${no}: shape ${idx} runs ${(right - SLIDE_W).toFixed(2)}" `
          + `past the right edge`);
      }
      if (x < -SLOP || y < -SLOP) {
        problems.push(`slide ${no}: shape ${idx} starts off-slide `
          + `at ${x.toFixed(2)}, ${y.toFixed(2)}`);
      }
    }
  }

  console.log(`\n  ${path.basename(FILE)} — ${names.length} slides measured`);
  if (!problems.length) {
    console.log('  everything sits inside the slide and clear of the footer\n');
    process.exit(0);
  }
  console.log(`\n  ${problems.length} LAYOUT PROBLEM(S):`);
  for (const p of problems) console.log(`    ${p}`);
  console.log('');
  process.exit(1);
})().catch((e) => { console.error('\n ', e.message, '\n'); process.exit(1); });
