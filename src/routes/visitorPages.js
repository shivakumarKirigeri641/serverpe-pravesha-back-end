/**
 * visitorPages.js — the Support and Postpone pages opened from WhatsApp
 * (user, 2026-09-19).
 *
 *   GET  /support/:token           a box to write a concern in
 *   POST /support/:token           stored, emailed to admin@serverpe.in, answered on WhatsApp
 *
 *   GET  /postpone/:token          the visitor's passes that may be moved, a date, a slot,
 *                                  the rules, and a box to tick agreeing to them
 *   GET  /postpone/:token/slots    slots with room for one pass on one date
 *   POST /postpone/:token          the move itself (gatepass/postpone.js), then the
 *                                  updated pass on WhatsApp
 *
 * THE LINK IS THE IDENTITY, as for booking and rating: a signed, single-purpose
 * token names the visitor, so neither page asks who they are. A support link
 * cannot open the postpone page, nor the other way round.
 *
 * IN THE VISITOR'S LANGUAGE, and the postpone rules are shown in full on the
 * page — the same words as the Terms — with a box that must be ticked. What was
 * agreed is recorded with the move.
 */

const express = require('express');
const { one, query } = require('../gatepass/db');
const token = require('../gatepass/webToken');
const { langOf } = require('../i18n');
const L = require('../localize');

const router = express.Router();
const json = express.json({ limit: '16kb' });

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const inScript = (value) => JSON.stringify(value).replace(/</g, '\\u003c');
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

const SUPPORT_TO = () => process.env.SUPPORT_EMAIL || 'admin@serverpe.in';

/* ──────────────────────────────────────────────────────────────── the words */

