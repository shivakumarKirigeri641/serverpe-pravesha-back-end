/**
 * routes/formsWeb.js — support and feedback, as web pages.
 *
 *   GET  /support/:token    query type + comments
 *   POST /support/:token
 *   GET  /feedback/:token   rating + comments
 *   POST /feedback/:token
 *
 * Both were free-text conversations before: the bot asked a question, the
 * visitor typed a paragraph, and everything arrived as one undifferentiated
 * blob. A query type turns support into something that can be routed and
 * counted; a rating turns feedback into something the department can be shown
 * a number for at the three-month review.
 *
 * They share the booking form's chrome deliberately — one product, three
 * pages, not three pages that happen to sit on the same host.
 *
 * Stored in event_log under the same kinds the chat handlers used
 * ('support_request', 'feedback'), so the admin panel and the reports keep
 * working without knowing which route the message came in through.
 */

const express = require('express');
const customers = require('../gatepass/customers');
const booking = require('../gatepass/booking');
const settings = require('../gatepass/settings');
const send = require('../whatsapp/send');
const { t } = require('../gatepass/i18n');
const { shell, who, esc, expired } = require('./bookWeb');

const router = express.Router();

/**
 * The reasons people actually write in about.
 *
 * A fixed list rather than a table: six options that a visitor picks from in
 * one tap, and "something else" for everything they will think of that we did
 * not. Adding a seventh is a code change on purpose — a support taxonomy that
 * anybody can extend stops being countable.
 */
const QUERY_TYPES = [
  { id: 'booking',  kn: 'ಬುಕಿಂಗ್ ಸಮಸ್ಯೆ',              en: 'Problem booking' },
  { id: 'payment',  kn: 'ಪಾವತಿ ಸಮಸ್ಯೆ',                en: 'Payment problem' },
  { id: 'ticket',   kn: 'ಟಿಕೆಟ್ ಬಂದಿಲ್ಲ',              en: 'Ticket not received' },
  { id: 'date',     kn: 'ದಿನಾಂಕ ಬದಲಾಯಿಸಬೇಕು',           en: 'Need to change the date' },
  { id: 'gate',     kn: 'ಗೇಟ್‌ನಲ್ಲಿ ಪ್ರವೇಶ ನಿರಾಕರಣೆ',   en: 'Refused at the gate' },
  { id: 'other',    kn: 'ಬೇರೆ ಏನಾದರೂ',                 en: 'Something else' },
];

const RATINGS = [
  { v: 5, kn: 'ತುಂಬಾ ಸುಲಭ',      en: 'Very easy' },
  { v: 4, kn: 'ಸುಲಭ',            en: 'Easy' },
  { v: 3, kn: 'ಪರವಾಗಿಲ್ಲ',        en: 'Okay' },
  { v: 2, kn: 'ಕಷ್ಟವಾಯಿತು',       en: 'Difficult' },
  { v: 1, kn: 'ತುಂಬಾ ಕಷ್ಟ',       en: 'Very difficult' },
];

const CSS = `
 textarea{width:100%;padding:13px;font:inherit;color:var(--ink);background:var(--bg);
   border:1px solid var(--line);border-radius:10px;min-height:120px;resize:vertical}
 .pick{display:flex;justify-content:space-between;align-items:center;gap:10px;
   border:1px solid var(--line);border-radius:10px;padding:13px;margin:0 0 8px;cursor:pointer}
 .pick.sel{border-color:var(--teal);box-shadow:0 0 0 2px var(--teal) inset}
 .pick b{font-weight:600}
 .done{text-align:center;padding:10px 0}
 .done .tick{font-size:40px;color:var(--good);line-height:1}
`;

/** The page shown after either form is submitted. */
function thanks({ cfg, L, headerKey, message }) {
  const num = String(process.env.WHATSAPP_BUSINESS_PHONENUMBER || '').replace(/\D/g, '');
  return shell({
    title: cfg.product_name || 'Pravesha',
    product: cfg.merchant_name || 'ServerPe App Solutions',
    header: t(L, headerKey),
    sub: '',
    extraCss: CSS,
    body: `<div class="card"><div class="done">
      <div class="tick">&#10003;</div>
      <p>${esc(message)}</p>
      <button id="back">${esc(t(L, 'back_to_whatsapp'))}</button>
    </div></div>
    <script>
    /* Same reason as the payment page: inside WhatsApp's own browser an
       https://wa.me link often does nothing, because there is nowhere to
       navigate to. The app scheme is what hands control back. */
    document.getElementById('back').onclick = function () {
      ${num ? `window.location.href = 'whatsapp://send?phone=${num}';` : ''}
      setTimeout(function () {
        window.location.href = 'https://wa.me/${num}';
      }, 1200);
    };
    </script>`,
  });
}

/* ───────────────────────────────────────────────────────────── support */

