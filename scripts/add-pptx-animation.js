/**
 * scripts/add-pptx-animation.js — put transitions and build-in animation into a
 * finished deck.
 *
 *   node scripts/add-pptx-animation.js docs/Entry-ticketing-Mullayanagiri.pptx
 *
 * WHY THIS IS A SEPARATE STEP. PptxGenJS has no animation or transition API at
 * all — there is not one occurrence of either word in its bundle. A .pptx is a
 * zip of XML, so the only way to add them is to open the finished file and edit
 * the slide XML directly, which is what this does.
 *
 * WHAT IT ADDS, AND WHAT IT DELIBERATELY DOES NOT.
 *
 *   A fade transition on every slide. Safe, universally supported, and the
 *   thing that actually reads as "animated" when clicking through a deck.
 *
 *   A fade-in build on the body shapes of each slide, so the points appear one
 *   at a time rather than the whole slide landing at once. The title and the
 *   footer are left alone — a heading that fades in after the body is the sort
 *   of effect that makes a deck feel cheap in a government meeting.
 *
 * It does NOT add motion paths, spins, or per-character effects. In a room
 * where the argument is "this system is careful and boring in the right ways",
 * a flying heading undoes more than it adds.
 *
 * The original is copied to <name>.pre-animation.pptx before anything is
 * written, because a corrupt deck discovered in the meeting is unrecoverable.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const IN = process.argv[2];
if (!IN) {
  console.error('\n  usage: node scripts/add-pptx-animation.js <file.pptx>\n');
  process.exit(1);
}

/* ── minimal zip reader/writer ────────────────────────────────────────────
   A .pptx must keep every part it came with; rewriting the archive by hand is
   only safe because each entry is copied through untouched unless it is a
   slide we are editing, and then only re-deflated with the same method. */

function readZip(buf) {
  let i = buf.length - 22;
  while (i >= 0 && buf.readUInt32LE(i) !== 0x06054b50) i--;
  if (i < 0) throw new Error('not a zip file (no end-of-central-directory)');

  const count = buf.readUInt16LE(i + 10);
  let off = buf.readUInt32LE(i + 16);
  const entries = [];

  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('bad central directory');
    const method = buf.readUInt16LE(off + 10);
    const crc = buf.readUInt32LE(off + 16);
    const csize = buf.readUInt32LE(off + 20);
    const usize = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const cmtLen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);

    const lnl = buf.readUInt16LE(lho + 26);
    const lel = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + lnl + lel;
    const raw = buf.subarray(start, start + csize);

    entries.push({ name, method, crc, usize, raw,
      data: method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw) });

    off += 46 + nameLen + extraLen + cmtLen;
  }
  return entries;
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function writeZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const data = e.dirty ? zlib.deflateRawSync(e.data, { level: 9 }) : e.raw;
    const usize = e.dirty ? e.data.length : e.usize;
    const crc = e.dirty ? crc32(e.data) : e.crc;
    const method = e.dirty ? 8 : e.method;
    const name = Buffer.from(e.name, 'utf8');

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(usize, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);

    chunks.push(local, data);

    const cen = Buffer.alloc(46 + name.length);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(usize, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    name.copy(cen, 46);
    central.push(cen);

    offset += local.length + data.length;
  }

  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...chunks, cd, end]);
}

/* ── the animation XML ───────────────────────────────────────────────────── */

/** A fade between slides, ~0.7s, advanced by click only. */
const TRANSITION = '<p:transition xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
  + ' spd="med" advClick="1"><p:fade/></p:transition>';

/**
 * A click-triggered fade-in for one shape.
 *
 * PowerPoint's timing tree is deeply nested and unforgiving: the par/seq
 * structure below is the minimum that PowerPoint will open without offering to
 * repair the file, which is the bar that matters here.
 */
function buildTiming(shapeIds) {
  const effects = shapeIds.map((id, i) => `
    <p:par><p:cTn id="${5 + i * 5}" fill="hold">
      <p:stCondLst><p:cond delay="indefinite"/></p:stCondLst>
      <p:childTnLst>
        <p:par><p:cTn id="${6 + i * 5}" fill="hold">
          <p:stCondLst><p:cond delay="0"/></p:stCondLst>
          <p:childTnLst>
            <p:par><p:cTn id="${7 + i * 5}" presetID="10" presetClass="entr" presetSubtype="0"
                   fill="hold" nodeType="${i === 0 ? 'clickEffect' : 'afterEffect'}">
              <p:stCondLst><p:cond delay="${i === 0 ? 0 : 200}"/></p:stCondLst>
              <p:childTnLst>
                <p:set><p:cBhvr>
                  <p:cTn id="${8 + i * 5}" dur="1" fill="hold">
                    <p:stCondLst><p:cond delay="0"/></p:stCondLst>
                  </p:cTn>
                  <p:tgtEl><p:spTgt spid="${id}"/></p:tgtEl>
                  <p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst>
                </p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>
                <p:animEffect transition="in" filter="fade">
                  <p:cBhvr><p:cTn id="${9 + i * 5}" dur="500"/>
                    <p:tgtEl><p:spTgt spid="${id}"/></p:tgtEl>
                  </p:cBhvr>
                </p:animEffect>
              </p:childTnLst>
            </p:cTn></p:par>
          </p:childTnLst>
        </p:cTn></p:par>
      </p:childTnLst>
    </p:cTn></p:par>`).join('');

  return '<p:timing xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
    + '<p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot">'
    + '<p:childTnLst><p:seq concurrent="1" nextAc="seek">'
    + '<p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>'
    + effects
    + '</p:childTnLst></p:cTn>'
    + '<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>'
    + '<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>'
    + '</p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>';
}

/* ── do it ───────────────────────────────────────────────────────────────── */

const buf = fs.readFileSync(IN);
const entries = readZip(buf);

const backup = IN.replace(/\.pptx$/i, '') + '.pre-animation.pptx';
fs.writeFileSync(backup, buf);

let slides = 0;
let animated = 0;

for (const e of entries) {
  if (!/^ppt\/slides\/slide\d+\.xml$/.test(e.name)) continue;
  slides++;

  let xml = e.data.toString('utf8');
  if (xml.includes('<p:transition')) continue;

  /* Shape ids on this slide, in document order. The first two are the eyebrow
     and heading on a standard slide, and the last is the footer — animating
     those makes the deck feel restless rather than considered, so the build is
     applied to what sits between them. */
  const ids = [...xml.matchAll(/<p:cNvPr id="(\d+)"/g)].map((m) => m[1]);
  const body = ids.slice(2, Math.max(2, ids.length - 2)).slice(0, 8);

  let add = TRANSITION;
  if (body.length) { add += buildTiming(body); animated++; }

  // Both elements belong immediately before </p:sld>, transition first.
  xml = xml.replace('</p:sld>', add + '</p:sld>');

  e.data = Buffer.from(xml, 'utf8');
  e.dirty = true;
}

fs.writeFileSync(IN, writeZip(entries));

console.log(`\n  ${path.basename(IN)}`);
console.log(`  fade transition on ${slides} slides, build-in animation on ${animated}`);
console.log(`  original kept at ${path.basename(backup)}\n`);
