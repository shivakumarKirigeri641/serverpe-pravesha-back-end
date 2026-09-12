/**
 * staffApi.js — the JSON API behind the checkpost staff app.
 *
 * The gate app is a separate front-end (serverpe-pravesha-checkpost-front-end),
 * so this is plain JSON with a bearer token: the token is the staff session
 * opened at sign-in, and every route except sign-in resolves it first. A token
 * that has been signed out, taken over by the next shift, or left idle past the
 * timeout answers 401, which the app treats as "sign in again".
 *
 * Errors are shaped the way the screens show them — { error, message } — because
 * a person at a gate in the rain reads the sentence, not the code.
 */

const express = require('express');
const staff = require('../gatepass/staff');
const checkin = require('../gatepass/checkin');
const slotTime = require('../gatepass/slotTime');

const router = express.Router();
const json = express.json({ limit: '32kb' });

const P = '/staff/api';

/** Anything thrown inside a handler becomes a 500 with a sentence, never a hang. */
const safe = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) {
    console.error('[staffApi] %s %s: %s', req.method, req.path, e.stack || e.message);
    res.status(500).json({ error: 'server_error', message: 'Something went wrong. Please try again.' });
  }
};

/** Resolve the shift, or refuse. */
async function auth(req, res, next) {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '') || req.get('x-staff-token');
  const session = await staff.sessionFor(token);
  if (!session) {
    return res.status(401).json({ error: 'signed_out', message: 'Your shift has ended. Please sign in again.' });
  }
  req.session = session;
  req.checkpost = {
    id: session.checkpost_id, place_id: session.place_id,
    name: session.checkpost_name, name_kn: session.checkpost_name_kn,
  };
  next();
}

const me = (s) => ({
  staff: { id: String(s.staff_id), name: s.staff_name, mobile: `••••${String(s.staff_mobile).slice(-4)}` },
  checkpost: { id: String(s.checkpost_id), name: s.checkpost_name, nameKn: s.checkpost_name_kn },
  place: { id: String(s.place_id), name: s.place_name, nameKn: s.place_name_kn, district: s.district },
  shiftStartedAt: s.started_at,
  /* The gate's clock is the server's clock: a phone with the wrong time must not
     change which slot a visitor appears to be in. */
  serverDate: slotTime.nowIST().date,
  serverTime: slotTime.hhmm(slotTime.nowIST().minutes),
});

router.post(`${P}/session`, json, safe(async (req, res) => {
  const { mobile, pin, checkpostId } = req.body || {};
  const out = await staff.signIn({ mobile, pin, checkpostId });
  if (!out.ok) {
    /* Being asked which gate is not a failure: the app shows a picker and asks
       again with the choice. A locked account gets its own status so the app can
       show the wait rather than "wrong PIN" one more time. */
    const status = out.error === 'choose_checkpost' ? 200 : out.error === 'locked' ? 423 : 401;
    return res.status(status).json(out);
  }
  const session = await staff.sessionFor(out.token);
  res.json({ ok: true, token: out.token, ...me(session) });
}));

router.get(`${P}/session`, auth, safe(async (req, res) => res.json({ ok: true, ...me(req.session) })));

router.delete(`${P}/session`, auth, safe(async (req, res) => {
  await staff.signOut((req.get('authorization') || '').replace(/^Bearer\s+/i, '') || req.get('x-staff-token'));
  res.json({ ok: true });
}));

/* Today's expected vehicles, and how many have come through. */
router.get(`${P}/arrivals`, auth, safe(async (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? String(req.query.date) : null;
  res.json({ ok: true, ...(await checkin.arrivals(req.checkpost, date)) });
}));

/* Plate or pass number, typed at the gate. */
router.get(`${P}/search`, auth, safe(async (req, res) => {
  const out = await checkin.search(req.checkpost, req.query.q);
  res.status(out.ok ? 200 : 400).json(out);
}));

/* One pass, with its verdict here and now — shown before anything is recorded. */
router.get(`${P}/pass/:ticketNo`, auth, safe(async (req, res) => {
  const out = await checkin.inspect(req.checkpost, req.params.ticketNo);
  res.status(out.found ? 200 : 404).json({ ok: out.found, ...out });
}));

/* Record the entry. `override: true` is the staff member accepting a warning. */
router.post(`${P}/entry`, json, auth, safe(async (req, res) => {
  const { ticketNo, override, typed, elapsedMs } = req.body || {};
  if (!ticketNo) return res.status(400).json({ error: 'missing_pass', message: 'Choose a pass first.' });
  const out = await checkin.record({
    session: req.session, checkpost: req.checkpost,
    ticketNo, override: override === true, rawPayload: typed || null,
    /* How long the staff member spent on this pass, measured by their phone —
       the only place that knows when the pass was opened. */
    durationMs: elapsedMs,
  });
  res.json(out);
}));

/* Further back than the shift: this gate's own log, searchable and paged. */
router.get(`${P}/history`, auth, safe(async (req, res) => {
  res.json({ ok: true, ...(await checkin.history(req.checkpost, {
    q: req.query.q, verdict: req.query.verdict, before: req.query.before, limit: req.query.limit,
  })) });
}));

/* One number plate: every check and every pass this gate has seen of it. */
router.get(`${P}/vehicle/:regNo`, auth, safe(async (req, res) => {
  const out = await checkin.vehicle(req.checkpost, req.params.regNo);
  res.status(out.ok ? 200 : 400).json(out);
}));

/* The shift's log, for the handover and for "did that go through?". */
router.get(`${P}/recent`, auth, safe(async (req, res) => {
  res.json({ ok: true, entries: await checkin.recent(req.checkpost) });
}));

module.exports = router;
