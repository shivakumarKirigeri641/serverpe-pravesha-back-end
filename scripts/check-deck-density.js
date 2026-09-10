/**
 * scripts/check-deck-density.js — find the slides carrying too many words.
 *
 *   node scripts/check-deck-density.js docs/Entry-ticketing-Mullayanagiri.pptx
 *
 * "Too much text" is easy to feel and hard to act on, so it is counted here:
 * words per slide, longest single block, and the widest gap between elements.
 * The output names the slides to cut, worst first, instead of leaving the
 * whole deck to be re-read.
 *
 * The thresholds are a presenter's rule of thumb, not a law: a slide that is
 * spoken over should be scannable in the few seconds before the speaker starts
 * talking, and past roughly 80 words nobody is reading it, they are waiting
 * for the speaker to finish so they can look up.
 */

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const FILE = process.argv[2];
if (!FILE) {
  console.error('\n  usage: node scripts/check-deck-density.js <file.pptx>\n');
  process.exit(1);
}

const EMU = 914400;
const BUSY = 80;      // words on a slide beyond which it stops being scannable
const LONG_BLOCK = 45; // words in one text box

(async () => {
  const zip = await JSZip.loadAsync(fs.readFileSync(FILE));
  const names = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => (+a.match(/\d+/)[0]) - (+b.match(/\d+/)[0]));

  const rows = [];

  for (const name of names) {
    const xml = await zip.file(name).async('string');
    const no = +name.match(/\d+/)[0];

    /* Text lives in <a:t>. Paragraph breaks matter for counting blocks, so
       shapes are split first and their runs joined per shape. */
    const blocks = [];
    for (const sp of xml.split(/<p:sp>/).slice(1)) {
      const text = [...sp.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(' ').trim();
      if (text) blocks.push(text);
    }
    const words = blocks.reduce((n, b) => n + b.split(/\s+/).filter(Boolean).length, 0);
    const longest = blocks.reduce((mx, b) => {
      const w = b.split(/\s+/).filter(Boolean).length;
      return w > mx.w ? { w, text: b } : mx;
    }, { w: 0, text: '' });

    /* Vertical gaps between stacked elements, to catch dead bands.
       Skipped on slides holding a table: PowerPoint stores a nominal height on
       the table frame rather than its rendered height, so the rows below the
       first look like empty space and every table slide reports a gap that is
       not there. */
    const hasTable = xml.includes('<a:tbl>');
    const boxes = hasTable ? [] : [...xml.matchAll(/<a:off x="(-?\d+)" y="(-?\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>/g)]
      .map((m) => ({ y: +m[2] / EMU, h: +m[4] / EMU }))
      .filter((b) => b.y > 1.2 && b.y < 5.0 && b.h < 4)
      .sort((a, b) => a.y - b.y);
    let gap = 0;
    let gapAt = 0;
    for (let i = 1; i < boxes.length; i++) {
      const g = boxes[i].y - (boxes[i - 1].y + boxes[i - 1].h);
      if (g > gap) { gap = g; gapAt = boxes[i - 1].y + boxes[i - 1].h; }
    }

    rows.push({ no, words, longest, gap, gapAt, blocks: blocks.length });
  }

  const busy = rows.filter((r) => r.words > BUSY).sort((a, b) => b.words - a.words);
  const longBlocks = rows.filter((r) => r.longest.w > LONG_BLOCK)
    .sort((a, b) => b.longest.w - a.longest.w);
  const gappy = rows.filter((r) => r.gap > 0.55).sort((a, b) => b.gap - a.gap);

  const total = rows.reduce((n, r) => n + r.words, 0);
  console.log(`\n  ${path.basename(FILE)} — ${rows.length} slides, ${total} words `
    + `(${Math.round(total / rows.length)} per slide)`);

  console.log(`\n  SLIDES OVER ${BUSY} WORDS  (${busy.length})`);
  for (const r of busy.slice(0, 14)) console.log(`    slide ${String(r.no).padStart(2)}  ${r.words} words`);

  console.log(`\n  SINGLE BLOCKS OVER ${LONG_BLOCK} WORDS  (${longBlocks.length})`);
  for (const r of longBlocks.slice(0, 14)) {
    console.log(`    slide ${String(r.no).padStart(2)}  ${r.longest.w} words  "${r.longest.text.slice(0, 64)}…"`);
  }

  console.log(`\n  VERTICAL GAPS OVER 0.55"  (${gappy.length})`);
  for (const r of gappy.slice(0, 14)) {
    console.log(`    slide ${String(r.no).padStart(2)}  ${r.gap.toFixed(2)}" of dead space at y=${r.gapAt.toFixed(2)}"`);
  }
  console.log('');
  process.exit(0);
})().catch((e) => { console.error('\n ', e.message, '\n'); process.exit(1); });
