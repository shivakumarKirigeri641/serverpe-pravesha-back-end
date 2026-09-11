/**
 * bookWeb.js — the booking form the chat links to.
 *
 * WHY A WEB FORM AND NOT A WHATSAPP FLOW. A Flow is native and looks the part,
 * but its screens are declared up front and published through Meta, and this
 * booking needs to react mid-way: a registration lookup that takes a second, a
 * vehicle that turns out to be barred, capacity that depends on what the
 * vehicle turned out to be. Doing that in a page we control removes a review
 * cycle from every change to the form.
 *
 * THE SLOT SITS UNDER THE DATE, AND ITS COUNTS FOLLOW THE VEHICLE. Capacity is
 * held per category -- the number left for a car is not the number left for a
 * Tempo Traveller on the same road at the same hour -- so before a vehicle is
 * checked each slot shows every type's count, and afterwards only that
 * vehicle's. A slot picked first is kept if it is still open for the vehicle,
 * and cleared with a reason if it is not. The server re-checks all of it at
 * Continue to payment regardless.
 */

const express = require('express');
const token = require('../gatepass/webToken');
const places = require('../gatepass/places');
const pricing = require('../gatepass/pricing');
const inventory = require('../gatepass/inventory');
const vehicles = require('../gatepass/vehicle');
const eligibility = require('../gatepass/eligibility');
const { one } = require('../gatepass/db');
const page = require('../web/bookingPage');

const router = express.Router();

/* The page script, addressed by a hash of its contents.

   It was served at a fixed /book/app.js with a five-minute cache, and that
   broke a live booking: the page changed the ids of the vehicle card, the
   browser kept the previous script, and the old script failed against the new
   page -- reported to the visitor as "Something went wrong" on a lookup the
   server had answered correctly four times. A hash in the URL means a new page
   can only ever load the script written for it, and an unchanged script can be
   cached as long as the browser likes. */
const fs = require('fs');
const pathMod = require('path');
const CLIENT_FILE = pathMod.join(__dirname, '..', 'web', 'bookingClient.js');
let clientCache = null;
function client() {
  const stat = fs.statSync(CLIENT_FILE);
  if (!clientCache || clientCache.mtime !== stat.mtimeMs) {
    const body = fs.readFileSync(CLIENT_FILE);
    const hash = require('crypto').createHash('sha256').update(body).digest('hex').slice(0, 12);
    clientCache = { body, hash, mtime: stat.mtimeMs };
  }
  return clientCache;
}

router.get('/book/app.js', (req, res) => {
  const c = client();
  const current = req.query.v === c.hash;
  res.type('application/javascript')
     .set('Cache-Control', current ? 'public, max-age=31536000, immutable' : 'no-cache')
     .send(c.body);
});

/* Where the page reports a failure of its own. Without this, a script error on
   a visitor's phone is invisible to us; with it, the next one is in the log
   with the step it happened on, instead of being a screenshot from the demo. */
router.post('/book/client-error', express.json({ limit: '8kb' }), (req, res) => {
  const b = req.body || {};
  console.error('[book:client]', String(b.step || '?'), String(b.message || '').slice(0, 300),
    String(b.stack || '').split('\n').slice(0, 3).join(' | ').slice(0, 500));
  res.sendStatus(204);
});

/**
 * Express 4 does not catch a rejected promise from an async handler: the request
 * hangs until the proxy gives up, and on Node 22 the unhandled rejection takes
 * the whole process down with it. Every async route here goes through this, so a
 * failure is a JSON answer the page knows how to show, and one visitor's bad
 * lookup cannot end everyone else's booking.
 */
const safe = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((e) => {
  console.error('[book]', req.method, req.path.replace(/\/book\/[^/]+/, '/book/:token'), e.message);
  if (res.headersSent) return;
  if (req.method === 'GET') return res.status(500).type('html').send(page.expired('unknown'));
  return res.status(500).json({ ok: false, error: 'server_error',
    message: 'We could not complete that just now. Please try again.' });
});

/** Every route below needs a live token; refusing early keeps that in one place. */
const gate = safe(async (req, res, next) => {
  const check = await token.verify(req.params.token);
  if (!check.ok) {
    req.tokenError = check.reason;
    return next();
  }
  req.customer = await one('SELECT * FROM customers WHERE id = $1', [check.customerId]);
  req.tokenValue = req.params.token;
  return next();
});

