/**
 * feedbackWeb.js — "how was your visit?"
 *
 * A page with two questions on it, opened from a button in the chat after the
 * pass has been delivered. It is deliberately the smallest thing that could
 * work: five stars, a box for words, and a send button. Anything more — name,
 * email, which gate, would you recommend us — is a form, and a form asked of
 * somebody standing in a car park is a form nobody fills in.
 *
 * THE LINK IS THE IDENTITY. It is the same signed, single-use token the booking
 * link uses, issued with purpose 'feedback', so the page knows who is writing
 * and about which visit without asking either. A booking link cannot be spent
 * here and this cannot be spent on a booking.
 *
 * SUBMITTING TWICE IS AN EDIT, NOT A SECOND OPINION. Somebody who changes their
 * mind, or taps send twice on a bad connection, should not become two rows in a
 * report. The pass is the key, and the row is written or updated accordingly.
 *
 * NOTHING SAID HERE IS PUBLIC. Publishing a comment as a testimonial is a
 * separate, deliberate decision made by a person in the panel, and the page says
 * so plainly — it would be a small betrayal to collect words under "tell us how
 * we did" and print them on a marketing site the next morning.
 */

const express = require('express');
const { query, one } = require('../gatepass/db');
const token = require('../gatepass/webToken');
const { t: tr, langOf } = require('../i18n');

const router = express.Router();
const json = express.json({ limit: '16kb' });

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const safe = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) {
    console.error('[feedback] %s %s: %s', req.method, req.path, e.stack || e.message);
    res.status(500).type('html').send(shell('Something went wrong', '<p>Please try again in a moment.</p>'));
  }
};

/* The most recent pass this visitor has, which is the one they are rating. */
async function lastPassFor(customerId) {
  return one(
    `SELECT t.id, t.ticket_no, t.travel_date, t.place_id, p.name AS place_name
       FROM tickets t JOIN places p ON p.id = t.place_id
      WHERE t.customer_id = $1 AND t.status IN ('paid', 'used')
      ORDER BY t.travel_date DESC, t.created_at DESC LIMIT 1`, [customerId]);
}

/* ───────────────────────────────────────────────────────────────── the page */

