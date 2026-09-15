/**
 * routes/checkout.js — the payment page and the ways it can be confirmed.
 *
 * The page is deliberately plain and self-contained: one screen, the amount,
 * one button. It is opened from a WhatsApp link on a phone that may be on a
 * hill road, so there is no framework, no font download and no image.
 *
 * After paying, the customer is pushed straight back to WhatsApp. Leaving them
 * on a "payment successful" web page is how people end up unsure whether they
 * have a ticket — the ticket arrives in the chat, so that is where they should
 * be looking.
 *
 * In the visitor's language, like the booking form before it. A page that
 * cannot name the visitor (a dead link, the address left behind after paying)
 * says it in both. Razorpay's own sheet, and what reaches a card statement, stay
 * in English: that text belongs to the bank, not to the visitor's chat.
 */

const express = require('express');
const checkout = require('../gatepass/checkout');
const booking = require('../gatepass/booking');
const deliver = require('../whatsapp/deliver');
const pricing = require('../gatepass/pricing');
const { query } = require('../gatepass/db');
const { PREFIX } = require('../config/paths');
const { langOf } = require('../i18n');
const L = require('../localize');

const router = express.Router();

/** Escape anything that reaches the page, including our own data. */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const WA_LINK = () => `https://wa.me/${String(process.env.WHATSAPP_BUSINESS_PHONENUMBER || '').replace(/\D/g, '')}`;