const COPY = {
  en: {
    supportTitle: 'Support',
    supportSub: 'Tell us what you need help with. Our team reads every message and replies on WhatsApp.',
    topic: 'What is it about?',
    topics: ['Booking or payment', 'My pass', 'Entry at the checkpost', 'Postponing a pass', 'Something else'],
    message: 'Your message',
    messagePh: 'Please describe the issue — the pass number helps if you have one.',
    email: 'Email (optional, if you would like a reply by email)',
    send: 'Send', sending: 'Sending…',
    sent: 'Message received', sentSub: (ref) => `Reference ${ref}. We will reply on WhatsApp as soon as we can.`,
    tooShort: 'Please write a little more so we can help.',
    close: 'You can close this page and go back to WhatsApp.',
    couldNot: 'Could not send that. Please try again.',

    ppTitle: 'Postpone your pass',
    ppSub: 'Move a pass to another date and slot.',
    choosePass: 'Pass', newDate: 'New date', newSlot: 'New slot',
    left: (n) => `${n} left`, full: 'Full', closed: 'Closed', current: 'Current slot', past: 'Over',
    pickDate: 'Choose a date to see the slots.', noSlots: 'No slot has room on this date. Choose another date.',
    rulesTitle: 'Postponement terms',
    rules: (r) => [
      `A pass can be postponed only once.`,
      `Allowed until ${r.cutoffHours} hours before your booked slot starts.`,
      `The new date must be within the next ${r.windowDays} days, in a slot that still has room.`,
      `There is no fee, and no refund or difference in amount — the pass, vehicle and amount paid stay the same.`,
      `The pass number stays the same. Your old date and slot are released and can no longer be used.`,
      `Passes already used, and passes whose postponement window has passed, cannot be moved.`,
    ],
    agree: 'I have read and agree to the postponement terms, and to the Pravesha Terms and Privacy Policy.',
    confirm: 'Postpone pass', confirming: 'Postponing…',
    done: 'Pass postponed', doneSub: (d, s) => `Your pass is now for ${d}, ${s}. The updated pass has been sent to you on WhatsApp.`,
    none: 'You have no pass that can be postponed right now.',
    noneWhy: 'Only paid passes that have not been used or moved before can be postponed, until 24 hours before the slot.',
    notAllowed: 'Cannot postpone',
  },
  kn: {
    supportTitle: 'ಸಹಾಯ',
    supportSub: 'ನಿಮಗೆ ಯಾವುದರಲ್ಲಿ ಸಹಾಯ ಬೇಕು ಎಂದು ತಿಳಿಸಿ. ನಮ್ಮ ತಂಡ ಪ್ರತಿ ಸಂದೇಶವನ್ನು ಓದಿ WhatsApp ನಲ್ಲಿ ಉತ್ತರಿಸುತ್ತದೆ.',
    topic: 'ಯಾವುದರ ಬಗ್ಗೆ?',
    topics: ['ಬುಕ್ಕಿಂಗ್ ಅಥವಾ ಪಾವತಿ', 'ನನ್ನ ಪಾಸ್', 'ಚೆಕ್‌ಪೋಸ್ಟ್‌ನಲ್ಲಿ ಪ್ರವೇಶ', 'ಪಾಸ್ ಮುಂದೂಡಿಕೆ', 'ಬೇರೆ ಏನಾದರೂ'],
    message: 'ನಿಮ್ಮ ಸಂದೇಶ',
    messagePh: 'ದಯವಿಟ್ಟು ಸಮಸ್ಯೆಯನ್ನು ವಿವರಿಸಿ — ಪಾಸ್ ಸಂಖ್ಯೆ ಇದ್ದರೆ ಸಹಾಯವಾಗುತ್ತದೆ.',
    email: 'ಇಮೇಲ್ (ಐಚ್ಛಿಕ, ಇಮೇಲ್ ಮೂಲಕ ಉತ್ತರ ಬೇಕಿದ್ದರೆ)',
    send: 'ಕಳುಹಿಸಿ', sending: 'ಕಳುಹಿಸಲಾಗುತ್ತಿದೆ…',
    sent: 'ಸಂದೇಶ ತಲುಪಿದೆ', sentSub: (ref) => `ಉಲ್ಲೇಖ ${ref}. ಆದಷ್ಟು ಬೇಗ WhatsApp ನಲ್ಲಿ ಉತ್ತರಿಸುತ್ತೇವೆ.`,
    tooShort: 'ದಯವಿಟ್ಟು ಇನ್ನಷ್ಟು ವಿವರ ಬರೆಯಿರಿ.',
    close: 'ನೀವು ಈ ಪುಟವನ್ನು ಮುಚ್ಚಿ WhatsApp ಗೆ ಹಿಂತಿರುಗಬಹುದು.',
    couldNot: 'ಕಳುಹಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',

    ppTitle: 'ನಿಮ್ಮ ಪಾಸ್ ಮುಂದೂಡಿ',
    ppSub: 'ಪಾಸ್ ಅನ್ನು ಬೇರೆ ದಿನಾಂಕ ಮತ್ತು ಸ್ಲಾಟ್‌ಗೆ ಬದಲಾಯಿಸಿ.',
    choosePass: 'ಪಾಸ್', newDate: 'ಹೊಸ ದಿನಾಂಕ', newSlot: 'ಹೊಸ ಸ್ಲಾಟ್',
    left: (n) => `${n} ಉಳಿದಿವೆ`, full: 'ಭರ್ತಿ', closed: 'ಮುಚ್ಚಿದೆ', current: 'ಈಗಿನ ಸ್ಲಾಟ್', past: 'ಮುಗಿದಿದೆ',
    pickDate: 'ಸ್ಲಾಟ್‌ಗಳನ್ನು ನೋಡಲು ದಿನಾಂಕ ಆಯ್ಕೆಮಾಡಿ.', noSlots: 'ಈ ದಿನಾಂಕದಲ್ಲಿ ಯಾವ ಸ್ಲಾಟ್‌ನಲ್ಲೂ ಸ್ಥಳವಿಲ್ಲ. ಬೇರೆ ದಿನಾಂಕ ಆಯ್ಕೆಮಾಡಿ.',
    rulesTitle: 'ಮುಂದೂಡಿಕೆಯ ನಿಯಮಗಳು',
    rules: (r) => [
      'ಒಂದು ಪಾಸ್ ಅನ್ನು ಒಮ್ಮೆ ಮಾತ್ರ ಮುಂದೂಡಬಹುದು.',
      `ನಿಮ್ಮ ಸ್ಲಾಟ್ ಆರಂಭವಾಗುವ ${r.cutoffHours} ಗಂಟೆಗಳ ಮುಂಚೆವರೆಗೆ ಮಾತ್ರ ಅವಕಾಶ.`,
      `ಹೊಸ ದಿನಾಂಕ ಮುಂದಿನ ${r.windowDays} ದಿನಗಳೊಳಗಿರಬೇಕು, ಸ್ಥಳವಿರುವ ಸ್ಲಾಟ್‌ನಲ್ಲಿ.`,
      'ಯಾವುದೇ ಶುಲ್ಕವಿಲ್ಲ, ಮತ್ತು ಮರುಪಾವತಿ ಅಥವಾ ಮೊತ್ತದ ವ್ಯತ್ಯಾಸವಿಲ್ಲ — ಪಾಸ್, ವಾಹನ ಮತ್ತು ಪಾವತಿಸಿದ ಮೊತ್ತ ಬದಲಾಗುವುದಿಲ್ಲ.',
      'ಪಾಸ್ ಸಂಖ್ಯೆ ಅದೇ ಇರುತ್ತದೆ. ಹಳೆಯ ದಿನಾಂಕ ಮತ್ತು ಸ್ಲಾಟ್ ರದ್ದಾಗುತ್ತದೆ.',
      'ಈಗಾಗಲೇ ಬಳಸಿದ ಪಾಸ್‌ಗಳು ಮತ್ತು ಮುಂದೂಡಿಕೆ ಅವಧಿ ಮುಗಿದ ಪಾಸ್‌ಗಳನ್ನು ಬದಲಾಯಿಸಲಾಗುವುದಿಲ್ಲ.',
    ],
    agree: 'ಮುಂದೂಡಿಕೆಯ ನಿಯಮಗಳು ಹಾಗೂ ಪ್ರವೇಶ ನಿಯಮಗಳು ಮತ್ತು ಗೌಪ್ಯತಾ ನೀತಿಯನ್ನು ಓದಿ ಒಪ್ಪುತ್ತೇನೆ.',
    confirm: 'ಪಾಸ್ ಮುಂದೂಡಿ', confirming: 'ಮುಂದೂಡಲಾಗುತ್ತಿದೆ…',
    done: 'ಪಾಸ್ ಮುಂದೂಡಲಾಗಿದೆ', doneSub: (d, s) => `ನಿಮ್ಮ ಪಾಸ್ ಈಗ ${d}, ${s} ಕ್ಕೆ. ಹೊಸ ಪಾಸ್ ಅನ್ನು WhatsApp ನಲ್ಲಿ ಕಳುಹಿಸಲಾಗಿದೆ.`,
    none: 'ಈಗ ಮುಂದೂಡಬಹುದಾದ ಯಾವುದೇ ಪಾಸ್ ನಿಮ್ಮಲ್ಲಿಲ್ಲ.',
    noneWhy: 'ಬಳಸದ ಮತ್ತು ಹಿಂದೆ ಮುಂದೂಡದ ಪಾವತಿಸಿದ ಪಾಸ್‌ಗಳನ್ನು ಮಾತ್ರ, ಸ್ಲಾಟ್‌ಗೆ 24 ಗಂಟೆ ಮುಂಚೆವರೆಗೆ ಮುಂದೂಡಬಹುದು.',
    notAllowed: 'ಮುಂದೂಡಲು ಸಾಧ್ಯವಿಲ್ಲ',
  },
};

