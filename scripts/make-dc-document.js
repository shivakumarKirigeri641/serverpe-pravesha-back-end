/**
 * scripts/make-dc-document.js — the proposal document for the DC and ADC.
 *
 *   node scripts/make-dc-document.js [outfile.pdf]
 *
 * Generated rather than typed so it stays true: the prices, capacities and
 * slots come out of the live configuration, so the document handed across a
 * desk cannot disagree with the system being demonstrated beside it.
 *
 * Register: a note to a district administration, not a sales brochure. Plain
 * numbering, no colour beyond one rule under each heading, everything on the
 * page defensible. The strongest argument here is arithmetic, not adjectives.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { query, one } = require('../src/gatepass/db');
const settings = require('../src/gatepass/settings');
const bc = require('../src/gatepass/businessCase');
const { kn } = require('../src/gatepass/kn');
const REQ = require('../src/gatepass/requirements');
const ROADMAP = require('../src/gatepass/roadmap');

const OUT = process.argv[2]
  || path.join(process.cwd(), 'Mullayanagiri-entry-ticketing-proposal.pdf');

/* ─────────────────────────────────────────────────────────── page furniture */

const INK = '#111827';
const MUTED = '#4b5563';
const RULE = '#9ca3af';
const ACCENT = '#0f4f48';

const M = 62;                 // margin
const W = 595.28;             // A4 width
const TEXT_W = W - M * 2;