/* Every sentence on these pages, in both languages. */
const COPY = {
  en: {
    doneT: 'Payment successful', done: 'Your entry pass has been sent to you on WhatsApp.<br>You can close this page.',
    notFoundT: 'Link not found', notFound: 'This payment link is not valid. Please start again on WhatsApp.',
    usedT: 'Link already used', used: 'This payment link has already been used and is no longer valid.<br>Your entry pass is in the WhatsApp chat.',
    expiredT: 'This booking expired', expired: 'The slot was released because payment was not completed in time. Please book again on WhatsApp.',
    downT: 'Payment temporarily unavailable', down: 'We could not start the payment just now. Please try the link again in a minute.',
    back: 'Back to WhatsApp',
    title: (no) => `Pay for pass ${no}`,
    head: (place) => `Pravesha · ${place} entry pass`, pass: 'Pass',
    opening: 'Opening payment…', pay: (amt) => `Pay Rs. ${amt}`,
    note: 'Your entry pass arrives on WhatsApp as soon as payment succeeds. At the checkpost, just drive up &mdash; staff will record your vehicle number digitally.',
    foot: 'Powered by ServerPe App Solutions',
    sent: 'Your entry pass has been sent to you on WhatsApp.', going: 'Taking you back to WhatsApp…',
    open: 'Open WhatsApp', ifNot: 'If WhatsApp does not open by itself, tap the button. This page can be closed.',
    tapReturn: 'Tap below to return to WhatsApp.', confirming: 'Confirming...',
    confirmFailed: 'Confirming failed - tap to retry', payFailed: 'Payment failed - try again',
    didNotGo: 'That payment did not go through.', tapToPay: 'Tap below to pay.',
  },
  kn: {
    doneT: 'ಪಾವತಿ ಯಶಸ್ವಿಯಾಗಿದೆ', done: 'ನಿಮ್ಮ ಪ್ರವೇಶ ಪಾಸ್ ಅನ್ನು ವಾಟ್ಸ್‌ಆ್ಯಪ್‌ನಲ್ಲಿ ಕಳುಹಿಸಲಾಗಿದೆ.<br>ನೀವು ಈ ಪುಟವನ್ನು ಮುಚ್ಚಬಹುದು.',
    notFoundT: 'ಲಿಂಕ್ ಸಿಗಲಿಲ್ಲ', notFound: 'ಈ ಪಾವತಿ ಲಿಂಕ್ ಮಾನ್ಯವಲ್ಲ. ದಯವಿಟ್ಟು ವಾಟ್ಸ್‌ಆ್ಯಪ್‌ನಲ್ಲಿ ಮತ್ತೆ ಆರಂಭಿಸಿ.',
    usedT: 'ಲಿಂಕ್ ಈಗಾಗಲೇ ಬಳಸಲಾಗಿದೆ', used: 'ಈ ಪಾವತಿ ಲಿಂಕ್ ಈಗಾಗಲೇ ಬಳಸಲಾಗಿದೆ ಮತ್ತು ಇನ್ನು ಮಾನ್ಯವಲ್ಲ.<br>ನಿಮ್ಮ ಪ್ರವೇಶ ಪಾಸ್ ವಾಟ್ಸ್‌ಆ್ಯಪ್ ಚಾಟ್‌ನಲ್ಲಿದೆ.',
    expiredT: 'ಈ ಬುಕಿಂಗ್‌ನ ಅವಧಿ ಮುಗಿದಿದೆ', expired: 'ಸಮಯಕ್ಕೆ ಪಾವತಿ ಪೂರ್ಣಗೊಳ್ಳದ ಕಾರಣ ಸ್ಲಾಟ್ ಬಿಡುಗಡೆಯಾಗಿದೆ. ದಯವಿಟ್ಟು ವಾಟ್ಸ್‌ಆ್ಯಪ್‌ನಲ್ಲಿ ಮತ್ತೆ ಬುಕ್ ಮಾಡಿ.',
    downT: 'ಪಾವತಿ ತಾತ್ಕಾಲಿಕವಾಗಿ ಲಭ್ಯವಿಲ್ಲ', down: 'ಈಗ ಪಾವತಿ ಆರಂಭಿಸಲಾಗಲಿಲ್ಲ. ಒಂದು ನಿಮಿಷದ ನಂತರ ಲಿಂಕ್ ಅನ್ನು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
    back: 'ವಾಟ್ಸ್‌ಆ್ಯಪ್‌ಗೆ ಹಿಂತಿರುಗಿ',
    title: (no) => `ಪಾಸ್ ${no} ಗೆ ಪಾವತಿಸಿ`,
    head: (place) => `ಪ್ರವೇಶ · ${place} ಪ್ರವೇಶ ಪಾಸ್`, pass: 'ಪಾಸ್',
    opening: 'ಪಾವತಿ ತೆರೆಯಲಾಗುತ್ತಿದೆ…', pay: (amt) => `Rs. ${amt} ಪಾವತಿಸಿ`,
    note: 'ಪಾವತಿ ಯಶಸ್ವಿಯಾದ ತಕ್ಷಣ ನಿಮ್ಮ ಪ್ರವೇಶ ಪಾಸ್ ವಾಟ್ಸ್‌ಆ್ಯಪ್‌ನಲ್ಲಿ ಬರುತ್ತದೆ. ಚೆಕ್‌ಪೋಸ್ಟ್‌ಗೆ ನೇರವಾಗಿ ಬನ್ನಿ &mdash; ಸಿಬ್ಬಂದಿ ನಿಮ್ಮ ವಾಹನ ಸಂಖ್ಯೆಯನ್ನು ಡಿಜಿಟಲ್ ಆಗಿ ದಾಖಲಿಸುತ್ತಾರೆ.',
    foot: 'ಸೇವೆ ಒದಗಿಸುವವರು: ServerPe App Solutions',
    sent: 'ನಿಮ್ಮ ಪ್ರವೇಶ ಪಾಸ್ ಅನ್ನು ವಾಟ್ಸ್‌ಆ್ಯಪ್‌ನಲ್ಲಿ ಕಳುಹಿಸಲಾಗಿದೆ.', going: 'ವಾಟ್ಸ್‌ಆ್ಯಪ್‌ಗೆ ಹಿಂತಿರುಗಿಸಲಾಗುತ್ತಿದೆ…',
    open: 'ವಾಟ್ಸ್‌ಆ್ಯಪ್ ತೆರೆಯಿರಿ', ifNot: 'ವಾಟ್ಸ್‌ಆ್ಯಪ್ ತಾನಾಗಿ ತೆರೆಯದಿದ್ದರೆ, ಬಟನ್ ಒತ್ತಿ. ಈ ಪುಟವನ್ನು ಮುಚ್ಚಬಹುದು.',
    tapReturn: 'ವಾಟ್ಸ್‌ಆ್ಯಪ್‌ಗೆ ಹಿಂತಿರುಗಲು ಕೆಳಗೆ ಒತ್ತಿ.', confirming: 'ದೃಢೀಕರಿಸಲಾಗುತ್ತಿದೆ…',
    confirmFailed: 'ದೃಢೀಕರಣ ವಿಫಲವಾಗಿದೆ - ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಲು ಒತ್ತಿ', payFailed: 'ಪಾವತಿ ವಿಫಲವಾಗಿದೆ - ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ',
    didNotGo: 'ಆ ಪಾವತಿ ಯಶಸ್ವಿಯಾಗಲಿಲ್ಲ.', tapToPay: 'ಪಾವತಿಸಲು ಕೆಳಗೆ ಒತ್ತಿ.',
  },
};