const BOTH = {
  expired: '<h1>This link has expired</h1><p class="sub">Open the menu on WhatsApp to get a new one.</p>'
    + '<h1 style="margin-top:18px">ಈ ಲಿಂಕ್ ಅವಧಿ ಮುಗಿದಿದೆ</h1><p class="sub">ಹೊಸ ಲಿಂಕ್‌ಗಾಗಿ WhatsApp ನಲ್ಲಿ ಮೆನು ತೆರೆಯಿರಿ.</p>',
  wrong: '<h1>That link is for something else</h1><h1 style="margin-top:18px">ಈ ಲಿಂಕ್ ಬೇರೆ ಉದ್ದೇಶಕ್ಕಾಗಿ</h1>',
  error: '<h1>Something went wrong</h1><p class="sub">Please try again in a moment.</p>'
    + '<h1 style="margin-top:18px">ಏನೋ ತಪ್ಪಾಗಿದೆ</h1><p class="sub">ಸ್ವಲ್ಪ ಸಮಯದ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.</p>',
};

function shell(title, body, lang = 'en') {
  return `<!doctype html><html lang="${lang === 'kn' ? 'kn' : 'en'}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} · Pravesha</title>
<style>
  :root{--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--card:#fff;--bg:#f6f8f7;--accent:#00a884;--brand:#075e54;--warn:#b45309;--warnbg:#fff7ed}
  @media(prefers-color-scheme:dark){:root{--ink:#e8eef5;--muted:#93a3b5;--line:#25303c;--card:#121a23;--bg:#0b1219;--warnbg:#2a1d0c;--warn:#fbbf24}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans Kannada",sans-serif;
       display:flex;justify-content:center;padding:18px}
  .card{width:100%;max-width:480px;background:var(--card);border:1px solid var(--line);border-radius:18px;overflow:hidden}
  .head{background:var(--brand);color:#fff;padding:18px 22px}
  .head .brand{font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;opacity:.8}
  .head h1{margin:2px 0 0;font-size:21px}
  .body{padding:20px 22px 22px}
  p.sub{margin:0 0 16px;color:var(--muted);font-size:14px}
  label{display:block;font-size:13px;font-weight:600;color:var(--muted);margin:14px 0 6px}
  select,input,textarea{width:100%;padding:12px;border:1px solid var(--line);border-radius:12px;font:inherit;background:var(--card);color:var(--ink)}
  textarea{min-height:120px;resize:vertical}
  select:focus,input:focus,textarea:focus{outline:2px solid var(--accent);outline-offset:1px}
  .opt{display:block;width:100%;text-align:left;margin:0 0 8px;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--ink);font:inherit;cursor:pointer}
  .opt.on{border-color:var(--accent);box-shadow:0 0 0 2px rgba(0,168,132,.25)}
  .opt[disabled]{opacity:.5;cursor:not-allowed}
  .opt small{display:block;color:var(--muted);font-size:13px}
  .slots{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .slots .opt{margin:0}
  .rules{margin-top:16px;padding:14px 16px;border-radius:12px;background:var(--warnbg);color:var(--ink);font-size:14px}
  .rules b{color:var(--warn)}
  .rules ul{margin:6px 0 0;padding-left:18px}
  .agree{display:flex;gap:10px;align-items:flex-start;margin-top:14px;font-size:14px}
  .agree input{width:20px;height:20px;margin-top:2px;flex:none}
  button.go{width:100%;margin-top:16px;padding:15px;border:0;border-radius:12px;background:var(--accent);color:#fff;font-size:16px;font-weight:700;cursor:pointer}
  button.go[disabled]{opacity:.45;cursor:not-allowed}
  .done{text-align:center;padding:26px 6px}
  .done .tick{width:64px;height:64px;margin:0 auto 12px;border-radius:50%;background:rgba(0,168,132,.12);display:grid;place-items:center;font-size:32px;color:var(--accent)}
  .err{margin-top:12px;padding:10px 12px;border-radius:10px;background:#fdeceb;color:#a4160c;font-size:14px}
  .note{margin-top:14px;font-size:12.5px;color:var(--muted)}
  a{color:var(--accent)}
</style></head><body><div class="card">${body}</div></body></html>`;
}