router.get('/book/:token', gate, safe(async (req, res) => {
  if (req.tokenError) return res.status(410).type('html').send(page.expired(req.tokenError));

  const list = await places.list();
  const live = list.filter((p) => p.is_active);
  const first = live[0] || list[0];
  const dates = await places.bookableDates(first, first ? first.slots : []);
  const releaseInfo = first ? await places.window(first) : null;
  const tariffRows = live[0] ? await pricing.tariff(live[0].id) : [];

  res.type('html').send(page.render({
    scriptVersion: client().hash,
    token: req.params.token,
    customer: req.customer,
    places: list,
    dates,
    tariff: tariffRows,
    feePercent: await pricing.platformPercent(),
    releaseInfo,
  }));
}));

/**
 * Identify the vehicle and price it.
 *
 * This is the step that can end the booking: a barred vehicle is refused here,
 * before a slot is chosen and long before money is involved. Refusing at the
 * checkpost instead would mean a refund and an argument at a barrier.
 */
router.post('/book/:token/vehicle', express.json(), gate, safe(async (req, res) => {
  if (req.tokenError) return res.status(410).json({ error: req.tokenError });

  /* The same parser the ULIP lookup uses: spaces, dots and hyphens removed,
     letter O typed for zero repaired, and a state code that does not exist
     refused here — before a lookup is spent on it. */
  const parsed = require('../ulip/plate').parse(req.body.regNo);
  if (!parsed.ok) {
    return res.json({ ok: false, error: 'invalid_format', title: 'Check the vehicle number',
      message: String(parsed.error || 'Please enter a valid registration number, for example KA01AB1234.').replace(/\*/g, '') });
  }
  const regNo = parsed.regNo;

  const placeId = req.body.placeId;
  const place = await places.byId(placeId);
  if (!place || !place.is_active) {
    return res.json({ ok: false, error: 'place_unavailable',
      message: 'Bookings for this destination are not open yet.' });
  }

  const resolved = await vehicles.resolve(regNo, { customerId: req.customer.id });

  /* For the demo every vehicle is assumed to have a proper registration. An
     unidentified plate is therefore treated as a number entered wrongly and
     sent back to be corrected, rather than opening the self-declared category
     path -- that path exists and is tested (see 017 and eligibility.decide),
     it is simply not surfaced yet. */
  if (!resolved.ok || !resolved.vehicle || !vehicles.isClassified(resolved.vehicle)) {
    return res.json({ ok: false, error: 'not_found',
      message: 'We could not find that registration number. Please check it and try again.' });
  }

  const verdict = await eligibility.decide(resolved.vehicle);
  await eligibility.remember(resolved.vehicle.id, verdict);

  if (!verdict.allowed) {
    return res.json({ ok: false, error: 'not_permitted', denyCode: verdict.denyCode,
      message: verdict.reason, messageKn: verdict.reasonKn,
      vehicle: vehicles.describe(resolved.vehicle) });
  }

  if (verdict.unclassified) {
    return res.json({ ok: false, error: 'unclassified',
      message: 'We could not determine the vehicle type for that number. Please check it and try again.' });
  }

  /* ONE PASS PER VEHICLE PER DAY, told at the vehicle step. Waiting until
     "Continue to payment" meant choosing a slot and reading the whole review
     before hearing the vehicle could not be booked at all. The date is the one
     chosen above; the form asks again if it changes. A place this same link is
     holding is the visitor's own booking in progress and is not a conflict. */
  const travelDate = String(req.body.travelDate || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(travelDate)) {
    const booking = require('../gatepass/booking');
    const existing = await booking.existingForDate(resolved.vehicle.id, travelDate);
    if (existing) {
      const mine = existing.status === 'held' && await one(
        `SELECT 1 FROM web_tokens WHERE token_hash = $1 AND ticket_id = $2`,
        [require('crypto').createHash('sha256').update(req.params.token).digest('hex'), existing.id]);
      if (!mine) {
        const when = new Date(`${travelDate}T00:00:00Z`)
          .toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
        return res.json(existing.status === 'held'
          ? { ok: false, error: 'booking_in_progress', title: 'Booking already in progress',
            message: `A booking for ${regNo} on ${when} is already in progress. Complete it, or try again in a few minutes.` }
          : { ok: false, error: 'already_booked', title: 'Only one pass per vehicle per day',
            message: `${regNo} already has an entry pass for ${when} (${existing.slot_label}). Please choose another date.` });
      }
    }
  }

  const price = await pricing.forPlaceCategory(place.id, verdict.categoryId);
  if (!price) {
    return res.json({ ok: false, error: 'no_price',
      message: 'No fare is configured for this vehicle at this destination.' });
  }

  const details = vehicles.details(resolved.vehicle);

  res.json({
    ok: true,
    regNo,
    vehicle: {
      description: vehicles.describe(resolved.vehicle),
      make: details.make, model: details.model, variant: details.variant, type: details.type,
      fuel: details.fuel, colour: details.colour,
    },
    category: { id: verdict.categoryId, code: verdict.categoryCode, label: verdict.categoryLabel },
    price: {
      entry: pricing.rupees(price.entryPaise),
      platform: pricing.rupees(price.platformPaise),
      total: pricing.rupees(price.totalPaise),
      totalPaise: price.totalPaise,
    },
  });
}));

