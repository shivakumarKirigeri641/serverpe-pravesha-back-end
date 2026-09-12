/**
 * simulation/index.js — demonstration mode: the panel, alive.
 *
 * WHAT IT IS FOR. Before a destination has real traffic, every screen in the
 * panel is a still photograph. This makes visitors arrive: a booking here, a
 * vehicle entering there, the occasional pass refused at the gate — so live
 * monitoring moves, the dashboard climbs through the day, and a demonstration
 * looks like the thing it is demonstrating.
 *
 * WHAT IT IS NOT. It is not a load test and it is not real traffic. Everything
 * it writes is flagged is_test, every visitor is in the reserved 000 range, and
 * every vehicle comes from the test fleet already in the cache. It sends
 * nothing: WhatsApp messages are written as history, exactly as the seeder
 * writes them, and no vehicle is ever looked up.
 *
 * IT CANNOT BE LEFT ON BY ACCIDENT, which is the part that matters the day this
 * goes live:
 *
 *   1. It is off unless somebody switches it on in Settings.
 *   2. Switching it on sets an expiry — it stops by itself, and the longest it
 *      will run unattended is a day.
 *   3. On a production server it refuses outright: NODE_ENV=production turns it
 *      off and keeps it off unless ALLOW_SIMULATION=true is set deliberately.
 *   4. Turning it off takes effect within one tick, and every switch is audited.
 *
 * The real booking path writes the pass, so the numbers, the inventory and the
 * money are the product's own arithmetic rather than a second copy of it. Gate
 * entries are written directly: the checkpost path messages the visitor, and
 * this must never message anybody.
 */

const crypto = require('crypto');
const { query, one } = require('../gatepass/db');
const settings = require('../gatepass/settings');
const slotTime = require('../gatepass/slotTime');
const booking = require('../gatepass/booking');
const inventory = require('../gatepass/inventory');

const TICK_SECONDS = 20;

/* How much happens in a minute, by rate. Entries are bounded by who has
   actually booked and not yet arrived, so these are appetites, not promises. */
const RATES = {
  quiet: { label: 'Quiet', bookingsPerHour: 12, entriesPerHour: 30, blurb: 'A weekday morning' },
  steady: { label: 'Steady', bookingsPerHour: 40, entriesPerHour: 90, blurb: 'An ordinary Saturday' },
  busy: { label: 'Busy', bookingsPerHour: 110, entriesPerHour: 240, blurb: 'A long weekend' },
};

const n = (v) => Number(v || 0);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const chance = (p) => Math.random() < p;
const int = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

/* What this process has generated since it started, for the screen. */
const made = { bookings: 0, entries: 0, refusals: 0, messages: 0, ticks: 0, lastTickAt: null, lastError: null };

let timer = null;
let running = false;

/**
 * May this server simulate at all? A production server may not, unless somebody
 * has deliberately said otherwise in the environment.
 */
function allowed() {
  if (String(process.env.ALLOW_SIMULATION || '').toLowerCase() === 'true') return true;
  return String(process.env.NODE_ENV || '').toLowerCase() !== 'production';
}

async function config() {
  const [enabled, rate, until, startedAt] = await Promise.all([
    settings.str('simulation_enabled', 'false'),
    settings.str('simulation_rate', 'steady'),
    settings.str('simulation_until', ''),
    settings.str('simulation_started_at', ''),
  ]);
  const expiry = until ? new Date(until) : null;
  const expired = Boolean(expiry && expiry.getTime() <= Date.now());
  return {
    enabled: String(enabled) === 'true' && !expired,
    requested: String(enabled) === 'true',
    rate: RATES[rate] ? rate : 'steady',
    until: expiry && !Number.isNaN(expiry.getTime()) ? expiry.toISOString() : null,
    startedAt: startedAt || null,
    expired,
  };
}