const header = (title) => `<div class="head"><div class="brand">Pravesha · ಪ್ರವೇಶ</div><h1>${esc(title)}</h1></div>`;
const plain = (html) => shell('Pravesha', `<div class="body">${html}</div>`);

/** A live token for this purpose, and the visitor it names. */
const gate = (purpose) => async (req, res, next) => {
  try {
    const check = await token.verify(req.params.token);
    if (!check.ok) return res.status(410).type('html').send(plain(BOTH.expired));
    if (check.purpose !== purpose) return res.status(400).type('html').send(plain(BOTH.wrong));
    req.customer = await one('SELECT * FROM customers WHERE id = $1', [check.customerId]);
    if (!req.customer) return res.status(410).type('html').send(plain(BOTH.expired));
    req.lang = langOf(req.customer);
    return next();
  } catch (e) {
    console.error('[pages] gate %s: %s', req.path, e.stack || e.message);
    return res.status(500).type('html').send(plain(BOTH.error));
  }
};

const safe = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) {
    console.error('[pages] %s %s: %s', req.method, req.path, e.stack || e.message);
    if (req.method === 'GET') res.status(500).type('html').send(plain(BOTH.error));
    else res.status(500).json({ ok: false, message: (COPY[req.lang] || COPY.en).couldNot });
  }
};

