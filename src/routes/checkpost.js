/**
 * routes/checkpost.js — the gate app and the API behind it.
 *
 * WHAT THE STAFF MEMBER DOES: reads the last three or four characters off the
 * number plate in front of them, types them, taps the vehicle that comes back,
 * and confirms. That is the whole job. The visitor presents nothing — no code,
 * no phone, no paper — so nothing can be forgotten, discharged or cracked.
 *
 * This replaced a QR scanner. The scanner was solving the wrong problem: a
 * ticket is bound to a vehicle, not to a person, so the plate was always the
 * thing being checked and the code merely restated it. Typing four characters
 * is also faster than comparing ten against a screen, which is what the officer
 * had to do anyway to be sure the code belonged to the car.
 *
 * ONLINE AND OFFLINE, AND WHY THE OFFLINE PATH IS NOT THE FALLBACK
 *
 *   With signal:    every search asks the server. The server is authoritative,
 *                   and — the reason this matters — it already knows about a
 *                   booking made thirty seconds ago at the gate itself. A
 *                   cached list cannot know that.
 *   Without signal: the search runs against the day's list held on the phone,
 *                   and each admission is queued. When signal returns the queue
 *                   drains by itself, in the background, without a dialog or a
 *                   spinner in front of somebody with a queue of cars.
 *
 * The day's list is a few hundred rows of about 130 bytes — around 50 KB for a
 * busy Sunday. That size is what makes holding it locally reasonable at all,
 * and it is refreshed on a timer while there is signal so it is never more than
 * a minute stale when the signal drops.
 *
 * The phone keeps the parsed list in memory only while it is actually offline.
 * With signal it is dropped and re-read on demand, because a gate phone is a
 * cheap phone and the browser tab is open for a nine-hour shift.
 *
 * WHAT IS RECORDED. Every lookup that ends in a decision, including every
 * refusal, with the staff member, the checkpost and the time. Admissions cannot
 * be conjured — a booking has to exist and be paid — so the pattern worth
 * watching for is a genuine visitor's booking burned before they arrive, and
 * that shows up as the real holder complaining at the barrier.
 */

const express = require('express');
const staff = require('../gatepass/staff');
const scan = require('../gatepass/scan');
const { one } = require('../gatepass/db');

const router = express.Router();

/* ─────────────────────────────────────────────────────────────────── auth */

const tokenOf = (req) =>
  (req.get('authorization') || '').replace(/^Bearer\s+/i, '') || req.body?.token || null;

async function requireSession(req, res, next) {
  const s = await staff.sessionFor(tokenOf(req));
  if (!s) return res.status(401).json({ ok: false, error: 'session_ended' });
  req.session = s;
  next();
}

/* ────────────────────────────────────────────────────────────────── API */

router.post('/api/gate/signin', express.json(), async (req, res) => {
  const { device_token, pin, takeover } = req.body || {};
  const r = await staff.signIn({ deviceToken: device_token, pin, takeover: !!takeover });

  if (!r.ok) {
    const status = r.reason === 'bad_pin' || r.reason === 'locked' ? 401 : 409;
    return res.status(status).json({ ok: false, ...r });
  }

  res.json({
    ok: true,
    token: r.token,
    staff: r.staff,
    checkpost: r.checkpost,
    took_over_from: r.took_over_from,
  });
});

router.post('/api/gate/signout', express.json(), requireSession, async (req, res) => {
  await staff.signOut(tokenOf(req));
  res.json({ ok: true });
});

router.get('/api/gate/status', requireSession, async (req, res) => {
  res.json({
    ok: true,
    staff: { id: req.session.staff_id, name: req.session.staff_name },
    checkpost: { id: req.session.checkpost_id, name: req.session.checkpost_name },
    today: await scan.todayAt(req.session.checkpost_id),
  });
});

/**
 * The day's bookings, for the phone to hold against losing signal.
 *
 * Deliberately without customer names or mobile numbers: a lost gate phone
 * should not be a list of who went up the hill, and neither field is needed to
 * decide whether to raise the boom.
 */
