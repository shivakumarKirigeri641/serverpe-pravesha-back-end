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

/*
 * Selling a pass at the barrier.
 *
 * The same sale the panel makes and the same one WhatsApp makes: the vehicle
 * decides the type, the type decides the price, the place comes out of the
 * slot's capacity, and a tax invoice is issued. What is different at a gate is
 * who is standing there — sometimes a vehicle the register has never heard of.
 *
 * A LOOK-UP THAT FAILS IS NOT A REFUSAL. A temporary registration on a car
 * bought last week, a dealer plate, a gateway having a bad morning: the answer
 * is "we do not know what this is", and the staff member — who can see the
 * vehicle — says what it is instead. The pass then records that the type was
 * declared and by whom, so it is never confused with one the register verified.
 */
router.get(`${P}/onspot`, auth, safe(async (req, res) => {
  const tickets = require('../gatepass/adminTickets');
  const out = await tickets.availability({ placeId: req.checkpost.place_id });
  const now = slotTime.nowIST();
  res.set('Cache-Control', 'no-store').json({
    ok: true,
    place: out.place,
    date: out.date,
    prices: out.prices,
    /* Only slots a vehicle could actually enter now can be sold at a gate. */
    slots: out.slots.filter((x) => x.isOpen && !x.timeClosed),
    types: out.prices.map((x) => ({ code: x.code, label: x.label, total: x.total })),
    /* What counts as identification when the register cannot vouch for a
       vehicle, in the order a staff member should reach for it. */
    identityKinds: Object.entries(require('../gatepass/adminTickets').IDENTITY)
      .map(([key, v]) => ({ key, label: v.label, hint: v.hint, min: v.min })),
    serverTime: slotTime.hhmm(now.minutes),
  });
}));

/* What is this vehicle? Answers "we do not know" rather than failing. */
router.post(`${P}/onspot/lookup`, json, auth, safe(async (req, res) => {
  const tickets = require('../gatepass/adminTickets');
  try {
    const { vehicle, category } = await tickets.vehicleFor(req.body?.regNo);
    const price = (await require('../gatepass/pricing').tariff(req.checkpost.place_id))
      .find((t) => String(t.categoryId) === String(category.id));
    res.json({
      ok: true,
      found: true,
      regNo: vehicle.reg_no,
      type: { code: category.code, label: category.label },
      vehicle: [vehicle.maker, vehicle.model].filter(Boolean).join(' ') || null,
      colour: vehicle.colour || null,
      price: price ? Math.round(price.totalPaise / 100) : null,
    });
  } catch (e) {
    if (e instanceof tickets.Refusal) {
      /* not_permitted is a real no; everything else means "you tell us". */
      const blocking = e.code === 'not_permitted';
      return res.status(blocking ? 409 : 200).json({
        ok: !blocking, found: false, code: e.code, message: e.message, declareType: !blocking,
      });
    }
    /* The gateway is down or unreachable — the counter stays open. */
    console.error('[staffApi] lookup %s: %s', req.body?.regNo, e.message);
    res.json({
      ok: true, found: false, code: 'lookup_failed', declareType: true,
      message: 'The vehicle register cannot be reached just now. Choose the vehicle type to carry on.',
    });
  }
}));

/*
 * A photograph, taken and sent while the sale is still open.
 *
 * The UPI screen the visitor is holding up, or the vehicle itself when it has no
 * number plate. It is uploaded the moment it is taken rather than with the sale,
 * for two reasons: a picture that fails to send must not take a completed sale
 * down with it, and a staff member should see "sent" before the visitor puts
 * their phone away. The sale then quotes the ids it was given.
 */
router.post(`${P}/photo`, auth, safe(async (req, res) => {
  const photos = require('../gatepass/photos');
  try {
    const out = await photos.keep({
      dataUrl: req.body?.image,
      kind: req.body?.kind,
      note: req.body?.note,
      width: req.body?.width,
      height: req.body?.height,
      staffId: req.session.staff_id,
      checkpostId: req.checkpost.id,
    });
    require('../log').event('gate', 'photo', `${out.kind} · ${Math.round(out.size / 1024)}KB · ${req.session.staff_name || 'staff'}`);
    res.json({ ok: true, photo: out });
  } catch (e) {
    if (e instanceof photos.PhotoRefusal) return res.status(e.status).json({ error: e.code, message: e.message });
    throw e;
  }
}));

/* Look at one again — the thumbnail in the sheet, or a photograph on a pass. */
router.get(`${P}/photo/:id`, auth, safe(async (req, res) => {
  const photos = require('../gatepass/photos');
  const row = await photos.bytesOf(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found', message: 'No such photograph.' });
  res.set('Content-Type', row.mime)
    .set('Cache-Control', 'private, max-age=3600')
    .send(row.bytes);
}));

/* Take the money, issue the pass, and record the entry if the vehicle is here. */
router.post(`${P}/onspot`, json, auth, safe(async (req, res) => {
  const tickets = require('../gatepass/adminTickets');
  try {
    const out = await tickets.onspotTicket({
      body: { ...(req.body || {}), placeId: req.checkpost.place_id },
      staff: req.session,
      checkpost: req.checkpost,
    });
    res.json({ ok: true, ticket: out.ticket });
  } catch (e) {
    if (e instanceof tickets.Refusal) {
      return res.status(e.status).json({ error: e.code, message: e.message });
    }
    throw e;
  }
}));

/* Further back than the shift: this gate's own log, searchable and paged. */
router.get(`${P}/history`, auth, safe(async (req, res) => {
  res.json({ ok: true, ...(await checkin.history(req.checkpost, {
    q: req.query.q, verdict: req.query.verdict, before: req.query.before, limit: req.query.limit,
  })) });
}));

/*
 * Every pass for a day — expected and entered — with who booked it.
 *
 * The gate screen is today's work; this is the record behind it, for the
 * questions a visitor asks while standing at the barrier. A plate typed here
 * searches every date rather than the chosen one.
 */
router.get(`${P}/passes`, auth, safe(async (req, res) => {
  res.set('Cache-Control', 'no-store').json({ ok: true, ...(await checkin.passes(req.checkpost, {
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? req.query.date : null,
    status: req.query.status ? String(req.query.status) : null,
    q: req.query.q ? String(req.query.q) : '',
    limit: req.query.limit,
    offset: req.query.offset,
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