/* ────────────────────────────────────────────────────────────────── support */

router.get('/support/:token', gate('support'), safe(async (req, res) => {
  const c = COPY[req.lang];
  const W = { send: c.send, sending: c.sending, sent: c.sent, close: c.close, couldNot: c.couldNot, tooShort: c.tooShort };
  res.type('html').send(shell(c.supportTitle, `${header(c.supportTitle)}<div class="body">
  <p class="sub">${esc(c.supportSub)}</p>
  <label for="topic">${esc(c.topic)}</label>
  <select id="topic">${c.topics.map((x) => `<option>${esc(x)}</option>`).join('')}</select>
  <label for="msg">${esc(c.message)}</label>
  <textarea id="msg" maxlength="2000" placeholder="${esc(c.messagePh)}"></textarea>
  <label for="email">${esc(c.email)}</label>
  <input id="email" type="email" maxlength="160" autocomplete="email">
  <button type="button" class="go" id="go">${esc(c.send)}</button>
  <div id="err"></div>
  <script>
  (function () {
    var C = ${inScript(W)};
    var go = document.getElementById('go'), err = document.getElementById('err');
    go.addEventListener('click', function () {
      var msg = document.getElementById('msg').value.trim();
      err.innerHTML = '';
      if (msg.length < 10) { var b = document.createElement('div'); b.className = 'err'; b.textContent = C.tooShort; err.appendChild(b); return; }
      go.disabled = true; go.textContent = C.sending;
      fetch(location.pathname, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topic: document.getElementById('topic').value, message: msg, email: document.getElementById('email').value.trim() })
      }).then(function (r) { return r.json(); }).then(function (r) {
        if (!r.ok) throw new Error(r.message || C.couldNot);
        document.querySelector('.body').innerHTML = '<div class="done"><div class="tick">&#10003;</div><h1></h1><p class="sub"></p><p class="note"></p></div>';
        document.querySelector('.done h1').textContent = C.sent;
        document.querySelector('.done .sub').textContent = r.sentText;
        document.querySelector('.done .note').textContent = C.close;
      }).catch(function (e) {
        go.disabled = false; go.textContent = C.send;
        var b = document.createElement('div'); b.className = 'err'; b.textContent = (e && e.message) || C.couldNot; err.appendChild(b);
      });
    });
  }());
  </script></div>`, req.lang));
}));

