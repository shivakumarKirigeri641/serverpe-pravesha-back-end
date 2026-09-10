/**
 * routes/flowEndpoint.js — the data exchange behind the booking Flow.
 *
 * WhatsApp renders the form; this decides what goes on each screen and what
 * happens when the visitor moves forward. Meta calls it once per screen
 * transition, encrypted both ways.
 *
 * THE SCREENS
 *
 *   DETAILS   name and number, already known, shown locked. Place and date.
 *   VEHICLE   registration number, checked against the RC record before the
 *             visitor may continue. The check is not optional: a ticket is
 *             sealed to a plate, and a typo discovered at the barrier is a
 *             refused visitor who paid.
 *   SLOT      slots with live remaining counts; a full slot is shown, and
 *             disabled, rather than hidden. "Sold out" is information.
 *   REVIEW    everything back, including what the RC record says the vehicle
 *             is, an explicit agreement, then pay.
 *
 * WHY THE STATE LIVES HERE AND NOT IN THE FORM
 *
 * Everything the visitor picks is echoed back to us on the next call, so it
 * would be possible to trust the form. We do not: the price and the category
 * come from the plate we looked up, and the availability is re-read when the
 * booking is actually made. A form is a client, and a client can be edited.
 *
 * WHY NOTHING IS BOOKED HERE
 *
 * The Flow ends by handing back a payment link. The place is held at that
 * point, not when the form opens — a form left open on a phone must not hold
 * a place on a hill that somebody else could have taken.
 */

const express = require('express');
const crypto = require('crypto');
const { decryptRequest, encryptResponse } = require('../whatsapp/flowCrypto');
const booking = require('../gatepass/booking');
const inventory = require('../gatepass/inventory');
const vehicles = require('../gatepass/vehicle');
const pricing = require('../gatepass/pricing');
const customers = require('../gatepass/customers');
const plate = require('../gatepass/plate');
const { t, prettyDate: fmtDate } = require('../gatepass/i18n');
const db = require('../gatepass/db');

const router = express.Router();
const PLACE_CODE = process.env.PLACE_CODE || 'MULLAYANAGIRI';

/* ── helpers ─────────────────────────────────────────────────────────────── */

/* Dates are formatted in the visitor's language, weekday and month included.
   A Kannada screen with "Wed, 24 Sep" in the middle of it is the kind of
   half-translation that reads worse than plain English throughout. */
const prettyDate = (d, lang) => fmtDate(d, lang);

const rs = (paise) => `Rs. ${(paise / 100) % 1 === 0 ? paise / 100 : (paise / 100).toFixed(2)}`;

/** +91 98••• ••415 — enough to recognise, not enough to read over a shoulder. */
function maskMobile(mobile) {
  const d = String(mobile).replace(/\D/g, '').slice(-10);
  if (d.length < 10) return mobile;
  return `+91 ${d.slice(0, 2)}••• ••${d.slice(-3)}`;
}

/**
 * The flow token carries who this is. It is minted when the Flow is sent and
 * is the only thing tying an encrypted form session to a customer — the form
 * itself never sees a customer id, so a tampered payload cannot book for
 * somebody else.
 */
const sessions = new Map();          // token -> { customerId, mobile, ...picks }

/**
 * The token carries who this is, signed.
 *
 * The picks a visitor makes are held in memory, which is fine — losing them
 * means the form starts again. But WHO they are must survive a restart: this
 * process can be redeployed while somebody has the form open, and a session
 * that came back empty would fall back to the default language and answer an
 * English speaker in Kannada. So identity travels inside the token and is
 * recovered from it whenever memory has nothing.
 *
 * Signed with the app secret so the mobile number in it cannot be swapped for
 * somebody else's. The form never sees this value; Meta echoes it back.
 */
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET || 'unset')
    .update(body).digest('base64url').slice(0, 24);
  return `${body}.${mac}`;
}

function unsign(token) {
  const [body, mac] = String(token || '').replace(/^bk_/, '').split('.');
  if (!body || !mac) return null;
  const expect = crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET || 'unset')
    .update(body).digest('base64url').slice(0, 24);
  // Length-equal comparison; a mismatch here means a forged or corrupt token.
  if (mac.length !== expect.length
      || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
}

