/**
 * scripts/demo-qr.js — the fraud demonstration, on one screen.
 *
 *   node scripts/demo-qr.js               use the most recent paid ticket
 *   node scripts/demo-qr.js A7K2M9        use a specific ticket
 *
 * Writes a self-contained HTML page holding four QR codes for the SAME ticket:
 * the genuine one, and three attacks. Open it on a laptop, hold the checkpost
 * phone up to the screen, and scan them in order.
 *
 * WHY THIS EXISTS: the whole argument to the department is "an altered ticket is
 * refused". That claim is worth nothing described and everything demonstrated.
 * This puts the demonstration on a screen anyone can hold a phone to — no
 * second and third handset required.
 *
 * The forgeries are made the way a real forger would make them: take the
 * genuine payload and edit the characters that matter. That is exactly the
 * attack being defended against, so it is exactly what should be shown.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const { one } = require('../src/gatepass/db');

/*
 * Written under an unguessable filename and served from there.
 *
 * The page holds one GENUINE ticket payload alongside the forgeries, so its URL
 * is a capability: anyone holding it holds that ticket. A random name keeps it
 * from being found by guessing, and it is a demonstration file with a life of
 * one meeting — delete the folder afterwards.
 */
const SECRET = require('crypto').randomBytes(8).toString('hex');
const OUT = path.join(__dirname, '..', 'public', 'demo', `fraud-test-${SECRET}.html`);

(async () => {
  const wanted = process.argv[2];
  const t = wanted
    ? await one(
        `SELECT t.*, p.name AS place_name, s.label AS slot_label, c.label AS category_label
           FROM tickets t
           JOIN places p ON p.id = t.place_id
           JOIN place_slots s ON s.id = t.slot_id
           JOIN vehicle_categories c ON c.id = t.category_id
          WHERE t.ticket_no = $1`, [wanted.toUpperCase()])
    : await one(
        `SELECT t.*, p.name AS place_name, s.label AS slot_label, c.label AS category_label
           FROM tickets t
           JOIN places p ON p.id = t.place_id
           JOIN place_slots s ON s.id = t.slot_id
           JOIN vehicle_categories c ON c.id = t.category_id
          WHERE t.status = 'paid' AND t.qr_payload IS NOT NULL
          ORDER BY t.id DESC LIMIT 1`);

  if (!t) {
    console.error('\n  No paid ticket found. Book one on WhatsApp first, then run this again.\n');
    process.exit(1);
  }

  const real = t.qr_payload;
  const parts = real.split('|');
  const date = parts[3];

  /* The three attacks, each one a plausible thing a forger would actually do. */
  const forgedPlate = real.replace(`|${t.reg_no}|`, '|KA05ZZ9999|');
  const forgedDate = real.replace(`|${date}|`, `|${todayCompact()}|`);
  const forgedSlot = real.replace(`|${parts[4]}|`, `|${parts[4] === '0612' ? '1206' : '0612'}|`);

  const codes = [
    {
      n: 1,
      title: 'The genuine ticket',
      expect: 'ALLOW',
      tone: 'ok',
      say: 'This is the real ticket, exactly as the visitor received it on WhatsApp.',
      payload: real,
    },
    {
      n: 2,
      title: 'The same ticket, scanned again',
      expect: 'ALREADY USED',
      tone: 'bad',
      say: 'A screenshot of a paid ticket, forwarded to a friend. Scan code 1 a second '
         + 'time — or this one, which is identical — and the gate reports it has already '
         + 'come through.',
      payload: real,
    },
    {
      n: 3,
      title: 'Vehicle number changed',
      expect: 'FAKE TICKET',
      tone: 'bad',
      say: `The forger edited the registration from ${t.reg_no} to KA05ZZ9999 — the exact `
         + 'attack happening today with printed tickets.',
      payload: forgedPlate,
    },
    {
      n: 4,
      title: 'Travel date changed',
      expect: 'FAKE TICKET',
      tone: 'bad',
      say: 'Last Sunday\'s ticket, edited to read today. On paper this is undetectable.',
      payload: forgedDate,
    },
    {
      n: 5,
      title: 'Time slot changed',
      expect: 'FAKE TICKET',
      tone: 'bad',
      say: 'A morning ticket edited to read afternoon, to get around the slot limit.',
      payload: forgedSlot,
    },
  ];

  for (const c of codes) {
    c.png = await QRCode.toDataURL(c.payload, {
      errorCorrectionLevel: 'L', margin: 2, scale: 8,
    });
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, page(t, codes));

  const base = (process.env.PUBLIC_BASE_URL
    || `http://localhost:${process.env.PORT || 7777}`).replace(/\/+$/, '');

  console.log(`\n  Ticket ${t.ticket_no} · ${t.reg_no} · ${t.travel_date} · ${t.slot_label}`);
  console.log(`\n  Open on the PHONE:   ${base}/demo/fraud-test-${SECRET}.html`);
  console.log(`  Scan with the LAPTOP: ${base}/scan`);
  console.log('\n  The link contains one real ticket — delete public/demo after the meeting.\n');
  process.exit(0);
})().catch((e) => { console.error('\n', e, '\n'); process.exit(1); });

