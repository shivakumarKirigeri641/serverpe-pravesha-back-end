#!/usr/bin/env node
/**
 * build-dc-deck.js — the presentation for the Deputy Commissioner, Chikkamagaluru.
 *
 *   node scripts/build-dc-deck.js    writes docs/dc-deck/Pravesha-DC-Presentation.pptx
 *                                    and one commercial deck per proposal beside it
 *
 * THE COMMERCIALS ARE SEPARATE DECKS (user, 2026-09-17). The main presentation
 * carries nothing commercial. Each proposal is its own file — its per-pass fee,
 * its AMC, and the slides every proposal shares (investment, running costs,
 * termination) — so only the proposal being discussed is ever on screen. The
 * presenter opens them one at a time; no slide numbers the proposals or says
 * which is preferred, and neither may any file name.
 *
 * THE FOOTER DATE IS THE COMPUTER'S (user, 2026-09-16). It is a PowerPoint date
 * field, not text, so it shows the day the deck is opened or printed on — the
 * meeting day itself — without a rebuild.
 *
 * CONFIDENTIAL ON EVERY SLIDE. The notice lives in the slide master, not on
 * individual slides, so a slide added later cannot go out without it. The
 * footer carries ™ on the names and no copyright line (user, 2026-09-16);
 * nothing here may use ® or "registered".
 *
 * ENGLISH WITH KANNADA. Each heading carries its Kannada line beneath it.
 *
 * FIGURES COME FROM THE DATABASE. Prices, capacities and Omniware's real sold
 * counts are read at build time, so the deck cannot quote a number the system
 * disagrees with. Nothing invented, nothing projected unless labelled so.
 *
 * The output goes to docs/, which is not committed.
 *
 * SLIDES are the SLIDES array at the bottom, in order. Adding one is adding a
 * function to it.
 */

require('dotenv').config({ quiet: true });
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const PptxGenJS = require('pptxgenjs');

const ROOT = path.join(__dirname, '..');
const LOGO = (name) => path.join(ROOT, 'assets', 'logos', name);
const OUT_DIR = path.join(ROOT, 'docs', 'dc-deck');
const OUT = path.join(OUT_DIR, 'Pravesha-DC-Presentation.pptx');

/* The logo files carry artefacts that show on a slide, so cleaned copies are
   written at build time:
     ServerPe — black corners painted outside its rounded square. Only the dark
       area joined to the corners is made transparent; the grey tagline inside
       the logo is not joined to them and stays.
     Karnataka — a faint grey frame around the mark. Pale greys become white,
       which on a white slide is nothing. */
const CACHE = path.join(OUT_DIR, '.cache');
const SERVERPE_LOGO = path.join(CACHE, 'serverpe-logo.png');
const KARNATAKA_LOGO = path.join(CACHE, 'karnataka-tourism-logo.png');

/* The founder's photograph. Kept in docs/ with the deck, never in src/, so a
   personal photo cannot be committed. Without it the slide shows a placeholder. */
const FOUNDER_PHOTO = path.join(OUT_DIR, 'founder-photo.jpg');

async function cleanedCopy(src, dest, fix) {
  const { createCanvas, loadImage } = require('@napi-rs/canvas');
  const img = await loadImage(src);
  const canvas = createCanvas(img.width, img.height);
  const g = canvas.getContext('2d');
  g.drawImage(img, 0, 0);
  const frame = g.getImageData(0, 0, img.width, img.height);
  fix(frame.data, img.width, img.height);
  g.putImageData(frame, 0, 0);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, await canvas.encode('png'));
}

async function cleanLogos() {
  await cleanedCopy(LOGO('serverpe-512.png'), SERVERPE_LOGO, (px, w, h) => {
    const dark = (i) => {
      const hi = Math.max(px[i], px[i + 1], px[i + 2]);
      return px[i + 3] > 0 && hi < 110 && hi - Math.min(px[i], px[i + 1], px[i + 2]) < 30;
    };
    const seen = new Uint8Array(w * h);
    const stack = [0, w - 1, (h - 1) * w, h * w - 1];
    while (stack.length) {
      const p = stack.pop();
      if (seen[p]) continue;
      seen[p] = 1;
      if (!dark(p * 4)) continue;
      px[p * 4 + 3] = 0;
      const x = p % w;
      if (x > 0) stack.push(p - 1);
      if (x < w - 1) stack.push(p + 1);
      if (p >= w) stack.push(p - w);
      if (p < (h - 1) * w) stack.push(p + w);
    }
  });

  await cleanedCopy(LOGO('karnataka-tourism-512-clear.png'), KARNATAKA_LOGO, (px) => {
    for (let i = 0; i < px.length; i += 4) {
      const hi = Math.max(px[i], px[i + 1], px[i + 2]);
      if (hi >= 205 && hi - Math.min(px[i], px[i + 1], px[i + 2]) < 20) { px[i] = 255; px[i + 1] = 255; px[i + 2] = 255; }
    }
  });
}

/*
 * Where the footer's date goes. pptxgenjs cannot write a field, so the master
 * carries this marker and liveDates() swaps it for a PowerPoint date field once
 * the file is written. What is stored inside the field is today's date, which
 * PowerPoint replaces with the computer's date when the deck is opened.
 */
const DATE_MARK = '{{TODAY}}';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const NOW = new Date();
const DATE_EN = `${NOW.getDate()} ${MONTHS[NOW.getMonth()]} ${NOW.getFullYear()}`;

/* The product's own palette — the same greens as the passes and the website. */
const C = {
  brand: '075E54', brand2: '008069', accent: '00A884', deep: '053F38',
  mist: 'F4F9F7', mist2: 'E7F2EE', sun: 'F59E0B',
  ink: '0D1B1E', muted: '5D7169', line: 'E2EBE8', white: 'FFFFFF',
};
const F = { en: 'Segoe UI', enBold: 'Segoe UI Semibold', kn: 'Nirmala UI' };
/* Nirmala's Kannada reads smaller than Segoe's Latin at the same point size, so
   Kannada is set a quarter larger than the English it accompanies. Every
   Kannada size goes through this, so the deck stays consistent. */
const KN = (pt) => Math.round(pt * 1.25 * 2) / 2;

/* 16:9 wide: 13.333 × 7.5 inches. */
const W = 13.333;
const H = 7.5;
const GUTTER = 0.6;
const FOOTER_H = 0.42;

/* The word itself is set in red so it is read as a marking rather than as part
   of the footer line (user, 2026-09-15). A mid red, not a pure one: the
   footer is dark green, and DC2626 on it is barely legible.

   A slide master takes plain strings, not runs — a run array reaches the file
   as "[object Object]" — so the marking and the footer line are two boxes. */
const CONFIDENTIAL_RED = 'FF8B8B';
const CONFIDENTIAL_MARK = 'CONFIDENTIAL  |  ಗೌಪ್ಯ';
const CONFIDENTIAL_MARK_W = 1.62;
const CONFIDENTIAL = '·   Pravesha™  ·  ServerPe App Solutions™  ·  Not for circulation.';

/**
 * The marker becomes a live date field — "16 September 2026" (datetime3: day,
 * month name, year) — in every layout and slide that carries it. The run's own
 * formatting is kept, so the field looks exactly like the text it replaces.
 */
async function liveDates(file) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  let fields = 0;
  for (const name of Object.keys(zip.files).filter((n) => /^ppt\/(slideLayouts|slideMasters|slides)\/[^/]+\.xml$/.test(n))) {
    let xml = await zip.file(name).async('string');
    /* From each marker back to the start of its own run — never a regex across
       the paragraph, which would swallow the runs in between. */
    for (let at = xml.indexOf(DATE_MARK); at !== -1; at = xml.indexOf(DATE_MARK)) {
      const start = xml.lastIndexOf('<a:r>', at);
      const end = xml.indexOf('</a:r>', at) + '</a:r>'.length;
      const m = /^<a:r>(<a:rPr\b[\s\S]*?(?:<\/a:rPr>|\/>))<a:t>([^<]*)<\/a:t><\/a:r>$/.exec(xml.slice(start, end));
      if (start === -1 || !m) throw new Error(`The footer date marker in ${name} is not in a plain run.`);
      const [rPr, text] = [m[1], m[2]];
      const [before, after] = text.split(DATE_MARK);
      fields += 1;
      xml = xml.slice(0, start)
        + (before ? `<a:r>${rPr}<a:t>${before}</a:t></a:r>` : '')
        + `<a:fld id="{${crypto.randomUUID().toUpperCase()}}" type="datetime3">${rPr}<a:t>${DATE_EN}</a:t></a:fld>`
        + (after ? `<a:r>${rPr}<a:t>${after}</a:t></a:r>` : '')
        + xml.slice(end);
    }
    zip.file(name, xml);
  }
  if (!fields) throw new Error('No footer date marker was found: the footer date would be missing.');
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  return fields;
}

/** Width over height of a PNG, from its header — logos keep their proportions. */
function ratio(file) {
  const b = fs.readFileSync(file);
  return b.readUInt32BE(16) / b.readUInt32BE(20);
}

/** An image fitted to a height, or to a width if that is narrower. */
function logo(slide, file, { x, y, h, maxW = 99 }) {
  const r = ratio(file);
  let w = h * r;
  let hh = h;
  if (w > maxW) { w = maxW; hh = w / r; }
  slide.addImage({ path: file, x, y: y + (h - hh) / 2, w, h: hh });
  return w;
}

function masters(pptx) {
  const footer = [
    { rect: { x: 0, y: H - FOOTER_H, w: W, h: FOOTER_H, fill: { color: C.deep } } },
    { text: {
      text: CONFIDENTIAL_MARK,
      options: { x: GUTTER, y: H - FOOTER_H, w: CONFIDENTIAL_MARK_W, h: FOOTER_H, fontFace: F.kn, bold: true, fontSize: 8.5, color: CONFIDENTIAL_RED, valign: 'middle', margin: 0 },
    } },
    { text: {
      text: CONFIDENTIAL,
      options: { x: GUTTER + CONFIDENTIAL_MARK_W, y: H - FOOTER_H, w: W - GUTTER * 2 - 2.6 - CONFIDENTIAL_MARK_W, h: FOOTER_H, fontFace: F.kn, fontSize: 8.5, color: 'CFE5DC', valign: 'middle', margin: 0 },
    } },
    { text: {
      text: `Pravesha · ${DATE_MARK}`,
      options: { x: W - GUTTER - 2.6, y: H - FOOTER_H, w: 2.1, h: FOOTER_H, fontFace: F.en, fontSize: 8.5, color: 'CFE5DC', align: 'right', valign: 'middle', margin: 0 },
    } },
  ];
  const number = { x: W - GUTTER - 0.45, y: H - FOOTER_H + 0.08, w: 0.45, h: FOOTER_H - 0.16, fontFace: F.enBold, fontSize: 9, color: C.white, align: 'right', valign: 'middle' };

  pptx.defineSlideMaster({ title: 'COVER', background: { color: C.white }, objects: footer, slideNumber: number });
  pptx.defineSlideMaster({
    title: 'CONTENT',
    background: { color: C.white },
    objects: [
      { rect: { x: 0, y: 0, w: 0.14, h: H - FOOTER_H, fill: { color: C.brand } } },
      { image: { path: LOGO('pravesha-512.png'), x: W - GUTTER - 1.75, y: 0.32, w: 1.75, h: 1.75 / ratio(LOGO('pravesha-512.png')) } },
      /* Who built it, under the product mark, on every content slide (user,
         2026-09-15). The cover and the closing slide carry ServerPe's name and
         logo already, so they are left as they are. */
      { text: {
        text: 'Powered by: ServerPe App Solutions',
        options: {
          x: W - GUTTER - 2.9, y: 0.34 + 1.75 / ratio(LOGO('pravesha-512.png')), w: 2.9, h: 0.2,
          fontFace: F.en, fontSize: 7.5, color: C.muted, align: 'right', valign: 'middle', margin: 0,
        },
      } },
      ...footer,
    ],
    slideNumber: number,
  });
}

/** Heading in English with its Kannada line, the same on every content slide. */
function heading(slide, en, kn) {
  slide.addText(en, { x: GUTTER, y: 0.35, w: W - GUTTER * 2 - 2.2, h: 0.7, fontFace: F.enBold, fontSize: 28, color: C.ink, margin: 0 });
  slide.addText(kn, { x: GUTTER, y: 1.02, w: W - GUTTER * 2 - 2.2, h: 0.45, fontFace: F.kn, fontSize: KN(16), color: C.brand2, margin: 0 });
  slide.addShape('rect', { x: GUTTER, y: 1.58, w: 0.9, h: 0.06, fill: { color: C.accent }, line: { color: C.accent } });
}

/* ───────────────────────────────────────────────────────────── slides ── */

/**
 * Slide 1, welcome — as laid out by the user:
 *   top     Karnataka Tourism · the Karnataka mark · Government of Karnataka
 *   middle  Welcome to Pravesha, its tagline, a WhatsApp-based toll/pass booking platform
 *   bottom  Powered by ServerPe App Solutions
 */
function welcome(pptx, ctx) {
  const s = pptx.addSlide({ masterName: 'COVER' });
  const centre = (w) => (W - w) / 2;
  const line = (text, y, h, opts) => s.addText(text, { x: GUTTER, y, w: W - GUTTER * 2, h, align: 'center', valign: 'middle', margin: 0, ...opts });

  /* Top: the government's mark, which already carries the emblem, the
     Karnataka wordmark and the Department of Tourism. */
  s.addShape('rect', { x: 0, y: 0, w: W, h: 0.1, fill: { color: C.brand }, line: { color: C.brand } });
  const govFile = KARNATAKA_LOGO;
  const govH = 1.3;
  logo(s, govFile, { x: centre(govH * ratio(govFile)), y: 0.3, h: govH });
  line([
    { text: 'Department of Tourism  ·  Government of Karnataka', options: { fontFace: F.enBold, fontSize: 13, color: C.ink } },
    { text: '     ಪ್ರವಾಸೋದ್ಯಮ ಇಲಾಖೆ  ·  ಕರ್ನಾಟಕ ಸರ್ಕಾರ', options: { fontFace: F.kn, fontSize: KN(13), color: C.muted } },
  ], 1.66, 0.36);
  s.addShape('rect', { x: centre(3.2), y: 2.16, w: 3.2, h: 0.02, fill: { color: C.line }, line: { color: C.line } });

  /* Middle: welcome, product, tagline, what it is. */
  line([
    { text: 'Welcome to', options: { fontFace: F.en, fontSize: 22, color: C.muted } },
    { text: '   |   ', options: { fontFace: F.en, fontSize: 18, color: C.line } },
    { text: 'ಪ್ರವೇಶಕ್ಕೆ ಸುಸ್ವಾಗತ', options: { fontFace: F.kn, fontSize: KN(18), color: C.muted } },
  ], 2.34, 0.46);
  const pvFile = LOGO('pravesha-1024.png');
  const pvH = 1.12;
  logo(s, pvFile, { x: centre(pvH * ratio(pvFile)), y: 2.84, h: pvH });

  line(ctx.tagline, 4.08, 0.52, { fontFace: F.enBold, fontSize: 26, color: C.brand2 });
  line(ctx.taglineKn, 4.58, 0.42, { fontFace: F.kn, fontSize: KN(18), color: C.accent });
  s.addShape('rect', { x: centre(1.1), y: 5.1, w: 1.1, h: 0.06, fill: { color: C.sun }, line: { color: C.sun } });
  line('A WhatsApp-based toll & entry pass booking platform', 5.24, 0.44, { fontFace: F.en, fontSize: 19, color: C.ink });
  line('ವಾಟ್ಸಾಪ್ ಆಧಾರಿತ ಟೋಲ್ ಮತ್ತು ಪ್ರವೇಶ ಪಾಸ್ ಬುಕಿಂಗ್ ವೇದಿಕೆ', 5.66, 0.36, { fontFace: F.kn, fontSize: KN(14), color: C.muted });

  /* Bottom: powered by. One centred row — label, mark, name. */
  const labelW = 1.25;
  const markH = 0.72;
  const nameW = 3.05;
  const rowW = labelW + 0.15 + markH + 0.15 + nameW;
  const x0 = centre(rowW);
  const rowY = 6.2;
  s.addText([
    { text: 'Powered by', options: { fontFace: F.en, fontSize: 12, color: C.muted, breakLine: true } },
    { text: 'ಸಹಯೋಗ', options: { fontFace: F.kn, fontSize: KN(10), color: C.muted } },
  ], { x: x0, y: rowY, w: labelW, h: markH, align: 'right', valign: 'middle', margin: 0 });
  logo(s, SERVERPE_LOGO, { x: x0 + labelW + 0.15, y: rowY, h: markH });
  s.addText([
    { text: 'ServerPe App Solutions', options: { fontFace: F.enBold, fontSize: 17, color: C.ink, breakLine: true } },
    { text: 'Smart Clicks, Smart Taps', options: { fontFace: F.en, fontSize: 11, color: C.muted } },
  ], { x: x0 + labelW + 0.15 + markH + 0.15, y: rowY, w: nameW, h: markH, valign: 'middle', margin: 0 });
}

/**
 * The agenda, in the order the user gave it. `en` and `kn` are what the slide
 * shows; `brief` is the user's own description of the item, kept word for word
 * so the slide written for it later covers exactly what was asked.
 */
const AGENDA = [
  { en: 'Organisation Profile & Founder', kn: 'ಸಂಸ್ಥೆಯ ಪರಿಚಯ ಮತ್ತು ಸಂಸ್ಥಾಪಕರು',
    brief: 'About Sole Proprietorship & Founder' },
  { en: 'Introducing Pravesha', kn: 'ಪ್ರವೇಶ ವೇದಿಕೆಯ ಪರಿಚಯ',
    brief: 'What is Pravesha platform' },
  { en: 'Our Product Portfolio', kn: 'ನಮ್ಮ ಉತ್ಪನ್ನಗಳು',
    brief: 'Our products' },
  /* Scope and the checkpost's present constraints were two items; the user
     judged one slide covers both, so the agenda says so. Likewise advantages
     and benefits. */
  { en: 'Scope & Present Checkpost Constraints', kn: 'ವ್ಯಾಪ್ತಿ ಮತ್ತು ಪ್ರಸ್ತುತ ಚೆಕ್‌ಪೋಸ್ಟ್ ಮಿತಿಗಳು',
    brief: 'Scope of Pravesha WhatsApp based platform + current situation & limitations at the checkpost: forged tickets, same vehicle entering many times, one ticket for many vehicles, staff cannot verify, weekend & holiday rush and sudden spikes, edited dates / vehicle numbers / IDs, resulting in loss & scams' },
  { en: 'Advantages & Benefits', kn: 'ಅನುಕೂಲಗಳು ಮತ್ತು ಪ್ರಯೋಜನಗಳು',
    brief: 'Advantages of Pravesha + benefits from Pravesha (what it covers?)' },
  /* The agenda lists only what the deck presents (user, 2026-09-15). Four items
     never became slides of their own, and each is folded into the item whose
     slide already carries it:
       Support & Business Continuity   → Limitations (founder on call, trained
                                         standby, the quick-support strip)
       Technology Stack & Infrastructure → How It Works (the architecture slide)
       Reports & Information Sharing,
       Access Control & Deployment     → Inputs & Approvals (its two cards)
     Items 1–6 keep their positions: several slides address them by index. */
  { en: 'Limitations, Support & Continuity', kn: 'ಮಿತಿಗಳು, ಬೆಂಬಲ ಮತ್ತು ಸೇವಾ ನಿರಂತರತೆ',
    brief: 'Some limitations of Pravesha (to be transparent, as every app/platform has its own) and how each is overcome. Continuity: founder carries a laptop on every outing; if unavailable, his wife covers temporarily until he is back; quick support on VPS, server, payments, ticket issues, slots, bookings, vehicle RC fetches from ULIP and more. Backup support for Pravesha as it is a sole proprietorship company.' },
  { en: 'How It Works — Architecture, Technology & Flow', kn: 'ಕಾರ್ಯವಿಧಾನ — ವಿನ್ಯಾಸ, ತಂತ್ರಜ್ಞಾನ ಮತ್ತು ಪ್ರಕ್ರಿಯೆ',
    brief: 'How Pravesha overcomes the existing situation, how it works, architecture & flow. Technologies, skills & specifications used in Pravesha (infrastructure).' },
  /* Added by the user: what comes after launch, just before what is asked of the
     department — so the ask follows the promise. */
  { en: 'Future Enhancements — Roadmap', kn: 'ಭವಿಷ್ಯದ ಸುಧಾರಣೆಗಳು — ಮುನ್ನೋಟ',
    brief: 'Once in production it runs automated, but development continues — from the visitors\' and the department\'s revenue point of view. Priority: pass postpone up to 2 weeks from the pass day (free or small charge, department\'s decision), including passes skipped at the checkpost. Good to have: multiple entries — chargeable re-entry, day pass or weekly pass. Good to have: concessions for frequent visitors. Later: cancellation/refunds, holding a percentage of the fee depending on days left before the visit.' },
  { en: 'Inputs & Approvals — Access, Deployment & Reports', kn: 'ಅನುಮೋದನೆಗಳು — ಪ್ರವೇಶ, ನಿಯೋಜನೆ, ವರದಿ',
    brief: 'Deployment, domain names, WhatsApp booking mobile number, logo usage sanction, split sharing of the costs based on the model selected, publicity/promotion/marketing on approval. Role based access, deployments, server/database access from ServerPe. Reports sharing.' },
  /* Added by the user (2026-09-17): the time needed between approval and go-live,
     so nobody expects the day of approval to be the day of launch. */
  { en: 'Go-Live Preparation — Time Needed', kn: 'ನೇರ ಸೇವೆಗೆ ಸಿದ್ಧತೆ — ಬೇಕಾದ ಸಮಯ',
    brief: 'Time is needed to move Razorpay from test mode to live mode, to migrate to Razorpay split settlement (Route), to set up the database depending on which server is chosen, and the other steps before going live.' },
  { en: 'Live Demonstration', kn: 'ನೇರ ಪ್ರಾತ್ಯಕ್ಷಿಕೆ', highlight: true,
    brief: 'LIVE DEMO' },
  { en: 'Questions & Answers', kn: 'ಪ್ರಶ್ನೋತ್ತರ',
    brief: 'QnA (not FAQ)' },
];

/* The commercial items, headings for the proposal decks only — the main
   agenda no longer lists them (user, 2026-09-17). */
const COMMERCIAL_AGENDA = [
  /* The charges lead and the costs follow (user, 2026-09-15): the department
     sees what a pass costs a visitor before it sees any table of lakhs, and the
     cost slides then answer "why that much" rather than setting up the ask.
     Not "with & without AMC": the service fee and the annual charge are two
     separate things, not two alternatives. */
  { en: 'Commercial Proposal — Service Fee & Charges', kn: 'ವಾಣಿಜ್ಯ ಪ್ರಸ್ತಾವನೆ — ಸೇವಾ ಶುಲ್ಕ ಮತ್ತು ಶುಲ್ಕಗಳು',
    brief: 'Charging model — per-vehicle service fee, and the department\'s annual charge' },
  { en: 'Investment & Operating Costs', kn: 'ಹೂಡಿಕೆ ಮತ್ತು ನಿರ್ವಹಣಾ ವೆಚ್ಚಗಳು',
    brief: 'Investments, expenditure & infrastructure costs — laptop, VPS, domain, mail domain, SMS OTP cost, WhatsApp message cost, Razorpay cost, SSL certificate (HTTPS), development tools (Claude agent, Copilot agent); development & testing effort, deployment testing effort, bug-fix effort' },
  /* Added by the user (2026-09-16): what happens if the department stops —
     after the money has been set out, so the terms follow the charges. */
  { en: 'Termination, Suspension & Exit', kn: 'ಸೇವೆ ಸ್ಥಗಿತ, ಅಮಾನತು ಮತ್ತು ನಿರ್ಗಮನ',
    brief: 'First month is beta live production: no AMC, only the proposed per-ticket charge. AMC start date is the agreed 1st day after the month of beta, once the department is satisfied; AMC is settled before that day. Dropping or suspension during beta is allowed; platform fees collected are retained, not refunded. No dropping or exit once in actual production (user, 2026-09-16).' },
];

function agenda(pptx) {
  const s = pptx.addSlide({ masterName: 'CONTENT' });
  heading(s, 'Agenda', 'ಕಾರ್ಯಸೂಚಿ');

  /* Two columns, the first a row longer, read down then across. */
  const perColumn = Math.ceil(AGENDA.length / 2);
  const top = 1.9;
  const rowH = (H - FOOTER_H - 0.2 - top) / perColumn;
  const colGap = 0.45;
  const colW = (W - GUTTER * 2 - colGap) / 2;
  const badge = 0.36;

  AGENDA.forEach((item, i) => {
    const col = i < perColumn ? 0 : 1;
    const row = col ? i - perColumn : i;
    const x = GUTTER + col * (colW + colGap);
    const y = top + row * rowH;

    if (item.highlight) {
      s.addShape('roundRect', { x: x - 0.08, y: y + 0.02, w: colW + 0.08, h: rowH - 0.04, fill: { color: 'FEF3C7' }, line: { color: C.sun }, rectRadius: 0.06 });
    }
    s.addShape('ellipse', { x, y: y + (rowH - badge) / 2, w: badge, h: badge, fill: { color: item.highlight ? C.sun : C.brand }, line: { color: item.highlight ? C.sun : C.brand } });
    s.addText(String(i + 1), { x, y: y + (rowH - badge) / 2, w: badge, h: badge, fontFace: F.enBold, fontSize: 11, color: C.white, align: 'center', valign: 'middle', margin: 0 });
    s.addText([
      { text: item.en, options: { fontFace: F.enBold, fontSize: 13, color: C.ink, breakLine: true } },
      { text: item.kn, options: { fontFace: F.kn, fontSize: KN(10), color: C.muted } },
    ], { x: x + badge + 0.16, y, w: colW - badge - 0.2, h: rowH, valign: 'middle', margin: 0, lineSpacingMultiple: 0.95 });
  });
}

/**
 * Agenda 1 — the organisation and its founder.
 *
 * Only what is on record or was given: the name, the settings (title, GSTIN,
 * start date), the Udyam number and the founder's experience as the user
 * stated it. Kept short on purpose.
 */
function orgProfile(pptx, ctx) {
  const s = pptx.addSlide({ masterName: 'CONTENT' });
  heading(s, AGENDA[0].en, AGENDA[0].kn);

  /* Left: the founder. */
  const cardX = GUTTER;
  const cardY = 1.95;
  const cardW = 3.6;
  const cardH = 4.75;
  s.addShape('roundRect', { x: cardX, y: cardY, w: cardW, h: cardH, fill: { color: C.mist }, line: { color: C.line }, rectRadius: 0.1 });

  const photoH = 2.7;
  const photoY = cardY + 0.22;
  const photoW = ctx.photo ? photoH * ctx.photo.ratio : 1.95;
  const photoX = cardX + (cardW - photoW) / 2;
  s.addShape('rect', { x: photoX - 0.07, y: photoY - 0.07, w: photoW + 0.14, h: photoH + 0.14, fill: { color: C.white }, line: { color: C.brand2, width: 1.5 } });
  if (ctx.photo) {
    s.addImage({ path: ctx.photo.path, x: photoX, y: photoY, w: photoW, h: photoH });
  } else {
    s.addText('Photograph', { x: photoX, y: photoY, w: photoW, h: photoH, fontFace: F.en, fontSize: 12, color: C.muted, align: 'center', valign: 'middle' });
  }

  s.addText([
    { text: FOUNDER_NAME, options: { fontFace: F.enBold, fontSize: 18, color: C.ink, breakLine: true } },
    { text: ctx.founderTitle, options: { fontFace: F.en, fontSize: 12, color: C.brand2, breakLine: true } },
    { text: 'ಸಂಸ್ಥಾಪಕರು ಮತ್ತು ಮಾಲೀಕರು', options: { fontFace: F.kn, fontSize: KN(11), color: C.muted, breakLine: true } },
    { text: `Native place: ${FOUNDER_NATIVE.en}`, options: { fontFace: F.en, fontSize: 11, color: C.ink, breakLine: true, paraSpaceBefore: 6 } },
    { text: `ಸ್ವಂತ ಊರು: ${FOUNDER_NATIVE.kn}`, options: { fontFace: F.kn, fontSize: KN(9.5), color: C.muted } },
  ], { x: cardX + 0.15, y: photoY + photoH + 0.18, w: cardW - 0.3, h: 1.5, align: 'center', valign: 'top', margin: 0 });

  /* Right: the organisation, as a fact sheet. */
  const rx = cardX + cardW + 0.45;
  const rw = W - GUTTER - rx;
  const labelW = 2.75;
  const rowH = 0.5;
  const facts = [
    ['Organisation', 'ಸಂಸ್ಥೆ', 'ServerPe App Solutions'],
    ['Constitution', 'ಸಂಸ್ಥೆಯ ಸ್ವರೂಪ', 'Sole Proprietorship'],
    ['Founder & Proprietor', 'ಸಂಸ್ಥಾಪಕರು ಮತ್ತು ಮಾಲೀಕರು', FOUNDER_NAME],
    ['Operating since', 'ಕಾರ್ಯಾರಂಭ', ctx.since],
    ['GSTIN', 'ಜಿಎಸ್‌ಟಿ ನೋಂದಣಿ ಸಂಖ್ಯೆ', ctx.gstin],
    ['Udyam Registration', 'ಉದ್ಯಮ ನೋಂದಣಿ ಸಂಖ್ಯೆ', UDYAM_NUMBER],
  ];
  facts.forEach(([en, kn, value], i) => {
    const y = cardY + i * rowH;
    s.addText([
      { text: en, options: { fontFace: F.en, fontSize: 12, color: C.muted, breakLine: true } },
      { text: kn, options: { fontFace: F.kn, fontSize: KN(9.5), color: C.muted } },
    ], { x: rx, y, w: labelW, h: rowH, valign: 'middle', margin: 0 });
    s.addText(value || '—', { x: rx + labelW, y, w: rw - labelW, h: rowH, fontFace: F.enBold, fontSize: 16, color: C.ink, valign: 'middle', margin: 0 });
    s.addShape('line', { x: rx, y: y + rowH, w: rw, h: 0, line: { color: C.line, width: 1 } });
  });

  /* The founder's experience, as one figure and one line — short, as asked. */
  const bgY = cardY + facts.length * rowH + 0.25;
  const bgH = cardY + cardH - bgY;
  const figureW = 1.9;
  s.addShape('roundRect', { x: rx, y: bgY, w: rw, h: bgH, fill: { color: C.mist }, line: { color: C.line }, rectRadius: 0.08 });
  s.addShape('rect', { x: rx, y: bgY, w: 0.08, h: bgH, fill: { color: C.accent }, line: { color: C.accent } });
  s.addText('15+', { x: rx + 0.2, y: bgY, w: figureW, h: bgH, fontFace: F.enBold, fontSize: 48, color: C.brand, align: 'center', valign: 'middle', margin: 0 });
  s.addText([
    { text: 'Years of IT experience', options: { fontFace: F.enBold, fontSize: 18, color: C.ink, breakLine: true } },
    { text: 'ಐಟಿ ಕ್ಷೇತ್ರದಲ್ಲಿ 15ಕ್ಕೂ ಹೆಚ್ಚು ವರ್ಷಗಳ ಅನುಭವ', options: { fontFace: F.kn, fontSize: KN(12), color: C.brand2, breakLine: true } },
    { text: 'Software engineer  ·  software & application development', options: { fontFace: F.en, fontSize: 13, color: C.muted, paraSpaceBefore: 4 } },
  ], { x: rx + 0.2 + figureW + 0.15, y: bgY, w: rw - figureW - 0.55, h: bgH, valign: 'middle', margin: 0 });
}