function session(token) {
  if (!sessions.has(token)) {
    /* Nothing in memory: rebuild what we can from the token itself. */
    const claim = unsign(token);
    sessions.set(token, claim
      ? { customerId: claim.c, mobile: claim.m, createdAt: Date.now() }
      : { createdAt: Date.now() });
  }
  return sessions.get(token);
}

/** The stored form of a token: never the token itself. */
const tokenHash = (token) =>
  crypto.createHash('sha256').update(String(token)).digest('hex');

/**
 * Mint a link token and record that it was issued.
 *
 * @param purpose 'booking' | 'support' | 'feedback'. Booking tokens are spent
 *                on use; the others are not, because somebody may reasonably
 *                write in twice.
 * @param ttlMinutes how long the link stays alive.
 */
function newToken(customerId, mobile, purpose = 'booking', ttlMinutes = 120) {
  const token = `bk_${sign({ c: customerId, m: mobile, ts: Date.now() })}`;
  sessions.set(token, { customerId, mobile, createdAt: Date.now() });

  /* Recorded, not awaited: minting must not fail because the database is
     briefly busy, and an unrecorded token simply behaves as it did before. */
  db.query(
    `INSERT INTO web_tokens (token_hash, customer_id, purpose, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' minutes')::interval)
     ON CONFLICT (token_hash) DO NOTHING`,
    [tokenHash(token), customerId, purpose, String(ttlMinutes)])
    .catch((e) => console.error('[token] could not record:', e.message));

  return token;
}

/**
 * Is this token still good?
 *
 * @returns { ok, reason, row } — reason is 'unknown', 'expired' or 'used'.
 *
 * A token with no row is accepted: links issued before this table existed, and
 * links whose insert lost a race with the visitor's very fast tap, should not
 * fail. The check tightens what it can rather than inventing a new way to
 * refuse a legitimate visitor.
 */
async function tokenState(token) {
  const row = await db.one(
    'SELECT * FROM web_tokens WHERE token_hash = $1', [tokenHash(token)]);
  if (!row) return { ok: true, reason: 'unknown', row: null };
  if (row.used_at) return { ok: false, reason: 'used', row };
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: 'expired', row };
  }
  return { ok: true, row };
}

/** Spend a booking token. Idempotent: spending a spent token changes nothing. */
async function spendToken(token, ticketId) {
  await db.query(
    `UPDATE web_tokens SET used_at = now(), ticket_id = COALESCE($2, ticket_id)
      WHERE token_hash = $1 AND used_at IS NULL`,
    [tokenHash(token), ticketId || null]);
}

/* Sessions are in memory and would otherwise accumulate for the life of the
   process. A form abandoned on a phone is the normal case, not the exception. */
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [k, v] of sessions) if ((v.createdAt || 0) < cutoff) sessions.delete(k);
}, 10 * 60 * 1000).unref();

/* ── screen builders ─────────────────────────────────────────────────────── */

/**
 * The visitor's language, resolved once per request and threaded through every
 * screen. Held on the session after the first lookup so a four-screen form is
 * not four extra queries.
 */
async function langFor(s) {
  if (s.lang) return s.lang;
  const c = s.mobile ? await customers.byMobile(s.mobile) : null;
  s.lang = c?.language === 'en' ? 'en' : 'kn';
  s.name = c?.wa_profile_name || null;
  return s.lang;
}

async function detailsScreen(s) {
  const L = await langFor(s);

  /* Every place the department has switched on, not one compiled in. A site
     that is not ready is is_active = false and simply does not appear — which
     is how the three placeholder sites stay out of the list until their real
     prices and capacities are confirmed. */
  const places = (await db.query(
    'SELECT id, name, booking_days_ahead FROM places WHERE is_active ORDER BY id')).rows;

  /* booking_days_ahead is per place, so the date list depends on which one is
     chosen. Before that choice the first place is used; the list is rebuilt
     once the place is known. */
  const dates = places.length ? await booking.bookableDates(places[0]) : [];

  return {
    screen: 'DETAILS',
    data: {
      t_your_details: t(L, 'f_your_details'),
      t_name: t(L, 'f_name'),
      name: s.name || 'Visitor',
      t_number: t(L, 'f_number'),
      mobile: maskMobile(s.mobile || ''),
      t_where_when: t(L, 'f_where_when'),
      t_place: t(L, 'f_place'),
      t_date: t(L, 'f_date'),
      t_continue: t(L, 'f_continue'),
      places: places.map((p) => ({ id: String(p.id), title: p.name })),
      /* bookableDates returns plain "YYYY-MM-DD" strings and has already
         applied the 6 PM release rule, so nothing here needs to filter. */
      dates: dates.map((d) => ({ id: d, title: prettyDate(d, L) })),
    },
  };
}