(async () => {
  const cfg = await settings.all();
  const place = await one(`SELECT * FROM places WHERE code = 'MULLAYANAGIRI'`);
  const slots = (await query(
    'SELECT * FROM place_slots WHERE place_id = $1 ORDER BY sort_order', [place.id])).rows;
  const pricing = (await query(
    `SELECT pp.*, vc.label, vc.code FROM place_pricing pp
       JOIN vehicle_categories vc ON vc.id = pp.category_id
      WHERE pp.place_id = $1 AND pp.is_active ORDER BY vc.sort_order`, [place.id])).rows;
  const caps = (await query(
    `SELECT sc.capacity, s.code AS slot_code, vc.label, vc.code
       FROM slot_capacity sc
       JOIN place_slots s ON s.id = sc.slot_id
       JOIN vehicle_categories vc ON vc.id = sc.category_id
      WHERE sc.place_id = $1 ORDER BY s.sort_order, vc.sort_order`, [place.id])).rows;

  const gstPct = Number(cfg.gst_percent_on_platform || 18);
  const feePct = Number(cfg.platform_fee_percent || 10);
  const rs = (p) => (p % 100 === 0 ? String(p / 100) : (p / 100).toFixed(2));
  const inr = (n) => Number(n).toLocaleString('en-IN');

  const PRODUCT = cfg.product_name || 'EntryPe';

  /* The commercial figures, from configuration so the document, the invoice and
     the conversation cannot drift apart. */
  const amcPaise = Number(cfg.amc_per_gate_annual_paise || 12000000);
  const amcRs = inr(amcPaise / 100);
  const carEntry = (pricing.find((p) => p.code === 'CAR')?.entry_paise || 10000) / 100;
  const OPERATING_DAYS = 300;
  // How many altered car entries a day the maintenance charge is worth. Rounded
  // up: claiming a fraction of a vehicle would be silly.
  const breakEvenPerDay = Math.ceil((amcPaise / 100) / (carEntry * OPERATING_DAYS));

  /* The commercial arithmetic, computed once and shared with the presentation. */
  const settle = await bc.compareSettlement(
    pricing.find((p) => p.code === 'CAR')?.entry_paise || 10000,
    pricing.find((p) => p.code === 'CAR')?.platform_paise || 1000);
  const invSummary = await bc.investment();

  /* Daily capacity, computed rather than asserted. */
  const perSlot = {};
  for (const c of caps) perSlot[c.code] = (perSlot[c.code] || 0) + 0;
  const byCategory = {};
  for (const c of caps) {
    byCategory[c.code] = byCategory[c.code] || { label: c.label, per_slot: 0, slots: 0 };
    byCategory[c.code].per_slot = c.capacity;
    byCategory[c.code].slots += 1;
  }
  const dailyVehicles = Object.values(byCategory)
    .reduce((n, c) => n + c.per_slot * c.slots, 0);

  const yearly = await bc.annual({
    entryPaise: pricing.find((p) => p.code === 'CAR')?.entry_paise || 10000,
    platformPaise: pricing.find((p) => p.code === 'CAR')?.platform_paise || 1300,
    vehiclesPerDay: dailyVehicles, route: true });

  /* The tatkal illustration, from this site's own car capacity and entry fee. */
  const tk = await bc.tatkal({
    capacityPerSlot: byCategory.CAR?.per_slot || 400,
    slots: byCategory.CAR?.slots || 2,
    entryPaise: pricing.find((p) => p.code === 'CAR')?.entry_paise || 10000,
    tatkalPaise: Number(cfg.tatkal_entry_paise || 15000),
    reservePct: Number(cfg.tatkal_reserve_percent || 10),
    peakDays: Number(cfg.tatkal_peak_days || 110),
    feePercent: Number(cfg.platform_fee_percent || 13),
  });

  const dailyCollection = pricing.reduce((n, p) => {
    const cat = byCategory[p.code];
    return n + (cat ? p.entry_paise * cat.per_slot * cat.slots : 0);
  }, 0);

  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true,
    info: {
      Title: 'Mullayanagiri vehicle entry ticketing — proposal',
      Author: cfg.merchant_name || 'ServerPe App Solutions',
      Subject: 'Preventing ticket alteration at the Mullayanagiri checkpost',
    } });
  /* Kannada needs an embedded face: the PDF base fourteen has none, and would
     silently drop every glyph rather than complain. */
  const FONTS = path.join(__dirname, '..', 'assets', 'fonts');
  const HAS_KN = fs.existsSync(path.join(FONTS, 'NotoSansKannada-Regular.ttf'));
  if (HAS_KN) {
    doc.registerFont('kn', path.join(FONTS, 'NotoSansKannada-Regular.ttf'));
    doc.registerFont('kn-bold', path.join(FONTS, 'NotoSansKannada-Bold.ttf'));
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const stream = fs.createWriteStream(OUT);
  doc.pipe(stream);

  let y = 0;

  /* ───────────────────────────────────────────────────────────── cover */

  doc.rect(0, 0, W, 6).fill(ACCENT);

  /* The department's own emblem, then the title in Kannada with the English
     beneath it. A proposal to a state government that opens in English and
     mentions Kannada later has the relationship the wrong way round. */
  const EMBLEM = path.join(__dirname, '..', 'assets', 'logos', 'karnataka-tourism-emblem-192.png');
  if (fs.existsSync(EMBLEM)) doc.image(EMBLEM, M, 40, { width: 54 });

  y = 106;
  if (HAS_KN) {
    doc.fillColor(MUTED).font('kn').fontSize(10)
       .text(kn('submitted_to'), M, y, { width: TEXT_W });
    y = doc.y + 2;
  }
  doc.fillColor(MUTED).font('Helvetica').fontSize(8.5)
     .text('SUBMITTED TO THE OFFICE OF THE DEPUTY COMMISSIONER, CHIKKAMAGALURU',
           M, y, { width: TEXT_W, characterSpacing: 0.8 });

  y = doc.y + 24;
  if (HAS_KN) {
    doc.fillColor(INK).font('kn-bold').fontSize(21)
       .text(kn('doc_title'), M, y, { width: TEXT_W, lineGap: 2 });
    y = doc.y + 4;
  }
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(16)
     .text('Vehicle entry ticketing for Mullayanagiri', M, y, { width: TEXT_W, lineGap: 2 });

  y = doc.y + 10;
  if (HAS_KN) {
    doc.font('kn').fontSize(11).fillColor(MUTED)
       .text(kn('doc_subtitle'), M, y, { width: TEXT_W - 30, lineGap: 2 });
    y = doc.y + 3;
  }
  doc.font('Helvetica').fontSize(11).fillColor(MUTED)
     .text('A proposal to replace the printed entry ticket with a digitally signed '
         + 'QR ticket that the checkpost verifies, rather than reads.',
           M, y, { width: TEXT_W - 40, lineGap: 2 });

  y = doc.y + 40;
  doc.moveTo(M, y).lineTo(W - M, y).lineWidth(0.75).strokeColor(RULE).stroke();

  y += 22;
  const meta = [
    ['System', PRODUCT],
    ['Proposed site', `${place.name}, ${place.district}`],
    ['Prepared by', cfg.merchant_name || 'ServerPe App Solutions'],
    ['Date', new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })],
    ['Term', cfg.contract_term || '1 year, renewable'],
    ['Cost to the department', `Rs. ${amcRs} per gate per year`],
  ];
  for (const [k, v] of meta) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(8.5)
       .text(k.toUpperCase(), M, y, { width: 150, characterSpacing: 1 });
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(10.5).text(v, M + 155, y - 1, { width: 300 });
    y += 22;
  }

  y += 18;
  doc.moveTo(M, y).lineTo(W - M, y).lineWidth(0.75).strokeColor(RULE).stroke();

  /* The summary, on the cover, because it may be the only part that is read. */
  y += 26;
  if (HAS_KN) {
    doc.fillColor(INK).font('kn-bold').fontSize(12).text(kn('in_summary'), M, y);
    y = doc.y + 1;
  }
  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(9.5).text('IN SUMMARY', M, y);
  y = doc.y + 8;

  const summary = [
    'The ticket sold today is a document. At the barrier it is read by a person, not '
    + 'verified by anything. An altered ticket and a genuine one therefore look identical, '
    + 'and the difference is invisible to the staff member holding it.',

    'The proposed ticket carries a QR code that is digitally signed. The vehicle number, '
    + 'date, time slot and vehicle type are inside the signature. Change any one character '
    + 'and the code fails verification at the gate.',

    'Verification needs no network. The checkpost phone can confirm a ticket is genuine '
    + 'with no signal at all, which matters on this road.',

    'Every scan is recorded against the staff member who made it — including every '
    + 'refusal. The department gets a daily record of how many altered or duplicated '
    + 'tickets were stopped.',

    'The department receives the nominal entry fee in full, directly into its own account, with '
    + 'nothing deducted — exactly as it does under the present arrangement. The payment is split '
    + 'at the gateway itself, with the department as the linked account, so its share never '
    + 'passes through ServerPe\'s hands. Nothing on the money side changes by switching; every '
    + 'difference this proposal makes is at the barrier.',

    `Operation is funded by a gross service and convenience fee of ${feePct}% of the entry fee, `
    + 'paid by the visitor. Every payment gateway and transfer charge is met from that fee by '
    + `ServerPe. The only charge to the department is an annual maintenance fee of Rs. ${amcRs} `
    + `per gate — recovered by stopping roughly ${breakEvenPerDay} altered car entries a day.`,

    'The system is not specific to this site. It is designed for any ticketed entry point, and '
    + 'a second location can be added as configuration rather than as a new deployment.',
  ];
  for (const s of summary) {
    doc.circle(M + 3, y + 5.5, 1.8).fill(ACCENT);
    doc.fillColor(INK).font('Helvetica').fontSize(10)
       .text(s, M + 14, y, { width: TEXT_W - 14, lineGap: 1.5 });
    y = doc.y + 9;
  }

  /* ─────────────────────────────────────────────────────── the sections */

  /**
   * A numbered section heading, Kannada above the English.
   *
   * The Kannada line is the heading; the English sits under it in a lighter
   * weight. A document submitted to a Karnataka department that carries its
   * headings only in English has the relationship the wrong way round — and
   * every call site has always passed the Kannada, so the only thing that was
   * missing was this function reading it.
   */
  const H = (n, title, knTitle) => {
    if (doc.y > 700) doc.addPage();
    const top = doc.y + (doc.y < 100 ? 0 : 24);
    doc.y = top;

    if (knTitle && HAS_KN) {
      doc.fillColor(ACCENT).font('kn-bold').fontSize(13.5)
         .text(`${n}.  ${knTitle}`, M, doc.y, { width: TEXT_W, lineGap: 1 });
      doc.y += 1;
      doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(10.5)
         .text(title, M + 16, doc.y, { width: TEXT_W - 16 });
    } else {
      doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(13)
         .text(`${n}.  ${title}`, M, doc.y, { width: TEXT_W });
    }
    const ly = doc.y + 5;
    doc.moveTo(M, ly).lineTo(W - M, ly).lineWidth(1).strokeColor(ACCENT).stroke();
    doc.y = ly + 12;
  };

  const P = (text, opts = {}) => {
    if (doc.y > 740) { doc.addPage(); doc.y = M; }
    doc.fillColor(opts.muted ? MUTED : INK)
       .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
       .fontSize(opts.size || 10)
       .text(text, M, doc.y, { width: TEXT_W, lineGap: 1.8, align: opts.align || 'left' });
    doc.y += opts.gap ?? 10;
  };

  const BULLETS = (items) => {
    for (const it of items) {
      if (doc.y > 730) { doc.addPage(); doc.y = M; }
      const [head, rest] = Array.isArray(it) ? it : [null, it];
      doc.circle(M + 3, doc.y + 5.5, 1.8).fill(ACCENT);
      if (head) {
        doc.fillColor(INK).font('Helvetica-Bold').fontSize(10)
           .text(`${head} `, M + 14, doc.y, { width: TEXT_W - 14, continued: true });
        doc.font('Helvetica').text(rest, { lineGap: 1.5 });
      } else {
        doc.fillColor(INK).font('Helvetica').fontSize(10)
           .text(rest, M + 14, doc.y, { width: TEXT_W - 14, lineGap: 1.5 });
      }
      doc.y += 7;
    }
    doc.y += 4;
  };

  /**
   * A plain table: header rule, hairline row rules, figures to the right.
   *
   * Every cell is drawn at an explicit y rather than letting the cursor advance
   * between them — otherwise a cell that wraps to two lines drags the rest of
   * the row down with it, which is how generated tables end up looking like a
   * staircase. Row height is measured from the tallest cell so wrapping still
   * works.
   */
  const TABLE = (cols, rows) => {
    if (doc.y > 620) { doc.addPage(); doc.y = M; }

    const top = doc.y;
    let x = M;
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8.5);
    for (const c of cols) {
      doc.text(c.label.toUpperCase(), x, top,
        { width: c.w, align: c.align || 'left', characterSpacing: 0.6 });
      x += c.w;
    }

    let ry = top + 14;
    doc.moveTo(M, ry).lineTo(W - M, ry).lineWidth(0.75).strokeColor(RULE).stroke();
    let rowTop = ry + 8;

    for (const r of rows) {
      // A row that would fall off the page starts a new one instead of being
      // clipped in half.
      if (rowTop > 760) { doc.addPage(); rowTop = M; }

      x = M;
      let tallest = 0;
      cols.forEach((c, i) => {
        doc.font(c.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(INK);
        const text = String(r[i] ?? '');
        const h = doc.heightOfString(text, { width: c.w, align: c.align || 'left' });
        doc.text(text, x, rowTop, { width: c.w, align: c.align || 'left' });
        tallest = Math.max(tallest, h);
        x += c.w;
      });

      rowTop += Math.max(tallest, 12) + 6;
      doc.moveTo(M, rowTop - 4).lineTo(W - M, rowTop - 4)
         .lineWidth(0.4).strokeColor('#e5e7eb').stroke();
      rowTop += 4;
    }

    doc.y = rowTop + 8;
  };

  doc.addPage();
  doc.y = M;

  /* 1 ─────────────────────────────────────────────────────────────────── */
  H(1, 'What is happening now', kn('sec_today'));

  P('A visitor buys an entry ticket online and prints it, or shows it on a phone. At the '
  + 'checkpost a staff member looks at it, sees a plausible-looking ticket, and raises the '
  + 'barrier.');

  P('The ticket is an ordinary document. It can be opened in any editor and changed — the '
  + 'vehicle number, the date, the ticket number. A single purchased ticket becomes ten '
  + 'tickets, each looking exactly as genuine as the original, because there is nothing on '
  + 'it that the gate can check against anything.');

  P('This is not a failure of the staff at the barrier. They are being asked to detect a '
  + 'forgery by eye, at speed, in a queue. That is not a task a person can do.', { muted: true });

  P('The consequence is a direct loss of entry-fee revenue to the department, and no way to '
  + 'measure how large it is — an altered ticket that is waved through leaves no trace '
  + 'anywhere.');

  /* 2 ─────────────────────────────────────────────────────────────────── */
  H(2, 'What is proposed', kn('sec_proposal'));

  P('A ticket booked on WhatsApp that carries a digitally signed QR code, and a checkpost '
  + 'application that verifies it rather than reads it.');

  BULLETS([
    ['The ticket cannot be edited.', 'The vehicle number, date, time slot, vehicle type and '
     + 'place are all inside a cryptographic signature. Altering any character invalidates it.'],
    ['The ticket cannot be shared.', 'The vehicle number is inside the signed code. A ticket '
     + 'presented by a different vehicle is refused, without the staff member having to '
     + 'compare anything by eye.'],
    ['A ticket can be used once.', 'The first scan consumes it. A second presentation of the '
     + 'same code — a screenshot passed to a friend — is reported as already used.'],
    ['No network is needed to catch a forgery.', 'The signature check happens on the phone '
     + 'itself. Only the "already used" check needs a connection, and scans taken offline are '
     + 'reconciled automatically when signal returns.'],
  ]);

  /* 3 ─────────────────────────────────────────────────────────────────── */
  H(3, 'How the verification works, in plain terms', kn('sec_verification'));

  P('The system holds a private key, kept on the server. When a ticket is paid for, the '
  + 'server writes the ticket\'s details into the QR code and signs them with that key.');

  P('Each checkpost phone holds only the matching public key. A public key can check whether '
  + 'a signature is genuine, but cannot create one. This distinction is the heart of the '
  + 'design: even if a checkpost phone were lost or its contents extracted, it could not be '
  + 'used to manufacture a single valid ticket.');

  P('The alternative — a shared password on every phone — was rejected for exactly this '
  + 'reason. A shared secret in a device at a hill station is a shared secret that eventually '
  + 'leaves it.', { muted: true });

  P('At the gate the phone reports one of eight outcomes, each with a different instruction '
  + 'to the staff member:');

  TABLE(
    [{ label: 'What the phone shows', w: 150 },
     { label: 'What it means', w: TEXT_W - 150 }],
    [
      ['ALLOW', 'Genuine ticket, right vehicle, right day. Raise the barrier.'],
      ['ALREADY USED', 'This exact code has already come through. A copy is being presented.'],
      ['FAKE TICKET', 'The signature does not verify. The ticket has been altered or invented.'],
      ['WRONG DAY', 'Genuine ticket, but issued for another date.'],
      ['WRONG TIME', 'Genuine ticket for later today. A late arrival is allowed; an early one is not.'],
      ['WRONG GATE', 'Genuine ticket for a different checkpost.'],
      ['NOT FOUND', 'Signature valid but no such ticket on record. Refer to the office.'],
      ['CANCELLED', 'The ticket was refunded or cancelled.'],
    ]);

  P('The distinction matters at the barrier. A visitor with a Tuesday ticket needs to be told '
  + 'a different thing from someone presenting a forgery, and a single word — "invalid" — '
  + 'would leave the staff member to guess which they were looking at.');

  P('"WE ALREADY HAVE TICKETS. WHY NOT SIMPLY PRINT A QR CODE ON THEM?"', { bold: true, gap: 6 });

  P('This is the right question to ask, and it deserves a direct answer rather than a list of '
  + 'features.');

  BULLETS([
    ['A QR code is a way of writing, not a way of checking.', 'Printing one on the existing '
      + 'ticket makes that ticket machine-readable. It does not make it verifiable. A '
      + 'photocopied QR code scans exactly as well as the original, because the copy contains '
      + 'the same characters.'],
    ['Stopping alteration requires a signature, not a QR code.', 'What makes the proposed ticket '
      + 'hard to forge is that its contents are sealed with a cryptographic signature, and the '
      + 'key that produces that signature exists on a server rather than on the ticket. A QR '
      + 'code with no signature inside it can be regenerated by anyone with a free website.'],
    ['Stopping reuse requires a record of what has been used.', 'Even a perfectly signed ticket '
      + 'can be presented twice unless something remembers that it was already admitted. That '
      + 'memory is a system. It cannot be printed onto paper, and it is the single thing a QR '
      + 'code on the existing ticket can never provide.'],
    ['Everything else follows from that system.', 'Once a server is issuing signed tickets and '
      + 'recording their use, live capacity, slot control, settlement, reporting and analytics '
      + 'are consequences of it rather than separate products. Without this proposal the '
      + 'department would be procuring, building and staffing that software itself.'],
  ]);

  P('Set out as a comparison, marking honestly what works today and what would be built after '
  + 'approval:');

  {
    const Y = '  Yes';
    const N = '  —';
    const S = '  After approval';
    TABLE([
      { label: '', w: TEXT_W - 190 },
      { label: 'Ticket + QR', w: 80, align: 'left' },
      { label: 'This platform', w: 110, align: 'left' },
    ], [
      ['Verifies the ticket is genuine, offline, by signature', N, Y],
      ['Booking on WhatsApp before travelling', N, Y],
      [`Real-time slot inventory and live capacity control`, N, Y],
      ['One-time QR validation — a second use is refused and recorded', N, Y],
      ['Duplicate and forwarded-screenshot tickets caught', N, Y],
      ['Bulk booking controlled — one vehicle, one ticket, one day', N, Y],
      ['Slot management across the two daily slots', N, Y],
      ['One-time postponement, the old code self-invalidating', N, Y],
      ['Automatic payment and daily reconciliation', N, Y],
      ['Live dashboard for the Deputy Commissioner and the manager', N, Y],
      ['Crowd and demand analytics', N, Y],
      ['Suspicious-booking and refusal detection', N, Y],
      ['Split settlement — entry fee direct to the department', N, S],
      ['Vehicle-number change, once, with an audit trail', N, S],
      ['Cancellation releasing the place, and a waitlist', N, S],
      ['Tatkal and peak-day pricing, if the department approves', N, S],
    ]);
  }

  P('The rows marked "after approval" are marked so deliberately. A comparison listing things '
  + 'that cannot be demonstrated on the day is worth less than a shorter one that survives the '
  + 'request to show it working.', { muted: true });

  /* 4 ─────────────────────────────────────────────────────────────────── */
  H(4, 'What the visitor does', kn('sec_visitor'));

  BULLETS([
    'Sends a message on WhatsApp to the published number. No application to install, no '
    + 'account to create, no password.',
    'Types the vehicle registration number. The system reads the vehicle type from the '
    + 'government registration record, so the correct fee is charged without the visitor '
    + 'being asked to classify their own vehicle.',
    'Chooses a date and a time slot, and sees how many places are left in each.',
    'Pays. The QR ticket and a printable receipt arrive in the same chat within seconds.',
    'At the gate, shows the QR code. Nothing else.',
  ]);

  P('The same WhatsApp menu also lets a visitor download the ticket again, move it to another '
  + 'day, raise a support request or leave feedback — so an ordinary change of plan does not '
  + 'become a phone call to the department.');

  /* 5 ─────────────────────────────────────────────────────────────────── */
  H(5, 'What the checkpost staff do', kn('sec_staff'));

  BULLETS([
    ['Sign in with their own PIN', 'at the start of a shift. Every scan afterwards is '
     + 'recorded against that person by name.'],
    ['Scan.', 'The phone shows a large, single-word verdict, readable at arm\'s length in '
     + 'sunlight.'],
    ['One phone per gate.', 'A second phone at the same checkpost cannot scan until it '
     + 'deliberately takes over, and the handover is recorded. This prevents two people each '
     + 'assuming the other is checking.'],
    ['One gate per person.', 'Signing in at one checkpost ends that person\'s session '
     + 'anywhere else, so a PIN cannot be lent out and used in two places at once.'],
  ]);

  P('A device is registered to a checkpost once, by the administrator. A PIN on an '
  + 'unregistered phone does nothing, and a registered phone without a PIN does nothing '
  + 'either.');

  /* 6 ─────────────────────────────────────────────────────────────────── */
  doc.addPage(); doc.y = M;
  H(6, 'Capacity and crowding', kn('sec_capacity'));

  P(`The day is divided into ${slots.length} slots, and each vehicle type has its own limit in `
  + 'each slot. A vehicle may enter once per day — the same vehicle cannot book the second '
  + 'slot as well.');

  TABLE(
    [{ label: 'Vehicle type', w: 170 },
     { label: 'Per slot', w: 90, align: 'right' },
     { label: 'Slots', w: 70, align: 'right' },
     { label: 'Per day', w: TEXT_W - 330, align: 'right' }],
    Object.values(byCategory).map((c) => [
      c.label, String(c.per_slot), String(c.slots), String(c.per_slot * c.slots),
    ]).concat([['Total vehicles per day', '', '', String(dailyVehicles)]]));

  P('These figures are configuration, not code. The department can change a limit, close a '
  + 'single slot or close an entire day from the administration panel, and the change takes '
  + 'effect immediately.');

  P('Because a place is held the moment a visitor begins paying and released if they do not '
  + 'finish, the published number of remaining places is accurate rather than optimistic. Two '
  + 'people cannot be sold the same last place.', { muted: true });

  /* 7 ─────────────────────────────────────────────────────────────────── */
  H(7, 'How the money is split', kn('sec_money_split'));

  P('The visitor pays two separate amounts. They are shown separately at every stage — on the '
  + 'payment page, on the receipt, and in every report the department can download.');

  TABLE(
    [{ label: 'Vehicle type', w: 160 },
     { label: 'Entry fee', w: 95, align: 'right' },
     { label: 'Service & convenience fee', w: 95, align: 'right' },
     { label: 'Visitor pays', w: TEXT_W - 350, align: 'right', bold: true }],
    pricing.map((p) => [
      p.label, `Rs. ${rs(p.entry_paise)}`, `Rs. ${rs(p.platform_paise)}`,
      `Rs. ${rs(p.entry_paise + p.platform_paise)}`,
    ]));

  BULLETS([
    ['The entry fee is the department\'s in full.', 'Every rupee of it. It is collected on the '
     + 'department\'s behalf and is excluded from ServerPe\'s taxable value as a pure agent '
     + 'under Rule 33 of the CGST Rules, 2017 — the department\'s collection is not our income '
     + 'and is not taxed as such.'],
    ['The service and convenience fee is ours.', `Set at ${feePct}% of the entry fee and paid by the visitor, `
     + `not by the department. GST at ${gstPct}% applies to this fee alone and is discharged by `
     + 'ServerPe.'],
    ['Refunds return the whole amount.', 'A visitor refunded after a closure receives the entry '
     + 'fee and the service and convenience fee back in full. ServerPe absorbs the payment gateway charge on '
     + 'that refund.'],
  ]);

  P(`At full capacity the entry fee collected for the department is approximately `
  + `Rs. ${Number(rs(dailyCollection)).toLocaleString('en-IN')} per day — `
  + `every rupee recorded against a specific vehicle, date and slot, and reconcilable to the `
  + `last ticket.`, { bold: true });

  /* 8 ─────────────────────────────────────────────────────────────────── */
  H(8, 'Commercial terms', kn('sec_commercial'));

  P('Operations are funded by the visitor\'s service and convenience fee. The department is asked for one '
  + 'thing only: an annual maintenance charge covering support, updates and hosting.');

  TABLE(
    [{ label: 'Item', w: 210 },
     { label: 'Charge', w: 150, align: 'right' },
     { label: 'Payable by', w: TEXT_W - 360, align: 'right' }],
    [
      ['Set-up and installation', 'Nil', '-'],
      ['Software licence', 'Nil', '-'],
      ['Per-ticket service and convenience fee', `${feePct}% of entry fee`, 'Visitor'],
      ['Annual maintenance (per gate)', `Rs. ${amcRs}`, 'Department'],
      ['Payment gateway charges', 'Absorbed by ServerPe', '-'],
      ['WhatsApp and messaging', 'Absorbed by ServerPe', '-'],
    ]);

  P('The annual maintenance charge covers:', { gap: 6 });
  BULLETS(String(cfg.amc_covers || '').split(';').map((s) => s.trim()).filter(Boolean));

  P('It does not cover:', { gap: 6 });
  BULLETS(String(cfg.amc_excludes || '').split(';').map((s) => s.trim()).filter(Boolean));

  TABLE(
    [{ label: 'Term', w: 210 },
     { label: '', w: TEXT_W - 210 }],
    [
      ['Contract period', cfg.contract_term || '1 year, renewable'],
      ['Support response', cfg.sla_response || 'Within 2 hours during gate hours'],
      ['Settlement of entry fee', cfg.settlement_terms || 'Weekly'],
      ['Data ownership', 'All booking and collection data belongs to the department and is '
       + 'exportable at any time'],
      ['On termination', 'Full data export provided; no exit charge'],
    ]);

  /* 9 ─────────────────────────────────────────────────────────────────── */
  H(9, 'What the charge is set against', kn('sec_value'));

  P('The maintenance charge is small enough to be recovered by a very small reduction in '
  + 'leakage. The arithmetic below is illustrative, not a claim about the present scale of the '
  + 'problem — nobody can measure that today, which is itself part of the case for this '
  + 'system.');

  TABLE(
    [{ label: 'If the gate stops, per day', w: 210 },
     { label: 'Entry fee recovered per year', w: TEXT_W - 210, align: 'right' }],
    [
      ['2 altered car tickets', `Rs. ${(2 * carEntry * 300).toLocaleString('en-IN')}`],
      ['4 altered car tickets', `Rs. ${(4 * carEntry * 300).toLocaleString('en-IN')}`],
      ['10 altered car tickets', `Rs. ${(10 * carEntry * 300).toLocaleString('en-IN')}`],
      ['25 altered car tickets', `Rs. ${(25 * carEntry * 300).toLocaleString('en-IN')}`],
    ]);

  P(`Assuming 300 operating days. The annual maintenance charge of Rs. ${amcRs} per gate is `
  + `covered by stopping approximately ${breakEvenPerDay} altered car entries per day.`,
    { bold: true });

  P('Beyond the recovery, the department gains something it does not have at all today: a '
  + 'daily, auditable count of how many attempts were refused and why.', { muted: true });

  /* 10 ────────────────────────────────────────────────────────────────── */
  H(10, 'How the collected entry fee reaches the department', kn('sec_settlement'));

  P('Nothing about the department\'s money changes. The full entry fee reaches the Tourism '
  + 'Department with nothing deducted, exactly as it does under the present arrangement. This is '
  + 'stated so that switching carries no financial change at all — it is not offered as a point '
  + 'of difference. The payment is split through Razorpay Route, with the department configured '
  + 'as the linked account, so its share does not pass through ServerPe\'s hands.',
    { bold: true, size: 11 });

  P('For completeness, both possible arrangements are set out below. The difference is not '
  + 'presentational: it decides whose bank account the department\'s money sits in between the '
  + 'sale and the settlement.');

  TABLE(
    [{ label: '', w: 112 },
     { label: 'Collect and transfer', w: 175 },
     { label: 'Split at the gateway', w: TEXT_W - 287 }],
    [
      ['How it works',
       `The whole Rs. ${rs(settle.direct.collected)} settles to ServerPe's account; the `
       + `department's share is transferred ${String(cfg.settlement_terms || 'weekly').toLowerCase()}.`,
       `Razorpay Route splits each payment as it is made. Rs. ${rs(settle.split.entry_paise)} goes `
       + 'directly to the department; only the service and convenience fee reaches ServerPe.'],
      ['Whose account holds it', 'ServerPe\'s, until the transfer', 'Never ServerPe\'s at all'],
      ['Razorpay charges',
       `${settle.direct.gateway_percent}% + GST on the transaction`,
       `${settle.split.gateway_percent}% + GST on the transaction, plus `
       + `${settle.split.transfer_percent}% + GST to route the split`],
      ['Cost to ServerPe per ticket',
       `Rs. ${rs(settle.direct.charges_paise)}`,
       `Rs. ${rs(settle.split.charges_paise)}, which is Rs. ${rs(settle.cost_of_split_paise)} more `
       + 'and is absorbed by ServerPe rather than passed on'],
      ['Reconciliation', 'A periodic statement for the department to agree',
       'Nothing to agree; the split has already happened'],
    ]);

  P('ServerPe recommends the second arrangement, notwithstanding that it costs more on every '
  + 'ticket. The department\'s collections never rest in a private account, the pure-agent '
  + 'position under Rule 33 becomes unarguable, and a settlement dispute becomes close to '
  + 'impossible. It requires a departmental bank account that Razorpay can pay into — the one '
  + 'element ServerPe cannot arrange on its own.', { bold: true });

  P('THE COMMERCIAL POSITION, STATED PLAINLY. A gross service and convenience fee of '
  + `${feePct}% of the entry fee is collected from the visitor, and the applicable payment `
  + 'gateway and Route transfer charges are deducted from that fee. The department receives '
  + 'the entry fee in full, to the rupee, under either arrangement.');

  P('One matter is not yet settled and is stated here rather than left to be discovered: whether '
  + 'the gateway and transfer charges are deducted from the primary account or apportioned '
  + 'against the linked account is a configuration decided with the payment gateway, and ServerPe '
  + 'is confirming it in writing before any agreement is signed. Whichever way it is configured, '
  + 'the commercial position above does not change — ServerPe bears those charges out of its '
  + 'service fee, and the department\'s receipt is unaffected. If the gateway will not permit '
  + 'that configuration, ServerPe will say so before signing rather than after.',
    { muted: true });

  /* 11 ────────────────────────────────────────────────────────────────── */
  H(11, 'What the platform earns', kn('sec_earnings'));

  P('Set out in full, unasked. A vendor unwilling to show their own margin is a vendor whose '
  + 'other figures are worth checking.');

  TABLE(
    [{ label: 'On one car ticket', w: 232 },
     { label: 'Collect and transfer', w: 118, align: 'right' },
     { label: 'Split at the gateway', w: TEXT_W - 350, align: 'right' }],
    [
      ['Collected from the visitor',
       `Rs. ${rs(settle.direct.collected)}`, `Rs. ${rs(settle.split.collected)}`],
      ['Entry fee to the department',
       `Rs. ${rs(settle.direct.entry_paise)}`, `Rs. ${rs(settle.split.entry_paise)}`],
      ['ServerPe service and convenience fee, gross',
       `Rs. ${rs(settle.direct.platform_paise)}`, `Rs. ${rs(settle.split.platform_paise)}`],
      [`Less payment gateway (${settle.direct.gateway_effective}% including GST)`,
       `- Rs. ${rs(settle.direct.gateway_paise)}`, `- Rs. ${rs(settle.split.gateway_paise)}`],
      ['Less Route transfer charge', '-', `- Rs. ${rs(settle.split.transfer_paise)}`],
      ['Less GST on the service and convenience fee, net of input credit',
       `- Rs. ${rs(settle.direct.gst_payable_paise)}`, `- Rs. ${rs(settle.split.gst_payable_paise)}`],
      ['Retained by ServerPe',
       `Rs. ${rs(settle.direct.net_profit_paise)}`, `Rs. ${rs(settle.split.net_profit_paise)}`],
    ]);

  P('The GST inside the service and convenience fee is collected, not earned, and is remitted to '
  + `the government. Describing Rs. ${rs(settle.split.cash_retained_paise)} as profit would `
  + 'overstate it; the final line is the honest figure.', { muted: true });

  P('Illustrative calculation based on Razorpay commercial rates communicated for this proposal: '
  + `${settle.direct.gateway_percent}% payment gateway fee + ${settle.direct.gst_percent}% GST on `
  + `the gateway fee, and ${settle.split.transfer_percent}% Route transfer fee + `
  + `${settle.split.gst_percent}% GST on the transfer fee. The transfer fee is applied here to the `
  + 'full transaction value, which is the dearest of the possible bases; if the gateway confirms a '
  + 'narrower basis, ServerPe\'s margin improves and nothing else changes. Final charges and '
  + 'settlement structure subject to the Razorpay agreement and applicable taxes.',
    { muted: true, size: 7.5 });

  P(`At ${inr(dailyVehicles)} vehicles a day over 300 operating days and a quarter of capacity `
  + `taken up, the department collects approximately `
  + `Rs. ${inr(Math.round(yearly.scenarios[0].department_paise / 100))} in a year and ServerPe `
  + `retains approximately Rs. ${inr(Math.round(yearly.scenarios[0].net_profit_paise / 100))}.`,
    { bold: true });

  /* 12 ────────────────────────────────────────────────────────────────── */
  H(12, 'What has been invested in the platform', kn('sec_investment'));

  P('The system was built and is run by a proprietorship working from a home office. That is why '
  + 'the charge to the department can be as small as it is, and these figures are given so the '
  + 'claim can be checked rather than taken on trust.');

  TABLE(
    [{ label: 'Item', w: 132 },
     { label: 'Expense range', w: 106, align: 'right' },
     { label: 'Invested so far', w: 100, align: 'right' },
     { label: 'Recurs', w: 56 },
     { label: 'Status', w: TEXT_W - 394 }],
    invSummary.rows.map((r) => [
      r.item,
      r.expense_max ? `Rs. ${inr(r.expense_min)}-${inr(r.expense_max)}` : '-',
      r.invested_max ? `Rs. ${inr(r.invested_min)}-${inr(r.invested_max)}` : '-',
      r.kind === 'annual' ? 'Yearly' : r.kind === 'monthly' ? 'Monthly' : 'Once',
      { done: 'Done', in_place: 'In place', planned: 'Planned', needed: 'Needed' }[r.status]
        || r.status,
    ]));

  P('Expense is what these items cost. Invested is what has actually been committed to this '
  + 'project, which is lower because the laptop was already owned and the server, tooling and '
  + `office are shared with ServerPe's first product. Running cost of operation is `
  + `Rs. ${inr(invSummary.annual.min)} to Rs. ${inr(invSummary.annual.max)} a year, against the `
  + `proposed maintenance charge of Rs. ${amcRs} per gate.`, { muted: true });

  /* 13 ────────────────────────────────────────────────────────────────── */
  H(13, 'When a site must close', kn('sec_closure'));

  P('Heavy rain, a landslide, a VIP visit or a maintenance day are handled as one procedure. '
  + 'An officer selects the date and, if required, a single slot, and writes the reason in '
  + 'plain words.');

  P('Before anything happens the panel states exactly what will follow — how many tickets are '
  + 'affected, their total value, and how many visitors will be contacted. Only then is the '
  + 'closure confirmed.');

  BULLETS([
    ['Every affected visitor is told.', 'Nobody is left to discover a closed barrier after a '
     + 'three-hour drive.'],
    ['They are offered another date first.', 'Moving a ticket costs nothing and keeps the '
     + 'department\'s collection in place. The ticket keeps its number and is re-issued with a '
     + 'new signed code; the old code stops working by itself.'],
    ['A full refund is available on request.', 'A visitor who cannot come another day receives '
     + `the entire amount back within ${cfg.refund_working_days || '5-7'} working days.`],
  ]);

  /* 9 ─────────────────────────────────────────────────────────────────── */
  doc.addPage(); doc.y = M;
  H(14, 'What the department can see', kn('sec_oversight'));

  P('A web-based administration panel, accessible to officers on any browser, with accounts '
  + 'that can view everything but change nothing where that is appropriate.');

  BULLETS([
    ['Daily position', 'vehicles entered, amount collected, how full each slot is, and how '
     + 'many attempts the gate refused.'],
    ['The gate log', 'every scan with the staff member, checkpost and time — and a filter '
     + 'showing only the refusals, which is the measure of what the system is preventing.'],
    ['Revenue and GST', 'the department\'s entry fee and the service and convenience fee kept separate, day '
     + 'by day, with downloadable reports in a spreadsheet format.'],
    ['Audit trail', 'every action taken by every officer in the panel, with time and account.'],
  ]);

  P('Daily, weekly and monthly reports can be downloaded at any time. The department does not '
  + 'depend on ServerPe to produce a figure.');

  /* 10 ────────────────────────────────────────────────────────────────── */
  H(15, 'Data protection', kn('sec_privacy'));

  P('The system holds the least it can:');

  TABLE(
    [{ label: 'Stored', w: 240 }, { label: 'Never stored', w: TEXT_W - 240 }],
    [
      ['Mobile number', 'Owner name'],
      ['Vehicle registration number', 'Owner address'],
      ['Vehicle type, make and model', 'Chassis number'],
      ['Ticket, payment and scan records', 'Engine number'],
    ]);

  P('The vehicle type is read from the government registration record only to charge the '
  + 'correct fee. The visitor is told this and agrees to it before any lookup is made, and '
  + 'the consent is recorded with a timestamp.');

  P('The system never sends an unsolicited message. A visitor hears from it only after they '
  + 'have written to it, or when their own booking is affected.');

  /* 11 ────────────────────────────────────────────────────────────────── */
  H(16, 'What is required from the department', kn('sec_required'));

  BULLETS([
    'Approval to operate at the Mullayanagiri checkpost, and confirmation of the entry fee '
    + 'for each vehicle type.',
    'Permission for two phones to be used at the barrier. The phones are supplied by ServerPe '
    + 'at its own cost, along with the connection on them; the department buys no hardware and '
    + 'no specialised scanner is needed.',
    'The names of the checkpost staff who should be issued PINs, and of the officers who '
    + 'should have panel access.',
    'A decision on how the entry fee collected is to be settled to the department, and how '
    + 'often.',
  ]);

  P('Nothing else. There is no software to install, no server for the department to run and '
  + 'no recurring cost.');

  /* 17 ────────────────────────────────────────────────────────────────── */
  doc.addPage(); doc.y = M;
  H(17, 'Under what instrument this may be sanctioned', kn('sec_instrument'));

  P('This proposal is for a non-exclusive, no-cost pilot, sanctioned administratively for one '
  + 'season and terminable by the department at thirty days\' notice, with the existing paper '
  + 'ticketing continuing in parallel throughout.');

  P('It is set out here because the question of what to sign is properly the first question an '
  + 'officer asks, and it is not the vendor\'s place to leave it unanswered.');

  P('WHY THIS IS NOT A PROCUREMENT', { bold: true, gap: 6 });

  P('The Karnataka Transparency in Public Procurements Act governs the spending of public '
  + 'money. Five features of this arrangement, taken together, place it outside that:');

  BULLETS([
    ['No public expenditure.', 'The department pays nothing for the system itself. There is no '
      + 'procurement because nothing is being bought.'],
    ['No revenue foregone.', `The department receives Rs. ${carEntry} of every Rs. ${carEntry} `
      + 'entry fee, exactly as it does today. No right of value to the exchequer is transferred, '
      + 'so this is not the disposal of a public asset that would ordinarily require auction.'],
    ['Non-exclusive.', 'The counter continues to sell paper tickets, and the department remains '
      + 'free to permit any other party to operate on identical terms. No monopoly is sought and '
      + 'none is granted.'],
    ['Terminable at will, and short.', 'One season, thirty days\' notice, no cause required and '
      + 'no compensation payable. No successor in office is bound by it.'],
    ['Optional to the visitor, and capped by the department.',
      'The service and convenience fee is charged only to the visitor who chooses this channel, '
      + 'at a ceiling the department fixes. In approving that ceiling the department acts as '
      + 'regulator, not as payer.'],
  ]);

  P('The first two are the load-bearing points. The department neither spends money nor gives '
  + 'up money, and both facts are verifiable from the settlement records the system produces.');

  P('THE SIZE OF WHAT IS BEING SANCTIONED', { bold: true, gap: 6 });

  P('The department is not being asked to replace its ticketing system. It is being asked to '
  + 'permit one additional, optional channel alongside it. Nothing existing is withdrawn, no '
  + 'price changes, no method of buying a ticket is removed, and the arrangement can be stopped '
  + 'within a month. That is a materially smaller thing to sanction than a replacement, and it '
  + 'is what is proposed.');

  P('WHAT WOULD BE SIGNED', { bold: true, gap: 6 });

  P('A memorandum of understanding of two to four pages, with four annexures. A draft '
  + 'accompanies this proposal and may be amended in any respect by the department\'s law '
  + 'officer.');

  TABLE([
    { label: 'Annexure', w: 90 },
    { label: 'What it settles', w: TEXT_W - 90 },
  ], [
    ['A', 'The service fee ceiling, what is remitted to the department, and the account and '
        + 'timing of settlement.'],
    ['B', 'Ownership of the data, and its handover to the department in open formats on exit.'],
    ['C', 'Support hours, response times, the grievance contact, and the paper fallback.'],
    ['D', 'Termination — at will, thirty days, no cause, no compensation.'],
  ]);

  P('IF A TENDER IS NEVERTHELESS CONSIDERED NECESSARY', { bold: true, gap: 6 });

  P('If the view of the department\'s legal advisor is that a competitive process is required, '
  + 'ServerPe will participate in it. In that event we ask only to operate one slot as an unpaid '
  + 'proof of concept while that process runs, so that the department can judge the system on '
  + 'evidence from its own gate rather than on assertions in a document.');

  P('The reasoning in this section is offered for the department\'s legal advisor to examine, '
  + 'not as legal advice. ServerPe is not qualified to give it.', { muted: true, size: 9 });

  /* 17b ─────────────────────────────────────────── grievances and support */
  H(18, 'Complaints and grievances', kn('sec_grievance'));

  P('A visitor who is unhappy — a payment made without a ticket arriving, a refusal at the '
  + 'barrier believed to be wrong, a question about the fee — must have somewhere to go that is '
  + 'not the department.');

  BULLETS([
    ['Support is in the conversation itself.', 'Every visitor already has the WhatsApp thread in '
      + 'which they booked. Support is a menu option there, so the complaint arrives with the '
      + 'ticket, the payment and the scan history already attached to it.'],
    ['A named person answers, not a queue.',
      `Complaints are handled by ${cfg.proprietor_name || 'the proprietor'} personally, on `
      + `${cfg.support_mobile || 'the published support number'}. Answered the same day.`],
    ['If it reaches the department instead.', 'Anything received at the Deputy Commissioner\'s '
      + 'office may be passed to that number, and the department will be told what was done. The '
      + 'department should not be answering questions about a system it did not build.'],
    ['Every complaint is on the record.', 'Support conversations, refusals at the gate and '
      + 'refunds are all visible in the department\'s panel. The complaint count is one of the '
      + 'measures the pilot is judged on at three months.'],
  ]);

  /* 19 ────────────────────────────────────────────────────────────────── */
  doc.addPage(); doc.y = M;
  H(19, 'What is proposed after the first season',
    'ಮೊದಲ ಋತುವಿನ ನಂತರ ಪ್ರಸ್ತಾವಿತ ಸುಧಾರಣೆಗಳು');

  P('Nothing in this section is promised for the first season. It is set out so the department '
  + 'can see the direction of travel and object to any of it now rather than later.');

  P('ENHANCEMENTS — no additional charge to the visitor, no charge to the department.',
    { bold: true, gap: 6 });

  TABLE(
    [{ label: 'Enhancement', w: 128 },
     { label: 'What it does and why', w: 280 },
     { label: 'Status', w: TEXT_W - 408 }],
    ROADMAP.ENHANCEMENTS.map((e) => [
      e.title,
      `${e.what}  ${e.why}`,
      e.status === 'built' ? 'Built' : 'Planned',
    ]));

  P('The postponement limit is the department\'s to set. One free change of date has been '
  + 'requested and is what the system is configured for; it is a setting rather than a code '
  + 'change, so it can be revised after a season\'s experience.', { muted: true });

  P('REVENUE FEATURES — each requires the department\'s approval before it can exist.',
    { bold: true, gap: 6 });

  TABLE(
    [{ label: 'Feature', w: 120 },
     { label: 'What it would charge for', w: 210 },
     { label: 'The risk in it', w: TEXT_W - 330 }],
    ROADMAP.REVENUE.map((r) => [r.title, r.what, r.caution]));

  P('In every case the ordinary allocation remains at the ordinary price, and no rate of any '
  + 'kind is changed without the department\'s written approval. The risks are stated alongside '
  + 'each feature because a roadmap showing only the upside is a sales document rather than a '
  + 'plan, and because two of these could — if implemented carelessly — undermine the capacity '
  + 'limit this system exists to enforce.', { muted: true });

  P('TATKAL, WORKED THROUGH', { bold: true, gap: 6 });

  P(`Of the features above, tatkal is the only one that earns the department money, so it is set `
  + `out in full. ${tk.reserve_percent}% of each car slot would be held back from advance sale `
  + `and released to visitors arriving without a ticket, on weekends and public holidays only, `
  + `at an entry fee the department sets higher — illustrated here at Rs. ${rs(tk.entry_paise)} `
  + `becoming Rs. ${rs(tk.tatkal_entry_paise)}.`);

  TABLE([
    { label: '', w: TEXT_W - 210 },
    { label: 'Per slot', w: 70, align: 'right' },
    { label: 'Per day', w: 70, align: 'right' },
    { label: 'Per year', w: 70, align: 'right' },
  ], [
    ['Tatkal places reserved', String(tk.per_slot), String(tk.per_day),
      inr(tk.tickets_per_year)],
    [`Uplift on the entry fee (Rs. ${rs(tk.entry_paise)} to Rs. ${rs(tk.tatkal_entry_paise)})`,
      `Rs. ${rs(tk.uplift_paise)}`, '—', '—'],
    ['Additional revenue to the department', '—',
      `Rs. ${inr(rs(tk.department_extra_per_day_paise))}`,
      `Rs. ${inr(rs(tk.department_extra_per_year_paise))}`],
    [`ServerPe fee at ${tk.fee_percent}%, on the higher base`,
      `Rs. ${rs(tk.fee_tatkal_paise)}`,
      `+ Rs. ${rs(tk.platform_extra_per_ticket_paise)}`,
      `Rs. ${inr(rs(tk.platform_extra_per_year_paise))}`],
  ]);

  P(`The whole of the Rs. ${rs(tk.uplift_paise)} uplift is the department's, because the entry `
  + 'fee is the department\'s and only the department may set it. ServerPe earns nothing from '
  + 'the uplift itself; its percentage rises only because the base it is charged on rose. The '
  + `figures assume ${tk.peak_days} peak days in a year and are illustrative — the reserve `
  + 'percentage, the rate and the days it applies are all for the department to fix.',
    { muted: true });

  P('The reserve must be small and published. A large or unpublished reserve would be '
  + 'indistinguishable from selling around the capacity limit, and would deserve the objection '
  + 'it would attract.', { muted: true });

  /* 19b ───────────────────────────────── who controls the pricing */
  H(20, 'Who controls the pricing', kn('sec_pricing_control'));

  P('The department fixes every rate. ServerPe configures what the department has approved, and '
  + 'nothing else. This is stated as an undertaking rather than left to be asked about:');

  BULLETS([
    ['Configured only on written approval.', 'Every rate — the entry fee for each vehicle '
      + 'category, any tatkal rate, and the service and convenience fee — is entered into the '
      + 'system only after the department has approved it in writing.'],
    ['Immediate suspension if a rate is found altered.', 'If any rate is found to have been '
      + 'changed without that approval, the department may suspend or terminate this arrangement '
      + 'immediately, without notice and without showing cause, and without any compensation '
      + 'being payable.'],
    ['The gate continues regardless.', 'From the moment of suspension the existing booking and '
      + 'ticketing process continues exactly as it does today. Nothing at the barrier depends on '
      + 'this system remaining in place, which is what makes immediate suspension a real option '
      + 'rather than a threat nobody could afford to carry out.'],
    ['Every change is logged.', 'Each rate change records who made it, when, and what the rate '
      + 'was before. The department can audit the history in its own panel without asking '
      + 'ServerPe for anything.'],
  ]);

  P('We are asking to be trusted with the department\'s pricing. The proper answer to that is '
  + 'not a promise from us; it is a switch the department can throw without our agreement and a '
  + 'log it can read without our help. Both exist.', { muted: true });

  /* 19 ────────────────────────────────────────────────────────────────── */
  doc.addPage(); doc.y = M;
  H(21, 'Decisions, permissions and information required',
    'ಬೇಕಾದ ನಿರ್ಧಾರಗಳು, ಅನುಮತಿಗಳು ಮತ್ತು ಮಾಹಿತಿ');

  P(`${REQ.REQUIREMENTS.length} items, grouped by who answers them. The right-hand column is left `
  + 'blank deliberately: a sheet with empty boxes gets filled in, where agreement in principle '
  + 'does not.');

  P('Three of these have real lead time and are worth settling at the first meeting: which '
  + 'WhatsApp number the public will use, a single named officer to deal with, and permission for '
  + 'a live trial at the checkpost. Everything else can follow.', { bold: true });

  for (const [key, g] of Object.entries(REQ.GROUPS)) {
    const rows = REQ.byGroup(key);
    if (!rows.length) continue;

    if (doc.y > 620) { doc.addPage(); doc.y = M; }
    doc.y += 12;
    if (HAS_KN) {
      doc.fillColor(ACCENT).font('kn-bold').fontSize(10.5)
         .text(g.kn, M, doc.y, { width: TEXT_W });
    }
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8.5)
       .text(g.en.toUpperCase(), M, doc.y + 1, { width: TEXT_W, characterSpacing: 0.8 });
    doc.y += 6;

    TABLE(
      [{ label: 'What we need', w: 138 },
       { label: 'Why', w: 218 },
       { label: 'By when', w: 60 },
       { label: 'Answer', w: TEXT_W - 416 }],
      rows.map((r) => [r.item, r.why, r.needed, '']));
  }

  P('ServerPe will not issue staff PINs, nor print anything carrying the department emblem, until '
  + 'the permissions above are held in writing.', { muted: true });

  /* 19 ────────────────────────────────────────────────────────────────── */
  H(22, 'Present status', kn('sec_status'));

  P('The system described here is built and working. A live demonstration can be given on '
  + 'request, covering:');

  BULLETS([
    'A visitor booking a ticket on WhatsApp and paying, end to end.',
    'A deliberate attempt to alter that ticket, and the gate refusing it.',
    'The same ticket presented twice, and the second attempt being caught.',
    'A checkpost phone verifying a ticket with its network connection switched off.',
    'The administration panel showing all of the above as it happens.',
  ]);

  /* 15 ────────────────────────────────────────────────────────────────── */
  H(23, 'Beyond this site', kn('sec_beyond'));

  P('THE SAME TERMS APPLY AT ANY FURTHER SITE. Should the department later wish to extend this '
  + 'arrangement — a Kudremukha trek permit, a waterfall, a heritage gate — no fresh commercial '
  + `negotiation is required. A service and convenience fee of ${feePct}% of that site's own entry `
  + 'fee is charged to the visitor on the same basis, and the department receives that site\'s '
  + 'entry fee in full and without deduction, exactly as here. The only addition is the annual '
  + `maintenance charge: approximately Rs. ${inr(Math.round(amcPaise / 100 * 0.75))} a year for an `
  + `additional site, or Rs. ${inr(Math.round(amcPaise / 100 * 0.4))} for a further gate at a site `
  + 'already running.', { bold: true });

  P('This is stated here so that a successful trial at Mullayanagiri does not become a fresh '
  + 'negotiation elsewhere. The terms are intended to scale with the department rather than '
  + 'against it.', { muted: true });

  P(`${PRODUCT} is not built for one hill. Places, time slots, vehicle types, prices and `
  + 'capacities are all configuration rather than software, so a second entry point — another '
  + 'peak, a waterfall, a heritage site, a park — is added by an administrator in an afternoon '
  + 'and shares the same checkpost application, the same reports and the same signing '
  + 'infrastructure.');

  P('Each site keeps its own prices, its own capacity, its own staff and its own accounts. '
  + 'What they share is the part that must never differ: how a ticket is signed and how it is '
  + 'verified at a gate.');

  /* ─────────────────────────────────────────────────────── acceptance */

  if (doc.y > 560) { doc.addPage(); doc.y = M; }
  doc.y += 26;

  doc.moveTo(M, doc.y).lineTo(W - M, doc.y).lineWidth(1).strokeColor(ACCENT).stroke();
  doc.y += 16;

  doc.fillColor(INK).font(HAS_KN ? 'kn-bold' : 'Helvetica-Bold').fontSize(12)
     .text((HAS_KN ? kn('acceptance') + '  ·  ' : '') + 'Acceptance', M, doc.y);
  doc.y += 6;
  doc.fillColor(MUTED).font('Helvetica').fontSize(9.5)
     .text('Signed below, this proposal may be treated as the basis of the engagement for the '
         + `term stated (${cfg.contract_term || '1 year, renewable'}).`,
           M, doc.y, { width: TEXT_W, lineGap: 1.5 });

  const sigTop = doc.y + 26;
  const colW = (TEXT_W - 40) / 2;
  const sigBlock = (x, who, org) => {
    doc.moveTo(x, sigTop + 46).lineTo(x + colW, sigTop + 46)
       .lineWidth(0.75).strokeColor(RULE).stroke();
    doc.fillColor(INK).font(HAS_KN ? 'kn-bold' : 'Helvetica-Bold').fontSize(9.5)
       .text(who, x, sigTop + 52, { width: colW });
    doc.fillColor(MUTED).font('Helvetica').fontSize(8.5)
       .text(org, x, sigTop + 65, { width: colW });
    doc.fillColor(MUTED).font('Helvetica').fontSize(8.5)
       .text('Name, designation and date', x, sigTop + 82, { width: colW });
  };
  sigBlock(M, (HAS_KN ? kn('for_department') + '  ·  ' : '') + 'For the Department',
    'Karnataka Tourism Department, Chikkamagaluru');
  sigBlock(M + colW + 40, `For ${cfg.merchant_name || 'ServerPe App Solutions'}`,
    `${PRODUCT}${cfg.support_mobile ? '  ·  ' + cfg.support_mobile : ''}`);

  /* ─────────────────────────────────────────────────────── page furniture */

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    if (i > range.start) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(7.5)
         .text('Mullayanagiri vehicle entry ticketing — proposal', M, 34,
               { width: TEXT_W / 2 });
      doc.text(`Page ${i - range.start + 1} of ${range.count}`, W / 2, 34,
               { width: TEXT_W / 2, align: 'right' });
      doc.moveTo(M, 48).lineTo(W - M, 48).lineWidth(0.4).strokeColor('#e5e7eb').stroke();
    }
    doc.fillColor(MUTED).font('Helvetica').fontSize(7.5)
       .text(`${cfg.merchant_name || 'ServerPe App Solutions'}   ·   `
           + `${cfg.support_mobile ? 'Contact ' + cfg.support_mobile : ''}`,
             M, 792, { width: TEXT_W / 2 });
    /* Marked on every page, not only the cover: a proposal circulating in a
       district office is read a page at a time and photocopied in parts. */
    if (HAS_KN) {
      doc.fillColor(MUTED).font('kn').fontSize(7.5)
         .text('ಗೌಪ್ಯ  ·  CONFIDENTIAL', M + TEXT_W / 2, 792,
               { width: TEXT_W / 2, align: 'right' });
    } else {
      doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(7.5)
         .text('CONFIDENTIAL', M + TEXT_W / 2, 792,
               { width: TEXT_W / 2, align: 'right', characterSpacing: 0.8 });
    }
  }

  doc.end();
  // Waited on rather than slept on: a timeout that is long enough today
  // truncates the file on a slower machine.
  await new Promise((res, rej) => { stream.on('finish', res); stream.on('error', rej); });
  console.log(`\n  Written: ${OUT}  (${range.count} pages)\n`);
  process.exit(0);
})().catch((e) => { console.error('\n', e, '\n'); process.exit(1); });
