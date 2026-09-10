/**
 * scripts/make-mou.js — the draft memorandum of understanding.
 *
 *   node scripts/make-mou.js [outfile.pdf]
 *
 * The instrument the proposal asks the department to sign. Kept deliberately
 * short: a memorandum a law officer can read in one sitting gets amended and
 * returned; one that runs to twenty pages gets put in a file and forgotten.
 *
 * Two things this document does that a vendor's draft usually does not:
 *
 *   It gives the department the easier side of every clause it can — thirty
 *   days' termination without cause, no compensation, no exclusivity, no
 *   lock-in, data handed back in open formats. None of that costs ServerPe
 *   anything it should be unwilling to give, and each removed objection is
 *   worth more than the protection it trades away.
 *
 *   It is marked DRAFT on every page. This is not the department's document
 *   until their law officer has been through it, and pretending otherwise is
 *   how a vendor loses the room.
 *
 * Generated rather than typed so the fee percentage, the entry fee and the
 * firm's particulars cannot drift from the system being demonstrated beside it.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { query, one } = require('../src/gatepass/db');
const settings = require('../src/gatepass/settings');

const OUT = process.argv[2]
  || path.join(process.cwd(), 'docs', 'Entry-ticketing-MoU-draft.pdf');

const INK = '#111827';
const MUTED = '#4b5563';
const RULE = '#9ca3af';
const ACCENT = '#0f4f48';
const ALARM = '#b91c1c';

const M = 62;
const W = 595.28;
const H_PAGE = 841.89;
const TEXT_W = W - M * 2;

(async () => {
  const cfg = await settings.all();
  const place = await one(`SELECT * FROM places WHERE code = 'MULLAYANAGIRI'`);
  const pricing = (await query(
    `SELECT pp.*, vc.label, vc.code FROM place_pricing pp
       JOIN vehicle_categories vc ON vc.id = pp.category_id
      WHERE pp.place_id = $1 AND pp.is_active ORDER BY vc.sort_order`, [place.id])).rows;

  const rs = (p) => (p % 100 === 0 ? String(p / 100) : (p / 100).toFixed(2));
  const inr = (n) => Number(n).toLocaleString('en-IN');
  const val = (k, f = '[ to be filled ]') => (cfg[k] && String(cfg[k]).trim() ? cfg[k] : f);

  const feePct = Number(cfg.platform_fee_percent || 13);
  const amcRs = inr(Number(cfg.amc_per_gate_annual_paise || 12000000) / 100);
  const carEntry = pricing.find((p) => p.code === 'CAR')?.entry_paise || 10000;
  const carFee = pricing.find((p) => p.code === 'CAR')?.platform_paise || 1300;
  const FIRM = val('legal_name', 'ServerPe App Solutions');

  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true,
    info: {
      Title: 'Memorandum of understanding — entry ticketing (DRAFT)',
      Author: FIRM,
      Subject: 'Draft MoU for a non-exclusive no-cost pilot at ' + place.name,
    } });

  const FONTS = path.join(__dirname, '..', 'assets', 'fonts');
  const HAS_KN = fs.existsSync(path.join(FONTS, 'NotoSansKannada-Regular.ttf'));
  if (HAS_KN) {
    doc.registerFont('kn', path.join(FONTS, 'NotoSansKannada-Regular.ttf'));
    doc.registerFont('kn-bold', path.join(FONTS, 'NotoSansKannada-Bold.ttf'));
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  /* Held so the process can wait for it. PDFKit writes asynchronously, and
     exiting on doc.end() truncates the file — or, as happened here, leaves no
     file at all. */
  const stream = fs.createWriteStream(OUT);
  doc.pipe(stream);

  /* ───────────────────────────────────────────────────────────── helpers */

  const page = () => { doc.addPage(); doc.y = M; };

  /** A numbered clause heading, Kannada above the English where we have it. */
  const CL = (n, title, knTitle) => {
    if (doc.y > 690) page();
    doc.y = doc.y + (doc.y <= M ? 0 : 16);
    if (knTitle && HAS_KN) {
      doc.fillColor(ACCENT).font('kn-bold').fontSize(11.5)
         .text(`${n}.  ${knTitle}`, M, doc.y, { width: TEXT_W, lineGap: 1 });
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(10.5)
         .text(title, M + 16, doc.y + 1, { width: TEXT_W - 16 });
    } else {
      doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(11.5)
         .text(`${n}.  ${title}`, M, doc.y, { width: TEXT_W });
    }
    doc.y += 6;
  };

  /** A sub-clause: 3.1, 3.2 … hanging indent so the numbers line up. */
  const SUB = (n, text, opts = {}) => {
    if (doc.y > 745) page();
    const top = doc.y;
    doc.fillColor(MUTED).font('Helvetica').fontSize(9.5).text(n, M, top, { width: 30 });
    doc.fillColor(opts.muted ? MUTED : INK)
       .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5)
       .text(text, M + 32, top, { width: TEXT_W - 32, lineGap: 1.8 });
    doc.y += 7;
  };

  const P = (text, opts = {}) => {
    if (doc.y > 745) page();
    doc.fillColor(opts.muted ? MUTED : INK)
       .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.size || 9.5)
       .text(text, M, doc.y, { width: TEXT_W, lineGap: 1.8, align: opts.align || 'left' });
    doc.y += opts.gap ?? 9;
  };

  const KP = (text, opts = {}) => {
    if (!HAS_KN) return;
    if (doc.y > 745) page();
    doc.fillColor(opts.muted ? MUTED : INK).font(opts.bold ? 'kn-bold' : 'kn')
       .fontSize(opts.size || 10)
       .text(text, M, doc.y, { width: TEXT_W, lineGap: 2.5 });
    doc.y += opts.gap ?? 8;
  };

  /* ───────────────────────────────────────────────────────────── cover */

  doc.rect(0, 0, W, 6).fill(ACCENT);

  const EMBLEM = path.join(__dirname, '..', 'assets', 'logos', 'karnataka-tourism-emblem-192.png');
  if (fs.existsSync(EMBLEM)) doc.image(EMBLEM, M, 40, { width: 50 });

  doc.y = 104;

  /* The draft marking, first thing on the page and unmissable. A vendor who
     hands over something that looks final has already lost an argument they
     did not need to have. */
  doc.rect(M, doc.y, TEXT_W, 34).fill('#fdecec');
  doc.fillColor(ALARM).font('Helvetica-Bold').fontSize(9.5)
     .text('DRAFT FOR DISCUSSION — subject to amendment in any respect by the '
         + 'department\'s law officer. Not an offer capable of acceptance until signed by both '
         + 'parties.', M + 10, doc.y + 8, { width: TEXT_W - 20, lineGap: 1.5 });
  doc.y += 46;

  if (HAS_KN) {
    doc.fillColor(INK).font('kn-bold').fontSize(19)
       .text('ಪರಸ್ಪರ ಒಪ್ಪಂದ ಪತ್ರ', M, doc.y, { width: TEXT_W, lineGap: 2 });
    doc.y += 2;
  }
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(15)
     .text('Memorandum of understanding', M, doc.y, { width: TEXT_W });
  doc.y += 6;
  doc.fillColor(MUTED).font('Helvetica').fontSize(10.5)
     .text(`A non-exclusive, no-cost pilot for digitally verified vehicle entry ticketing at `
         + `${place.name}, ${place.district}`, M, doc.y, { width: TEXT_W - 30, lineGap: 2 });

  doc.y += 26;
  doc.moveTo(M, doc.y).lineTo(W - M, doc.y).lineWidth(0.75).strokeColor(RULE).stroke();
  doc.y += 20;

  const meta = [
    ['Between', 'The Office of the Deputy Commissioner, Chikkamagaluru\n(or the department '
      + 'having charge of the checkpost) — "the Department"'],
    ['And', `${FIRM}, a sole proprietorship\nGSTIN ${val('gstin')} · Udyam ${val('udyam_number')}`
      + ' — "the Service Provider"'],
    ['Site', `${place.name}, ${place.district}`],
    ['Term', 'One season, as defined in clause 3'],
    ['Cost to the Department', 'Nil during the pilot'],
    ['Date', '[ to be filled on execution ]'],
  ];
  for (const [k, v] of meta) {
    const top = doc.y;
    doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(k.toUpperCase(), M, top,
      { width: 130, characterSpacing: 0.9 });
    doc.fillColor(INK).font('Helvetica').fontSize(10)
       .text(v, M + 140, top - 1, { width: TEXT_W - 140, lineGap: 1.5 });
    doc.y = Math.max(doc.y, top) + 10;
  }

  doc.y += 8;
  doc.moveTo(M, doc.y).lineTo(W - M, doc.y).lineWidth(0.75).strokeColor(RULE).stroke();
  doc.y += 18;

  KP('ಈ ಒಪ್ಪಂದದ ಮೂಲಕ ಇಲಾಖೆ ಯಾವುದನ್ನೂ ಖರೀದಿಸುತ್ತಿಲ್ಲ ಮತ್ತು ಯಾವುದೇ ವೆಚ್ಚ ಭರಿಸುತ್ತಿಲ್ಲ. '
   + 'ಪ್ರವಾಸಿಗರಿಗೆ ಟಿಕೆಟ್ ಖರೀದಿಸಲು ಒಂದು ಹೆಚ್ಚುವರಿ ಐಚ್ಛಿಕ ಮಾರ್ಗವನ್ನು ಒದಗಿಸಲು ಮಾತ್ರ ಅನುಮತಿ '
   + 'ನೀಡಲಾಗುತ್ತಿದೆ. ಪ್ರವೇಶ ಶುಲ್ಕ ಪೂರ್ಣವಾಗಿ ಇಲಾಖೆಗೆ ತಲುಪುತ್ತದೆ.', { size: 10 });

  P('By this memorandum the Department purchases nothing and incurs no expenditure. It permits '
  + 'one additional, optional channel through which a visitor may buy the same entry ticket at '
  + 'the same entry fee. The entry fee reaches the Department in full. The existing counter and '
  + 'printed ticket continue unaffected throughout.', { muted: true });

  /* ─────────────────────────────────────────────────────────── clauses */

  page();

  CL(1, 'Purpose and scope', 'ಉದ್ದೇಶ ಮತ್ತು ವ್ಯಾಪ್ತಿ');
  SUB('1.1', 'The Service Provider shall make available, at its own cost, a system by which a '
    + `visitor may book and pay for entry to ${place.name} through WhatsApp, and shall issue for `
    + 'each booking a digitally signed QR entry ticket.');
  SUB('1.2', 'The ticket shall be verified at the checkpost by a scan which confirms the '
    + 'signature, the registration number, the date, the time slot and the vehicle category, and '
    + 'which functions without a network connection.');
  SUB('1.3', 'This is an additional channel. Nothing in this memorandum withdraws, replaces or '
    + 'restricts the Department\'s existing counter sale of printed tickets, which shall continue '
    + 'in parallel for the whole of the term.');
  SUB('1.4', 'THIS ARRANGEMENT IS NON-EXCLUSIVE. The Department may permit any other person to '
    + 'provide the same or a similar service, on the same or different terms, at any time and '
    + 'without reference to the Service Provider.', { bold: true });

  CL(2, 'No cost to the Department', 'ಇಲಾಖೆಗೆ ಯಾವುದೇ ವೆಚ್ಚವಿಲ್ಲ');
  SUB('2.1', 'The Department shall pay nothing for the system during the pilot term — no licence '
    + 'fee, no setup charge, no maintenance charge and no per-ticket charge.');
  SUB('2.2', 'All hardware required at the checkpost, including the phones used for scanning and '
    + 'the data connection on them, shall be supplied and paid for by the Service Provider.');
  SUB('2.3', 'The Department shall not be required to install any software, operate any server, '
    + 'or provide any technical facility.');
  SUB('2.4', 'For the avoidance of doubt, no public money is spent under this memorandum and no '
    + 'revenue of the Department is foregone.', { bold: true });

  CL(3, 'Term and termination', 'ಅವಧಿ ಮತ್ತು ರದ್ದತಿ');
  SUB('3.1', 'This memorandum takes effect on the date of signature and continues for one '
    + 'season, being the period from [ start date ] to [ end date ], unless terminated earlier.');
  SUB('3.2', 'THE DEPARTMENT MAY TERMINATE THIS MEMORANDUM AT ANY TIME, FOR ANY REASON OR NONE, '
    + 'BY THIRTY DAYS\' NOTICE IN WRITING. No compensation, damages, exit charge or payment of '
    + 'any kind shall be payable by the Department on such termination.', { bold: true });
  SUB('3.3', 'The Service Provider may terminate on ninety days\' notice in writing, such notice '
    + 'not to expire during a peak season without the Department\'s consent.');
  SUB('3.4', 'On termination the Service Provider shall cease issuing new tickets, shall honour '
    + 'all tickets already sold for dates falling within the following thirty days, and shall '
    + 'comply with clause 8 as to data.');
  SUB('3.5', 'Any continuation beyond the pilot term, and any charge for it, requires a fresh '
    + 'written agreement. Nothing in this memorandum obliges the Department to enter into one.');

  CL(4, 'The entry fee', 'ಪ್ರವೇಶ ಶುಲ್ಕ');
  SUB('4.1', 'The entry fee for each vehicle category is fixed by the Department alone. The '
    + 'Service Provider has no power to vary it. The rates in force at commencement are set out '
    + 'in Annexure A.');
  SUB('4.2', 'The entry fee collected from a visitor is collected by the Service Provider as pure '
    + 'agent of the Department and is at all times the money of the Department.');
  SUB('4.3', 'THE ENTRY FEE SHALL BE REMITTED TO THE DEPARTMENT IN FULL, WITHOUT ANY DEDUCTION '
    + 'WHATSOEVER. No commission, gateway charge, transfer charge, tax or expense of the Service '
    + 'Provider shall be set off against it.', { bold: true });
  SUB('4.4', 'Remittance shall be to the account and on the frequency stated in Annexure A, '
    + 'accompanied by a statement reconciling every ticket sold to every rupee remitted.');

  CL(5, 'The service and convenience fee', 'ಸೇವಾ ಮತ್ತು ಅನುಕೂಲ ಶುಲ್ಕ');
  SUB('5.1', `The Service Provider may charge the visitor a service and convenience fee not `
    + `exceeding ${feePct}% of the entry fee, being at present Rs. ${rs(carFee)} on a car entry `
    + `fee of Rs. ${rs(carEntry)}. The ceiling is fixed by the Department and is stated in `
    + 'Annexure A.');
  SUB('5.2', 'The fee is charged only to a visitor who chooses to use this channel. A visitor who '
    + 'buys at the counter pays the entry fee alone, as at present.');
  SUB('5.3', 'The fee shall be shown to the visitor separately from the entry fee, before '
    + 'payment, and shall be printed separately on the ticket and the receipt. It shall not at '
    + 'any time be described as a charge of the Department.');
  SUB('5.4', 'All payment gateway charges, transfer charges, taxes and operating costs of the '
    + 'Service Provider are met out of this fee. GST on the fee is the liability of the Service '
    + 'Provider, who shall raise a compliant tax invoice.');
  SUB('5.5', 'The fee may not be increased without the prior written approval of the Department.');

  CL('5A', 'Control of pricing', 'ದರ ನಿಯಂತ್ರಣ');
  SUB('5A.1', 'Every rate operated by the system — the entry fee for each vehicle category, any '
    + 'tatkal or peak-day rate, and the service and convenience fee — is fixed by the Department '
    + 'and is configured by the Service Provider only after written approval.');
  SUB('5A.2', 'IF ANY RATE IS FOUND TO HAVE BEEN CHANGED WITHOUT THAT APPROVAL, THE DEPARTMENT '
    + 'MAY SUSPEND OR TERMINATE THIS MEMORANDUM WITH IMMEDIATE EFFECT, without notice, without '
    + 'showing cause and without any compensation being payable. This right is in addition to '
    + 'clause 3.2 and is not subject to the notice period in it.', { bold: true });
  SUB('5A.3', 'On such suspension the Department\'s existing booking and ticketing process '
    + 'continues as before. Nothing at the checkpost depends on this system remaining in place.');
  SUB('5A.4', 'Every rate change is recorded in the Department\'s panel with the person who made '
    + 'it, the time, and the previous rate. The Department may audit that history at any time '
    + 'without reference to the Service Provider.');
  SUB('5A.5', 'A tatkal or peak-day rate, if approved, applies only to a published reserved '
    + 'allocation on days the Department designates. The whole of any uplift on the entry fee is '
    + 'the Department\'s revenue and is remitted under clause 4.3 like any other entry fee; the '
    + 'Service Provider takes no share of it.');

  CL(6, 'Obligations of the Service Provider', 'ಸೇವಾ ಒದಗಿಸುವವರ ಜವಾಬ್ದಾರಿಗಳು');
  SUB('6.1', 'To operate the system at its own cost and risk, and to keep it available during '
    + 'gate hours.');
  SUB('6.2', 'To train the Department\'s checkpost staff, issue individual PINs, and record every '
    + 'scan — including every refusal — against the staff member who made it.');
  SUB('6.3', 'To give the Department continuous access to a panel showing live occupancy, every '
    + 'booking, every scan, every refusal and the full settlement position, and to provide daily, '
    + 'weekly and monthly reports.');
  SUB('6.4', 'To conduct all visitor-facing communication in Kannada and English.');
  SUB('6.5', 'To handle visitor complaints itself, as set out in Annexure C, and not to direct '
    + 'visitors to the Department.');
  SUB('6.6', 'To comply with applicable law, including the Digital Personal Data Protection Act, '
    + '2023, in respect of all personal data handled under this memorandum.');
  SUB('6.7', 'To keep the Department informed of any failure affecting the gate, promptly and '
    + 'without being asked.');

  CL(7, 'Obligations of the Department', 'ಇಲಾಖೆಯ ಜವಾಬ್ದಾರಿಗಳು');
  SUB('7.1', 'To permit the Service Provider to operate the channel at the checkpost for the term.');
  SUB('7.2', 'To confirm the entry fee for each vehicle category, the daily capacity, the time '
    + 'slots, and any day on which the site is closed.');
  SUB('7.3', 'To nominate the staff to be issued PINs and the officers to be given panel access.');
  SUB('7.4', 'To nominate an officer as the point of contact for the pilot.');
  SUB('7.5', 'To permit use of the Department\'s name and emblem on the ticket and receipt for '
    + 'the sole purpose of identifying the site, in the form approved under Annexure A, and for '
    + 'no other purpose.');

  CL(8, 'Data — ownership, protection and handover', 'ಮಾಹಿತಿ — ಒಡೆತನ ಮತ್ತು ಹಸ್ತಾಂತರ');
  SUB('8.1', 'ALL DATA GENERATED UNDER THIS MEMORANDUM — bookings, payments, scans, refusals and '
    + 'reports — IS THE PROPERTY OF THE DEPARTMENT.', { bold: true });
  SUB('8.2', 'The Service Provider holds that data as processor on the Department\'s behalf, uses '
    + 'it only to operate the system and to meet its own statutory obligations, and shall not '
    + 'sell it, share it or use it for marketing.');
  SUB('8.3', 'The Department may take a full export at any time, in open formats (CSV and PDF), '
    + 'at no charge.');
  SUB('8.4', 'Within fifteen days of termination the Service Provider shall deliver a complete '
    + 'export to the Department and, once the Department confirms receipt, shall delete the '
    + 'personal data it holds except where law requires it to be retained.');
  SUB('8.5', 'There shall be no exit charge and no proprietary format. Nothing shall be withheld '
    + 'as leverage.');

  CL(9, 'Support, availability and grievances', 'ಬೆಂಬಲ ಮತ್ತು ದೂರುಗಳ ಪರಿಹಾರ');
  SUB('9.1', 'Support hours, response times and the named grievance contact are set out in '
    + 'Annexure C.');
  SUB('9.2', 'If the system is unavailable at the barrier for any reason, the Department\'s '
    + 'existing paper process shall be used, and no visitor shall be turned away on account of '
    + 'the failure. The Service Provider shall reconcile such entries afterwards.');
  SUB('9.3', 'A complaint received by the Department may be passed to the Service Provider, who '
    + 'shall answer it and report back what was done.');

  CL(10, 'Continuity', 'ನಿರಂತರತೆ');
  SUB('10.1', 'The Service Provider shall maintain a documented handover pack and shall nominate '
    + 'a person able to operate the system in the proprietor\'s absence. The nominee is named in '
    + 'Annexure C.');
  SUB('10.2', 'A copy of the source code and the operating documentation shall be placed in '
    + 'escrow with the Department or a person nominated by it, to be released to the Department '
    + 'if the Service Provider ceases to operate the system.');
  SUB('10.3', 'The signing keys used to issue tickets shall be held securely, backed up, and '
    + 'shall not leave the Service Provider\'s control.');

  CL(11, 'Records and audit', 'ದಾಖಲೆ ಮತ್ತು ಲೆಕ್ಕಪರಿಶೋಧನೆ');
  SUB('11.1', 'The Service Provider shall keep complete records of every ticket sold, every '
    + 'rupee collected and every rupee remitted, for not less than three years.');
  SUB('11.2', 'The Department, and any auditor appointed by it, may inspect those records at any '
    + 'time on reasonable notice.');
  SUB('11.3', 'The Service Provider shall assist any audit of the Department without charge.');

  CL(12, 'Review', 'ಪರಿಶೀಲನೆ');
  SUB('12.1', 'At three months the parties shall review the pilot against the measures in '
    + 'Annexure D. The Department\'s assessment on those measures is final.');

  CL(13, 'Liability', 'ಹೊಣೆಗಾರಿಕೆ');
  SUB('13.1', 'The Service Provider is responsible for the correct working of the system and '
    + 'shall indemnify the Department against any loss caused by its failure, negligence or '
    + 'breach of law.');
  SUB('13.2', 'Where a visitor has paid and, through a failure of the system, has not received a '
    + 'valid ticket, the Service Provider shall bear the cost of putting the matter right, '
    + 'including refunding the entry fee from its own funds without recourse to the Department.',
    { bold: true });
  SUB('13.3', 'The Department bears no liability to any visitor arising out of the operation of '
    + 'the channel.');

  CL(14, 'Relationship of the parties', 'ಪಕ್ಷಗಳ ಸಂಬಂಧ');
  SUB('14.1', 'Nothing in this memorandum creates a partnership, joint venture, agency (save as '
    + 'pure agent for the entry fee under clause 4.2) or contract of employment between the '
    + 'parties.');
  SUB('14.2', 'The Service Provider shall not hold itself out as acting for the Department beyond '
    + 'the collection of the entry fee, and shall not use the Department\'s name for publicity '
    + 'without prior written approval.');

  CL(15, 'General', 'ಸಾಮಾನ್ಯ');
  SUB('15.1', 'This memorandum may be amended only in writing, signed by both parties.');
  SUB('15.2', 'Neither party may assign it without the written consent of the other.');
  SUB('15.3', 'Any dispute shall first be referred to the nominated officer and the proprietor, '
    + 'and failing resolution within thirty days shall be subject to the jurisdiction of the '
    + `courts at ${place.district}.`);
  SUB('15.4', 'The Annexures form part of this memorandum.');

  /* ────────────────────────────────────────────────────────── annexures */

  page();
  doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(13)
     .text('Annexures', M, doc.y, { width: TEXT_W });
  doc.y += 4;
  doc.moveTo(M, doc.y).lineTo(W - M, doc.y).lineWidth(1).strokeColor(ACCENT).stroke();
  doc.y += 14;

  CL('A', 'Fees, remittance and approvals', 'ಶುಲ್ಕ ಮತ್ತು ಪಾವತಿ');
  P('Entry fee by vehicle category, as fixed by the Department:', { gap: 6 });

  {
    const rows = pricing.map((p) => [p.label, `Rs. ${rs(p.entry_paise)}`,
      `Rs. ${rs(p.platform_paise)}`, `Rs. ${rs(p.entry_paise + p.platform_paise)}`]);
    const cols = [
      { label: 'Vehicle category', w: 170 },
      { label: 'Entry fee (Department)', w: 110, align: 'right' },
      { label: `Service fee (max ${feePct}%)`, w: 110, align: 'right' },
      { label: 'Visitor pays', w: TEXT_W - 390, align: 'right' },
    ];
    let x = M;
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8);
    for (const c of cols) {
      doc.text(c.label.toUpperCase(), x, doc.y, { width: c.w, align: c.align || 'left',
        characterSpacing: 0.5 });
      x += c.w;
    }
    let ry = doc.y + 20;
    doc.moveTo(M, ry).lineTo(W - M, ry).lineWidth(0.75).strokeColor(RULE).stroke();
    let top = ry + 7;
    for (const r of rows) {
      x = M;
      cols.forEach((c, i) => {
        doc.fillColor(INK).font(i === 0 ? 'Helvetica' : 'Helvetica').fontSize(9.5)
           .text(String(r[i]), x, top, { width: c.w, align: c.align || 'left' });
        x += c.w;
      });
      top += 17;
      doc.moveTo(M, top - 4).lineTo(W - M, top - 4).lineWidth(0.4).strokeColor('#e5e7eb').stroke();
    }
    doc.y = top + 6;
  }

  P('To be completed by the Department before signature:', { bold: true, gap: 6 });
  SUB('A.1', 'Bank account to which the entry fee is to be remitted: ____________________');
  SUB('A.2', 'Head of account, if applicable: ____________________');
  SUB('A.3', 'Frequency of remittance (daily / weekly): ____________________');
  SUB('A.4', 'WhatsApp number to be published to visitors: ____________________');
  SUB('A.5', 'Form in which the Department\'s name and emblem may appear: attached / as '
    + 'demonstrated');
  SUB('A.6', `Approved ceiling on the service and convenience fee: ${feePct}% of the entry fee`);

  CL('B', 'Data ownership and handover', 'ಮಾಹಿತಿ ಒಡೆತನ');
  P('Gives effect to clause 8. The data listed below is the property of the Department and is '
  + 'exportable by it at any time in CSV and PDF.', { gap: 6 });
  SUB('B.1', 'Bookings — ticket number, date, slot, vehicle category, registration number, '
    + 'amount, payment reference, booking channel and time.');
  SUB('B.2', 'Scans — every scan and every refusal, with the verdict, the time, and the staff '
    + 'member who scanned.');
  SUB('B.3', 'Settlement — every rupee collected and every rupee remitted, reconciled per day.');
  SUB('B.4', 'Closures, postponements and refunds, with the reason recorded.');
  SUB('B.5', 'Personal data held: the visitor\'s mobile number and vehicle registration number. '
    + 'No other personal data is collected. Retention and deletion are governed by clause 8.4.');

  CL('C', 'Support, grievances and continuity', 'ಬೆಂಬಲ ಮತ್ತು ದೂರುಗಳು');
  SUB('C.1', `Support and grievance contact: ${val('proprietor_name')}, proprietor, on `
    + `${val('support_mobile')} and ${val('contact_email')}.`);
  SUB('C.2', `Response: ${val('sla_response', 'within 2 hours during gate hours, same day '
    + 'otherwise')}.`);
  SUB('C.3', 'Visitor support is provided inside the same WhatsApp conversation in which the '
    + 'ticket was bought, so that a complaint arrives with the ticket, payment and scan history '
    + 'attached. Complaints are answered the same day.');
  SUB('C.4', 'Anything received at the Department\'s office may be passed to the contact above; '
    + 'the Department will be told what was done.');
  SUB('C.5', 'Nominee able to operate the system in the proprietor\'s absence: '
    + '____________________ (name and number to be filled before signature).');
  SUB('C.6', 'Fallback: if the system is unavailable, the Department\'s existing paper process is '
    + 'used and no visitor is turned away.');

  CL('D', 'Measures for the three-month review', 'ಪರಿಶೀಲನೆಯ ಅಳತೆಗಳು');
  P('The pilot is to be judged on these, and the Department\'s assessment is final:', { gap: 6 });
  SUB('D.1', 'Tickets sold through the channel, against the previous season.');
  SUB('D.2', 'Altered or duplicated tickets refused at the barrier.');
  SUB('D.3', 'Average time a vehicle spends at the barrier.');
  SUB('D.4', 'Collections reconciled to the last rupee, with no unexplained difference.');
  SUB('D.5', 'Complaints received, and how they were resolved.');
  SUB('D.6', 'Whether checkpost staff find it easier than the process it sits beside.');

  /* ───────────────────────────────────────────────────────── signatures */

  if (doc.y > 560) page();
  doc.y += 24;
  doc.moveTo(M, doc.y).lineTo(W - M, doc.y).lineWidth(0.75).strokeColor(RULE).stroke();
  doc.y += 18;

  P('Signed for and on behalf of the parties:', { bold: true, gap: 20 });

  {
    const colW = (TEXT_W - 40) / 2;
    const top = doc.y;
    const block = (x, who, org) => {
      doc.moveTo(x, top + 54).lineTo(x + colW, top + 54).lineWidth(0.75)
         .strokeColor(INK).stroke();
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(9.5)
         .text(who, x, top + 60, { width: colW });
      doc.fillColor(MUTED).font('Helvetica').fontSize(9)
         .text(org, x, doc.y + 1, { width: colW, lineGap: 1.5 });
      doc.fillColor(MUTED).font('Helvetica').fontSize(8.5)
         .text('Date:                              Place:', x, doc.y + 8, { width: colW });
    };
    block(M, 'For the Department',
      'Office of the Deputy Commissioner, Chikkamagaluru\nName and designation:');
    doc.y = top;
    block(M + colW + 40, 'For the Service Provider',
      `${FIRM}\n${val('proprietor_name')}, Proprietor\nGSTIN ${val('gstin')}`);
  }

  /* ─────────────────────────────────────────── draft stamp on each page */

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    doc.fillColor(ALARM).font('Helvetica-Bold').fontSize(7.5)
       .text('DRAFT · CONFIDENTIAL — SUBJECT TO THE DEPARTMENT\'S AMENDMENT', M, H_PAGE - 40,
         { width: TEXT_W / 2, characterSpacing: 0.5 });
    doc.fillColor(MUTED).font('Helvetica').fontSize(7.5)
       .text(`${FIRM}   ·   Page ${i + 1} of ${range.count}`, M + TEXT_W / 2, H_PAGE - 40,
         { width: TEXT_W / 2, align: 'right' });
  }

  doc.end();
  await new Promise((res, rej) => { stream.on('finish', res); stream.on('error', rej); });
  console.log(`\n  Written: ${OUT}  (${range.count} pages)\n`);
  process.exit(0);
})().catch((e) => { console.error('\n', e, '\n'); process.exit(1); });