/* A page for somebody we cannot name: English first, Kannada under it. */
const bothPage = (key, link) => page(
  `${COPY.en[`${key}T`]} · ${COPY.kn[`${key}T`]}`,
  `${COPY.en[key]}<br><br><span lang="kn">${COPY.kn[key]}</span>`,
  link, 'en', true);

/* ────────────────────────────────────────────────────────────── the page */

/* Where the address bar points once a payment succeeds. The success screen
   rewrites the URL to this, so the token is no longer in the address bar, the
   history, or a screenshot; reloading lands here, not on the payment page. */
router.get('/pay/done', (req, res) => {
  res.set('Cache-Control', 'no-store').send(bothPage('done', WA_LINK()));
});

router.get('/pay/:token', async (req, res) => {
  const found = await checkout.byToken(req.params.token);
  if (!found?.ticket) return res.status(404).send(bothPage('notFound'));

  const { payment, ticket } = found;
  const lang = langOf({ language: ticket.customer_language });
  const C = COPY[lang];

  /* A payment link dies with the payment. It used to open an "Already paid"
     page naming the pass, which made a forwarded or screenshotted link a way
     to read someone's pass number. Now it says only that the link is used. */
  if (payment.status === 'paid') {
    return res.status(410).send(page(C.usedT, C.used, WA_LINK(), lang));
  }
  if (ticket.status === 'expired' || ticket.status === 'cancelled') {
    return res.send(page(C.expiredT, C.expired, WA_LINK(), lang));
  }

  let orderId;
  try {
    orderId = await checkout.ensureOrder(payment, ticket);
  } catch (e) {
    console.error('[checkout] order creation failed:', e.message);
    return res.status(503).send(page(C.downT, C.down, null, lang));
  }

  const k = checkout.keys();
  res.type('html').send(payPage({ ticket, payment, orderId, keyId: k.id, token: req.params.token, lang }));
});

/* ────────────────────────────────────────────── path 1: browser callback */

router.post('/pay/:token/confirm', express.json(), async (req, res) => {
  const found = await checkout.byToken(req.params.token);
  if (!found?.ticket) return res.status(404).json({ ok: false });

  const { payment, ticket } = found;
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};

  // Without this check the endpoint is just a URL anyone could post to claiming
  // to have paid.
  const good = checkout.verifyCallback({
    order_id: razorpay_order_id, payment_id: razorpay_payment_id, signature: razorpay_signature });

  if (!good) {
    console.error('[checkout] callback signature failed for token', req.params.token);
    return res.status(400).json({ ok: false, error: 'signature' });
  }

  await settle(payment, ticket, razorpay_payment_id, req.body);
  res.json({ ok: true, ticket_no: ticket.ticket_no, whatsapp: WA_LINK() });
});

