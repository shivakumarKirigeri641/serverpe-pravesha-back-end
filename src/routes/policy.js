/**
 * routes/policy.js — the page the WhatsApp consent step links to.
 *
 * Until now that link went to a 404, which is the worst possible answer to a
 * visitor who taps "read the policy" before agreeing to anything.
 *
 * Served as plain HTML rather than through the JSON envelope the rest of the
 * API uses: it is opened in a phone browser from a chat, not called by a
 * front-end. Mounted before encryptResponse for the same reason.
 *
 * Kannada first throughout, because the reader is a visitor to a Karnataka
 * tourist site, not a lawyer in Bengaluru.
 */

const express = require('express');
const settings = require('../gatepass/settings');
const { SECTIONS } = require('../gatepass/policy');

const router = express.Router();

/** Escaped because section text is content, and content eventually contains &. */
const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

router.get('/policy', async (req, res) => {
  let cfg = {};
  try {
    cfg = await settings.all();
  } catch (e) {
    // A database that is down must not take the policy page with it — the
    // words below do not come from the database, only the letterhead does.
    console.error('policy: settings unavailable', e.message);
  }

  const firm = cfg.legal_name || 'ServerPe App Solutions';
  const product = cfg.product_name || 'EntryPe';
  const tagline = cfg.vendor_tagline || 'Smart Clicks, Smart Taps.';
  const mobile = cfg.support_mobile || '';
  const email = cfg.contact_email || '';
  const address = cfg.business_address || '';
  const gstin = cfg.gstin || '';
  const updated = new Date().toLocaleDateString('en-IN',
    { day: 'numeric', month: 'long', year: 'numeric' });

  const body = SECTIONS.map((s, i) => `
    <section>
      <h2><span class="n">${i + 1}</span>${esc(s.kn)}</h2>
      <h3>${esc(s.en)}</h3>
      <p class="kn">${esc(s.body_kn)}</p>
      <p>${esc(s.body_en)}</p>
    </section>`).join('');

  res.type('html').send(`<!doctype html>
<html lang="kn">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ನಿಯಮಗಳು ಮತ್ತು ಗೌಪ್ಯತೆ · Terms and Privacy — ${esc(product)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Kannada:wght@400;600&display=swap" rel="stylesheet">
<style>
  :root{
    --ink:#111c1a; --muted:#5b6b67; --forest:#0f4f48; --line:#d9e2df;
    --paper:#f7f8f6; --card:#ffffff;
  }
  @media (prefers-color-scheme: dark){
    :root{ --ink:#eef2f0; --muted:#a3b1ad; --forest:#5cc8bb; --line:#2a3634;
           --paper:#0f1514; --card:#161e1d; }
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--ink);
       font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  .kn,h2{font-family:"Noto Sans Kannada",-apple-system,"Segoe UI",sans-serif}
  .wrap{max-width:720px;margin:0 auto;padding:0 20px 64px}
  header{border-bottom:3px solid var(--forest);background:var(--card);
         padding:26px 20px 20px;margin-bottom:26px}
  header .in{max-width:720px;margin:0 auto}
  h1{font-family:"Noto Sans Kannada",sans-serif;font-size:23px;line-height:1.35;
     margin:0 0 4px;font-weight:600}
  .sub{font-size:17px;font-weight:600;margin:0 0 10px}
  .meta{color:var(--muted);font-size:13px;margin:0}
  section{background:var(--card);border:1px solid var(--line);border-radius:10px;
          padding:16px 18px;margin:0 0 14px}
  h2{font-size:16.5px;margin:0 0 2px;font-weight:600;line-height:1.45}
  h2 .n{display:inline-block;min-width:26px;color:var(--forest);font-weight:600}
  h3{font-size:13px;margin:0 0 10px;color:var(--muted);font-weight:600;
     letter-spacing:.02em;text-transform:uppercase;padding-left:26px}
  section p{margin:0 0 9px;padding-left:26px}
  section p:last-child{margin-bottom:0}
  section p.kn{font-size:14.5px;line-height:1.85}
  section p:not(.kn){color:var(--muted);font-size:14px}
  footer{margin-top:30px;padding-top:18px;border-top:1px solid var(--line);
         color:var(--muted);font-size:13px}
  footer b{color:var(--ink)}
  a{color:var(--forest)}
  @media (max-width:520px){
    h2 .n{min-width:22px} h3,section p{padding-left:0}
  }
</style>
</head>
<body>
<header><div class="in">
  <h1>ನಿಯಮಗಳು ಮತ್ತು ಗೌಪ್ಯತಾ ನೀತಿ</h1>
  <p class="sub">Terms of use and privacy policy</p>
  <p class="meta">${esc(product)} · ${esc(firm)} — ${esc(tagline)}<br>
     ಕೊನೆಯ ಪರಿಷ್ಕರಣೆ · Last updated ${esc(updated)}</p>
</div></header>

<div class="wrap">
${body}

<footer>
  <p><b>ಸಂಪರ್ಕ · Contact</b><br>
  ${esc(firm)}${gstin ? `<br>GSTIN ${esc(gstin)}` : ''}
  ${address ? `<br>${esc(address)}` : ''}
  ${mobile ? `<br>${esc(mobile)}` : ''}
  ${email ? `<br><a href="mailto:${esc(email)}">${esc(email)}</a>` : ''}</p>
  <p>ಪ್ರಶ್ನೆ ಅಥವಾ ದೂರು ಇದ್ದರೆ ವಾಟ್ಸ್ಆ್ಯಪ್‌ನಲ್ಲಿ "support" ಎಂದು ಕಳುಹಿಸಿ.<br>
     For any question or complaint, send "support" on WhatsApp and a person will answer.</p>
</footer>
</div>
</body>
</html>`);
});

module.exports = router;