/**
 * Agenda 1, continued — what the company does.
 *
 * The four pillars are the user's. The strip beneath lists what building
 * Pravesha has actually proven, each item traceable to this repository —
 * nothing claimed that the code does not do.
 */
function whatWeDo(pptx) {
  const s = pptx.addSlide({ masterName: 'CONTENT' });
  heading(s, 'What We Do', 'ನಾವು ಏನು ಮಾಡುತ್ತೇವೆ');

  /* Titles are kept to one line each in both languages: a card whose heading
     wraps pushes its Kannada into the points beneath. */
  const pillars = [
    { en: 'Services & Products', kn: 'ಸೇವೆಗಳು ಮತ್ತು ಉತ್ಪನ್ನಗಳು', color: C.brand,
      points: ['Own products, built and run in-house', 'Custom solutions for departments & businesses', 'Design, build, deploy & support — end to end'] },
    { en: 'WhatsApp Platforms', kn: 'ವಾಟ್ಸಾಪ್ ಆಧಾರಿತ ವೇದಿಕೆಗಳು', color: C.accent,
      points: ['Meta-approved WhatsApp Business messaging API integration', 'Booking & payment inside the chat', 'English & Kannada conversations'] },
    { en: 'Desktop & Web Apps', kn: 'ಡೆಸ್ಕ್‌ಟಾಪ್, ವೆಬ್ ಆ್ಯಪ್‌ಗಳು', color: C.brand2,
      points: ['Schedulers & automated jobs', 'Booking, slot & capacity management', 'Full-stack development — web, APIs, databases'] },
    { en: 'ULIP Vehicle Services', kn: 'ULIP ವಾಹನ ಸೇವೆಗಳು', color: C.sun,
      points: ['ULIP-approved integration', 'RC — vehicle registration details', 'eChallan — traffic challans', 'FASTag'] },
  ];

  const top = 1.95;
  const gap = 0.25;
  const cardW = (W - GUTTER * 2 - gap * (pillars.length - 1)) / pillars.length;
  const cardH = 2.6;
  const titleH = 0.72;
  pillars.forEach((p, i) => {
    const x = GUTTER + i * (cardW + gap);
    s.addShape('roundRect', { x, y: top, w: cardW, h: cardH, fill: { color: C.white }, line: { color: C.line }, rectRadius: 0.08 });
    s.addShape('rect', { x, y: top, w: cardW, h: 0.09, fill: { color: p.color }, line: { color: p.color } });
    s.addText([
      { text: p.en, options: { fontFace: F.enBold, fontSize: 14, color: C.ink, breakLine: true } },
      { text: p.kn, options: { fontFace: F.kn, fontSize: KN(10), color: C.brand2 } },
    ], { x: x + 0.2, y: top + 0.18, w: cardW - 0.3, h: titleH, valign: 'top', margin: 0 });
    s.addShape('line', { x: x + 0.2, y: top + 0.18 + titleH + 0.02, w: cardW - 0.4, h: 0, line: { color: C.line, width: 1 } });
    s.addText(p.points.map((t, j) => ({
      text: t,
      options: { bullet: { indent: 12 }, breakLine: j < p.points.length - 1, paraSpaceAfter: 4 },
    })), { x: x + 0.2, y: top + 0.18 + titleH + 0.12, w: cardW - 0.3, h: cardH - titleH - 0.4, fontFace: F.en, fontSize: 11.5, color: C.muted, valign: 'top', margin: 0 });
  });

  /* Proven in Pravesha. */
  const stripY = top + cardH + 0.25;
  s.addText([
    { text: 'Also built & proven while developing Pravesha', options: { fontFace: F.enBold, fontSize: 13, color: C.ink } },
    { text: '   ·   ', options: { fontFace: F.en, fontSize: 13, color: C.line } },
    { text: 'ಪ್ರವೇಶ ಅಭಿವೃದ್ಧಿಯಲ್ಲಿ ಸಾಬೀತಾದ ಇತರ ಸಾಮರ್ಥ್ಯಗಳು', options: { fontFace: F.kn, fontSize: KN(11), color: C.brand2 } },
  ], { x: GUTTER, y: stripY, w: W - GUTTER * 2, h: 0.4, valign: 'middle', margin: 0 });

  /* One line of English and one of Kannada per chip — longer and it spills. */
  const proven = [
    ['Payment gateway & auto-reconciliation', 'ಪಾವತಿ ಗೇಟ್‌ವೇ ಮತ್ತು ಸ್ವಯಂ ಹೊಂದಾಣಿಕೆ'],
    ['GST tax invoices & PDF entry passes', 'ಜಿಎಸ್‌ಟಿ ಇನ್‌ವಾಯ್ಸ್ ಮತ್ತು PDF ಪಾಸ್'],
    ['Automated Excel & PDF reports', 'ಸ್ವಯಂಚಾಲಿತ Excel ಮತ್ತು PDF ವರದಿಗಳು'],
    ['Role-based dashboards & live analytics', 'ಪಾತ್ರಾಧಾರಿತ ಡ್ಯಾಶ್‌ಬೋರ್ಡ್ ಮತ್ತು ವಿಶ್ಲೇಷಣೆ'],
    ['Offline-ready checkpost app, OTP login', 'ಆಫ್‌ಲೈನ್‌ನಲ್ಲೂ ಕೆಲಸ ಮಾಡುವ ಚೆಕ್‌ಪೋಸ್ಟ್ ಆ್ಯಪ್'],
    ['DLT-registered SMS OTP & email alerts', 'SMS OTP ಮತ್ತು ಇಮೇಲ್ ಸೂಚನೆಗಳು'],
  ];
  const cols = 3;
  const chipGap = 0.2;
  const chipW = (W - GUTTER * 2 - chipGap * (cols - 1)) / cols;
  const chipH = 0.66;
  const chipTop = stripY + 0.48;
  proven.forEach(([en, kn], i) => {
    const x = GUTTER + (i % cols) * (chipW + chipGap);
    const y = chipTop + Math.floor(i / cols) * (chipH + 0.1);
    s.addShape('roundRect', { x, y, w: chipW, h: chipH, fill: { color: C.mist }, line: { color: C.mist2 }, rectRadius: 0.06 });
    s.addShape('ellipse', { x: x + 0.15, y: y + chipH / 2 - 0.06, w: 0.12, h: 0.12, fill: { color: C.accent }, line: { color: C.accent } });
    s.addText([
      { text: en, options: { fontFace: F.enBold, fontSize: 10.5, color: C.ink, breakLine: true } },
      { text: kn, options: { fontFace: F.kn, fontSize: KN(8.5), color: C.muted } },
    ], { x: x + 0.38, y, w: chipW - 0.48, h: chipH, valign: 'middle', margin: 0 });
  });
}

/**
 * Agenda 4 — scope: the problems at the checkpost Pravesha is built to solve.
 *
 * The problems are the user's, as observed at the gate. Each answer is what the
 * system actually does, and can be traced to it: the plate is checked against
 * the day's bookings (016_remove_qr — nothing to forge, works without signal),
 * the gate's verdicts (already_used, wrong_day …), the vehicle type from the
 * registration record, slot capacity per vehicle type, admin alerts on spikes,
 * and payments reconciled and reported every day.
 */
function scope(pptx) {
  const s = pptx.addSlide({ masterName: 'CONTENT' });
  heading(s, AGENDA[3].en, AGENDA[3].kn);

  const rows = [
    ['Forged tickets', 'ನಕಲಿ ಟಿಕೆಟ್‌ಗಳು',
      'Nothing to forge — the gate checks the number plate against the day\'s bookings', 'ನಕಲಿ ಮಾಡಲು ಏನೂ ಇಲ್ಲ — ವಾಹನ ಸಂಖ್ಯೆಯನ್ನೇ ನೇರವಾಗಿ ಪರಿಶೀಲನೆ'],
    ['Same vehicle entering many times', 'ಒಂದೇ ವಾಹನ ಹಲವು ಬಾರಿ ಪ್ರವೇಶ',
      'Every entry is recorded — a repeat is flagged "already used"', 'ಪ್ರತಿ ಪ್ರವೇಶ ದಾಖಲು — ಮತ್ತೆ ಬಂದರೆ "ಈಗಾಗಲೇ ಬಳಸಲಾಗಿದೆ"'],
    ['One ticket, many vehicles', 'ಒಂದೇ ಟಿಕೆಟ್‌ನಲ್ಲಿ ಹಲವು ವಾಹನಗಳು',
      'Each pass is bound to one vehicle number — any other vehicle is refused', 'ಪಾಸ್ ಒಂದೇ ವಾಹನಕ್ಕೆ ಸೀಮಿತ — ಬೇರೆ ವಾಹನಕ್ಕೆ ಪ್ರವೇಶವಿಲ್ಲ'],
    ['Staff cannot verify tickets', 'ಸಿಬ್ಬಂದಿಗೆ ಪರಿಶೀಲನೆ ಕಷ್ಟ',
      'Staff app gives a verdict in seconds — even without mobile signal', 'ಕೆಲವೇ ಸೆಕೆಂಡುಗಳಲ್ಲಿ ಪರಿಶೀಲನೆ — ನೆಟ್‌ವರ್ಕ್ ಇಲ್ಲದಿದ್ದರೂ'],
    ['Weekend & holiday rush, sudden spikes', 'ವಾರಾಂತ್ಯ, ರಜಾದಿನಗಳ ದಟ್ಟಣೆ ಮತ್ತು ಏಕಾಏಕಿ ಏರಿಕೆ',
      'Slots capped per vehicle type spread the rush; spikes raise an alert', 'ಸ್ಲಾಟ್‌ವಾರು ಮಿತಿಯಿಂದ ದಟ್ಟಣೆ ಹಂಚಿಕೆ; ಏರಿಕೆಗೆ ಎಚ್ಚರಿಕೆ'],
    ['Edited dates, vehicle numbers & IDs', 'ದಿನಾಂಕ, ವಾಹನ ಸಂಖ್ಯೆ, ಗುರುತಿನ ತಿದ್ದುಪಡಿ',
      'Editing a PDF or screenshot changes nothing — the system record decides', 'ತಿದ್ದಿದ PDF ಅಥವಾ ಸ್ಕ್ರೀನ್‌ಶಾಟ್ ವ್ಯರ್ಥ — ವ್ಯವಸ್ಥೆಯ ದಾಖಲೆಯೇ ಅಂತಿಮ'],
    ['Revenue loss & scams', 'ಆದಾಯ ನಷ್ಟ ಮತ್ತು ವಂಚನೆ',
      /* "recorded", not "online": the gate also sells on the spot, with the
         UPI screen photographed as proof (042_gate_onspot, 044_gate_photos). */
      'Every payment recorded and traceable — reconciled and reported daily', 'ಪ್ರತಿ ಪಾವತಿ ದಾಖಲಿತ, ಪತ್ತೆಹಚ್ಚಬಹುದು — ದೈನಂದಿನ ವರದಿ'],
  ];

  const RED = 'DC2626';
  const leftW = 4.55;
  const arrowW = 0.5;
  const rightX = GUTTER + leftW + arrowW;
  const rightW = W - GUTTER - rightX;

  /* Column captions. */
  const capY = 1.82;
  s.addText([
    { text: 'At the checkpost today', options: { fontFace: F.enBold, fontSize: 12, color: RED } },
    { text: '   ·   ಇಂದಿನ ಸಮಸ್ಯೆಗಳು', options: { fontFace: F.kn, fontSize: KN(10), color: C.muted } },
  ], { x: GUTTER, y: capY, w: leftW, h: 0.34, valign: 'middle', margin: 0 });
  s.addText([
    { text: 'How Pravesha covers it', options: { fontFace: F.enBold, fontSize: 12, color: C.brand2 } },
    { text: '   ·   ಪ್ರವೇಶ ಪರಿಹಾರ', options: { fontFace: F.kn, fontSize: KN(10), color: C.muted } },
  ], { x: rightX, y: capY, w: rightW, h: 0.34, valign: 'middle', margin: 0 });

  const top = capY + 0.42;
  const pitch = (H - FOOTER_H - 0.18 - top) / rows.length;
  const boxH = pitch - 0.08;

  rows.forEach(([pe, pk, se, sk], i) => {
    const y = top + i * pitch;

    s.addShape('roundRect', { x: GUTTER, y, w: leftW, h: boxH, fill: { color: 'FEF2F2' }, line: { color: 'FEE2E2' }, rectRadius: 0.06 });
    s.addShape('rect', { x: GUTTER, y, w: 0.07, h: boxH, fill: { color: RED }, line: { color: RED } });
    s.addText([
      { text: pe, options: { fontFace: F.enBold, fontSize: 12.5, color: C.ink, breakLine: true } },
      { text: pk, options: { fontFace: F.kn, fontSize: KN(9), color: C.muted } },
    ], { x: GUTTER + 0.22, y, w: leftW - 0.32, h: boxH, valign: 'middle', margin: 0 });

    s.addShape('rightArrow', { x: GUTTER + leftW + 0.12, y: y + boxH / 2 - 0.12, w: arrowW - 0.24, h: 0.24, fill: { color: C.accent }, line: { color: C.accent } });

    s.addShape('roundRect', { x: rightX, y, w: rightW, h: boxH, fill: { color: C.mist }, line: { color: C.mist2 }, rectRadius: 0.06 });
    s.addShape('rect', { x: rightX, y, w: 0.07, h: boxH, fill: { color: C.accent }, line: { color: C.accent } });
    s.addText([
      { text: se, options: { fontFace: F.en, fontSize: 12, color: C.ink, breakLine: true } },
      { text: sk, options: { fontFace: F.kn, fontSize: KN(9), color: C.brand2 } },
    ], { x: rightX + 0.22, y, w: rightW - 0.32, h: boxH, valign: 'middle', margin: 0 });
  });
}

/**
 * Agenda 5 — advantages, then who benefits and how.
 *
 * No brief beyond the heading, so every line is a feature this system has:
 * the admin live view, the period reports, slot capacity and closures, the
 * watchlist; WhatsApp booking and Razorpay payment, the PDF pass, English and
 * Kannada; the gate's plate search, offline mode, OTP login, shift handover.
 */
function benefits(pptx) {
  const s = pptx.addSlide({ masterName: 'CONTENT' });
  heading(s, AGENDA[4].en, AGENDA[4].kn);

  liveDemoTag(s, { x: 6.7, w: 3.7, en: 'You will see all of these in the', kn: 'ಇವೆಲ್ಲವನ್ನೂ ನೇರ ಪ್ರಾತ್ಯಕ್ಷಿಕೆಯಲ್ಲಿ ನೋಡಲಿದ್ದೀರಿ' });

  /* The four advantages, across the top. */
  const advantages = [
    ['No app to install', 'ಆ್ಯಪ್ ಇನ್‌ಸ್ಟಾಲ್ ಬೇಕಿಲ್ಲ', 'Works inside WhatsApp'],
    ['Book 24 × 7', 'ಯಾವಾಗ ಬೇಕಾದರೂ ಬುಕಿಂಗ್', 'From home or on the road'],
    ['Works without signal', 'ನೆಟ್‌ವರ್ಕ್ ಇಲ್ಲದಿದ್ದರೂ', 'At the gate, when the network drops'],
    ['Every rupee accounted for', 'ಪ್ರತಿ ರೂಪಾಯಿಗೂ ಲೆಕ್ಕ', 'Reconciled and reported daily'],
  ];
  const top = 1.9;
  const tileGap = 0.2;
  const tileW = (W - GUTTER * 2 - tileGap * 3) / 4;
  const tileH = 0.86;
  advantages.forEach(([en, kn, sub], i) => {
    const x = GUTTER + i * (tileW + tileGap);
    s.addShape('roundRect', { x, y: top, w: tileW, h: tileH, fill: { color: C.brand }, line: { color: C.brand }, rectRadius: 0.08 });
    s.addShape('ellipse', { x: x + 0.18, y: top + tileH / 2 - 0.17, w: 0.34, h: 0.34, fill: { color: C.accent }, line: { color: C.accent } });
    s.addText('✓', { x: x + 0.18, y: top + tileH / 2 - 0.17, w: 0.34, h: 0.34, fontFace: F.enBold, fontSize: 13, color: C.white, align: 'center', valign: 'middle', margin: 0 });
    s.addText([
      { text: en, options: { fontFace: F.enBold, fontSize: 12.5, color: C.white, breakLine: true } },
      { text: kn, options: { fontFace: F.kn, fontSize: KN(9), color: 'CFE5DC', breakLine: true } },
      { text: sub, options: { fontFace: F.en, fontSize: 9.5, color: 'CFE5DC' } },
    ], { x: x + 0.62, y: top, w: tileW - 0.72, h: tileH, valign: 'middle', margin: 0 });
  });

  /* Who benefits. */
  /* One line of English and one of Kannada per point: two-line points in a
     column this narrow run into the divider below. */
  /* Five points a column, so the dividers line up across the three.
     The visitor line says "no website to find", not "no browser": the booking
     form and the payment open from a button in the chat, in WhatsApp's own
     browser (src/web/bookingClient.js, /pay/<token>), and the live demo will
     show that page opening. */
  const groups = [
    { en: 'For the Department', kn: 'ಇಲಾಖೆಗೆ', color: C.brand, points: [
      ['Pin-to-pin tracking, start to end of day', 'ದಿನವಿಡೀ ಸಂಪೂರ್ಣ ನಿಗಾ'],
      ['Live view of entries & collections', 'ಪ್ರವೇಶ ಮತ್ತು ಸಂಗ್ರಹದ ನೇರ ನೋಟ'],
      /* jobs/periodReports.js: 8 PM IST, to the officers named in Settings. */
      ['8 PM report on WhatsApp, every day', 'ಪ್ರತಿದಿನ ರಾತ್ರಿ 8ಕ್ಕೆ ವಾಟ್ಸಾಪ್ ವರದಿ'],
      ['Set capacity; close slots for rain', 'ಸಾಮರ್ಥ್ಯ ನಿಗದಿ; ಮಳೆಗೆ ಸ್ಲಾಟ್ ಬಂದ್'],
      ['Watchlist to stop or flag vehicles', 'ವಾಹನಗಳ ತಡೆ ಅಥವಾ ಗಮನ ಪಟ್ಟಿ'],
    ] },
    { en: 'For Visitors', kn: 'ಪ್ರವಾಸಿಗರಿಗೆ', color: C.accent, points: [
      ['Starts with "Hi" — no website to find', '"Hi" ಎಂದರೆ ಸಾಕು — ವೆಬ್‌ಸೈಟ್ ಬೇಕಿಲ್ಲ'],
      /* Unlike the present booking site, which asks for the vehicle type before
         it shows slots: the type comes from the registration record, and the
         date's slots are shown together (017_declared_category, bookingClient). */
      ['Vehicle number sets the type automatically', 'ವಾಹನ ಸಂಖ್ಯೆಯಿಂದಲೇ ಪ್ರಕಾರ ಸ್ವಯಂ ನಿರ್ಧಾರ'],
      ['All slots for the date shown at once', 'ದಿನಾಂಕದ ಎಲ್ಲಾ ಸ್ಲಾಟ್‌ಗಳು ಒಮ್ಮೆಲೇ'],
      ['Pay by UPI, card or net banking', 'UPI, ಕಾರ್ಡ್, ನೆಟ್ ಬ್ಯಾಂಕಿಂಗ್ ಪಾವತಿ'],
      ['PDF pass & entry confirmation', 'PDF ಪಾಸ್ ಮತ್ತು ಪ್ರವೇಶ ದೃಢೀಕರಣ'],
    ] },
    { en: 'For Checkpost Staff', kn: 'ಚೆಕ್‌ಪೋಸ್ಟ್ ಸಿಬ್ಬಂದಿಗೆ', color: C.sun, points: [
      ['4 digits show the full vehicle number', '4 ಅಂಕೆಗಳಿಂದ ಪೂರ್ಣ ವಾಹನ ಸಂಖ್ಯೆ'],
      ['Select & approve — under 1 second', 'ಆಯ್ಕೆ, ಅನುಮೋದನೆ — 1 ಸೆಕೆಂಡಿಗಿಂತ ಕಡಿಮೆ'],
      ['No rush, no waiting — hassle-free', 'ದಟ್ಟಣೆ ಇಲ್ಲ, ಕಾಯುವಿಕೆ ಇಲ್ಲ — ಸುಲಭ'],
      ['Works offline when signal drops', 'ನೆಟ್‌ವರ್ಕ್ ಇಲ್ಲದಿದ್ದರೂ ಕೆಲಸ'],
      ['OTP login & shift handover', 'OTP ಲಾಗಿನ್ ಮತ್ತು ಪಾಳಿ ಹಸ್ತಾಂತರ'],
    ] },
  ];
  const colTop = top + tileH + 0.25;
  const colGap = 0.3;
  const colW = (W - GUTTER * 2 - colGap * 2) / 3;
  const colH = H - FOOTER_H - 0.18 - colTop;
  const headH = 0.78;
  groups.forEach((g, i) => {
    const x = GUTTER + i * (colW + colGap);
    s.addShape('roundRect', { x, y: colTop, w: colW, h: colH, fill: { color: C.white }, line: { color: C.line }, rectRadius: 0.08 });
    s.addShape('rect', { x, y: colTop, w: colW, h: 0.09, fill: { color: g.color }, line: { color: g.color } });
    /* Kannada on its own line, so no header wraps. */
    s.addText([
      { text: g.en, options: { fontFace: F.enBold, fontSize: 15, color: C.ink, breakLine: true } },
      { text: g.kn, options: { fontFace: F.kn, fontSize: KN(10), color: C.brand2 } },
    ], { x: x + 0.22, y: colTop + 0.12, w: colW - 0.3, h: headH - 0.12, valign: 'middle', margin: 0 });

    const pitch = (colH - headH - 0.1) / g.points.length;
    g.points.forEach(([en, kn], j) => {
      const y = colTop + headH + j * pitch;
      s.addShape('line', { x: x + 0.22, y, w: colW - 0.44, h: 0, line: { color: C.line, width: 1 } });
      s.addShape('ellipse', { x: x + 0.24, y: y + pitch / 2 - 0.12, w: 0.11, h: 0.11, fill: { color: g.color }, line: { color: g.color } });
      s.addText([
        { text: en, options: { fontFace: F.en, fontSize: 12, color: C.ink, breakLine: true } },
        { text: kn, options: { fontFace: F.kn, fontSize: KN(8.5), color: C.muted } },
      ], { x: x + 0.46, y, w: colW - 0.62, h: pitch, valign: 'middle', margin: 0 });
    });
  });
}

/**
 * Agenda 6 — limitations, each with what is done about it.
 *
 * The first is the user's: a one-person company, and how continuity is kept
 * (a laptop always at hand, a trained standby contact, remote support across
 * the stack). The rest are real limits already handled in this code: vehicles
 * with no registration record (017_declared_category), visitors without a
 * smartphone (042_gate_onspot, 044_gate_photos), no signal at the gate
 * (016_remove_qr), slow payment confirmation (jobs/reconcile, holds that
 * expire), and Meta's template approval (English sent until Kannada is approved).
 */