router.post('/pay/:token/failed', express.json(), async (req, res) => {
  const found = await checkout.byToken(req.params.token);
  if (found?.payment) {
    await checkout.markFailed(found.payment.id, req.body?.reason);
    // Hand the place straight back rather than waiting for the hold to age out
    // — on a busy day that is a place someone else can buy immediately.
    if (found.ticket?.status === 'held') await booking.releaseHold(found.ticket.id, 'payment_failed');
  }
  res.json({ ok: true });
});

/* ─────────────────────────────────────────────────── path 2: the webhook */

router.post(`${PREFIX}/payments/webhook`, async (req, res) => {
  const verdict = checkout.verifyWebhook(req.rawBody, req.get('x-razorpay-signature'));
  if (verdict === 'bad') {
    console.error('[rzp] REJECTED webhook — bad signature');
    return res.sendStatus(401);
  }
  if (verdict === 'unset') console.warn('[rzp] RAZORPAY_WEBHOOK not set — accepting unverified');

  res.sendStatus(200);   // acknowledge first; Razorpay retries otherwise

  try {
    const event = req.body?.event;
    const entity = req.body?.payload?.payment?.entity;
    if (!entity) return;

    console.log('[rzp] webhook %s %s', event, entity.id);

    if (event === 'payment.captured' || event === 'payment.authorized') {
      const found = await byOrder(entity.order_id);
      if (found) await settle(found.payment, found.ticket, entity.id, entity);
    }
    if (event === 'payment.failed') {
      const found = await byOrder(entity.order_id);
      if (found?.payment) await checkout.markFailed(found.payment.id, entity.error_description);
    }
  } catch (e) {
    console.error('[rzp] webhook handler threw:', e.stack || e.message);
  }
});

async function byOrder(orderId) {
  if (!orderId) return null;
  const p = (await query('SELECT * FROM payments WHERE order_id = $1', [orderId])).rows[0];
  if (!p) return null;
  const t = p.raw?.ticket_id ? await booking.byId(p.raw.ticket_id) : null;
  return { payment: p, ticket: t };
}

/* ──────────────────────────────────────────────────────── the common end */

/**
 * Everything that must happen when money has arrived, in an order that is safe
 * to repeat: record the payment, issue the ticket, send it. Whichever of the
 * three paths gets here first does the work; the others find it already done.
 */
async function settle(payment, ticket, rzpPaymentId, raw) {
  /* The callback carries only ids; the gateway's own record says how it was
     paid, which the pass prints. Fetched before recording so it is stored once. */
  const entity = (raw && raw.method) ? raw : (await checkout.fetchPayment(rzpPaymentId)) || raw;
  await checkout.markPaid(payment.id, rzpPaymentId, entity);

  const issued = await booking.markPaid(ticket.id, payment.id);
  if (!issued.ok) {
    console.error('[checkout] PAID BUT NOT ISSUED %s: %s', ticket.ticket_no, issued.reason);
    await query('INSERT INTO event_log (customer_id, kind, detail) VALUES ($1, $2, $3)',
      [ticket.customer_id, 'payment_unissued',
       JSON.stringify({ ticket_id: ticket.id, reason: issued.reason, razorpay_payment_id: rzpPaymentId })]);
    return issued;
  }

  /*
   * "I am already at the checkpost", ticked on the payment sheet and checked
   * against where the phone said it was. The entry is recorded here, with the
   * money, because that is the moment the pass becomes real — and before the
   * pass is sent, so what the visitor receives already says they are in.
   *
   * It is allowed to fail. A slot that closed during the payment, or a pass
   * already checked at the barrier, simply means no entry is recorded; the pass
   * is untouched and good, and the staff member checks them in as usual.
   */
  if (!issued.already) {
    try {
      const marked = await require('../gatepass/selfCheckin').recordIfAsked(issued.ticket);
      if (marked.recorded) issued.ticket.status = 'used';
      else if (issued.ticket.self_checkin_asked) {
        console.log('[checkout] %s asked to check itself in but could not: %s', ticket.ticket_no, marked.reason);
      }
    } catch (e) {
      console.error('[checkout] self check-in failed for %s: %s', ticket.ticket_no, e.message);
    }
  }

  /* Only the call that turned the hold into a pass sends it. The other two
     confirmation paths find it already issued and stop here, so the visitor
     gets one pass, not three. */
  if (!issued.already) {
    deliver.deliverTicket(ticket.id).catch((e) => console.error('[checkout] delivery failed', e.message));
  }
  return issued;
}

