/**
 * policy.js — the terms and privacy pages the welcome message links to.
 *
 * Served by this app rather than pointed at a document elsewhere, because the
 * link is sent to every visitor before they book and a link that 404s in front
 * of a government department is worse than no link at all.
 *
 * Plain server-rendered HTML: these are read once, on a phone, often on a hill
 * with two bars of signal.
 */

const express = require('express');
const router = express.Router();

const UPDATED = '11 September 2026';

const page = (title, kn, body) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · Pravesha</title>
<style>
  :root { color-scheme: light dark; --ink:#1a1a1a; --muted:#666; --line:#e4e4e4; --bg:#fff; --accent:#8B1A1A; }
  @media (prefers-color-scheme: dark) { :root { --ink:#eee; --muted:#aaa; --line:#333; --bg:#141414; } }
  * { box-sizing:border-box }
  body { margin:0; background:var(--bg); color:var(--ink);
         font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width:680px; margin:0 auto; padding:24px 20px 64px }
  header { border-bottom:3px solid var(--accent); padding-bottom:14px; margin-bottom:26px }
  .brand { font-weight:700; font-size:20px; letter-spacing:-.2px }
  .dept { color:var(--muted); font-size:13px; margin-top:2px }
  h1 { font-size:24px; margin:0 0 4px; letter-spacing:-.3px }
  .kn { color:var(--muted); font-size:15px; margin:0 0 18px }
  .updated { color:var(--muted); font-size:13px; margin-bottom:28px }
  h2 { font-size:17px; margin:30px 0 8px }
  p, li { color:var(--ink) }
  ul { padding-left:20px } li { margin:6px 0 }
  .note { border-left:3px solid var(--accent); padding:10px 14px; margin:20px 0;
          background:rgba(139,26,26,.05); border-radius:0 6px 6px 0; font-size:15px }
  footer { margin-top:44px; padding-top:16px; border-top:1px solid var(--line);
           color:var(--muted); font-size:13px }
  a { color:var(--accent) }
</style></head><body><div class="wrap">
<header><div class="brand">Pravesha · ಪ್ರವೇಶ</div>
<div class="dept">Karnataka Tourism Department · ಕರ್ನಾಟಕ ಪ್ರವಾಸೋದ್ಯಮ ಇಲಾಖೆ</div></header>
<h1>${title}</h1><p class="kn">${kn}</p>
<p class="updated">Last updated: ${UPDATED}</p>
${body}
<footer>Pravesha is operated for the Karnataka Tourism Department.<br>
Questions? Reply <strong>help</strong> on WhatsApp.</footer>
</div></body></html>`;

router.get('/policy/terms', (req, res) => {
  res.type('html').send(page('Terms &amp; Conditions', 'ನಿಯಮಗಳು ಮತ್ತು ಷರತ್ತುಗಳು', `
<h2>1. What this service does</h2>
<p>Pravesha issues entry passes for vehicles visiting designated hill destinations
managed by the Karnataka Tourism Department. A pass covers one vehicle, for one
place, on one date, in one time slot.</p>

<h2>2. Which vehicles are eligible</h2>
<p>Passes are issued only to two-wheelers, cars and jeeps, Toofan-class vehicles
and Tempo Travellers.</p>
<div class="note"><strong>Not permitted:</strong> autorickshaws, buses and minibuses,
trucks and goods vehicles, tractors and trailers. These vehicles will be refused
entry at the checkpost even if a pass has been issued.</div>

<h2>3. Vehicle details and pricing</h2>
<p>The entry fee depends on your vehicle's category, which we determine from its
registration record. Where that record is unavailable — for a temporary
registration, a very new vehicle, or an older one — you will be asked to select
your vehicle type yourself. Passes issued this way are marked for verification,
and checkpost staff may refuse entry or collect the difference if the vehicle
does not match what was declared.</p>

<h2>4. Capacity and availability</h2>
<p>Each place, slot and vehicle category has a daily limit. A pass is confirmed
only once payment succeeds; until then the capacity is held briefly and may be
released.</p>

<h2>5. Payment</h2>
<p>Payments are processed by Razorpay. The fee shown before payment includes the
entry fee and a platform fee, both displayed separately.</p>

<h2>6. Cancellation and refunds</h2>
<p>A pass is valid only for the date and slot booked and is not transferable to
another date, slot or vehicle. Where entry is refused at the checkpost because
the vehicle is of a category that is not permitted, the entry fee is refundable;
the platform fee is not.</p>

<h2>7. At the checkpost</h2>
<p>Present your pass at the checkpost. Staff may verify the vehicle's
registration number against the pass. Entry may be refused where these do not
match.</p>

<h2>8. Closures</h2>
<p>Routes may close at short notice for weather, maintenance or safety. Where a
closure prevents entry, passes for the affected date and slot are refunded in
full.</p>`));
});

router.get('/policy/privacy', (req, res) => {
  res.type('html').send(page('Privacy Policy', 'ಗೌಪ್ಯತಾ ನೀತಿ', `
<h2>What we collect</h2>
<ul>
  <li>Your WhatsApp number and profile name.</li>
  <li>The vehicle registration number you enter.</li>
  <li>Your booking: place, date, slot, category and payment reference.</li>
</ul>

<h2>Vehicle registration lookups</h2>
<p>When you enter a registration number we look it up against the national
vehicle database to determine the vehicle's category, which sets the entry fee.</p>
<div class="note"><strong>We do not retain the owner's name, address, chassis
number or engine number.</strong> These are removed before anything is stored,
so they cannot be displayed or recovered later.</div>
<p>We keep the vehicle's make, model, class, fuel and colour so that a repeat
booking for the same vehicle does not require a fresh lookup.</p>

<h2>What we do not do</h2>
<ul>
  <li>We do not sell or rent your data.</li>
  <li>We do not use your number for marketing.</li>
  <li>We do not share your details except with the Karnataka Tourism Department
      and checkpost staff verifying your pass, and with our payment processor to
      take payment.</li>
</ul>

<h2>How long we keep it</h2>
<p>Booking and payment records are retained as required for accounting and
audit. Vehicle registration snapshots are refreshed periodically and expire
thirty days after they are fetched.</p>

<h2>Your choices</h2>
<p>Reply <strong>help</strong> on WhatsApp to ask about the data held against
your number, or to request its deletion where we are not required to retain it.</p>`));
});

module.exports = router;