function limitations(pptx) {
  const s = pptx.addSlide({ masterName: 'CONTENT' });
  heading(s, AGENDA[5].en, AGENDA[5].kn);

  const rows = [
    ['Single-person organisation', 'ಏಕವ್ಯಕ್ತಿ ಸಂಸ್ಥೆ',
      'Founder on call with a laptop, always; a trained standby covers any absence', 'ಸಂಸ್ಥಾಪಕರು ಲ್ಯಾಪ್‌ಟಾಪ್ ಸಹಿತ ಸದಾ ಲಭ್ಯ; ಅನುಪಸ್ಥಿತಿಯಲ್ಲಿ ತರಬೇತಿ ಪಡೆದ ಪರ್ಯಾಯ ವ್ಯಕ್ತಿ'],
    ['Vehicle data depends on ULIP records', 'ವಾಹನ ಮಾಹಿತಿ ULIP ದಾಖಲೆಗಳ ಮೇಲೆ ಅವಲಂಬಿತ',
      'No record? The visitor picks the type and the gate is told to check the vehicle', 'ದಾಖಲೆ ಇಲ್ಲದಿದ್ದರೆ ಪ್ರವಾಸಿಗರೇ ಪ್ರಕಾರ ಆಯ್ಕೆ — ಗೇಟ್‌ನಲ್ಲಿ ಪರಿಶೀಲನೆಗೆ ಸೂಚನೆ'],
    ['Booking needs a smartphone & WhatsApp', 'ಬುಕಿಂಗ್‌ಗೆ ಸ್ಮಾರ್ಟ್‌ಫೋನ್, ವಾಟ್ಸಾಪ್ ಬೇಕು',
      'Staff can sell a pass on the spot, with the UPI payment photographed as proof', 'ಗೇಟ್‌ನಲ್ಲೇ ಪಾಸ್ ಮಾರಾಟ — UPI ಪಾವತಿಯ ಫೋಟೋ ಸಾಕ್ಷಿಯಾಗಿ'],
    /* Said exactly as it behaves. "Keeps working offline" was true of checking
       a pass and untrue of selling one, and the gap would have shown itself at
       the gate rather than in this room (verified against the gate app's queue,
       2026-09-15): a sale takes the next pass and invoice number and a place in
       the slot, which two phones with no signal could each give away. */
    ['Weak mobile signal at the hilltop gate', 'ಗೇಟ್‌ನಲ್ಲಿ ದುರ್ಬಲ ಮೊಬೈಲ್ ಸಿಗ್ನಲ್',
      'Entries carry on from the day\'s list saved on the phone, and sync when signal returns',
      'ಫೋನ್‌ನಲ್ಲಿರುವ ಪಟ್ಟಿಯಿಂದ ಪ್ರವೇಶ ಮುಂದುವರಿಕೆ — ಸಿಗ್ನಲ್ ಬಂದಾಗ ಸಿಂಕ್'],
    /* Its own row, not a clause of the one above (user, 2026-09-15). */
    ['Selling a new pass needs signal', 'ಹೊಸ ಪಾಸ್ ಮಾರಾಟಕ್ಕೆ ಸಿಗ್ನಲ್ ಬೇಕು',
      'Check-ins continue; sales resume with signal, so no pass, invoice or slot place is issued twice',
      'ಪರಿಶೀಲನೆ ಮುಂದುವರಿಕೆ; ಮಾರಾಟ ಸಿಗ್ನಲ್ ಬಂದಾಗ — ಪಾಸ್, ಇನ್‌ವಾಯ್ಸ್ ಎರಡು ಬಾರಿ ಆಗದಂತೆ'],
    ['Payment confirmations can be delayed', 'ಪಾವತಿ ದೃಢೀಕರಣ ತಡವಾಗಬಹುದು',
      'Payments auto-reconciled every 45 seconds; unpaid holds released automatically', 'ಪ್ರತಿ 45 ಸೆಕೆಂಡಿಗೆ ಸ್ವಯಂ ಹೊಂದಾಣಿಕೆ; ಪಾವತಿಯಾಗದ ಸ್ಥಾನ ಸ್ವಯಂ ಬಿಡುಗಡೆ'],
    ['WhatsApp templates need Meta approval', 'ಸಂದೇಶ ಮಾದರಿಗಳಿಗೆ Meta ಅನುಮೋದನೆ ಬೇಕು',
      'English messages are sent as a fallback while Kannada ones await approval', 'ಕನ್ನಡ ಮಾದರಿ ಅನುಮೋದನೆಯವರೆಗೆ ಇಂಗ್ಲಿಷ್ ಸಂದೇಶ ಬದಲಿಯಾಗಿ'],
  ];

  const AMBER = 'D97706';
  const leftW = 4.55;
  const arrowW = 0.5;
  const rightX = GUTTER + leftW + arrowW;
  const rightW = W - GUTTER - rightX;

  const capY = 1.82;
  s.addText([
    { text: 'Limitation', options: { fontFace: F.enBold, fontSize: 12, color: AMBER } },
    { text: '   ·   ಮಿತಿ', options: { fontFace: F.kn, fontSize: KN(10), color: C.muted } },
  ], { x: GUTTER, y: capY, w: leftW, h: 0.34, valign: 'middle', margin: 0 });
  s.addText([
    { text: 'How we address it', options: { fontFace: F.enBold, fontSize: 12, color: C.brand2 } },
    { text: '   ·   ಪರಿಹಾರ', options: { fontFace: F.kn, fontSize: KN(10), color: C.muted } },
    { text: '        Every platform has limits — these are ours, stated openly.', options: { fontFace: F.en, fontSize: 10.5, italic: true, color: C.muted } },
  ], { x: rightX, y: capY, w: rightW, h: 0.34, valign: 'middle', margin: 0 });

  /* Room at the bottom for what support covers. */
  const stripH = 0.62;
  const top = capY + 0.42;
  const rowsBottom = H - FOOTER_H - 0.18 - stripH - 0.14;
  const pitch = (rowsBottom - top) / rows.length;
  const boxH = pitch - 0.08;

  rows.forEach(([le, lk, re, rk], i) => {
    const y = top + i * pitch;
    s.addShape('roundRect', { x: GUTTER, y, w: leftW, h: boxH, fill: { color: 'FFFBEB' }, line: { color: 'FEF3C7' }, rectRadius: 0.06 });
    s.addShape('rect', { x: GUTTER, y, w: 0.07, h: boxH, fill: { color: AMBER }, line: { color: AMBER } });
    s.addText([
      { text: le, options: { fontFace: F.enBold, fontSize: 12, color: C.ink, breakLine: true } },
      { text: lk, options: { fontFace: F.kn, fontSize: KN(8.5), color: C.muted } },
    ], { x: GUTTER + 0.22, y, w: leftW - 0.32, h: boxH, valign: 'middle', margin: 0 });

    s.addShape('rightArrow', { x: GUTTER + leftW + 0.12, y: y + boxH / 2 - 0.12, w: arrowW - 0.24, h: 0.24, fill: { color: C.accent }, line: { color: C.accent } });

    s.addShape('roundRect', { x: rightX, y, w: rightW, h: boxH, fill: { color: C.mist }, line: { color: C.mist2 }, rectRadius: 0.06 });
    s.addShape('rect', { x: rightX, y, w: 0.07, h: boxH, fill: { color: C.accent }, line: { color: C.accent } });
    s.addText([
      { text: re, options: { fontFace: F.en, fontSize: 11.5, color: C.ink, breakLine: true } },
      { text: rk, options: { fontFace: F.kn, fontSize: KN(8.5), color: C.brand2 } },
    ], { x: rightX + 0.22, y, w: rightW - 0.32, h: boxH, valign: 'middle', margin: 0 });
  });

  /* What quick support covers. */
  const stripY = rowsBottom + 0.14;
  s.addShape('roundRect', { x: GUTTER, y: stripY, w: W - GUTTER * 2, h: stripH, fill: { color: C.brand }, line: { color: C.brand }, rectRadius: 0.08 });
  s.addText([
    { text: 'Quick support for', options: { fontFace: F.enBold, fontSize: 12.5, color: C.white, breakLine: true } },
    { text: 'ತ್ವರಿತ ಬೆಂಬಲ', options: { fontFace: F.kn, fontSize: KN(9), color: 'CFE5DC' } },
  ], { x: GUTTER + 0.25, y: stripY, w: 1.9, h: stripH, valign: 'middle', margin: 0 });
  const areas = ['VPS & server', 'Payments', 'Tickets & bookings', 'Slots', 'RC fetch (ULIP)', 'and more'];
  const chipsX = GUTTER + 2.25;
  const chipsW = W - GUTTER - 0.2 - chipsX;
  const chipGap = 0.14;
  const chipW = (chipsW - chipGap * (areas.length - 1)) / areas.length;
  areas.forEach((a, i) => {
    const x = chipsX + i * (chipW + chipGap);
    const last = i === areas.length - 1;
    s.addShape('roundRect', { x, y: stripY + 0.14, w: chipW, h: stripH - 0.28, fill: { color: last ? C.brand : C.brand2 }, line: { color: last ? '4F9A8F' : C.brand2 }, rectRadius: 0.17 });
    s.addText(a, { x, y: stripY + 0.14, w: chipW, h: stripH - 0.28, fontFace: F.enBold, fontSize: 11, color: C.white, align: 'center', valign: 'middle', margin: 0, italic: last });
  });
}

/* ───────────────────────────────────────── agenda 7: how it works (×3) ── */

/**
 * How it works, 1 of 3 — the visitor's journey, step by step.
 *
 * As the code runs it: a greeting (src/whatsapp/inbox.js), terms once and the
 * language every time (welcome.js), "Book pass" answered with a signed single-use
 * link valid two hours (webToken.js), the booking page reading the vehicle type
 * from the registration and showing places per type (routes/bookWeb.js), payment
 * with the place held (checkout.js, inventory.hold), the pass as a message and a
 * PDF with its GST invoice created (whatsapp/deliver.js), and the gate.
 */
function journey(pptx) {
  const s = pptx.addSlide({ masterName: 'CONTENT' });
  heading(s, 'How It Works — The Visitor\'s Journey', 'ಕಾರ್ಯವಿಧಾನ — ಪ್ರವಾಸಿಗರ ಬುಕಿಂಗ್ ಹಾದಿ');
  /* Right of this longer title, left of the logo: a narrower tag. */
  liveDemoTag(s, { x: 7.55, w: 3.3, en: 'You will see this journey in the', kn: 'ಈ ಹಾದಿಯನ್ನು ನೇರ ಪ್ರಾತ್ಯಕ್ಷಿಕೆಯಲ್ಲಿ ನೋಡಲಿದ್ದೀರಿ', knSize: 8 });

  const steps = [
    ['Say "Hi"', '"Hi" ಎಂದು ಕಳುಹಿಸಿ', 'Accept terms once · choose English or Kannada', 'ಒಮ್ಮೆ ನಿಯಮ ಒಪ್ಪಿಗೆ · ಭಾಷೆ ಆಯ್ಕೆ'],
    ['Tap "Book pass"', '"ಪಾಸ್ ಬುಕ್ ಮಾಡಿ" ಒತ್ತಿ', 'A secure one-time link, valid for 2 hours', '2 ಗಂಟೆ ಮಾನ್ಯವಾದ ಸುರಕ್ಷಿತ ಲಿಂಕ್'],
    ['Enter vehicle number', 'ವಾಹನ ಸಂಖ್ಯೆ ನಮೂದಿಸಿ', 'Vehicle type read from the registration record', 'ನೋಂದಣಿ ದಾಖಲೆಯಿಂದ ವಾಹನ ಪ್ರಕಾರ'],
    ['Choose date & slot', 'ದಿನಾಂಕ, ಸ್ಲಾಟ್ ಆಯ್ಕೆ', 'Places left for this vehicle · one pass per vehicle per day', 'ಲಭ್ಯ ಸ್ಥಾನಗಳು · ದಿನಕ್ಕೆ ಒಂದೇ ಪಾಸ್'],
    ['Pay securely', 'ಸುರಕ್ಷಿತ ಪಾವತಿ', 'UPI, card or net banking · place held while paying', 'UPI, ಕಾರ್ಡ್, ನೆಟ್ ಬ್ಯಾಂಕಿಂಗ್ · ಸ್ಥಾನ ಕಾಯ್ದಿರಿಕೆ'],
    ['Pass on WhatsApp', 'ವಾಟ್ಸಾಪ್‌ನಲ್ಲಿ ಪಾಸ್', 'Pass details and PDF · GST invoice created', 'ಪಾಸ್ ವಿವರ, PDF · ಜಿಎಸ್‌ಟಿ ಇನ್‌ವಾಯ್ಸ್'],
    /* The entry is confirmed to the visitor on WhatsApp the moment it is
       recorded (gatepass/checkin.js → templates.sendEntryRecorded). */
    ['Entry at the gate', 'ಗೇಟ್‌ನಲ್ಲಿ ಪ್ರವೇಶ', 'Staff approve · visitor gets a WhatsApp confirmation', 'ಅನುಮೋದನೆ · ವಾಟ್ಸಾಪ್‌ನಲ್ಲಿ ಪ್ರವೇಶ ದೃಢೀಕರಣ'],
  ];

  /* Two rows of four, snaking: left to right, down, then right to left. */
  const top = 1.95;
  const colGap = 0.42;
  const rowGap = 0.36;
  const cardW = (W - GUTTER * 2 - colGap * 3) / 4;
  const cardH = (H - FOOTER_H - 0.16 - top - rowGap) / 2;
  const cell = (i) => {
    const row = i < 4 ? 0 : 1;
    const col = row === 0 ? i : 7 - i;
    return { x: GUTTER + col * (cardW + colGap), y: top + row * (cardH + rowGap), row, col };
  };

  steps.forEach(([en, kn, d, dk], i) => {
    const { x, y } = cell(i);
    const color = i === steps.length - 1 ? C.sun : C.brand;
    s.addShape('roundRect', { x, y, w: cardW, h: cardH, fill: { color: C.white }, line: { color: C.line }, rectRadius: 0.08 });
    s.addShape('rect', { x, y, w: cardW, h: 0.08, fill: { color }, line: { color } });
    s.addShape('ellipse', { x: x + 0.18, y: y + 0.2, w: 0.4, h: 0.4, fill: { color }, line: { color } });
    s.addText(String(i + 1), { x: x + 0.18, y: y + 0.2, w: 0.4, h: 0.4, fontFace: F.enBold, fontSize: 13, color: C.white, align: 'center', valign: 'middle', margin: 0 });
    s.addText([
      { text: `Step ${i + 1}`, options: { fontFace: F.en, fontSize: 10, color: C.muted } },
      { text: `  ·  ಹಂತ ${i + 1}`, options: { fontFace: F.kn, fontSize: KN(8), color: C.muted } },
    ], { x: x + 0.68, y: y + 0.2, w: cardW - 0.8, h: 0.4, valign: 'middle', margin: 0 });
    s.addText([
      { text: en, options: { fontFace: F.enBold, fontSize: 14, color: C.ink, breakLine: true } },
      { text: kn, options: { fontFace: F.kn, fontSize: KN(10), color: C.brand2 } },
    ], { x: x + 0.18, y: y + 0.68, w: cardW - 0.3, h: 0.66, valign: 'top', margin: 0 });
    s.addShape('line', { x: x + 0.18, y: y + 1.38, w: cardW - 0.36, h: 0, line: { color: C.line, width: 1 } });
    s.addText([
      { text: d, options: { fontFace: F.en, fontSize: 10.5, color: C.ink, breakLine: true } },
      { text: dk, options: { fontFace: F.kn, fontSize: KN(8), color: C.muted } },
    ], { x: x + 0.18, y: y + 1.44, w: cardW - 0.3, h: cardH - 1.5, valign: 'top', margin: 0 });
  });

  /* Arrows along the snake. */
  const arrow = (shape, x, y, w, h) => s.addShape(shape, { x, y, w, h, fill: { color: C.accent }, line: { color: C.accent } });
  for (let i = 0; i < steps.length; i += 1) {
    const a = cell(i);
    const b = cell(i + 1);
    if (a.row === b.row) {
      const leftX = Math.min(a.x, b.x) + cardW;
      arrow(a.row === 0 ? 'rightArrow' : 'leftArrow', leftX + 0.08, a.y + cardH / 2 - 0.12, colGap - 0.16, 0.24);
    } else {
      arrow('downArrow', a.x + cardW / 2 - 0.12, a.y + cardH + 0.06, 0.24, rowGap - 0.12);
    }
  }

  /* The eighth cell: how long it all takes. */
  const end = cell(7);
  s.addShape('roundRect', { x: end.x, y: end.y, w: cardW, h: cardH, fill: { color: C.brand }, line: { color: C.brand }, rectRadius: 0.08 });
  s.addText([
    { text: 'About a minute', options: { fontFace: F.enBold, fontSize: 22, color: C.white, breakLine: true } },
    { text: 'ಸುಮಾರು ಒಂದು ನಿಮಿಷ', options: { fontFace: F.kn, fontSize: KN(12), color: 'CFE5DC', breakLine: true } },
    { text: 'from "Hi" to the pass in hand', options: { fontFace: F.en, fontSize: 12, color: C.white, breakLine: true, paraSpaceBefore: 8 } },
    { text: '"Hi" ಇಂದ ಕೈಯಲ್ಲಿ ಪಾಸ್‌ವರೆಗೆ', options: { fontFace: F.kn, fontSize: KN(9), color: 'CFE5DC' } },
  ], { x: end.x + 0.2, y: end.y, w: cardW - 0.4, h: cardH, align: 'center', valign: 'middle', margin: 0 });
}

/**
 * A "LIVE DEMO" tag hanging from the top edge on two strings, for a slide whose
 * content is shown working in the demo. Amber, like the agenda's Live
 * Demonstration row. The caller places it clear of the title's text and left of
 * the Pravesha logo in the corner.
 */
function liveDemoTag(s, { x, w, en, kn, knSize = 8.5 }) {
  const tag = { x, y: 0.52, w, h: 1.0, tilt: -4 };
  const hookX = tag.x + tag.w / 2;
  s.addShape('line', { x: hookX - 0.45, y: 0, w: 0.45, h: tag.y + 0.1, line: { color: 'B45309', width: 1 } });
  s.addShape('line', { x: hookX, y: 0, w: 0.45, h: tag.y + 0.1, flipH: true, line: { color: 'B45309', width: 1 } });
  s.addShape('roundRect', { x: tag.x, y: tag.y, w: tag.w, h: tag.h, rotate: tag.tilt, fill: { color: 'FEF3C7' }, line: { color: C.sun, width: 1.5 }, rectRadius: 0.1, shadow: { type: 'outer', color: '000000', opacity: 0.18, blur: 4, offset: 2, angle: 90 } });
  s.addShape('ellipse', { x: hookX - 0.06, y: tag.y + 0.04, w: 0.12, h: 0.12, fill: { color: C.white }, line: { color: 'B45309', width: 1 } });
  s.addText([
    { text: en, options: { fontFace: F.en, fontSize: 11, color: C.ink, breakLine: true } },
    { text: '●  LIVE DEMO', options: { fontFace: F.enBold, fontSize: 18, color: 'B91C1C', breakLine: true } },
    { text: kn, options: { fontFace: F.kn, fontSize: KN(knSize), color: 'B45309' } },
  ], { x: tag.x, y: tag.y + 0.1, w: tag.w, h: tag.h - 0.1, rotate: tag.tilt, align: 'center', valign: 'middle', margin: 0 });
}

/**
 * How it works — the checkpost staff's flow, from sign-in to handover.
 *
 * As the gate app does it (serverpe-pravesha-checkpoststaff-front-end):
 * a mobile number and a four-digit code (pages/SignIn.jsx); today's expected
 * vehicles saved on the phone; four digits of the plate matched instantly from
 * that list; a pass opened to one of three tones — go, stop, ask
 * (lib/verdict.js); the entry recorded; and End shift showing the handover
 * figures (pages/Gate.jsx). A sale at the barrier (components/SellSheet.jsx)
 * and working without signal (lib/offline.js) sit beneath.
 */
function staffFlow(pptx) {
  const s = pptx.addSlide({ masterName: 'CONTENT' });
  heading(s, 'How It Works — Checkpost Staff Flow', 'ಕಾರ್ಯವಿಧಾನ — ಚೆಕ್‌ಪೋಸ್ಟ್ ಸಿಬ್ಬಂದಿ ಪ್ರಕ್ರಿಯೆ');
  liveDemoTag(s, { x: 7.55, w: 3.3, en: 'You will see the gate app in the', kn: 'ಗೇಟ್ ಆ್ಯಪ್ ನೇರ ಪ್ರಾತ್ಯಕ್ಷಿಕೆಯಲ್ಲಿ', knSize: 8.5 });

  /* The seven steps of a shift, left to right. Short titles: the cards are
     narrow. The language comes first — the switch is at the top of the sign-in
     screen, before anything is typed, and stays on the gate screen. */
  const steps = [
    /* Seven cards leave each about an inch and a half: two lines of English and
       one short line of Kannada is what fits without crowding. */
    ['Pick language', 'ಭಾಷೆ ಆಯ್ಕೆ', 'English or Kannada, any time', 'ಇಂಗ್ಲಿಷ್ / ಕನ್ನಡ'],
    ['Sign in (OTP)', 'OTP ಲಾಗಿನ್', 'Mobile number + 4-digit code', 'ಮೊಬೈಲ್ + ಕೋಡ್'],
    ['Start shift', 'ಪಾಳಿ ಆರಂಭ', 'Today\'s vehicles on the phone', 'ಪಟ್ಟಿ ಫೋನ್‌ನಲ್ಲಿ'],
    ['Type 4 digits', '4 ಅಂಕೆ ನಮೂದಿಸಿ', 'Instant matches, even offline', 'ತಕ್ಷಣ ಹೊಂದಿಕೆ'],
    ['Open the pass', 'ಪಾಸ್ ತೆರೆಯಿರಿ', 'Verdict: go, stop or ask', 'ಸ್ಪಷ್ಟ ಫಲಿತಾಂಶ'],
    ['Approve, record', 'ಅನುಮೋದನೆ, ದಾಖಲು', 'Entry saved · visitor notified on WhatsApp', 'ವಾಟ್ಸಾಪ್ ದೃಢೀಕರಣ'],
    ['Hand over shift', 'ಪಾಳಿ ಹಸ್ತಾಂತರ', 'Entries, sales & cash totals', 'ಮಾರಾಟ, ನಗದು ಮೊತ್ತ'],
  ];
  const top = 1.95;
  const gap = 0.22;
  const cardW = (W - GUTTER * 2 - gap * (steps.length - 1)) / steps.length;
  const cardH = 2.15;
  steps.forEach(([en, kn, d, dk], i) => {
    const x = GUTTER + i * (cardW + gap);
    const color = i === steps.length - 1 ? C.sun : C.brand;
    s.addShape('roundRect', { x, y: top, w: cardW, h: cardH, fill: { color: C.white }, line: { color: C.line }, rectRadius: 0.08 });
    s.addShape('rect', { x, y: top, w: cardW, h: 0.08, fill: { color }, line: { color } });
    s.addShape('ellipse', { x: x + 0.14, y: top + 0.2, w: 0.38, h: 0.38, fill: { color }, line: { color } });
    s.addText(String(i + 1), { x: x + 0.14, y: top + 0.2, w: 0.38, h: 0.38, fontFace: F.enBold, fontSize: 12, color: C.white, align: 'center', valign: 'middle', margin: 0 });
    s.addText([
      { text: en, options: { fontFace: F.enBold, fontSize: 11, color: C.ink, breakLine: true } },
      { text: kn, options: { fontFace: F.kn, fontSize: KN(8), color: C.brand2 } },
    ], { x: x + 0.14, y: top + 0.66, w: cardW - 0.18, h: 0.62, valign: 'top', margin: 0 });
    s.addShape('line', { x: x + 0.14, y: top + 1.32, w: cardW - 0.28, h: 0, line: { color: C.line, width: 1 } });
    s.addText([
      { text: d, options: { fontFace: F.en, fontSize: 10, color: C.ink, breakLine: true } },
      { text: dk, options: { fontFace: F.kn, fontSize: KN(7.5), color: C.muted } },
    ], { x: x + 0.14, y: top + 1.38, w: cardW - 0.2, h: cardH - 1.44, valign: 'top', margin: 0 });
    if (i < steps.length - 1) {
      s.addShape('rightArrow', { x: x + cardW + 0.05, y: top + cardH / 2 - 0.1, w: gap - 0.1, h: 0.2, fill: { color: C.accent }, line: { color: C.accent } });
    }
  });

  /* Beneath: the verdict, a sale at the barrier, and a gate with no signal. */
  const panelTop = top + cardH + 0.24;
  const panelH = H - FOOTER_H - 0.16 - panelTop;
  const pGap = 0.17;
  const verdictW = 5.0;
  const sideW = (W - GUTTER * 2 - verdictW - pGap * 2) / 2;
  const headH = 0.6;

  const panel = (x, w, en, kn, color) => {
    s.addShape('roundRect', { x, y: panelTop, w, h: panelH, fill: { color: C.white }, line: { color: C.line }, rectRadius: 0.08 });
    s.addShape('rect', { x, y: panelTop, w: 0.08, h: panelH, fill: { color }, line: { color } });
    s.addText([
      { text: en, options: { fontFace: F.enBold, fontSize: 13, color: C.ink, breakLine: true } },
      { text: kn, options: { fontFace: F.kn, fontSize: KN(8.5), color: C.brand2 } },
    ], { x: x + 0.24, y: panelTop + 0.06, w: w - 0.34, h: headH, valign: 'middle', margin: 0 });
  };

  /* The three tones, as the gate app shows them. */
  const vx = GUTTER;
  panel(vx, verdictW, 'Every check ends in one of three colours', 'ಪ್ರತಿ ಪರಿಶೀಲನೆಗೆ ಮೂರು ಬಣ್ಣಗಳಲ್ಲಿ ಒಂದು', C.brand);
  const tones = [
    ['✓  GO', '16A34A', 'Valid pass — record the entry', 'ಮಾನ್ಯ ಪಾಸ್ — ಪ್ರವೇಶ ದಾಖಲಿಸಿ'],
    ['✕  STOP', 'DC2626', 'Used · wrong day · unpaid · cancelled · blocked', 'ಬಳಕೆಯಾದ · ತಪ್ಪು ದಿನ · ಪಾವತಿ ಇಲ್ಲ · ರದ್ದು · ನಿರ್ಬಂಧ'],
    ['!  ASK', 'D97706', 'Outside slot · self check-in — staff decide', 'ಸ್ಲಾಟ್ ಹೊರಗೆ · ಸ್ವಯಂ ಚೆಕ್-ಇನ್ — ಸಿಬ್ಬಂದಿ ನಿರ್ಧಾರ'],
  ];
  const tTop = panelTop + headH + 0.14;
  const tPitch = (panelH - headH - 0.24) / tones.length;
  tones.forEach(([label, color, en, kn], i) => {
    const y = tTop + i * tPitch;
    s.addShape('roundRect', { x: vx + 0.26, y: y + (tPitch - 0.36) / 2, w: 0.92, h: 0.36, fill: { color }, line: { color }, rectRadius: 0.18 });
    s.addText(label, { x: vx + 0.26, y: y + (tPitch - 0.36) / 2, w: 0.92, h: 0.36, fontFace: F.enBold, fontSize: 10.5, color: C.white, align: 'center', valign: 'middle', margin: 0 });
    s.addText([
      { text: en, options: { fontFace: F.en, fontSize: 10.5, color: C.ink, breakLine: true } },
      { text: kn, options: { fontFace: F.kn, fontSize: KN(7.5), color: C.muted } },
    ], { x: vx + 1.3, y, w: verdictW - 1.42, h: tPitch, valign: 'middle', margin: 0 });
  });

  const bullets = (x, w, color, items) => {
    const bTop = panelTop + headH + 0.12;
    const pitch = (panelH - headH - 0.2) / items.length;
    items.forEach(([en, kn], i) => {
      const y = bTop + i * pitch;
      s.addShape('ellipse', { x: x + 0.26, y: y + pitch / 2 - 0.1, w: 0.1, h: 0.1, fill: { color }, line: { color } });
      s.addText([
        { text: en, options: { fontFace: F.en, fontSize: 10.5, color: C.ink, breakLine: true } },
        { text: kn, options: { fontFace: F.kn, fontSize: KN(7.5), color: C.muted } },
      ], { x: x + 0.46, y, w: w - 0.56, h: pitch, valign: 'middle', margin: 0 });
    });
  };

  const sx = vx + verdictW + pGap;
  panel(sx, sideW, 'No pass? Sell at the barrier', 'ಪಾಸ್ ಇಲ್ಲವೇ? ಗೇಟ್‌ನಲ್ಲೇ ಮಾರಾಟ', C.accent);
  bullets(sx, sideW, C.accent, [
    ['Vehicle decides type and price', 'ವಾಹನದಿಂದಲೇ ಪ್ರಕಾರ, ದರ'],
    ['No record? Staff choose the type', 'ದಾಖಲೆ ಇಲ್ಲವೇ? ಸಿಬ್ಬಂದಿ ಆಯ್ಕೆ'],
    ['Cash, UPI or card', 'ನಗದು, UPI ಅಥವಾ ಕಾರ್ಡ್'],
    ['Photo of the UPI screen as proof', 'UPI ಪರದೆಯ ಫೋಟೋ ಸಾಕ್ಷಿ'],
  ]);

  const ox = sx + sideW + pGap;
  panel(ox, sideW, 'No signal? Keep working', 'ನೆಟ್‌ವರ್ಕ್ ಇಲ್ಲವೇ? ಕೆಲಸ ಮುಂದುವರಿಕೆ', 'D97706');
  bullets(ox, sideW, 'D97706', [
    ['Checks run from the saved list', 'ಉಳಿಸಿದ ಪಟ್ಟಿಯಿಂದ ಪರಿಶೀಲನೆ'],
    ['Entries queued, sent when back', 'ಪ್ರವೇಶಗಳು ಸಾಲಿನಲ್ಲಿ, ನಂತರ ಕಳುಹಿಕೆ'],
    ['Each entry recorded only once', 'ಪ್ರತಿ ಪ್ರವೇಶ ಒಂದೇ ಬಾರಿ ದಾಖಲು'],
    ['Conflicts shown to staff & office', 'ಸಮಸ್ಯೆಗಳು ಸಿಬ್ಬಂದಿ, ಕಚೇರಿಗೆ'],
  ]);
}

/**
 * How it works, 2 of 3 — the architecture.
 *
 * Who uses it (visitor on WhatsApp, staff on the gate app, the department on
 * the admin panel), the one server and its parts (src/app.js: the WhatsApp
 * webhook, the booking and payment pages, the staff and admin APIs, the jobs
 * started at listen — reconcile and periodReports), the database, and the
 * services it talks to: Meta's WhatsApp Cloud API, Razorpay, ULIP (direct from
 * a whitelisted server or through the gateway), Fast2SMS for staff OTP.
 * Security along the bottom is each a thing the code does.
 */
