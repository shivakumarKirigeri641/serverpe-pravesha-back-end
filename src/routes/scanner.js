/**
 * routes/scanner.js — the checkpost app and the API behind it.
 *
 * The app is a web page rather than an installed app, and that is a deliberate
 * choice for this deployment: a gate phone can be replaced on a Sunday by
 * opening a link, with no store, no APK sideloading and no version drift
 * between gates. The trade is that it must work offline anyway — which it does,
 * because verification is a signature check the page performs itself.
 *
 * WHAT NEEDS THE NETWORK AND WHAT DOES NOT:
 *
 *   Offline, always:  is this ticket genuine? right plate, day, slot, gate?
 *   Online, ideally:  has this exact ticket already come through?
 *
 * The second one is the only shared fact, so a scan taken with no signal is
 * marked "not yet checked for duplicates" and queued. When signal returns it
 * syncs, and any duplicate that slipped through appears in the report with the
 * time and the staff member. The department sees the gap rather than being told
 * a comforting story about it.
 */

const express = require('express');
const path = require('path');
const staff = require('../gatepass/staff');
const scan = require('../gatepass/scan');
const sign = require('../gatepass/sign');
const { query } = require('../gatepass/db');

const router = express.Router();

/* The two libraries the page needs, served from our own origin so the gate
   never depends on a CDN it may not be able to reach. */
router.use('/scan/vendor/ed25519.js', express.static(
  path.join(__dirname, '..', '..', 'node_modules', '@noble', 'ed25519', 'index.js')));
router.use('/scan/vendor/jsqr.js', express.static(
  path.join(__dirname, '..', '..', 'node_modules', 'jsqr', 'dist', 'jsQR.js')));

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

router.post('/api/scan/signin', async (req, res) => {
  const { device_token, pin, takeover } = req.body || {};
  const r = await staff.signIn({ deviceToken: device_token, pin, takeover: !!takeover });

  if (!r.ok) {
    const status = r.reason === 'bad_pin' || r.reason === 'locked' ? 401 : 409;
    return res.status(status).json({ ok: false, ...r });
  }

  // The public key goes to the phone; the private key never leaves the server.
  // This is the whole reason the scheme is asymmetric.
  const keys = sign.scannerKeys();
  res.json({
    ok: true,
    token: r.token,
    staff: r.staff,
    checkpost: r.checkpost,
    took_over_from: r.took_over_from,
    // Raw 32 bytes, stripped of the DER wrapper the browser library does not want.
    public_key: Buffer.from(keys.public_key, 'base64').slice(-32).toString('base64'),
    key_id: keys.key_id,
    version: keys.version,
  });
});

router.post('/api/scan/signout', requireSession, async (req, res) => {
  await staff.signOut(tokenOf(req));
  res.json({ ok: true });
});

router.get('/api/scan/status', requireSession, async (req, res) => {
  res.json({
    ok: true,
    staff: { id: req.session.staff_id, name: req.session.staff_name },
    checkpost: { id: req.session.checkpost_id, name: req.session.checkpost_name },
    today: await scan.todayAt(req.session.checkpost_id),
  });
});

/** One scan, taken online. The server decides and consumes the ticket. */
router.post('/api/scan/verify', requireSession, async (req, res) => {
  const { payload } = req.body || {};
  if (!payload) return res.status(400).json({ ok: false, error: 'no_payload' });

  const r = await scan.record(payload, req.session);
  res.json({ ok: true, ...r, today: await scan.todayAt(req.session.checkpost_id) });
});

/**
 * A queue of scans taken while offline.
 *
 * Each is judged against the time it was TAKEN, not the time it arrived, and
 * each comes back with its own verdict — including the ones that turn out to
 * have been duplicates. The phone shows those to the staff member so a pattern
 * at one gate is visible to the person standing at it.
 */
router.post('/api/scan/sync', requireSession, async (req, res) => {
  const items = Array.isArray(req.body?.scans) ? req.body.scans.slice(0, 200) : [];
  const results = [];

  for (const it of items) {
    const at = it.scanned_at ? new Date(it.scanned_at) : new Date();
    const r = await scan.record(it.payload, req.session, { at, wasOffline: true });
    results.push({ client_id: it.client_id, ...r });
  }

  res.json({ ok: true, results, today: await scan.todayAt(req.session.checkpost_id) });
});