router.post('/support/:token', json, gate('support'), safe(async (req, res) => {
  const c = COPY[req.lang];
  const message = String(req.body?.message || '').trim().slice(0, 2000);
  const topic = String(req.body?.topic || '').trim().slice(0, 80) || null;
  const emailRaw = String(req.body?.email || '').trim().toLowerCase().slice(0, 160);
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailRaw) ? emailRaw : null;
  if (message.length < 10) return res.status(400).json({ ok: false, message: c.tooShort });

  const cu = req.customer;
  const name = cu.name || cu.wa_profile_name || 'WhatsApp visitor';
  const row = await one(
    `INSERT INTO contact_messages (name, email, mobile, subject, message, source)
     VALUES ($1, $2, $3, $4, $5, 'whatsapp') RETURNING id`,
    [name, email || '(WhatsApp — no email given)', cu.mobile, topic, message]);
  const ref = `PVS${String(row.id).padStart(5, '0')}`;

  /* What support will want to know first: this visitor's recent passes. */
  const passes = (await query(
    `SELECT t.ticket_no, t.reg_no, t.pass_kind, t.persons, t.travel_date, t.status
       FROM tickets t WHERE t.customer_id = $1 AND t.status IN ('paid', 'used')
      ORDER BY t.travel_date DESC LIMIT 5`, [cu.id])).rows
    .map((p) => ({ ticketNo: p.ticket_no, what: p.reg_no || `${p.persons || 1} persons`, date: iso(p.travel_date), status: p.status }));

  const mail = require('../mail');
  const out = await mail.send(mail.supportMail({ to: SUPPORT_TO(), id: row.id, name, mobile: cu.mobile, email, topic, message, passes }));
  await query(
    `UPDATE contact_messages SET mail_status = $2, mail_error = $3, sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE NULL END WHERE id = $1`,
    [row.id, out.status, out.error || null]);
  await token.spend(req.params.token);

  /* The visitor's own record of it, in the chat. */
  const send = require('../whatsapp/send');
  const { t } = require('../i18n');
  send.text(require('../whatsapp/phone').toWa(cu.mobile), t('supportReceived', req.lang, { ref })).catch(() => {});
  require('../log').event('wa', 'support', `${ref} · ${'•'.repeat(6)}${String(cu.mobile).slice(-4)} · ${topic || ''} · mail ${out.status}`);

  res.json({ ok: true, reference: ref, sentText: c.sentSub(ref) });
}));

/* ───────────────────────────────────────────────────────────────── postpone */