function architecture(pptx) {
  const s = pptx.addSlide({ masterName: 'CONTENT' });
  heading(s, 'How It Works — Architecture', 'ಕಾರ್ಯವಿಧಾನ — ವ್ಯವಸ್ಥೆಯ ವಿನ್ಯಾಸ');

  /* A little lower than other slides: the column captions sit above the body
     and must clear the heading's accent bar. */
  const top = 2.05;
  const bodyH = 3.88;
  const sideW = 2.95;
  const centreX = GUTTER + sideW + 0.8;
  const rightX = W - GUTTER - sideW;
  const centreW = rightX - 0.8 - centreX;

  /* Column captions. */
  const caption = (x, w, en, kn, align) => s.addText([
    { text: en, options: { fontFace: F.enBold, fontSize: 11, color: C.muted } },
    { text: `  ·  ${kn}`, options: { fontFace: F.kn, fontSize: KN(8.5), color: C.muted } },
  ], { x, y: top - 0.36, w, h: 0.3, align, valign: 'middle', margin: 0 });
  caption(GUTTER, sideW, 'WHO USES IT', 'ಬಳಕೆದಾರರು', 'left');
  caption(centreX, centreW, 'PRAVESHA PLATFORM', 'ಪ್ರವೇಶ ವೇದಿಕೆ', 'center');
  caption(rightX - 0.9, sideW + 0.9, 'CONNECTED SERVICES', 'ಸಂಪರ್ಕಿತ ಸೇವೆಗಳು', 'right');

  const twoWay = (x1, x2, y) => s.addShape('line', {
    x: x1, y, w: x2 - x1, h: 0,
    line: { color: C.accent, width: 1.75, beginArrowType: 'triangle', endArrowType: 'triangle' },
  });

  /* Left: the three kinds of user. */
  const users = [
    ['Visitors', 'ಪ್ರವಾಸಿಗರು', 'WhatsApp on their own phone', 'Booking page & secure payment', C.accent],
    ['Checkpost Staff', 'ಚೆಕ್‌ಪೋಸ್ಟ್ ಸಿಬ್ಬಂದಿ', 'Gate app on a smartphone', 'OTP sign-in · works offline', C.sun],
    ['Department', 'ಇಲಾಖೆ', 'Admin panel in a browser', 'Live view · reports · settings', C.brand],
  ];
  const userGap = 0.3;
  const userH = (bodyH - userGap * 2) / 3;
  users.forEach(([en, kn, l1, l2, color], i) => {
    const y = top + i * (userH + userGap);
    s.addShape('roundRect', { x: GUTTER, y, w: sideW, h: userH, fill: { color: C.white }, line: { color: C.line }, rectRadius: 0.08 });
    s.addShape('rect', { x: GUTTER, y, w: 0.08, h: userH, fill: { color }, line: { color } });
    s.addText([
      /* Kannada on its own line: "Checkpost Staff · ಚೆಕ್‌ಪೋಸ್ಟ್ ಸಿಬ್ಬಂದಿ" wraps otherwise. */
      { text: en, options: { fontFace: F.enBold, fontSize: 13.5, color: C.ink, breakLine: true } },
      { text: kn, options: { fontFace: F.kn, fontSize: KN(9), color: C.brand2, breakLine: true } },
      { text: l1, options: { fontFace: F.en, fontSize: 10.5, color: C.ink, breakLine: true } },
      { text: l2, options: { fontFace: F.en, fontSize: 10, color: C.muted } },
    ], { x: GUTTER + 0.22, y, w: sideW - 0.3, h: userH, valign: 'middle', margin: 0 });
    twoWay(GUTTER + sideW + 0.06, centreX - 0.06, y + userH / 2);
  });
  s.addText('Messages travel through Meta\'s WhatsApp Cloud API', { x: GUTTER, y: top + bodyH + 0.02, w: sideW + 0.6, h: 0.26, fontFace: F.en, fontSize: 9, italic: true, color: C.muted, margin: 0 });

  /* Centre: the server, its parts, and the database beneath. */
  s.addShape('roundRect', { x: centreX, y: top, w: centreW, h: bodyH, fill: { color: C.mist }, line: { color: C.brand2, width: 1.5 }, rectRadius: 0.1 });
  s.addShape('roundRect', { x: centreX, y: top, w: centreW, h: 0.62, fill: { color: C.brand }, line: { color: C.brand }, rectRadius: 0.1 });
  s.addShape('rect', { x: centreX, y: top + 0.4, w: centreW, h: 0.22, fill: { color: C.brand }, line: { color: C.brand } });
  s.addText([
    { text: 'Pravesha Server', options: { fontFace: F.enBold, fontSize: 15, color: C.white } },
    { text: '  ·  ಪ್ರವೇಶ ಸರ್ವರ್', options: { fontFace: F.kn, fontSize: KN(10), color: 'CFE5DC' } },
    { text: '     Node.js · Express', options: { fontFace: F.en, fontSize: 10, color: 'CFE5DC' } },
  ], { x: centreX + 0.2, y: top, w: centreW - 0.4, h: 0.62, align: 'center', valign: 'middle', margin: 0 });

  const modules = [
    ['WhatsApp bot', 'replies, pass delivery, entry confirmations'],
    ['Booking & payment pages', 'vehicle check, slots, checkout'],
    ['Staff API', 'today\'s passes, gate entries, on-spot sales'],
    ['Admin API', 'dashboards, capacity, watchlist, reports'],
    ['Background jobs', 'payment reconciler · 8 PM WhatsApp report'],
  ];
  const modTop = top + 0.74;
  const dbH = 0.78;
  const modH = (bodyH - 0.74 - dbH - 0.24 - 0.06 * (modules.length - 1)) / modules.length;
  modules.forEach(([name, what], i) => {
    const y = modTop + i * (modH + 0.06);
    s.addShape('roundRect', { x: centreX + 0.2, y, w: centreW - 0.4, h: modH, fill: { color: C.white }, line: { color: C.mist2 }, rectRadius: 0.05 });
    s.addText([
      { text: name, options: { fontFace: F.enBold, fontSize: 11, color: C.ink } },
      { text: `   ${what}`, options: { fontFace: F.en, fontSize: 9.5, color: C.muted } },
    ], { x: centreX + 0.34, y, w: centreW - 0.6, h: modH, valign: 'middle', margin: 0 });
  });
  const dbY = top + bodyH - dbH - 0.14;
  s.addShape('can', { x: centreX + 0.2, y: dbY, w: centreW - 0.4, h: dbH, fill: { color: C.brand2 }, line: { color: C.brand2 } });
  s.addText([
    { text: 'PostgreSQL database', options: { fontFace: F.enBold, fontSize: 12, color: C.white } },
    { text: '  ·  ಡೇಟಾಬೇಸ್', options: { fontFace: F.kn, fontSize: KN(9), color: 'CFE5DC', breakLine: true } },
    { text: 'bookings · payments · gate entries · audit trail', options: { fontFace: F.en, fontSize: 9.5, color: 'E7F2EE' } },
  ], { x: centreX + 0.3, y: dbY + 0.12, w: centreW - 0.6, h: dbH - 0.12, align: 'center', valign: 'middle', margin: 0 });

  /* Right: the services it connects to. */
  const services = [
    ['WhatsApp Cloud API', 'Meta', 'Messages in and out'],
    ['Razorpay', 'Payment gateway', 'UPI, cards, net banking'],
    ['ULIP', 'Govt. logistics platform', 'Vehicle registration (RC)'],
    ['Fast2SMS', 'DLT-registered SMS', 'OTP for staff sign-in'],
  ];
  const svcGap = 0.2;
  const svcH = (bodyH - svcGap * 3) / 4;
  services.forEach(([name, by, what], i) => {
    const y = top + i * (svcH + svcGap);
    s.addShape('roundRect', { x: rightX, y, w: sideW, h: svcH, fill: { color: C.white }, line: { color: C.line }, rectRadius: 0.08 });
    s.addShape('rect', { x: rightX + sideW - 0.08, y, w: 0.08, h: svcH, fill: { color: C.brand2 }, line: { color: C.brand2 } });
    s.addText([
      { text: name, options: { fontFace: F.enBold, fontSize: 12.5, color: C.ink } },
      { text: `  ·  ${by}`, options: { fontFace: F.en, fontSize: 9.5, color: C.muted, breakLine: true } },
      { text: what, options: { fontFace: F.en, fontSize: 10.5, color: C.ink } },
    ], { x: rightX + 0.18, y, w: sideW - 0.34, h: svcH, valign: 'middle', margin: 0 });
    twoWay(centreX + centreW + 0.06, rightX - 0.06, y + svcH / 2);
  });

  /* Security, as the code does it. */
  const stripY = top + bodyH + 0.34;
  const stripH = H - FOOTER_H - 0.14 - stripY;
  s.addShape('roundRect', { x: GUTTER, y: stripY, w: W - GUTTER * 2, h: stripH, fill: { color: C.deep }, line: { color: C.deep }, rectRadius: 0.08 });
  s.addText([
    { text: 'Security built in', options: { fontFace: F.enBold, fontSize: 12, color: C.white, breakLine: true } },
    { text: 'ಅಂತರ್ಗತ ಭದ್ರತೆ', options: { fontFace: F.kn, fontSize: KN(8.5), color: 'CFE5DC' } },
  ], { x: GUTTER + 0.22, y: stripY, w: 1.7, h: stripH, valign: 'middle', margin: 0 });
  const guards = ['Signed WhatsApp webhook', 'Single-use booking links', 'Payment confirmed 3 ways', 'Owner name & address not stored', 'OTP sign-in, shift sessions'];
  const gx = GUTTER + 2.0;
  const gGap = 0.12;
  const gW = (W - GUTTER - 0.16 - gx - gGap * (guards.length - 1)) / guards.length;
  guards.forEach((g, i) => {
    const x = gx + i * (gW + gGap);
    s.addShape('roundRect', { x, y: stripY + 0.12, w: gW, h: stripH - 0.24, fill: { color: C.brand }, line: { color: C.brand2 }, rectRadius: 0.12 });
    s.addText(`✓  ${g}`, { x: x + 0.06, y: stripY + 0.12, w: gW - 0.12, h: stripH - 0.24, fontFace: F.enBold, fontSize: 10, color: C.white, align: 'center', valign: 'middle', margin: 0 });
  });
}

/**
 * How it works, 3 of 3 — the two flows that decide whether money and entries
 * are ever lost: payment confirmation (gatepass/checkout.js, jobs/reconcile.js)
 * and the gate, with and without signal (checkpost app src/lib/offline.js,
 * routes/staffApi.js). The QR on the PDF opens routes/verify.js, which reads
 * the database at the moment of scanning.
 */
function flows(pptx) {
  const s = pptx.addSlide({ masterName: 'CONTENT' });
  heading(s, 'How It Works — Payment & Gate Flow', 'ಕಾರ್ಯವಿಧಾನ — ಪಾವತಿ ಮತ್ತು ಗೇಟ್ ಪ್ರಕ್ರಿಯೆ');

  const top = 1.95;
  const gap = 0.35;
  const panelW = (W - GUTTER * 2 - gap) / 2;
  const panelH = 4.1;

  const panel = (x, en, kn, color) => {
    s.addShape('roundRect', { x, y: top, w: panelW, h: panelH, fill: { color: C.white }, line: { color: C.line }, rectRadius: 0.08 });
    s.addShape('rect', { x, y: top, w: panelW, h: 0.09, fill: { color }, line: { color } });
    s.addText([
      { text: en, options: { fontFace: F.enBold, fontSize: 16, color: C.ink, breakLine: true } },
      { text: kn, options: { fontFace: F.kn, fontSize: KN(10), color: C.brand2 } },
    ], { x: x + 0.25, y: top + 0.14, w: panelW - 0.5, h: 0.7, valign: 'middle', margin: 0 });
  };
  const badge = (x, y, n, color) => {
    s.addShape('ellipse', { x, y, w: 0.36, h: 0.36, fill: { color }, line: { color } });
    s.addText(String(n), { x, y, w: 0.36, h: 0.36, fontFace: F.enBold, fontSize: 12, color: C.white, align: 'center', valign: 'middle', margin: 0 });
  };

  /* Left: payment. */
  const lx = GUTTER;
  panel(lx, 'Payment — confirmed three ways', 'ಪಾವತಿ — ಮೂರು ರೀತಿಯಲ್ಲಿ ದೃಢೀಕರಣ', C.brand);
  const paths = [
    ['The browser returns from payment', 'ಪಾವತಿಯ ನಂತರ ಬ್ರೌಸರ್ ಹಿಂತಿರುಗುವಿಕೆ', 'Instant', 'ತಕ್ಷಣ'],
    ['Razorpay notifies our server', 'Razorpay ನಿಂದ ಸರ್ವರ್‌ಗೆ ಸೂಚನೆ', 'In seconds', 'ಕ್ಷಣಗಳಲ್ಲಿ'],
    ['Our reconciler asks Razorpay', 'ಸರ್ವರ್ ನೇರವಾಗಿ Razorpay ಪರಿಶೀಲನೆ', 'Every 45 s', 'ಪ್ರತಿ 45 ಸೆ.'],
  ];
  const pTop = top + 0.95;
  const pH = 0.52;
  paths.forEach(([en, kn, when, whenKn], i) => {
    const y = pTop + i * (pH + 0.08);
    s.addShape('roundRect', { x: lx + 0.25, y, w: panelW - 0.5, h: pH, fill: { color: C.mist }, line: { color: C.mist2 }, rectRadius: 0.06 });
    badge(lx + 0.38, y + (pH - 0.36) / 2, i + 1, C.brand2);
    s.addText([
      { text: en, options: { fontFace: F.enBold, fontSize: 11.5, color: C.ink, breakLine: true } },
      { text: kn, options: { fontFace: F.kn, fontSize: KN(8.5), color: C.muted } },
    ], { x: lx + 0.88, y, w: panelW - 2.95, h: pH, valign: 'middle', margin: 0 });
    /* Timing on two lines, English over Kannada: side by side they overflow. */
    s.addShape('roundRect', { x: lx + panelW - 1.95, y: y + 0.06, w: 1.6, h: pH - 0.12, fill: { color: C.white }, line: { color: C.accent }, rectRadius: 0.12 });
    s.addText([
      { text: when, options: { fontFace: F.enBold, fontSize: 10, color: C.brand, breakLine: true } },
      { text: whenKn, options: { fontFace: F.kn, fontSize: KN(7), color: C.muted } },
    ], { x: lx + panelW - 1.95, y: y + 0.06, w: 1.6, h: pH - 0.12, align: 'center', valign: 'middle', margin: 0 });
  });
  const resultY = pTop + 3 * (pH + 0.08) + 0.02;
  s.addShape('downArrow', { x: lx + panelW / 2 - 0.14, y: resultY - 0.02, w: 0.28, h: 0.22, fill: { color: C.accent }, line: { color: C.accent } });
  s.addShape('roundRect', { x: lx + 0.25, y: resultY + 0.24, w: panelW - 0.5, h: 0.56, fill: { color: C.brand }, line: { color: C.brand }, rectRadius: 0.06 });
  s.addText([
    { text: 'Whichever arrives first issues the pass — exactly once', options: { fontFace: F.enBold, fontSize: 12, color: C.white, breakLine: true } },
    { text: 'ಮೊದಲು ಬಂದ ದೃಢೀಕರಣದಿಂದ ಪಾಸ್ — ಒಂದೇ ಬಾರಿ', options: { fontFace: F.kn, fontSize: KN(8.5), color: 'CFE5DC' } },
  ], { x: lx + 0.4, y: resultY + 0.24, w: panelW - 0.8, h: 0.56, align: 'center', valign: 'middle', margin: 0 });
  s.addText([
    { text: 'The place is held while paying and released automatically if unpaid', options: { fontFace: F.en, fontSize: 10, italic: true, color: C.muted, breakLine: true } },
    { text: 'ಪಾವತಿ ವೇಳೆ ಸ್ಥಾನ ಕಾಯ್ದಿರಿಕೆ; ಪಾವತಿಯಾಗದಿದ್ದರೆ ಸ್ವಯಂ ಬಿಡುಗಡೆ', options: { fontFace: F.kn, fontSize: KN(8), color: C.muted } },
  ], { x: lx + 0.25, y: top + panelH - 0.46, w: panelW - 0.5, h: 0.42, align: 'center', valign: 'middle', margin: 0 });

  /* Right: the gate. */
  const rx = GUTTER + panelW + gap;
  panel(rx, 'Gate — with or without signal', 'ಗೇಟ್ — ನೆಟ್‌ವರ್ಕ್ ಇದ್ದರೂ ಇಲ್ಲದಿದ್ದರೂ', C.sun);
  const gate = [
    ['Today\'s passes are saved on the phone', 'ಇಂದಿನ ಪಾಸ್‌ಗಳು ಫೋನ್‌ನಲ್ಲಿ ಉಳಿತಾಯ'],
    ['Type 4 digits → pick the vehicle → approve', '4 ಅಂಕೆ → ವಾಹನ ಆಯ್ಕೆ → ಅನುಮೋದನೆ'],
    ['Verdict: valid · already used · wrong day · unpaid · cancelled', 'ಮಾನ್ಯ · ಬಳಕೆಯಾಗಿದೆ · ತಪ್ಪು ದಿನ · ಪಾವತಿ ಇಲ್ಲ · ರದ್ದು'],
    ['No signal? Entry queued and sent when back — recorded once', 'ನೆಟ್‌ವರ್ಕ್ ಬಂದಾಗ ಕಳುಹಿಕೆ — ಒಂದೇ ಬಾರಿ ದಾಖಲು'],
    ['Any conflict is flagged to the staff and the office', 'ಯಾವುದೇ ಸಮಸ್ಯೆ ಸಿಬ್ಬಂದಿ, ಕಚೇರಿಗೆ ತಿಳಿಸಲಾಗುತ್ತದೆ'],
  ];
  const gTop = top + 0.95;
  const gPitch = 0.5;
  gate.forEach(([en, kn], i) => {
    const y = gTop + i * gPitch;
    badge(rx + 0.3, y + (gPitch - 0.36) / 2, i + 1, i === 3 ? 'D97706' : C.brand2);
    if (i < gate.length - 1) s.addShape('line', { x: rx + 0.48, y: y + gPitch / 2 + 0.18, w: 0, h: gPitch - 0.36, line: { color: C.line, width: 1.5 } });
    s.addText([
      { text: en, options: { fontFace: F.en, fontSize: 11.5, color: C.ink, breakLine: true } },
      { text: kn, options: { fontFace: F.kn, fontSize: KN(8.5), color: C.muted } },
    ], { x: rx + 0.8, y, w: panelW - 1.0, h: gPitch, valign: 'middle', margin: 0 });
  });
  s.addText([
    { text: 'On-spot sales wait for signal — the last place is never sold twice', options: { fontFace: F.en, fontSize: 10, italic: true, color: C.muted, breakLine: true } },
    { text: 'ಸ್ಥಳದಲ್ಲೇ ಮಾರಾಟಕ್ಕೆ ನೆಟ್‌ವರ್ಕ್ ಅಗತ್ಯ', options: { fontFace: F.kn, fontSize: KN(8), color: C.muted } },
  ], { x: rx + 0.25, y: top + panelH - 0.46, w: panelW - 0.5, h: 0.42, align: 'center', valign: 'middle', margin: 0 });

  /* The pass itself proves nothing; the record does. */
  const stripY = top + panelH + 0.16;
  const stripH = H - FOOTER_H - 0.14 - stripY;
  s.addShape('roundRect', { x: GUTTER, y: stripY, w: W - GUTTER * 2, h: stripH, fill: { color: C.deep }, line: { color: C.deep }, rectRadius: 0.08 });
  s.addText([
    { text: 'The QR on the PDF pass opens a live status page — the database decides, never the paper', options: { fontFace: F.enBold, fontSize: 12.5, color: C.white, breakLine: true } },
    { text: 'PDF ಪಾಸ್‌ನ QR ನೇರ ಸ್ಥಿತಿ ತೋರಿಸುತ್ತದೆ — ಕಾಗದವಲ್ಲ, ದಾಖಲೆಯೇ ಅಂತಿಮ', options: { fontFace: F.kn, fontSize: KN(9), color: 'CFE5DC' } },
  ], { x: GUTTER + 0.3, y: stripY, w: W - GUTTER * 2 - 0.6, h: stripH, align: 'center', valign: 'middle', margin: 0 });
}

/**
 * Future enhancements — the roadmap after launch.
 *
 * The four items and their priority are the user's, and none of them exists
 * yet: a pass is for its date and cannot be moved, one pass is one entry, there
 * are no concessions, and visitors cannot cancel for themselves. The only
 * supporting claim — that a frequent visitor can be recognised from their
 * visit history — rests on every pass already being recorded against its
 * vehicle and its customer.
 */
function roadmap(pptx, opts = {}) {
  /* opts (title, intro, cards, first) is how roadmapMore reuses this layout.
     Called from SLIDES, opts is the build context, which has none of those
     keys — so the first roadmap slide takes the defaults below. */
  const s = pptx.addSlide({ masterName: 'CONTENT' });
  const item = AGENDA.find((a) => a.en.startsWith('Future Enhancements'));
  heading(s, opts.title || item.en, opts.titleKn || item.kn);

  /* The promise the slide rests on. */
  const introY = 1.86;
  s.addText([
    { text: opts.intro || 'Once live, Pravesha runs on its own — development does not stop.', options: { fontFace: F.enBold, fontSize: 13, color: C.brand } },
    { text: `   ·   ${opts.introKn || 'ಆರಂಭದ ನಂತರವೂ ಅಭಿವೃದ್ಧಿ ನಿರಂತರ'}`, options: { fontFace: F.kn, fontSize: KN(10), color: C.muted } },
  ], { x: GUTTER, y: introY, w: W - GUTTER * 2, h: 0.4, valign: 'middle', margin: 0 });

  const PRIORITY = { label: 'PRIORITY', kn: 'ಆದ್ಯತೆ', color: 'DC2626' };
  const GOOD = { label: 'GOOD TO HAVE', kn: 'ಇದ್ದರೆ ಉತ್ತಮ', color: '16A34A' };
  const LATER = { label: 'LATER', kn: 'ನಂತರ', color: '64748B' };

  /* One line of English and one of Kannada per point, and one-line titles: in
     a card this narrow anything longer runs into the line below. */
  const cards = opts.cards || [
    { phase: PRIORITY, en: 'Pass Postpone', kn: 'ಪಾಸ್ ಮುಂದೂಡಿಕೆ',
      points: [
        ['New date within 2 weeks', '2 ವಾರಗಳೊಳಗೆ ಹೊಸ ದಿನಾಂಕ'],
        ['Free or small fee, as decided', 'ಉಚಿತ ಅಥವಾ ಸಣ್ಣ ಶುಲ್ಕ'],
        ['Also if the visit was missed', 'ಭೇಟಿ ತಪ್ಪಿದರೂ ಅವಕಾಶ'],
      ],
      gain: ['Visitor convenience', 'ಪ್ರವಾಸಿಗರ ಅನುಕೂಲ'] },
    { phase: GOOD, en: 'Multi-entry Passes', kn: 'ಬಹು-ಪ್ರವೇಶ ಪಾಸ್',
      points: [
        ['Paid re-entry, same day', 'ಶುಲ್ಕ ಸಹಿತ ಮರು-ಪ್ರವೇಶ'],
        ['Day pass — many entries', 'ದಿನದ ಪಾಸ್ — ಹಲವು ಪ್ರವೇಶ'],
        ['Weekly pass for regulars', 'ವಾರದ ಪಾಸ್'],
      ],
      gain: ['New revenue for the department', 'ಇಲಾಖೆಗೆ ಹೊಸ ಆದಾಯ'] },
    { phase: GOOD, en: 'Visitor Concessions', kn: 'ಪ್ರವಾಸಿಗರಿಗೆ ರಿಯಾಯಿತಿ',
      points: [
        ['For frequent visitors', 'ನಿಯಮಿತ ಪ್ರವಾಸಿಗರಿಗೆ'],
        ['Known from visit history', 'ಭೇಟಿ ದಾಖಲೆಯಿಂದ ಗುರುತು'],
        ['Rules set by the department', 'ನಿಯಮ ಇಲಾಖೆಯಿಂದ'],
      ],
      gain: ['Goodwill & repeat visits', 'ಸದ್ಭಾವನೆ, ಮರುಭೇಟಿ'] },
    { phase: LATER, en: 'Cancellation & Refunds', kn: 'ರದ್ದತಿ ಮತ್ತು ಮರುಪಾವತಿ',
      points: [
        ['Cancel before the visit', 'ಭೇಟಿಗೂ ಮುನ್ನ ರದ್ದತಿ'],
        ['Fee kept by days left', 'ಉಳಿದ ದಿನಗಳಂತೆ ಕಡಿತ'],
        ['Refund to original payment', 'ಮೂಲ ಪಾವತಿಗೆ ಮರುಪಾವತಿ'],
      ],
      gain: ['Fair to visitors, revenue protected', 'ನ್ಯಾಯಯುತ, ಆದಾಯ ರಕ್ಷಣೆ'] },
  ];

  const top = introY + 0.56;
  const gap = 0.25;
  const cardW = (W - GUTTER * 2 - gap * (cards.length - 1)) / cards.length;
  const cardH = H - FOOTER_H - 0.16 - top;
  const gainH = 0.62;

  cards.forEach((c, i) => {
    const x = GUTTER + i * (cardW + gap);
    s.addShape('roundRect', { x, y: top, w: cardW, h: cardH, fill: { color: C.white }, line: { color: C.line }, rectRadius: 0.08 });
    s.addShape('rect', { x, y: top, w: cardW, h: 0.08, fill: { color: c.phase.color }, line: { color: c.phase.color } });

    /* Priority, as a chip. */
    s.addShape('roundRect', { x: x + 0.2, y: top + 0.24, w: 2.1, h: 0.34, fill: { color: c.phase.color }, line: { color: c.phase.color }, rectRadius: 0.17 });
    s.addText([
      { text: c.phase.label, options: { fontFace: F.enBold, fontSize: 9.5, color: C.white } },
      { text: `  ${c.phase.kn}`, options: { fontFace: F.kn, fontSize: KN(7), color: C.white } },
    ], { x: x + 0.2, y: top + 0.24, w: 2.1, h: 0.34, align: 'center', valign: 'middle', margin: 0 });
    s.addText(String((opts.first || 1) + i), { x: x + cardW - 0.6, y: top + 0.16, w: 0.42, h: 0.5, fontFace: F.enBold, fontSize: 22, color: C.line, align: 'right', valign: 'middle', margin: 0 });

    s.addText([
      { text: c.en, options: { fontFace: F.enBold, fontSize: 15, color: C.ink, breakLine: true } },
      { text: c.kn, options: { fontFace: F.kn, fontSize: KN(10), color: C.brand2 } },
    ], { x: x + 0.2, y: top + 0.68, w: cardW - 0.3, h: 0.78, valign: 'top', margin: 0 });
    s.addShape('line', { x: x + 0.2, y: top + 1.5, w: cardW - 0.4, h: 0, line: { color: C.line, width: 1 } });

    const listTop = top + 1.58;
    const pitch = (cardH - gainH - 0.18 - (listTop - top)) / c.points.length;
    c.points.forEach(([en, kn], j) => {
      const y = listTop + j * pitch;
      s.addShape('ellipse', { x: x + 0.22, y: y + pitch / 2 - 0.13, w: 0.1, h: 0.1, fill: { color: c.phase.color }, line: { color: c.phase.color } });
      s.addText([
        { text: en, options: { fontFace: F.en, fontSize: 11.5, color: C.ink, breakLine: true } },
        { text: kn, options: { fontFace: F.kn, fontSize: KN(8.5), color: C.muted } },
      ], { x: x + 0.42, y, w: cardW - 0.55, h: pitch, valign: 'middle', margin: 0 });
    });

    /* Who gains. */
    const gy = top + cardH - gainH - 0.12;
    s.addShape('roundRect', { x: x + 0.14, y: gy, w: cardW - 0.28, h: gainH, fill: { color: C.mist }, line: { color: C.mist2 }, rectRadius: 0.06 });
    s.addText([
      { text: c.gain[0], options: { fontFace: F.enBold, fontSize: 11, color: C.brand, breakLine: true } },
      { text: c.gain[1], options: { fontFace: F.kn, fontSize: KN(8), color: C.brand2 } },
    ], { x: x + 0.24, y: gy, w: cardW - 0.48, h: gainH, align: 'center', valign: 'middle', margin: 0 });
  });
}

/**
 * Future enhancements, continued — ideas proposed to the user and chosen by
 * them (closure alerts, a waitlist, add-ons in the chat, peak-day pricing).
 * No priority was given, so each is marked PROPOSED, for the department to
 * decide. Numbered on from the first slide's four.
 *
 * Closure alerts build on what exists: slots can already be closed for a day
 * from the admin panel; the WhatsApp template to tell booked visitors has not
 * yet been created in Meta.
 */
function roadmapMore(pptx) {
  const PROPOSED = { label: 'PROPOSED', kn: 'ಪ್ರಸ್ತಾವಿತ', color: '2563EB' };
  roadmap(pptx, {
    title: 'Future Enhancements — More Ideas',
    titleKn: 'ಭವಿಷ್ಯದ ಸುಧಾರಣೆಗಳು — ಇನ್ನಷ್ಟು ಯೋಜನೆಗಳು',
    intro: 'Proposed for discussion — each needs the department\'s decision.',
    introKn: 'ಚರ್ಚೆಗೆ ಪ್ರಸ್ತಾವನೆ — ಇಲಾಖೆಯ ನಿರ್ಧಾರದ ಮೇಲೆ',
    first: 5,
    cards: [
      { phase: PROPOSED, en: 'Closure Alerts', kn: 'ಮುಚ್ಚುವಿಕೆ ಎಚ್ಚರಿಕೆ',
        points: [
          ['Slot closed for rain or landslide', 'ಮಳೆ, ಭೂಕುಸಿತಕ್ಕೆ ಸ್ಲಾಟ್ ಬಂದ್'],
          ['WhatsApp alert to bookers', 'ವಾಟ್ಸಾಪ್‌ನಲ್ಲಿ ಸೂಚನೆ'],
          ['Before they start the drive', 'ಪ್ರಯಾಣಕ್ಕೂ ಮುನ್ನ'],
        ],
        gain: ['Safety & trust', 'ಸುರಕ್ಷತೆ, ವಿಶ್ವಾಸ'] },
      { phase: PROPOSED, en: 'Slot Waitlist', kn: 'ಸ್ಲಾಟ್ ಕಾಯುವ ಪಟ್ಟಿ',
        points: [
          ['Join a waitlist when full', 'ಭರ್ತಿಯಾದಾಗ ಕಾಯುವ ಪಟ್ಟಿ'],
          ['Alert when a place frees up', 'ಸ್ಥಾನ ಖಾಲಿಯಾದಾಗ ಸೂಚನೆ'],
          ['No place goes unsold', 'ಯಾವ ಸ್ಥಾನವೂ ವ್ಯರ್ಥವಾಗದು'],
        ],
        gain: ['Visitors served, seats filled', 'ಪ್ರವಾಸಿಗರಿಗೆ ಅವಕಾಶ, ಪೂರ್ಣ ಬಳಕೆ'] },
      { phase: PROPOSED, en: 'Add-ons in the Chat', kn: 'ಹೆಚ್ಚುವರಿ ಸೇವೆಗಳು',
        points: [
          ['Parking, camera or guide fees', 'ಪಾರ್ಕಿಂಗ್, ಕ್ಯಾಮೆರಾ, ಗೈಡ್ ಶುಲ್ಕ'],
          ['Paid with the entry pass', 'ಪ್ರವೇಶ ಪಾಸ್ ಜೊತೆಗೇ ಪಾವತಿ'],
          ['Department\'s share passed on', 'ಇಲಾಖೆಯ ಪಾಲು ನೇರವಾಗಿ'],
        ],
        gain: ['Extra revenue', 'ಹೆಚ್ಚುವರಿ ಆದಾಯ'] },
      { phase: PROPOSED, en: 'Peak-day Pricing', kn: 'ದಟ್ಟಣೆ ದಿನಗಳ ದರ',
        points: [
          ['Weekend & holiday rates', 'ವಾರಾಂತ್ಯ, ರಜಾದಿನ ದರ'],
          ['Spreads the crowd', 'ದಟ್ಟಣೆ ಹಂಚಿಕೆ'],
          ['If the department approves', 'ಇಲಾಖೆ ಅನುಮೋದಿಸಿದರೆ ಮಾತ್ರ'],
        ],
        gain: ['Revenue & crowd control', 'ಆದಾಯ, ದಟ್ಟಣೆ ನಿಯಂತ್ರಣ'] },
    ],
  });
}

