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
 * THE ORDER OF THE QUESTIONS IS NOT ARBITRARY. Place, then date, then vehicle,
 * then slot. The vehicle has to come before the slot because capacity is held
 * per category -- four hundred cars and a hundred Tempo Travellers are
 * different numbers on the same road at the same hour -- so "how many are
 * left?" has no answer until we know what is being driven.
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

/* Served as a file rather than inlined into the page: the browser caches it
   between the form and any later visit, and a syntax error in it fails at
   `node -c` instead of silently inside a template string. */
router.get('/book/app.js', (req, res) => {
  res.type('application/javascript')
     .set('Cache-Control', 'public, max-age=300')
     .sendFile(require('path').join(__dirname, '..', 'web', 'bookingClient.js'));
});

/** Every route below needs a live token; refusing early keeps that in one place. */
async function gate(req, res, next) {
  const check = await token.verify(req.params.token);
  if (!check.ok) {
    req.tokenError = check.reason;
    return next();
  }
  req.customer = await one('SELECT * FROM customers WHERE id = $1', [check.customerId]);
  req.tokenValue = req.params.token;
  return next();
}

router.get('/book/:token', gate, async (req, res) => {
  if (req.tokenError) return res.status(410).type('html').send(page.expired(req.tokenError));

  const list = await places.list();
  const live = list.filter((p) => p.is_active);
  const dates = places.bookableDates(live[0] || list[0]);
  const tariffRows = live[0] ? await pricing.tariff(live[0].id) : [];

  res.type('html').send(page.render({
    token: req.params.token,
    customer: req.customer,
    places: list,
    dates,
    tariff: tariffRows,
  }));
});

/**
 * Identify the vehicle and price it.
 *
 * This is the step that can end the booking: a barred vehicle is refused here,
 * before a slot is chosen and long before money is involved. Refusing at the
 * checkpost instead would mean a refund and an argument at a barrier.
 */
router.post('/book/:token/vehicle', express.json(), gate, async (req, res) => {
  if (req.tokenError) return res.status(410).json({ error: req.tokenError });

  const regNo = String(req.body.regNo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (regNo.length < 6 || regNo.length > 12) {
    return res.json({ ok: false, error: 'invalid_format',
      message: 'Please enter a valid registration number, for example KA31N8147.' });
  }

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
      make: details.make, model: details.model, type: details.type,
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
});

/** Remaining capacity in each slot, for the category just determined. */
router.post('/book/:token/slots', express.json(), gate, async (req, res) => {
  if (req.tokenError) return res.status(410).json({ error: req.tokenError });

  const { placeId, categoryId, travelDate } = req.body;
  if (!placeId || !categoryId || !travelDate) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  const slots = await inventory.forDate(placeId, categoryId, travelDate);
  res.json({ ok: true, slots });
});

module.exports = router;