/** Remaining capacity in each slot, for the category just determined. */
router.post('/book/:token/slots', express.json(), gate, safe(async (req, res) => {
  if (req.tokenError) return res.status(410).json({ error: req.tokenError });

  const { placeId, categoryId, travelDate } = req.body;
  if (!placeId || !/^\d{4}-\d{2}-\d{2}$/.test(String(travelDate || ''))) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  /* Vehicle known: one type's numbers, the only ones that apply. */
  if (categoryId) {
    const slots = await inventory.forDate(placeId, categoryId, travelDate);
    return res.json({ ok: true, slots });
  }

  /* Vehicle not checked yet: every type's numbers, under each slot, so the
     visitor can see "Car 3 left" before typing a plate. A slot is only offered
     as closed when it is closed for time or shut outright; being full for one
     type does not close it for the others. */
  const { query: q } = require('../gatepass/db');
  const cats = (await q(
    `SELECT id, code, label FROM vehicle_categories WHERE is_active ORDER BY sort_order`)).rows;

  const byCat = await Promise.all(cats.map((c) => inventory.forDate(placeId, c.id, travelDate)));
  const slots = byCat[0] ? byCat[0].map((s, i) => {
    const types = cats.map((c, k) => ({
      code: c.code, label: c.label,
      remaining: byCat[k][i].remaining, capacity: byCat[k][i].capacity,
    }));
    return {
      slotId: s.slotId, code: s.code, label: s.label, lastEntry: s.lastEntry,
      timeClosed: s.timeClosed, timeReason: s.timeReason, isOpen: s.isOpen, closedNote: s.closedNote,
      types,
      bookable: s.isOpen && !s.timeClosed && types.some((x) => x.remaining > 0),
    };
  }) : [];
  return res.json({ ok: true, slots });
}));

/**
 * Continue to payment: hold the place and hand over to Razorpay.
 *
 * EVERYTHING THE FORM ALREADY CHECKED IS CHECKED AGAIN HERE. The form is a
 * convenience running on the visitor's phone; nothing it decided can be taken on
 * trust. A slot can close between showing it and tapping Continue, a place can
 * sell out, and a request can be crafted by hand. So the destination, the date,
 * the slot's last entry, the vehicle's eligibility and the one-pass rule are all
 * re-established from the database before a single place is held.
 */