function todayCompact() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function page(t, codes) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fraud test — ticket ${esc(t.ticket_no)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin:0; background:#f7f8f6; color:#111c1a;
         font:16px/1.55 "IBM Plex Sans", system-ui, sans-serif; }
  header { background:#111c1a; color:#fff; padding:28px 32px; }
  header .eyebrow { font-size:11px; letter-spacing:2px; text-transform:uppercase;
                    color:#19a396; font-weight:600; }
  header h1 { margin:6px 0 0; font-size:26px; font-weight:600; }
  header p { margin:8px 0 0; color:#c2ccc8; font-size:14px; max-width:60ch; }
  .ticket { margin-top:16px; display:flex; flex-wrap:wrap; gap:22px;
            font-size:13px; color:#c2ccc8; }
  .ticket b { color:#fff; font-weight:600; }
  main { padding:26px 32px 60px; max-width:1180px; }
  .steps { display:grid; gap:20px; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); }
  .step { background:#fff; border:1px solid rgba(17,28,26,.12); border-radius:12px;
          overflow:hidden; display:flex; flex-direction:column; }
  .step header { background:none; color:inherit; padding:16px 18px 0; }
  .num { display:inline-flex; align-items:center; justify-content:center;
         width:26px; height:26px; border-radius:50%; background:#0f4f48; color:#fff;
         font-size:13px; font-weight:600; }
  .step h2 { font-size:16px; margin:10px 0 0; font-weight:600; }
  .step p { font-size:13.5px; color:#4b5563; margin:8px 0 0; }
  .qr { padding:14px 18px 4px; text-align:center; }
  .qr img { width:100%; max-width:230px; height:auto; image-rendering:pixelated; }
  .expect { margin:auto 18px 18px; border-radius:8px; padding:10px 12px; text-align:center;
            font-weight:700; font-size:14px; letter-spacing:1px; }
  .ok  { background:#dcfce7; color:#15803d; }
  .bad { background:#fee2e2; color:#b91c1c; }
  .payload { font-family:"IBM Plex Mono", monospace; font-size:10px; color:#9ca3af;
             word-break:break-all; padding:0 18px 14px; }
  .note { background:#fff; border-left:4px solid #0f4f48; border-radius:8px;
          padding:16px 18px; margin-bottom:26px; font-size:14px; color:#4b5563;
          max-width:80ch; }
  .note b { color:#111c1a; }
  @media print {
    body { background:#fff; }
    header { background:#fff; color:#111c1a; border-bottom:2px solid #111c1a; }
    header p, .ticket { color:#4b5563; }
    header .eyebrow { color:#0f4f48; }
    .ticket b { color:#111c1a; }
    .step { break-inside:avoid; }
  }
</style></head><body>

<header>
  <div class="eyebrow">Mullayanagiri vehicle entry · demonstration</div>
  <h1>The same ticket, and four attacks on it</h1>
  <p>Every code below was made from one real ticket. The first is untouched. The others
     were edited exactly the way a printed ticket is edited today — and the gate can tell.</p>
  <div class="ticket">
    <span>Ticket <b>${esc(t.ticket_no)}</b></span>
    <span>Vehicle <b>${esc(t.reg_no)}</b></span>
    <span>Date <b>${esc(String(t.travel_date).slice(0, 10))}</b></span>
    <span>Slot <b>${esc(t.slot_label)}</b></span>
    <span>Type <b>${esc(t.category_label)}</b></span>
  </div>
</header>

<main>
  <div class="note">
    <b>How to run this.</b> Open the checkpost app on the phone, sign in with a staff PIN,
    then hold the phone up to this screen and scan each code in order. Code 1 must be
    scanned before code 2 for the duplicate to be caught — that is the point of it.
    Switch the phone to aeroplane mode before scanning 3, 4 or 5 to show that a forgery
    is refused with no network at all.
  </div>

  <div class="steps">
    ${codes.map((c) => `
    <section class="step">
      <header>
        <span class="num">${c.n}</span>
        <h2>${esc(c.title)}</h2>
        <p>${esc(c.say)}</p>
      </header>
      <div class="qr"><img src="${c.png}" alt="QR code ${c.n}"></div>
      <div class="expect ${c.tone}">Phone should say: ${esc(c.expect)}</div>
      <div class="payload">${esc(c.payload)}</div>
    </section>`).join('')}
  </div>

  <div class="note" style="margin-top:26px">
    <b>Why the edited ones fail.</b> The vehicle number, date, slot and place are sealed
    inside a digital signature. The text under each code is what the QR actually contains —
    compare code 1 with code 3 and the changed registration is visible in plain sight.
    The signature at the end no longer matches what it is signing, and only the server's
    private key could produce one that does.
  </div>
</main>
</body></html>`;
}
