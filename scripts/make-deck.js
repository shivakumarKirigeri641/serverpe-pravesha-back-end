/**
 * scripts/make-deck.js — the presentation for the DC and ADC meeting.
 *
 *   node scripts/make-deck.js [outfile.pptx]
 *
 * KANNADA LEADS. This is shown to officers of the Karnataka government, so
 * every headline carries Kannada first and English beneath. Not a translated
 * deck — a Kannada deck an English reader can also follow.
 *
 * THE ORDER ANSWERS THE QUESTIONS IN THE ORDER THEY ARE ASKED:
 *
 *   who are you  ->  are you registered  ->  what have you delivered  ->
 *   what is wrong today  ->  why the obvious fixes do not work  ->
 *   what you propose  ->  how it works  ->  what it costs  ->  what you earn
 *
 * The money section is deliberately last and deliberately complete. A vendor
 * who volunteers their own margin before being asked is a vendor who has
 * nothing to hide, and the arithmetic is stated in full — including the part
 * where GST is not profit.
 *
 * Every figure is read from the database, so a slide cannot contradict the
 * system being demonstrated beside it.
 *
 * FONTS: PowerPoint renders Kannada with Nirmala UI, which ships with Windows.
 * Named explicitly, because a silent fallback shows empty boxes in front of a
 * Deputy Commissioner.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const PptxGenJS = require('pptxgenjs');
const { query, one } = require('../src/gatepass/db');
const settings = require('../src/gatepass/settings');
const bc = require('../src/gatepass/businessCase');
const REQ = require('../src/gatepass/requirements');
const ROADMAP = require('../src/gatepass/roadmap');

const OUT = process.argv[2] || path.join(process.cwd(), 'docs', 'Entry-ticketing-deck.pptx');
const LOGOS = path.join(__dirname, '..', 'assets', 'logos');

const C = {
  ink: '111C1A', forest: '0F4F48', light: '19A396', pale: 'D8E2DF',
  paper: 'F7F8F6', white: 'FFFFFF', muted: '6B7975', line: 'C2CCC8',
  alarm: 'B91C1C', alarmSoft: 'FDECEC', good: '15803D', goodSoft: 'E7F6EC',
  gold: 'B8860B', goldSoft: 'FBF3E0',
};

const KN = 'Nirmala UI';
const EN = 'Calibri';
const EL = 'Calibri Light';

(async () => {
  const cfg = await settings.all();
  const place = await one(`SELECT * FROM places WHERE code = 'MULLAYANAGIRI'`);
  const pricing = (await query(
    `SELECT pp.*, vc.label, vc.code FROM place_pricing pp
       JOIN vehicle_categories vc ON vc.id = pp.category_id
      WHERE pp.place_id = $1 AND pp.is_active ORDER BY vc.sort_order`, [place.id])).rows;
  const caps = (await query(
    `SELECT sc.capacity, vc.label, vc.code FROM slot_capacity sc
       JOIN vehicle_categories vc ON vc.id = sc.category_id
       JOIN place_slots s ON s.id = sc.slot_id
      WHERE sc.place_id = $1 ORDER BY vc.sort_order, s.sort_order`, [place.id])).rows;

  const byCat = {};
  for (const c of caps) {
    byCat[c.code] = byCat[c.code] || { label: c.label, per_slot: c.capacity, slots: 0 };
    byCat[c.code].slots += 1;
  }
  const perDay = Object.values(byCat).reduce((n, c) => n + c.per_slot * c.slots, 0);

  const carEntry = pricing.find((p) => p.code === 'CAR')?.entry_paise || 10000;
  const carFee = pricing.find((p) => p.code === 'CAR')?.platform_paise || 1000;

  const margin = await bc.perTicket(carEntry, carFee);
  const settle = await bc.compareSettlement(carEntry, carFee);
  const yearly = await bc.annual({ entryPaise: carEntry, platformPaise: carFee,
    vehiclesPerDay: perDay });
  const inv = await bc.investment();
  const models = await bc.revenueModels();
  const amc = await bc.amc();

  /* The tatkal illustration, computed from this site's real car capacity and
     entry fee rather than from a round number chosen to look good. */
  const tatkalEntry = Number(cfg.tatkal_entry_paise || 15000);
  const tatkal = await bc.tatkal({
    capacityPerSlot: byCat.CAR?.per_slot || 400,
    slots: byCat.CAR?.slots || 2,
    entryPaise: carEntry,
    tatkalPaise: tatkalEntry,
    reservePct: Number(cfg.tatkal_reserve_percent || 10),
    peakDays: Number(cfg.tatkal_peak_days || 110),
    feePercent: Number(cfg.platform_fee_percent || 13),
  });

  const rs = (p) => (p % 100 === 0 ? String(p / 100) : (p / 100).toFixed(2));
  const inr = bc.inr;
  const feePct = Number(cfg.platform_fee_percent || 10);
  const gstPct = Number(cfg.gst_percent_on_platform || 18);
  const lakh = (paise) => `Rs. ${inr(Math.round(paise / 100000) / 10)} lakh`;
  const val = (k, f = '[ to be filled ]') => (cfg[k] && String(cfg[k]).trim() ? cfg[k] : f);
  const PRODUCT = cfg.product_name || 'EntryPe';

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = cfg.legal_name || 'ServerPe App Solutions';
  pptx.company = cfg.legal_name || 'ServerPe App Solutions';
  pptx.title = 'ವಾಹನ ಪ್ರವೇಶ ಟಿಕೆಟ್ ವ್ಯವಸ್ಥೆ — Vehicle entry ticketing';

  const emblem = path.join(LOGOS, 'karnataka-tourism-emblem-256.png');
  const deptLogo = path.join(LOGOS, 'karnataka-tourism-768.png');
  const ourLogo = path.join(LOGOS, 'serverpe-256.png');
  const has = (f) => fs.existsSync(f);

  /* ═════════════════════════════════════════════════════════ helpers ══ */

  /**
   * The deck is English-only.
   *
   * The proposal and the MoU are produced in full Kannada as separate
   * documents; the deck is what is spoken over in the room, and a slide
   * carrying both languages ends up with half the space and twice the words.
   *
   * Every Kannada string is still passed by the call sites and simply not
   * drawn, so setting DECK_KANNADA=true restores the bilingual deck without
   * rewriting 47 slides.
   */
  /**
   * DECK_LANG=en   English only (default) — what is presented in the room
   *          kn   Kannada only — the version left with the department
   *          both Kannada and English together
   *
   * The Kannada deck is not a separate file of slides. It is the same 47
   * slides with every English string looked up in one translation map, so a
   * slide added later cannot exist in one language and not the other — it
   * shows up instead as an untranslated string the coverage report names.
   */
  const LANG = (process.env.DECK_LANG || 'en').toLowerCase();
  const KANNADA = LANG === 'both';
  const KN_ONLY = LANG === 'kn';
  /** True whenever Kannada appears at all — bilingual or Kannada-only. */
  const SHOW_KN = KANNADA || KN_ONLY;

  const KN_MAP = KN_ONLY ? require('../src/gatepass/deckKn').KN_MAP : {};
  const misses = new Map();

  /**
   * English in, Kannada out — or the English back, recorded as a gap.
   *
   * Falling back to English rather than throwing is deliberate: a deck that
   * builds with four untranslated captions can still be looked at, and the
   * report at the end says exactly which four. A build that fails on the first
   * missing string would make finishing the translation far slower.
   */
  const tr = (text) => {
    if (!KN_ONLY || typeof text !== 'string') return text;
    const key = text.replace(/\s+/g, ' ').trim();
    if (!key || KN_RE.test(key)) return text;
    // Numbers, money and codes are the same in both languages.
    if (!/[A-Za-z]{2}/.test(key)) return text;
    const hit = KN_MAP[key];
    if (hit) return hit;
    misses.set(key, (misses.get(key) || 0) + 1);
    return text;
  };

  /**
   * A safety net for the Kannada written inline, slide by slide, rather than
   * through the helpers below.
   *
   * Those calls are scattered across the deck and easy to miss one of, and a
   * single stray Kannada line on an otherwise English slide looks like an
   * oversight rather than a choice. So rather than hunting them, addText is
   * wrapped: text that is Kannada is dropped, and a run list has its Kannada
   * runs filtered out.
   */
  const KN_RE = /[ಀ-೿]/;

  /**
   * Take the English out of a mixed string.
   *
   * Lines in this deck are written either as "Kannada\nEnglish" or as
   * "Kannada · English". Dropping the whole string because part of it is
   * Kannada throws away the English with it, which is what left holes on the
   * slides. So: drop whole lines that are Kannada, and within a surviving
   * line drop the Kannada spans and tidy up the separator left behind.
   */
  const stripKannada = (text) => String(text)
    .split('\n')
    .map((line) => line
      .replace(/[ಀ-೿][ಀ-೿\s]*/g, '')       // the Kannada span itself
      .replace(/^[\s·—|,-]+/, '')            // a separator it left in front
      .replace(/[\s·—|,-]+$/, '')            // or behind
      .trim())
    // A line of pure Kannada leaves its punctuation behind — ". , — ." — which
    // then renders as a row of stray marks on the slide. If nothing with
    // letters in it survived, nothing was being said in English here.
    .filter((line) => /[A-Za-z]{2}/.test(line))
    .join('\n')
    .trim();

  /**
   * Every string on its way to the slide passes through here.
   *
   * English deck: Kannada written inline is dropped, so a stray Kannada line
   * cannot survive on an otherwise English slide.
   *
   * Kannada deck: English is translated and the face switched to the Kannada
   * one. Switching the face here rather than at each call site is what makes
   * this work at all — pptxgenjs is given "Calibri" all over the deck, and
   * Calibri has no Kannada glyphs, so translated text in the original face
   * would render as empty boxes.
   */
  /**
   * With no Kannada heading the header block is about a third of an inch
   * shorter, but every call site still places its content where the two-line
   * bilingual header used to push it. The result was a band of dead space
   * under the rule on most slides.
   *
   * Rather than retune the y of every element on 48 slides, content is lifted
   * here. Only the content region moves: the header above 1.7 and the footer
   * below 5.05 stay where they are.
   */
  const LIFT = LANG === 'en';
  const lift = (opts) => {
    if (!LIFT || !opts || typeof opts.y !== 'number') return opts;
    if (opts.y < 1.7 || opts.y > 5.05) return opts;
    // Graduated: content placed lower down was leaving a wider band under the
    // rule, so it comes up further. Everything keeps its relative order.
    const by = opts.y >= 2.2 ? 0.45 : 0.3;
    return { ...opts, y: +(opts.y - by).toFixed(3) };
  };

  const langFilter = (s) => {
    if (KANNADA) return s;
    const original = s.addText.bind(s);

    /* Shapes — card backgrounds, dividers, boxes — move with their text. */
    const originalShape = s.addShape.bind(s);
    s.addShape = (type, opts) => originalShape(type, lift(opts));
    const originalImage = s.addImage.bind(s);
    s.addImage = (opts) => originalImage(lift(opts));

    const fix = (t, opts) => {
      const out = tr(t);
      if (KN_ONLY && KN_RE.test(out)) {
        return [out, { ...opts, fontFace: (opts && opts.bold) ? KN : KN }];
      }
      return [out, opts];
    };

    s.addText = (text, opts) => {
      opts = lift(opts);
      if (typeof text === 'string') {
        // An empty box still occupies its rectangle and still collides with
        // whatever is placed under it.
        if (!String(text).trim()) return s;
        if (KN_ONLY) { const [t, o] = fix(text, opts); return original(t, o); }
        if (KN_RE.test(text)) {
          // Keep the English half rather than dropping the whole string: a
          // line written as "Kannada\nEnglish" still has something to say in
          // an English deck, and deleting it leaves a hole on the slide.
          const kept = stripKannada(text);
          return kept ? original(kept, opts) : s;
        }
        return original(text, opts);
      }
      if (Array.isArray(text)) {
        if (KN_ONLY) {
          const runs = text.map((r) => {
            const out = tr(String(r.text ?? ''));
            return KN_RE.test(out)
              ? { ...r, text: out, options: { ...(r.options || {}), fontFace: KN } }
              : { ...r, text: out };
          });
          return original(runs, opts);
        }
        const kept = text.filter((r) => !KN_RE.test(String(r && r.text) || ''));
        if (!kept.length) return s;
        // A separator left stranded by a dropped run reads as a typo.
        while (kept.length && /^[\s·—-]*$/.test(String(kept[0].text || ''))) kept.shift();
        while (kept.length && /^[\s·—-]*$/.test(String(kept[kept.length - 1].text || ''))) kept.pop();
        if (!kept.length) return s;
        return original(kept, opts);
      }
      return original(text, opts);
    };

    /* Tables carry their own text, and go nowhere near addText. */
    const originalTable = s.addTable.bind(s);
    s.addTable = (rows, opts) => {
      opts = lift(opts);
      if (!KN_ONLY) return originalTable(rows, opts);
      const mapped = rows.map((row) => row.map((cell) => {
        const txt = tr(String(cell && cell.text !== undefined ? cell.text : cell));
        const o = (cell && cell.options) || {};
        return { ...(typeof cell === 'object' ? cell : {}), text: txt,
          options: KN_RE.test(txt) ? { ...o, fontFace: KN } : o };
      }));
      return originalTable(mapped, opts);
    };
    return s;
  };
  const englishOnly = langFilter;

  const slide = (eyeKn, eyeEn, headKn, headEn, { dark = false } = {}) => {
    /* Kannada deck: the Kannada heading becomes THE heading, and the English
       one under it is translated to sit as the subheading. English deck: the
       Kannada is dropped and the English rises into its place. */
    if (LANG === 'en') { eyeKn = null; headKn = null; }
    if (KN_ONLY && !headKn) { headKn = headEn; headEn = null; }
    if (KN_ONLY && !eyeKn) { eyeKn = eyeEn; eyeEn = null; }
    const s = englishOnly(pptx.addSlide());
    s.background = { color: dark ? C.ink : C.paper };

    if (eyeKn || eyeEn) {
      s.addText([
        { text: eyeKn || '', options: { fontFace: KN } },
        { text: eyeKn && eyeEn ? '   ·   ' : '', options: {} },
        { text: (eyeEn || '').toUpperCase(), options: { charSpacing: 1.5 } },
      ], { x: 0.5, y: 0.32, w: 9.1, h: 0.26,
        fontFace: EN, fontSize: 10.5, bold: true, color: dark ? C.light : C.forest });
    }
    if (headKn) {
      s.addText(headKn, { x: 0.5, y: 0.6, w: 9.1, h: 0.56,
        fontFace: KN, fontSize: 25, bold: true, color: dark ? C.white : C.ink });
    }
    if (headEn) {
      s.addText(headEn, { x: 0.5, y: headKn ? 1.14 : 0.66, w: 9.1, h: 0.44,
        fontFace: EL, fontSize: headKn ? 16 : 26, bold: !headKn,
        color: dark ? C.pale : C.muted });
    }
    /* A full-width hairline rather than a short thick bar. The stub read as a
       stray mark floating in the gap above the content; a rule that spans the
       slide reads as the header divider it is meant to be. */
    s.addShape(pptx.ShapeType.rect, { x: 0.5, y: headKn ? 1.62 : 1.24, w: 9.0, h: 0.012,
      fill: { color: dark ? '32403D' : C.line } });
    s.addShape(pptx.ShapeType.rect, { x: 0.5, y: headKn ? 1.6 : 1.22, w: 0.62, h: 0.05,
      fill: { color: dark ? C.light : C.forest } });

    /* The footer carries the firm on the left and the confidentiality marking
       on the right, on every slide including the dark ones. A deck that goes
       round a district office gets forwarded, and a marking that appears only
       on the cover is a marking on the one page nobody keeps. */
    /* Built as one string per side rather than as runs. Assembling it from a
       Kannada run plus an English run left "  ·  CONFIDENTIAL" — separator and
       all — once the Kannada run was filtered out of the English deck. */
    s.addText(cfg.legal_name || 'ServerPe App Solutions', {
      x: 0.5, y: 5.16, w: 5.0, h: 0.24, valign: 'middle',
      fontFace: EN, fontSize: 8, color: dark ? '55635F' : C.muted });
    s.addText(SHOW_KN ? 'ಗೌಪ್ಯ  ·  CONFIDENTIAL' : 'CONFIDENTIAL', {
      x: 5.6, y: 5.16, w: 3.9, h: 0.24, valign: 'middle',
      fontFace: SHOW_KN ? KN : EN, fontSize: 8, bold: true, align: 'right',
      charSpacing: SHOW_KN ? 0 : 1,
      color: dark ? '55635F' : C.muted });
    return s;
  };

  /**
   * The confidentiality marking, for slides built without the slide() helper —
   * the cover, the two section dividers and the contact page. Called
   * separately rather than folded into slide() because those four set their
   * own backgrounds and would otherwise be the only pages in the deck without
   * a marking, which is exactly the wrong four.
   */
  const confidential = (s, dark = false) => {
    s.addText(SHOW_KN ? 'ಗೌಪ್ಯ  ·  CONFIDENTIAL' : 'CONFIDENTIAL', {
      x: 5.6, y: 5.16, w: 3.9, h: 0.24, valign: 'middle',
      fontFace: SHOW_KN ? KN : EN, fontSize: 8, bold: true, align: 'right',
      charSpacing: SHOW_KN ? 0 : 1,
      color: dark ? '55635F' : C.muted });
  };

  /**
   * The bilingual body: Kannada down the left, English down the right, with a
   * hairline between them.
   *
   * Kannada leads because the reader is a Karnataka department. The columns are
   * equal width rather than giving Kannada more room — unequal columns read as
   * one language being the real one and the other a translation, which is the
   * impression this deck exists to avoid.
   *
   * Takes items as [kannada, english] pairs so a line and its translation sit
   * together in the source. They stay on the same baseline in the output, which
   * only works while each pair is roughly the same length — Kannada runs longer
   * for the same meaning, so keep both short rather than trusting them to wrap
   * into alignment.
   */
  const DUO_L = 0.5;          // left column x
  const DUO_R = 5.15;         // right column x
  const DUO_W = 4.35;         // both columns

  const duo = (s, items, { y = 1.95, size = 12, dark = false, gap = 0.1 } = {}) => {
    /* English-only: one full-width column, bulleted. Two columns with one of
       them empty would leave half the slide blank and the text needlessly
       narrow. */
    if (!KANNADA) {
      bullets(s, items.map((it) => (Array.isArray(it) ? it[1] : it.en)),
        { y, size: Math.max(size, 12.5), dark, w: 9 });
      return y;
    }

    // The divider, drawn first so text sits over it rather than under.
    const lastY = y + items.reduce((n, it) => n + (it.h || 0.62) + gap, 0);
    s.addShape(pptx.ShapeType.rect, { x: 4.86, y, w: 0.012,
      h: Math.max(0.4, lastY - y - gap),
      fill: { color: dark ? '2A3634' : C.line } });

    let cy = y;
    for (const it of items) {
      const [k, e] = Array.isArray(it) ? it : [it.kn, it.en];
      const h = (Array.isArray(it) ? null : it.h) || 0.62;
      s.addText(k || '', { x: DUO_L, y: cy, w: DUO_W, h,
        fontFace: KN, fontSize: size, color: dark ? C.white : C.ink,
        lineSpacingMultiple: 1.3, valign: 'top' });
      s.addText(e || '', { x: DUO_R, y: cy, w: DUO_W, h,
        fontFace: EN, fontSize: size, color: dark ? C.pale : C.ink,
        lineSpacingMultiple: 1.25, valign: 'top' });
      cy += h + gap;
    }
    return cy;
  };

  /** Column captions for a duo block. Nothing to caption in an English deck. */
  const duoHead = (s, { y = 1.78, dark = false } = {}) => {
    if (!KANNADA) return;
    s.addText('ಕನ್ನಡ', { x: DUO_L, y, w: DUO_W, h: 0.22,
      fontFace: KN, fontSize: 9, bold: true, color: dark ? C.light : C.forest });
    s.addText('ENGLISH', { x: DUO_R, y, w: DUO_W, h: 0.22,
      fontFace: EN, fontSize: 9, bold: true, charSpacing: 1.2,
      color: dark ? C.light : C.forest });
  };

  const bullets = (s, items, { y = 1.95, size = 12, dark = false, w = 9 } = {}) => {
    const runs = [];
    for (const it of items) {
      const [k, e] = Array.isArray(it) ? it : [null, it];
      if (k) {
        runs.push({ text: k, options: { fontFace: KN, fontSize: size, bold: true,
          color: dark ? C.white : C.ink, bullet: { code: '25AA' }, breakLine: true } });
        runs.push({ text: e, options: { fontFace: EN, fontSize: size - 2,
          color: dark ? C.pale : C.muted, indentLevel: 1, breakLine: true,
          paraSpaceAfter: 8 } });
      } else {
        runs.push({ text: e, options: { fontFace: EN, fontSize: size,
          color: dark ? C.pale : C.ink, bullet: { code: '25AA' },
          breakLine: true, paraSpaceAfter: 7 } });
      }
    }
    s.addText(runs, { x: 0.65, y, w, h: 3.1, lineSpacingMultiple: 1.15 });
  };

  const cards = (s, items, { y = 2.1, h = 2.0 } = {}) => {
    const gap = 0.2;
    const w = (9.0 - gap * (items.length - 1)) / items.length;
    items.forEach((it, i) => {
      const x = 0.5 + i * (w + gap);
      s.addShape(pptx.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.05,
        fill: { color: it.fill || C.white }, line: { color: C.line, width: 0.5 } });
      let top = y + 0.16;
      if (it.big) {
        s.addText(it.big, { x: x + 0.18, y: top, w: w - 0.36, h: 0.55,
          fontFace: EN, fontSize: 24, bold: true, color: it.color || C.forest });
        top += 0.58;
      }
      if (it.kn && KANNADA) {
        s.addText(it.kn, { x: x + 0.18, y: top, w: w - 0.36, h: 0.3,
          fontFace: KN, fontSize: 12.5, bold: true, color: C.ink });
        top += 0.3;
      }
      if (it.title) {
        s.addText(it.title, { x: x + 0.18, y: top, w: w - 0.36, h: 0.28,
          fontFace: EN, fontSize: 11, bold: !it.kn, color: it.kn ? C.muted : C.ink });
        top += 0.28;
      }
      s.addText(it.body, { x: x + 0.18, y: top, w: w - 0.36, h: h - (top - y) - 0.16,
        fontFace: EN, fontSize: 9.5, color: C.muted, lineSpacingMultiple: 1.12 });
    });
  };

  /**
   * Cut a table cell down to its first sentence.
   *
   * The tables are where the deck's word count actually lives, and a cell
   * carrying three sentences of justification is a cell nobody reads on a
   * projector. The full reasoning is in the proposal document and in what the
   * presenter says; the slide only has to carry the claim.
   *
   * Cuts at a sentence end where there is one worth cutting at, and at a word
   * boundary otherwise — never mid-word, which looks like a bug rather than an
   * edit.
   */
  const CELL_MAX = 84;
  const condense = (text) => {
    const t = String(text).replace(/\s+/g, ' ').trim();
    if (t.length <= CELL_MAX) return t;

    const stop = t.search(/[.;](\s|$)/);
    if (stop >= 40 && stop <= CELL_MAX) return t.slice(0, stop + 1);

    const cut = t.lastIndexOf(' ', CELL_MAX - 1);
    return `${t.slice(0, cut > 40 ? cut : CELL_MAX - 1).replace(/[,;:—-]$/, '')}…`;
  };

  const table = (s, head, rows, { y = 2.1, colW, headKn = [], size = 10, rowH = 0.32 } = {}) =>
    s.addTable([
      head.map((h, i) => ({
        text: (headKn[i] && KANNADA ? `${headKn[i]}\n` : '') + h,
        options: { bold: true, color: C.white, fill: { color: C.forest },
          fontSize: size - 1.5, fontFace: (headKn[i] && KANNADA) ? KN : EN, align: 'left' },
      })),
      ...rows.map((r) => r.map((cell, i) => {
        const txt = typeof cell === 'object' ? cell.text : cell;
        const o = typeof cell === 'object' ? cell : {};
        return { text: condense(txt), options: {
          fontSize: size, fontFace: EN, color: o.color || C.ink,
          bold: !!o.bold, fill: o.fill ? { color: o.fill } : undefined,
          align: o.align || (i === 0 ? 'left' : 'right') } };
      })),
    ], { x: 0.5, y, w: 9.0, colW, border: { type: 'solid', color: C.line, pt: 0.5 },
      fill: { color: C.white }, rowH, valign: 'middle', margin: 0.06 });

  /**
   * A left-to-right flow of boxes with arrows between them.
   *
   * Drawn from shapes rather than an image so it stays legible on a projector
   * and can be edited in the room if an officer asks "what happens if…".
   */
  const flow = (s, steps, { y = 2.2, h = 1.0, color = C.forest } = {}) => {
    const arrow = 0.34;
    const w = (9.0 - arrow * (steps.length - 1)) / steps.length;
    steps.forEach((st, i) => {
      const x = 0.5 + i * (w + arrow);
      s.addShape(pptx.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.05,
        fill: { color: st.fill || C.white }, line: { color: st.line || color, width: 1 } });
      if (KANNADA) s.addText(st.kn || '', { x: x + 0.1, y: y + 0.1, w: w - 0.2, h: 0.28,
        fontFace: KN, fontSize: 11, bold: true, color: C.ink, align: 'center' });
      s.addText(st.en, { x: x + 0.1, y: y + ((st.kn && KANNADA) ? 0.4 : 0.22), w: w - 0.2,
        h: h - 0.5,
        fontFace: EN, fontSize: 9, color: C.muted, align: "center",
        lineSpacingMultiple: 1.05 });
      if (i < steps.length - 1) {
        s.addText('➜', { x: x + w, y: y + h / 2 - 0.16, w: arrow, h: 0.32,
          fontFace: EN, fontSize: 15, color, align: 'center' });
      }
    });
  };

  /**
   * The footnote under a slide's content.
   *
   * Clamped so it cannot land on the footer. Call sites pass a y that suits the
   * content above them, and a slide whose table grew by a row would otherwise
   * push its footnote under the confidentiality line — where it is still in the
   * file, still valid XML, and completely invisible.
   */
  const FOOTER_TOP = 4.88;
  const note = (s, knText, enText, { y = 4.5 } = {}) => {
    const knH = (knText && SHOW_KN) ? 0.28 : 0;
    const enH = enText ? 0.42 : 0;
    const top = Math.min(y, FOOTER_TOP - knH - enH);

    if (knText && SHOW_KN) s.addText(knText, { x: 0.5, y: top, w: 9.0, h: 0.3,
      fontFace: KN, fontSize: 11.5, bold: true, color: C.forest });
    if (enText) s.addText(enText, { x: 0.5, y: top + knH, w: 9.0, h: enH,
      fontFace: EN, fontSize: 10, color: C.muted });
  };

  /**
   * The rate disclaimer, in small print at the foot of any slide quoting money.
   *
   * Every figure on those slides depends on rates a third party quoted and has
   * not yet contracted. Saying so once per slide, in type small enough not to
   * distract, is what separates an illustration from a promise — and it is the
   * line that protects the proposal if Razorpay's terms move.
   */
  const rateNote = (s, { y = 4.90 } = {}) => {
    s.addText('Illustrative calculation based on Razorpay commercial rates communicated for this '
            + `proposal: ${settle.direct.gateway_percent}% payment gateway fee + `
            + `${settle.direct.gst_percent}% GST on the gateway fee, and `
            + `${settle.split.transfer_percent}% Route transfer fee + ${settle.split.gst_percent}% `
            + 'GST on the transfer fee, applied on the full transaction value — the dearest of the '
            + 'possible bases, so the figures shown can only improve once confirmed. Final charges '
            + 'and settlement structure subject to the Razorpay agreement and applicable taxes.', {
      x: 0.5, y, w: 9.0, h: 0.24, fontFace: EN, fontSize: 6.5, italic: true, color: '9AA6A2',
      lineSpacingMultiple: 1.05 });
  };

  /* ═══════════════════════════════════════════════════ 1 · title ══════ */
  {
    const s = englishOnly(pptx.addSlide());
    s.background = { color: C.ink };
    confidential(s, true);
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.12, h: 5.63, fill: { color: C.light } });
    /* sizing:'contain' rather than a fixed w/h: the emblem is not the shape of
       the box it was being drawn into, and forcing it stretched the artwork. */
    if (has(deptLogo)) {
      s.addImage({ path: deptLogo, x: 0.72, y: 0.52,
        sizing: { type: 'contain', w: 2.4, h: 1.05 } });
    }

    if (KN_ONLY || KANNADA) {
      s.addText('ಕರ್ನಾಟಕ ಪ್ರವಾಸೋದ್ಯಮ ಇಲಾಖೆ  ·  ಚಿಕ್ಕಮಗಳೂರು', {
        x: 0.72, y: 1.86, w: 8.5, h: 0.3,
        fontFace: KN, fontSize: 12.5, bold: true, color: C.light });
      s.addText('ವಾಹನ ಪ್ರವೇಶ ಟಿಕೆಟ್ ವ್ಯವಸ್ಥೆ', {
        x: 0.72, y: 2.2, w: 8.5, h: 0.66,
        fontFace: KN, fontSize: 33, bold: true, color: C.white });
      s.addText(`${PRODUCT}  ·  ${place.name}`, {
        x: 0.72, y: 2.92, w: 8.5, h: 0.4, fontFace: EL, fontSize: 18, color: C.pale });
      s.addText('ತಿದ್ದಲಾಗದ, ನಕಲಿಸಲಾಗದ ಡಿಜಿಟಲ್ ಸಹಿಯ ಟಿಕೆಟ್', {
        x: 0.72, y: 3.46, w: 7.6, h: 0.4, fontFace: KN, fontSize: 12.5,
        color: '9EB2AE', lineSpacingMultiple: 1.3 });
    } else {
      /* The English cover, set out explicitly. It used to be the Kannada cover
         with the Kannada removed, which left it with no title at all. */
      s.addText('KARNATAKA TOURISM DEPARTMENT  ·  CHIKKAMAGALURU', {
        x: 0.72, y: 1.86, w: 8.5, h: 0.3,
        fontFace: EN, fontSize: 11, bold: true, charSpacing: 1.2, color: C.light });
      s.addText('Vehicle entry ticketing', {
        x: 0.72, y: 2.18, w: 8.5, h: 0.7,
        fontFace: EN, fontSize: 34, bold: true, color: C.white });
      s.addText(`${PRODUCT}  ·  ${place.name}`, {
        x: 0.72, y: 2.96, w: 8.5, h: 0.4, fontFace: EL, fontSize: 18, color: C.pale });
      s.addText('A ticket the checkpost verifies, instead of one it merely reads.', {
        x: 0.72, y: 3.5, w: 7.6, h: 0.4, fontFace: EL, fontSize: 13.5, color: '9EB2AE' });
    }

    if (has(ourLogo)) {
      s.addImage({ path: ourLogo, x: 0.72, y: 4.58,
        sizing: { type: 'contain', w: 0.4, h: 0.4 } });
    }
    s.addText(`${cfg.legal_name}   ·   ${cfg.vendor_tagline}   ·   `
            + new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }), {
      x: 1.24, y: 4.64, w: 7.6, h: 0.28, fontFace: EN, fontSize: 10, color: '8FA3A0',
      valign: 'middle' });
  }

  /* ═══════════════════════════════════════ 2 · who is presenting ══════ */
  {
    const s = slide('ಪರಿಚಯ', 'Introduction', val('proprietor_name'),
      `${val('founder_title', 'Founder and Proprietor')}, ${cfg.legal_name}`);

    s.addText(val('founder_bio',
      '[ Two or three sentences on your background and experience — years in software, '
      + 'the kind of systems you have built, and why this problem interests you. ]'), {
      x: 0.5, y: 2.0, w: 6.0, h: 1.5, fontFace: EN, fontSize: 13.5,
      color: cfg.founder_bio ? C.ink : C.alarm, lineSpacingMultiple: 1.3 });

    cards(s, [
      { kn: 'ಅನುಭವ', title: 'Experience',
        body: val('founder_years', '[ years ]') + (cfg.founder_years ? ' years in software' : '') },
      { kn: 'ನಿರ್ಮಿಸಿದ್ದು', title: 'Built and running',
        body: `${cfg.first_product_name || 'QuizPe'}, live since ${val('first_product_since')}. `
            + `${cfg.product_name || 'EntryPe'}, built and working.` },
      { kn: 'ನೇರ ಜವಾಬ್ದಾರಿ', title: 'Directly answerable',
        body: 'The person who writes the software is the person the department calls.' },
    ], { y: 3.6, h: 1.3 });
  }

  /* ═════════════════════════════════ 3 · the firm and its papers ══════ */
  {
    const s = slide('ಸಂಸ್ಥೆ', 'The firm', cfg.legal_name,
      'Registered, filing, and answerable to the department directly.');

    table(s, ['Registration', 'Number'], [
      ['Constitution', { text: cfg.legal_form || 'Sole Proprietorship', align: 'left' }],
      ['Proprietor', { text: val('proprietor_name'), align: 'left' }],
      ['GSTIN', { text: val('gstin'), align: 'left', bold: true }],
      ['Udyam (MSME)', { text: val('udyam_number'), align: 'left', bold: true }],
      ['Operating since', { text: longDate(val('business_since')), align: 'left' }],
      ['Place of business', { text: val('business_address'), align: 'left' }],
    ], { y: 2.0, colW: [2.6, 6.4], size: 11, rowH: 0.36,
      headKn: ['ನೋಂದಣಿ', 'ಸಂಖ್ಯೆ'] });

    note(s, 'ಎಲ್ಲಾ ದಾಖಲೆಗಳು ಲಭ್ಯ — ಜಿಎಸ್‌ಟಿ, ಉದ್ಯಮ್, ಪ್ಯಾನ್.',
      'Certificates available on request. GST returns filed regularly; the department can be '
      + 'invoiced in the ordinary way.', { y: 4.5 });
  }

  /* ══════════════════════ 4 · proprietorship against a company ════════ */
  {
    const s = slide('ಏಕೆ ಏಕ ವ್ಯಕ್ತಿ ಸಂಸ್ಥೆ', 'Why a proprietorship',
      'ಒಬ್ಬರೇ ಜವಾಬ್ದಾರರು — ಉದ್ದೇಶಪೂರ್ವಕ ಆಯ್ಕೆ',
      'A deliberate choice, not a limitation.');

    table(s, ['', 'Sole proprietorship (us)', 'Private limited company'], [
      ['Who answers you', { text: 'The proprietor, by name', align: 'left', bold: true },
        { text: 'An account manager, then a queue', align: 'left' }],
      ['A change you ask for', { text: 'Same week', align: 'left', bold: true },
        { text: 'A sprint, a release cycle, a committee', align: 'left' }],
      ['Overheads you pay for', { text: 'Home office; almost none', align: 'left', bold: true },
        { text: 'Offices, sales, layers of staff', align: 'left' }],
      ['Cost to the department', { text: `AMC Rs. ${inr(amc.proposed)}/gate`, align: 'left', bold: true },
        { text: 'Typically several lakh, plus licences', align: 'left' }],
      ['Liability', { text: 'Unlimited — personally at stake', align: 'left', color: C.alarm },
        { text: 'Limited to the company', align: 'left' }],
      ['If the person is unavailable', { text: 'A real risk, and named as one', align: 'left', color: C.alarm },
        { text: 'Covered by a team', align: 'left' }],
    ], { y: 1.95, colW: [2.3, 3.5, 3.2], size: 10.5, rowH: 0.35,
      headKn: ['', 'ಏಕ ವ್ಯಕ್ತಿ ಸಂಸ್ಥೆ', 'ಖಾಸಗಿ ಕಂಪನಿ'] });

    note(s, 'ಅನಾನುಕೂಲಗಳನ್ನೂ ಸ್ಪಷ್ಟವಾಗಿ ಹೇಳಲಾಗಿದೆ.',
      'The last two rows are the honest disadvantages. Both are answered by escrowed source and a '
      + 'documented handover.', { y: 4.42 });
  }

  /* ═════════════════════════════════ 5 · the products, as a picture ═══ */
  {
    const s = slide('ನಮ್ಮ ಉತ್ಪನ್ನಗಳು', 'What we have built',
      'ಒಂದೇ ಅಡಿಪಾಯ, ಮೂರು ಉತ್ಪನ್ನಗಳು',
      'One foundation, three products — two already earning, the third proposed here.');

    /* The shared platform underneath */
    s.addShape(pptx.ShapeType.roundRect, { x: 0.5, y: 3.62, w: 9.0, h: 0.82,
      rectRadius: 0.05, fill: { color: C.forest } });
    s.addText('ಸಾಮಾನ್ಯ ಅಡಿಪಾಯ  ·  SHARED PLATFORM', {
      x: 0.6, y: 3.7, w: 8.8, h: 0.26, fontFace: KN, fontSize: 11, bold: true, color: C.light });
    s.addText('WhatsApp Business API   ·   Razorpay payments   ·   GST invoicing   ·   '
            + 'PostgreSQL   ·   Reporting   ·   Admin panel', {
      x: 0.6, y: 3.98, w: 8.8, h: 0.34, fontFace: EN, fontSize: 11, color: C.white });

    const box = (x, w, kn, title, lines, tone) => {
      s.addShape(pptx.ShapeType.roundRect, { x, y: 1.95, w, h: 1.5, rectRadius: 0.05,
        fill: { color: C.white }, line: { color: tone, width: 1.5 } });
      s.addText(kn, { x: x + 0.15, y: 2.06, w: w - 0.3, h: 0.28,
        fontFace: KN, fontSize: 13, bold: true, color: C.ink });
      s.addText(title, { x: x + 0.15, y: 2.34, w: w - 0.3, h: 0.28,
        fontFace: EN, fontSize: 15, bold: true, color: tone });
      s.addText(lines, { x: x + 0.15, y: 2.64, w: w - 0.3, h: 0.72,
        fontFace: EN, fontSize: 10.5, color: C.muted, lineSpacingMultiple: 1.1 });
      // the leg down to the platform
      s.addText('▼', { x: x + w / 2 - 0.15, y: 3.4, w: 0.3, h: 0.22,
        fontFace: EN, fontSize: 11, color: tone, align: 'center' });
    };

    box(0.5, 4.4, 'ಕ್ವಿಜ್‌ಪೇ', `${cfg.first_product_name || 'QuizPe'} — live across India`,
      'Daily learning quizzes for school children, entirely on WhatsApp.\n'
      + `Live since ${val('first_product_since')}. Real parents, real payments, every day.`,
      C.good);

    box(5.1, 4.4, 'ಎಂಟ್ರಿಪೇ', `${cfg.product_name || 'EntryPe'} — built`,
      'Signed QR entry tickets for ticketed tourist sites.\n'
      + 'Built on what QuizPe proved, and on feedback from this exact problem.',
      C.gold);

    note(s, null, 'The second product exists because the first proved that a WhatsApp-only '
      + 'service, with payments and invoices, works at scale in India.', { y: 4.62 });
  }

  /* ═════════════════════════════ 6 · the problem at the gate today ════ */
  {
    const s = slide('ಇಂದಿನ ಸಮಸ್ಯೆ', 'The problem today',
      'ಮುಳ್ಳಯ್ಯನಗಿರಿ ಟಿಕೆಟ್ ಬುಕಿಂಗ್‌ನಲ್ಲಿ ಏನಾಗುತ್ತಿದೆ',
      'What is happening with entry tickets today.', { dark: true });

    duoHead(s, { y: 1.8, dark: true });
    duo(s, [
      ['ಒಂದು ಟಿಕೆಟ್ ಖರೀದಿಸಿ, ಅದರ ಕಡತವನ್ನು ತಿದ್ದಲಾಗುತ್ತದೆ — ವಾಹನ ಸಂಖ್ಯೆ, ದಿನಾಂಕ, ಟಿಕೆಟ್ '
       + 'ಸಂಖ್ಯೆ — ಮತ್ತು ಬೇಕಾದಷ್ಟು ಬಾರಿ ಮತ್ತೆ ಮುದ್ರಿಸಲಾಗುತ್ತದೆ.',
       'One ticket is bought, the file is edited — vehicle number, date, ticket number — and '
       + 'printed again as many times as wanted.'],
      ['ಗೇಟ್‌ನಲ್ಲಿ ಪ್ರತಿಯೊಂದು ನಕಲೂ ಮೂಲ ಟಿಕೆಟ್‌ನಷ್ಟೇ ನಿಜವಾಗಿ ಕಾಣುತ್ತದೆ.',
       'At the barrier every copy looks exactly as genuine as the original.'],
      ['ತಿದ್ದಿದ ಟಿಕೆಟ್ ಒಳಗೆ ಹೋದದ್ದನ್ನು ಯಾವುದೂ ದಾಖಲಿಸುವುದಿಲ್ಲ. ಆದ್ದರಿಂದ ನಷ್ಟ ಎಷ್ಟು ಎಂದು '
       + 'ಅಳೆಯಲಾಗದು — ಅಳೆಯಲಾಗದ ಕಾರಣ ಅದರ ಬಗ್ಗೆ ವಾದಿಸಲೂ ಆಗದು.',
       'Nothing records an altered ticket passing, so the size of the loss cannot be measured — '
       + 'which also means it cannot be argued about.'],
      ['ವಾಟ್ಸ್ಆ್ಯಪ್‌ನಲ್ಲಿ ಫಾರ್ವರ್ಡ್ ಆದ ಸ್ಕ್ರೀನ್‌ಶಾಟ್, ಕೇವಲ ನೋಡಿ ಬಿಡುವ ಗೇಟ್‌ನಲ್ಲಿ ಮೂಲ '
       + 'ಟಿಕೆಟ್‌ನಷ್ಟೇ ಚೆನ್ನಾಗಿ ಕೆಲಸ ಮಾಡುತ್ತದೆ.',
       'A screenshot forwarded on WhatsApp works as well as the original at a gate that only '
       + 'looks at it.'],
    ], { y: 2.04, size: 11.5, dark: true, gap: 0.12 });
  }

  /* ═══════════════════════ 7 · what the staff are put through ═════════ */
  {
    const s = slide('ಚೆಕ್‌ಪೋಸ್ಟ್ ಸಿಬ್ಬಂದಿ', 'The checkpost staff',
      'ಸಿಬ್ಬಂದಿಗೆ ಅಸಾಧ್ಯವಾದ ಕೆಲಸ ಕೊಡಲಾಗಿದೆ',
      'The staff are being asked to do something a person cannot do.');

    cards(s, [
      { kn: 'ಕಣ್ಣಿನಿಂದ ಪರಿಶೀಲನೆ', title: 'Detect forgery by eye',
        body: 'On a document they have never seen before, at speed, with a queue of cars behind.',
        fill: C.alarmSoft },
      { kn: 'ವಾದ ಮತ್ತು ಒತ್ತಡ', title: 'Arguments at the barrier',
        body: 'Refusing a ticket means an argument, in front of a queue, with no evidence to '
            + 'point at. Most people wave it through — and would.', fill: C.alarmSoft },
      { kn: 'ಯಾವುದೇ ದಾಖಲೆ ಇಲ್ಲ', title: 'No record either way',
        body: 'Nothing shows what was checked, by whom, or what was refused. The staff member '
            + 'has no way to show they did their job.', fill: C.alarmSoft },
    ], { y: 2.05, h: 1.85 });

    note(s, 'ಇದು ಸಿಬ್ಬಂದಿಯ ತಪ್ಪಲ್ಲ — ವ್ಯವಸ್ಥೆಯ ತಪ್ಪು.',
      'This is not a failure of the staff. It is a failure of the ticket, and the staff are the '
      + 'ones left holding it.', { y: 4.18 });
  }

  /* ═════════════════════ 8 · why web booking alone does not fix it ════ */
  {
    const s = slide('ವೆಬ್ ಬುಕಿಂಗ್', 'Web-based booking',
      'ಆನ್‌ಲೈನ್ ಬುಕಿಂಗ್ ಮಾತ್ರದಿಂದ ಸಮಸ್ಯೆ ಪರಿಹಾರವಾಗದು',
      'Booking online does not fix a ticket that is still only read.');

    bullets(s, [
      ['ಟಿಕೆಟ್ ಇನ್ನೂ ಒಂದು ಫೈಲ್.',
       'A PDF or a printed page is a file. Anything that can be opened can be edited.'],
      ['ವಾಹನ ಸಂಖ್ಯೆ ಟಿಕೆಟ್‌ಗೆ ಬಂಧಿಸಲ್ಪಟ್ಟಿಲ್ಲ.',
       'The vehicle number is printed on the ticket, not bound to it. Nothing stops the same '
       + 'ticket being used by another vehicle.'],
      ['ಒಂದೇ ಬಾರಿ ಬಳಕೆ ಎಂದು ಖಚಿತಪಡಿಸಲಾಗದು.',
       'Nothing marks a ticket as used, so one booking can enter five times.'],
      ['ಗೇಟ್‌ನಲ್ಲಿ ಪರಿಶೀಲಿಸಲು ನೆಟ್‌ವರ್ಕ್ ಬೇಕು.',
       'Any check against the website needs a network connection the ghat road does not reliably have.'],
      ['ಸ್ಕ್ರೀನ್‌ಶಾಟ್ ಫಾರ್ವರ್ಡ್ ಮಾಡಬಹುದು.',
       'A screenshot is as good as the original, and travels for free.'],
    ], { y: 1.95, size: 12.5 });
  }

  /* ══════════════ 9 · the bank-QR question, answered head on ══════════ */
  {
    const s = slide('ಒಂದು ಪ್ರಶ್ನೆ', 'A fair question',
      'ಬ್ಯಾಂಕ್ ಟಿಕೆಟ್‌ನಲ್ಲಿ QR ಕೋಡ್ ಹಾಕಿದರೆ ಸಾಕಲ್ಲವೇ?',
      'What if the bank simply prints a QR code at the bottom of the ticket?');

    s.addText('ಪಾವತಿ QR ಪಾವತಿಯನ್ನು ಸಾಬೀತುಪಡಿಸುತ್ತದೆ — ಪ್ರವೇಶದ ಹಕ್ಕನ್ನಲ್ಲ.', {
      x: 0.5, y: 1.9, w: 9.0, h: 0.34, fontFace: KN, fontSize: 15, bold: true, color: C.ink });
    s.addText('A payment QR proves that money moved. It does not prove that THIS vehicle may '
            + 'enter on THIS day.', {
      x: 0.5, y: 2.2, w: 9.0, h: 0.34, fontFace: EN, fontSize: 12.5, color: C.muted });

    table(s, ['A payment QR on the ticket', 'A signed entry ticket'], [
      [{ text: 'Says a payment reference exists', align: 'left' },
       { text: 'Says this vehicle, this date, this slot', align: 'left', bold: true }],
      [{ text: 'Static — copies as easily as the rest of the page', align: 'left' },
       { text: 'Sealed by a signature; one edited character fails', align: 'left', bold: true }],
      [{ text: 'Needs a network call to the bank to mean anything', align: 'left' },
       { text: 'Verified on the phone with no signal at all', align: 'left', bold: true }],
      [{ text: 'A payment reference stays valid forever', align: 'left' },
       { text: 'Consumed on first scan; a second attempt is reported', align: 'left', bold: true }],
      [{ text: 'Carries no plate, so it cannot be matched to a vehicle', align: 'left' },
       { text: 'The plate is inside the signature', align: 'left', bold: true }],
    ], { y: 2.62, colW: [4.5, 4.5], size: 10.5, rowH: 0.36,
      headKn: ['ಪಾವತಿ QR', 'ಸಹಿ ಮಾಡಿದ ಟಿಕೆಟ್'] });

    note(s, 'ಎರಡೂ ಜೊತೆಯಾಗಿ ಇರಬಹುದು.',
      'Not alternatives. A bank QR can sit alongside the signed one — the signature is what the '
      + 'gate checks, the payment reference what the accounts check.', { y: 4.66 });
  }

  /* ═══════ 9b · "just put a QR on the ticket we already print" ════════ */
  {
    const s = slide('ಇನ್ನೊಂದು ಪ್ರಶ್ನೆ', 'The harder question',
      'ನಮ್ಮಲ್ಲಿ ಈಗಾಗಲೇ ಟಿಕೆಟ್ ಇದೆ. ಅದರ ಮೇಲೆ QR ಹಾಕಿದರೆ ಸಾಕಲ್ಲವೇ?',
      '"We already have tickets. Just put a QR code on them. Why do we need your platform?"');

    duoHead(s, { y: 1.82 });
    duo(s, [
      ['QR ಎಂಬುದು ಬರೆಯುವ ವಿಧಾನ, ಪರಿಶೀಲಿಸುವ ವಿಧಾನವಲ್ಲ. ಇಂದಿನ ಟಿಕೆಟ್ ಮೇಲೆ QR ಹಾಕಿದರೆ ಅದು '
       + 'ಯಂತ್ರಕ್ಕೆ ಓದಬಲ್ಲದಾಗುತ್ತದೆ — ಪರಿಶೀಲಿಸಬಲ್ಲದಾಗುವುದಿಲ್ಲ.',
       'A QR code is a way of writing, not a way of checking. Printing one on today\'s ticket '
       + 'makes it machine-readable. It does not make it verifiable.'],
      ['ಜೆರಾಕ್ಸ್ ಮಾಡಿದ QR ಮೂಲದಷ್ಟೇ ಸರಿಯಾಗಿ ಸ್ಕ್ಯಾನ್ ಆಗುತ್ತದೆ. ತಿದ್ದುವುದನ್ನು ತಡೆಯಲು ಸಹಿ ಬೇಕು.',
       'A photocopied QR scans exactly as well as the original. Stopping alteration needs a '
       + 'digital signature, which needs a key that signs and a system that holds it.'],
      ['ಒಂದೇ ಟಿಕೆಟ್ ಎರಡು ಬಾರಿ ಬಳಸುವುದನ್ನು ತಡೆಯಲು, ಯಾವುದು ಈಗಾಗಲೇ ಬಳಕೆಯಾಗಿದೆ ಎಂಬ ದಾಖಲೆ ಬೇಕು. '
       + 'ಆ ದಾಖಲೆಯೇ ವ್ಯವಸ್ಥೆ — ಅದು ಸ್ಟಿಕ್ಕರ್ ಅಲ್ಲ.',
       'And stopping the same ticket being used twice needs a record of what has already been '
       + 'used. That record IS the platform. It cannot be printed onto paper.'],
      ['ಆ ವ್ಯವಸ್ಥೆ ಬಂದ ಮೇಲೆ ಉಳಿದೆಲ್ಲವೂ ಸಹಜವಾಗಿ ಬರುತ್ತದೆ — ಇಲ್ಲದಿದ್ದರೆ ಇಲಾಖೆಯೇ ಅದನ್ನು '
       + 'ಕಟ್ಟಬೇಕಾಗುತ್ತದೆ.',
       'Once that system exists, everything in the next slide follows from it. Without us, the '
       + 'department would be building and staffing that software itself.'],
    ], { y: 2.06, size: 11.5, gap: 0.12 });

    note(s, 'QR ಭದ್ರತೆಯಲ್ಲ. ಸಹಿ ಮತ್ತು ದಾಖಲೆ ಭದ್ರತೆ.',
      'The QR is not the security. The signature and the record of use are.', { y: 4.74 });
  }

  /* ═══════ 9c · the same question, answered as a capability list ══════ */
  {
    const s = slide('ಹೋಲಿಕೆ', 'Side by side',
      'ಟಿಕೆಟ್ + QR ಮಾತ್ರ  ·  ಸಂಪೂರ್ಣ ವ್ಯವಸ್ಥೆ',
      'What a QR on the existing ticket gives, and what the platform gives.');

    /* Marked as built or planned deliberately. A comparison table that lists
       things we cannot demonstrate is the fastest way to lose the room when an
       officer says "show me". */
    const YES = { text: '✓', bold: true, color: C.good, align: 'center' };
    const NO = { text: '—', color: C.muted, align: 'center' };
    const SOON = { text: '○', bold: true, color: C.gold, align: 'center' };

    /* Split across two slides. A slide cannot scroll, and sixteen rows plus a
       footnote runs off the bottom edge where nobody will ever see them. */
    const row = (label, mark) => [{ text: label, align: 'left' }, NO, mark];

    table(s, ['', 'Ticket + QR', 'Platform'], [
      row('Verifies the ticket is genuine — by signature, offline', YES),
      row('Booking on WhatsApp, before travelling', YES),
      row('Real-time slot inventory and live capacity control', YES),
      row('One-time validation — a second use refused and recorded', YES),
      row('Duplicate and forwarded-screenshot tickets caught', YES),
      row('Bulk booking controlled — one vehicle, one ticket, one day', YES),
      row('Slot management across the two daily slots', YES),
      row('One-time postponement, the old code self-invalidating', YES),
    ], { y: 2.62, colW: [6.0, 1.5, 1.5], size: 10, rowH: 0.29,
      headKn: ['', 'ಟಿಕೆಟ್ + QR', 'ವ್ಯವಸ್ಥೆ'] });

    note(s, null, 'Continued on the next slide.', { y: 5.05 });
  }

  /* ═══════ 9d · the comparison, continued ═════════════════════════════ */
  {
    const s = slide('ಹೋಲಿಕೆ', 'Side by side',
      'ಟಿಕೆಟ್ + QR ಮಾತ್ರ  ·  ಸಂಪೂರ್ಣ ವ್ಯವಸ್ಥೆ',
      'What a QR on the existing ticket gives, and what the platform gives.');

    const YES = { text: '✓', bold: true, color: C.good, align: 'center' };
    const NO = { text: '—', color: C.muted, align: 'center' };
    const SOON = { text: '○', bold: true, color: C.gold, align: 'center' };
    const row = (label, mark) => [{ text: label, align: 'left' }, NO, mark];

    table(s, ['', 'Ticket + QR', 'Platform'], [
      row('Automatic payment and daily reconciliation', YES),
      row('Live dashboard for the DC and the manager', YES),
      row('Crowd and demand analytics', YES),
      row('Suspicious-booking and refusal detection', YES),
      row('Split settlement — entry fee direct to the department', SOON),
      row('Vehicle-number change, once, with an audit trail', SOON),
      row('Cancellation releasing the place, and a waitlist', SOON),
      row('Tatkal and peak-day pricing, if the department approves', SOON),
    ], { y: 2.0, colW: [6.0, 1.5, 1.5], size: 10, rowH: 0.29,
      headKn: ['', 'ಟಿಕೆಟ್ + QR', 'ವ್ಯವಸ್ಥೆ'] });

    note(s, '✓ ಇಂದು ಕೆಲಸ ಮಾಡುತ್ತಿದೆ   ·   ○ ಅನುಮೋದನೆಯ ನಂತರ',
      '✓ working today   ·   ○ built after approval. Marked, because a list that cannot survive '
      + '"show me" is worth less than a shorter honest one.', { y: 4.5 });
  }

  /* ═══════════════════════════ 10 · what WhatsApp booking gives ═══════ */
  {
    const s = slide('ಪರಿಹಾರ', 'The proposal',
      'ವಾಟ್ಸ್ಆ್ಯಪ್ ಆಧಾರಿತ ಬುಕಿಂಗ್ — ಏಕೆ',
      'Why a WhatsApp bot, and not another website.', { dark: true });

    bullets(s, [
      ['ಆ್ಯಪ್ ಇಲ್ಲ, ಖಾತೆ ಇಲ್ಲ, ಪಾಸ್‌ವರ್ಡ್ ಇಲ್ಲ.',
       'Nothing to install and nothing to remember. WhatsApp is already on the phone of '
       + 'everyone who visits.'],
      ['ಟಿಕೆಟ್ ಚಾಟ್‌ನಲ್ಲೇ ಉಳಿಯುತ್ತದೆ.',
       'The ticket lives in the chat. It cannot be lost in a downloads folder, and it can be '
       + 'fetched again with one tap.'],
      ['ಮೊಬೈಲ್ ಸಂಖ್ಯೆ ಈಗಾಗಲೇ ದೃಢೀಕೃತ.',
       'WhatsApp has already verified the number, so there is no OTP, no signup and no forgotten '
       + 'password.'],
      ['ಕನ್ನಡ ಮತ್ತು ಇಂಗ್ಲಿಷ್ ಎರಡರಲ್ಲೂ.',
       'Every message is in Kannada with English beneath it.'],
      ['ರದ್ದತಿ, ಮರುಪಾವತಿ, ದಿನಾಂಕ ಬದಲಾವಣೆ — ಎಲ್ಲವೂ ಅದೇ ಚಾಟ್‌ನಲ್ಲಿ.',
       'Closures, postponements, refunds and support all happen in the same conversation, so the '
       + 'department does not field the phone calls.'],
    ], { y: 1.95, size: 12.5, dark: true });
  }

  /* ══════════════════════ 10b · against what is in place today ═══════ */
  {
    const s = slide('ಹೋಲಿಕೆ', 'Side by side',
      'ಇಂದಿನ ವ್ಯವಸ್ಥೆ ಮತ್ತು ಪ್ರಸ್ತಾವಿತ ವ್ಯವಸ್ಥೆ',
      'What changes, and what deliberately does not.');

    table(s, ['', 'Booking on a web page today', 'This proposal'], [
      [{ text: 'Entry fee to the department', align: 'left' },
       { text: 'Full amount, nothing deducted', align: 'left' },
       { text: 'Full amount, nothing deducted — unchanged', align: 'left', color: C.muted }],

      [{ text: 'Can the ticket be edited', align: 'left' },
       { text: 'Yes — it is a file', align: 'left', color: C.alarm },
       { text: 'No — sealed by a digital signature', align: 'left', bold: true, fill: C.goodSoft }],

      [{ text: 'Is it tied to the vehicle', align: 'left' },
       { text: 'Printed on it, not bound to it', align: 'left', color: C.alarm },
       { text: 'Plate is inside the signature', align: 'left', bold: true, fill: C.goodSoft }],

      [{ text: 'Can one ticket enter twice', align: 'left' },
       { text: 'Yes — nothing marks it used', align: 'left', color: C.alarm },
       { text: 'Consumed on first scan', align: 'left', bold: true, fill: C.goodSoft }],

      [{ text: 'Checking at the gate', align: 'left' },
       { text: 'Read by eye', align: 'left', color: C.alarm },
       { text: 'Verified by the phone, offline', align: 'left', bold: true, fill: C.goodSoft }],

      [{ text: 'Record of what was refused', align: 'left' },
       { text: 'None', align: 'left', color: C.alarm },
       { text: 'Every scan, with the staff member', align: 'left', bold: true, fill: C.goodSoft }],
    ], { y: 1.95, colW: [2.4, 3.2, 3.4], size: 10, rowH: 0.42,
      headKn: ['', 'ಇಂದಿನ ವ್ಯವಸ್ಥೆ', 'ಪ್ರಸ್ತಾವಿತ ವ್ಯವಸ್ಥೆ'] });

    note(s, 'ಹಣದ ವಿಷಯದಲ್ಲಿ ಬದಲಾವಣೆ ಇಲ್ಲ — ಬದಲಾವಣೆ ಗೇಟ್‌ನಲ್ಲಿ.',
      'The first row is deliberately unchanged. The department gives up nothing on the money side '
      + 'by switching; every difference is at the barrier, which is where the loss is happening.',
      { y: 4.66 });
  }

  /* ══════════════════ 10c · why the visitor pays anything at all ═════ */
  {
    const s = slide('ಪ್ರವಾಸಿಗರ ಶುಲ್ಕ', 'The visitor\'s fee',
      `ಪ್ರವಾಸಿಗರು ರೂ. ${rs(carFee)} ಏಕೆ ಪಾವತಿಸುತ್ತಾರೆ`,
      `Why the visitor pays Rs. ${rs(carFee)} — and what it replaces.`);

    /* The contrast that reframes the whole question. Money lost to forged
       tickets today is not going to anyone legitimate; it is simply gone, and
       nothing records that it went. */
    s.addShape(pptx.ShapeType.roundRect, { x: 0.5, y: 1.9, w: 4.35, h: 1.22,
      rectRadius: 0.05, fill: { color: C.alarmSoft }, line: { color: C.alarm, width: 1 } });
    s.addText('ಇಂದು', { x: 0.68, y: 1.98, w: 4.0, h: 0.24,
      fontFace: KN, fontSize: 11, bold: true, color: C.alarm });
    s.addText('Today', { x: 0.68, y: 2.2, w: 4.0, h: 0.24,
      fontFace: EN, fontSize: 9, charSpacing: 1.5, color: C.alarm });
    s.addText('Thousands of rupees a day leave through forged and copied tickets — to nobody '
            + 'legitimate, recorded nowhere, taxed by no one.', {
      x: 0.68, y: 2.44, w: 4.0, h: 0.6, fontFace: EN, fontSize: 11, color: C.ink,
      lineSpacingMultiple: 1.15 });

    s.addShape(pptx.ShapeType.roundRect, { x: 5.15, y: 1.9, w: 4.35, h: 1.22,
      rectRadius: 0.05, fill: { color: C.goodSoft }, line: { color: C.good, width: 1 } });
    s.addText('ಪ್ರಸ್ತಾವನೆ', { x: 5.33, y: 1.98, w: 4.0, h: 0.24,
      fontFace: KN, fontSize: 11, bold: true, color: C.good });
    s.addText('Proposed', { x: 5.33, y: 2.2, w: 4.0, h: 0.24,
      fontFace: EN, fontSize: 9, charSpacing: 1.5, color: C.good });
    s.addText(`Rs. ${rs(carFee)} on a legitimate ticket — declared openly, shown as its own line, `
            + 'GST paid on it, receipted.', {
      x: 5.33, y: 2.44, w: 4.0, h: 0.6, fontFace: EN, fontSize: 11, color: C.ink,
      lineSpacingMultiple: 1.15 });

    /* What the visitor actually gets. The anti-fraud argument is the
       department's; a citizen asked to pay needs their own reason. */
    s.addText('ಈ ಶುಲ್ಕದಿಂದ ಪ್ರವಾಸಿಗರಿಗೆ ಸಿಗುವುದು  ·  WHAT THE VISITOR GETS FOR IT', {
      x: 0.5, y: 3.28, w: 9.0, h: 0.26, fontFace: KN, fontSize: 11, bold: true, color: C.forest });

    s.addText([
      { text: 'ಖಚಿತ ಪ್ರವೇಶ — ಸ್ಥಳ ಕಾಯ್ದಿರಿಸಲಾಗಿದೆ. ', options: { fontFace: KN, bold: true } },
      { text: 'Guaranteed entry: nobody drives three hours up and is turned away.\n',
        options: { fontFace: EN } },
      { text: 'ಗೇಟ್‌ನಲ್ಲಿ ಸರತಿ ಇಲ್ಲ. ', options: { fontFace: KN, bold: true } },
      { text: 'No queue at the barrier — scan and go.\n', options: { fontFace: EN } },
      { text: 'ಉಚಿತ ದಿನಾಂಕ ಬದಲಾವಣೆ. ', options: { fontFace: KN, bold: true } },
      { text: 'Plans change; the ticket moves, at no cost.\n', options: { fontFace: EN } },
      { text: 'ತಾಣ ಮುಚ್ಚಿದರೆ ಪೂರ್ಣ ಮರುಪಾವತಿ. ', options: { fontFace: KN, bold: true } },
      { text: 'Full refund if the hill closes — no forms.\n', options: { fontFace: EN } },
      { text: 'ಆ್ಯಪ್ ಇಲ್ಲ, ಟಿಕೆಟ್ ಕಳೆದುಹೋಗದು, ಕನ್ನಡದಲ್ಲಿ ಸಹಾಯ. ', options: { fontFace: KN, bold: true } },
      { text: 'No app to install, the ticket cannot be lost, and support is in the same chat.',
        options: { fontFace: EN } },
    ], { x: 0.62, y: 3.56, w: 8.8, h: 1.1, fontSize: 10.5, color: C.ink,
      lineSpacingMultiple: 1.22 });

    note(s, null, `Rs. ${rs(carFee)} is less than a cup of tea at the summit, and a fraction of `
      + 'the fuel wasted driving back down after being refused. It is charged only to those who '
      + 'choose to book ahead, is never folded into the entry fee, and costs the department '
      + 'nothing.', { y: 4.72 });
  }

  /* ══════════════════ 10d · why the fee is legitimate ════════════════ */
  {
    const s = slide('ಕಾನೂನುಬದ್ಧತೆ', 'Legitimacy',
      'ಈ ಶುಲ್ಕ ಏಕೆ ಸಮರ್ಥನೀಯ',
      'A separately disclosed convenience fee is ordinary practice, not an innovation.');

    /* Named without quoting amounts. The point is that the PRACTICE is
       established and accepted, and a figure quoted wrongly for one of these
       would be the only thing anyone remembers from the slide. */
    table(s, ['Who charges one', 'What for'], [
      [{ text: 'IRCTC', align: 'left' },
       { text: 'A convenience fee on every online rail ticket, over and above the fare',
         align: 'left' }],
      [{ text: 'Tirumala Tirupati Devasthanams', align: 'left' },
       { text: 'A service charge on online darshan and accommodation booking', align: 'left' }],
      [{ text: 'KSRTC and state transport', align: 'left' },
       { text: 'An online reservation charge above the ticket fare', align: 'left' }],
      [{ text: 'BookMyShow and similar', align: 'left' },
       { text: 'A convenience fee on each ticket booked', align: 'left' }],
      [{ text: 'This proposal', align: 'left', bold: true, fill: C.goodSoft },
       { text: `Rs. ${rs(carFee)} on a car ticket — same principle, shown as its own line`,
         align: 'left', bold: true, fill: C.goodSoft }],
    ], { y: 1.95, colW: [3.1, 5.9], size: 10.5, rowH: 0.36,
      headKn: ['ಯಾರು ವಿಧಿಸುತ್ತಾರೆ', 'ಯಾವುದಕ್ಕಾಗಿ'] });

    cards(s, [
      { kn: 'ಪ್ರತ್ಯೇಕವಾಗಿ ತೋರಿಸಲಾಗಿದೆ', title: 'Never hidden',
        body: 'Shown as its own line on the payment page, the ticket and the invoice. It is never '
            + 'folded into the entry fee, and the entry fee is never marked up.' },
      { kn: 'ಜಿಎಸ್‌ಟಿ ಪಾವತಿಸಲಾಗಿದೆ', title: 'Taxed properly',
        body: `GST at ${gstPct}% is paid on this fee and on nothing else. The entry fee is a pure-`
            + 'agent collection under Rule 33 and is not taxed as our revenue.' },
      { kn: 'ಆಯ್ಕೆಯಾಗಿಯೇ ಉಳಿಯುತ್ತದೆ', title: 'Stays a choice',
        body: 'If the department keeps a counter at the gate, anyone may still pay the entry fee '
            + 'in cash and queue. The fee then buys convenience by choice — not a levy on access '
            + 'to a public place.', fill: C.goodSoft },
    ], { y: 3.5, h: 1.5 });

    note(s, null, 'The third point is the one worth agreeing in writing with the department. It is '
      + 'what makes this a service the public may choose, rather than a charge on entry.',
      { y: 5.06 });
  }

  /* ═══════════════════════════════ 11 · customer flow ═════════════════ */
  {
    const s = slide('ಹರಿವು', 'Architecture', 'ಪ್ರವಾಸಿಗರ ಹರಿವು', 'The visitor, end to end.');

    flow(s, [
      { kn: 'ವಾಟ್ಸ್ಆ್ಯಪ್', en: 'Sends "hi" to the published number' },
      { kn: 'ವಾಹನ ಸಂಖ್ಯೆ', en: 'Types the plate; type read from the RC record' },
      { kn: 'ದಿನ + ಸಮಯ', en: 'Picks a date and slot, sees places left' },
      { kn: 'ಪಾವತಿ', en: 'Pays on a hosted page; slot held meanwhile' },
      { kn: 'ಟಿಕೆಟ್', en: 'Signed QR and receipt arrive in the chat' },
    ], { y: 2.05, h: 1.15 });

    s.addText('ಸರ್ಕಾರಿ ದಾಖಲೆ (ULIP / ವಾಹನ) — ವಾಹನದ ಪ್ರಕಾರ ಪರಿಶೀಲನೆಗೆ ಮಾತ್ರ', {
      x: 0.5, y: 3.45, w: 9.0, h: 0.3, fontFace: KN, fontSize: 11, color: C.muted });
    s.addText('The registration lookup is used only to decide the vehicle type, so the right fee '
            + 'is charged without asking the visitor to classify their own vehicle. Owner name, '
            + 'address, chassis and engine number are never stored.', {
      x: 0.5, y: 3.72, w: 9.0, h: 0.6, fontFace: EN, fontSize: 10.5, color: C.muted,
      lineSpacingMultiple: 1.15 });

    note(s, null, 'Every step is a tap except the registration number, which only the visitor knows.',
      { y: 4.5 });
  }

  /* ═══════════════════════════════ 12 · gate flow ═════════════════════ */
  {
    const s = slide('ಹರಿವು', 'Architecture', 'ಚೆಕ್‌ಪೋಸ್ಟ್ ಹರಿವು', 'The gate, end to end.');

    flow(s, [
      { kn: 'ಪಿನ್ ಪ್ರವೇಶ', en: 'Staff signs in with their own PIN at shift start' },
      { kn: 'ಸ್ಕ್ಯಾನ್', en: 'Phone reads the QR from the visitor\'s screen' },
      { kn: 'ಫೋನ್‌ನಲ್ಲೇ ಪರಿಶೀಲನೆ', en: 'Signature, plate, date and slot checked offline' },
      { kn: 'ಸರ್ವರ್ ತಪಾಸಣೆ', en: 'Server asked only "already used?"' },
      { kn: 'ತೀರ್ಪು', en: 'ALLOW or one of seven refusals, recorded' },
    ], { y: 2.05, h: 1.15, color: C.gold });

    cards(s, [
      { kn: 'ನೆಟ್‌ವರ್ಕ್ ಇಲ್ಲದಿದ್ದರೆ', title: 'With no signal',
        body: 'The forgery check still runs. The scan queues on the phone and reconciles when '
            + 'signal returns — including any duplicate it could not see at the time.' },
      { kn: 'ಪ್ರತಿ ಸ್ಕ್ಯಾನ್ ದಾಖಲು', title: 'Every scan recorded',
        body: 'With the staff member, the checkpost, the device and the time. Refusals as '
            + 'carefully as admissions.' },
    ], { y: 3.45, h: 1.5 });
  }

  /* ═══════════════════════════════ 13 · money flow ════════════════════ */
  {
    const s = slide('ಹರಿವು', 'Architecture', 'ಹಣದ ಹರಿವು', 'Where the money goes.');

    flow(s, [
      { kn: 'ಪ್ರವಾಸಿ', en: `Pays Rs. ${rs(carEntry + carFee)} on the checkout page` },
      { kn: 'ರೇಜರ್‌ಪೇ', en: 'Collects, deducts its charge, settles to our account' },
      { kn: 'ಇಲಾಖೆಗೆ', en: `Rs. ${rs(carEntry)} entry fee, held as pure agent` },
      { kn: 'ನಮ್ಮ ಶುಲ್ಕ', en: `Rs. ${rs(carFee)} service and convenience fee, GST inside it` },
    ], { y: 2.05, h: 1.15, color: C.good });

    s.addShape(pptx.ShapeType.roundRect, { x: 0.5, y: 3.42, w: 9.0, h: 1.0,
      rectRadius: 0.05, fill: { color: C.goodSoft }, line: { color: C.good, width: 0.75 } });
    s.addText('ಪ್ರವೇಶ ಶುಲ್ಕ ನಮ್ಮ ಆದಾಯವಲ್ಲ — ಸಿಜಿಎಸ್‌ಟಿ ನಿಯಮ 33ರ ಪ್ರಕಾರ ಶುದ್ಧ ಏಜೆಂಟ್ ಆಗಿ ಸಂಗ್ರಹ.', {
      x: 0.68, y: 3.54, w: 8.6, h: 0.3, fontFace: KN, fontSize: 12, bold: true, color: C.forest });
    s.addText('Excluded from our taxable value as a pure agent under Rule 33, CGST Rules 2017. We pay '
            + 'GST on our fee alone — shown as separate lines everywhere.', {
      x: 0.68, y: 3.84, w: 8.6, h: 0.5, fontFace: EN, fontSize: 10.5, color: C.ink,
      lineSpacingMultiple: 1.15 });

    note(s, null, `Settlement to the department: ${cfg.settlement_terms || 'weekly'}.`, { y: 4.58 });
  }

  /* ═══════════════════════════════ 14 · capacity ══════════════════════ */
  {
    const s = slide('ಜನದಟ್ಟಣೆ', 'Crowd control',
      'ದಿನಕ್ಕೆ ಎರಡು ಅವಧಿ, ಪ್ರತಿ ಪ್ರಕಾರಕ್ಕೂ ಮಿತಿ',
      'Two slots a day, with a limit for each vehicle type.');

    table(s, ['Vehicle type', 'Per slot', 'Slots', 'Per day'],
      Object.values(byCat).map((c) => [c.label, c.per_slot, c.slots, c.per_slot * c.slots])
        .concat([[{ text: 'Total vehicles per day', bold: true, align: 'left' }, '', '',
                  { text: String(perDay), bold: true }]]),
      { y: 2.15, colW: [3.9, 1.7, 1.7, 1.7],
        headKn: ['ವಾಹನ ಪ್ರಕಾರ', 'ಪ್ರತಿ ಅವಧಿ', 'ಅವಧಿಗಳು', 'ದಿನಕ್ಕೆ'] });

    note(s, 'ಒಂದು ವಾಹನ ದಿನಕ್ಕೆ ಒಮ್ಮೆ ಮಾತ್ರ. ಎಲ್ಲಾ ಮಿತಿಗಳನ್ನು ಇಲಾಖೆ ಬದಲಾಯಿಸಬಹುದು.',
      'One vehicle enters once per day. Every limit is configurable by the department, without a '
      + 'software change.', { y: 4.5 });
  }

  /* ═════════════════════════════ 15 · oversight ═══════════════════════ */
  {
    const s = slide('ಮೇಲ್ವಿಚಾರಣೆ', 'Oversight',
      'ಇಲಾಖೆಗೆ ಎಲ್ಲವೂ ನೇರವಾಗಿ ಕಾಣುತ್ತದೆ',
      'The department does not have to ask us for a number.');

    cards(s, [
      { kn: 'ಈ ಕ್ಷಣದ ಸ್ಥಿತಿ', title: 'Live position',
        body: 'Vehicles entered, amount collected, how full each slot is, every refusal today.' },
      { kn: 'ದೈನಂದಿನ · ಸಾಪ್ತಾಹಿಕ · ಮಾಸಿಕ', title: 'Full reports',
        body: 'Every ticket and every scan, as PDF or spreadsheet, downloadable at any moment.' },
      { kn: 'ಲೆಕ್ಕಪರಿಶೋಧನೆ', title: 'Audit trail',
        body: 'Every action by every officer, with time and account.' },
    ], { y: 2.1, h: 2.0 });
  }

  /* ══════════════════════════════════════════════════════════════════════
     THE MONEY SECTION
     ══════════════════════════════════════════════════════════════════════ */

  {
    const s = englishOnly(pptx.addSlide());
    s.background = { color: C.forest };
    confidential(s, true);
    s.addText('ಹೂಡಿಕೆ, ವೆಚ್ಚ ಮತ್ತು ಆದಾಯ', {
      x: 0.7, y: 2.15, w: 8.6, h: 0.7, fontFace: KN, fontSize: 32, bold: true, color: C.white });
    s.addText('Investment, expenditure and revenue', {
      x: 0.7, y: 2.88, w: 8.6, h: 0.44, fontFace: EL, fontSize: 20, color: C.pale });
    s.addText('Stated in full, before being asked.', {
      x: 0.7, y: 3.45, w: 8.6, h: 0.36, fontFace: EN, fontSize: 13, italic: true, color: C.light });
  }

  /* ═════════════════════════ 17 · what has been put in ════════════════ */
  {
    const s = slide('ಹೂಡಿಕೆ', 'Investment',
      'ಈ ವ್ಯವಸ್ಥೆ ನಿರ್ಮಿಸಲು ತಗುಲಿದ ವೆಚ್ಚ',
      'What it took to build and what it takes to keep running.');

    const money = (min, max) => (min === max
      ? (min === 0 ? '—' : `Rs. ${inr(min)}`)
      : `Rs. ${inr(min)} – ${inr(max)}`);
    const KIND = { one_time: 'One-time', annual: 'Every year', monthly: 'Monthly' };
    const STATUS = { done: 'Done', in_place: 'In place', planned: 'Planned', needed: 'Needed' };

    /* Six columns, because "what it costs" and "what has been put in" are
       different questions and the second is the one that shows commitment. A
       laptop already owned is a real expense with no fresh investment behind
       it; indemnity cover is a real expense with nothing invested yet. */
    table(s, ['Item', 'Description', 'Expense range', 'Invested', 'Type', 'Status'],
      inv.rows.slice(0, 11).map((r) => [
        { text: (r.item_kn && KANNADA ? `${r.item_kn}\n` : '') + r.item, align: 'left' },
        { text: r.description.length > 52 ? r.description.slice(0, 50) + '…' : r.description,
          align: 'left' },
        money(r.expense_min, r.expense_max),
        { text: money(r.invested_min, r.invested_max),
          color: r.invested_max ? C.ink : C.muted },
        { text: KIND[r.kind] || r.kind, align: 'left' },
        { text: STATUS[r.status] || r.status, align: 'left',
          color: r.status === 'needed' ? C.alarm : r.status === 'planned' ? C.gold : C.good },
      ]),
      { y: 1.9, colW: [1.6, 2.75, 1.5, 1.35, 0.95, 0.85], size: 8.5, rowH: 0.25,
        headKn: ['ವಿವರ', 'ವಿವರಣೆ', 'ವೆಚ್ಚ', 'ಹೂಡಿಕೆ', 'ಪ್ರಕಾರ', 'ಸ್ಥಿತಿ'] });

    note(s, `ವೆಚ್ಚ: ಒಂದು ಬಾರಿ Rs. ${inr(inv.one_time.min)}–${inr(inv.one_time.max)}, `
      + `ವಾರ್ಷಿಕ Rs. ${inr(inv.annual.min)}–${inr(inv.annual.max)}.  `
      + `ಹೂಡಿಕೆ: ವಾರ್ಷಿಕ Rs. ${inr(inv.invested_annual.min)}–${inr(inv.invested_annual.max)}.`,
      'Expense is what these cost. Invested is what this project actually absorbed — lower, '
      + 'because the server, tooling and office are shared with the first product.',
      { y: 4.5 });
  }

  /* ═══════════════════════ 18 · what is still needed ══════════════════ */
  {
    const s = slide('ಇನ್ನೂ ಬಾಕಿ', 'Still to be put in place',
      'ಸರ್ಕಾರಿ ಒಪ್ಪಂದಕ್ಕೂ ಮೊದಲು ಮಾಡಬೇಕಾದದ್ದು',
      'What we would put in place before signing with a department.');

    const money = (min, max) => (min === max ? `Rs. ${inr(max)}` : `Rs. ${inr(min)} – ${inr(max)}`);
    table(s, ['Item', 'Why it matters', 'Expense', 'Type'],
      inv.needed.map((r) => [
        { text: (r.item_kn && KANNADA ? `${r.item_kn}\n` : '') + r.item, align: 'left' },
        { text: r.note || r.description, align: 'left' },
        money(r.expense_min, r.expense_max),
        { text: r.kind === 'annual' ? 'Every year' : 'One-time', align: 'left' },
      ]),
      { y: 2.0, colW: [2.2, 4.3, 1.55, 0.95], size: 10, rowH: 0.42,
        headKn: ['ವಿವರ', 'ಏಕೆ ಬೇಕು', 'ವೆಚ್ಚ', 'ಪ್ರಕಾರ'] });

    note(s, 'ಇವು ಇಲಾಖೆಯ ವೆಚ್ಚವಲ್ಲ — ನಮ್ಮದೇ.',
      'These are our costs, not the department\'s. They are listed because a vendor who has not '
      + 'thought about backups or indemnity before a government contract is a vendor worth '
      + 'questioning.', { y: 4.35 });
  }

  /* ══════════════════════ 19 · what one ticket earns ══════════════════ */
  {
    const s = slide('ಒಂದು ಟಿಕೆಟ್', 'What one ticket earns',
      `Rs. ${rs(carEntry)} ಟಿಕೆಟ್‌ನ ಸಂಪೂರ್ಣ ಲೆಕ್ಕ`,
      `The full arithmetic on a Rs. ${rs(carEntry)} car ticket.`);

    /* Both settlement models in one table. Quoting one figure here and a
       different one on the settlement slide is exactly the inconsistency that
       makes an officer stop trusting the arithmetic. */
    const A = settle.direct;
    const B = settle.split;

    table(s, ['Line', 'Collect & transfer', 'Route split', 'Whose'], [
      [{ text: 'Collected from the visitor', align: 'left' },
       { text: `Rs. ${rs(A.collected)}`, bold: true },
       { text: `Rs. ${rs(B.collected)}`, bold: true }, { text: '', align: 'left' }],
      [{ text: 'Entry fee to the department', align: 'left' },
       { text: `Rs. ${rs(A.entry_paise)}` }, { text: `Rs. ${rs(B.entry_paise)}` },
       { text: 'Department', align: 'left', color: C.forest }],
      [{ text: 'Our gross service and convenience fee', align: 'left' },
       { text: `Rs. ${rs(A.platform_paise)}` }, { text: `Rs. ${rs(B.platform_paise)}` },
       { text: 'Ours', align: 'left' }],
      [{ text: `Less gateway ${A.gateway_percent}% + GST = ${A.gateway_effective}% of Rs. ${rs(A.collected)}`,
        align: 'left' },
       { text: `− Rs. ${rs(A.gateway_paise)}`, color: C.alarm },
       { text: `− Rs. ${rs(B.gateway_paise)}`, color: C.alarm },
       { text: 'Razorpay', align: 'left' }],
      [{ text: `Less Route transfer ${B.transfer_percent}% + GST (charged on the transaction)`,
        align: 'left' },
       { text: '—' },
       { text: `− Rs. ${rs(B.transfer_paise)}`, color: C.alarm },
       { text: 'Razorpay', align: 'left' }],
      [{ text: 'Cash retained', align: 'left', bold: true },
       { text: `Rs. ${rs(A.cash_retained_paise)}`, bold: true },
       { text: `Rs. ${rs(B.cash_retained_paise)}`, bold: true },
       { text: '', align: 'left' }],
      [{ text: 'Less GST on our fee, net of input credit', align: 'left' },
       { text: `− Rs. ${rs(A.gst_payable_paise)}`, color: C.alarm },
       { text: `− Rs. ${rs(B.gst_payable_paise)}`, color: C.alarm },
       { text: 'Government', align: 'left' }],
      [{ text: 'What the business actually keeps', align: 'left', bold: true, fill: C.goodSoft },
       { text: `Rs. ${rs(A.net_profit_paise)}`, bold: true, fill: C.goodSoft, color: C.good },
       { text: `Rs. ${rs(B.net_profit_paise)}`, bold: true, fill: C.goodSoft, color: C.good },
       { text: '', align: 'left', fill: C.goodSoft }],
    ], { y: 1.9, colW: [4.0, 1.75, 1.75, 1.5], size: 10, rowH: 0.3,
      headKn: ['ವಿವರ', 'ವರ್ಗಾವಣೆ', 'ನೇರ ವಿಭಜನೆ', 'ಯಾರಿಗೆ'] });

    note(s, 'ಜಿಎಸ್‌ಟಿ ಲಾಭವಲ್ಲ — ಅದು ಸರ್ಕಾರಕ್ಕೆ ಪಾವತಿಸಬೇಕಾದದ್ದು.',
      `It is tempting to call Rs. ${rs(A.cash_retained_paise)} the profit. It is not — the GST `
      + 'inside our own fee is collected, not earned, and is remitted. The last line is the honest '
      + `figure. Splitting at the gateway costs us Rs. ${rs(settle.cost_of_split_paise)} a ticket `
      + 'more, and we are proposing it anyway.', { y: 4.4 });

    rateNote(s);
  }

  /* ═══════════════════════ 20 · what a year looks like ════════════════ */
  {
    const s = slide('ವಾರ್ಷಿಕ', 'A year at this site',
      'ಎಷ್ಟು ಭರ್ತಿಯಾದರೆ ಎಷ್ಟು',
      `At ${inr(perDay)} vehicles a day capacity, over 300 operating days.`);

    table(s, ['If the site runs at', 'Tickets a year', 'To the department', 'Our net'],
      yearly.scenarios.map((x) => [
        { text: `${x.occupancy}% of capacity`, align: 'left',
          bold: x.occupancy === 50 },
        inr(x.tickets),
        { text: lakh(x.department_paise), color: C.forest, bold: true },
        { text: lakh(x.net_profit_paise), bold: x.occupancy === 50 },
      ]),
      { y: 2.05, colW: [2.6, 2.1, 2.3, 2.0], size: 11.5, rowH: 0.4,
        headKn: ['ಭರ್ತಿ ಪ್ರಮಾಣ', 'ವಾರ್ಷಿಕ ಟಿಕೆಟ್', 'ಇಲಾಖೆಗೆ', 'ನಮ್ಮ ನಿವ್ವಳ'] });

    note(s, 'ಪೂರ್ಣ ಸಾಮರ್ಥ್ಯವನ್ನು ಊಹಿಸಿಲ್ಲ — ಯಾವ ಬೆಟ್ಟವೂ ಪ್ರತಿದಿನ ತುಂಬುವುದಿಲ್ಲ.',
      'Deliberately shown as a range. No hill runs full every day, and a projection that assumes '
      + 'it does invites the one question you do not want. Even at a quarter full, the department '
      + `collects ${lakh(yearly.scenarios[0].department_paise)} a year — all of it recorded `
      + 'against a vehicle, a date and a slot.', { y: 4.05 });

    rateNote(s);
  }

  /* ══════════════════════════ 21 · revenue proposals ══════════════════ */
  {
    const s = slide('ಆದಾಯ ಪ್ರಸ್ತಾಪಗಳು', 'Revenue proposals',
      'ಇಲಾಖೆ ಆಯ್ಕೆ ಮಾಡಬಹುದಾದ ಮಾದರಿಗಳು',
      'What we propose, and what else is possible.');

    const primary = models.filter((m) => m.is_primary);
    const rest = models.filter((m) => !m.is_primary);

    table(s, ['Proposal', 'Department pays', 'Visitor pays'],
      primary.map((m) => [
        { text: (m.title_kn && KANNADA ? `${m.title_kn}\n` : '') + m.title, align: 'left', bold: true },
        { text: m.department_pays, align: 'left' },
        { text: m.visitor_pays, align: 'left' },
      ]),
      { y: 1.95, colW: [3.2, 3.0, 2.8], size: 11, rowH: 0.4,
        headKn: ['ಪ್ರಸ್ತಾಪ', 'ಇಲಾಖೆ ಪಾವತಿ', 'ಪ್ರವಾಸಿ ಪಾವತಿ'] });

    s.addText('ಮುಂದಿನ ಸಾಧ್ಯತೆಗಳು  ·  FURTHER POSSIBILITIES', {
      x: 0.5, y: 3.02, w: 9.0, h: 0.28, fontFace: KN, fontSize: 11, bold: true, color: C.forest });

    cards(s, rest.slice(0, 4).map((m) => ({
      kn: KANNADA ? (m.title_kn || undefined) : undefined,
      title: m.title,
      body: m.summary.length > 130 ? m.summary.slice(0, 128) + '…' : m.summary,
    })), { y: 3.34, h: 1.5 });
  }

  /* ══════════════════ 21b · the same terms at the next site ═════════ */
  {
    const s = slide('ಮುಂದಿನ ತಾಣಗಳು', 'Other sites',
      'ಬೇರೆ ತಾಣಗಳಿಗೂ ಅದೇ ಷರತ್ತುಗಳು',
      'The same terms wherever the department chooses to extend it.');

    s.addText(`ಪ್ರತಿ ತಾಣಕ್ಕೂ ಹೊಸ ಮಾತುಕತೆ ಬೇಡ — ಅದೇ ಶೇ. ${feePct} ಸೇವಾ ಶುಲ್ಕ, ಅದೇ ವ್ಯವಸ್ಥೆ.`, {
      x: 0.5, y: 1.92, w: 9.0, h: 0.3, fontFace: KN, fontSize: 14, bold: true, color: C.ink });
    s.addText('Should the department later extend this to another site — a Kudremukha trek '
            + 'permit, a waterfall, a heritage gate — the same arrangement applies without '
            + `renegotiation: a ${feePct}% service and convenience fee on that site's own entry `
            + 'fee, paid by the visitor, with the department receiving its entry fee in full.', {
      x: 0.5, y: 2.26, w: 9.0, h: 0.66, fontFace: EN, fontSize: 12.5, color: C.muted,
      lineSpacingMultiple: 1.25 });

    cards(s, [
      { kn: 'ಹೊಸ ಸಾಫ್ಟ್‌ವೇರ್ ಬೇಡ', title: 'Nothing new to build',
        body: 'Places, slots, vehicle types, prices and capacities are already configuration. A '
            + 'second site is set up in an afternoon rather than developed.' },
      { kn: 'ಒಂದೇ ಪ್ಯಾನೆಲ್, ಪ್ರತ್ಯೇಕ ಲೆಕ್ಕ', title: 'One panel, separate accounts',
        body: 'Each site keeps its own staff, prices, capacity and collections. The department '
            + 'views them apart or together, from the same place.' },
      { kn: 'ಸೇರುವುದು ಎಎಂಸಿ ಮಾತ್ರ', title: 'Only the AMC is added',
        body: `Rs. ${inr(amc.tiers[2].amount)} a year for an additional site; `
            + `Rs. ${inr(amc.tiers[1].amount)} for an extra gate at a site already running.` },
    ], { y: 3.06, h: 1.5 });

    note(s, null, 'Stated now so that a successful trial here does not become a fresh commercial '
      + 'negotiation later. The terms scale with the department rather than against it.',
      { y: 4.66 });
  }

  /* ═══════════════ 21c · what comes after the first season ══════════ */
  {
    const s = slide('ಮುಂದಿನ ಸುಧಾರಣೆಗಳು', 'Enhancements to come',
      'ಮೊದಲ ಋತುವಿನ ನಂತರ — ಪ್ರವಾಸಿಗರಿಗೆ ಹೆಚ್ಚುವರಿ ಶುಲ್ಕವಿಲ್ಲದೆ',
      'After the first season, at no additional charge to anyone.');

    table(s, ['Enhancement', 'What it does', 'Status'],
      ROADMAP.ENHANCEMENTS.map((e) => [
        { text: `${KANNADA ? `${e.kn}\n` : ''}${e.title}`, align: 'left', bold: true },
        { text: e.what.length > 150 ? `${e.what.slice(0, 148)}…` : e.what, align: 'left' },
        { text: e.status === 'built' ? 'Built' : 'Planned', align: 'left',
          color: e.status === 'built' ? C.good : C.gold,
          fill: e.status === 'built' ? C.goodSoft : undefined },
      ]),
      { y: 1.95, colW: [2.55, 5.35, 1.1], size: 9.5, rowH: 0.78,
        headKn: ['ಸುಧಾರಣೆ', 'ಏನು ಮಾಡುತ್ತದೆ', 'ಸ್ಥಿತಿ'] });

    note(s, 'ಇವು ಯಾವುದಕ್ಕೂ ಪ್ರವಾಸಿಗರಿಂದ ಹೆಚ್ಚುವರಿ ಶುಲ್ಕ ಇಲ್ಲ.',
      'None charges the visitor more. None is promised for the first season.', { y: 4.5 });
  }

  /* ═══════════════ 21d · what could earn more, with approval ════════ */
  {
    const s = slide('ಆದಾಯದ ಸಾಧ್ಯತೆಗಳು', 'Revenue features',
      'ಇಲಾಖೆಯ ಅನುಮೋದನೆಯ ನಂತರ ಮಾತ್ರ',
      'Each requires the department\'s approval before it can exist.');

    table(s, ['Feature', 'What it charges for', 'Why it is worth doing', 'The risk'],
      ROADMAP.REVENUE.map((r) => [
        { text: `${KANNADA ? `${r.kn}\n` : ''}${r.title}`, align: 'left', bold: true },
        { text: r.what.length > 118 ? `${r.what.slice(0, 116)}…` : r.what, align: 'left' },
        { text: r.upside, align: 'left' },
        { text: r.caution.length > 96 ? `${r.caution.slice(0, 94)}…` : r.caution,
          align: 'left', color: C.alarm },
      ]),
      { y: 1.95, colW: [2.2, 2.9, 1.9, 2.0], size: 8.5, rowH: 0.92,
        headKn: ['ವೈಶಿಷ್ಟ್ಯ', 'ಯಾವುದಕ್ಕೆ ಶುಲ್ಕ', 'ಏಕೆ ಉಪಯುಕ್ತ', 'ಅಪಾಯ'] });

    note(s, 'ಸಾಮಾನ್ಯ ಹಂಚಿಕೆ ಸಾಮಾನ್ಯ ದರದಲ್ಲೇ ಉಳಿಯುತ್ತದೆ. ಯಾವ ದರವನ್ನೂ ಇಲಾಖೆಯ ಅನುಮೋದನೆ ಇಲ್ಲದೆ '
      + 'ಬದಲಾಯಿಸುವುದಿಲ್ಲ.',
      'The ordinary allocation stays at the ordinary price. No rate changes without the '
      + 'department\'s written approval.',
      { y: 4.62 });
  }

  /* ══════════════ 21e · tatkal, worked through with real numbers ══════ */
  {
    const s = slide('ತತ್ಕಾಲ್', 'Tatkal',
      'ದಟ್ಟಣೆಯ ದಿನಗಳಿಗೆ ಮೀಸಲು — ಇಲಾಖೆಗೆ ಹೆಚ್ಚುವರಿ ಆದಾಯ',
      'A reserved allocation on peak days — and the one feature that pays the department.');

    s.addText(`${tatkal.reserve_percent}% ಮೀಸಲು  ·  ವಾರಾಂತ್ಯ ಮತ್ತು ರಜಾ ದಿನಗಳಲ್ಲಿ ಮಾತ್ರ`, {
      x: 0.5, y: 1.9, w: 9.0, h: 0.3, fontFace: KN, fontSize: 13, bold: true, color: C.ink });
    s.addText(`${tatkal.reserve_percent}% of each car slot held back, sold on weekends and `
            + 'holidays only, at an entry fee the department sets higher.', {
      x: 0.5, y: 2.2, w: 9.0, h: 0.3, fontFace: EN, fontSize: 12, color: C.muted });

    table(s, ['', 'Per slot', 'Per day', 'Per year'], [
      [{ text: 'Tatkal places reserved', align: 'left' },
       String(tatkal.per_slot), String(tatkal.per_day), inr(tatkal.tickets_per_year)],
      [{ text: `Entry fee — Rs. ${rs(tatkal.entry_paise)} becomes `
             + `Rs. ${rs(tatkal.tatkal_entry_paise)}`, align: 'left' },
       `+ Rs. ${rs(tatkal.uplift_paise)}`, '—', '—'],
      [{ text: 'EXTRA TO THE DEPARTMENT', align: 'left', bold: true, fill: C.goodSoft },
       { text: '—', fill: C.goodSoft },
       { text: `Rs. ${inr(rs(tatkal.department_extra_per_day_paise))}`, bold: true,
         fill: C.goodSoft, color: C.good },
       { text: `Rs. ${inr(rs(tatkal.department_extra_per_year_paise))}`, bold: true,
         fill: C.goodSoft, color: C.good }],
      [{ text: `ServerPe fee at ${tatkal.fee_percent}% — rises with the base, not on top of it`,
         align: 'left' },
       `Rs. ${rs(tatkal.fee_tatkal_paise)}`,
       `+ Rs. ${rs(tatkal.platform_extra_per_ticket_paise)}/ticket`,
       `Rs. ${inr(rs(tatkal.platform_extra_per_year_paise))}`],
    ], { y: 2.62, colW: [4.2, 1.5, 1.6, 1.7], size: 10, rowH: 0.42,
      headKn: ['', 'ಪ್ರತಿ ಸ್ಲಾಟ್', 'ಪ್ರತಿ ದಿನ', 'ಪ್ರತಿ ವರ್ಷ'] });

    note(s, 'ಹೆಚ್ಚಿನ ಪ್ರವೇಶ ಶುಲ್ಕ ಸಂಪೂರ್ಣವಾಗಿ ಇಲಾಖೆಗೆ ಸೇರುತ್ತದೆ — ಅದು ಇಲಾಖೆಯ ಹಣ, ನಮ್ಮದಲ್ಲ.',
      `The entire Rs. ${rs(tatkal.uplift_paise)} uplift is the department's, because the entry `
      + 'fee is theirs to set. We earn only our usual percentage, which rises because the base '
      + 'rose — the one roadmap item that pays the department rather than costing it.', { y: 4.5 });

    rateNote(s);
  }

  /* ═══════════ 21f · who controls the pricing, and the undertaking ════ */
  {
    const s = slide('ದರ ನಿಯಂತ್ರಣ', 'Who controls the pricing',
      'ದರ ನಿಗದಿಪಡಿಸುವ ಅಧಿಕಾರ ಇಲಾಖೆಯದ್ದೇ',
      'An undertaking, given before it is asked for.');

    duoHead(s, { y: 1.82 });
    duo(s, [
      ['ಪ್ರತಿ ದರವನ್ನೂ — ಪ್ರವೇಶ ಶುಲ್ಕ, ತತ್ಕಾಲ್ ದರ, ಸೇವಾ ಶುಲ್ಕ — ಇಲಾಖೆಯ ಲಿಖಿತ ಅನುಮೋದನೆಯ '
       + 'ನಂತರವೇ ವ್ಯವಸ್ಥೆಯಲ್ಲಿ ಸಂರಚಿಸಲಾಗುತ್ತದೆ.',
       'Every rate — entry fee, tatkal rate, service fee — is configured in the system only '
       + 'after the department has approved it in writing.'],
      ['ಅನುಮೋದನೆ ಇಲ್ಲದೆ ಯಾವುದೇ ದರ ಬದಲಾವಣೆ ಕಂಡುಬಂದರೆ, ಇಲಾಖೆ ಈ ಯೋಜನೆಯನ್ನು ತಕ್ಷಣವೇ '
       + 'ಸ್ಥಗಿತಗೊಳಿಸಬಹುದು ಅಥವಾ ರದ್ದುಗೊಳಿಸಬಹುದು.',
       'If any rate is found changed without that approval, the department may suspend or '
       + 'terminate this arrangement immediately — no notice, no cause to be shown.'],
      ['ಸ್ಥಗಿತಗೊಂಡ ಕ್ಷಣದಿಂದ ಹಳೆಯ ಬುಕಿಂಗ್ ವ್ಯವಸ್ಥೆ ಎಂದಿನಂತೆ ಮುಂದುವರಿಯುತ್ತದೆ. ಗೇಟ್ ಎಂದಿಗೂ '
       + 'ನಿಲ್ಲುವುದಿಲ್ಲ.',
       'From that moment the existing booking process simply continues as before. The gate is '
       + 'never left without a way to work.'],
      ['ಪ್ರತಿ ದರ ಬದಲಾವಣೆಯೂ ಪ್ಯಾನೆಲ್‌ನಲ್ಲಿ ದಾಖಲಾಗುತ್ತದೆ — ಯಾರು, ಯಾವಾಗ, ಹಿಂದಿನ ದರ ಏನಿತ್ತು.',
       'Every rate change is recorded in the panel — who made it, when, and what the rate was '
       + 'before. The department can audit it without asking us.'],
    ], { y: 2.06, size: 11.5, gap: 0.12 });

    note(s, null, 'Not a promise — a switch the department can throw without our agreement, and a log they '
      + 'can read without our help.', { y: 4.72 });
  }

  /* ═════════════════════════════ 22 · AMC ranges ══════════════════════ */
  {
    const s = slide('ವಾರ್ಷಿಕ ನಿರ್ವಹಣಾ ಶುಲ್ಕ', 'Annual maintenance charge',
      'ಎಲ್ಲಾ ಪ್ರಸ್ತಾಪಗಳಿಗೂ ಸಾಮಾನ್ಯ',
      'Common to every proposal above.');

    table(s, ['What', 'Charge per year', 'What it covers'],
      amc.tiers.map((t) => [
        { text: t.label, align: 'left' },
        { text: `Rs. ${inr(t.amount)}`, bold: true },
        { text: t.note, align: 'left' },
      ]),
      { y: 1.95, colW: [2.9, 2.0, 4.1], size: 10.5, rowH: 0.42,
        headKn: ['ಏನು', 'ವಾರ್ಷಿಕ ಶುಲ್ಕ', 'ಏನು ಒಳಗೊಂಡಿದೆ'] });

    s.addShape(pptx.ShapeType.roundRect, { x: 0.5, y: 3.42, w: 9.0, h: 1.05,
      rectRadius: 0.05, fill: { color: C.paper }, line: { color: C.line, width: 0.75 } });
    s.addText('ಶುಲ್ಕ ಹೇಗೆ ನಿಗದಿಯಾಗಿದೆ  ·  HOW THE CHARGE IS SET', {
      x: 0.68, y: 3.52, w: 8.6, h: 0.26, fontFace: KN, fontSize: 11, bold: true, color: C.forest });
    s.addText(`Our own running cost is Rs. ${inr(inv.annual.min)} – ${inr(inv.annual.max)} a year. `
            + `The proposed Rs. ${inr(amc.proposed)} per gate covers the support commitment during `
            + 'gate hours, updates and training — it does not by itself cover the platform, which '
            + 'the visitor service and convenience fee funds. Range offered: '
            + `Rs. ${inr(amc.min)} – ${inr(amc.max)} depending on gates and hours.`, {
      x: 0.68, y: 3.8, w: 8.6, h: 0.6, fontFace: EN, fontSize: 10.5, color: C.ink,
      lineSpacingMultiple: 1.15 });

    note(s, null, `Term: ${cfg.contract_term}. Data belongs to the department and is exportable at `
      + 'any time; no exit charge.', { y: 4.62 });
  }

  /* ═══════════════ 23 · how the department's money reaches it ═════════ */
  {
    const s = slide('ಇತ್ಯರ್ಥ', 'Settlement',
      'ಇಲಾಖೆಯ ಹಣ ಇಲಾಖೆಗೆ ಹೇಗೆ ತಲುಪುತ್ತದೆ',
      'How the department\'s money reaches the department.');

    /* NOT presented as a differentiator. The existing web vendor already remits
       the full entry fee with nothing deducted, and claiming this as an
       advantage in front of an officer who knows that would cost more
       credibility than the point is worth.

       So it is framed as continuity instead: nothing about the department's
       money changes, which removes the perceived risk of switching. The
       argument for switching is made at the gate, not here. */
    s.addText('ಇಲಾಖೆಯ ಹಣದ ವಿಷಯದಲ್ಲಿ ಏನೂ ಬದಲಾಗುವುದಿಲ್ಲ.', {
      x: 0.5, y: 1.86, w: 9.0, h: 0.3, fontFace: KN, fontSize: 15, bold: true, color: C.forest });
    s.addText('Nothing about the department\'s money changes. The full entry fee reaches the '
            + 'Tourism Department, with nothing deducted — exactly as it does today.', {
      x: 0.5, y: 2.16, w: 9.0, h: 0.34, fontFace: EL, fontSize: 14, bold: true, color: C.ink });

    table(s, ['', 'Option 1 — collect and transfer', 'Option 2 — split at the gateway'], [
      [{ text: 'How it works', align: 'left' },
       { text: `Razorpay settles the whole Rs. ${rs(settle.direct.collected)} to our account. `
             + `We transfer the department's share ${(cfg.settlement_terms || 'weekly').toLowerCase()}.`,
         align: 'left' },
       { text: `Razorpay Route splits each payment as it is made. Rs. ${rs(settle.split.entry_paise)} `
             + 'goes straight to the department; only our fee reaches us.',
         align: 'left', fill: C.goodSoft }],

      [{ text: 'Whose account holds it', align: 'left' },
       { text: 'Ours, until the transfer', align: 'left' },
       { text: 'Never ours at all', align: 'left', bold: true, fill: C.goodSoft }],

      [{ text: 'Razorpay charges', align: 'left' },
       { text: `${settle.direct.gateway_percent}% + GST`, align: 'left' },
       { text: `${settle.split.gateway_percent}% + GST, plus `
             + `${settle.split.transfer_percent}% + GST to route the split`,
         align: 'left', fill: C.goodSoft }],

      [{ text: 'Costs us, per ticket', align: 'left' },
       { text: `Rs. ${rs(settle.direct.charges_paise)}`, align: 'left' },
       { text: `Rs. ${rs(settle.split.charges_paise)}  `
             + `(Rs. ${rs(settle.cost_of_split_paise)} more)`, align: 'left', fill: C.goodSoft }],

      [{ text: 'Reconciliation', align: 'left' },
       { text: 'A weekly statement to agree', align: 'left' },
       { text: 'Nothing to agree — already split', align: 'left', bold: true, fill: C.goodSoft }],
    ], { y: 2.58, colW: [1.9, 3.5, 3.6], size: 10, rowH: 0.42,
      headKn: ['', 'ಆಯ್ಕೆ 1 — ವರ್ಗಾವಣೆ', 'ಆಯ್ಕೆ 2 — ನೇರ ವಿಭಜನೆ'] });

    s.addShape(pptx.ShapeType.roundRect, { x: 0.5, y: 4.42, w: 9.0, h: 0.72,
      rectRadius: 0.04, fill: { color: C.goodSoft }, line: { color: C.good, width: 0.75 } });
    s.addText(`ಒಟ್ಟು ${feePct}% ಸೇವಾ ಶುಲ್ಕ ಸಂಗ್ರಹಿಸಲಾಗುತ್ತದೆ; ಅದರಿಂದಲೇ ಗೇಟ್‌ವೇ ಮತ್ತು ವರ್ಗಾವಣೆ ಶುಲ್ಕ ಕಳೆಯಲಾಗುತ್ತದೆ.`, {
      x: 0.66, y: 4.5, w: 8.7, h: 0.26, fontFace: KN, fontSize: 11.5, bold: true, color: C.forest });
    s.addText(`A gross service and convenience fee of ${feePct}% of the entry fee is collected `
            + 'from the visitor, from which the applicable payment gateway and Route transfer '
            + 'charges are met. The department receives the entry fee in full under either option. '
            + 'We recommend option 2 and absorb the additional '
            + `Rs. ${rs(settle.cost_of_split_paise)} per ticket ourselves. This matches the `
            + 'department\'s present arrangement — it is stated so that switching carries no '
            + 'financial change at all, not as a point of difference.', {
      x: 0.66, y: 4.76, w: 8.7, h: 0.4, fontFace: EN, fontSize: 10, color: C.ink,
      lineSpacingMultiple: 1.1 });

    rateNote(s);
  }

  /* ══════════════ 23b · the one thing still being confirmed ══════════ */
  {
    const s = slide('ದೃಢೀಕರಣ ಬಾಕಿ', 'Being confirmed',
      'ಇನ್ನೂ ಖಚಿತಪಡಿಸಿಕೊಳ್ಳಬೇಕಾದ ಒಂದು ವಿಷಯ',
      'One matter we are still confirming — stated here, not left to be discovered.');

    s.addText('ಗೇಟ್‌ವೇ ಶುಲ್ಕ ಯಾವ ಖಾತೆಯಿಂದ ಕಳೆಯಲಾಗುತ್ತದೆ ಎಂಬುದನ್ನು ಲಿಖಿತವಾಗಿ ಖಚಿತಪಡಿಸಿಕೊಳ್ಳುತ್ತಿದ್ದೇವೆ.', {
      x: 0.5, y: 1.95, w: 9.0, h: 0.32, fontFace: KN, fontSize: 13.5, bold: true, color: C.ink });
    s.addText('Whether the gateway and Route transfer charges are deducted from the primary '
            + 'account or apportioned against the linked account is a configuration set with the '
            + 'payment gateway. We are confirming it in writing before any agreement is signed.', {
      x: 0.5, y: 2.32, w: 9.0, h: 0.62, fontFace: EN, fontSize: 12.5, color: C.muted,
      lineSpacingMultiple: 1.25 });

    cards(s, [
      { kn: 'ಬದಲಾಗದ್ದು', title: 'What does not change',
        body: 'The department receives the entry fee in full, to the rupee, under either '
            + `configuration. The ${feePct}% service fee is ours, and the charges come out of it.`,
        fill: C.goodSoft },
      { kn: 'ಗೇಟ್‌ವೇ ಒಪ್ಪದಿದ್ದರೆ', title: 'If the gateway will not allow it',
        body: 'We will say so before signing rather than after, and propose the alternative '
            + 'arrangement instead.', fill: C.goodSoft },
    ], { y: 3.1, h: 1.4 });

    note(s, null, 'A vendor who lists what they have not yet confirmed is a vendor whose other '
      + 'statements can be relied on.', { y: 4.64 });
  }

  /* ═══════════════════ 24 · what happens if I am not there ═══════════ */
  {
    const s = slide('ನಿರಂತರತೆ', 'Continuity',
      'ಒಬ್ಬರೇ ನಡೆಸುವ ಸಂಸ್ಥೆಯ ನಿಜವಾದ ಅಪಾಯ',
      'The real risk of a one-person vendor, and what answers it.');

    s.addText('ಈ ಪ್ರಶ್ನೆಯನ್ನು ಕೇಳುವ ಮೊದಲೇ ನಾವೇ ಎತ್ತುತ್ತಿದ್ದೇವೆ.', {
      x: 0.5, y: 1.9, w: 9.0, h: 0.3, fontFace: KN, fontSize: 12.5, bold: true, color: C.alarm });
    s.addText('Raised here rather than left to be worried about privately.', {
      x: 0.5, y: 2.18, w: 9.0, h: 0.3, fontFace: EN, fontSize: 11.5, color: C.muted });

    table(s, ['The risk', 'What answers it'], [
      [{ text: 'The proprietor is unavailable for a day or two', align: 'left' },
       { text: 'A named nominee within the firm, already trained on the panel, covers short '
             + 'absences. The proprietor carries a working laptop at all times, so a gate problem '
             + 'is answerable from wherever he is.', align: 'left' }],
      [{ text: 'The proprietor is unavailable for longer', align: 'left' },
       { text: 'A documented handover pack and an escrowed copy of the source code, held with the '
             + 'department or a nominee.', align: 'left' }],
      [{ text: 'The engagement ends', align: 'left' },
       { text: 'Full data export at any time, in open formats. No exit charge, no lock-in, no '
             + 'proprietary file nobody else can read.', align: 'left' }],
      [{ text: 'The system stops working at the gate', align: 'left' },
       { text: 'The old paper process still works. The gate is never left with nothing — and the '
             + 'signature check works with no network, which is the commonest failure.',
         align: 'left' }],
      [{ text: 'Support is needed outside gate hours', align: 'left' },
       { text: cfg.sla_response || 'Within 2 hours during gate hours, same day otherwise.',
         align: 'left' }],
    ], { y: 2.6, colW: [3.2, 5.8], size: 10.5, rowH: 0.5,
      headKn: ['ಅಪಾಯ', 'ಪರಿಹಾರ'] });
  }

  /* ═══════════ 24b · under what instrument this is sanctioned ═════════ */
  {
    const s = slide('ಅನುಮೋದನೆ', 'Sanction',
      'ಯಾವ ಆದೇಶದ ಮೂಲಕ ಮಂಜೂರು ಮಾಡಬಹುದು',
      'What the department would actually sign.');

    s.addText('ವಿಶೇಷ ಹಕ್ಕಿಲ್ಲದ, ವೆಚ್ಚವಿಲ್ಲದ ಪ್ರಾಯೋಗಿಕ ಒಪ್ಪಂದ — ಒಂದು ಋತುವಿಗೆ, '
            + '೩೦ ದಿನಗಳ ಸೂಚನೆಯಲ್ಲಿ ರದ್ದುಗೊಳಿಸಬಹುದು.', {
      x: 0.5, y: 1.92, w: 9.0, h: 0.34, fontFace: KN, fontSize: 13.5, bold: true, color: C.ink });
    s.addText('A non-exclusive, no-cost pilot MoU, sanctioned administratively for one season, '
            + 'terminable at 30 days\' notice — with paper ticketing continuing in parallel '
            + 'throughout. Not a tender, not a concession, not a work order.', {
      x: 0.5, y: 2.28, w: 9.0, h: 0.5, fontFace: EN, fontSize: 12, color: C.muted,
      lineSpacingMultiple: 1.2 });

    cards(s, [
      { kn: 'ವೆಚ್ಚವಿಲ್ಲ', title: 'No public expenditure',
        body: 'The department buys nothing. Procurement rules govern the spending of public '
            + 'money; there is none here.', fill: C.goodSoft },
      { kn: 'ಆದಾಯ ನಷ್ಟವಿಲ್ಲ', title: 'No revenue foregone',
        body: `Rs. ${rs(carEntry)} of every Rs. ${rs(carEntry)} reaches the department, as today. `
            + 'No right of value is transferred.', fill: C.goodSoft },
      { kn: 'ವಿಶೇಷ ಹಕ್ಕಿಲ್ಲ', title: 'Non-exclusive',
        body: 'The counter keeps selling paper. The department stays free to permit anyone else '
            + 'on identical terms.', fill: C.goodSoft },
      { kn: 'ಯಾವಾಗ ಬೇಕಾದರೂ ರದ್ದು', title: 'Terminable at will',
        body: 'Thirty days, no cause, no compensation. No successor in office is bound.',
        fill: C.goodSoft },
    ], { y: 2.92, h: 1.62 });

    note(s, 'ಇಲಾಖೆ ಟಿಕೆಟ್ ವ್ಯವಸ್ಥೆಯನ್ನು ಬದಲಾಯಿಸುತ್ತಿಲ್ಲ — ಒಂದು ಹೆಚ್ಚುವರಿ ಆಯ್ಕೆಯನ್ನು ಸೇರಿಸುತ್ತಿದೆ.',
      'The department is not replacing its ticketing system. It is permitting one additional '
      + 'optional channel beside it — a materially smaller thing to sanction.', { y: 4.66 });
  }

  /* ═══════════════════════════ 25 · rollout ═══════════════════════════ */
  {
    const s = slide('ಜಾರಿ ಯೋಜನೆ', 'Rollout', 'ಅನುಮೋದನೆಯಿಂದ ಪೂರ್ಣ ಕಾರ್ಯಾಚರಣೆಗೆ',
      'From approval to a working gate.');

    flow(s, [
      { kn: 'ವಾರ 1', en: 'Prices and capacities confirmed; staff and officers named' },
      { kn: 'ವಾರ 1', en: 'PINs issued, gate phones registered, staff trained on site' },
      { kn: 'ವಾರ 2', en: 'Soft launch — one slot, both systems side by side' },
      { kn: 'ವಾರ 3', en: 'Full operation; paper kept as fallback' },
      { kn: 'ತಿಂಗಳು 3', en: 'Review against agreed measures' },
    ], { y: 2.1, h: 1.25 });

    s.addText('ಮೂರು ತಿಂಗಳ ನಂತರ ಇಲಾಖೆ ಪರಿಶೀಲಿಸಬಹುದಾದ ಅಳತೆಗಳು  ·  WHAT TO JUDGE IT ON', {
      x: 0.5, y: 3.6, w: 9.0, h: 0.28, fontFace: KN, fontSize: 11, bold: true, color: C.forest });
    s.addText('Tickets sold against the previous season   ·   altered or duplicated tickets '
            + 'refused at the gate   ·   average time a vehicle spends at the barrier   ·   '
            + 'collections reconciled to the last rupee   ·   complaints received', {
      x: 0.5, y: 3.9, w: 9.0, h: 0.6, fontFace: EN, fontSize: 11, color: C.ink,
      lineSpacingMultiple: 1.2 });

    note(s, null, 'If it fails on those measures, the department stops it and owes nothing '
      + 'beyond the maintenance charge for the period used.', { y: 4.6 });
  }

  /* ══════════════════ 25b · what we need from the department ═════════ */
  {
    const s = englishOnly(pptx.addSlide());
    s.background = { color: C.forest };
    confidential(s, true);
    s.addText('ಇಲಾಖೆಯಿಂದ ಬೇಕಾದ ನಿರ್ಧಾರಗಳು ಮತ್ತು ಮಾಹಿತಿ', {
      x: 0.7, y: 2.1, w: 8.6, h: 0.7, fontFace: KN, fontSize: 29, bold: true, color: C.white });
    s.addText('Decisions, permissions and information we need', {
      x: 0.7, y: 2.85, w: 8.6, h: 0.44, fontFace: EL, fontSize: 19, color: C.pale });
    s.addText(`${REQ.REQUIREMENTS.length} items, grouped by who answers them. `
            + 'A blank against each is more useful than agreement in principle.', {
      x: 0.7, y: 3.42, w: 8.6, h: 0.4, fontFace: EN, fontSize: 12.5, italic: true, color: C.light });
  }

  /* One slide per group, each a checklist with a column left blank for the
     answer. A sheet with empty boxes gets filled in; a discussion does not. */
  for (const [key, g] of Object.entries(REQ.GROUPS)) {
    const rows = REQ.byGroup(key);
    const s = slide(g.kn, g.en, KANNADA ? g.kn : null, g.en);

    table(s, ['', 'What we need', 'Why', 'By when', 'Answer'],
      rows.map((r, i) => [
        { text: String(i + 1), align: 'center' },
        { text: `${KANNADA ? `${r.kn}\n` : ''}${r.item}`, align: 'left', bold: true },
        { text: r.why.length > 145 ? r.why.slice(0, 143) + '…' : r.why, align: 'left' },
        { text: r.needed, align: 'left' },
        { text: '', align: 'left' },
      ]),
      { y: 1.95, colW: [0.35, 2.55, 3.85, 1.05, 1.2], size: 8.5,
        rowH: rows.length > 5 ? 0.44 : 0.52,
        headKn: ['', 'ಏನು ಬೇಕು', 'ಏಕೆ', 'ಯಾವಾಗ', 'ಉತ್ತರ'] });
  }

  /* The three with real lead time — the ones a meeting should actually
     settle, rather than leaving in a document nobody returns to. */
  {
    const s = slide('ಮೊದಲು ನಿರ್ಧರಿಸಬೇಕಾದವು', 'Decide these first',
      'ಇಂದೇ ನಿರ್ಧರಿಸಬೇಕಾದ ಮೂರು ವಿಷಯಗಳು',
      'Three things worth settling in this meeting, because everything else waits on them.');

    cards(s, REQ.urgent().slice(0, 3).map((r) => ({
      kn: KANNADA ? r.kn : undefined, title: r.item,
      body: r.why.length > 165 ? r.why.slice(0, 163) + '…' : r.why,
      fill: C.goldSoft,
    })), { y: 2.1, h: 2.3 });

    note(s, 'ವಾಟ್ಸ್ಆ್ಯಪ್ ಸಂಖ್ಯೆಯ ನಿರ್ಧಾರ ಅತಿ ಮುಖ್ಯ — ನೋಂದಣಿಗೆ ಸಮಯ ಬೇಕು.',
      'The WhatsApp number is the long pole. Ours works today; a departmental number takes a few '
      + 'days to register with Meta and cannot be hurried, so deciding it late delays the launch '
      + 'and nothing else does.', { y: 4.56 });
  }

  /* ═════════════════════════════ 26 · the ask ═════════════════════════ */
  {
    const s = slide('ಇಲಾಖೆಯಿಂದ ಬೇಕಾದದ್ದು', 'What we need',
      'ನಾಲ್ಕು ವಿಷಯಗಳು — ಸ್ಥಾಪಿಸಲು ಏನೂ ಇಲ್ಲ',
      'Four things, and nothing to install.');

    bullets(s, [
      ['ಚೆಕ್‌ಪೋಸ್ಟ್‌ನಲ್ಲಿ ಕಾರ್ಯನಿರ್ವಹಿಸಲು ಅನುಮತಿ ಮತ್ತು ಶುಲ್ಕದ ದೃಢೀಕರಣ.',
       'Approval to operate, and confirmation of the entry fee for each vehicle type.'],
      ['ಗೇಟ್‌ನಲ್ಲಿ ಎರಡು ಫೋನ್ ಬಳಸಲು ಅನುಮತಿ — ಫೋನ್‌ಗಳನ್ನು ನಾವೇ ಒದಗಿಸುತ್ತೇವೆ.',
       'Permission to use two phones at the barrier. We supply them and the connection on '
       + 'them — the department buys no hardware.'],
      ['ಸಿಬ್ಬಂದಿ ಮತ್ತು ಅಧಿಕಾರಿಗಳ ಹೆಸರುಗಳು.',
       'Staff to be issued PINs, and officers to be given panel access.'],
      ['ಸಂಗ್ರಹಿಸಿದ ಶುಲ್ಕ ಇಲಾಖೆಗೆ ಪಾವತಿಸುವ ವಿಧಾನ ಮತ್ತು ಅವಧಿ.',
       'A decision on how and how often the collected entry fee is settled.'],
    ], { y: 2.0, size: 13 });
  }

  /* ══════════════════ 26b · the ask, in one paragraph ═════════════════ */
  {
    const s = slide('ಕೋರಿಕೆ', 'The ask', 'ಒಂದೇ ಪ್ಯಾರಾದಲ್ಲಿ',
      'If only one slide is remembered, this is the one.');

    s.addShape(pptx.ShapeType.roundRect, { x: 0.5, y: 1.9, w: 9.0, h: 2.5, rectRadius: 0.06,
      fill: { color: C.white }, line: { color: C.forest, width: 1.5 } });

    s.addText('ಇಲಾಖೆ ಯಾವುದನ್ನೂ ಖರೀದಿಸಬೇಕಾಗಿಲ್ಲ, ಒಂದು ರೂಪಾಯಿಯನ್ನೂ ವೆಚ್ಚ ಮಾಡಬೇಕಾಗಿಲ್ಲ. '
            + 'ಅದೇ ಟಿಕೆಟ್, ಅದೇ ದರದಲ್ಲಿ ಖರೀದಿಸಲು ಪ್ರವಾಸಿಗರಿಗೆ ಇನ್ನೊಂದು ಐಚ್ಛಿಕ ಮಾರ್ಗ — '
            + 'ಅಷ್ಟೇ ನಾವು ಕೇಳುತ್ತಿರುವುದು.', {
      x: 0.78, y: 2.12, w: 8.44, h: 0.86, fontFace: KN, fontSize: 13, bold: true,
      color: C.ink, lineSpacingMultiple: 1.25 });

    s.addText('We are not asking the department to procure anything, or to spend a rupee.\n\n'
            + 'We are asking permission to offer visitors one more optional way to buy the same '
            + 'ticket at the same price.\n\n'
            + 'The entry fee reaches the department in full, exactly as it does today. Our fee '
            + 'is charged separately, only to the visitor who chooses this channel, at a '
            + 'ceiling the department fixes.\n\n'
            + 'A non-exclusive pilot for one season, terminable at thirty days\' notice.', {
      x: 0.78, y: 3.04, w: 8.44, h: 1.24, fontFace: EN, fontSize: 12.5, color: C.ink,
      lineSpacingMultiple: 1.3 });

    note(s, null, 'Every claim on this slide is checkable from the department\'s own settlement '
      + 'records within a week of starting.', { y: 4.58 });
  }

  /* ═════════════════════════════ 24 · the demo ════════════════════════ */
  {
    const s = slide('ಈಗ', 'Now', 'ನೇರ ಪ್ರಾತ್ಯಕ್ಷಿಕೆ', 'What we can show you now, end to end.',
      { dark: true });

    bullets(s, [
      ['ವಾಟ್ಸ್ಆ್ಯಪ್‌ನಲ್ಲಿ ನಿಜವಾದ ಟಿಕೆಟ್ ಬುಕಿಂಗ್ ಮತ್ತು ಪಾವತಿ.',
       'Booking a real ticket on WhatsApp, and paying for it.'],
      ['ಆ ಟಿಕೆಟ್ ತಿದ್ದಿ ತೋರಿಸಿದಾಗ ಗೇಟ್ ತಿರಸ್ಕರಿಸುವುದು.',
       'Altering that ticket deliberately — and the gate refusing it.'],
      ['ಒಂದೇ ಟಿಕೆಟ್ ಎರಡು ಬಾರಿ — ಎರಡನೆಯದು ಸಿಕ್ಕಿಬೀಳುವುದು.',
       'The same ticket presented twice, and the second attempt being caught.'],
      ['ನೆಟ್‌ವರ್ಕ್ ಆಫ್ ಮಾಡಿ ಪರಿಶೀಲನೆ.',
       'Verifying a ticket with the phone\'s network switched off.'],
      ['ಇಲಾಖೆಯ ಪ್ಯಾನೆಲ್‌ನಲ್ಲಿ ಇವೆಲ್ಲವೂ ತಕ್ಷಣ ಕಾಣುವುದು.',
       'Watching all of it appear in the department\'s panel as it happens.'],
    ], { y: 2.0, size: 12.5, dark: true });
  }

  /* ═════════════════════════════ 25 · contact ═════════════════════════ */
  {
    const s = englishOnly(pptx.addSlide());
    s.background = { color: C.paper };
    confidential(s);
    if (has(ourLogo)) s.addImage({ path: ourLogo, x: 0.5, y: 0.45, w: 0.85, h: 0.85 });

    s.addText(cfg.legal_name, { x: 0.5, y: 1.45, w: 9.0, h: 0.5,
      fontFace: EN, fontSize: 25, bold: true, color: C.ink });
    s.addText(cfg.vendor_tagline, { x: 0.5, y: 1.92, w: 9.0, h: 0.34,
      fontFace: EL, fontSize: 14, italic: true, color: C.forest });

    const facts = [
      ['ಸಂಸ್ಥೆಯ ರಚನೆ', 'Constitution', cfg.legal_form],
      ['ಮಾಲೀಕರು', 'Proprietor', val('proprietor_name')],
      ['ಜಿಎಸ್‌ಟಿ', 'GSTIN', val('gstin')],
      ['ಉದ್ಯಮ್ (MSME)', 'Udyam', val('udyam_number')],
      ['ಕಾರ್ಯಾರಂಭ', 'Operating since', longDate(val('business_since'))],
      ['ವಿಳಾಸ', 'Address', val('business_address')],
      ['ಸಂಪರ್ಕ', 'Contact', `${cfg.support_mobile || ''}   ·   ${cfg.contact_email || ''}`],
      ['ಜಾಲತಾಣ', 'Website', cfg.website || ''],
    ];

    facts.forEach(([k, ke, v], i) => {
      const y = 2.45 + i * 0.36;
      s.addText(`${k} · ${ke}`, { x: 0.5, y, w: 2.7, h: 0.3,
        fontFace: KN, fontSize: 10, bold: true, color: C.muted });
      s.addText(String(v), { x: 3.3, y, w: 6.2, h: 0.3,
        fontFace: EN, fontSize: 11.5, color: C.ink });
    });
  }

  await pptx.writeFile({ fileName: OUT });

  const missing = ['founder_bio', 'founder_years']
    .filter((k) => !cfg[k] || !String(cfg[k]).trim());

  // Counted, not asserted — a hardcoded number goes stale the first time a
  // slide is added, and then quietly misreports for months.
  console.log(`\n  Written: ${OUT}  (${pptx.slides.length} slides)`);
  if (missing.length) {
    console.log('\n  STILL TO FILL — shown in red on slide 2:');
    for (const m of missing) console.log(`    ${m}`);
  }
  console.log('');
  process.exit(0);
})().catch((e) => { console.error('\n', e, '\n'); process.exit(1); });

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

/** "2025-08-01" -> "1 August 2025"; "2026-06" -> "June 2026". */
function longDate(d) {
  const s = String(d || '');
  const parts = s.split('-').map(Number);
  if (parts.length === 3) return `${parts[2]} ${MONTHS[parts[1] - 1]} ${parts[0]}`;
  if (parts.length === 2) return `${MONTHS[parts[1] - 1]} ${parts[0]}`;
  return s;
}