router.get('/api/gate/manifest', requireSession, async (req, res) => {
  const date = String(req.query.date || '').match(/^\d{4}-\d{2}-\d{2}$/)
    ? String(req.query.date)
    : new Date().toLocaleDateString('en-CA');
  res.json({ ok: true, ...(await scan.manifest(req.session.place_id, date)) });
});

/** Type a few characters, get the bookings whose plate ends with them. */
router.post('/api/gate/search', express.json(), requireSession, async (req, res) => {
  const r = await scan.search(String(req.body?.typed || ''), req.session);
  if (!r.ok) return res.json({ ok: false, reason: r.reason });

  res.json({
    ok: true,
    tail: r.tail,
    matches: r.candidates.map((c) => ({
      id: c.ticket.id,
      ticket_no: c.ticket.ticket_no,
      reg_no: c.ticket.reg_no,
      category: c.ticket.category_label,
      travel_date: c.ticket.travel_date,
      slot: c.ticket.slot_label,
      place: c.ticket.place_name,
      vehicle: [c.ticket.maker, c.ticket.model].filter(Boolean).join(' ') || null,
      /* The visitor chose this category themselves, because the registration
         database had no record of the vehicle. The staff member is the only
         person who can see whether it was chosen honestly. */
      declared: !!c.ticket.category_declared,
      matched_on: c.matched_on,
      verdict: c.verdict,
      message: c.message,
    })),
  });
});

/** Let one vehicle through. */
router.post('/api/gate/admit', express.json(), requireSession, async (req, res) => {
  const id = Number(req.body?.ticket_id);
  if (!id) return res.status(400).json({ ok: false, error: 'no_ticket' });

  const r = await scan.admit(id, req.session, { typed: String(req.body?.typed || '') });
  res.json({ ok: true, ...r, today: await scan.todayAt(req.session.checkpost_id) });
});

/**
 * Write down a vehicle that was turned away.
 *
 * Recorded because the refusals are the evidence the gate is doing its job. A
 * month of "arrived with no booking" is the number that tells the department
 * how much of the hill was coming up unticketed before this existed.
 */
router.post('/api/gate/refuse', express.json(), requireSession, async (req, res) => {
  const typed = String(req.body?.typed || '');
  const verdict = ['not_found', 'wrong_day', 'wrong_slot', 'wrong_place', 'cancelled',
    'already_used', 'not_paid'].includes(req.body?.verdict) ? req.body.verdict : 'not_found';

  const ticket = req.body?.ticket_id
    ? await one('SELECT * FROM tickets WHERE id = $1', [Number(req.body.ticket_id)])
    : null;

  const r = await scan.refuse(verdict, ticket, req.session, { typed });
  res.json({ ok: true, ...r, today: await scan.todayAt(req.session.checkpost_id) });
});

/**
 * Admissions taken while the phone had no signal.
 *
 * Each is judged against the time it was TAKEN, not the time it arrived — a
 * vehicle admitted at 07:10 and synced at 11:00 must be graded against 07:10 or
 * every offline entry would come back "wrong slot". Each returns its own
 * verdict, including the ones that turn out to have been admitted at another
 * lane in the meantime.
 */
router.post('/api/gate/sync', express.json(), requireSession, async (req, res) => {
  const items = Array.isArray(req.body?.entries) ? req.body.entries.slice(0, 300) : [];
  const results = [];

  for (const it of items) {
    const at = it.at ? new Date(it.at) : new Date();
    const r = await scan.admit(Number(it.ticket_id), req.session,
      { at, wasOffline: true, typed: String(it.typed || '') });
    results.push({ client_id: it.client_id, ...r });
  }

  res.json({ ok: true, results, today: await scan.todayAt(req.session.checkpost_id) });
});

/* ───────────────────────────────────────────────────────────────── the app */

router.get('/gate', (req, res) => res.type('html').send(APP));

/* The old address, kept working. Gate phones were set up with /scan bookmarked
   and some have it on a home screen; silently breaking those on a Sunday is
   not worth the tidiness of one removed route. */
router.get('/scan', (req, res) => res.redirect(301, '/gate' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '')));