/* ───────────────────────────────────────────────────────────────── the app */

router.get('/scan', (req, res) => res.type('html').send(APP));

const APP = String.raw`<!doctype html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<meta name="theme-color" content="#0f172a">
<title>Checkpost Scanner</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#0f172a;color:#f1f5f9;
 font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overscroll-behavior:none}
.wrap{max-width:520px;margin:0 auto;min-height:100vh;display:flex;flex-direction:column}
header{padding:14px 18px;background:#111c33;display:flex;justify-content:space-between;align-items:center;
 border-bottom:1px solid #1e293b}
header b{font-size:15px}
header small{display:block;color:#94a3b8;font-size:11px;font-weight:400}
.dot{width:9px;height:9px;border-radius:50%;display:inline-block;margin-right:6px}
.on{background:#22c55e}.off{background:#f59e0b}
main{flex:1;padding:18px}
label{display:block;font-size:12px;color:#94a3b8;margin:14px 0 6px;letter-spacing:.6px}
input{width:100%;padding:14px;font-size:18px;border-radius:10px;border:1px solid #334155;
 background:#1e293b;color:#f1f5f9;text-align:center;letter-spacing:4px}
button{width:100%;margin-top:16px;padding:15px;font-size:16px;font-weight:600;border:0;border-radius:11px;
 background:#0ea5e9;color:#001321}
button.ghost{background:#1e293b;color:#cbd5e1;margin-top:10px}
button:disabled{opacity:.5}
#video{width:100%;border-radius:14px;background:#000;aspect-ratio:1;object-fit:cover}
.verdict{border-radius:16px;padding:22px 18px;text-align:center;margin-bottom:14px}
.verdict h2{margin:0 0 6px;font-size:26px;letter-spacing:1px}
.verdict p{margin:0;font-size:14px;opacity:.9}
.verdict .plate{font-size:30px;font-weight:700;letter-spacing:2px;margin:10px 0 4px}
.ok{background:#14532d;color:#dcfce7}
.warn{background:#78350f;color:#fed7aa}
.bad{background:#7f1d1d;color:#fecaca}
.counts{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap}
.chip{background:#1e293b;border-radius:9px;padding:8px 11px;font-size:12px;color:#cbd5e1;flex:1;text-align:center}
.chip b{display:block;font-size:18px;color:#f1f5f9}
.err{background:#7f1d1d;color:#fecaca;border-radius:10px;padding:12px;margin-top:14px;font-size:14px}
.queue{margin-top:12px;font-size:12px;color:#f59e0b;text-align:center}
</style></head><body>
<div class="wrap">
  <header>
    <div><b id="who">Checkpost Scanner</b><small id="where">Not signed in</small></div>
    <small><span class="dot off" id="net"></span><span id="netlabel">offline</span></small>
  </header>
  <main>
    <div id="signin">
      <p style="color:#94a3b8;font-size:14px">Sign in with your own PIN. Every scan is recorded against you.</p>
      <label>STAFF PIN</label>
      <input id="pin" type="tel" inputmode="numeric" maxlength="6" placeholder="------">
      <button id="go">Sign in</button>
      <div id="signinerr"></div>
    </div>

    <div id="scanner" hidden>
      <div id="result"></div>
      <video id="video" playsinline muted></video>
      <div class="counts" id="counts"></div>
      <div class="queue" id="queue"></div>
      <button class="ghost" id="out">End shift</button>
    </div>
  </main>
</div>

<script type="module">
import * as ed from '/scan/vendor/ed25519.js';

const $ = (id) => document.getElementById(id);
const LS = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} },
};

/* The device token identifies the PHONE and is put here once by the
   administrator, as ?device=... . It is kept so the gate phone does not need
   re-registering every shift. */
const url = new URL(location.href);
if (url.searchParams.get('device')) {
  LS.set('device_token', url.searchParams.get('device'));
  history.replaceState({}, '', '/scan');
}

let session = LS.get('session');

/* ------------------------------------------------- the offline scan queue

   Stored one key per scan rather than as a single array.

   A busy Sunday with no signal can put 1500 scans in here. Rewriting the whole
   array on every scan would mean serialising a growing 450KB blob 1500 times —
   the phone gets perceptibly slower as the shift wears on, exactly when the
   queue at the barrier is longest. One key per scan is a constant-cost write no
   matter how many are already waiting.                                       */

const Q = 'q:';        // a queued scan
const SEEN = 's:';     // a ticket this device has already admitted today

const queueIds = () => {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(Q)) out.push(k.slice(Q.length));
    }
  } catch {}
  return out;
};
const queueCount = () => queueIds().length;

const online = () => navigator.onLine;
function paintNet() {
  $('net').className = 'dot ' + (online() ? 'on' : 'off');
  $('netlabel').textContent = online() ? 'online' : 'offline';
}
addEventListener('online', () => { paintNet(); flush(); });
addEventListener('offline', paintNet);
paintNet();

/* ------------------------------------------------------------- sign in */

$('go').onclick = async () => {
  const pin = $('pin').value.trim();
  const device_token = LS.get('device_token');
  if (!device_token) return err('This phone is not registered to a checkpost. Ask the administrator for its link.');
  if (pin.length < 4) return err('Enter your PIN.');

  $('go').disabled = true;
  try {
    const r = await post('/api/scan/signin', { device_token, pin }, true);
    if (!r.ok && r.reason === 'gate_busy') {
      if (confirm(r.held_by + ' is signed in at this gate. Take over?')) {
        const r2 = await post('/api/scan/signin', { device_token, pin, takeover: true }, true);
        if (!r2.ok) return err(reason(r2.reason));
        return start(r2);
      }
      $('go').disabled = false; return;
    }
    if (!r.ok) { $('go').disabled = false; return err(reason(r.reason)); }
    start(r);
  } catch (e) {
    $('go').disabled = false;
    err('Cannot reach the server. Sign in needs network once, at the start of the shift.');
  }
};

function reason(r) {
  return ({
    bad_pin: 'Wrong PIN.',
    locked: 'Too many wrong attempts. Try again in 15 minutes.',
    unknown_device: 'This phone is not registered.',
    device_revoked: 'This phone has been withdrawn.',
  })[r] || 'Could not sign in.';
}
const err = (m) => { $('signinerr').innerHTML = '<div class="err">' + m + '</div>'; };

function start(r) {
  session = r;
  LS.set('session', r);
  $('who').textContent = r.staff.name;
  $('where').textContent = r.checkpost.name;
  $('signin').hidden = true;
  $('scanner').hidden = false;
  if (r.took_over_from) show({ verdict: 'info', message: 'Taken over from ' + r.took_over_from });
  counts(r.today);
  pruneSeen();
  paintQueue();
  camera();
  flush();
}

if (session) start(session);

/* --------------------------------------------------- offline verification */

/* The public key checks a signature and cannot create one, so a lost phone
   cannot mint tickets. This is why the scheme is Ed25519 and not a shared
   secret. */
const pubKey = () => Uint8Array.from(atob(session.public_key), c => c.charCodeAt(0));
const b64url = (s) => Uint8Array.from(
  atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

async function verifyLocal(raw) {
  const parts = raw.split('|');
  if (parts.length !== 9 || parts[0] !== session.version) return { ok: false, reason: 'malformed' };
  const body = new TextEncoder().encode(parts.slice(0, 8).join('|'));
  let good = false;
  try { good = await ed.verifyAsync(b64url(parts[8]), body, pubKey()); } catch { good = false; }
  if (!good) return { ok: false, reason: 'signature' };
  const d = parts[3];
  return { ok: true, t: {
    ticket_no: parts[1], place: parts[2],
    date: d.slice(0,4) + '-' + d.slice(4,6) + '-' + d.slice(6,8),
    slot: parts[4], category: parts[5], reg_no: parts[6] } };
}

const todayStr = () => {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate());
};

/* ------------------------------------------------------------- scanning */

let lastPayload = '', lastAt = 0;

async function onCode(raw) {
  const now = Date.now();
  // The camera reads the same code many times a second; one scan is one event.
  if (raw === lastPayload && now - lastAt < 4000) return;
  lastPayload = raw; lastAt = now;
  navigator.vibrate && navigator.vibrate(40);

  const local = await verifyLocal(raw);
  if (!local.ok) {
    show({ verdict: 'invalid_signature',
      message: local.reason === 'signature'
        ? 'This ticket has been ALTERED. Do not allow entry.'
        : 'Not a valid ticket QR.' });
    if (online()) send(raw); else enqueue(raw);
    return;
  }
  if (local.t.date !== todayStr()) {
    show({ verdict: 'wrong_day', ticket: { reg_no: local.t.reg_no },
      message: 'This ticket is for ' + local.t.date + ', not today.' });
    if (online()) send(raw); else enqueue(raw);
    return;
  }

  if (online()) return send(raw);

  /* OFFLINE: the signature says the ticket is genuine, and that much needs no
     network. What normally needs the server is "has this one come through
     already?" — but the common case is a shared copy presented at the SAME gate
     minutes apart, and this device saw the first one. So it is checked here.

     What this cannot catch is the same ticket used at a different gate, or
     before this phone went offline. Those surface on sync, and the staff member
     is told about them then. */
  if (seenLocally(local.t.ticket_no)) {
    enqueue(raw, local.t.ticket_no);
    return show({ verdict: 'already_used', ticket: { reg_no: local.t.reg_no },
      message: 'This ticket was already scanned at this gate.' });
  }

  markSeenLocally(local.t.ticket_no);
  enqueue(raw, local.t.ticket_no);
  show({ verdict: 'offline_ok', ticket: { reg_no: local.t.reg_no },
    message: 'Genuine ticket · ' + local.t.slot +
             '. Not yet checked against other gates — will sync when network returns.' });
}

/* One key per ticket, namespaced by date so yesterday's admissions do not
   reject today's genuine visitors. */
const seenKey = (no) => SEEN + todayStr() + ':' + no;
const seenLocally = (no) => { try { return !!localStorage.getItem(seenKey(no)); } catch { return false; } };
const markSeenLocally = (no) => { try { localStorage.setItem(seenKey(no), '1'); } catch {} };

/** Drop the previous days' admitted-ticket keys at sign-in. */
function pruneSeen() {
  const keep = SEEN + todayStr() + ':';
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(SEEN) && !k.startsWith(keep)) localStorage.removeItem(k);
    }
  } catch {}
}

async function send(raw) {
  try {
    const r = await post('/api/scan/verify', { payload: raw });
    if (r.error === 'session_ended') return endSession();
    if (r.verdict === 'valid') markSeenLocally((r.ticket || {}).ticket_no);
    show(r); counts(r.today);
  } catch {
    // The network said it was there and then wasn't. Queue it like any other
    // offline scan rather than losing it.
    enqueue(raw);
    show({ verdict: 'offline_ok', message: 'Saved. Will sync when network returns.' });
  }
}

function enqueue(raw) {
  const id = Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  try {
    localStorage.setItem(Q + id, JSON.stringify({
      client_id: id, payload: raw, scanned_at: new Date().toISOString() }));
  } catch (e) {
    // Storage full is the one failure that silently loses a scan, so it is put
    // in front of the staff member rather than swallowed.
    alert('This phone is out of storage and cannot save more scans. Get to network as soon as possible.');
  }
  paintQueue();
}

function paintQueue() {
  const n = queueCount();
  $('queue').textContent = n ? n + ' scan(s) waiting to sync' : '';
}

/**
 * Push what is queued, in batches, without interrupting scanning.
 *
 * Batched because 1500 scans in one request is a body big enough to time out on
 * a hill connection, and a timeout would retry all 1500. A hundred at a time
 * means a dropped batch costs a hundred, and the rest keep going.
 *
 * Deleted key by key only after the server has confirmed each one, so a
 * connection that dies mid-sync loses nothing.
 */
let flushing = false;
async function flush() {
  if (flushing || !online() || !session) return;
  const ids = queueIds();
  if (!ids.length) return;

  flushing = true;
  try {
    while (queueIds().length && online()) {
      const batch = queueIds().slice(0, 100).map(id => {
        try { return JSON.parse(localStorage.getItem(Q + id)); } catch { return null; }
      }).filter(Boolean);
      if (!batch.length) break;

      const r = await post('/api/scan/sync', { scans: batch });
      if (r.error === 'session_ended') { endSession(); return; }
      if (!r.ok) break;

      for (const b of batch) { try { localStorage.removeItem(Q + b.client_id); } catch {} }
      paintQueue(); counts(r.today);

      // Duplicates found on sync are the whole point of syncing. Show them —
      // a pattern at one gate is something the person standing there should
      // know about, not something buried in a report read next week.
      const dup = (r.results || []).filter(x => x.verdict === 'already_used');
      if (dup.length) {
        show({ verdict: 'already_used',
          message: dup.length + ' ticket(s) scanned offline turned out to be duplicates: ' +
                   dup.map(d => (d.ticket ? d.ticket.reg_no : '?')).join(', ') });
      }
    }
  } catch {
    // Signal went again mid-sync. Everything unconfirmed is still in storage.
  } finally {
    flushing = false;
  }
}
setInterval(flush, 20000);

/* --------------------------------------------------------------- display */

function show(r) {
  const cls = r.verdict === 'valid' ? 'ok'
    : (r.verdict === 'offline_ok' || r.verdict === 'info') ? 'warn'
    : (r.verdict === 'wrong_day' || r.verdict === 'wrong_slot' || r.verdict === 'wrong_place') ? 'warn'
    : 'bad';
  const head = ({
    valid: 'ALLOW',
    offline_ok: 'ALLOW (pending)',
    already_used: 'ALREADY USED',
    wrong_day: 'WRONG DAY',
    wrong_slot: 'WRONG TIME',
    wrong_place: 'WRONG GATE',
    invalid_signature: 'FAKE TICKET',
    unknown_ticket: 'NOT FOUND',
    cancelled: 'CANCELLED',
    info: 'NOTE',
  })[r.verdict] || 'CHECK';

  $('result').innerHTML =
    '<div class="verdict ' + cls + '"><h2>' + head + '</h2>' +
    (r.ticket && r.ticket.reg_no ? '<div class="plate">' + r.ticket.reg_no + '</div>' : '') +
    '<p>' + (r.message || '') + '</p></div>';
}

function counts(t) {
  if (!t) return;
  $('counts').innerHTML =
    '<div class="chip"><b>' + (t.valid || 0) + '</b>allowed</div>' +
    '<div class="chip"><b>' + (t.already_used || 0) + '</b>duplicate</div>' +
    '<div class="chip"><b>' + (t.invalid_signature || 0) + '</b>fake</div>' +
    '<div class="chip"><b>' + (t.total || 0) + '</b>scanned</div>';
}

/* ---------------------------------------------------------------- camera */

async function camera() {
  const video = $('video');
  let stream;
  try {
    // A gate phone has a rear camera and must use it. A laptop has only a
    // front one, and asking it for 'environment' as a hard requirement fails
    // outright on some browsers — so the rear camera is a preference, and any
    // camera is accepted rather than showing a permission error on a machine
    // that has a perfectly good webcam.
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } }, audio: false });
  } catch {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    } catch {
      $('result').innerHTML =
        '<div class="err">Camera permission is needed to scan tickets. ' +
        'Allow camera access for this site and reload.</div>';
      return;
    }
  }
  video.srcObject = stream;
  await video.play();

  // Chrome on Android decodes QR natively and far faster than any JS loop.
  if ('BarcodeDetector' in window) {
    const det = new BarcodeDetector({ formats: ['qr_code'] });
    const tick = async () => {
      try {
        const codes = await det.detect(video);
        if (codes.length) onCode(codes[0].rawValue);
      } catch {}
      requestAnimationFrame(tick);
    };
    return requestAnimationFrame(tick);
  }

  const { default: jsQR } = await import('/scan/vendor/jsqr.js');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const tick = () => {
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(img.data, img.width, img.height);
      if (code) onCode(code.data);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* ------------------------------------------------------------- sign out */

$('out').onclick = async () => {
  const waiting = queueCount();
  // Ending a shift with unsynced scans is not fatal — they survive in storage and
  // go up on the next sign-in — but the person handing over should know.
  if (waiting && !confirm(waiting + ' scan(s) have not synced yet. They will sync at the next sign-in. End shift anyway?')) return;
  try { await post('/api/scan/signout', {}); } catch {}
  endSession();
};

function endSession() {
  LS.del('session'); session = null;
  location.reload();
}

async function post(path, body, raw) {
  const res = await fetch(path, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' },
      session ? { Authorization: 'Bearer ' + session.token } : {}),
    body: JSON.stringify(body),
  });
  return res.json();
}
</script></body></html>`;

module.exports = router;