function shell(title, body, extraHead = '') {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} · Pravesha</title>
<style>
  :root{--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--card:#fff;--bg:#f6f8f7;--accent:#00a884;--star:#f59e0b}
  @media(prefers-color-scheme:dark){:root{--ink:#e8eef5;--muted:#93a3b5;--line:#25303c;--card:#121a23;--bg:#0b1219}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
       display:flex;justify-content:center;padding:18px}
  .card{width:100%;max-width:460px;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:22px}
  h1{margin:0 0 4px;font-size:20px}
  p.sub{margin:0 0 18px;color:var(--muted);font-size:14px}
  .stars{display:flex;justify-content:center;gap:6px;margin:6px 0 4px}
  .star{width:52px;height:52px;border:0;background:none;padding:0;cursor:pointer;color:var(--line);
        transition:transform .12s ease,color .12s ease}
  .star svg{width:100%;height:100%;display:block}
  .star.on{color:var(--star)}
  .star:active{transform:scale(.9)}
  .word{text-align:center;min-height:22px;font-size:14px;font-weight:600;color:var(--muted);margin-bottom:14px}
  label{display:block;font-size:13px;font-weight:600;color:var(--muted);margin:0 0 6px}
  textarea{width:100%;min-height:104px;padding:12px;border:1px solid var(--line);border-radius:12px;resize:vertical;
           font:inherit;background:var(--card);color:var(--ink)}
  textarea:focus{outline:2px solid var(--accent);outline-offset:1px}
  .count{text-align:right;font-size:12px;color:var(--muted);margin-top:4px}
  button.send{width:100%;margin-top:14px;padding:15px;border:0;border-radius:12px;background:var(--accent);
              color:#fff;font-size:16px;font-weight:700;cursor:pointer}
  button.send[disabled]{opacity:.45;cursor:not-allowed}
  .note{margin-top:14px;font-size:12.5px;color:var(--muted);line-height:1.45}
  .done{text-align:center;padding:26px 6px}
  .done .tick{width:64px;height:64px;margin:0 auto 12px;border-radius:50%;background:rgba(0,168,132,.12);
              display:grid;place-items:center;font-size:32px;color:var(--accent)}
  .err{margin-top:12px;padding:10px 12px;border-radius:10px;background:#fdeceb;color:#a4160c;font-size:14px}
  @media(prefers-color-scheme:dark){.err{background:#3f1310;color:#ffb3ab}}
</style>${extraHead}</head><body><div class="card">${body}</div></body></html>`;
}

const STAR = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.4-5.8-3-5.8 3 1.1-6.4L2.6 9.4l6.5-.9Z"/></svg>';

function ratingPage({ pass, existing, place }) {
  const stars = [1, 2, 3, 4, 5]
    .map((i) => `<button type="button" class="star" data-v="${i}" aria-label="${i} star${i === 1 ? '' : 's'}">${STAR}</button>`)
    .join('');

  return shell('How was your visit?', `
  <h1>How was your visit?</h1>
  <p class="sub">${esc(place || 'Pravesha')}${pass ? ` · pass ${esc(pass.ticket_no)}` : ''}</p>

  <div class="stars" id="stars">${stars}</div>
  <div class="word" id="word">Tap a star</div>

  <label for="comment">Anything you would like to tell us? (optional)</label>
  <textarea id="comment" maxlength="600" placeholder="The queue, the staff, the road, the view — whatever stood out."></textarea>
  <div class="count"><span id="count">0</span>/600</div>

  <button type="button" class="send" id="send" disabled>Send</button>
  <div id="err"></div>

  <p class="note">
    This goes to the people who run the entry gate. Nothing you write is shown publicly unless somebody there
    asks for it to be used as a testimonial — and then only the words and the name they choose to show.
  </p>

  <script>
  (function () {
    var value = ${existing ? Number(existing.rating) : 0};
    var WORDS = ['', 'Poor', 'Not good', 'All right', 'Good', 'Excellent'];
    var stars = [].slice.call(document.querySelectorAll('.star'));
    var word = document.getElementById('word');
    var comment = document.getElementById('comment');
    var count = document.getElementById('count');
    var send = document.getElementById('send');
    var err = document.getElementById('err');

    comment.value = ${JSON.stringify(existing && existing.comment ? existing.comment : '')};

    function paint() {
      stars.forEach(function (s) { s.classList.toggle('on', Number(s.dataset.v) <= value); });
      word.textContent = value ? WORDS[value] : 'Tap a star';
      send.disabled = !value;
    }
    stars.forEach(function (s) {
      s.addEventListener('click', function () { value = Number(s.dataset.v); paint(); });
    });
    comment.addEventListener('input', function () { count.textContent = comment.value.length; });
    count.textContent = comment.value.length;
    paint();

    send.addEventListener('click', function () {
      if (!value) return;
      send.disabled = true;
      send.textContent = 'Sending…';
      err.innerHTML = '';
      fetch(location.pathname, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rating: value, comment: comment.value })
      }).then(function (r) { return r.json(); }).then(function (r) {
        if (!r.ok) throw new Error(r.message || 'Could not send that.');
        document.querySelector('.card').innerHTML =
          '<div class="done"><div class="tick">&#10003;</div><h1>Thank you</h1>' +
          '<p class="sub">' + (value >= 4
            ? 'We are glad it went well. It helps to hear it.'
            : 'Thank you for saying so — this is read by the people who can fix it.') +
          '</p><p class="note">You can close this page and go back to WhatsApp.</p></div>';
      }).catch(function (e) {
        send.disabled = false;
        send.textContent = 'Send';
        err.innerHTML = '<div class="err">' + (e.message || 'Could not send that.') + '</div>';
      });
    });
  }());
  </script>`);
}

/* ──────────────────────────────────────────────────────────────── the routes */

/*
 * Everything below needs a live feedback token.
 *
 * Written as a plain middleware rather than wrapped in safe(): that helper takes
 * (req, res) and would quietly drop `next`, which is how this first went out
 * answering every rating link with a 500.
 */
const gate = async (req, res, next) => {
  try {
    const check = await token.verify(req.params.token);
    if (!check.ok) {
      return res.status(410).type('html').send(shell('Link expired',
        '<h1>This link has expired</h1><p class="sub">Send <b>hi</b> on WhatsApp and tap “Rate your visit” again.</p>'));
    }
    if (check.purpose !== 'feedback') {
      return res.status(400).type('html').send(shell('Wrong link',
        '<h1>That link is for something else</h1><p class="sub">Please use the rating link from your chat.</p>'));
    }
    req.customer = await one('SELECT * FROM customers WHERE id = $1', [check.customerId]);
    if (!req.customer) {
      return res.status(404).type('html').send(shell('Not found', '<h1>We could not find you</h1>'));
    }
    return next();
  } catch (e) {
    console.error('[feedback] gate %s: %s', req.path, e.stack || e.message);
    return res.status(500).type('html').send(shell('Something went wrong', '<p>Please try again in a moment.</p>'));
  }
};

router.get('/rate/:token', gate, safe(async (req, res) => {
  const pass = await lastPassFor(req.customer.id);
  const existing = pass
    ? await one('SELECT rating, comment FROM feedback WHERE ticket_id = $1', [pass.id])
    : await one('SELECT rating, comment FROM feedback WHERE customer_id = $1 ORDER BY id DESC LIMIT 1', [req.customer.id]);

  res.type('html').send(ratingPage({ pass, existing, place: pass ? pass.place_name : null }));
}));

router.post('/rate/:token', json, gate, safe(async (req, res) => {
  const rating = Number(req.body?.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ ok: false, message: 'Please tap a star first.' });
  }
  const comment = String(req.body?.comment || '').trim().slice(0, 600) || null;
  const pass = await lastPassFor(req.customer.id);

  /* One opinion per pass: saying it again is a correction, not a second voice. */
  const row = await one(
    `INSERT INTO feedback (ticket_id, customer_id, place_id, rating, comment, source, is_test)
     VALUES ($1, $2, $3, $4, $5, 'whatsapp', $6)
     ON CONFLICT (ticket_id) WHERE ticket_id IS NOT NULL
     DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, modified_at = now()
     RETURNING id, rating`,
    [pass ? pass.id : null, req.customer.id, pass ? pass.place_id : null,
      rating, comment, req.customer.is_test === true]);

  require('../log').event('wa', 'rated', `${'•'.repeat(6)}${String(req.customer.mobile).slice(-4)}  ${rating}★${comment ? ` · "${comment.slice(0, 40)}"` : ''}`);
  res.json({ ok: true, id: String(row.id) });
}));

/*
 * What the marketing site shows.
 *
 * Public, unauthenticated and cached, because it is a handful of sentences
 * somebody deliberately published — but only ever those: the query is filtered
 * on is_published, and the shape returned has no room for a mobile number, a
 * pass number or a date more precise than a month. A testimonial page must not
 * double as a way of working out who came when.
 */
router.get('/public/testimonials', safe(async (req, res) => {
  const feedback = require('../gatepass/adminFeedback');
  const list = await feedback.published({ limit: req.query.limit });
  res.set('Cache-Control', 'public, max-age=300')
    .json({ ok: true, testimonials: list });
}));

module.exports = router;