async function vehicleScreen(s, errorKey, vars) {
  const L = await langFor(s);
  return {
    screen: 'VEHICLE',
    data: {
      /* One field, not two joined in the template: Flow JSON allows a text to
         be a single binding or a literal, never a concatenation of bindings. */
      header_line: [s.placeName, s.travelDate && prettyDate(s.travelDate, L)]
        .filter(Boolean).join('  ·  '),
      t_vehicle_number: t(L, 'f_vehicle_number'),
      t_vehicle_note: t(L, 'f_vehicle_note'),
      t_reg_label: t(L, 'f_reg_label'),
      t_reg_helper: t(L, 'f_reg_helper'),
      t_check: t(L, 'f_check'),
      error: errorKey ? t(L, errorKey, vars) : '',
      has_error: !!errorKey,
    },
  };
}

async function slotScreen(s) {
  const L = await langFor(s);
  const place = await booking.placeByCode(PLACE_CODE);

  /* availability() already returns one row per slot with its counts joined, so
     this is a single query rather than one per slot. A closed or full slot is
     shown and disabled rather than hidden — "full" is information the visitor
     needs in order to pick a different day. */
  const av = await inventory.availability(s.placeId, s.travelDate, s.categoryId);

  const slots = av.map((a) => {
    const left = Number(a.available) || 0;
    return {
      id: a.code,
      title: a.label || a.code,
      description: !a.is_open ? (a.closed_note || t(L, 'f_slot_closed'))
        : left > 0 ? t(L, 'f_slot_left', { left, cap: a.capacity })
        : t(L, 'f_slot_full'),
      enabled: !!a.is_open && left > 0,
    };
  });

  return {
    screen: 'SLOT',
    data: {
      vehicle_line: s.vehicleLine || '',
      vehicle_meta: s.vehicleMeta || '',
      t_choose_slot: t(L, 'f_choose_slot'),
      date_label: prettyDate(s.travelDate, L),
      t_slots_label: t(L, 'f_slots_label'),
      t_review: t(L, 'f_review'),
      slots,
    },
  };
}

async function reviewScreen(s) {
  const L = await langFor(s);
  return {
    screen: 'REVIEW',
    data: {
      t_your_booking: t(L, 'f_your_booking'),
      summary: `${s.placeName}
${prettyDate(s.travelDate, L)}  ·  ${s.slotLabel}`,
      t_vehicle: t(L, 'f_vehicle'),
      vehicle_block: `${s.regPretty}
${s.vehicleLine}
${s.vehicleMeta}`,
      amount_line: t(L, 'f_total', { amount: rs(s.totalPaise) }),
      fee_note: t(L, 'f_fee_note', { entry: rs(s.entryPaise), fee: rs(s.feePaise) }),
      t_agree: t(L, 'f_agree'),
      t_terms_note: t(L, 'f_terms_note'),
      t_pay_now: t(L, 'f_pay_now'),
    },
  };
}

/* ── the exchange ────────────────────────────────────────────────────────── */