router.get('/postpone/:token', gate('postpone'), safe(async (req, res) => {
  const lang = req.lang;
  const c = COPY[lang];
  const pp = require('../gatepass/postpone');
  const list = await pp.forCustomer(req.customer.id);
  const rules = await pp.rules();
  const w = await pp.window();
  const passes = list.map(({ t, verdict }) => ({
    ticketNo: t.ticket_no,
    what: t.reg_no || (lang === 'kn' ? `${t.persons || 1} ಜನರು` : `${t.persons || 1} persons`),
    place: L.placeName(t, lang),
    when: `${L.longDate(t.travel_date, lang)} · ${L.slotLabel(t, lang) || ''}`,
    ok: verdict.ok,
    why: verdict.ok ? null : verdict.message,
  }));

  const W = {
    pickDate: c.pickDate, noSlots: c.noSlots, left: c.left(0).replace('0', '{n}'), full: c.full, closed: c.closed,
    current: c.current, past: c.past, confirm: c.confirm, confirming: c.confirming, done: c.done, close: c.close, couldNot: c.couldNot,
  };
  const body = !passes.length
    ? `<p class="sub"><b>${esc(c.none)}</b></p><p class="sub">${esc(c.noneWhy)}</p>`
    : `
  <p class="sub">${esc(c.ppSub)}</p>
  <label>${esc(c.choosePass)}</label>
  <div id="passes">${passes.map((p, i) => `<button type="button" class="opt" data-no="${esc(p.ticketNo)}" ${p.ok ? '' : 'disabled'}>
      <b>${esc(p.what)}</b> · ${esc(p.ticketNo)}<small>${esc(p.place)} · ${esc(p.when)}</small>
      ${p.ok ? '' : `<small>⚠ ${esc(c.notAllowed)}: ${esc(p.why)}</small>`}</button>`).join('')}</div>
  <label for="date">${esc(c.newDate)}</label>
  <input id="date" type="date" min="${esc(w.from)}" max="${esc(w.to)}" disabled>
  <label>${esc(c.newSlot)}</label>
  <div id="slots" class="slots"><p class="sub" style="grid-column:1/-1">${esc(c.pickDate)}</p></div>
  <div class="rules"><b>${esc(c.rulesTitle)}</b><ul>${c.rules(rules).map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div>
  <label class="agree"><input type="checkbox" id="agree"><span>${esc(c.agree)}
    <a href="https://www.pravesha.in/policy/terms" target="_blank" rel="noopener">Terms</a> ·
    <a href="https://www.pravesha.in/policy/privacy" target="_blank" rel="noopener">Privacy</a></span></label>
  <button type="button" class="go" id="go" disabled>${esc(c.confirm)}</button>
  <div id="err"></div>
  <script>
  (function () {
    var C = ${inScript(W)};
    var ticket = null, slot = null, busy = false;
    var date = document.getElementById('date'), slots = document.getElementById('slots');
    var agree = document.getElementById('agree'), go = document.getElementById('go'), err = document.getElementById('err');
    function ready() { go.disabled = busy || !(ticket && date.value && slot && agree.checked); }
    function fail(m) { err.innerHTML = ''; var b = document.createElement('div'); b.className = 'err'; b.textContent = m || C.couldNot; err.appendChild(b); }
    [].forEach.call(document.querySelectorAll('#passes .opt'), function (b) {
      b.addEventListener('click', function () {
        [].forEach.call(document.querySelectorAll('#passes .opt'), function (x) { x.classList.remove('on'); });
        b.classList.add('on'); ticket = b.dataset.no; slot = null; date.disabled = false;
        if (date.value) load(); ready();
      });
    });
    function load() {
      slot = null; ready();
      slots.innerHTML = '<p class="sub" style="grid-column:1/-1">…</p>';
      fetch(location.pathname + '/slots?ticket=' + encodeURIComponent(ticket) + '&date=' + date.value)
        .then(function (r) { return r.json(); }).then(function (r) {
          if (!r.ok) throw new Error(r.message);
          slots.innerHTML = '';
          if (!r.slots.some(function (s) { return s.bookable; })) {
            slots.innerHTML = '<p class="sub" style="grid-column:1/-1"></p>'; slots.firstChild.textContent = C.noSlots;
          }
          r.slots.forEach(function (s) {
            var b = document.createElement('button'); b.type = 'button'; b.className = 'opt';
            b.disabled = !s.bookable;
            var tag = s.reason === 'current' ? C.current : s.reason === 'full' ? C.full : s.reason === 'closed' ? C.closed
              : s.reason === 'time' ? C.past : C.left.replace('{n}', s.remaining);
            b.innerHTML = '<b></b><small></small>';
            b.querySelector('b').textContent = s.label; b.querySelector('small').textContent = tag;
            b.addEventListener('click', function () {
              [].forEach.call(slots.querySelectorAll('.opt'), function (x) { x.classList.remove('on'); });
              b.classList.add('on'); slot = s.slotId; ready();
            });
            slots.appendChild(b);
          });
        }).catch(function (e) { slots.innerHTML = ''; fail(e && e.message); });
    }
    date.addEventListener('change', function () { if (ticket && date.value) load(); });
    agree.addEventListener('change', ready);
    go.addEventListener('click', function () {
      busy = true; ready(); go.textContent = C.confirming; err.innerHTML = '';
      fetch(location.pathname, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ticketNo: ticket, date: date.value, slotId: slot, agreed: agree.checked })
      }).then(function (r) { return r.json(); }).then(function (r) {
        if (!r.ok) throw new Error(r.message);
        document.querySelector('.body').innerHTML = '<div class="done"><div class="tick">&#10003;</div><h1></h1><p class="sub"></p><p class="note"></p></div>';
        document.querySelector('.done h1').textContent = C.done;
        document.querySelector('.done .sub').textContent = r.doneText;
        document.querySelector('.done .note').textContent = C.close;
      }).catch(function (e) { busy = false; go.textContent = C.confirm; ready(); fail(e && e.message); });
    });
  }());
  </script>`;
  res.type('html').send(shell(c.ppTitle, `${header(c.ppTitle)}<div class="body">${body}</div>`, lang));
}));

