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

/*
 * "Get OTP" — a code to the staff member's own phone.
 *
 * The number is checked against the staff list before a single SMS is sent: an
 * unknown number must not be able to make this service text arbitrary people,
 * and it is told plainly that it is not permitted, in English and in Kannada.
 *
 * The answer is the same whether the number belongs to nobody or to a staff
 * member who has been switched off. Which of the two it is would be a useful
 * thing to learn by typing numbers into a public login screen, and it is nobody's
 * business from outside the panel.
 */
router.post(`${P}/session/otp`, json, safe(async (req, res) => {
  const otp = require('../gatepass/staffOtp');
  const out = await otp.request({
    mobile: req.body?.mobile,
    ip: (req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim(),
  });
  /* 'not_staff' is a refusal, not a server problem; the app shows the sentence. */
  const status = out.ok ? 200
    : out.error === 'too_soon' || out.error === 'too_many' ? 429
      : out.error === 'not_configured' ? 503 : 403;
  res.status(status).json(out);
}));

/* The code, typed back. On success this opens the shift. */
router.post(`${P}/session/verify`, json, safe(async (req, res) => {
  const otp = require('../gatepass/staffOtp');
  const out = await otp.verify({
    mobile: req.body?.mobile,
    code: req.body?.code,
    checkpostId: req.body?.checkpostId,
  });
  if (!out.ok) {
    const status = out.error === 'choose_checkpost' ? 200 : 401;
    return res.status(status).json(out);
  }
  const session = await staff.sessionFor(out.token);
  res.json({ ok: true, token: out.token, ...me(session) });
}));

router.get(`${P}/session`, auth, safe(async (req, res) => res.json({ ok: true, ...me(req.session) })));

/*
 * End shift. The handover — what this shift checked, refused and collected — is
 * worked out as the shift closes and kept with it, so the office sees exactly
 * the figures the staff member was shown when they counted the cash.
 */
router.delete(`${P}/session`, auth, safe(async (req, res) => {
  await staff.signOut((req.get('authorization') || '').replace(/^Bearer\s+/i, '') || req.get('x-staff-token'));
  let summary = null;
  try {
    summary = await require('../gatepass/shiftSummary').save(req.session.session_id);
  } catch (e) {
    /* The shift has ended either way; a summary that failed is worked out later. */
    console.error('[staffApi] handover for session %s: %s', req.session.session_id, e.message);
  }
  res.json({ ok: true, summary });
}));

/* The shift so far — shown on the End shift sheet before anybody confirms. */
router.get(`${P}/shift/summary`, auth, safe(async (req, res) => {
  const summary = await require('../gatepass/shiftSummary').forSession(req.session.session_id);
  res.set('Cache-Control', 'no-store').json({ ok: true, summary });
}));

/*
 * Has anything happened? The same cheap question live monitoring asks: a pass
 * booked or paid by any route, a vehicle checked at any gate, a shift started or
 * ended. The gate screen asks it every few seconds and reloads only when the
 * answer changes, so a visitor who books at the barrier appears on the list
 * straight away instead of up to half a minute later.
 */
router.get(`${P}/pulse`, auth, safe(async (req, res) => {
  const { pulse } = await require('../gatepass/adminLive').pulse();
  res.set('Cache-Control', 'no-store').json({ ok: true, pulse });
}));

/* Today's expected vehicles, and how many have come through. */
router.get(`${P}/arrivals`, auth, safe(async (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? String(req.query.date) : null;
  const out = await checkin.arrivals(req.checkpost, date);
  /* The watchlist travels with the list, so a phone that loses signal still
     knows which plates to stop. */
  out.passes = await withWatch(out.passes);
  /* Never from a cache: a list a few seconds old shows a vehicle that just went
     through as still to come. The pulse beside it already says no-store. */
  res.set('Cache-Control', 'no-store').json({ ok: true, ...out });
}));

/* Plate or pass number, typed at the gate. */
router.get(`${P}/search`, auth, safe(async (req, res) => {
  const out = await checkin.search(req.checkpost, req.query.q);
  if (out.passes) out.passes = await withWatch(out.passes);
  res.status(out.ok ? 200 : 400).json(out);
}));

/* One pass, with its verdict here and now — shown before anything is recorded. */
router.get(`${P}/pass/:ticketNo`, auth, safe(async (req, res) => {
  const out = await checkin.inspect(req.checkpost, req.params.ticketNo);
  if (out.found && out.pass) {
    const watchlist = require('../gatepass/watchlist');
    const w = await watchlist.levelFor(out.pass.regNo);
    if (w) {
      out.pass.watch = w;
      out.watch = w;
      /* Blocked outranks every other verdict: the pass does not matter. */
      if (w.level === 'block') Object.assign(out, { verdict: 'watch_blocked', blocking: true, message: watchlist.gateMessage(w) });
    }
  }
  res.status(out.found ? 200 : 404).json({ ok: out.found, ...out });
}));

/* Each pass, with its plate's watchlist entry if it has one. */
async function withWatch(passes) {
  if (!Array.isArray(passes) || !passes.length) return passes;
  /* Only passes with a plate: a per-person pass (056) has none to look up. */
  const map = await require('../gatepass/watchlist').forPlates(passes.map((p) => p.regNo).filter(Boolean));
  return passes.map((p) => (map.has(p.regNo) ? { ...p, watch: map.get(p.regNo) } : p));
}

/* Record the entry. `override: true` is the staff member accepting a warning. */
router.post(`${P}/entry`, json, auth, safe(async (req, res) => {
  const { ticketNo, override, typed, elapsedMs, persons } = req.body || {};
  if (!ticketNo) return res.status(400).json({ error: 'missing_pass', message: 'Choose a pass first.' });
  const out = await checkin.record({
    session: req.session, checkpost: req.checkpost,
    ticketNo, override: override === true, rawPayload: typed || null,
    /* How long the staff member spent on this pass, measured by their phone —
       the only place that knows when the pass was opened. */
    durationMs: elapsedMs,
    /* On a per-person pass (056), how many came through; absent means everyone booked. */
    persons: persons ?? null,
  });
  res.json(out);
}));

/*
 * An entry recorded on a phone with no signal, sent when the signal came back.
 *
 * The vehicle is already through the barrier, so this does not ask whether it
 * may go in — it records that it did, at the time the phone says, and reports
 * back anything the phone could not have known: the same pass used at another
 * gate while this one was offline, a pass cancelled in the meantime. Sending the
 * same entry twice records it once.
 */
router.post(`${P}/entry/offline`, json, auth, safe(async (req, res) => {
  const { ticketNo, clientId, recordedAt, override, typed, elapsedMs } = req.body || {};
  if (!ticketNo) return res.status(400).json({ error: 'missing_pass', message: 'Choose a pass first.' });
  const out = await checkin.recordOffline({
    session: req.session, checkpost: req.checkpost,
    ticketNo, clientId, at: recordedAt, override: override === true,
    rawPayload: typed || null, durationMs: elapsedMs,
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

    /*
     * DOES IT ALREADY HAVE ONE? ASKED HERE, NOT AT THE END.
     *
     * One pass per vehicle per day is enforced by the database, so a second sale
     * was always refused — but only at the last step, after the staff member had
     * chosen a slot, typed a mobile number and taken the money out of somebody's
     * hand. Refusing then is correct and useless: the work is done and the
     * visitor is already reaching for their wallet.
     *
     * The question is answerable the moment the number is typed, so it is asked
     * the moment the number is typed. And the answer is not only "no": it is
     * that pass — its number, its slot, and whether the vehicle has already come
     * through — because the visitor standing there usually has one and does not
     * know it, and the staff member's next move is to check them in, not to sell
     * them anything.
     */
    const booking = require('../gatepass/booking');
    const slotTime = require('../gatepass/slotTime');
    const today = slotTime.nowIST().date;
    const held = await booking.existingForDate(vehicle.id, today);

    res.json({
      ok: true,
      found: true,
      regNo: vehicle.reg_no,
      type: { code: category.code, label: category.label },
      vehicle: [vehicle.maker, vehicle.model].filter(Boolean).join(' ') || null,
      colour: vehicle.colour || null,
      price: price ? Math.round(price.totalPaise / 100) : null,
      /* On the watchlist: said before anything is sold. */
      watch: await require('../gatepass/watchlist').levelFor(vehicle.reg_no),
      alreadyBooked: held ? {
        ticketNo: held.ticket_no,
        slot: held.slot_label,
        status: held.status,
        usedAt: held.used_at,
        /* 'held' means somebody is paying for it right now on a phone — a
           different thing from a pass that exists, and worth saying so. */
        beingPaidFor: held.status === 'held',
        message: held.status === 'used'
          ? `This vehicle already came through today at ${new Date(held.used_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}. One pass is one entry.`
          : held.status === 'held'
            ? 'Somebody is paying for a pass for this vehicle right now. Wait a moment and check again.'
            : `This vehicle already has a pass for today — ${held.ticket_no}, ${held.slot_label}. Check them in instead of selling another.`,
      } : null,
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
  /* A plate the office blocked is not sold a pass at the barrier, whatever the
     screen allowed — the phone may be showing a list from before it was added. */
  if (req.body?.regNo) {
    const watchlist = require('../gatepass/watchlist');
    const w = await watchlist.levelFor(req.body.regNo);
    if (w && w.level === 'block') {
      return res.status(409).json({ error: 'watch_blocked', message: watchlist.gateMessage(w) });
    }
  }
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
