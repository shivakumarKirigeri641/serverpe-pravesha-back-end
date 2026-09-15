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
 *
 * IN THE LANGUAGE THE VISITOR CHOSE. The link belongs to a customer, and the
 * customer chose English or Kannada in the chat. The page and every sentence
 * this route sends back to it follow that choice, so a Kannada visitor is not
 * handed an English form halfway through a Kannada conversation. When the link
 * itself is bad nobody is known yet, and the answer is given in both.
 */

const express = require('express');
const token = require('../gatepass/webToken');
const places = require('../gatepass/places');
const pricing = require('../gatepass/pricing');
const inventory = require('../gatepass/inventory');
const vehicles = require('../gatepass/vehicle');
const eligibility = require('../gatepass/eligibility');
const { one } = require('../gatepass/db');
const { langOf } = require('../i18n');
const L = require('../localize');
const page = require('../web/bookingPage');

const router = express.Router();

/* Every sentence this route can send the form, in both languages. */
const COPY = {
  en: {
    serverError: 'We could not complete that just now. Please try again.',
    linkExpired: 'This booking link has expired. Send hi on WhatsApp to start again.',
    linkExpiredShort: 'This booking link has expired.',
    checkTitle: 'Check the vehicle number',
    invalidFormat: (err) => String(err || 'Please enter a valid registration number, for example KA01AB1234.').replace(/\*/g, ''),
    placeUnavailable: 'Bookings for this destination are not open yet.',
    notFound: 'We could not find that registration number. Please check it and try again.',
    unclassified: 'We could not determine the vehicle type for that number. Please check it and try again.',
    inProgressTitle: 'Booking already in progress',
    inProgress: (reg, when) => `A booking for ${reg} on ${when} is already in progress. Complete it, or try again in a few minutes.`,
    oneTitle: 'Only one pass per vehicle per day',
    alreadyOn: (reg, when, slot) => `${reg} already has an entry pass for ${when} (${slot}). Please choose another date.`,
    noPrice: 'No fare is configured for this vehicle at this destination.',
    checkNumber: 'Please check the vehicle number.',
    slotInvalid: 'Please choose a time slot again.',
    dateInvalid: 'That date can no longer be booked. Please choose another date.',
    slotClosed: 'That time slot has closed for today. Please choose another slot or date.',
    notVerified: 'We could not verify that vehicle number. Please check it and try again.',
    unclassifiedShort: 'We could not determine the vehicle type for that number.',
    alreadyThisDate: (reg, slot) => `${reg} already has an entry pass for this date (${slot}). Only one pass is allowed per vehicle per day.`,
    inProgressThisDate: (reg) => `A booking for ${reg} on this date is already in progress. Please complete it or try again in a few minutes.`,
    soldOut: 'That slot has just sold out for your vehicle type. Please choose another slot or date.',
    alreadyBooked: (reg) => `${reg} already has an entry pass for this date. Only one pass is allowed per vehicle per day.`,
    cantHold: 'We could not hold your place. Please try again.',
    noHold: 'Please choose your slot again.',
  },
  kn: {
    serverError: 'ಈಗ ಅದನ್ನು ಪೂರ್ಣಗೊಳಿಸಲಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
    linkExpired: 'ಈ ಬುಕಿಂಗ್ ಲಿಂಕ್‌ನ ಅವಧಿ ಮುಗಿದಿದೆ. ಮತ್ತೆ ಆರಂಭಿಸಲು ವಾಟ್ಸ್‌ಆ್ಯಪ್‌ನಲ್ಲಿ hi ಕಳುಹಿಸಿ.',
    linkExpiredShort: 'ಈ ಬುಕಿಂಗ್ ಲಿಂಕ್‌ನ ಅವಧಿ ಮುಗಿದಿದೆ.',
    checkTitle: 'ವಾಹನ ಸಂಖ್ಯೆ ಪರಿಶೀಲಿಸಿ',
    invalidFormat: () => 'ಇದು ಸರಿಯಾದ ವಾಹನ ಸಂಖ್ಯೆಯಂತೆ ಕಾಣುತ್ತಿಲ್ಲ. ದಯವಿಟ್ಟು ಪರಿಶೀಲಿಸಿ, ಉದಾಹರಣೆಗೆ KA01AB1234.',
    placeUnavailable: 'ಈ ತಾಣಕ್ಕೆ ಬುಕಿಂಗ್ ಇನ್ನೂ ಆರಂಭವಾಗಿಲ್ಲ.',
    notFound: 'ಆ ನೋಂದಣಿ ಸಂಖ್ಯೆ ನಮಗೆ ಸಿಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಪರಿಶೀಲಿಸಿ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
    unclassified: 'ಆ ಸಂಖ್ಯೆಯ ವಾಹನದ ಪ್ರಕಾರವನ್ನು ಗುರುತಿಸಲಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಪರಿಶೀಲಿಸಿ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
    inProgressTitle: 'ಬುಕಿಂಗ್ ಈಗಾಗಲೇ ಪ್ರಗತಿಯಲ್ಲಿದೆ',
    inProgress: (reg, when) => `${when} ರಂದು ${reg} ಗಾಗಿ ಬುಕಿಂಗ್ ಈಗಾಗಲೇ ಪ್ರಗತಿಯಲ್ಲಿದೆ. ಅದನ್ನು ಪೂರ್ಣಗೊಳಿಸಿ, ಅಥವಾ ಕೆಲವು ನಿಮಿಷಗಳ ನಂತರ ಪ್ರಯತ್ನಿಸಿ.`,
    oneTitle: 'ಒಂದು ವಾಹನಕ್ಕೆ ದಿನಕ್ಕೆ ಒಂದೇ ಪಾಸ್',
    alreadyOn: (reg, when, slot) => `${reg} ಗೆ ${when} ರಂದು ಈಗಾಗಲೇ ಪ್ರವೇಶ ಪಾಸ್ ಇದೆ (${slot}). ದಯವಿಟ್ಟು ಬೇರೆ ದಿನಾಂಕ ಆಯ್ಕೆಮಾಡಿ.`,
    noPrice: 'ಈ ತಾಣದಲ್ಲಿ ಈ ವಾಹನಕ್ಕೆ ಶುಲ್ಕ ನಿಗದಿಯಾಗಿಲ್ಲ.',
    checkNumber: 'ದಯವಿಟ್ಟು ವಾಹನ ಸಂಖ್ಯೆ ಪರಿಶೀಲಿಸಿ.',
    slotInvalid: 'ದಯವಿಟ್ಟು ಮತ್ತೆ ಸಮಯದ ಸ್ಲಾಟ್ ಆಯ್ಕೆಮಾಡಿ.',
    dateInvalid: 'ಆ ದಿನಾಂಕವನ್ನು ಈಗ ಬುಕ್ ಮಾಡಲಾಗದು. ದಯವಿಟ್ಟು ಬೇರೆ ದಿನಾಂಕ ಆಯ್ಕೆಮಾಡಿ.',
    slotClosed: 'ಇಂದಿನ ಆ ಸ್ಲಾಟ್ ಮುಚ್ಚಿದೆ. ದಯವಿಟ್ಟು ಬೇರೆ ಸ್ಲಾಟ್ ಅಥವಾ ದಿನಾಂಕ ಆಯ್ಕೆಮಾಡಿ.',
    notVerified: 'ಆ ವಾಹನ ಸಂಖ್ಯೆಯನ್ನು ಪರಿಶೀಲಿಸಲಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಪರಿಶೀಲಿಸಿ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
    unclassifiedShort: 'ಆ ಸಂಖ್ಯೆಯ ವಾಹನದ ಪ್ರಕಾರವನ್ನು ಗುರುತಿಸಲಾಗಲಿಲ್ಲ.',
    alreadyThisDate: (reg, slot) => `${reg} ಗೆ ಈ ದಿನಾಂಕಕ್ಕೆ ಈಗಾಗಲೇ ಪ್ರವೇಶ ಪಾಸ್ ಇದೆ (${slot}). ಒಂದು ವಾಹನಕ್ಕೆ ದಿನಕ್ಕೆ ಒಂದೇ ಪಾಸ್.`,
    inProgressThisDate: (reg) => `ಈ ದಿನಾಂಕಕ್ಕೆ ${reg} ಗಾಗಿ ಬುಕಿಂಗ್ ಈಗಾಗಲೇ ಪ್ರಗತಿಯಲ್ಲಿದೆ. ಅದನ್ನು ಪೂರ್ಣಗೊಳಿಸಿ ಅಥವಾ ಕೆಲವು ನಿಮಿಷಗಳ ನಂತರ ಪ್ರಯತ್ನಿಸಿ.`,
    soldOut: 'ನಿಮ್ಮ ವಾಹನ ಪ್ರಕಾರಕ್ಕೆ ಆ ಸ್ಲಾಟ್ ಈಗಷ್ಟೇ ಭರ್ತಿಯಾಗಿದೆ. ದಯವಿಟ್ಟು ಬೇರೆ ಸ್ಲಾಟ್ ಅಥವಾ ದಿನಾಂಕ ಆಯ್ಕೆಮಾಡಿ.',
    alreadyBooked: (reg) => `${reg} ಗೆ ಈ ದಿನಾಂಕಕ್ಕೆ ಈಗಾಗಲೇ ಪ್ರವೇಶ ಪಾಸ್ ಇದೆ. ಒಂದು ವಾಹನಕ್ಕೆ ದಿನಕ್ಕೆ ಒಂದೇ ಪಾಸ್.`,
    cantHold: 'ನಿಮ್ಮ ಸ್ಥಾನ ಕಾಯ್ದಿರಿಸಲಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
    noHold: 'ದಯವಿಟ್ಟು ಮತ್ತೆ ನಿಮ್ಮ ಸ್ಲಾಟ್ ಆಯ್ಕೆಮಾಡಿ.',
  },
};