async function handle(body) {
  const { action, screen, data, flow_token: token, version } = body;

  /* Meta's health check. It carries no flow token and must be answered even
     when nothing else is configured. */
  if (action === 'ping') return { version, data: { status: 'active' } };

  /* The client reports its own errors here. Acknowledging is all that is asked
     for, but they are logged: a Flow failing on a visitor's phone is otherwise
     completely invisible from this side. */
  if (data?.error) {
    console.error('[flow] client reported: %s', JSON.stringify(data).slice(0, 300));
    return { version, data: { acknowledged: true } };
  }

  const s = session(token);

  if (action === 'INIT') return { version, ...(await detailsScreen(s)) };

  if (action === 'BACK') {
    if (screen === 'VEHICLE') return { version, ...(await detailsScreen(s)) };
    if (screen === 'SLOT') return { version, ...(await vehicleScreen(s)) };
    if (screen === 'REVIEW') return { version, ...(await slotScreen(s)) };
    return { version, ...(await detailsScreen(s)) };
  }

  if (action !== 'data_exchange') {
    return { version, data: { acknowledged: true } };
  }

  /* DETAILS → VEHICLE */
  if (screen === 'DETAILS') {
    const place = await booking.placeByCode(PLACE_CODE);
    s.placeId = place.id;
    s.placeName = place.name;
    s.travelDate = data.travel_date;
    return { version, ...(await vehicleScreen(s)) };
  }

  /* VEHICLE → SLOT, only if the plate resolves. */
  if (screen === 'VEHICLE') {
    const parsed = plate.parse(String(data.reg_no || ''));
    if (!parsed.ok) {
      return { version, ...(await vehicleScreen(s, 'f_err_format')) };
    }

    let v;
    try {
      v = await vehicles.resolve(parsed.reg_no, { customerId: s.customerId });
    } catch (e) {
      console.error('[flow] vehicle lookup failed:', e.message);
      return { version, ...(await vehicleScreen(s, 'f_err_lookup')) };
    }

    if (!v) {
      return { version, ...(await vehicleScreen(s, 'f_err_notfound')) };
    }

    /* The category is worked out from what the RC record says the vehicle is,
       not from anything the visitor typed — it decides the entry fee, so it is
       not a field a form is allowed to influence. */
    const category = await pricing.categoryForVehicle(v);
    if (!category) {
      return { version, ...(await vehicleScreen(s, 'f_err_category')) };
    }

    /* One vehicle, one ticket, one day — refused here rather than after
       payment, which is the only place it is any use to the visitor. */
    const clash = await booking.existingForDate(v.id, s.travelDate);
    if (clash) {
      const L = await langFor(s);
      return { version, ...(await vehicleScreen(s, 'f_err_clash', {
        reg: parsed.pretty || parsed.reg_no,
        date: prettyDate(s.travelDate, L),
      })) };
    }

    const price = await pricing.priceFor(s.placeId, category.id);

    s.vehicleId = v.id;
    s.regPretty = parsed.pretty || parsed.reg_no;
    s.regNo = parsed.reg_no;
    s.categoryId = category.id;
    s.categoryLabel = category.label;
    s.vehicleLine = vehicles.describe(v) || (parsed.pretty || parsed.reg_no);
    s.vehicleMeta = `${category.label}  ·  Entry ${rs(price.entry_paise)}`;
    s.entryPaise = price.entry_paise;
    s.feePaise = price.platform_paise;
    s.totalPaise = price.entry_paise + price.platform_paise;

    return { version, ...(await slotScreen(s)) };
  }

  /* SLOT → REVIEW */
  if (screen === 'SLOT') {
    const place = await booking.placeByCode(PLACE_CODE);
    const slot = (await db.query(
      'SELECT * FROM place_slots WHERE place_id = $1 AND code = $2',
      [place.id, data.slot])).rows[0];
    if (!slot) return { version, ...(await slotScreen(s)) };

    s.slotId = slot.id;
    s.slotCode = slot.code;
    s.slotLabel = slot.label || slot.code;
    return { version, ...(await reviewScreen(s)) };
  }

  return { version, data: { acknowledged: true } };
}

/* ── the route ───────────────────────────────────────────────────────────── */

router.post('/flow/booking', express.json({ limit: '256kb' }), async (req, res) => {
  let ctx;
  try {
    ctx = decryptRequest(req.body);
  } catch (e) {
    console.error('[flow] could not decrypt:', e.message);
    return res.sendStatus(e.status || 421);
  }

  try {
    const out = await handle(ctx.body);
    return res.type('text/plain').send(encryptResponse(out, ctx.aesKey, ctx.iv));
  } catch (e) {
    console.error('[flow] handler threw:', e.stack || e.message);
    /* Encrypted, because an unencrypted body here shows the visitor a generic
       failure with no way to tell that the server was the cause. */
    return res.type('text/plain').send(encryptResponse(
      { version: ctx.body?.version, data: { acknowledged: true } }, ctx.aesKey, ctx.iv));
  }
});

module.exports = {
  router, newToken, sessions,
  unsignToken: unsign, tokenState, spendToken,
};