async function put(key, value) {
  await query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, modified_at = now()`, [key, String(value)]);
  settings.clear();
}

/** Switch it on or off. Returns what changed, for the audit row. */
async function set({ enabled, rate = null, hours = null }) {
  const before = await config();
  if (enabled && !allowed()) {
    const e = new Error('This server does not allow demonstration mode. It is a production server; set ALLOW_SIMULATION=true only if you really mean it.');
    e.status = 409;
    e.code = 'not_allowed_here';
    throw e;
  }
  if (rate && !RATES[rate]) {
    const e = new Error('Choose how busy it should be: quiet, steady or busy.');
    e.status = 400;
    e.code = 'invalid';
    throw e;
  }

  const span = Math.max(1, Math.min(24, Number(hours) || 4));
  if (enabled) {
    await put('simulation_until', new Date(Date.now() + span * 3600 * 1000).toISOString());
    await put('simulation_started_at', new Date().toISOString());
    if (rate) await put('simulation_rate', rate);
    await put('simulation_enabled', 'true');
  } else {
    await put('simulation_enabled', 'false');
    await put('simulation_until', '');
  }

  const after = await config();
  return {
    before: { enabled: before.enabled, rate: before.rate, until: before.until },
    after: { enabled: after.enabled, rate: after.rate, until: after.until },
    config: after,
  };
}

/* ────────────────────────────────────────────────────── what it writes ── */

/**
 * A vehicle from the test fleet with no pass for this date, classified by the
 * product's own rules — the same decision a real booking would reach, so the
 * price and the capacity it consumes are the ones it would really consume.
 */
async function freeVehicle(travelDate) {
  const eligibility = require('../gatepass/eligibility');
  const v = await one(
    `SELECT v.* FROM vehicles v
      WHERE v.is_test AND v.rc_fetched_at IS NOT NULL AND v.vehicle_class IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.vehicle_id = v.id AND t.travel_date = $1::date
                          AND t.status IN ('held','paid','used'))
      ORDER BY random() LIMIT 1`, [travelDate]);
  if (!v) return null;
  const verdict = await eligibility.decide(v);
  if (!verdict.allowed || verdict.unclassified || !verdict.categoryId) return null;
  return { id: v.id, reg_no: v.reg_no, category_id: verdict.categoryId };
}

const testVisitor = () => one(
  `SELECT id, mobile, name, language FROM customers
    WHERE is_test AND mobile LIKE '000%' ORDER BY random() LIMIT 1`);

/**
 * One booking, through the product's own path: the place is claimed, the pass
 * number comes from the daily sequence, the money is the tariff. The payment is
 * written as already made — a simulated visitor does not open Razorpay.
 */
async function makeBooking(place, slots) {
  const today = slotTime.nowIST().date;
  const now = slotTime.nowIST().minutes;

  /* Today if a slot can still be entered, otherwise the days ahead. */
  const open = slots.filter((s) => slotTime.check(s, today).bookable);
  const [date, slot] = open.length && chance(0.65)
    ? [today, pick(open)]
    : [(() => { const [y, m, d] = today.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + int(1, 6))).toISOString().slice(0, 10); })(), pick(slots)];

  const vehicle = await freeVehicle(date);
  const customer = await testVisitor();
  if (!vehicle || !customer) return null;

  const held = await booking.hold({
    customer, vehicle: { id: vehicle.id, reg_no: vehicle.reg_no }, place, slot,
    categoryId: vehicle.category_id, travelDate: date,
  });
  if (!held.ok) return null;

  const amount = n(held.ticket.total_paise);
  const payment = await one(
    `INSERT INTO payments (customer_id, amount_paise, entry_paise, platform_paise, gst_paise, status, gateway,
                           order_id, payment_id, created_at, paid_at, raw, is_test)
     VALUES ($1,$2,$3,$4,$5,'paid','razorpay',$6,$7, now(), now(), $8, true) RETURNING id`,
    [customer.id, amount, held.ticket.entry_paise, held.ticket.platform_paise, held.ticket.gst_paise,
      `order_SIM${crypto.randomBytes(6).toString('hex')}`, `pay_SIM${crypto.randomBytes(6).toString('hex')}`,
      JSON.stringify({ gateway: { fee: Math.round(amount * 0.02), tax: Math.round(amount * 0.0036), method: pick(['upi', 'upi', 'card', 'netbanking']), simulated: true } })]);

  const paid = await booking.markPaid(held.ticket.id, payment.id);
  if (!paid.ok) return null;

  /* Flagged the moment it exists: nothing the simulation writes may look real. */
  await query('UPDATE tickets SET is_test = true WHERE id = $1', [held.ticket.id]);
  await query(`UPDATE payments SET raw = raw || jsonb_build_object('ticket_id', $2::bigint) WHERE id = $1`, [payment.id, held.ticket.id]);

  /* The invoice, from the test series — the real series is for real sales. */
  await issueTestInvoice(held.ticket.id, customer.id, held.ticket);

  return { ticketNo: held.ticket.ticket_no, regNo: vehicle.reg_no, date, customer };
}

async function issueTestInvoice(ticketId, customerId, t) {
  const gst = await settings.num('gst_percent_on_platform', 18);
  const fy = require('../gatepass/invoices').financialYear();
  const [seq] = (await query(
    `SELECT count(*) + 1 AS n FROM invoices WHERE is_test AND invoice_no LIKE 'TST/' || $1 || '/%'`, [fy])).rows;
  const taxable = Math.round((n(t.platform_paise) * 100) / (100 + gst));
  await query(
    `INSERT INTO invoices (invoice_no, ticket_id, customer_id, entry_paise, service_paise, taxable_paise,
                           gst_paise, total_paise, gst_percent, place_of_supply, sac_code, is_test)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true) ON CONFLICT DO NOTHING`,
    [`TST/${fy}/${String(n(seq.n)).padStart(6, '0')}`, ticketId, customerId, t.entry_paise, t.platform_paise,
      taxable, n(t.platform_paise) - taxable, t.total_paise, gst,
      await settings.str('place_of_supply', '29-Karnataka'), await settings.str('sac_code', '998559')]);
}

/**
 * A vehicle arriving at the gate.
 *
 * Written directly rather than through the checkpost path, because that path
 * messages the visitor on WhatsApp and this must never message anybody.
 */
async function makeEntry(checkpost, staffList) {
  const today = slotTime.nowIST().date;
  const now = slotTime.nowIST().minutes;

  const t = await one(
    `SELECT t.id, t.ticket_no, t.reg_no, s.starts_at, s.ends_at
       FROM tickets t JOIN place_slots s ON s.id = t.slot_id
      WHERE t.travel_date = $1::date AND t.status = 'paid' AND t.is_test
        AND $2::time BETWEEN s.starts_at AND s.ends_at
      ORDER BY random() LIMIT 1`, [today, slotTime.hhmm(now)]);
  if (!t) return null;

  const override = chance(0.04);
  await query(
    `INSERT INTO scans (ticket_id, ticket_no, reg_no, checkpost_id, staff_id, verdict, raw_payload, duration_ms, is_test)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)`,
    [t.id, t.ticket_no, t.reg_no, checkpost?.id || null, staffList.length ? pick(staffList).id : null,
      override ? 'valid_override' : 'valid', JSON.stringify({ simulated: true }), int(4000, 14000)]);
  await query("UPDATE tickets SET status = 'used', used_at = now(), modified_at = now() WHERE id = $1", [t.id]);
  return { ticketNo: t.ticket_no, regNo: t.reg_no, override };
}

/** Somebody presenting a pass that will not work. */
async function makeRefusal(checkpost, staffList) {
  const today = slotTime.nowIST().date;
  const kind = pick(['already_used', 'already_used', 'unknown_ticket', 'wrong_day']);
  const staffId = staffList.length ? pick(staffList).id : null;

  if (kind === 'unknown_ticket') {
    await query(
      `INSERT INTO scans (reg_no, checkpost_id, staff_id, verdict, raw_payload, duration_ms, is_test)
       VALUES ($1,$2,$3,'unknown_ticket',$4,$5,true)`,
      [`KA${int(1, 53).toString().padStart(2, '0')}ZZ${String(int(1, 9999)).padStart(4, '0')}`,
        checkpost?.id || null, staffId, JSON.stringify({ simulated: true }), int(4000, 12000)]);
    return { kind };
  }

  const t = await one(
    `SELECT t.id, t.ticket_no, t.reg_no FROM tickets t
      WHERE t.is_test AND t.status = ${kind === 'already_used' ? "'used' AND t.travel_date = $1::date" : "'paid' AND t.travel_date > $1::date"}
      ORDER BY random() LIMIT 1`, [today]);
  if (!t) return null;
  await query(
    `INSERT INTO scans (ticket_id, ticket_no, reg_no, checkpost_id, staff_id, verdict, raw_payload, duration_ms, is_test)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)`,
    [t.id, t.ticket_no, t.reg_no, checkpost?.id || null, staffId, kind, JSON.stringify({ simulated: true }), int(3000, 9000)]);
  return { kind, ticketNo: t.ticket_no };
}

/** A line of conversation, written as history. Nothing is sent. */
async function makeMessage(bookingMade) {
  if (!bookingMade) return null;
  const kn = bookingMade.customer.language === 'kn';
  const m = bookingMade.customer.mobile;
  const say = (direction, type, body, payload) => query(
    `INSERT INTO wa_messages (mobile, direction, message_type, body, payload, wa_message_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6, now())`,
    [m, direction, type, body, JSON.stringify(payload), `wamid.SIM${crypto.randomBytes(8).toString('hex')}`]);

  await say('in', 'text', bookingMade.regNo, { text: { body: bookingMade.regNo } });
  const confirmation = `✅ ${kn ? 'ಪಾವತಿ ಯಶಸ್ವಿ' : 'Payment successful'} — ${bookingMade.ticketNo}`;
  await say('out', 'text', confirmation, { type: 'text', text: { body: confirmation } });
  return true;
}

/* ─────────────────────────────────────────────────────────────── tick ── */

async function tick() {
  const cfg = await config();

  if (cfg.expired && cfg.requested) {
    await put('simulation_enabled', 'false');
    console.log('[simulation] stopped: it reached the time it was set to stop');
    return;
  }
  if (!cfg.enabled || !allowed()) return;

  const place = await one(`SELECT * FROM places WHERE is_active ORDER BY id LIMIT 1`);
  if (!place) return;
  const slots = (await query('SELECT * FROM place_slots WHERE place_id = $1 AND is_active ORDER BY starts_at', [place.id])).rows;
  const checkpost = await one('SELECT * FROM checkposts WHERE place_id = $1 AND is_active ORDER BY id LIMIT 1', [place.id]);
  const staffList = (await query('SELECT id FROM staff WHERE is_active')).rows;

  const rate = RATES[cfg.rate];
  const share = TICK_SECONDS / 3600;
  /* Gate activity only while a slot can be entered; bookings happen all day. */
  const now = slotTime.nowIST().minutes;
  const today = slotTime.nowIST().date;
  const gateOpen = slots.some((s) => now >= slotTime.toMinutes(s.starts_at) && now <= slotTime.toMinutes(s.ends_at));

  const draw = (perHour) => {
    const expected = perHour * share;
    return Math.floor(expected) + (chance(expected % 1) ? 1 : 0);
  };

  try {
    for (let i = 0; i < draw(rate.bookingsPerHour); i += 1) {
      /* A draw can come up empty — the vehicle already has a pass for that day,
         or the slot sold out. Try a couple more times before giving up, or a
         nearly full day would quietly halve the rate that was asked for. */
      let b = null;
      for (let attempt = 0; attempt < 3 && !b; attempt += 1) b = await makeBooking(place, slots);
      if (!b) continue;
      made.bookings += 1;
      if (chance(0.35) && await makeMessage(b)) made.messages += 2;
    }

    if (gateOpen) {
      for (let i = 0; i < draw(rate.entriesPerHour); i += 1) {
        if (await makeEntry(checkpost, staffList)) made.entries += 1;
      }
      if (chance(0.25) && await makeRefusal(checkpost, staffList)) made.refusals += 1;
    }

    made.ticks += 1;
    made.lastTickAt = new Date().toISOString();
    made.lastError = null;
  } catch (e) {
    made.lastError = e.message;
    console.error('[simulation] tick failed: %s', e.message);
  }
}

/** Start the ticker. Cheap while switched off: one cached settings read. */
function start() {
  if (timer) return;
  timer = setInterval(() => { if (!running) { running = true; tick().finally(() => { running = false; }); } }, TICK_SECONDS * 1000);
  timer.unref?.();
  if (!allowed()) console.log('[simulation] not available on this server (production)');
}

function stopTicker() { if (timer) { clearInterval(timer); timer = null; } }

async function status() {
  const cfg = await config();
  const today = slotTime.nowIST().date;
  const [counts] = (await query(
    `SELECT (SELECT count(*) FROM tickets t WHERE t.is_test AND t.created_at > now() - interval '1 hour') AS bookings_hour,
            (SELECT count(*) FROM scans s WHERE s.is_test AND s.scanned_at > now() - interval '1 hour') AS checks_hour,
            (SELECT count(*) FROM tickets t WHERE t.travel_date = $1::date AND t.status IN ('paid','used')) AS booked_today,
            (SELECT count(*) FROM tickets t WHERE t.travel_date = $1::date AND t.status = 'paid') AS yet_to_arrive`, [today])).rows;

  return {
    available: allowed(),
    ...cfg,
    rates: Object.entries(RATES).map(([key, r]) => ({ key, label: r.label, blurb: r.blurb, bookingsPerHour: r.bookingsPerHour, entriesPerHour: r.entriesPerHour })),
    tickSeconds: TICK_SECONDS,
    sinceRestart: { ...made },
    lastHour: { bookings: n(counts.bookings_hour), checks: n(counts.checks_hour) },
    today: { booked: n(counts.booked_today), yetToArrive: n(counts.yet_to_arrive) },
    note: 'Everything it writes is test data: reserved 000 numbers, cached test vehicles, no message sent and no vehicle looked up.',
  };
}

module.exports = { start, stopTicker, status, set, config, allowed, RATES, TICK_SECONDS };