/* Nobody is known yet (the link itself failed): say it in both. */
const both = (key) => `${COPY.en[key]} ${COPY.kn[key]}`;
const slotName = (row, lang) => (lang === 'kn' && row.slot_label_kn ? row.slot_label_kn : row.slot_label);

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
    message: req.lang ? COPY[req.lang].serverError : both('serverError') });
});

/** Every route below needs a live token; refusing early keeps that in one place. */
const gate = safe(async (req, res, next) => {
  const check = await token.verify(req.params.token);
  if (!check.ok) {
    req.tokenError = check.reason;
    return next();
  }
  req.customer = await one('SELECT * FROM customers WHERE id = $1', [check.customerId]);
  req.lang = langOf(req.customer);
  req.tokenValue = req.params.token;
  return next();
});

router.get('/book/:token', gate, safe(async (req, res) => {
  if (req.tokenError) return res.status(410).type('html').send(page.expired(req.tokenError));

  const list = await places.list();
  const live = list.filter((p) => p.is_active);
  /* The place chosen in the chat (2026-09-15), while it is still open. */
  const chosen = req.query.place ? live.find((p) => String(p.id) === String(req.query.place)) : null;
  const first = chosen || live[0] || list[0];

  /* A per-person destination (056) has its own short form: a date and a number of people. */
  if (first && first.is_active && first.booking_mode === 'person') {
    return res.type('html').send(await require('../web/personBookingPage').pageFor({
      token: req.params.token, customer: req.customer, place: first, lang: req.lang }));
  }
  const dates = await places.bookableDates(first, first ? first.slots : []);
  const releaseInfo = first ? await places.window(first) : null;
  /* The fees of the place being booked, not whichever active place happens to come first. */
  const tariffRows = first && first.is_active ? await pricing.tariff(first.id) : [];

  res.type('html').send(page.render({
    scriptVersion: client().hash,
    token: req.params.token,
    customer: req.customer,
    places: list,
    dates,
    tariff: tariffRows,
    feePercent: await pricing.platformPercent(),
    releaseInfo,
    lang: req.lang,
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
  const lang = req.lang;
  const C = COPY[lang];

  /* The same parser the ULIP lookup uses: spaces, dots and hyphens removed,
     letter O typed for zero repaired, and a state code that does not exist
     refused here — before a lookup is spent on it. */
  const parsed = require('../ulip/plate').parse(req.body.regNo);
  if (!parsed.ok) {
    return res.json({ ok: false, error: 'invalid_format', title: C.checkTitle, message: C.invalidFormat(parsed.error) });
  }
  const regNo = parsed.regNo;

  const placeId = req.body.placeId;
  const place = await places.byId(placeId);
  if (!place || !place.is_active) {
    return res.json({ ok: false, error: 'place_unavailable', message: C.placeUnavailable });
  }

  const resolved = await vehicles.resolve(regNo, { customerId: req.customer.id });

  /* For the demo every vehicle is assumed to have a proper registration. An
     unidentified plate is therefore treated as a number entered wrongly and
     sent back to be corrected, rather than opening the self-declared category
     path -- that path exists and is tested (see 017 and eligibility.decide),
     it is simply not surfaced yet. */
  if (!resolved.ok || !resolved.vehicle || !vehicles.isClassified(resolved.vehicle)) {
    return res.json({ ok: false, error: 'not_found', message: C.notFound });
  }

  const verdict = await eligibility.decide(resolved.vehicle);
  await eligibility.remember(resolved.vehicle.id, verdict);

  if (!verdict.allowed) {
    /* English readers also see the Kannada line under it, as before; a Kannada
       reader gets the Kannada reason alone rather than English on top. */
    return res.json({ ok: false, error: 'not_permitted', denyCode: verdict.denyCode,
      message: lang === 'kn' ? (verdict.reasonKn || verdict.reason) : verdict.reason,
      messageKn: lang === 'kn' ? undefined : verdict.reasonKn,
      vehicle: vehicles.describe(resolved.vehicle) });
  }

  if (verdict.unclassified) {
    return res.json({ ok: false, error: 'unclassified', message: C.unclassified });
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
        const when = L.shortDate(travelDate, lang);
        return res.json(existing.status === 'held'
          ? { ok: false, error: 'booking_in_progress', title: C.inProgressTitle, message: C.inProgress(regNo, when) }
          : { ok: false, error: 'already_booked', title: C.oneTitle, message: C.alreadyOn(regNo, when, slotName(existing, lang)) });
      }
    }
  }

  const price = await pricing.forPlaceCategory(place.id, verdict.categoryId);
  if (!price) {
    return res.json({ ok: false, error: 'no_price', message: C.noPrice });
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
      slotId: s.slotId, code: s.code, label: s.label, labelKn: s.labelKn, lastEntry: s.lastEntry,
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
  if (req.tokenError) return res.status(410).json({ ok: false, error: req.tokenError, message: both('linkExpired') });
  const lang = req.lang;
  const C = COPY[lang];

  const booking = require('../gatepass/booking');
  const checkout = require('../gatepass/checkout');
  const slotTime = require('../gatepass/slotTime');
  const { query: q } = require('../gatepass/db');
  const fail = (error, message, extra = {}) => res.json({ ok: false, error, message, ...extra });

  const parsedPlate = require('../ulip/plate').parse(req.body.regNo);
  if (!parsedPlate.ok) return res.json({ ok: false, error: 'invalid_format', message: C.checkNumber });
  const regNo = parsedPlate.regNo;
  const { placeId, slotId, travelDate } = req.body;

  const place = await places.byId(placeId);
  if (!place || !place.is_active) return fail('place_unavailable', C.placeUnavailable);

  /* Refused if the slot is closed for that date, whatever the form was showing. */
  const slot = await one(
    `SELECT * FROM place_slots WHERE id = $1 AND place_id = $2 AND is_active
        AND (valid_from IS NULL OR valid_from <= $3::date) AND (valid_to IS NULL OR valid_to >= $3::date)`,
    [slotId, place.id, travelDate]);
  if (!slot) return fail('slot_invalid', C.slotInvalid);

  const allowedDates = (await places.bookableDates(place, (await places.list()).find((p) => String(p.id) === String(place.id)).slots))
    .map((d) => d.value);
  if (!allowedDates.includes(String(travelDate))) return fail('date_invalid', C.dateInvalid);

  const timing = slotTime.check(slot, travelDate);
  if (!timing.bookable) return fail('slot_closed', C.slotClosed);

  const resolved = await vehicles.resolve(regNo, { customerId: req.customer.id });
  if (!resolved.ok || !vehicles.isClassified(resolved.vehicle)) {
    return fail('not_found', C.notVerified);
  }
  const verdict = await eligibility.decide(resolved.vehicle);
  if (!verdict.allowed) return fail('not_permitted', lang === 'kn' ? (verdict.reasonKn || verdict.reason) : verdict.reason);
  if (verdict.unclassified) return fail('unclassified', C.unclassifiedShort);

  const existing = await booking.existingForDate(resolved.vehicle.id, travelDate);
  if (existing && existing.status !== 'held') {
    return fail('already_booked', C.alreadyThisDate(regNo, slotName(existing, lang)));
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
    return fail('already_booked', C.inProgressThisDate(regNo));
  }

  const held = await booking.hold({
    customer: req.customer, vehicle: resolved.vehicle, place, slot,
    categoryId: verdict.categoryId, travelDate,
  });
  if (!held.ok) {
    const msg = {
      sold_out: C.soldOut,
      already_booked: C.alreadyBooked(regNo),
      no_price: C.noPrice,
    }[held.reason] || C.cantHold;
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
    /* Whether to offer "I am already at the checkpost" on the payment sheet.
       Only for a pass that could be driven through the barrier this minute, at
       a gate whose position somebody has recorded. */
    selfCheckin: await require('../gatepass/selfCheckin').offered({ placeId: place.id, slotId: slot.id, travelDate, lang }),
  });
}));

/**
 * "I am already at the checkpost" — ticked, and checked.
 *
 * The phone reports where it is; this decides whether that is the gate. The
 * answer is written against the held pass rather than kept on the page, because
 * the entry is recorded when the payment lands, which may be minutes later and
 * in a different browser tab entirely.
 *
 * Unticking is always allowed and never questioned. Ticking is only honoured
 * when the position agrees, and a refusal is not an error: the visitor simply
 * gets checked in at the barrier like everybody else, which is what would have
 * happened anyway.
 */
router.post('/book/:token/atgate', express.json(), gate, safe(async (req, res) => {
  if (req.tokenError) return res.status(410).json({ ok: false, error: req.tokenError, message: both('linkExpiredShort') });

  const selfCheckin = require('../gatepass/selfCheckin');
  const { query: q2 } = require('../gatepass/db');
  const hash = require('crypto').createHash('sha256').update(req.params.token).digest('hex');

  const held = await one(
    `SELECT t.* FROM web_tokens w JOIN tickets t ON t.id = w.ticket_id
      WHERE w.token_hash = $1 AND t.status = 'held'`, [hash]);
  if (!held) return res.json({ ok: false, error: 'no_hold', message: COPY[req.lang].noHold });

  if (req.body?.on !== true) {
    await q2(`UPDATE tickets SET self_checkin_asked = false, self_checkin_m = NULL WHERE id = $1`, [held.id]);
    return res.json({ ok: true, on: false });
  }

  const verdict = await selfCheckin.verify({
    placeId: held.place_id,
    latitude: req.body.latitude,
    longitude: req.body.longitude,
    accuracy: req.body.accuracy,
    lang: req.lang,
  });

  if (!verdict.ok) {
    await q2(`UPDATE tickets SET self_checkin_asked = false, self_checkin_m = NULL WHERE id = $1`, [held.id]);
    return res.json({ ok: true, on: false, refused: verdict.reason, message: verdict.message, distance: verdict.distance || null });
  }

  await q2(`UPDATE tickets SET self_checkin_asked = true, self_checkin_m = $2 WHERE id = $1`, [held.id, verdict.distance]);
  res.json({ ok: true, on: true, message: verdict.message, distance: verdict.distance });
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

/*
 * PER-PERSON BOOKING (056): places left on a date, and the hold that leads to
 * payment. Both re-check everything from the database; see personBookingPage.js.
 */
router.post('/book/:token/people/availability', express.json(), gate, safe(async (req, res) => {
  if (req.tokenError) return res.status(410).json({ ok: false, error: req.tokenError });
  res.json(await require('../web/personBookingPage').availability({
    placeId: req.body?.placeId, travelDate: req.body?.travelDate }));
}));

router.post('/book/:token/people/confirm', express.json(), gate, safe(async (req, res) => {
  if (req.tokenError) return res.status(410).json({ ok: false, error: req.tokenError, message: both('linkExpired') });
  res.json(await require('../web/personBookingPage').confirm({
    token: req.params.token, customer: req.customer, lang: req.lang,
    placeId: req.body?.placeId, travelDate: req.body?.travelDate, persons: req.body?.persons }));
}));

module.exports = router;