router.post('/book/:token/confirm', express.json(), gate, safe(async (req, res) => {
  if (req.tokenError) return res.status(410).json({ ok: false, error: req.tokenError,
    message: 'This booking link has expired. Send hi on WhatsApp to start again.' });

  const booking = require('../gatepass/booking');
  const checkout = require('../gatepass/checkout');
  const slotTime = require('../gatepass/slotTime');
  const { query: q } = require('../gatepass/db');
  const fail = (error, message, extra = {}) => res.json({ ok: false, error, message, ...extra });

  const parsedPlate = require('../ulip/plate').parse(req.body.regNo);
  if (!parsedPlate.ok) return res.json({ ok: false, error: 'invalid_format', message: 'Please check the vehicle number.' });
  const regNo = parsedPlate.regNo;
  const { placeId, slotId, travelDate } = req.body;

  const place = await places.byId(placeId);
  if (!place || !place.is_active) return fail('place_unavailable', 'Bookings for this destination are not open yet.');

  /* Refused if the slot is closed for that date, whatever the form was showing. */
  const slot = await one(
    `SELECT * FROM place_slots WHERE id = $1 AND place_id = $2 AND is_active
        AND (valid_from IS NULL OR valid_from <= $3::date) AND (valid_to IS NULL OR valid_to >= $3::date)`,
    [slotId, place.id, travelDate]);
  if (!slot) return fail('slot_invalid', 'Please choose a time slot again.');

  const allowedDates = (await places.bookableDates(place, (await places.list()).find((p) => String(p.id) === String(place.id)).slots))
    .map((d) => d.value);
  if (!allowedDates.includes(String(travelDate))) return fail('date_invalid', 'That date can no longer be booked. Please choose another date.');

  const timing = slotTime.check(slot, travelDate);
  if (!timing.bookable) return fail('slot_closed', 'That time slot has closed for today. Please choose another slot or date.');

  const resolved = await vehicles.resolve(regNo, { customerId: req.customer.id });
  if (!resolved.ok || !vehicles.isClassified(resolved.vehicle)) {
    return fail('not_found', 'We could not verify that vehicle number. Please check it and try again.');
  }
  const verdict = await eligibility.decide(resolved.vehicle);
  if (!verdict.allowed) return fail('not_permitted', verdict.reason);
  if (verdict.unclassified) return fail('unclassified', 'We could not determine the vehicle type for that number.');

  const existing = await booking.existingForDate(resolved.vehicle.id, travelDate);
  if (existing && existing.status !== 'held') {
    return fail('already_booked',
      `${regNo} already has an entry pass for this date (${existing.slot_label}). Only one pass is allowed per vehicle per day.`);
  }

  /* The same visitor tapping Continue twice, or going back and changing the
     slot, must not hold two places. Whatever this link held before is released
     first; a held place belonging to somebody else's link is left alone. */
  const prior = await one(
    `SELECT t.id FROM web_tokens w JOIN tickets t ON t.id = w.ticket_id
      WHERE w.token_hash = $1 AND t.status = 'held'`,
    [require('crypto').createHash('sha256').update(req.params.token).digest('hex')]);
  if (prior) await booking.releaseHold(prior.id);
  if (existing && existing.status === 'held' && (!prior || String(prior.id) !== String(existing.id))) {
    return fail('already_booked',
      `A booking for ${regNo} on this date is already in progress. Please complete it or try again in a few minutes.`);
  }

  const held = await booking.hold({
    customer: req.customer, vehicle: resolved.vehicle, place, slot,
    categoryId: verdict.categoryId, travelDate,
  });
  if (!held.ok) {
    const msg = {
      sold_out: 'That slot has just sold out for your vehicle type. Please choose another slot or date.',
      already_booked: `${regNo} already has an entry pass for this date. Only one pass is allowed per vehicle per day.`,
      no_price: 'No fare is configured for this vehicle at this destination.',
    }[held.reason] || 'We could not hold your place. Please try again.';
    return fail(held.reason, msg);
  }

  await q('UPDATE web_tokens SET ticket_id = $2 WHERE token_hash = $1',
    [require('crypto').createHash('sha256').update(req.params.token).digest('hex'), held.ticket.id]);

  const payUrl = await checkout.linkFor(held.ticket);
  const t = held.ticket;
  res.json({
    ok: true, ticketNo: t.ticket_no, payUrl,
    holdMinutes: await inventory.holdMinutes(),
    /* The server's clock decides when the hold ends, not the phone's. The page
       counts down from the seconds remaining at the moment of this answer, so a
       phone whose clock is wrong still shows the right time left. */
    heldUntil: t.held_until,
    secondsLeft: Math.max(0, Math.floor((new Date(t.held_until).getTime() - Date.now()) / 1000)),
    amount: pricing.rupees(t.total_paise),
  });
}));

/**
 * Cancel from the confirmation popup, or the countdown running out: give the
 * held place back now rather than when the hold ages out.
 *
 * Only the place this link is holding can be released — the ticket is found
 * through this token, never from an id in the request — so nobody can free
 * somebody else's place by posting to this.
 */
router.post('/book/:token/release', express.json(), gate, safe(async (req, res) => {
  if (req.tokenError) return res.status(410).json({ ok: false, error: req.tokenError });
  const booking = require('../gatepass/booking');
  const hash = require('crypto').createHash('sha256').update(req.params.token).digest('hex');
  const held = await one(
    `SELECT t.id FROM web_tokens w JOIN tickets t ON t.id = w.ticket_id
      WHERE w.token_hash = $1 AND t.status = 'held'`, [hash]);
  if (!held) return res.json({ ok: true, released: false });
  const released = await booking.releaseHold(held.id);
  res.json({ ok: true, released });
}));

module.exports = router;