router.get('/support/:token', async (req, res) => {
  const me = await who(req.params.token);
  if (!me || me.spent) return expired(res, me?.spent);
  const L = me.lang;
  const cfg = await settings.all();
  const T = (k) => esc(t(L, k));

  res.type('html').send(shell({
    title: cfg.product_name || 'Pravesha',
    product: cfg.merchant_name || 'ServerPe App Solutions',
    header: t(L, 'menu_support'),
    sub: t(L, 'support_sub'),
    extraCss: CSS,
    body: `
<form method="POST" action="/support/${esc(req.params.token)}" id="f">
<div class="card">
  <h2>${T('support_type')}</h2>
  <div id="types">${QUERY_TYPES.map((q) =>
    `<div class="pick" data-v="${q.id}"><b>${esc(L === 'en' ? q.en : q.kn)}</b></div>`).join('')}</div>
  <input type="hidden" name="query_type" id="qt">
</div>
<div class="card">
  <h2>${T('support_details')}</h2>
  <textarea name="message" id="msg" placeholder="${T('support_placeholder')}"></textarea>
  <button type="submit" id="go" disabled>${T('submit')}</button>
</div>
</form>
<script>
var qt=document.getElementById('qt'),go=document.getElementById('go'),msg=document.getElementById('msg');
function ok(){ go.disabled = !(qt.value && msg.value.trim().length >= 5); }
document.querySelectorAll('.pick').forEach(function(el){el.onclick=function(){
  document.querySelectorAll('.pick').forEach(function(o){o.classList.remove('sel');});
  el.classList.add('sel'); qt.value = el.dataset.v; ok();};});
msg.oninput = ok;
</script>`,
  }));
});

router.post('/support/:token', express.urlencoded({ extended: false }), async (req, res) => {
  const me = await who(req.params.token);
  if (!me || me.spent) return expired(res, me?.spent);
  const L = me.lang;
  const cfg = await settings.all();

  const type = QUERY_TYPES.find((q) => q.id === req.body.query_type)?.id || 'other';
  const message = String(req.body.message || '').slice(0, 2000);

  await customers.logEvent(me.customer.id, 'support_request', {
    query_type: type, message, mobile: me.customer.mobile, via: 'web',
  });

  /* Recent bookings are attached so whoever answers is not starting by asking
     "which booking?" — the commonest first reply in any support thread. */
  const recent = await booking.forCustomer(me.customer.id, 3).catch(() => []);
  console.log('[support] %s (%s): %s | recent: %s', me.customer.mobile, type,
    message.slice(0, 120), recent.map((r) => r.ticket_no).join(', ') || 'none');

  /* Sent into the chat as well, so the thread the visitor will look at holds a
     record of what they asked. */
  send.text(me.customer.mobile,
    `${t(L, 'support_logged')}\n\n_${message.slice(0, 300)}_`).catch(() => {});

  res.type('html').send(thanks({ cfg, L,
    headerKey: 'menu_support', message: t(L, 'support_thanks') }));
});

/* ──────────────────────────────────────────────────────────── feedback */

router.get('/feedback/:token', async (req, res) => {
  const me = await who(req.params.token);
  if (!me || me.spent) return expired(res, me?.spent);
  const L = me.lang;
  const cfg = await settings.all();
  const T = (k) => esc(t(L, k));

  res.type('html').send(shell({
    title: cfg.product_name || 'Pravesha',
    product: cfg.merchant_name || 'ServerPe App Solutions',
    header: t(L, 'menu_feedback'),
    sub: t(L, 'feedback_sub'),
    extraCss: CSS,
    body: `
<form method="POST" action="/feedback/${esc(req.params.token)}" id="f">
<div class="card">
  <h2>${T('feedback_rating')}</h2>
  <div id="rates">${RATINGS.map((r) =>
    `<div class="pick" data-v="${r.v}"><b>${esc(L === 'en' ? r.en : r.kn)}</b>
       <span>${'&#9733;'.repeat(r.v)}</span></div>`).join('')}</div>
  <input type="hidden" name="rating" id="rt">
</div>
<div class="card">
  <h2>${T('feedback_comments')}</h2>
  <textarea name="message" id="msg" placeholder="${T('feedback_placeholder')}"></textarea>
  <button type="submit" id="go" disabled>${T('submit')}</button>
</div>
</form>
<script>
var rt=document.getElementById('rt'),go=document.getElementById('go');
document.querySelectorAll('.pick').forEach(function(el){el.onclick=function(){
  document.querySelectorAll('.pick').forEach(function(o){o.classList.remove('sel');});
  el.classList.add('sel'); rt.value = el.dataset.v; go.disabled = false;};});
</script>`,
  }));
});

router.post('/feedback/:token', express.urlencoded({ extended: false }), async (req, res) => {
  const me = await who(req.params.token);
  if (!me || me.spent) return expired(res, me?.spent);
  const L = me.lang;
  const cfg = await settings.all();

  const rating = Math.max(1, Math.min(5, Number(req.body.rating) || 0)) || null;
  const message = String(req.body.message || '').slice(0, 2000);

  await customers.logEvent(me.customer.id, 'feedback', {
    rating, message, mobile: me.customer.mobile, via: 'web',
  });
  console.log('[feedback] %s rated %s: %s', me.customer.mobile, rating,
    message.slice(0, 140) || '(no comment)');

  res.type('html').send(thanks({ cfg, L,
    headerKey: 'menu_feedback', message: t(L, 'feedback_thanks') }));
});

module.exports = router;