/* ─────────────────────────────── agenda 10: investment & operating costs ── */

/**
 * What Pravesha costs to build and to run — the user's figures (2026-09-15),
 * refined into four kinds of cost:
 *
 *   A build    one-time: engineering at ₹1.5–2 L a month for 4–6 months, and
 *              the laptop. It includes local testing, deployment and
 *              integration testing (WhatsApp, payments, ULIP).
 *   B fixed    yearly, whatever the bookings: server, domain, mail, SSL, and the
 *              AI tools, which are subscriptions that carry on into maintenance.
 *   C usage    yearly, growing with bookings: WhatsApp messaging, SMS OTP.
 *   D Razorpay transaction-based — 2.2% taken from each payment as it is made,
 *              so it is never added into the investment totals.
 *
 * From the second year the build drops out and the AMC comes in (E).
 *
 * Every subtotal, total and comparison on these slides is added up from the
 * rows below, so a figure changed here changes everywhere it is quoted.
 * Amounts are rupees; the slides show them in lakhs.
 */
const COST = {
  build: [
    /* One figure, not a range (user, 2026-09-15): the estimated project
       development value — 6 months of professional engineering at ₹1.5 L a
       month. Presented as engineering already invested, not as a salary; a
       development price, if the department contracts one, is agreed apart. */
    { en: 'Software development & engineering', kn: 'ಸಾಫ್ಟ್‌ವೇರ್ ಅಭಿವೃದ್ಧಿ ಮತ್ತು ಎಂಜಿನಿಯರಿಂಗ್', note: 'Estimated project development value · 6 months × ₹1.5 L', min: 900000, max: 900000 },
    { en: 'Development laptop & hardware', kn: 'ಲ್ಯಾಪ್‌ಟಾಪ್ ಮತ್ತು ಹಾರ್ಡ್‌ವೇರ್', note: 'Initial purchase', min: 30000, max: 60000 },
  ],
  fixed: [
    { en: 'VPS / cloud server', kn: 'VPS ಸರ್ವರ್', min: 18000, max: 26000 },
    { en: 'Domain', kn: 'ಡೊಮೇನ್', min: 2000, max: 5000 },
    { en: 'Mail server', kn: 'ಇಮೇಲ್ ಸರ್ವರ್', min: 4000, max: 6000 },
    { en: 'SSL certificate & renewals', kn: 'SSL ಪ್ರಮಾಣಪತ್ರ', min: 9000, max: 12000 },
    { en: 'AI dev tools — Copilot, Claude', kn: 'AI ಉಪಕರಣಗಳು', min: 30000, max: 35000 },
  ],
  usage: [
    { en: 'WhatsApp / Meta messaging', kn: 'ವಾಟ್ಸಾಪ್ ಸಂದೇಶ ಶುಲ್ಕ', min: 150000, max: 175000 },
    { en: 'SMS OTP', kn: 'SMS OTP ಶುಲ್ಕ', min: 2000, max: 3000 },
  ],
  razorpay: { min: 300000, max: 600000 },
  /* The AMC is no longer one figure here: each proposal carries its own —
     see PLANS beside the commercial slide. */
};

const L2 = (n) => (n / 100000).toFixed(2);
const lakh = (n) => `₹${L2(n)} L`;
/* A range whose ends meet is one amount: ₹9.00 L, not ₹9.00 – 9.00 L. */
const lakhRange = (r) => (r.min === r.max ? lakh(r.min) : `₹${L2(r.min)} – ${L2(r.max)} L`);
/** Indian grouping, for amounts quoted in full: ₹2,50,000. */
const inrFull = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const total = (rows) => ({ min: rows.reduce((t, r) => t + r.min, 0), max: rows.reduce((t, r) => t + r.max, 0) });
const plus = (...parts) => ({ min: parts.reduce((t, p) => t + p.min, 0), max: parts.reduce((t, p) => t + p.max, 0) });

function costTotals() {
  const build = total(COST.build);
  const fixed = total(COST.fixed);
  const usage = total(COST.usage);
  const year1 = plus(build, fixed, usage);
  /* From Year 2 this is all ServerPe still spends. The AMC is money coming in,
     not a cost, and Razorpay comes out of the service fee — neither belongs in
     a total of what it costs to run the platform. */
  const year2 = plus(fixed, usage);
  return { build, fixed, usage, year1, year2 };
}

/** A lettered cost panel: header, rows, and a subtotal line if given. */
function costPanel(s, { x, y, w, h, letter, en, kn, period, color }) {
  s.addShape('roundRect', { x, y, w, h, fill: { color: C.white }, line: { color: C.line }, rectRadius: 0.08 });
  s.addShape('roundRect', { x, y, w, h: 0.5, fill: { color }, line: { color }, rectRadius: 0.08 });
  s.addShape('rect', { x, y: y + 0.3, w, h: 0.2, fill: { color }, line: { color } });
  s.addShape('ellipse', { x: x + 0.14, y: y + 0.08, w: 0.34, h: 0.34, fill: { color: C.white }, line: { color: C.white } });
  s.addText(letter, { x: x + 0.14, y: y + 0.08, w: 0.34, h: 0.34, fontFace: F.enBold, fontSize: 12, color, align: 'center', valign: 'middle', margin: 0 });
  s.addText([
    { text: en, options: { fontFace: F.enBold, fontSize: 12.5, color: C.white } },
    { text: `   ${kn}`, options: { fontFace: F.kn, fontSize: KN(8.5), color: 'E7F2EE' } },
  ], { x: x + 0.6, y, w: w - 1.9, h: 0.5, valign: 'middle', margin: 0 });
  s.addText(period, { x: x + w - 1.35, y, w: 1.2, h: 0.5, fontFace: F.en, fontSize: 9.5, color: 'E7F2EE', align: 'right', valign: 'middle', margin: 0 });
}

function costRow(s, { x, y, w, h, en, kn, note, value, valueColor = C.ink, strike = false }) {
  const runs = [
    { text: en, options: { fontFace: F.enBold, fontSize: 11, color: strike ? C.muted : C.ink, strike: strike ? 'sngStrike' : undefined } },
    { text: `   ${kn}`, options: { fontFace: F.kn, fontSize: KN(8), color: C.muted, breakLine: Boolean(note) } },
  ];
  if (note) runs.push({ text: note, options: { fontFace: F.en, fontSize: 9, color: C.muted } });
  s.addText(runs, { x: x + 0.22, y, w: w - 2.3, h, valign: 'middle', margin: 0 });
  s.addText(value, { x: x + w - 2.05, y, w: 1.85, h, fontFace: F.enBold, fontSize: 11.5, color: valueColor, align: 'right', valign: 'middle', margin: 0 });
}

function costSubtotal(s, { x, y, w, en, kn, value, color }) {
  s.addShape('rect', { x: x + 0.12, y, w: w - 0.24, h: 0.34, fill: { color: C.mist }, line: { color: C.mist2 } });
  s.addText([
    { text: en, options: { fontFace: F.enBold, fontSize: 11, color } },
    { text: `   ${kn}`, options: { fontFace: F.kn, fontSize: KN(8), color: C.muted } },
  ], { x: x + 0.22, y, w: w - 2.3, h: 0.34, valign: 'middle', margin: 0 });
  s.addText(value, { x: x + w - 2.05, y, w: 1.85, h: 0.34, fontFace: F.enBold, fontSize: 12.5, color, align: 'right', valign: 'middle', margin: 0 });
}

/** Investment & operating costs, 1 of 3 — the structure, A to D. */
function costStructure(pptx, ctx) {
  const s = pptx.addSlide({ masterName: 'CONTENT' });
  const item = COMMERCIAL_AGENDA.find((a) => a.en.startsWith('Investment'));
  heading(s, item.en, item.kn);
  const T = costTotals();

  /* The engineering scope behind row A, and — said plainly, because a table of
     lakhs invites the opposite reading — whose money this is. */
  s.addShape('roundRect', { x: GUTTER, y: 1.74, w: W - GUTTER * 2, h: 0.7, fill: { color: C.mist }, line: { color: C.mist2 }, rectRadius: 0.06 });
  s.addText([
    { text: 'Engineering scope', options: { fontFace: F.enBold, fontSize: 10.5, color: C.brand } },
    { text: '  ಎಂಜಿನಿಯರಿಂಗ್ ವ್ಯಾಪ್ತಿ   ', options: { fontFace: F.kn, fontSize: KN(8), color: C.brand2 } },
    { text: 'Architecture → Frontend → Backend → Database → WhatsApp → Payments → Ticketing → Admin → Live monitoring → Reports → GST invoices → Testing → Deployment', options: { fontFace: F.en, fontSize: 9.5, color: C.ink, breakLine: true } },
    /* A is not "borne" in the same sense as B–D: it is engineering already put
       in, and a development price stays negotiable if the department contracts
       one. Saying so keeps that position open. */
    { text: 'A is engineering ServerPe has already invested — not charged to the department · B – D are borne by ServerPe', options: { fontFace: F.enBold, fontSize: 10, color: 'B45309' } },
    { text: '   ·   A: ಈಗಾಗಲೇ ಹೂಡಿದ ಎಂಜಿನಿಯರಿಂಗ್ — ಇಲಾಖೆಗೆ ಶುಲ್ಕವಿಲ್ಲ', options: { fontFace: F.kn, fontSize: KN(7.5), color: C.muted } },
  ], { x: GUTTER + 0.18, y: 1.74, w: W - GUTTER * 2 - 0.36, h: 0.7, valign: 'middle', margin: 0 });

  const top = 2.52;
  const bottom = H - FOOTER_H - 0.14;
  const gapX = 0.25;
  const gapY = 0.16;
  const w = (W - GUTTER * 2 - gapX) / 2;
  const h = (bottom - top - gapY) / 2;
  const lx = GUTTER;
  const rx = GUTTER + w + gapX;
  const by = top + h + gapY;

  /* A — one-time build. */
  costPanel(s, { x: lx, y: top, w, h, letter: 'A', en: 'One-time Build', kn: 'ಒಮ್ಮೆ ಮಾತ್ರ — ನಿರ್ಮಾಣ', period: 'Year 1 only', color: C.brand });
  COST.build.forEach((r, i) => costRow(s, { x: lx, y: top + 0.52 + i * 0.46, w, h: 0.46, en: r.en, kn: '', note: r.note, value: lakhRange(r) }));
  s.addText('Engineering value already invested — not charged to the department', {
    x: lx + 0.22, y: top + 1.44, w: w - 0.44, h: 0.28, fontFace: F.en, fontSize: 8.5, italic: true, color: C.muted, valign: 'middle', margin: 0 });
  costSubtotal(s, { x: lx, y: top + h - 0.42, w, en: 'Build subtotal', kn: 'ಉಪಮೊತ್ತ', value: lakhRange(T.build), color: C.brand });

  /* B — fixed running costs. */
  costPanel(s, { x: rx, y: top, w, h, letter: 'B', en: 'Running — Fixed', kn: 'ಸ್ಥಿರ ನಿರ್ವಹಣಾ ವೆಚ್ಚ', period: 'Per year', color: C.brand2 });
  const bPitch = (h - 0.5 - 0.46) / COST.fixed.length;
  COST.fixed.forEach((r, i) => costRow(s, { x: rx, y: top + 0.52 + i * bPitch, w, h: bPitch, en: r.en, kn: r.kn, value: lakhRange(r) }));
  costSubtotal(s, { x: rx, y: top + h - 0.42, w, en: 'Fixed subtotal', kn: 'ಉಪಮೊತ್ತ', value: lakhRange(T.fixed), color: C.brand2 });

  /* C — usage-based running costs. */
  costPanel(s, { x: lx, y: by, w, h, letter: 'C', en: 'Running — Usage-based', kn: 'ಬಳಕೆ ಆಧಾರಿತ ವೆಚ್ಚ', period: 'Per year', color: 'D97706' });
  COST.usage.forEach((r, i) => costRow(s, { x: lx, y: by + 0.56 + i * 0.42, w, h: 0.42, en: r.en, kn: r.kn, value: lakhRange(r) }));
  s.addText('Grows with the number of bookings — lower in a quiet season', {
    x: lx + 0.22, y: by + 1.42, w: w - 0.44, h: 0.3, fontFace: F.en, fontSize: 9, italic: true, color: C.muted, valign: 'middle', margin: 0 });
  costSubtotal(s, { x: lx, y: by + h - 0.42, w, en: 'Usage subtotal', kn: 'ಉಪಮೊತ್ತ', value: lakhRange(T.usage), color: 'B45309' });

  /* D — transaction-based: taken from each payment, never spent up front. */
  costPanel(s, { x: rx, y: by, w, h, letter: 'D', en: 'Payment Processing', kn: 'ಪಾವತಿ ಪ್ರಕ್ರಿಯೆ ಶುಲ್ಕ', period: 'Per transaction', color: '64748B' });
  /* Per pass, not per year: a yearly figure here reads as a bill. */
  const rzPer = Object.fromEntries(['BIKE', 'CAR', 'TOOFAN', 'TT'].map((code) => [code, passInclusive(ctx.prices[code], feesOf(ctx)[code], ctx.gst, ctx.gateway, insideOf(ctx)).gateway]));
  /* Toofan and TT tickets differ now (₹180 and ₹230), so one figure becomes a range. */
  const rzHeavy = rzPer.TOOFAN === rzPer.TT ? rupees(rzPer.TT) : `${rupees(Math.min(rzPer.TOOFAN, rzPer.TT))}–${rupees(Math.max(rzPer.TOOFAN, rzPer.TT)).slice(1)}`;
  costRow(s, { x: rx, y: by + 0.56, w, h: 0.5, en: 'Razorpay payment gateway', kn: '', note: `${ctx.gateway}% of the whole payment · Route / settlement as applicable`, value: `${ctx.gateway}% per payment` });
  costRow(s, { x: rx, y: by + 1.08, w, h: 0.5, en: `GST ${ctx.gst}% on the gateway fee`, kn: '', note: `All-in ${gatewayAllIn(ctx)}% — ${rupees(rzPer.BIKE)} bike, ${rupees(rzPer.CAR)} car, ${rzHeavy} Toofan/TT`, value: `${gatewayAllIn(ctx)}% all-in`, valueColor: C.brand });
  s.addShape('roundRect', { x: rx + 0.16, y: by + h - 0.62, w: w - 0.32, h: 0.5, fill: { color: 'F1F5F9' }, line: { color: 'CBD5E1' }, rectRadius: 0.06 });
  s.addText([
    { text: 'Paid by ServerPe out of its service fee — never billed to the department', options: { fontFace: F.enBold, fontSize: 10, color: '334155', breakLine: true } },
    { text: 'ServerPe ತನ್ನ ಸೇವಾ ಶುಲ್ಕದಿಂದ ಭರಿಸುತ್ತದೆ — ಇಲಾಖೆಗೆ ಶುಲ್ಕವಿಲ್ಲ', options: { fontFace: F.kn, fontSize: KN(8), color: C.muted } },
  ], { x: rx + 0.28, y: by + h - 0.62, w: w - 0.56, h: 0.5, valign: 'middle', margin: 0 });
}

/** Investment & operating costs, 2 of 3 — the AMC: what it covers, and why it is lean. */
function amc(pptx, ctx) {
  const s = pptx.addSlide({ masterName: 'CONTENT' });
  heading(s, 'Annual Maintenance Contract (AMC)', 'ವಾರ್ಷಿಕ ನಿರ್ವಹಣಾ ಒಪ್ಪಂದ (AMC)');

  s.addText([
    ...(ctx.plan.kind === 'contract'
      ? [{ text: `One AMC contract for ${PLAN_YEARS} years`, options: { fontFace: F.enBold, fontSize: 13, color: C.brand } },
        { text: `   ·   ${PLAN_YEARS} ವರ್ಷದ ಒಂದೇ AMC ಒಪ್ಪಂದ`, options: { fontFace: F.kn, fontSize: KN(9.5), color: C.muted } }]
      : [{ text: 'AMC renewed every year on payment', options: { fontFace: F.enBold, fontSize: 13, color: C.brand } },
        { text: '   ·   ಪಾವತಿಯೊಂದಿಗೆ ಪ್ರತಿ ವರ್ಷ AMC ನವೀಕರಣ', options: { fontFace: F.kn, fontSize: KN(9.5), color: C.muted } }]),
  ], { x: GUTTER, y: 1.84, w: W - GUTTER * 2, h: 0.36, valign: 'middle', margin: 0 });

  const covered = [
    /* The infrastructure first: it is the most concrete thing the department
       gets for the AMC, and a list that opens with "bug fixing" reads as
       labour alone (user, 2026-09-15). */
    ['Server & hosting (VPS)', 'ಸರ್ವರ್ ಮತ್ತು ಹೋಸ್ಟಿಂಗ್'],
    ['Domain & SSL renewals', 'ಡೊಮೇನ್, SSL ನವೀಕರಣ'],
    ['Mail server', 'ಇಮೇಲ್ ಸರ್ವರ್'],
    ['Application maintenance', 'ಅಪ್ಲಿಕೇಶನ್ ನಿರ್ವಹಣೆ'],
    ['Bug fixing', 'ದೋಷ ನಿವಾರಣೆ'],
    ['Security updates', 'ಭದ್ರತಾ ನವೀಕರಣ'],
    ['Backend & API maintenance', 'ಬ್ಯಾಕೆಂಡ್, API ನಿರ್ವಹಣೆ'],
    ['Database maintenance', 'ಡೇಟಾಬೇಸ್ ನಿರ್ವಹಣೆ'],
    ['WhatsApp integration upkeep', 'ವಾಟ್ಸಾಪ್ ಸಂಪರ್ಕ ನಿರ್ವಹಣೆ'],
    ['Payment integration upkeep', 'ಪಾವತಿ ಸಂಪರ್ಕ ನಿರ್ವಹಣೆ'],
    ['Application & performance monitoring', 'ಕಾರ್ಯಕ್ಷಮತೆ ಮೇಲ್ವಿಚಾರಣೆ'],
    ['Backup monitoring', 'ಬ್ಯಾಕಪ್ ಮೇಲ್ವಿಚಾರಣೆ'],
    ['Production issue support', 'ತುರ್ತು ಸಮಸ್ಯೆ ಬೆಂಬಲ'],
    ['Minor corrective changes', 'ಸಣ್ಣ ತಿದ್ದುಪಡಿಗಳು'],
    ['Deployment support', 'ನಿಯೋಜನೆ ಬೆಂಬಲ'],
  ];

  const top = 2.3;
  const bottom = H - FOOTER_H - 0.14;
  const leftW = 7.35;
  const lx = GUTTER;
  s.addShape('roundRect', { x: lx, y: top, w: leftW, h: bottom - top, fill: { color: C.white }, line: { color: C.line }, rectRadius: 0.08 });
  s.addText([
    { text: 'What the AMC covers', options: { fontFace: F.enBold, fontSize: 14, color: C.ink } },
    { text: '   ·   AMC ಒಳಗೊಂಡಿರುವುದು', options: { fontFace: F.kn, fontSize: KN(10), color: C.brand2 } },
  ], { x: lx + 0.25, y: top + 0.08, w: leftW - 0.5, h: 0.5, valign: 'middle', margin: 0 });

  const perCol = Math.ceil(covered.length / 2);
  const listTop = top + 0.62;
  const extraH = 0.56;
  const pitch = (bottom - listTop - extraH - 0.2) / perCol;
  const colW = (leftW - 0.5) / 2;
  covered.forEach(([en, kn], i) => {
    const col = i < perCol ? 0 : 1;
    const row = col ? i - perCol : i;
    const x = lx + 0.25 + col * colW;
    const y = listTop + row * pitch;
    s.addShape('ellipse', { x, y: y + pitch / 2 - 0.13, w: 0.26, h: 0.26, fill: { color: '16A34A' }, line: { color: '16A34A' } });
    s.addText('✓', { x, y: y + pitch / 2 - 0.13, w: 0.26, h: 0.26, fontFace: F.enBold, fontSize: 9.5, color: C.white, align: 'center', valign: 'middle', margin: 0 });
    s.addText([
      { text: en, options: { fontFace: F.en, fontSize: 11, color: C.ink, breakLine: true } },
      { text: kn, options: { fontFace: F.kn, fontSize: KN(8), color: C.muted } },
    ], { x: x + 0.36, y, w: colW - 0.44, h: pitch, valign: 'middle', margin: 0 });
  });
  const exY = bottom - extraH - 0.14;
  s.addShape('roundRect', { x: lx + 0.2, y: exY, w: leftW - 0.4, h: extraH, fill: { color: 'FFFBEB' }, line: { color: C.sun }, rectRadius: 0.06 });
  s.addText([
    { text: 'Major new features — charged separately', options: { fontFace: F.enBold, fontSize: 11.5, color: 'B45309', breakLine: true } },
    { text: 'ದೊಡ್ಡ ಹೊಸ ವೈಶಿಷ್ಟ್ಯಗಳಿಗೆ ಪ್ರತ್ಯೇಕ ಶುಲ್ಕ', options: { fontFace: F.kn, fontSize: KN(8.5), color: C.muted } },
  ], { x: lx + 0.4, y: exY, w: leftW - 0.8, h: extraH, valign: 'middle', margin: 0 });

  /* Right: the price, then why it is lean. */
  const rx = lx + leftW + 0.25;
  const rw = W - GUTTER - rx;
  const priceH = 2.12;
  s.addShape('roundRect', { x: rx, y: top, w: rw, h: priceH, fill: { color: C.brand }, line: { color: C.brand }, rectRadius: 0.08 });
  /* This proposal's figure, what follows it, and the three years. */
  const p = ctx.plan;
  const card = p.kind === 'contract'
    ? { tag: `${PLAN_YEARS}-year contract`, kn: `${PLAN_YEARS} ವರ್ಷದ ಒಪ್ಪಂದ`, big: inrFull(p.total), note: `One contract for ${PLAN_YEARS} years`,
      lines: ['Training & on-spot fixes included free', 'First-month visits & on-spot training free'] }
    : { tag: 'Year by year', kn: 'ಪ್ರತಿ ವರ್ಷ ನವೀಕರಣ', big: inrFull(year1Of(p)), note: `Year 1: ${lakhShort(p.startup)} start-up + ${lakhShort(p.amc)} AMC`,
      lines: [`Then ${inrFull(p.amc)} a year`, 'Renewed yearly on payment'] };
  s.addText([
    { text: card.tag, options: { fontFace: F.enBold, fontSize: 12, color: C.sun, breakLine: true } },
    { text: card.kn, options: { fontFace: F.kn, fontSize: KN(8), color: 'CFE5DC', breakLine: true } },
    { text: card.big, options: { fontFace: F.enBold, fontSize: 24, color: C.white, breakLine: true } },
    { text: card.note, options: { fontFace: F.en, fontSize: 10.5, color: 'CFE5DC', breakLine: true } },
    ...card.lines.map((l) => ({ text: l, options: { fontFace: F.en, fontSize: 10.5, color: C.white, breakLine: true } })),
    { text: `${PLAN_YEARS} years: ${inrFull(threeYearsOf(p))} + GST`, options: { fontFace: F.enBold, fontSize: 11, color: C.sun } },
  ], { x: rx + 0.3, y: top, w: rw - 0.6, h: priceH, valign: 'middle', margin: 0 });

  const whyY = top + priceH + 0.2;
  s.addShape('roundRect', { x: rx, y: whyY, w: rw, h: bottom - whyY, fill: { color: C.mist }, line: { color: C.mist2 }, rectRadius: 0.08 });
  s.addText([
    { text: 'Why ServerPe\'s AMC is lean', options: { fontFace: F.enBold, fontSize: 13.5, color: C.ink, breakLine: true } },
    { text: 'ನಮ್ಮ AMC ಕಡಿಮೆ ಏಕೆ?', options: { fontFace: F.kn, fontSize: KN(9.5), color: C.brand2 } },
  ], { x: rx + 0.25, y: whyY + 0.08, w: rw - 0.5, h: 0.62, valign: 'middle', margin: 0 });
  const reasons = [
    ['Hosting, domain, mail and SSL are inside it', 'ಸರ್ವರ್, ಡೊಮೇನ್ ಎಲ್ಲವೂ ಒಳಗೇ'],
    ['Sole proprietor — no office or sales overheads', 'ಏಕಮಾಲೀಕತ್ವ — ಹೆಚ್ಚುವರಿ ವೆಚ್ಚವಿಲ್ಲ'],
    ['The engineer who built it maintains it — no hand-over', 'ನಿರ್ಮಿಸಿದವರೇ ನಿರ್ವಹಣೆ — ಹಸ್ತಾಂತರವಿಲ್ಲ'],
    ['Larger IT firms carry overheads that raise their AMC', 'ದೊಡ್ಡ ಸಂಸ್ಥೆಗಳ ಹೆಚ್ಚುವರಿ ವೆಚ್ಚ AMC ಏರಿಸುತ್ತದೆ'],
  ];
  const rTop = whyY + 0.76;
  const rPitch = (bottom - rTop - 0.1) / reasons.length;
  reasons.forEach(([en, kn], i) => {
    const y = rTop + i * rPitch;
    s.addShape('ellipse', { x: rx + 0.27, y: y + 0.12, w: 0.1, h: 0.1, fill: { color: C.brand2 }, line: { color: C.brand2 } });
    s.addText([
      { text: en, options: { fontFace: F.en, fontSize: 10.5, color: C.ink, breakLine: true } },
      { text: kn, options: { fontFace: F.kn, fontSize: KN(8), color: C.muted } },
    ], { x: rx + 0.46, y, w: rw - 0.64, h: rPitch, valign: 'top', margin: 0 });
  });
}

