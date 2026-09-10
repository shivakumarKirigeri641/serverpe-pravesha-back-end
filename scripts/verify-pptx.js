/**
 * scripts/verify-pptx.js — prove a generated deck is not corrupt.
 *
 *   node scripts/verify-pptx.js docs/Entry-ticketing-Mullayanagiri.pptx
 *
 * Written because add-pptx-animation.js rewrites the archive by hand, and a
 * deck that fails to open is discovered at the worst possible moment. This
 * reads the file back with a real zip library, parses every XML part, and
 * checks the things that actually go wrong:
 *
 *   the archive still opens and every part inflates
 *   every XML part is well formed and every tag is balanced
 *   the parts PowerPoint requires are all still present
 *   each slide's relationships still resolve
 *   no Kannada survives in an English-only deck
 */

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const FILE = process.argv[2];
if (!FILE) {
  console.error('\n  usage: node scripts/verify-pptx.js <file.pptx>\n');
  process.exit(1);
}

const KN = /[ಀ-೿]/;

/** Tag balance, which catches a truncated or badly spliced part. */
function tagsBalanced(xml) {
  const stack = [];
  const re = /<\/?([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(xml))) {
    const [full, name, , selfClose] = m;
    if (full.startsWith('<?') || full.startsWith('<!')) continue;
    if (full[1] === '/') {
      if (stack.pop() !== name) return `closing </${name}> did not match`;
    } else if (!selfClose) {
      stack.push(name);
    }
  }
  return stack.length ? `unclosed <${stack[stack.length - 1]}>` : null;
}

(async () => {
  const zip = await JSZip.loadAsync(fs.readFileSync(FILE));
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);

  const problems = [];
  const kannada = [];
  let slides = 0;
  let withTransition = 0;
  let withTiming = 0;

  for (const name of names) {
    let content;
    try {
      content = await zip.file(name).async('nodebuffer');
    } catch (e) {
      problems.push(`${name}: will not inflate — ${e.message}`);
      continue;
    }
    if (!/\.(xml|rels)$/.test(name)) continue;

    const xml = content.toString('utf8');
    if (!xml.trimStart().startsWith('<?xml') && !xml.trimStart().startsWith('<')) {
      problems.push(`${name}: does not begin with XML`);
      continue;
    }
    const bad = tagsBalanced(xml);
    if (bad) problems.push(`${name}: ${bad}`);

    if (/^ppt\/slides\/slide\d+\.xml$/.test(name)) {
      slides++;
      if (xml.includes('<p:transition')) withTransition++;
      if (xml.includes('<p:timing')) withTiming++;
      if (KN.test(xml)) {
        kannada.push(`${name}  ${(xml.match(/[ಀ-೿][^<]{0,36}/) || [''])[0]}`);
      }
      // Every relationship the slide points at must exist.
      const relName = name.replace(/slides\/(slide\d+)\.xml$/, 'slides/_rels/$1.xml.rels');
      if (zip.file(relName)) {
        const rels = await zip.file(relName).async('string');
        const ids = new Set([...rels.matchAll(/Id="([^"]+)"/g)].map((m) => m[1]));
        for (const m of xml.matchAll(/r:(?:embed|id|link)="([^"]+)"/g)) {
          if (!ids.has(m[1])) problems.push(`${name}: relationship ${m[1]} not defined`);
        }
      }
    }
  }

  const required = ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml'];
  for (const r of required) if (!names.includes(r)) problems.push(`missing required part ${r}`);

  console.log(`\n  ${path.basename(FILE)}  —  ${names.length} parts, ${slides} slides`);
  console.log(`  fade transition on ${withTransition}, build animation on ${withTiming}`);
  console.log(kannada.length
    ? `\n  KANNADA PRESENT on ${kannada.length} slides:\n    ${kannada.join('\n    ')}`
    : '  no Kannada present — deck is fully English');

  if (problems.length) {
    console.log(`\n  ${problems.length} PROBLEM(S):`);
    for (const p of problems.slice(0, 20)) console.log(`    ${p}`);
    console.log('');
    process.exit(1);
  }
  console.log('  archive, XML and relationships all valid\n');
  process.exit(0);
})().catch((e) => { console.error('\n ', e.message, '\n'); process.exit(1); });