/** The pass, if it belongs to the visitor the link names. */
async function ownPass(req, ticketNo) {
  const booking = require('../gatepass/booking');
  const pp = require('../gatepass/postpone');
  const cand = booking.passNumberCandidates(String(ticketNo || '').trim().toUpperCase());
  if (!cand.length) return null;
  return pp.load('t.ticket_no = ANY($1::text[]) AND t.customer_id = $2', [cand, req.customer.id]);
}

router.get('/postpone/:token/slots', gate('postpone'), safe(async (req, res) => {
  const t = await ownPass(req, req.query.ticket);
  if (!t) return res.status(404).json({ ok: false, message: 'No such pass.' });
  const out = await require('../gatepass/postpone').slotsFor(t, String(req.query.date || ''));
  res.set('Cache-Control', 'no-store').status(out.ok ? 200 : 400).json(out);
}));

router.post('/postpone/:token', json, gate('postpone'), safe(async (req, res) => {
  const c = COPY[req.lang];
  if (req.body?.agreed !== true) return res.status(400).json({ ok: false, message: c.agree });
  const t = await ownPass(req, req.body?.ticketNo);
  if (!t) return res.status(404).json({ ok: false, message: 'No such pass.' });

  const pp = require('../gatepass/postpone');
  const rules = await pp.rules();
  const termsVersion = await require('../whatsapp/welcome').termsVersionNow().catch(() => null);
  const out = await pp.move({
    ticketId: t.id, date: String(req.body.date || ''), slotId: req.body.slotId, by: 'visitor', customerId: req.customer.id,
    consent: { agreedAt: new Date().toISOString(), termsVersion, rules, lang: req.lang, ip: (req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim() },
  });
  if (!out.ok) return res.status(400).json(out);
  await token.spend(req.params.token);

  /* The updated pass, on WhatsApp, with a line saying what changed. */
  const fresh = await pp.load('t.id = $1', [out.ticketId]);
  const when = L.longDate(fresh.travel_date, req.lang);
  const slotName = L.slotLabel(fresh, req.lang) || out.to.slotLabel;
  const { t: tr } = require('../i18n');
  const send = require('../whatsapp/send');
  const to = require('../whatsapp/phone').toWa(req.customer.mobile);
  (async () => {
    await send.text(to, tr('postponedDone', req.lang, { ticket: fresh.ticket_no, date: when, slot: slotName }));
    await require('../whatsapp/deliver').resendPass(fresh.id);
  })().catch((e) => console.error('[postpone] notify %s: %s', fresh.ticket_no, e.message));

  res.json({ ok: true, ticketNo: fresh.ticket_no, date: iso(fresh.travel_date), doneText: c.doneSub(when, slotName) });
}));

module.exports = router;