/** Investment & operating costs, 3 of 3 — what running it costs, every year. */
function yearCompare(pptx, ctx) {
  const s = pptx.addSlide({ masterName: 'CONTENT' });
  /* This was "Year 1 vs Year 2" until the build row came out (user,
     2026-09-15): the department never pays for the build, so it does not
     belong in a table of costs. Without it the two years are identical, and
     what is left to say is simply what the platform costs to keep running. */
  heading(s, 'What It Costs ServerPe to Run Pravesha', 'Pravesha ನಡೆಸಲು ServerPe ವೆಚ್ಚ');
  const T = costTotals();

  const top = 1.95;
  const stripH = 0.46;
  const bottom = H - FOOTER_H - 0.14 - stripH - 0.12;
  const lx = GUTTER;
  const leftW = 6.55;
  const rx = lx + leftW + 0.28;
  const rw = W - GUTTER - rx;
  const rowH = 0.28;
  /*
   * ROUNDED TO THE CHARGE (user, 2026-09-16). The year totals exactly the ₹4 L
   * annual charge, all-inclusive: work, labour and development is the balance
   * after the bought-in lines, so the list and the charge are one figure. Year 1
   * adds the ₹2 L start-up, for ₹6 L.
   */
  const p = ctx.plan;
  const perYear = perYearOf(p);
  const balance = perYear ? { min: perYear - T.year2.max, max: perYear - T.year2.min } : null;

  /* Left: every rupee that recurs, itemised — grouped subtotals here read as
     something withheld, and this is the slide where the department is entitled
     to see the whole list. */
  s.addShape('roundRect', { x: lx, y: top, w: leftW, h: bottom - top, fill: { color: C.white }, line: { color: C.line }, rectRadius: 0.08 });
  s.addShape('roundRect', { x: lx, y: top, w: leftW, h: 0.58, fill: { color: C.brand }, line: { color: C.brand }, rectRadius: 0.08 });
  s.addShape('rect', { x: lx, y: top + 0.38, w: leftW, h: 0.2, fill: { color: C.brand }, line: { color: C.brand } });
  s.addText([
    { text: 'Every Year', options: { fontFace: F.enBold, fontSize: 15, color: C.white } },
    { text: '   ಪ್ರತಿ ವರ್ಷ', options: { fontFace: F.kn, fontSize: KN(9.5), color: 'E7F2EE' } },
  ], { x: lx + 0.22, y: top, w: leftW - 2.2, h: 0.58, valign: 'middle', margin: 0 });
  s.addText({ yearly: 'Every year · Year 1 adds the start-up', contract: 'Every year · start-up included free', none: 'Every year · borne by ServerPe' }[p.kind], { x: lx + leftW - 2.9, y: top, w: 2.7, h: 0.58, fontFace: F.en, fontSize: 9.5, color: 'E7F2EE', align: 'right', valign: 'middle', margin: 0 });

  const rows = [...COST.fixed, ...COST.usage];
  rows.forEach((r, i) => {
    const y = top + 0.64 + i * rowH;
    if (i > 0) s.addShape('line', { x: lx + 0.2, y, w: leftW - 0.4, h: 0, line: { color: C.line, width: 1 } });
    costRow(s, { x: lx, y, w: leftW, h: rowH, en: r.en, kn: r.kn, value: lakhRange(r) });
  });
  /* The labour, set apart from the bought-in lines above it: it is the one row
     the department is actually being asked to fund through the AMC. With no
     AMC there is no such row — the running costs are simply ServerPe's. */
  const wY = top + 0.64 + rows.length * rowH + 0.04;
  if (balance) {
    s.addShape('rect', { x: lx + 0.12, y: wY, w: leftW - 0.24, h: 0.46, fill: { color: C.mist }, line: { color: C.mist2 } });
    costRow(s, {
      x: lx, y: wY, w: leftW, h: 0.46, valueColor: C.brand,
      en: 'Work, labour & development', kn: 'ಶ್ರಮ ಮತ್ತು ಅಭಿವೃದ್ಧಿ',
      note: 'Maintenance, monitoring, fixes and support — the balance of the year',
      value: lakhRange(balance),
    });
  }

  /* A band: a label on the left, a figure on the right. */
  const band = (y, en, kn, value, fill) => {
    s.addShape('rect', { x: lx + 0.12, y, w: leftW - 0.24, h: 0.46, fill: { color: fill }, line: { color: fill } });
    s.addText([
      { text: en, options: { fontFace: F.enBold, fontSize: 12, color: C.white } },
      { text: `   ${kn}`, options: { fontFace: F.kn, fontSize: KN(8), color: 'CFE5DC' } },
    ], { x: lx + 0.24, y, w: leftW - 2.2, h: 0.46, valign: 'middle', margin: 0 });
    s.addText(value, { x: lx + leftW - 2.1, y, w: 1.9, h: 0.46, fontFace: F.enBold, fontSize: 15, color: C.white, align: 'right', valign: 'middle', margin: 0 });
  };

  const tY = wY + 0.5;
  band(tY, p.kind === 'contract' ? `Every year total (${lakh(p.total)} over ${PLAN_YEARS} years)` : 'Every year total', 'ವಾರ್ಷಿಕ ಒಟ್ಟು',
    perYear ? lakh(perYear) : lakhRange(T.year2), C.brand2);

  /* Year 1: the start-up, and what it is for — or, without one, who pays. */
  const yY = tY + 0.5;
  const yH = 0.64;
  const year1 = {
    yearly: ['Year 1 total', 'ಮೊದಲ ವರ್ಷದ ಒಟ್ಟು', `${lakh(p.amc)} + ${lakh(p.startup)} start-up — deployment, training, on-spot fixes & presence, travel, etc.`, p.kind === 'yearly' ? lakh(year1Of(p)) : ''],
    contract: ['Year 1 start-up', 'ಆರಂಭಿಕ ವೆಚ್ಚ', 'Deployment, training, on-spot fixes, first-month visits & on-spot training', 'Included free'],
    none: ['Paid for by', 'ಯಾರು ಭರಿಸುತ್ತಾರೆ', 'ServerPe, out of the per-pass service fee — no annual charge to the department', 'No AMC'],
  }[p.kind];
  s.addShape('rect', { x: lx + 0.12, y: yY, w: leftW - 0.24, h: yH, fill: { color: C.deep }, line: { color: C.deep } });
  s.addText([
    { text: year1[0], options: { fontFace: F.enBold, fontSize: 12, color: C.white } },
    { text: `   ${year1[1]}`, options: { fontFace: F.kn, fontSize: KN(8), color: 'CFE5DC', breakLine: true } },
    { text: year1[2], options: { fontFace: F.en, fontSize: 8.5, color: 'CFE5DC' } },
  ], { x: lx + 0.24, y: yY, w: leftW - 1.9, h: yH, valign: 'middle', margin: 0 });
  s.addText(year1[3], { x: lx + leftW - 1.7, y: yY, w: 1.5, h: yH, fontFace: F.enBold, fontSize: 15, color: C.sun, align: 'right', valign: 'middle', margin: 0 });

  /* Right: the build, said once and kept out of every total, then what the AMC
     is actually buying against the list on the left. */
  const cardH = (bottom - top - 0.24) / 2;
  s.addShape('roundRect', { x: rx, y: top, w: rw, h: cardH, fill: { color: C.mist }, line: { color: C.mist2 }, rectRadius: 0.08 });
  s.addText([
    { text: 'The build is not in this table', options: { fontFace: F.enBold, fontSize: 13, color: C.ink, breakLine: true } },
    { text: 'ನಿರ್ಮಾಣ ವೆಚ್ಚ ಈ ಪಟ್ಟಿಯಲ್ಲಿಲ್ಲ', options: { fontFace: F.kn, fontSize: KN(9), color: C.brand2, breakLine: true } },
    { text: ' ', options: { fontFace: F.en, fontSize: 6, breakLine: true } },
    { text: `${lakhRange(T.build)} of engineering and hardware, already invested by ServerPe.`, options: { fontFace: F.enBold, fontSize: 11, color: C.ink, breakLine: true } },
    { text: 'For information only — it is not payable by the department, in this year or any year. It is recovered through the per-pass service fee.', options: { fontFace: F.en, fontSize: 10.5, color: C.muted, breakLine: true } },
    { text: 'ಮಾಹಿತಿಗಾಗಿ ಮಾತ್ರ — ಇಲಾಖೆಗೆ ಶುಲ್ಕವಿಲ್ಲ', options: { fontFace: F.kn, fontSize: KN(8), color: C.muted } },
  ], { x: rx + 0.24, y: top + 0.14, w: rw - 0.48, h: cardH - 0.28, valign: 'top', margin: 0 });

  const aY = top + cardH + 0.24;
  s.addShape('roundRect', { x: rx, y: aY, w: rw, h: cardH, fill: { color: C.brand }, line: { color: C.brand }, rectRadius: 0.08 });
  s.addText([
    { text: 'What the department pays', options: { fontFace: F.enBold, fontSize: 13, color: C.white, breakLine: true } },
    { text: 'ಇಲಾಖೆ ಪಾವತಿಸುವುದು', options: { fontFace: F.kn, fontSize: KN(9), color: 'CFE5DC', breakLine: true } },
    { text: ' ', options: { fontFace: F.en, fontSize: 5, breakLine: true } },
    /* One figure a year, not a bill of parts (user, 2026-09-15). */
    ...{
      yearly: () => [
        { text: `${inrFull(year1Of(p))} in Year 1, then ${inrFull(p.amc)} a year — `, options: { fontFace: F.enBold, fontSize: 11, color: C.sun } },
        { text: 'the table beside it, renewed each year on payment.', options: { fontFace: F.en, fontSize: 11, color: C.white, breakLine: true } },
        { text: ' ', options: { fontFace: F.en, fontSize: 5, breakLine: true } },
        { text: `Over ${PLAN_YEARS} years: ${inrFull(threeYearsOf(p))}, GST ${ctx.gst}% added.`, options: { fontFace: F.en, fontSize: 10.5, color: 'CFE5DC', breakLine: true } },
      ],
      contract: () => [
        { text: `${inrFull(p.total)} for ${PLAN_YEARS} years — `, options: { fontFace: F.enBold, fontSize: 11, color: C.sun } },
        { text: 'one contract; training, on-spot fixes, first-month visits and on-spot training included free.', options: { fontFace: F.en, fontSize: 11, color: C.white, breakLine: true } },
        { text: ' ', options: { fontFace: F.en, fontSize: 5, breakLine: true } },
        { text: `GST ${ctx.gst}% added.`, options: { fontFace: F.en, fontSize: 10.5, color: 'CFE5DC', breakLine: true } },
      ],
      none: () => [
        { text: 'No annual charge — ', options: { fontFace: F.enBold, fontSize: 11, color: C.sun } },
        { text: 'the per-pass service fee, paid by the visitor, is the only charge. ServerPe bears the running costs out of it.', options: { fontFace: F.en, fontSize: 11, color: C.white, breakLine: true } },
      ],
    }[p.kind](),
  ], { x: rx + 0.24, y: aY + 0.14, w: rw - 0.48, h: cardH - 0.28, valign: 'top', margin: 0 });

  const stripY = bottom + 0.12;
  s.addShape('roundRect', { x: GUTTER, y: stripY, w: W - GUTTER * 2, h: stripH, fill: { color: C.deep }, line: { color: C.deep }, rectRadius: 0.08 });
  s.addText([
    /* The same point on the slide that lists the costs themselves (user, 2026-09-17). */
    { text: 'In lakhs, before GST · server, domain, WhatsApp and SMS charges rise over time, so the service fee is revised yearly · Razorpay comes out of the service fee', options: { fontFace: F.en, fontSize: 10.5, color: C.white } },
  ], { x: GUTTER + 0.25, y: stripY, w: W - GUTTER * 2 - 0.5, h: stripH, align: 'center', valign: 'middle', margin: 0 });
}

/* ──────────────────────────────────────────── agenda 14: commercial models ── */

/**
 * What the department is asked to agree to, settled with the user on
 * 2026-09-15 after Model A (25% + AMC), Model B (30%) and a revenue share
 * were each weighed and set aside:
 *
 *   ONE ALL-INCLUSIVE SERVICE FEE per vehicle — ₹10 two-wheeler, ₹20 car,
 *   ₹30 Toofan/TT, which is 20% of each entry fee in whole rupees, with GST
 *   inside it. The visitor pays ₹60 / ₹120 / ₹180 and nothing else.
 *
 *   YEAR 1 ₹2 L + GST at the start, for deployment, training, on-spot testing
 *   and fixes at the gate, and travel; then an AMC of ₹4 L + GST a year from
 *   Year 2 (user, 2026-09-16 — previously ₹5 L and ₹3 L).
 *
 * The department keeps every rupee of its entry fee, and Razorpay's share of
 * the whole payment comes out of the service fee.
 *
 * Figures are worked out from the live entry fees (place_pricing), GST
 * (gst_percent_on_platform) and gateway rate (gateway_fee_percent). What the
 * platform earns is confidential and appears on no slide.
 */
const SERVICE_FEE = { BIKE: 10, CAR: 20, TOOFAN: 30, TT: 30 };
/* A proposal may carry its own fee — the service-fee-only one does, since it
   has no AMC behind it (user, 2026-09-17). Everything that quotes a fee asks here. */
const feesOf = (ctx) => (ctx.plan && ctx.plan.fees) || SERVICE_FEE;
/*
 * ONE DECK PER PROPOSAL (user, 2026-09-17). The same per-pass service fee in
 * all four; they differ only in the annual charge:
 *
 *   yearly    ₹2 L start-up + ₹4 L AMC in Year 1 (₹6 L), then ₹4 L a year,
 *             renewed each year on payment
 *   contract  ₹10 L for a 3-year contract; training, on-spot fixes, frequent
 *             first-month visits and on-spot training included free
 *   yearly    ₹1 L start-up + ₹3 L AMC in Year 1 (₹4 L), then ₹3 L a year
 *   none      the service fee only — no AMC
 *
 * GST is added to every AMC. The order below is the presenter's, and it is
 * deliberately not written into any slide or file name: the decks are opened
 * one at a time, as the discussion goes. A start-up covers deployment,
 * training, on-spot testing and fixes at the gate, and travel.
 */
const PLAN_YEARS = 3;
const PLANS = [
  { file: 'Pravesha-Commercial-AMC-Yearly-6L-then-4L.pptx', kind: 'yearly', startup: 200000, amc: 400000 },
  /* The fee as 10% of each entry fee — ₹5 bike, ₹10 car, ₹15 Toofan, ₹20 TT — on
     top of the entry fee with GST inside it, and the same ₹6 L / ₹4 L yearly AMC
     (user, 2026-09-17). */
  { file: 'Pravesha-Commercial-10-Percent-Fee-AMC-Yearly-6L-then-4L.pptx', kind: 'yearly', startup: 200000, amc: 400000, fees: { BIKE: 5, CAR: 10, TOOFAN: 15, TT: 20 } },
  { file: 'Pravesha-Commercial-AMC-3-Year-Contract-10L.pptx', kind: 'contract', total: 1000000 },
  /*
   * INSIDE THE ENTRY FEE (user, 2026-09-17). The visitor pays the entry fee and
   * nothing more — ₹100 for a car — and ServerPe's share, 10% with GST inside it,
   * comes out of it: ₹90 to the department, ₹10 to ServerPe. Offered with the
   * yearly ₹6 L / ₹4 L AMC and with the ₹10 L three-year contract.
   */
  { file: 'Pravesha-Commercial-Included-In-Entry-Fee-AMC-Yearly-6L-then-4L.pptx', kind: 'yearly', startup: 200000, amc: 400000, inside: true, fees: { BIKE: 5, CAR: 10, TOOFAN: 15, TT: 20 } },
  { file: 'Pravesha-Commercial-Included-In-Entry-Fee-AMC-3-Year-Contract-10L.pptx', kind: 'contract', total: 1000000, inside: true, fees: { BIKE: 5, CAR: 10, TOOFAN: 15, TT: 20 } },
  { file: 'Pravesha-Commercial-AMC-Yearly-4L-then-3L.pptx', kind: 'yearly', startup: 100000, amc: 300000 },
  /* No AMC, so a higher fee: ₹12 bike, ₹22 car, ₹32 Toofan, ₹33 TT, GST inside (user, 2026-09-17). */
  { file: 'Pravesha-Commercial-Service-Fee-Only.pptx', kind: 'none', fees: { BIKE: 12, CAR: 22, TOOFAN: 32, TT: 33 } },
];
const year1Of = (p) => (p.kind === 'yearly' ? p.startup + p.amc : null);
const perYearOf = (p) => ({ yearly: p.amc, contract: p.total / PLAN_YEARS, none: null }[p.kind]);
const threeYearsOf = (p) => ({ yearly: p.startup + p.amc * PLAN_YEARS, contract: p.total, none: 0 }[p.kind]);
/** ₹2 L, ₹1.5 L — for figures quoted inside a sentence. */
const lakhShort = (n) => `₹${Number((n / 100000).toFixed(2))} L`;
/* Toofan's 2 bookings in the sample are counted with Tempo Travellers: same price. */
const MIX = { BIKE: 0.33, CAR: 0.59, TT: 0.08 };

/* Toofan and Tempo Traveller were one row while they shared an entry fee. TT
   went to ₹200 and Toofan stayed at ₹150 (user, 2026-09-15), with both keeping
   the flat ₹30 service fee, so each has its own row. */
const COMMERCIAL_ROWS = [
  ['Two-wheeler', 'ದ್ವಿಚಕ್ರ ವಾಹನ', 'BIKE'],
  ['Car / Jeep / SUV', 'ಕಾರು / ಜೀಪ್', 'CAR'],
  /* Not "Maxi Cab": that is a licence an Innova taxi carries too, and it prices
     as a car (user, 2026-09-16). Named as the app's rate card names it. */
  ['Toofan / Trax / Cruiser', 'ಟೂಫಾನ್ / ಟ್ರಾಕ್ಸ್', 'TOOFAN'],
  ['Tempo Traveller', 'ಟೆಂಪೋ ಟ್ರಾವೆಲರ್', 'TT'],
];

/** Whole rupees where the amount is whole, paise where it is not. */
const rupees = (n) => (Math.abs(n - Math.round(n)) < 0.005 ? `₹${Math.round(n)}` : `₹${n.toFixed(2)}`);

/** GST INSIDE the fee: the visitor pays entry + fee, and nothing is added.
 *
 *  Razorpay bills GST on its own commission too (user, 2026-09-15), so the real
 *  cost of a payment is the 2.2% plus 18% of that — about 2.6% of the whole
 *  amount. ServerPe bears it; `gateway` is therefore the all-in figure. */
function passInclusive(entry, fee, gstPct, gatewayPct, inside = false) {
  const gst = fee - fee / (1 + gstPct / 100);
  /* Inside the entry fee: the visitor pays the entry fee alone, and the
     department's part is what is left after ServerPe's share. */
  const pays = inside ? entry : entry + fee;
  const dept = inside ? entry - fee : entry;
  const gateway = (pays * gatewayPct) / 100;
  return { entry, dept, fee, gst, pays, gatewayFee: gateway, gatewayGst: (gateway * gstPct) / 100, gateway: gateway * (1 + gstPct / 100) };
}
const insideOf = (ctx) => Boolean(ctx.plan && ctx.plan.inside);

/** The gateway rate once Razorpay's own GST is counted: 2.2% → 2.6%. */
const gatewayAllIn = (ctx) => Math.round(ctx.gateway * (1 + ctx.gst / 100) * 100) / 100;

/** The same pass if the department ever prefers GST charged on top. */
function passAdded(entry, fee, gstPct) {
  const gst = (fee * gstPct) / 100;
  return { entry, fee, gst, pays: entry + fee + gst };
}

function commercialFigures(ctx, fees = SERVICE_FEE) {
  const P = ctx.prices;
  const codes = COMMERCIAL_ROWS.map(([, , code]) => code);
  const missing = codes.filter((code) => !Number.isFinite(P[code]));
  if (missing.length) throw new Error(`no active Mullayanagiri price for ${missing.join(', ')}`);
  const inc = Object.fromEntries(codes.map((code) => [code, passInclusive(P[code], fees[code], ctx.gst, ctx.gateway, insideOf(ctx))]));
  const added = Object.fromEntries(codes.map((code) => [code, passAdded(P[code], fees[code], ctx.gst)]));
  /* One percentage only if every vehicle's fee is the same share of its entry
     fee; with a flat ₹30 on a ₹150 and a ₹200 pass it is not, and the slide
     then says nothing about a percentage rather than something untrue. */
  const pcts = [...new Set(codes.map((code) => Math.round((fees[code] / P[code]) * 1000) / 10))];
  return { inc, added, pct: pcts.length === 1 ? pcts[0] : null };
}

function commercial(pptx, ctx) {
  const s = pptx.addSlide({ masterName: 'CONTENT' });
  const item = COMMERCIAL_AGENDA.find((a) => a.en.startsWith('Commercial Proposal'));
  heading(s, item.en, item.kn);
  const fig = commercialFigures(ctx, feesOf(ctx));
  /* Each distinct fee once: Toofan and TT share ₹30, so "₹10 · ₹20 · ₹30". */
  const feeList = [...new Set(COMMERCIAL_ROWS.map(([, , code]) => feesOf(ctx)[code]))].map(rupees).join(' · ');

  /* What is being proposed, and what the fee is for. */
  s.addShape('roundRect', { x: GUTTER, y: 1.8, w: W - GUTTER * 2, h: 0.62, fill: { color: 'FFFBEB' }, line: { color: C.sun }, rectRadius: 0.06 });
  s.addText([
    { text: '★  Proposed: ', options: { fontFace: F.enBold, fontSize: 12, color: 'B45309' } },
    ...(insideOf(ctx)
      ? [{ text: `nothing added for visitors — ServerPe's share is ${fig.pct}% of each entry fee (${feeList}), GST included`, options: { fontFace: F.enBold, fontSize: 12, color: C.ink } },
        { text: '   ·   ಪ್ರವೇಶ ಶುಲ್ಕದೊಳಗೇ ಪಾಲು', options: { fontFace: F.kn, fontSize: KN(8.5), color: C.muted, breakLine: true } },
        { text: 'The share funds WhatsApp messaging, payment charges, hosting, support and continuous development — visitors pay the entry fee alone', options: { fontFace: F.en, fontSize: 9.5, color: C.ink } }]
      : [{ text: `one all-inclusive service fee per vehicle — ${feeList}, GST included`, options: { fontFace: F.enBold, fontSize: 12, color: C.ink } },
        { text: "   ·   ಪ್ರಸ್ತಾವನೆ: ಪ್ರತಿ ವಾಹನಕ್ಕೆ ಒಂದೇ ಶುಲ್ಕ (GST ಸಹಿತ)", options: { fontFace: F.kn, fontSize: KN(8.5), color: C.muted, breakLine: true } },
        { text: 'The fee funds WhatsApp messaging, payment charges, hosting, support and continuous development — the department pays nothing per booking', options: { fontFace: F.en, fontSize: 9.5, color: C.ink } }]),
  ], { x: GUTTER + 0.2, y: 1.8, w: W - GUTTER * 2 - 0.4, h: 0.62, valign: 'middle', margin: 0 });

  const top = 2.52;
  const stripH = 0.72;
  const bodyBottom = H - FOOTER_H - 0.14 - stripH - 0.12;

  /* Left: the price of a pass, and where each rupee of it goes. */
  const tableW = 7.75;
  const tx = GUTTER;
  s.addShape('roundRect', { x: tx, y: top, w: tableW, h: bodyBottom - top, fill: { color: C.white }, line: { color: C.line }, rectRadius: 0.08 });
  const iw = tableW - 0.3;
  const x0 = tx + 0.15;
  const cw = [0.32, 0.2, 0.22, 0.26].map((f) => f * iw);
  const cx = cw.map((_, i) => x0 + cw.slice(0, i).reduce((a, b) => a + b, 0));
  const headH = 0.6;
  const headY = top + 0.12;
  s.addShape('rect', { x: tx + 0.12, y: headY, w: tableW - 0.24, h: headH, fill: { color: C.deep }, line: { color: C.deep } });
  (insideOf(ctx) ? [
    ['Vehicle', '', 'ವಾಹನ'],
    ['To Department', `${100 - fig.pct}% of entry fee`, 'ಇಲಾಖೆಗೆ'],
    ['ServerPe share', `${fig.pct}% · GST included`, 'GST ಸಹಿತ'],
    ['Visitor pays', 'entry fee only', 'ಒಟ್ಟು ಪಾವತಿ'],
  ] : [
    ['Vehicle', '', 'ವಾಹನ'],
    ['Entry fee', 'to Department', 'ಇಲಾಖೆಗೆ'],
    ['Service fee', 'all-inclusive', 'GST ಸಹಿತ'],
    ['Visitor pays', 'nothing extra', 'ಒಟ್ಟು ಪಾವತಿ'],
  ]).forEach(([en, sub, kn], i) => {
    const runs = [{ text: en, options: { fontFace: F.enBold, fontSize: 11.5, color: C.white, breakLine: true } }];
    if (sub) runs.push({ text: sub, options: { fontFace: F.en, fontSize: 8.5, color: 'CFE5DC', breakLine: true } });
    runs.push({ text: kn, options: { fontFace: F.kn, fontSize: KN(6.5), color: 'CFE5DC' } });
    s.addText(runs, { x: cx[i], y: headY, w: cw[i] - (i ? 0.08 : 0), h: headH, align: i ? 'right' : 'left', valign: 'middle', margin: 0 });
  });

  /* Four vehicle rows now; shorter rows leave the notes beneath their room. */
  const rowH = 0.47;
  COMMERCIAL_ROWS.forEach(([en, kn, code], r) => {
    const y = headY + headH + r * rowH;
    const p = fig.inc[code];
    if (r) s.addShape('line', { x: x0, y, w: iw, h: 0, line: { color: C.line, width: 1 } });
    s.addText([
      { text: en, options: { fontFace: F.enBold, fontSize: 11.5, color: C.ink, breakLine: true } },
      { text: kn, options: { fontFace: F.kn, fontSize: KN(7.5), color: C.muted } },
    ], { x: cx[0], y, w: cw[0], h: rowH, valign: 'middle', margin: 0 });
    [
      [rupees(p.dept), F.en, 13, C.ink],
      [rupees(p.fee), F.enBold, 15, C.brand2],
      [rupees(p.pays), F.enBold, 17, C.brand],
    ].forEach(([val, face, size, color], i) => {
      s.addText(val, { x: cx[i + 1], y, w: cw[i + 1] - 0.08, h: rowH, fontFace: face, fontSize: size, color, align: 'right', valign: 'middle', margin: 0 });
    });
  });

  const notesY = headY + headH + COMMERCIAL_ROWS.length * rowH + 0.08;
  const notes = insideOf(ctx) ? [
    ['Visitors pay the entry fee alone — nothing is added at booking or at the counter', 'ಪ್ರವೇಶ ಶುಲ್ಕ ಮಾತ್ರ'],
    [`Department receives ${100 - fig.pct}% of every entry fee; ServerPe's ${fig.pct}% includes GST`, `ಇಲಾಖೆಗೆ ${100 - fig.pct}%`],
    [`Razorpay's ${ctx.gateway}% + ${ctx.gst}% GST on it — about ${gatewayAllIn(ctx)}% per payment — borne by ServerPe`, 'Razorpay ಶುಲ್ಕ, GST ಸಹಿತ'],
    ["Split at payment: the department's share settles straight to its own account", 'ಪಾವತಿಯಲ್ಲೇ ಹಂಚಿಕೆ'],
  ] : [
    ['Department keeps 100% of every entry fee', 'ಪ್ರವೇಶ ಶುಲ್ಕದ 100% ಇಲಾಖೆಗೆ'],
    [`All-inclusive: GST is inside the fee${fig.pct ? ` (${fig.pct}% of the entry fee)` : ''} — nothing added at the counter`, 'GST ಶುಲ್ಕದೊಳಗೇ'],
    [`Razorpay's ${ctx.gateway}% + ${ctx.gst}% GST on it — about ${gatewayAllIn(ctx)}% per payment — borne by ServerPe`, 'Razorpay ಶುಲ್ಕ, GST ಸಹಿತ'],
    [`If the department prefers GST charged separately: visitor pays ${COMMERCIAL_ROWS.map(([, , code]) => rupees(fig.added[code].pays)).join(' · ')}`, 'GST ಪ್ರತ್ಯೇಕವಾದರೆ'],
  ];
  const noteH = (bodyBottom - notesY - 0.06) / notes.length;
  notes.forEach(([en, kn], i) => {
    const y = notesY + i * noteH;
    s.addText([
      { text: '✓  ', options: { fontFace: F.enBold, fontSize: 10.5, color: '16A34A' } },
      { text: en, options: { fontFace: F.en, fontSize: 10, color: C.ink } },
      { text: `    ${kn}`, options: { fontFace: F.kn, fontSize: KN(7), color: C.muted } },
    ], { x: x0 + 0.05, y, w: iw - 0.1, h: noteH, valign: 'middle', margin: 0 });
  });

  /* Right: the two charges, and what each one buys. */
  const ax = tx + tableW + 0.2;
  const aw = W - GUTTER - ax;
  s.addShape('roundRect', { x: ax, y: top, w: aw, h: bodyBottom - top, fill: { color: C.white }, line: { color: C.brand2, width: 1.25 }, rectRadius: 0.08 });
  s.addShape('roundRect', { x: ax, y: top, w: aw, h: 0.5, fill: { color: C.brand }, line: { color: C.brand }, rectRadius: 0.08 });
  s.addShape('rect', { x: ax, y: top + 0.3, w: aw, h: 0.2, fill: { color: C.brand }, line: { color: C.brand } });
  s.addText([
    { text: 'What the Department Pays', options: { fontFace: F.enBold, fontSize: 13, color: C.white, breakLine: true } },
    { text: 'ಇಲಾಖೆ ಪಾವತಿಸುವುದು', options: { fontFace: F.kn, fontSize: KN(8), color: 'CFE5DC' } },
  ], { x: ax + 0.2, y: top, w: aw - 0.4, h: 0.5, valign: 'middle', margin: 0 });

  const line = (y, en, value, opts = {}) => {
    s.addText(en, { x: ax + 0.22, y, w: aw - 2.1, h: 0.26, fontFace: opts.bold ? F.enBold : F.en, fontSize: opts.size || 10.5, color: C.ink, valign: 'middle', margin: 0 });
    s.addText(value, { x: ax + aw - 1.95, y, w: 1.75, h: 0.26, fontFace: F.enBold, fontSize: opts.size || 11, color: opts.color || C.ink, align: 'right', valign: 'middle', margin: 0 });
  };
  const section = (y, en, kn, tag) => {
    s.addText([
      { text: en, options: { fontFace: F.enBold, fontSize: 10.5, color: C.brand } },
      { text: `  ${kn}`, options: { fontFace: F.kn, fontSize: KN(7), color: C.muted } },
    ], { x: ax + 0.22, y, w: aw - 1.3, h: 0.28, valign: 'middle', margin: 0 });
    s.addText(tag, { x: ax + aw - 1.25, y, w: 1.05, h: 0.28, fontFace: F.enBold, fontSize: 9, color: C.sun, align: 'right', valign: 'middle', margin: 0 });
  };
  const covers = (y, en, kn, h) => s.addText([
    { text: en, options: { fontFace: F.en, fontSize: 8.5, color: C.muted, breakLine: true } },
    { text: kn, options: { fontFace: F.kn, fontSize: KN(6.5), color: C.muted } },
  ], { x: ax + 0.22, y, w: aw - 0.44, h, valign: 'top', margin: 0 });

  /* This proposal's annual charge, what it covers, and its three years. */
  const p = ctx.plan;
  if (p.kind === 'yearly') {
    section(top + 0.52, 'AMC', 'ವಾರ್ಷಿಕ ನಿರ್ವಹಣಾ ಒಪ್ಪಂದ', 'Renewed yearly');
    line(top + 0.86, 'Year 1 — start-up + AMC', inrFull(year1Of(p)));
    line(top + 1.14, 'Year 2 onward, per year', inrFull(p.amc));
    covers(top + 1.46, `Start-up ${inrFull(p.startup)}: deployment, training, on-spot fixes & presence, travel, etc.`, 'ಆರಂಭಿಕ: ನಿಯೋಜನೆ, ತರಬೇತಿ, ಸ್ಥಳದಲ್ಲಿ ದೋಷ ನಿವಾರಣೆ, ಪ್ರಯಾಣ', 0.5);
    covers(top + 2.02, 'Renewed each year on payment', 'ಪಾವತಿಯೊಂದಿಗೆ ಪ್ರತಿ ವರ್ಷ ನವೀಕರಣ', 0.44);
  } else if (p.kind === 'contract') {
    section(top + 0.52, 'AMC', 'ವಾರ್ಷಿಕ ನಿರ್ವಹಣಾ ಒಪ್ಪಂದ', `${PLAN_YEARS}-year contract`);
    line(top + 0.86, `AMC for ${PLAN_YEARS} years`, inrFull(p.total));
    line(top + 1.14, 'Works out per year', `≈ ${inrFull(Math.round(p.total / PLAN_YEARS))}`);
    covers(top + 1.46, 'Training, on-spot fixes, frequent visits in the first month and on-spot training — included free', 'ತರಬೇತಿ, ಸ್ಥಳದಲ್ಲಿ ದೋಷ ನಿವಾರಣೆ, ಮೊದಲ ತಿಂಗಳ ಭೇಟಿಗಳು — ಉಚಿತ', 0.62);
  } else {
    section(top + 0.52, 'Annual charge', 'ವಾರ್ಷಿಕ ಶುಲ್ಕ', 'Service fee only');
    line(top + 0.86, 'AMC', 'Nil');
    line(top + 1.14, 'Charged per booking', 'Nil');
    covers(top + 1.46, 'The per-pass service fee, paid by the visitor, is the only charge', 'ಪ್ರವಾಸಿಗರು ಪಾವತಿಸುವ ಸೇವಾ ಶುಲ್ಕವೊಂದೇ ಶುಲ್ಕ', 0.5);
  }

  const sumY = bodyBottom - 0.52;
  s.addShape('roundRect', { x: ax + 0.14, y: sumY, w: aw - 0.28, h: 0.38, fill: { color: 'FEF3C7' }, line: { color: C.sun }, rectRadius: 0.06 });
  s.addText(p.kind === 'none'
    ? [{ text: 'No annual charge to the department', options: { fontFace: F.enBold, fontSize: 10.5, color: C.brand } }]
    : [
      { text: `Over ${PLAN_YEARS} years`, options: { fontFace: F.enBold, fontSize: 10, color: C.ink } },
      { text: `   ${inrFull(threeYearsOf(p))}`, options: { fontFace: F.enBold, fontSize: 11, color: C.brand } },
      { text: `   + GST ${ctx.gst}%`, options: { fontFace: F.en, fontSize: 9, color: C.muted } },
    ], { x: ax + 0.26, y: sumY, w: aw - 0.5, h: 0.38, valign: 'middle', margin: 0 });

  /* What the AMC contains is slide 16's job; repeating it here crowded the card
     and the department reads the same list twice (user, 2026-09-15). Only the
     first-year charge needs justifying on this slide. */

  /* Bottom: the fallback, and the term asked for. */
  const stripY = bodyBottom + 0.12;
  s.addShape('roundRect', { x: GUTTER, y: stripY, w: W - GUTTER * 2, h: stripH, fill: { color: C.deep }, line: { color: C.deep }, rectRadius: 0.08 });
  const half = (W - GUTTER * 2) / 2;
  /* The two charges are separate, not alternatives (user, 2026-09-15): the fee
     rides on each booking and is paid by the visitor; the annual charge is the
     department's. Saying so stops the slide reading as an either/or. */
  s.addText([
    ...(p.kind === 'none'
      ? [{ text: 'One charge only', options: { fontFace: F.enBold, fontSize: 11, color: C.sun, breakLine: true } },
        { text: 'Service fee — paid by the visitor, per booking', options: { fontFace: F.enBold, fontSize: 11, color: C.white, breakLine: true } },
        { text: 'ಸೇವಾ ಶುಲ್ಕ — ಪ್ರವಾಸಿಗರಿಂದ, ಪ್ರತಿ ಬುಕಿಂಗ್‌ಗೆ', options: { fontFace: F.kn, fontSize: KN(7), color: 'CFE5DC' } }]
      : insideOf(ctx)
      ? [{ text: 'Two charges', options: { fontFace: F.enBold, fontSize: 11, color: C.sun, breakLine: true } },
        { text: `${fig.pct}% of each entry fee, per booking · Annual charge — department`, options: { fontFace: F.enBold, fontSize: 11, color: C.white, breakLine: true } },
        { text: 'ಪ್ರತಿ ಬುಕಿಂಗ್‌ನ ಪ್ರವೇಶ ಶುಲ್ಕದ ಪಾಲು · ವಾರ್ಷಿಕ ಶುಲ್ಕ — ಇಲಾಖೆಯಿಂದ', options: { fontFace: F.kn, fontSize: KN(7), color: 'CFE5DC' } }]
      : [{ text: 'Two separate charges', options: { fontFace: F.enBold, fontSize: 11, color: C.sun, breakLine: true } },
        { text: 'Service fee — visitor, per booking · Annual charge — department', options: { fontFace: F.enBold, fontSize: 11, color: C.white, breakLine: true } },
        { text: 'ಸೇವಾ ಶುಲ್ಕ — ಪ್ರವಾಸಿಗರಿಂದ · ವಾರ್ಷಿಕ ಶುಲ್ಕ — ಇಲಾಖೆಯಿಂದ', options: { fontFace: F.kn, fontSize: KN(7), color: 'CFE5DC' } }]),
  ], { x: GUTTER + 0.3, y: stripY, w: half - 0.4, h: stripH, valign: 'middle', margin: 0 });
  s.addShape('line', { x: GUTTER + half, y: stripY + 0.14, w: 0, h: stripH - 0.28, line: { color: '4F9A8F', width: 1 } });
  s.addText([
    /* THE FEE MAY RISE EACH YEAR (user, 2026-09-17): server, domain, messaging and
       payment charges go up, and the service fee is revised with them. Said on
       the slide that sets the fee, so it is agreed with the fee, not after it. */
    { text: `Proposed term — ${PLAN_YEARS} years${{ yearly: ' · AMC renewed yearly', contract: ` · one ${PLAN_YEARS}-year AMC`, none: '' }[p.kind]}`, options: { fontFace: F.enBold, fontSize: 11, color: C.sun, breakLine: true } },
    { text: insideOf(ctx) ? 'ServerPe share revised yearly with server, domain & messaging charges' : 'Service fee revised yearly with server, domain, WhatsApp, SMS & payment charges', options: { fontFace: F.enBold, fontSize: 10.5, color: C.white, breakLine: true } },
    { text: 'ಸರ್ವರ್, ಡೊಮೇನ್, ಸಂದೇಶ ವೆಚ್ಚಕ್ಕೆ ಅನುಗುಣವಾಗಿ ಸೇವಾ ಶುಲ್ಕ ವಾರ್ಷಿಕ ಪರಿಷ್ಕರಣೆ', options: { fontFace: F.kn, fontSize: KN(7), color: 'CFE5DC' } },
  ], { x: GUTTER + half + 0.3, y: stripY, w: half - 0.5, h: stripH, valign: 'middle', margin: 0 });
}