const APP = String.raw`<!doctype html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<meta name="theme-color" content="#0f172a">
<title>Checkpost</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#0f172a;color:#f1f5f9;
 font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overscroll-behavior:none}
.wrap{max-width:520px;margin:0 auto;min-height:100vh;display:flex;flex-direction:column}
header{padding:12px 16px;background:#111c33;display:flex;justify-content:space-between;
 align-items:center;border-bottom:1px solid #1e293b;position:sticky;top:0;z-index:5}
header b{font-size:15px}
header small{display:block;color:#94a3b8;font-size:11px;font-weight:400}
.dot{width:9px;height:9px;border-radius:50%;display:inline-block;margin-right:6px}
.on{background:#22c55e}.off{background:#f59e0b}
main{flex:1;padding:16px}
label{display:block;font-size:12px;color:#94a3b8;margin:12px 0 6px;letter-spacing:.6px}
input{width:100%;padding:14px;font-size:18px;border-radius:10px;border:1px solid #334155;
 background:#1e293b;color:#f1f5f9;text-align:center;letter-spacing:4px}
#tail{font-size:40px;font-weight:700;letter-spacing:10px;padding:18px 14px;text-transform:uppercase}
button{width:100%;margin-top:14px;padding:15px;font-size:16px;font-weight:600;border:0;
 border-radius:11px;background:#0ea5e9;color:#001321}
button.ghost{background:#1e293b;color:#cbd5e1;margin-top:10px}
button:disabled{opacity:.5}
.hint{color:#64748b;font-size:12.5px;text-align:center;margin:8px 0 0}

/* One row per matching booking. Wide targets: this is tapped with a thumb,
   often through a car window, sometimes in rain. */
.row{display:flex;justify-content:space-between;align-items:center;gap:10px;width:100%;
 background:#1e293b;border:1px solid #334155;border-radius:12px;padding:13px 14px;
 margin:0 0 9px;text-align:left;color:inherit;font:inherit}
.row .p{font-size:21px;font-weight:700;letter-spacing:1.5px}
.row small{display:block;color:#94a3b8;font-size:12px;font-weight:400;letter-spacing:0}
.pill{font-size:10.5px;font-weight:700;padding:5px 9px;border-radius:999px;white-space:nowrap;
 letter-spacing:.5px}
.p-ok{background:#14532d;color:#bbf7d0}
.p-warn{background:#78350f;color:#fed7aa}
.p-bad{background:#7f1d1d;color:#fecaca}

.verdict{border-radius:16px;padding:22px 18px;text-align:center;margin-bottom:14px}
.verdict h2{margin:0 0 6px;font-size:26px;letter-spacing:1px}
.verdict p{margin:0;font-size:14px;opacity:.92}
.verdict .plate{font-size:31px;font-weight:700;letter-spacing:2px;margin:10px 0 4px}
.ok{background:#14532d;color:#dcfce7}
.warn{background:#78350f;color:#fed7aa}
.bad{background:#7f1d1d;color:#fecaca}
.counts{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap}
.chip{background:#1e293b;border-radius:9px;padding:8px 11px;font-size:12px;color:#cbd5e1;
 flex:1;text-align:center}
.chip b{display:block;font-size:18px;color:#f1f5f9}
.err{background:#7f1d1d;color:#fecaca;border-radius:10px;padding:12px;margin-top:14px;font-size:14px}
.queue{margin-top:12px;font-size:12px;color:#f59e0b;text-align:center}

/* The confirm sheet. Deliberately a full overlay rather than a toast: letting a
   vehicle in is the one irreversible action here, and it should take a
   deliberate tap on a screen showing nothing else. */
.sheet{position:fixed;inset:0;background:rgba(2,6,23,.82);display:flex;align-items:flex-end;
 z-index:20}
.sheet>div{background:#111c33;border-radius:18px 18px 0 0;padding:22px 18px 26px;width:100%;
 max-width:520px;margin:0 auto;border-top:1px solid #1e293b}
.sheet .big{font-size:38px;font-weight:700;letter-spacing:2px;text-align:center;margin:6px 0 2px}
.sheet .sub{text-align:center;color:#94a3b8;font-size:13.5px;margin-bottom:4px}
.sheet .meta{display:flex;gap:8px;margin:16px 0 4px}
.sheet .meta div{flex:1;background:#1e293b;border-radius:10px;padding:10px;text-align:center}
.sheet .meta span{display:block;color:#94a3b8;font-size:10.5px;letter-spacing:.6px}
.sheet .meta b{font-size:14px}
.warnbox{background:#78350f;color:#fed7aa;border-radius:11px;padding:12px;margin-top:14px;
 font-size:13.5px;text-align:center}
</style></head><body>
<div class="wrap">
  <header>
    <div><b id="who">Checkpost</b><small id="where">Not signed in</small></div>
    <small><span class="dot off" id="net"></span><span id="netlabel">offline</span></small>
  </header>
  <main>
    <div id="signin">
      <p style="color:#94a3b8;font-size:14px">Sign in with your own PIN. Every entry is recorded against you.</p>
      <label>STAFF PIN</label>
      <input id="pin" type="tel" inputmode="numeric" maxlength="6" placeholder="------">
      <button id="go">Sign in</button>
      <div id="signinerr"></div>
    </div>

    <div id="gate" hidden>
      <div id="result"></div>
      <label>NUMBER PLATE OR BOOKING CODE</label>
      <input id="tail" type="text" inputmode="latin" autocomplete="off"
             autocapitalize="characters" spellcheck="false" maxlength="8" placeholder="8147">
      <p class="hint" id="hint">Last few characters of the plate, or the booking code</p>
      <div id="matches"></div>
      <div class="counts" id="counts"></div>
      <div class="queue" id="queue"></div>
      <button class="ghost" id="out">End shift</button>
    </div>
  </main>
</div>
<div id="sheet"></div>

<script>
const $ = (id) => document.getElementById(id);
const HINT = 'Last few characters of the plate, or the booking code';
const LS = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del: (k) => { try { localStorage.removeItem(k); } catch (e) {} },
};

/* The device token identifies the PHONE and is put here once by the
   administrator, as ?device=... . Kept so the gate phone does not need
   re-registering every shift. */
const url = new URL(location.href);
if (url.searchParams.get('device')) {
  LS.set('device_token', url.searchParams.get('device'));
  history.replaceState({}, '', '/gate');
}

let session = LS.get('session');
let today = {};

/* ---------------------------------------------------- the offline queue

   One key per entry rather than one array.

   A busy Sunday with no signal can put a thousand entries in here. Rewriting a
   whole array on every admission means serialising a growing blob a thousand
   times, and the phone gets perceptibly slower as the shift wears on — exactly
   when the queue at the barrier is longest. One key per entry is a constant
   cost however many are already waiting.                                     */

const Q = 'q:';
const queueIds = () => {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf(Q) === 0) out.push(k.slice(Q.length));
    }
  } catch (e) {}
  return out;
};
const queueCount = () => queueIds().length;

/* ------------------------------------------------------- the day's list

   Held in a variable ONLY while the phone is offline. With signal the searches
   go to the server, which is authoritative and — the part a cache cannot do —
   already knows about a booking made at this gate a minute ago. So the parsed
   array is dropped when signal returns and re-read from storage if it goes
   again. A gate phone is a cheap phone with this tab open for nine hours.   */

let MEM = null;

const todayStr = () => new Date().toLocaleDateString('en-CA');

function loadMem() {
  if (MEM) return MEM;
  const m = LS.get('manifest');
  MEM = (m && m.date === todayStr() && Array.isArray(m.tickets)) ? m.tickets : [];
  return MEM;
}
const dropMem = () => { MEM = null; };

async function refreshManifest() {
  if (!online() || !session) return;
  try {
    const r = await api('GET', '/api/gate/manifest?date=' + todayStr());
    if (r && r.ok) {
      LS.set('manifest', { date: r.date, at: r.at, tickets: r.tickets });
      if (MEM) MEM = r.tickets;      // only if we were holding one
    }
  } catch (e) { /* a stale list is better than none; try again next tick */ }
}

/* ------------------------------------------------------------- network */

const online = () => navigator.onLine;

function paintNet() {
  $('net').className = 'dot ' + (online() ? 'on' : 'off');
  $('netlabel').textContent = online() ? 'online' : 'offline';
  if (online()) dropMem(); else loadMem();
}

window.addEventListener('online', () => { paintNet(); flush(); refreshManifest(); });
window.addEventListener('offline', paintNet);

async function api(method, path, body) {
  const opt = { method, headers: {} };
  if (session) opt.headers['authorization'] = 'Bearer ' + session.token;
  if (body) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const res = await fetch(path, opt);
  if (res.status === 401) { endSession(); return null; }
  return res.json();
}

/* --------------------------------------------------------- signing in */

$('go').onclick = async () => {
  const device = LS.get('device_token');
  if (!device) { $('signinerr').innerHTML = '<div class="err">This phone is not registered. Ask the administrator for its link.</div>'; return; }
  $('go').disabled = true;
  try {
    const r = await api('POST', '/api/gate/signin',
      { device_token: device, pin: $('pin').value, takeover: true });
    if (!r || !r.ok) {
      $('signinerr').innerHTML = '<div class="err">' +
        (r && r.reason === 'bad_pin' ? 'Wrong PIN.' :
         r && r.reason === 'locked' ? 'This PIN is locked. Ask the supervisor.' :
         'Could not sign in.') + '</div>';
      return;
    }
    session = r; LS.set('session', r); start();
  } finally { $('go').disabled = false; }
};

function start() {
  $('signin').hidden = true;
  $('gate').hidden = false;
  $('who').textContent = (session.staff && session.staff.name) || 'Staff';
  $('where').textContent = (session.checkpost && session.checkpost.name) || '';
  paintNet(); paintQueue(); refreshManifest(); flush(); status();
  $('tail').focus();
}

async function status() {
  const r = await api('GET', '/api/gate/status');
  if (r && r.ok) { today = r.today || {}; paintCounts(); }
}

/* ------------------------------------------------------------ searching */

let timer = null;
$('tail').oninput = () => {
  clearTimeout(timer);
  const v = $('tail').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  $('tail').value = v;
  if (v.length < 3) { $('matches').innerHTML = ''; $('hint').textContent = HINT; return; }
  $('hint').textContent = 'Searching…';
  /* Debounced so a four-character entry is one request, not four. Short
     enough that it still feels immediate to somebody typing quickly. */
  timer = setTimeout(() => search(v), 160);
};

async function search(tail) {
  let matches = [];

  if (online()) {
    const r = await api('POST', '/api/gate/search', { typed: tail });
    if (!r) return;
    matches = r.ok ? r.matches : [];
  } else {
    matches = localSearch(tail);
  }

  $('hint').textContent = matches.length
    ? (matches.length === 1 ? '1 vehicle' : matches.length + ' vehicles — pick the right one')
    : 'Nothing found for ' + tail;

  $('matches').innerHTML = matches.map(function (m, i) {
    return '<button class="row" data-i="' + i + '">' +
      '<span><span class="p">' + m.reg_no + '</span>' +
      '<small>' + [(m.matched_on === 'code' ? 'code ' + m.ticket_no : m.ticket_no),
                   m.category, m.slot].filter(Boolean).join(' · ') + '</small></span>' +
      '<span class="pill ' + pillClass(m.verdict) + '">' + pillText(m.verdict) +
        (m.declared ? ' ?' : '') + '</span>' +
      '</button>';
  }).join('');

  const els = document.querySelectorAll('#matches .row');
  for (let i = 0; i < els.length; i++) {
    els[i].onclick = function () { confirmSheet(matches[this.dataset.i], tail); };
  }

  /* Nothing at all is itself a decision, and it is written down — a month of
     these is what tells the department how many vehicles arrive unticketed. */
  if (!matches.length && online()) api('POST', '/api/gate/refuse', { typed: tail, verdict: 'not_found' });
}

/* The same judgement as the server's, for when there is no server.

   Only the parts that can be decided from the row itself: status, date and the
   slot start. Deliberately not a second opinion on anything else — where this
   and the server could disagree, the server wins when the queue syncs. */
function localSearch(tail) {
  const list = loadMem();
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const t = todayStr();
  const out = [];

  for (let i = 0; i < list.length; i++) {
    const x = list[i];
    const byPlate = String(x.reg_no).slice(-tail.length) === tail;
    const byCode = String(x.ticket_no).slice(-tail.length) === tail;
    if (!byPlate && !byCode) continue;

    let verdict = 'valid';
    if (x.status === 'used') verdict = 'already_used';
    else if (x.status !== 'paid') verdict = 'not_paid';
    else if (String(x.travel_date).slice(0, 10) !== t) verdict = 'wrong_day';
    else {
      const parts = String(x.starts_at).split(':');
      if (mins < (+parts[0]) * 60 + (+parts[1]) - 60) verdict = 'wrong_slot';
    }

    out.push({ id: x.id, ticket_no: x.ticket_no, reg_no: x.reg_no,
      category: x.category_label, slot: x.slot_label, declared: !!x.category_declared,
      matched_on: byPlate ? 'plate' : 'code',
      travel_date: String(x.travel_date).slice(0, 10), verdict: verdict });
  }
  return out;
}

const pillClass = (v) => v === 'valid' ? 'p-ok'
  : (v === 'wrong_day' || v === 'wrong_slot' || v === 'wrong_place') ? 'p-warn' : 'p-bad';
const pillText = (v) => ({
  valid: 'LET IN', already_used: 'ALREADY IN', wrong_day: 'WRONG DAY',
  wrong_slot: 'TOO EARLY', wrong_place: 'OTHER GATE', cancelled: 'CANCELLED',
  not_paid: 'NOT PAID', not_found: 'NO BOOKING',
})[v] || String(v).toUpperCase();

/* ------------------------------------------------------ the confirm sheet */

function confirmSheet(m, tail) {
  const bad = m.verdict !== 'valid';

  $('sheet').innerHTML =
    '<div class="sheet"><div>' +
      '<div class="sub">CONFIRM THIS VEHICLE</div>' +
      '<div class="big">' + m.reg_no + '</div>' +
      '<div class="sub">Booking ' + m.ticket_no + '</div>' +
      (m.vehicle ? '<div class="sub">' + m.vehicle + '</div>' : '') +
      '<div class="meta">' +
        '<div><span>TYPE</span><b>' + (m.category || '—') + '</b></div>' +
        '<div><span>ENTRY TIME</span><b>' + (m.slot || '—') + '</b></div>' +
      '</div>' +
      (bad ? '<div class="warnbox"><b>' + pillText(m.verdict) + '</b><br>' +
             (m.message || '') + '</div>' : '') +
      (m.declared ? '<div class="warnbox">TYPE CHOSEN BY THE VISITOR<br>' +
             'This vehicle was not in the registration database. Check it is a ' +
             (m.category || 'vehicle of this type') + '.</div>' : '') +
      '<button id="yes"' + (bad ? ' style="background:#b45309;color:#fff"' : '') + '>' +
        (bad ? 'Record and turn away' : 'Let in') + '</button>' +
      '<button class="ghost" id="no">Cancel</button>' +
    '</div></div>';

  $('no').onclick = closeSheet;
  $('yes').onclick = function () {
    closeSheet();
    if (bad) refuse(m, tail); else admit(m, tail);
  };
}

const closeSheet = () => { $('sheet').innerHTML = ''; };

/* --------------------------------------------------------- letting in */

async function admit(m, tail) {
  if (online()) {
    const r = await api('POST', '/api/gate/admit', { ticket_id: m.id, typed: tail });
    if (r && r.ok) { today = r.today || today; show(r.verdict, m, r.message); }
    return;
  }

  /* No signal: decide from the list, mark it locally so the next lookup at
     this phone says "already in", and queue it. The staff member sees the same
     green screen either way — the syncing is our problem, not theirs. */
  const list = loadMem();
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === m.id) { list[i].status = 'used'; list[i].used_at = new Date().toISOString(); }
  }
  LS.set('manifest', { date: todayStr(), at: new Date().toISOString(), tickets: list });

  const cid = 'c' + Date.now() + Math.random().toString(36).slice(2, 6);
  LS.set(Q + cid, { client_id: cid, ticket_id: m.id, typed: tail, at: new Date().toISOString() });

  today.valid = (today.valid || 0) + 1; today.total = (today.total || 0) + 1;
  show('valid', m, 'Recorded on this phone. It will sync when there is signal.');
  paintQueue();
}

async function refuse(m, tail) {
  if (online()) {
    const r = await api('POST', '/api/gate/refuse',
      { ticket_id: m.id, typed: tail, verdict: m.verdict });
    if (r && r.ok) today = r.today || today;
  }
  show(m.verdict, m, m.message);
}

/* ----------------------------------------------------------- the queue */

function paintQueue() {
  const n = queueCount();
  $('queue').textContent = n ? n + ' entr' + (n === 1 ? 'y' : 'ies') + ' waiting to sync' : '';
}

/**
 * Drain the queue.
 *
 * Runs on a timer and on reconnect, and says nothing while it works. The staff
 * member has a car in front of them; a dialog about synchronisation is an
 * interruption that helps nobody. Only a genuine conflict — a vehicle admitted
 * at another lane in the meantime — is worth surfacing, and that lands in the
 * report rather than on this screen.
 */
let flushing = false;
async function flush() {
  if (flushing || !online() || !session) return;
  const ids = queueIds();
  if (!ids.length) return;

  flushing = true;
  try {
    const entries = ids.map((id) => LS.get(Q + id)).filter(Boolean);
    const r = await api('POST', '/api/gate/sync', { entries: entries });
    if (r && r.ok) {
      for (let i = 0; i < ids.length; i++) LS.del(Q + ids[i]);
      today = r.today || today;
      paintCounts();
    }
  } catch (e) {
    /* Left in the queue on purpose. A failed sync must never drop an entry:
       the row on this phone is the only record that vehicle came through. */
  } finally { flushing = false; paintQueue(); }
}

/* ---------------------------------------------------------- the verdict */

let clearTimer = null;
function show(verdict, m, message) {
  const cls = verdict === 'valid' ? 'ok'
    : (verdict === 'wrong_day' || verdict === 'wrong_slot' || verdict === 'wrong_place') ? 'warn'
    : 'bad';

  $('result').innerHTML =
    '<div class="verdict ' + cls + '">' +
      '<h2>' + pillText(verdict) + '</h2>' +
      '<div class="plate">' + (m ? m.reg_no : '') + '</div>' +
      '<p>' + (message || '') + '</p>' +
    '</div>';

  $('tail').value = '';
  $('matches').innerHTML = '';
  $('hint').textContent = 'Type at least 3';
  $('tail').focus();
  paintCounts();

  if (navigator.vibrate) navigator.vibrate(verdict === 'valid' ? 40 : [60, 60, 60]);

  /* Cleared after a few seconds so the next vehicle never sees the last one's
     verdict still on the screen — which is how the wrong car gets waved on. */
  clearTimeout(clearTimer);
  clearTimer = setTimeout(() => { $('result').innerHTML = ''; }, 5000);
}

function paintCounts() {
  const order = [['valid', 'In'], ['not_found', 'No booking'], ['already_used', 'Repeat'],
                 ['wrong_day', 'Wrong day'], ['total', 'Total']];
  $('counts').innerHTML = order.filter((p) => today[p[0]])
    .map((p) => '<div class="chip"><b>' + today[p[0]] + '</b>' + p[1] + '</div>').join('');
}

/* ------------------------------------------------------------ shift end */

$('out').onclick = async () => {
  if (queueCount() && !confirm('There are entries still waiting to sync. End the shift anyway?')) return;
  await api('POST', '/api/gate/signout', {});
  endSession();
};

function endSession() {
  session = null;
  LS.del('session');
  LS.del('manifest');
  dropMem();
  $('gate').hidden = true;
  $('signin').hidden = false;
  $('who').textContent = 'Checkpost';
  $('where').textContent = 'Not signed in';
}

/* Background work, on one timer: keep the day's list fresh so it is never more
   than a minute stale when signal drops, and drain anything waiting. */
setInterval(() => { refreshManifest(); flush(); }, 60000);

paintNet();
if (session) start();
</script>
</body></html>`;

module.exports = router;