/* ───────────────────────────────────────────────────────────────── pages */

function page(title, message, link, lang = 'en', bilingualButton = false) {
  const button = bilingualButton ? `${COPY.en.back} · ${COPY.kn.back}` : (COPY[lang] || COPY.en).back;
  return `<!doctype html><html lang="${lang === 'kn' ? 'kn' : 'en'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
body{margin:0;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans Kannada",sans-serif;
background:#efeae2;color:#111827;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
.card{background:#fff;border-radius:16px;padding:32px 28px;max-width:380px;width:100%;
box-shadow:0 1px 3px rgba(0,0,0,.08);text-align:center}
h1{font-size:20px;margin:0 0 12px}p{color:#4b5563;margin:0 0 20px}
a.btn{display:block;background:#008069;color:#fff;text-decoration:none;padding:14px;border-radius:10px;font-weight:600}
</style></head><body><div class="card"><h1>${esc(title)}</h1><p>${message}</p>
${link ? `<a class="btn" href="${esc(link)}">${esc(button)}</a>` : ''}</div></body></html>`;
}

function payPage({ ticket, payment, orderId, keyId, token, lang = 'en' }) {
  const rs = (p) => pricing.rs(p);
  const C = COPY[lang] || COPY.en;
  /* The words the script below draws, handed over once rather than spliced in. */
  const words = {
    sentHtml: C.sent, going: C.going, open: C.open, ifNot: C.ifNot, tapReturn: C.tapReturn,
    doneT: C.doneT, confirming: C.confirming, confirmFailed: C.confirmFailed,
    payFailed: C.payFailed, didNotGo: C.didNotGo, tapToPay: C.tapToPay, pay: C.pay(rs(ticket.total_paise)),
  };
  return `<!doctype html><html lang="${lang === 'kn' ? 'kn' : 'en'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(C.title(ticket.ticket_no))}</title><style>
:root{color-scheme:light}
body{margin:0;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans Kannada",sans-serif;
background:#efeae2;color:#111827;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:20px}
.card{background:#fff;border-radius:18px;max-width:400px;width:100%;overflow:hidden;
box-shadow:0 4px 24px rgba(15,23,42,.10)}
.head{background:#008069;color:#fff;padding:22px 24px}
.head h1{margin:0;font-size:17px;letter-spacing:.5px}
.head p{margin:4px 0 0;font-size:12px;opacity:.85}
.body{padding:22px 24px}
.row{display:flex;justify-content:space-between;gap:12px;padding:7px 0;font-size:14px;color:#4b5563}
.row b{color:#111827;font-weight:600;text-align:right}
.rule{height:1px;background:#e5e7eb;margin:14px 0}
.total{display:flex;justify-content:space-between;font-size:19px;font-weight:700;margin:6px 0 2px}
.note{font-size:11px;color:#6b7280;margin-top:10px;line-height:1.45}
button{width:100%;margin-top:20px;background:#008069;color:#fff;border:0;border-radius:12px;
padding:16px;font-size:16px;font-weight:600;cursor:pointer}
button:disabled{opacity:.6}
.foot{text-align:center;font-size:11px;color:#9ca3af;padding:0 24px 20px}
</style></head><body>
<div class="card">
  <div class="head"><h1>${esc(C.head(L.placeName(ticket, lang)))}</h1>
    <p>${esc(C.pass)} ${esc(ticket.ticket_no)} &middot; ${esc(ticket.reg_no || require('../localize').persons(ticket.persons, lang))}</p></div>
  <div class="body">
    <!-- NOT a summary of any kind. The visitor reviewed and agreed to all of
         this on the previous page and tapped Pay; this page exists only to
         open Razorpay, and it does so on load. Anything shown here is a second
         summary standing between them and paying. The button below is a
         fallback for the case where a browser refuses to open the sheet
         without a tap. -->
    <p id="msg" style="text-align:center;color:#4b5563;margin:4px 0 0">${esc(C.opening)}</p>
    <button id="pay">${esc(words.pay)}</button>
    <p class="note">${C.note}</p>
  </div>
  <div class="foot">${esc(C.foot)}</div>
</div>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script>
var btn = document.getElementById('pay');
var W = ${JSON.stringify(words).replace(/</g, '\\u003c')};

/**
 * Get the visitor back into the WhatsApp conversation after paying.
 *
 * This page is usually open inside WhatsApp's OWN in-app browser, and setting
 * location to an https://wa.me/ link there frequently does nothing at all —
 * the browser is already "in" WhatsApp, so it has nowhere to navigate. That is
 * why payment looked like it succeeded and then simply sat there.
 *
 * The whatsapp:// scheme is what actually hands control back to the app, so it
 * is tried first. The https link follows as a fallback for an ordinary browser,
 * and a visible button is shown regardless — an automatic redirect that fails
 * silently leaves somebody staring at a dead screen holding a paid ticket.
 */
function backToWhatsApp(httpsUrl) {
  var num = String(${JSON.stringify(String(process.env.WHATSAPP_BUSINESS_PHONENUMBER || '').replace(/\\D/g, ''))});

  /* The token goes first. The address bar is rewritten to /pay/done before
     anything else, so Back, a reload, a screenshot or the browser history no
     longer carry a payment link — and that link is dead on the server anyway. */
  try { history.replaceState(null, '', '/pay/done'); } catch (e) { /* older browser */ }

  var card = document.querySelector('.card');
  card.innerHTML =
    '<div style="padding:30px 24px 26px;text-align:center">'
    + '<div style="width:64px;height:64px;margin:0 auto 12px;border-radius:50%;background:#e7f8ef;'
    + 'display:grid;place-items:center;font-size:32px;color:#0b7a3f">&#10003;</div>'
    + '<h1 id="doneT" style="margin:0 0 6px;font-size:20px"></h1>'
    + '<p style="margin:0 0 18px;color:#4b5563"><span id="sent"></span><br>'
    + '<span id="goingMsg"></span></p>'
    + '<button id="back"></button>'
    + '<p id="ifNot" style="margin:14px 0 0;font-size:12px;color:#9ca3af"></p></div>';
  document.getElementById('doneT').textContent = W.doneT;
  document.getElementById('sent').textContent = W.sentHtml;
  document.getElementById('goingMsg').textContent = W.going;
  document.getElementById('back').textContent = W.open;
  document.getElementById('ifNot').textContent = W.ifNot;

  /* HOW TO GET BACK, PER ENVIRONMENT, AT ONCE — no waiting.

     A page cannot close a tab the visitor opened; no browser permits it. What
     does work: inside WhatsApp's own browser on a phone, handing control back
     to WhatsApp closes that browser with it. So the return is the close.

       WhatsApp's in-app browser, iPhone  -> whatsapp:// (the app switches)
       Android Chrome / Custom Tab        -> an intent:// link with wa.me as its
                                             fallback, which opens the app
       Desktop                            -> wa.me, which offers WhatsApp Desktop
                                             or Web; a desktop browser always
                                             asks first, so a tap is unavoidable

     The payment completing inside Razorpay's sheet counts as the visitor's own
     action, which is what lets a browser open the app without another tap.
     If the page is still visible a moment later the app did not open, and the
     https link is tried instead; the button stays there regardless. */
  var ua = navigator.userAgent || '';
  var inWhatsApp = /WhatsApp/i.test(ua);
  var android = /Android/i.test(ua);
  var ios = /iPhone|iPad|iPod/i.test(ua);
  var appUrl = 'whatsapp://send?phone=' + num;
  var intentUrl = 'intent://send/?phone=' + num + '#Intent;scheme=whatsapp;package=com.whatsapp;'
    + 'S.browser_fallback_url=' + encodeURIComponent(httpsUrl) + ';end';

  var go = function () {
    try { window.close(); } catch (e) { /* only permitted for script-opened windows */ }
    if (!num) { window.location.replace(httpsUrl); return; }
    if (inWhatsApp || ios) window.location.href = appUrl;
    else if (android) window.location.href = intentUrl;
    else window.location.replace(httpsUrl);
    setTimeout(function () {
      if (document.hidden) return; // the app took over
      var m = document.getElementById('goingMsg');
      if (m) m.textContent = W.tapReturn;
      if (inWhatsApp || ios || android) window.location.replace(httpsUrl);
    }, 1500);
  };

  document.getElementById('back').onclick = function () {
    if (android && !inWhatsApp) window.location.href = intentUrl;
    else if (num) window.location.href = appUrl;
    setTimeout(function () { if (!document.hidden) window.location.href = httpsUrl; }, 900);
  };
  go();
}

var opts = {
  key: ${JSON.stringify(keyId)},
  order_id: ${JSON.stringify(orderId)},
  amount: ${payment.amount_paise},
  currency: 'INR',
  // What Razorpay shows on the payment sheet and, later, on the card statement.
  // The site's own name is what a visitor will recognise there.
  name: ${JSON.stringify(`${ticket.place_name} entry`)},
  description: 'Entry pass ' + ${JSON.stringify(ticket.ticket_no)},
  prefill: { contact: ${JSON.stringify(ticket.mobile)} },
  theme: { color: '#008069' },
  handler: function (r) {
    btn.disabled = true; btn.textContent = W.confirming;
    fetch('/pay/' + ${JSON.stringify(token)} + '/confirm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(r)
    }).then(function (x) { return x.json(); }).then(function (j) {
      backToWhatsApp(j.whatsapp || ${JSON.stringify(WA_LINK())});
    }).catch(function () {
      btn.disabled = false; btn.textContent = W.confirmFailed;
    });
  },
  modal: { ondismiss: function () { btn.disabled = false; btn.textContent = W.pay; } }
};
function openPayment() {
  btn.disabled = true;
  var rz = new Razorpay(opts);
  rz.on('payment.failed', function (e) {
    fetch('/pay/' + ${JSON.stringify(token)} + '/failed', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: (e.error && e.error.description) || 'failed' })
    });
    btn.disabled = false; btn.textContent = W.payFailed;
    document.getElementById('msg').textContent = W.didNotGo;
  });
  rz.open();
}
btn.onclick = openPayment;

/* Open as soon as the page loads. The visitor already agreed and tapped Pay on
   the review page — asking them to tap Pay a second time is the extra screen
   this page was accused of being. If a browser refuses to open the sheet
   without a gesture, the button is right there. */
window.addEventListener('load', function () {
  try { openPayment(); } catch (e) {
    document.getElementById('msg').textContent = W.tapToPay;
    btn.disabled = false;
  }
});
</script></body></html>`;
}

module.exports = router;
/* The page builders, for rendering a page without opening a payment order. */
module.exports.pages = { page, payPage, COPY };