/* QuizPe's own logo, read from its repository beside this one. */
const QUIZPE_LOGO = path.join(ROOT, '..', 'serverpe-quizpe-back-end', 'src', 'assets', 'logo-full.png');

/**
 * Agenda 3 — the products. QuizPe is live; Pravesha is the second.
 *
 * QuizPe's facts are as the user gave them (launched 26 July 2026, Class 1–10,
 * English-medium maths, all over India). Pravesha's are what this repository
 * does. Its status is what is pending — the demo and the approval — and what
 * go-live then depends on: where it is hosted, its domain and its database,
 * which are the department's to decide (agenda 17).
 */
function products(pptx) {
  const s = pptx.addSlide({ masterName: 'CONTENT' });
  heading(s, AGENDA[2].en, AGENDA[2].kn);

  const list = [
    {
      logo: QUIZPE_LOGO, logoH: 0.95, name: 'QuizPe', number: 1, bar: C.accent,
      badge: { text: '●  LIVE   ·   ಲೈವ್', w: 1.85, fill: C.accent, color: C.white },
      en: 'Daily revision quizzes on WhatsApp', kn: 'ವಾಟ್ಸಾಪ್‌ನಲ್ಲಿ ದೈನಂದಿನ ಪುನರಾವರ್ತನೆ ರಸಪ್ರಶ್ನೆ',
      facts: [
        ['Audience', 'ಯಾರಿಗಾಗಿ', 'Students, Class 1 to 10', 'ಒಂದರಿಂದ ಹತ್ತನೇ ತರಗತಿ ವಿದ್ಯಾರ್ಥಿಗಳು'],
        ['Subject', 'ವಿಷಯ', 'Mathematics · English medium', 'ಗಣಿತ · ಇಂಗ್ಲಿಷ್ ಮಾಧ್ಯಮ'],
        ['Reach', 'ವ್ಯಾಪ್ತಿ', 'Live all over India', 'ಭಾರತದಾದ್ಯಂತ ಲಭ್ಯ'],
        ['Launched', 'ಬಿಡುಗಡೆ', '26 July 2026', '26 ಜುಲೈ 2026'],
        ['Access', 'ಬಳಕೆ', 'On WhatsApp  ·  quizpe.in', 'ವಾಟ್ಸಾಪ್ ಮೂಲಕ  ·  quizpe.in'],
      ],
    },
    {
      logo: LOGO('pravesha-1024.png'), logoH: 0.62, name: 'Pravesha', number: 2, bar: C.brand,
      /* English only: with its Kannada the badge wraps, and the Status row
         right below already says it in Kannada. */
      badge: { text: 'Awaiting demo & approval', w: 2.6, fill: 'FEF3C7', color: 'B45309' },
      en: 'Vehicle entry passes on WhatsApp', kn: 'ವಾಟ್ಸಾಪ್‌ನಲ್ಲಿ ವಾಹನ ಪ್ರವೇಶ ಪಾಸ್',
      facts: [
        ['Audience', 'ಯಾರಿಗಾಗಿ', 'Visitors & the Department of Tourism', 'ಪ್ರವಾಸಿಗರು ಮತ್ತು ಪ್ರವಾಸೋದ್ಯಮ ಇಲಾಖೆ'],
        ['First site', 'ಮೊದಲ ತಾಣ', 'Mullayanagiri, Chikkamagaluru', 'ಮುಳ್ಳಯ್ಯನಗಿರಿ, ಚಿಕ್ಕಮಗಳೂರು'],
        ['Covers', 'ಒಳಗೊಂಡಿದೆ', 'Booking · payment · gate check · reports', 'ಬುಕಿಂಗ್ · ಪಾವತಿ · ಪರಿಶೀಲನೆ · ವರದಿ'],
        ['Status', 'ಸ್ಥಿತಿ', 'Awaiting demo & approval', 'ಪ್ರಾತ್ಯಕ್ಷಿಕೆ ಮತ್ತು ಅನುಮೋದನೆ ಬಾಕಿ'],
        ['Go-live depends on', 'ಆರಂಭಕ್ಕೆ ಅಗತ್ಯ', 'Hosting location  ·  domain  ·  database', 'ಸರ್ವರ್ ಸ್ಥಳ  ·  ಡೊಮೇನ್  ·  ಡೇಟಾಬೇಸ್'],
      ],
    },
  ];

  const top = 1.95;
  const gap = 0.35;
  const cardW = (W - GUTTER * 2 - gap) / 2;
  const cardH = H - FOOTER_H - 0.2 - top;
  const pad = 0.28;

  list.forEach((p, i) => {
    const x = GUTTER + i * (cardW + gap);
    const inner = cardW - pad * 2;
    s.addShape('roundRect', { x, y: top, w: cardW, h: cardH, fill: { color: C.white }, line: { color: C.line }, rectRadius: 0.08 });
    s.addShape('rect', { x, y: top, w: cardW, h: 0.09, fill: { color: p.bar }, line: { color: p.bar } });

    /* Logo, then the badge and which product this is. */
    const logoY = top + 0.22;
    if (fs.existsSync(p.logo)) logo(s, p.logo, { x: x + pad - (p.number === 1 ? 0.12 : 0), y: logoY, h: p.logoH, maxW: inner });
    else s.addText(p.name, { x: x + pad, y: logoY, w: inner, h: p.logoH, fontFace: F.enBold, fontSize: 30, color: C.ink, valign: 'middle', margin: 0 });

    const rowY = top + 1.2;
    s.addShape('roundRect', { x: x + pad, y: rowY, w: p.badge.w, h: 0.4, fill: { color: p.badge.fill }, line: { color: p.badge.fill }, rectRadius: 0.2 });
    s.addText(p.badge.text, { x: x + pad, y: rowY, w: p.badge.w, h: 0.4, fontFace: F.kn, fontSize: 11, bold: true, color: p.badge.color, align: 'center', valign: 'middle', margin: 0 });
    s.addText([
      { text: `Product ${p.number}`, options: { fontFace: F.enBold, fontSize: 11, color: C.muted } },
      { text: `   ·   ಉತ್ಪನ್ನ ${p.number}`, options: { fontFace: F.kn, fontSize: KN(9), color: C.muted } },
    ], { x: x + pad, y: rowY, w: inner, h: 0.4, align: 'right', valign: 'middle', margin: 0 });

    /* What it is. */
    const descY = rowY + 0.52;
    s.addText([
      { text: p.en, options: { fontFace: F.enBold, fontSize: 17, color: C.ink, breakLine: true } },
      { text: p.kn, options: { fontFace: F.kn, fontSize: KN(11), color: C.brand2 } },
    ], { x: x + pad, y: descY, w: inner, h: 0.72, valign: 'top', margin: 0 });

    /* The facts — five rows on each card, so the two stay level. */
    const factsY = descY + 0.78;
    const rowH = (top + cardH - 0.12 - factsY) / p.facts.length;
    const labelW = 1.6;
    p.facts.forEach(([le, lk, ve, vk], j) => {
      const y = factsY + j * rowH;
      s.addShape('line', { x: x + pad, y, w: inner, h: 0, line: { color: C.line, width: 1 } });
      s.addText([
        { text: le, options: { fontFace: F.en, fontSize: 10.5, color: C.muted, breakLine: true } },
        { text: lk, options: { fontFace: F.kn, fontSize: KN(8), color: C.muted } },
      ], { x: x + pad, y, w: labelW, h: rowH, valign: 'middle', margin: 0 });
      s.addText([
        { text: ve, options: { fontFace: F.enBold, fontSize: 12.5, color: C.ink, breakLine: true } },
        { text: vk, options: { fontFace: F.kn, fontSize: KN(8.5), color: C.muted } },
      ], { x: x + pad + labelW, y, w: inner - labelW, h: rowH, valign: 'middle', margin: 0 });
    });
  });
}

function closing(pptx) {
  const s = pptx.addSlide({ masterName: 'COVER' });
  s.addShape('rect', { x: 0, y: 0, w: W, h: H - FOOTER_H, fill: { color: C.brand } });
  s.addShape('rect', { x: 0, y: H - FOOTER_H - 0.08, w: W, h: 0.08, fill: { color: C.sun }, line: { color: C.sun } });

  s.addText('Thank you', { x: GUTTER, y: 1.35, w: W - GUTTER * 2, h: 1, fontFace: F.enBold, fontSize: 48, color: C.white, align: 'center', margin: 0 });
  s.addText('ಧನ್ಯವಾದಗಳು', { x: GUTTER, y: 2.3, w: W - GUTTER * 2, h: 0.7, fontFace: F.kn, fontSize: KN(30), color: 'CFE5DC', align: 'center', margin: 0 });
  s.addText([
    { text: 'Questions and discussion', options: { fontFace: F.en, fontSize: 16, color: C.white } },
    { text: '   ·   ', options: { fontFace: F.en, fontSize: 16, color: 'CFE5DC' } },
    { text: 'ಪ್ರಶ್ನೆಗಳು ಮತ್ತು ಚರ್ಚೆ', options: { fontFace: F.kn, fontSize: KN(16), color: C.white } },
  ], { x: GUTTER, y: 3.2, w: W - GUTTER * 2, h: 0.55, align: 'center', valign: 'middle', margin: 0 });

  s.addShape('roundRect', { x: 3.67, y: 4.25, w: 6, h: 2.0, fill: { color: C.white }, line: { color: C.white }, rectRadius: 0.12 });
  logo(s, SERVERPE_LOGO, { x: 3.9, y: 4.45, h: 1.6 });
  s.addText([
    { text: 'ServerPe App Solutions', options: { fontFace: F.enBold, fontSize: 16, color: C.ink, breakLine: true } },
    { text: 'admin@serverpe.in', options: { fontFace: F.en, fontSize: 13, color: C.muted, breakLine: true } },
    { text: '+91 98861 22415', options: { fontFace: F.en, fontSize: 13, color: C.muted, breakLine: true } },
    { text: 'serverpe.in', options: { fontFace: F.en, fontSize: 13, color: C.brand2 } },
  ], { x: 5.75, y: 4.45, w: 3.8, h: 1.6, valign: 'middle', margin: 0 });

  /* The undertaking the department will want on record, and the last thing left
     on screen while the room talks (user, 2026-09-15). Red on white rather than
     a red fill: on the green cover a filled band reads as a warning, and this is
     a promise. */
  const nY = 6.32;
  s.addShape('roundRect', { x: GUTTER + 0.25, y: nY, w: W - GUTTER * 2 - 0.5, h: 0.64, fill: { color: C.white }, line: { color: 'DC2626', width: 2 }, rectRadius: 0.08 });
  s.addText([
    /* Everyone on the platform, not only the visitor: the officers and the gate
       staff are in the database too, and they are the people in the room. */
    { text: 'Mobile numbers and personal details — visitors, officers and checkpost staff alike — are never shared without written permission', options: { fontFace: F.enBold, fontSize: 11.5, color: 'B91C1C', breakLine: true } },
    { text: 'ಪ್ರವಾಸಿಗರು, ಅಧಿಕಾರಿಗಳು, ಸಿಬ್ಬಂದಿ — ಯಾರ ವೈಯಕ್ತಿಕ ಮಾಹಿತಿಯನ್ನೂ ಅನುಮತಿ ಇಲ್ಲದೆ ಹಂಚಿಕೊಳ್ಳುವುದಿಲ್ಲ', options: { fontFace: F.kn, fontSize: KN(8), color: 'B91C1C' } },
  ], { x: GUTTER + 0.4, y: nY, w: W - GUTTER * 2 - 0.8, h: 0.64, align: 'center', valign: 'middle', margin: 0 });
}

/* In order. Slides from the agenda go between agenda and closing. */
/* ─────────────────────── agenda 15: inputs & approvals from the department ── */

/**
 * The ask. Everything here is small — a number, a name, a signature — which is
 * the point: nothing large stands between this meeting and go-live (user,
 * 2026-09-15).
 *
 * Reports & Information Sharing and Access Control & Deployment, once agenda
 * items of their own, are folded in as the two cards on the right:
 * both are questions for the department rather than slides of their own, and
 * the department answers them in the same sitting.
 */
/**
 * Go-live preparation (user, 2026-09-17): what happens between the department's
 * approval and the first real visitor, and why it takes time. No durations are
 * promised — most steps wait on Razorpay, Meta or ULIP — only that each starts
 * the day the approval is given.
 */
function goLive(pptx) {
  const s = pptx.addSlide({ masterName: 'CONTENT' });
  const item = AGENDA.find((a) => a.en.startsWith('Go-Live Preparation'));
  heading(s, item.en, item.kn);

  s.addText([
    { text: 'Approval is the start of go-live, not the same day — live payments, the chosen server and official accounts are set up and tested first', options: { fontFace: F.enBold, fontSize: 12.5, color: C.brand, breakLine: true } },
    { text: 'ಅನುಮೋದನೆಯ ದಿನವೇ ನೇರ ಸೇವೆ ಅಲ್ಲ — ಲೈವ್ ಪಾವತಿ, ಆಯ್ಕೆಯಾದ ಸರ್ವರ್ ಮತ್ತು ಅಧಿಕೃತ ಖಾತೆಗಳನ್ನು ಮೊದಲು ಸಿದ್ಧಪಡಿಸಿ ಪರೀಕ್ಷಿಸಬೇಕು', options: { fontFace: F.kn, fontSize: KN(9), color: C.muted } },
  ], { x: GUTTER, y: 1.72, w: W - GUTTER * 2, h: 0.62, valign: 'middle', margin: 0 });

  const steps = [
    ['Razorpay: test → live mode', 'ರೇಜರ್‌ಪೇ: ಪರೀಕ್ಷೆಯಿಂದ ಲೈವ್‌ಗೆ',
      'Live KYC and website review, live keys and webhooks, real-money test payments', 'ಲೈವ್ KYC, ಲೈವ್ ಕೀಗಳು, ನೈಜ ಪಾವತಿ ಪರೀಕ್ಷೆ'],
    ['Razorpay split settlement', 'ರೇಜರ್‌ಪೇ ರೂಟ್: ಹಣ ಹಂಚಿಕೆ',
      "Entry fee settled to the department's account, service fee to ServerPe — linked accounts, bank KYC, reconciliation tests", 'ಪ್ರವೇಶ ಶುಲ್ಕ ಇಲಾಖೆಗೆ, ಸೇವಾ ಶುಲ್ಕ ServerPe ಗೆ'],
    ['Database & hosting', 'ಡೇಟಾಬೇಸ್ ಮತ್ತು ಹೋಸ್ಟಿಂಗ್',
      'Department server or ServerPe cloud — set-up, security hardening, backups, data migration', 'ಇಲಾಖೆ ಸರ್ವರ್ ಅಥವಾ ServerPe ಕ್ಲೌಡ್ — ಸಿದ್ಧತೆ, ಭದ್ರತೆ, ಬ್ಯಾಕಪ್'],
    ['Domain & deployment', 'ಡೊಮೇನ್ ಮತ್ತು ನಿಯೋಜನೆ',
      'Official domain, security certificates, production deployment and monitoring', 'ಅಧಿಕೃತ ಡೊಮೇನ್, ಪ್ರಮಾಣಪತ್ರ, ನಿಯೋಜನೆ'],
    ['WhatsApp Business number', 'ವಾಟ್ಸಾಪ್ ವ್ಯವಹಾರ ಸಂಖ್ಯೆ',
      'Official number moved to the platform, display name and message templates approved by Meta', 'ಅಧಿಕೃತ ಸಂಖ್ಯೆ, ಹೆಸರು ಮತ್ತು ಸಂದೇಶಗಳಿಗೆ Meta ಅನುಮೋದನೆ'],
    ['Vehicle records — ULIP', 'ವಾಹನ ದಾಖಲೆಗಳು — ULIP',
      "The live server's address whitelisted with ULIP for Parivahan look-ups", 'ಪರಿವಾಹನ್ ದಾಖಲೆಗಳಿಗೆ ಸರ್ವರ್ ಅನುಮತಿ'],
    ['SMS sign-in codes', 'SMS ಲಾಗಿನ್ ಕೋಡ್',
      'Registered sender and message templates (DLT) for staff and officer sign-in', 'ಸಿಬ್ಬಂದಿ ಲಾಗಿನ್‌ಗೆ DLT ನೋಂದಣಿ'],
    ['Staff onboarding & training', 'ಸಿಬ್ಬಂದಿ ನೋಂದಣಿ ಮತ್ತು ತರಬೇತಿ',
      'Accounts for staff and officers, gate-app training, test data cleared, beta month begins', 'ಖಾತೆಗಳು, ತರಬೇತಿ, ಬೀಟಾ ತಿಂಗಳು ಆರಂಭ'],
  ];

  const top = 2.46;
  const bandH = 0.56;
  const bottom = H - FOOTER_H - 0.14 - bandH - 0.14;
  const cols = 4;
  const gap = 0.2;
  const cw = (W - GUTTER * 2 - gap * (cols - 1)) / cols;
  const ch = (bottom - top - gap) / 2;
  steps.forEach(([en, kn, detail, detailKn], i) => {
    const x = GUTTER + (i % cols) * (cw + gap);
    const y = top + Math.floor(i / cols) * (ch + gap);
    s.addShape('roundRect', { x, y, w: cw, h: ch, fill: { color: i < 3 ? 'FFFBEB' : C.white }, line: { color: i < 3 ? C.sun : C.line, width: 1 }, rectRadius: 0.08 });
    s.addShape('ellipse', { x: x + 0.16, y: y + 0.16, w: 0.36, h: 0.36, fill: { color: i < 3 ? C.sun : C.brand }, line: { color: i < 3 ? C.sun : C.brand } });
    s.addText(String(i + 1), { x: x + 0.16, y: y + 0.16, w: 0.36, h: 0.36, fontFace: F.enBold, fontSize: 11, color: C.white, align: 'center', valign: 'middle', margin: 0 });
    s.addText([
      { text: en, options: { fontFace: F.enBold, fontSize: 12, color: C.ink, breakLine: true } },
      { text: kn, options: { fontFace: F.kn, fontSize: KN(8), color: C.brand2 } },
    ], { x: x + 0.62, y: y + 0.08, w: cw - 0.74, h: 0.62, valign: 'middle', margin: 0 });
    s.addText([
      { text: detail, options: { fontFace: F.en, fontSize: 10, color: C.ink, breakLine: true } },
      { text: detailKn, options: { fontFace: F.kn, fontSize: KN(7.5), color: C.muted } },
    ], { x: x + 0.18, y: y + 0.76, w: cw - 0.36, h: ch - 0.86, valign: 'top', margin: 0 });
  });

  /* The three money-and-data steps are marked: they need the department's own
     decisions (bank account, server) before they can start. */
  const bandY = bottom + 0.14;
  s.addShape('roundRect', { x: GUTTER, y: bandY, w: W - GUTTER * 2, h: bandH, fill: { color: C.brand }, line: { color: C.brand }, rectRadius: 0.08 });
  s.addText([
    { text: 'Timeline depends on Razorpay, Meta and ULIP approvals and on the department bank account and server (steps 1–3) — each step starts the day of approval', options: { fontFace: F.enBold, fontSize: 11, color: C.white, breakLine: true } },
    { text: 'ಸಮಯವು ರೇಜರ್‌ಪೇ, Meta, ULIP ಅನುಮೋದನೆಗಳು ಮತ್ತು ಇಲಾಖೆಯ ಬ್ಯಾಂಕ್ ಖಾತೆ, ಸರ್ವರ್ ಆಯ್ಕೆಯನ್ನು ಅವಲಂಬಿಸಿದೆ', options: { fontFace: F.kn, fontSize: KN(8), color: 'CFE5DC' } },
  ], { x: GUTTER + 0.25, y: bandY, w: W - GUTTER * 2 - 0.5, h: bandH, valign: 'middle', margin: 0 });
}

function requirements(pptx, ctx) {
  const s = pptx.addSlide({ masterName: 'CONTENT' });
  const item = AGENDA.find((a) => a.en.startsWith('Inputs & Approvals'));
  heading(s, item.en, item.kn);

  s.addText([
    { text: 'Small items only — a decision, a name or a number, and Pravesha is ready', options: { fontFace: F.enBold, fontSize: 12.5, color: C.brand } },
    { text: '   ·   ಸಣ್ಣ ವಿಷಯಗಳಷ್ಟೇ — ನಿರ್ಧಾರ, ಹೆಸರು ಅಥವಾ ಸಂಖ್ಯೆ', options: { fontFace: F.kn, fontSize: KN(9), color: C.muted } },
  ], { x: GUTTER, y: 1.8, w: W - GUTTER * 2, h: 0.36, valign: 'middle', margin: 0 });

  const top = 2.28;
  const bottom = H - FOOTER_H - 0.14;
  const lx = GUTTER;
  const leftW = 7.15;
  const rx = lx + leftW + 0.28;
  const rw = W - GUTTER - rx;

  /* Left: the numbered ask, in the order the department will act on it. */
  s.addShape('roundRect', { x: lx, y: top, w: leftW, h: bottom - top, fill: { color: C.white }, line: { color: C.line }, rectRadius: 0.08 });
  s.addShape('roundRect', { x: lx, y: top, w: leftW, h: 0.56, fill: { color: C.brand }, line: { color: C.brand }, rectRadius: 0.08 });
  s.addShape('rect', { x: lx, y: top + 0.36, w: leftW, h: 0.2, fill: { color: C.brand }, line: { color: C.brand } });
  s.addText([
    { text: 'Before Go-Live — Approvals & Decisions', options: { fontFace: F.enBold, fontSize: 13.5, color: C.white } },
    { text: '   ಆರಂಭಕ್ಕೂ ಮುನ್ನ', options: { fontFace: F.kn, fontSize: KN(9), color: 'E7F2EE' } },
  ], { x: lx + 0.22, y: top, w: leftW - 0.44, h: 0.56, valign: 'middle', margin: 0 });

  const asks = [
    ['Where Pravesha is deployed — department server or ServerPe cloud', 'ನಿಯೋಜನೆ ಎಲ್ಲಿ — ಇಲಾಖೆ ಸರ್ವರ್ ಅಥವಾ ServerPe'],
    ['The domain name to be used', 'ಬಳಸಬೇಕಾದ ಡೊಮೇನ್ ಹೆಸರು'],
    ['The WhatsApp mobile number visitors will book on', 'ಬುಕಿಂಗ್‌ಗೆ ವಾಟ್ಸಾಪ್ ಮೊಬೈಲ್ ಸಂಖ್ಯೆ'],
    ['Sanction to use the department and Karnataka Tourism logos', 'ಲೋಗೋ ಬಳಕೆಗೆ ಅನುಮತಿ'],
    ['Approval for publicity, promotion and marketing', 'ಪ್ರಚಾರ ಮತ್ತು ಮಾರ್ಕೆಟಿಂಗ್‌ಗೆ ಅನುಮೋದನೆ'],
  ];
  const listTop = top + 0.66;
  const pitch = (bottom - listTop - 0.14) / asks.length;
  asks.forEach(([en, kn], i) => {
    const y = listTop + i * pitch;
    s.addShape('ellipse', { x: lx + 0.24, y: y + pitch / 2 - 0.16, w: 0.32, h: 0.32, fill: { color: C.accent }, line: { color: C.accent } });
    s.addText(String(i + 1), { x: lx + 0.24, y: y + pitch / 2 - 0.16, w: 0.32, h: 0.32, fontFace: F.enBold, fontSize: 11, color: C.white, align: 'center', valign: 'middle', margin: 0 });
    s.addText([
      { text: en, options: { fontFace: F.en, fontSize: 11.5, color: C.ink, breakLine: true } },
      { text: kn, options: { fontFace: F.kn, fontSize: KN(8), color: C.muted } },
    ], { x: lx + 0.68, y, w: leftW - 0.92, h: pitch, valign: 'middle', margin: 0 });
  });

  /* Right: the two agenda items that are questions for the department rather
     than slides of their own. */
  const cardH = (bottom - top - 0.24) / 2;
  const card = (y, en, kn, color, fg, sub, lines) => {
    s.addShape('roundRect', { x: rx, y, w: rw, h: cardH, fill: { color }, line: { color: color === C.white ? C.line : color }, rectRadius: 0.08 });
    s.addText([
      { text: en, options: { fontFace: F.enBold, fontSize: 13, color: fg, breakLine: true } },
      { text: kn, options: { fontFace: F.kn, fontSize: KN(9), color: sub } },
    ], { x: rx + 0.24, y: y + 0.12, w: rw - 0.48, h: 0.6, valign: 'middle', margin: 0 });
    const lTop = y + 0.76;
    const lPitch = (cardH - 0.9) / lines.length;
    /* A line may carry its own colour — the privacy undertaking is set in red
       wherever it appears (user, 2026-09-15). */
    lines.forEach(([le, lk, tone], i) => {
      const ly = lTop + i * lPitch;
      const dot = tone || sub;
      s.addShape('ellipse', { x: rx + 0.26, y: ly + lPitch / 2 - 0.06, w: 0.12, h: 0.12, fill: { color: dot }, line: { color: dot } });
      s.addText([
        { text: le, options: { fontFace: tone ? F.enBold : F.en, fontSize: 10.5, color: tone || fg, breakLine: true } },
        { text: lk, options: { fontFace: F.kn, fontSize: KN(7.5), color: tone || sub } },
      ], { x: rx + 0.5, y: ly, w: rw - 0.74, h: lPitch, valign: 'middle', margin: 0 });
    });
  };

  card(top, 'Access, Deployment & Data Governance', 'ಪ್ರವೇಶ ನಿಯಂತ್ರಣ ಮತ್ತು ದತ್ತಾಂಶ ಆಡಳಿತ', C.white, C.ink, C.muted, [
    ['Role-based logins — admin, gate and reports', 'ಯಾರಿಗೆ ಯಾವ ಪ್ರವೇಶ'],
    ['Deployment approval and server access', 'ಸರ್ವರ್ ಮತ್ತು ಡೇಟಾಬೇಸ್ ಪ್ರವೇಶ'],
    ['The data remains the department\'s', 'ದತ್ತಾಂಶ ಇಲಾಖೆಯದ್ದೇ'],
    ['No personal detail shared without permission', 'ಅನುಮತಿ ಇಲ್ಲದೆ ಹಂಚಿಕೆ ಇಲ್ಲ', 'B91C1C'],
  ]);

  card(top + cardH + 0.24, 'Reports & Information Sharing', 'ವರದಿಗಳು ಮತ್ತು ಮಾಹಿತಿ ಹಂಚಿಕೆ', C.brand, C.white, 'CFE5DC', [
    ['Which reports, to whom, and how often', 'ಯಾವ ವರದಿ, ಯಾರಿಗೆ, ಎಷ್ಟು ಬಾರಿ'],
    ['Officers to receive the 8 PM WhatsApp summary', 'ರಾತ್ರಿ 8 ಗಂಟೆಯ ವರದಿ ಯಾರಿಗೆ'],
    ['Their mobile numbers, for reports and alerts', 'ಅಧಿಕಾರಿಗಳ ಮೊಬೈಲ್ ಸಂಖ್ಯೆಗಳು'],
  ]);
}

/**
 * Termination, suspension and exit (user, 2026-09-16).
 *
 * Only the terms the user gave, and no figure: a month of beta live service
 * with no annual charge, the annual charge starting on an agreed day once the
 * department is satisfied and paid before it, and what is kept if the service
 * stops in either period. Read left to right as a timeline first, then as the
 * two cases, so the department sees when each rule applies before the rule.
 */
function exitTerms(pptx, ctx) {
  const noAmc = ctx.plan.kind === 'none';
  const s = pptx.addSlide({ masterName: 'CONTENT' });
  const item = COMMERCIAL_AGENDA.find((a) => a.en.startsWith('Termination'));
  heading(s, item.en, item.kn);

  s.addText([
    ...(noAmc
      ? [{ text: 'One month of beta live service — full service begins only once the department is satisfied', options: { fontFace: F.enBold, fontSize: 12.5, color: C.brand, breakLine: true } },
        { text: 'ಒಂದು ತಿಂಗಳ ಬೀಟಾ ನೇರ ಸೇವೆ — ಇಲಾಖೆ ತೃಪ್ತಿಪಟ್ಟ ನಂತರವೇ ಪೂರ್ಣ ಸೇವೆ ಆರಂಭ', options: { fontFace: F.kn, fontSize: KN(9.5), color: C.muted } }]
      : [{ text: 'One month of beta live service without any AMC — the annual charge begins only once the department is satisfied', options: { fontFace: F.enBold, fontSize: 12.5, color: C.brand, breakLine: true } },
        { text: 'ಒಂದು ತಿಂಗಳ ಬೀಟಾ ನೇರ ಸೇವೆಗೆ AMC ಇಲ್ಲ — ಇಲಾಖೆ ತೃಪ್ತಿಪಟ್ಟ ನಂತರವೇ ವಾರ್ಷಿಕ ಶುಲ್ಕ ಆರಂಭ', options: { fontFace: F.kn, fontSize: KN(9.5), color: C.muted } }]),
  ], { x: GUTTER, y: 1.72, w: W - GUTTER * 2, h: 0.62, valign: 'middle', margin: 0 });

  /* ── The timeline: beta month → AMC start date → actual production ── */
  const tTop = 2.6;
  const tH = 1.46;
  const gap = 0.5;
  const mileW = 4.5;
  const stageW = (W - GUTTER * 2 - mileW - gap * 2) / 2;
  const x1 = GUTTER;
  const x2 = x1 + stageW + gap;
  const x3 = x2 + mileW + gap;

  const stage = (x, w, fill, lineC, fg, sub, en, kn, noteEn, noteKn, tag) => {
    s.addShape('roundRect', { x, y: tTop, w, h: tH, fill: { color: fill }, line: { color: lineC, width: 1.25 }, rectRadius: 0.1 });
    s.addShape('roundRect', { x: x + 0.2, y: tTop - 0.15, w: 1.1, h: 0.3, fill: { color: tag.fill }, line: { color: tag.fill }, rectRadius: 0.15 });
    s.addText(tag.text, { x: x + 0.2, y: tTop - 0.15, w: 1.1, h: 0.3, fontFace: F.enBold, fontSize: 9.5, color: C.white, align: 'center', valign: 'middle', margin: 0 });
    s.addText([
      { text: en, options: { fontFace: F.enBold, fontSize: 13.5, color: fg, breakLine: true } },
      { text: kn, options: { fontFace: F.kn, fontSize: KN(9), color: sub, breakLine: true } },
      { text: noteEn, options: { fontFace: F.en, fontSize: 10.5, color: fg, breakLine: true } },
      { text: noteKn, options: { fontFace: F.kn, fontSize: KN(7.5), color: sub } },
    ], { x: x + 0.22, y: tTop + 0.22, w: w - 0.44, h: tH - 0.3, valign: 'middle', margin: 0, lineSpacingMultiple: 0.98 });
  };
  const arrow = (x) => s.addShape('rightArrow', { x: x + 0.07, y: tTop + tH / 2 - 0.17, w: gap - 0.14, h: 0.34, fill: { color: C.accent }, line: { color: C.accent } });

  stage(x1, stageW, C.mist, C.line, C.ink, C.muted,
    'Beta live production', 'ಬೀಟಾ ನೇರ ಸೇವೆ',
    noAmc ? 'Only the per-pass service fee' : 'No AMC · only the per-pass service fee',
    noAmc ? 'ಪ್ರತಿ ಪಾಸ್ ಸೇವಾ ಶುಲ್ಕ ಮಾತ್ರ' : 'AMC ಇಲ್ಲ · ಪ್ರತಿ ಪಾಸ್ ಸೇವಾ ಶುಲ್ಕ ಮಾತ್ರ',
    { text: 'MONTH 1', fill: C.accent });
  arrow(x1 + stageW);
  stage(x2, mileW, 'FEF3C7', C.sun, C.ink, '8A5A00',
    noAmc ? 'Service start date' : 'AMC start date', noAmc ? 'ಸೇವೆ ಆರಂಭ ದಿನಾಂಕ' : 'AMC ಆರಂಭ ದಿನಾಂಕ',
    noAmc ? 'Agreed 1st day after the beta month' : 'Agreed 1st day after the beta month · AMC paid before it',
    noAmc ? 'ಬೀಟಾ ನಂತರದ ಒಪ್ಪಿದ ಮೊದಲ ದಿನ' : 'ಬೀಟಾ ನಂತರದ ಒಪ್ಪಿದ ಮೊದಲ ದಿನ · ಮುಂಚಿತ AMC ಪಾವತಿ',
    { text: 'AGREED', fill: C.sun });
  arrow(x2 + mileW);
  stage(x3, stageW, C.brand, C.brand, C.white, 'CFE5DC',
    'Actual production', 'ನಿಜವಾದ ಸೇವೆ',
    noAmc ? 'Per-pass service fee' : 'Per-pass service fee + AMC', noAmc ? 'ಪ್ರತಿ ಪಾಸ್ ಸೇವಾ ಶುಲ್ಕ' : 'ಪ್ರತಿ ಪಾಸ್ ಸೇವಾ ಶುಲ್ಕ + AMC',
    { text: 'LIVE', fill: C.deep });

  /* ── The two cases ── */
  const lTop = tTop + tH + 0.24;
  s.addText([
    { text: 'If the service is dropped or suspended during the beta month', options: { fontFace: F.enBold, fontSize: 12.5, color: C.ink } },
    { text: '   ·   ಸೇವೆ ಸ್ಥಗಿತ ಅಥವಾ ಅಮಾನತು ಆದರೆ', options: { fontFace: F.kn, fontSize: KN(9), color: C.muted } },
  ], { x: GUTTER, y: lTop, w: W - GUTTER * 2, h: 0.34, valign: 'middle', margin: 0 });

  const cTop = lTop + 0.42;
  const bottom = H - FOOTER_H - 0.14;
  const cGap = 0.3;
  /* One card: once in actual production the service is not dropped or exited
     (user, 2026-09-16), so the beta month is the only period with exit terms. */
  const cW = W - GUTTER * 2;
  /* Red for what is not given back — the one thing a department reads twice. */
  const KEEP = 'B91C1C';

  const card = (x, fill, en, kn, lines) => {
    const h = bottom - cTop;
    s.addShape('roundRect', { x, y: cTop, w: cW, h, fill: { color: fill }, line: { color: C.line }, rectRadius: 0.1 });
    s.addText([
      { text: en, options: { fontFace: F.enBold, fontSize: 13, color: C.ink } },
      { text: `   ${kn}`, options: { fontFace: F.kn, fontSize: KN(9), color: C.muted } },
    ], { x: x + 0.24, y: cTop + 0.1, w: cW - 0.48, h: 0.42, valign: 'middle', margin: 0 });
    const top = cTop + 0.58;
    const pitch = (h - 0.7) / lines.length;
    lines.forEach(([le, lk, tone], i) => {
      const y = top + i * pitch;
      const dot = tone || C.accent;
      s.addShape('ellipse', { x: x + 0.28, y: y + pitch / 2 - 0.07, w: 0.14, h: 0.14, fill: { color: dot }, line: { color: dot } });
      s.addText([
        { text: le, options: { fontFace: tone ? F.enBold : F.en, fontSize: 11.5, color: tone || C.ink, breakLine: true } },
        { text: lk, options: { fontFace: F.kn, fontSize: KN(8.5), color: tone || C.muted } },
      ], { x: x + 0.56, y, w: cW - 0.8, h: pitch, valign: 'middle', margin: 0 });
    });
  };

  card(GUTTER, C.white, 'During the beta month', 'ಬೀಟಾ ತಿಂಗಳಲ್ಲಿ', [
    ['Allowed at any time', 'ಯಾವುದೇ ಸಮಯದಲ್ಲಿ ಅವಕಾಶ'],
    ...(noAmc ? [] : [['No AMC to pay — none has been charged', 'AMC ಪಾವತಿ ಇಲ್ಲ — ವಿಧಿಸಲಾಗಿಲ್ಲ']]),
    ['Service fees already collected are retained — not refunded', 'ಸಂಗ್ರಹವಾದ ಸೇವಾ ಶುಲ್ಕ ಹಿಂತಿರುಗಿಸಲಾಗುವುದಿಲ್ಲ', KEEP],
  ]);
}

/**
 * A question for the department: how should the price be shown? (user,
 * 2026-09-16).
 *
 * Asked, not answered — the choice is the department's, so neither option is
 * marked as preferred and each carries the same number of plain facts. The
 * same car pass, presented both ways. The
 * figures come from the same place the commercial slide's do — the entry fee
 * on record and the proposed service fee — so the two slides cannot disagree.
 * Part of the commercial proposal, so it carries that agenda item's number
 * rather than one of its own.
 */
function priceView(pptx, ctx) {
  const s = pptx.addSlide({ masterName: 'CONTENT' });
  heading(s, 'How Should the Price Be Shown to Visitors?', 'ಪ್ರವಾಸಿಗರಿಗೆ ದರವನ್ನು ಹೇಗೆ ತೋರಿಸಬೇಕು?');

  const entry = ctx.prices.CAR;
  const fee = feesOf(ctx).CAR;
  /* Inside the entry fee (user, 2026-09-17): the visitor still pays ₹100 for a
     car, and the breakdown shows ₹90 to the department and ₹10 to ServerPe. */
  const inside = insideOf(ctx);
  const dept = inside ? entry - fee : entry;
  const total = inside ? entry : entry + fee;

  s.addText([
    { text: `For the department to decide · Example: Car / Jeep / SUV, ${rupees(total)} in total${inside ? ` — unchanged for visitors: ${rupees(dept)} to the department, ${rupees(fee)} to ServerPe` : ''}`, options: { fontFace: F.enBold, fontSize: 12.5, color: C.brand, breakLine: true } },
    { text: `ಇಲಾಖೆಯ ನಿರ್ಧಾರಕ್ಕೆ · ಉದಾಹರಣೆ: ಕಾರು, ಒಟ್ಟು ${rupees(total)}`, options: { fontFace: F.kn, fontSize: KN(9.5), color: C.muted } },
  ], { x: GUTTER, y: 1.72, w: W - GUTTER * 2, h: 0.62, valign: 'middle', margin: 0 });

  const top = 2.52;
  const bottom = H - FOOTER_H - 0.82;
  const gap = 0.36;
  const cw = (W - GUTTER * 2 - gap) / 2;

  const option = (x, { tag, tagFill, en, kn, border, lines, points }) => {
    s.addShape('roundRect', { x, y: top, w: cw, h: bottom - top, fill: { color: C.white }, line: { color: border, width: 1.5 }, rectRadius: 0.1 });
    if (tag) {
      s.addShape('roundRect', { x: x + cw - 1.72, y: top - 0.15, w: 1.5, h: 0.3, fill: { color: tagFill }, line: { color: tagFill }, rectRadius: 0.15 });
      s.addText(tag, { x: x + cw - 1.72, y: top - 0.15, w: 1.5, h: 0.3, fontFace: F.enBold, fontSize: 9.5, color: C.white, align: 'center', valign: 'middle', margin: 0 });
    }
    s.addText([
      { text: en, options: { fontFace: F.enBold, fontSize: 14, color: C.ink } },
      { text: `   ${kn}`, options: { fontFace: F.kn, fontSize: KN(9.5), color: C.muted } },
    ], { x: x + 0.26, y: top + 0.14, w: cw - 0.52, h: 0.42, valign: 'middle', margin: 0 });

    /* The receipt, as the visitor would see it. */
    const rx = x + 0.3;
    const rw = cw - 0.6;
    const ry = top + 0.66;
    const rowH = 0.46;
    const rh = rowH * (lines.length + 1) + 0.26;
    s.addShape('roundRect', { x: rx, y: ry, w: rw, h: rh, fill: { color: C.mist }, line: { color: C.line }, rectRadius: 0.08 });
    lines.forEach(([le, lk, amt], i) => {
      const y = ry + 0.1 + i * rowH;
      s.addText([
        { text: le, options: { fontFace: F.en, fontSize: 12, color: C.ink, breakLine: true } },
        { text: lk, options: { fontFace: F.kn, fontSize: KN(8), color: C.muted } },
      ], { x: rx + 0.2, y, w: rw - 1.5, h: rowH, valign: 'middle', margin: 0 });
      s.addText(amt, { x: rx + rw - 1.3, y, w: 1.1, h: rowH, fontFace: F.en, fontSize: 13, color: C.ink, align: 'right', valign: 'middle', margin: 0 });
    });
    const ty = ry + 0.16 + lines.length * rowH;
    s.addShape('line', { x: rx + 0.2, y: ty, w: rw - 0.4, h: 0, line: { color: C.muted, width: 0.75 } });
    s.addText([
      { text: 'You pay', options: { fontFace: F.enBold, fontSize: 13, color: C.ink, breakLine: true } },
      { text: 'ಪಾವತಿಸಬೇಕಾದ ಮೊತ್ತ', options: { fontFace: F.kn, fontSize: KN(8), color: C.muted } },
    ], { x: rx + 0.2, y: ty + 0.02, w: rw - 1.5, h: rowH, valign: 'middle', margin: 0 });
    s.addText(rupees(total), { x: rx + rw - 1.3, y: ty + 0.02, w: 1.1, h: rowH, fontFace: F.enBold, fontSize: 17, color: C.brand, align: 'right', valign: 'middle', margin: 0 });

    /* What it does to the reader. */
    const pTop = ry + rh + 0.2;
    const pitch = (bottom - 0.12 - pTop) / points.length;
    points.forEach(([pe, pk], i) => {
      const y = pTop + i * pitch;
      s.addShape('ellipse', { x: x + 0.34, y: y + pitch / 2 - 0.06, w: 0.12, h: 0.12, fill: { color: C.accent }, line: { color: C.accent } });
      s.addText([
        { text: pe, options: { fontFace: F.en, fontSize: 11, color: C.ink, breakLine: true } },
        { text: pk, options: { fontFace: F.kn, fontSize: KN(7.5), color: C.muted } },
      ], { x: x + 0.62, y, w: cw - 0.86, h: pitch, valign: 'middle', margin: 0 });
    });
  };

  option(GUTTER, {
    tag: 'OPTION A', tagFill: C.brand, border: C.line,
    en: 'Shown separately', kn: 'ಪ್ರತ್ಯೇಕವಾಗಿ ತೋರಿಸುವುದು',
    lines: [
      ['Entry fee — Tourism Department', 'ಪ್ರವೇಶ ಶುಲ್ಕ — ಪ್ರವಾಸೋದ್ಯಮ ಇಲಾಖೆ', rupees(dept)],
      ['Service fee (incl. GST)', 'ಸೇವಾ ಶುಲ್ಕ (GST ಸಹಿತ)', rupees(fee)],
    ],
    points: [
      [`Shows the department's ${rupees(dept)} and the service fee as two amounts`, `ಇಲಾಖೆಯ ${rupees(dept)} ಮತ್ತು ಸೇವಾ ಶುಲ್ಕ ಎರಡು ಮೊತ್ತಗಳಾಗಿ`],
      ['Two lines for the visitor to read', 'ಪ್ರವಾಸಿಗರು ಓದಲು ಎರಡು ಸಾಲುಗಳು'],
      ['Same layout as the GST invoice the visitor receives', 'ಪ್ರವಾಸಿಗರು ಪಡೆಯುವ GST ಇನ್‌ವಾಯ್ಸ್‌ನ ರೀತಿಯಲ್ಲೇ'],
    ],
  });

  option(GUTTER + cw + gap, {
    tag: 'OPTION B', tagFill: C.brand, border: C.line,
    en: 'One combined amount', kn: 'ಒಂದೇ ಒಟ್ಟು ಮೊತ್ತ',
    lines: [
      ['Entry fee', 'ಪ್ರವೇಶ ಶುಲ್ಕ', rupees(total)],
    ],
    points: [
      ['One number — the simplest for the visitor to read', 'ಒಂದೇ ಮೊತ್ತ — ಪ್ರವಾಸಿಗರಿಗೆ ಓದಲು ಸರಳ'],
      [`The ${rupees(fee)} service fee is not shown on the booking screen`, `${rupees(fee)} ಸೇವಾ ಶುಲ್ಕ ಬುಕಿಂಗ್ ಪರದೆಯಲ್ಲಿ ಕಾಣುವುದಿಲ್ಲ`],
      [`The GST invoice still lists ${rupees(dept)} + ${rupees(fee)} separately`, `GST ಇನ್‌ವಾಯ್ಸ್‌ನಲ್ಲಿ ${rupees(dept)} + ${rupees(fee)} ಪ್ರತ್ಯೇಕವಾಗಿಯೇ`],
    ],
  });

  /* The point both options share. */
  const by = H - FOOTER_H - 0.66;
  s.addShape('roundRect', { x: GUTTER, y: by, w: W - GUTTER * 2, h: 0.5, fill: { color: C.brand }, line: { color: C.brand }, rectRadius: 0.08 });
  s.addText([
    { text: `Department's decision: Option A or B?  The visitor pays ${rupees(total)} either way`, options: { fontFace: F.enBold, fontSize: 12.5, color: C.white } },
    { text: `   ·   ಇಲಾಖೆಯ ನಿರ್ಧಾರ: ಆಯ್ಕೆ A ಅಥವಾ B? ಪಾವತಿ ಎರಡರಲ್ಲೂ ${rupees(total)}`, options: { fontFace: F.kn, fontSize: KN(9), color: 'CFE5DC' } },
  ], { x: GUTTER + 0.26, y: by, w: W - GUTTER * 2 - 0.52, h: 0.5, valign: 'middle', margin: 0 });
}

/* The main presentation: nothing commercial (user, 2026-09-17). */
const SLIDES = [welcome, agenda, orgProfile, whatWeDo, products, scope, benefits, limitations, journey, staffFlow, architecture, flows,
  roadmap, roadmapMore,
  requirements, goLive,
  closing];

/* A proposal deck: the charge leads, then how it is shown, what the AMC buys,
   and the slides every proposal shares — investment, running costs, exit. */
const proposalSlides = (plan) => [proposalCover, commercial, priceView,
  ...(plan.kind === 'none' ? [] : [amc]),
  costStructure, yearCompare, exitTerms, closing];

/** The cover of a commercial deck — the welcome slide's top and bottom, with no proposal named or numbered. */
function proposalCover(pptx) {
  const s = pptx.addSlide({ masterName: 'COVER' });
  const centre = (w) => (W - w) / 2;
  const line = (text, y, h, opts) => s.addText(text, { x: GUTTER, y, w: W - GUTTER * 2, h, align: 'center', valign: 'middle', margin: 0, ...opts });

  s.addShape('rect', { x: 0, y: 0, w: W, h: 0.1, fill: { color: C.brand }, line: { color: C.brand } });
  const govH = 1.3;
  logo(s, KARNATAKA_LOGO, { x: centre(govH * ratio(KARNATAKA_LOGO)), y: 0.3, h: govH });
  line([
    { text: 'Department of Tourism  ·  Government of Karnataka', options: { fontFace: F.enBold, fontSize: 13, color: C.ink } },
    { text: '     ಪ್ರವಾಸೋದ್ಯಮ ಇಲಾಖೆ  ·  ಕರ್ನಾಟಕ ಸರ್ಕಾರ', options: { fontFace: F.kn, fontSize: KN(13), color: C.muted } },
  ], 1.66, 0.36);
  s.addShape('rect', { x: centre(3.2), y: 2.16, w: 3.2, h: 0.02, fill: { color: C.line }, line: { color: C.line } });

  const pvFile = LOGO('pravesha-1024.png');
  const pvH = 1.0;
  logo(s, pvFile, { x: centre(pvH * ratio(pvFile)), y: 2.45, h: pvH });
  line('Commercial Proposal', 3.75, 0.7, { fontFace: F.enBold, fontSize: 36, color: C.ink });
  line('ವಾಣಿಜ್ಯ ಪ್ರಸ್ತಾವನೆ', 4.45, 0.55, { fontFace: F.kn, fontSize: KN(22), color: C.brand2 });
  s.addShape('rect', { x: centre(1.1), y: 5.12, w: 1.1, h: 0.06, fill: { color: C.sun }, line: { color: C.sun } });
  line('Service fee · Annual maintenance · Costs · Terms', 5.26, 0.4, { fontFace: F.en, fontSize: 16, color: C.muted });

  const labelW = 1.25;
  const markH = 0.72;
  const nameW = 3.05;
  const x0 = centre(labelW + 0.15 + markH + 0.15 + nameW);
  const rowY = 6.2;
  s.addText([
    { text: 'Powered by', options: { fontFace: F.en, fontSize: 12, color: C.muted, breakLine: true } },
    { text: 'ಸಹಯೋಗ', options: { fontFace: F.kn, fontSize: KN(10), color: C.muted } },
  ], { x: x0, y: rowY, w: labelW, h: markH, align: 'right', valign: 'middle', margin: 0 });
  logo(s, SERVERPE_LOGO, { x: x0 + labelW + 0.15, y: rowY, h: markH });
  s.addText([
    { text: 'ServerPe App Solutions', options: { fontFace: F.enBold, fontSize: 17, color: C.ink, breakLine: true } },
    { text: 'Smart Clicks, Smart Taps', options: { fontFace: F.en, fontSize: 11, color: C.muted } },
  ], { x: x0 + labelW + 0.15 + markH + 0.15, y: rowY, w: nameW, h: markH, valign: 'middle', margin: 0 });
}

/* ─────────────────────────────────────────────────────────────── build ── */

/**
 * What the slides quote, read once.
 *
 * The deck's tagline is its own — "& secured" was asked for on the slide — and
 * deliberately not the product_tagline setting, which the website, WhatsApp
 * and the passes also show.
 */
async function context() {
  const settings = require('../src/gatepass/settings');

  /* JPEG proportions, which the PNG header reader cannot give. */
  let photo = null;
  if (fs.existsSync(FOUNDER_PHOTO)) {
    const { loadImage } = require('@napi-rs/canvas');
    const img = await loadImage(FOUNDER_PHOTO);
    photo = { path: FOUNDER_PHOTO, ratio: img.width / img.height };
  }

  const since = await settings.str('business_since', '');
  const [sy, sm] = since.split('-').map(Number);

  return {
    tagline: 'Entry made simple & secured.',
    taglineKn: 'ಪ್ರವೇಶ ಈಗ ಸರಳ ಮತ್ತು ಸುರಕ್ಷಿತ.',
    founderTitle: await settings.str('founder_title', 'Founder and Proprietor'),
    gstin: await settings.str('gstin', ''),
    since: sy && sm ? `${MONTHS[sm - 1]} ${sy}` : '',
    photo,
    /* For the commercial models: today's entry fees in rupees by vehicle type,
       and the rates that come out of every payment. */
    prices: Object.fromEntries((await require('../src/gatepass/db').query(
      `SELECT c.code, p.entry_paise
         FROM place_pricing p
         JOIN vehicle_categories c ON c.id = p.category_id
         JOIN places pl ON pl.id = p.place_id
        WHERE pl.code = 'MULLAYANAGIRI' AND p.is_active`)).rows.map((r) => [r.code, Number(r.entry_paise) / 100])),
    gst: await settings.num('gst_percent_on_platform', 18),
    gateway: await settings.num('gateway_fee_percent', 2.2),
  };
}

/* The founder, as the repository and the invoices already name him. */
const FOUNDER_NAME = 'Shivakumar Kirigeri';
const UDYAM_NUMBER = 'UDYAM-KR-27-0049293';
const FOUNDER_NATIVE = { en: 'Sirsi, Uttara Kannada', kn: 'ಶಿರಸಿ, ಉತ್ತರ ಕನ್ನಡ' };

(async () => {
  const ctx = await context();
  await cleanLogos();
  await require('../src/gatepass/db').pool().end();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const write = async (file, title, slides, deckCtx) => {
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.author = 'ServerPe App Solutions';
    pptx.company = 'ServerPe App Solutions';
    pptx.title = title;
    pptx.subject = 'Confidential. Pravesha™ · ServerPe App Solutions™. Not for circulation.';
    masters(pptx);
    for (const make of slides) make(pptx, deckCtx);
    await pptx.writeFile({ fileName: file });
    await liveDates(file);
    console.log(`  ${String(slides.length).padStart(2)} slides  ${path.relative(ROOT, file)}`);
  };

  console.log('');
  await write(OUT, 'Pravesha — Deputy Commissioner, Chikkamagaluru', SLIDES, ctx);
  for (const plan of PLANS) {
    await write(path.join(OUT_DIR, plan.file), 'Pravesha — Commercial Proposal', proposalSlides(plan), { ...ctx, plan });
  }
  console.log(`\n  footer date is the computer's (${DATE_EN} today)\n`);
})().catch((e) => { console.error(e); process.exit(1); });
