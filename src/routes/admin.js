/**
 * routes/admin.js — the API behind the admin panel.
 *
 * Mounted at /admin/api, before the response-encryption middleware, because the
 * panel is a separate application talking plain JSON over a bearer token — the
 * same shape as the other ServerPe admin panels.
 *
 * Two rules run through everything here:
 *
 *   WRITES NEED THE 'admin' ROLE. A department viewer can see every rupee and
 *   every vehicle, and change nothing. That separation is the point of having
 *   roles at all.
 *
 *   ANYTHING IRREVERSIBLE IS PREVIEWED FIRST. Closing a day refunds or moves
 *   real people's tickets. The panel asks the server what would happen, shows
 *   it, and only then sends the instruction.
 */

const express = require('express');
const admin = require('../gatepass/admin');
const reports = require('../gatepass/reports');
const closure = require('../gatepass/closure');
const booking = require('../gatepass/booking');
const staffMod = require('../gatepass/staff');
const settings = require('../gatepass/settings');
const inventory = require('../gatepass/inventory');
const deliver = require('../gatepass/deliver');
const periodReport = require('../gatepass/periodReport');
const reportPdf = require('../gatepass/reportPdf');
const analytics = require('../gatepass/analytics');
const ticketCard = require('../gatepass/ticketCard');
const { query, one } = require('../gatepass/db');

const router = express.Router();
router.use(express.json());

const PLACE_CODE = 'MULLAYANAGIRI';

/* ─────────────────────────────────────────────────────────────────── auth */

const bearer = (req) => (req.get('authorization') || '').replace(/^Bearer\s+/i, '') || null;

async function requireAdmin(req, res, next) {
  const s = await admin.sessionFor(bearer(req));
  if (!s) return res.status(401).json({ ok: false, error: 'unauthorized' });
  req.admin = s;
  next();
}

/** Guard for anything that changes the world. */
function requireWrite(req, res, next) {
  if (!admin.canWrite(req.admin.role)) {
    return res.status(403).json({ ok: false, error: 'read_only',
      message: 'Your account can view this data but not change it.' });
  }
  next();
}

const ip = (req) => req.ip || req.socket?.remoteAddress || null;

/** Every route lives under one place today; this is where a second gate hooks in. */
async function place() {
  return booking.placeByCode(PLACE_CODE);
}

/** Dates default to a sensible window rather than erroring on a missing param. */
function window(req, days = 30) {
  const to = req.query.to || new Date().toISOString().slice(0, 10);
  const from = req.query.from
    || new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  return { from, to };
}

/* ───────────────────────────────────────────────────────────── sessions */

router.post('/login', async (req, res) => {
  const { mobile, password } = req.body || {};
  const r = await admin.login({
    mobile: String(mobile || '').replace(/\D/g, '').slice(-10),
    password,
    ip: ip(req),
    userAgent: req.get('user-agent'),
  });

  if (!r.ok) {
    return res.status(401).json({ ok: false, error: r.reason,
      message: r.reason === 'locked'
        ? 'Too many attempts. Please wait 15 minutes.'
        : 'Mobile number or password is incorrect.' });
  }
  res.json(r);
});

router.post('/logout', requireAdmin, async (req, res) => {
  await admin.logout(bearer(req));
  res.json({ ok: true });
});

/**
 * Who is signed in, plus the two things every screen needs to render a heading:
 * what this system is called, and which sites it runs.
 *
 * The panel is not a Mullayanagiri panel. It is an entry-ticketing panel that
 * currently has one site in it, and the wording follows the data rather than
 * being written into the interface.
 */
router.get('/me', requireAdmin, async (req, res) => {
  const places = (await query(
    'SELECT id, code, name, district, is_active FROM places ORDER BY name')).rows;

  res.json({ ok: true,
    admin: {
      id: req.admin.admin_id, name: req.admin.name,
      mobile: req.admin.mobile, role: req.admin.role,
      can_write: admin.canWrite(req.admin.role),
    },
    product: await settings.get('product_name', 'Entry Ticketing'),
    authority: await settings.get('collecting_for', ''),
    places,
  });
});

/* ──────────────────────────────────────────────────────────── dashboard */

router.get('/dashboard', requireAdmin, async (req, res) => {
  const p = await place();
  res.json({ ok: true, place: { id: p.id, name: p.name },
    ...(await reports.dashboard(p.id)) });
});

router.get('/occupancy', requireAdmin, async (req, res) => {
  const p = await place();
  res.json({ ok: true, rows: await reports.occupancyToday(p.id, req.query.date || null) });
});

/* ───────────────────────────────────────────────────────────── bookings */

router.get('/bookings', requireAdmin, async (req, res) => {
  const p = await place();
  const r = await reports.bookings(p.id, {
    from: req.query.from, to: req.query.to,
    status: req.query.status, slotCode: req.query.slot,
    categoryCode: req.query.category, q: req.query.q,
    limit: Math.min(Number(req.query.limit) || 100, 500),
    offset: Number(req.query.offset) || 0,
  });

  // Searching by a customer's number is a look at personal data, and gets
  // recorded as one.
  if (req.query.q) {
    await admin.audit(req.admin.admin_id, 'search_bookings', String(req.query.q), {}, ip(req));
  }

  // A viewer sees the operational data without the personal identifiers.
  const rows = admin.canSeePersonal(req.admin.role) ? r.rows
    : r.rows.map((t) => ({ ...t, mobile: maskMobile(t.mobile) }));

  res.json({ ok: true, ...r, rows });
});

const maskMobile = (m) => (m ? `${String(m).slice(0, 2)}••••${String(m).slice(-3)}` : null);

router.get('/bookings/:ticketNo', requireAdmin, async (req, res) => {
  const t = await booking.byTicketNo(req.params.ticketNo);
  if (!t) return res.status(404).json({ ok: false, error: 'not_found' });

  const scans = (await query(
    `SELECT sc.*, st.name AS staff_name, c.name AS checkpost_name
       FROM scans sc
       LEFT JOIN staff st ON st.id = sc.staff_id
       LEFT JOIN checkposts c ON c.id = sc.checkpost_id
      WHERE sc.ticket_id = $1 ORDER BY sc.scanned_at`, [t.id])).rows;

  await admin.audit(req.admin.admin_id, 'view_ticket', t.ticket_no, {}, ip(req));

  res.json({ ok: true,
    ticket: admin.canSeePersonal(req.admin.role) ? t : { ...t, mobile: maskMobile(t.mobile) },
    scans });
});

/** Send a customer their ticket again — the commonest support request. */
router.post('/bookings/:ticketNo/resend', requireAdmin, requireWrite, async (req, res) => {
  const t = await booking.byTicketNo(req.params.ticketNo);
  if (!t) return res.status(404).json({ ok: false, error: 'not_found' });

  const r = await deliver.sendTicket(t.id, { force: true });
  await admin.audit(req.admin.admin_id, 'resend_ticket', t.ticket_no, r, ip(req));
  res.json({ ok: r.ok, result: r });
});

/* ────────────────────────────────────────────────────────── the gate log */

router.get('/scans', requireAdmin, async (req, res) => {
  const p = await place();
  const { from, to } = window(req, 7);
  res.json({ ok: true, ...(await reports.scans(p.id, {
    from, to,
    verdict: req.query.verdict,
    onlyRefused: req.query.refused === 'true',
    limit: Math.min(Number(req.query.limit) || 100, 500),
    offset: Number(req.query.offset) || 0,
  })) });
});

router.get('/staff-activity', requireAdmin, async (req, res) => {
  const p = await place();
  const { from, to } = window(req, 7);
  res.json({ ok: true, rows: await reports.staffActivity(p.id, { from, to }) });
});

/* ────────────────────────────────────────────────────────────── revenue */

router.get('/revenue', requireAdmin, async (req, res) => {
  const p = await place();
  const { from, to } = window(req, 30);
  const [rev, categories, slots, api] = await Promise.all([
    reports.revenue(p.id, { from, to }),
    reports.categoryMix(p.id, { from, to }),
    reports.slotMix(p.id, { from, to }),
    reports.apiCosts(p.id, { from, to }),
  ]);
  res.json({ ok: true, ...rev, categories, slots, api });
});

/* ────────────────────────────────────────────────────────── staff & devices */

router.get('/staff', requireAdmin, async (req, res) => {
  const rows = (await query(
    `SELECT s.id, s.name, s.mobile, s.is_active, s.failed_attempts, s.locked_until,
            s.created_at,
            COALESCE(json_agg(json_build_object('id', c.id, 'name', c.name))
                     FILTER (WHERE c.id IS NOT NULL), '[]') AS checkposts,
            (SELECT count(*)::int FROM scans sc
              WHERE sc.staff_id = s.id AND sc.scanned_at::date = CURRENT_DATE) AS scans_today,
            (SELECT ss.started_at FROM staff_sessions ss
              WHERE ss.staff_id = s.id AND ss.ended_at IS NULL LIMIT 1) AS on_duty_since
       FROM staff s
       LEFT JOIN staff_checkposts sc2 ON sc2.staff_id = s.id
       LEFT JOIN checkposts c ON c.id = sc2.checkpost_id
      GROUP BY s.id
      ORDER BY s.is_active DESC, s.name`)).rows;
  res.json({ ok: true, rows });
});

router.post('/staff', requireAdmin, requireWrite, async (req, res) => {
  const { name, mobile, checkpost_ids } = req.body || {};
  if (!name) return res.status(400).json({ ok: false, error: 'name_required' });

  const r = await staffMod.create({
    name, mobile: mobile || null, checkpostIds: checkpost_ids || [] });
  await admin.audit(req.admin.admin_id, 'staff_created', name,
    { staff_id: r.staff.id }, ip(req));

  // The PIN is returned exactly once and never stored in readable form. The
  // panel must show it now or it is gone.
  res.json({ ok: true, staff: r.staff, pin: r.pin });
});

router.post('/staff/:id/reset-pin', requireAdmin, requireWrite, async (req, res) => {
  const pin = await staffMod.resetPin(req.params.id);
  await admin.audit(req.admin.admin_id, 'staff_pin_reset', req.params.id, {}, ip(req));
  res.json({ ok: true, pin });
});

router.post('/staff/:id/active', requireAdmin, requireWrite, async (req, res) => {
  const active = !!req.body?.is_active;
  await query('UPDATE staff SET is_active = $2, modified_at = now() WHERE id = $1',
    [req.params.id, active]);
  if (!active) {
    // Deactivating someone must also take the gate away from them now, not at
    // the end of their shift.
    await query(
      `UPDATE staff_sessions SET ended_at = now(), ended_reason = 'deactivated'
        WHERE staff_id = $1 AND ended_at IS NULL`, [req.params.id]);
  }
  await admin.audit(req.admin.admin_id, active ? 'staff_activated' : 'staff_deactivated',
    req.params.id, {}, ip(req));
  res.json({ ok: true });
});

router.get('/devices', requireAdmin, async (req, res) => {
  const rows = (await query(
    `SELECT d.*, c.name AS checkpost_name,
            (SELECT st.name FROM staff_sessions ss JOIN staff st ON st.id = ss.staff_id
              WHERE ss.device_id = d.id AND ss.ended_at IS NULL LIMIT 1) AS in_use_by
       FROM devices d JOIN checkposts c ON c.id = d.checkpost_id
      ORDER BY c.name, d.label`)).rows;

  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  res.json({ ok: true, rows: rows.map((d) => ({
    ...d,
    // The link is the registration. Opening it once on a phone binds that phone
    // to this checkpost.
    setup_url: d.revoked_at ? null : `${base}/scan?device=${d.device_token}`,
  })) });
});

router.post('/devices', requireAdmin, requireWrite, async (req, res) => {
  const { checkpost_id, label, is_primary } = req.body || {};
  const r = await staffMod.registerDevice({
    checkpostId: checkpost_id, label: label || 'Gate phone', isPrimary: !!is_primary });
  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  await admin.audit(req.admin.admin_id, 'device_registered', label, { id: r.device.id }, ip(req));
  res.json({ ok: true, device: r.device, setup_url: `${base}/scan?device=${r.token}` });
});

router.post('/devices/:id/revoke', requireAdmin, requireWrite, async (req, res) => {
  await staffMod.revokeDevice(req.params.id);
  await query(
    `UPDATE staff_sessions SET ended_at = now(), ended_reason = 'device_revoked'
      WHERE device_id = $1 AND ended_at IS NULL`, [req.params.id]);
  await admin.audit(req.admin.admin_id, 'device_revoked', req.params.id, {}, ip(req));
  res.json({ ok: true });
});

router.get('/checkposts', requireAdmin, async (req, res) => {
  const p = await place();
  const rows = (await query(
    'SELECT * FROM checkposts WHERE place_id = $1 ORDER BY name', [p.id])).rows;
  res.json({ ok: true, rows });
});

/* ─────────────────────────────────────────────────── pricing & capacity */

router.get('/config', requireAdmin, async (req, res) => {
  const p = await place();
  const [pricing, capacity, slots, categories, cfg] = await Promise.all([
    query(`SELECT pp.*, vc.code, vc.label FROM place_pricing pp
             JOIN vehicle_categories vc ON vc.id = pp.category_id
            WHERE pp.place_id = $1 AND pp.is_active
            ORDER BY vc.sort_order`, [p.id]),
    query(`SELECT sc.*, s.code AS slot_code, s.label AS slot_label,
                  vc.code AS category_code, vc.label AS category_label
             FROM slot_capacity sc
             JOIN place_slots s ON s.id = sc.slot_id
             JOIN vehicle_categories vc ON vc.id = sc.category_id
            WHERE sc.place_id = $1 ORDER BY s.sort_order, vc.sort_order`, [p.id]),
    query('SELECT * FROM place_slots WHERE place_id = $1 ORDER BY sort_order', [p.id]),
    query('SELECT * FROM vehicle_categories ORDER BY sort_order'),
    settings.all(),
  ]);

  res.json({ ok: true, place: p,
    pricing: pricing.rows, capacity: capacity.rows,
    slots: slots.rows, categories: categories.rows, settings: cfg });
});

/**
 * Change a price.
 *
 * A new row with today's effective_from, rather than an edit of the old one.
 * Every ticket already sold keeps the figures frozen on it, and the history of
 * what was charged when survives — which is exactly what an audit asks for.
 */
router.post('/config/pricing', requireAdmin, requireWrite, async (req, res) => {
  const p = await place();
  const { category_id, entry_paise, platform_paise, effective_from } = req.body || {};
  if (!category_id || entry_paise == null || platform_paise == null) {
    return res.status(400).json({ ok: false, error: 'missing_fields' });
  }

  await query(
    `INSERT INTO place_pricing (place_id, category_id, entry_paise, platform_paise, effective_from)
     VALUES ($1,$2,$3,$4, COALESCE($5::date, CURRENT_DATE))
     ON CONFLICT (place_id, category_id, effective_from)
     DO UPDATE SET entry_paise = EXCLUDED.entry_paise,
                   platform_paise = EXCLUDED.platform_paise, is_active = true`,
    [p.id, category_id, Math.round(entry_paise), Math.round(platform_paise), effective_from || null]);

  await admin.audit(req.admin.admin_id, 'pricing_changed', String(category_id),
    { entry_paise, platform_paise, effective_from }, ip(req));
  res.json({ ok: true });
});

/**
 * Change a capacity.
 *
 * The template changes, and so does every FUTURE date that has not already sold
 * past the new number. Days already open are updated too — but never below what
 * is already booked, because that would mean turning away someone holding a
 * paid ticket.
 */
router.post('/config/capacity', requireAdmin, requireWrite, async (req, res) => {
  const p = await place();
  const { slot_id, category_id, capacity } = req.body || {};
  const cap = Math.max(0, Math.round(Number(capacity)));

  await query(
    `INSERT INTO slot_capacity (place_id, slot_id, category_id, capacity)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (place_id, slot_id, category_id) DO UPDATE SET capacity = EXCLUDED.capacity`,
    [p.id, slot_id, category_id, cap]);

  const touched = await query(
    `UPDATE slot_inventory
        SET capacity = GREATEST($4, booked + held), modified_at = now()
      WHERE place_id = $1 AND slot_id = $2 AND category_id = $3
        AND travel_date >= CURRENT_DATE
      RETURNING travel_date, capacity`,
    [p.id, slot_id, category_id, cap]);

  await admin.audit(req.admin.admin_id, 'capacity_changed',
    `slot ${slot_id} / category ${category_id}`,
    { capacity: cap, dates_updated: touched.rowCount }, ip(req));

  res.json({ ok: true, dates_updated: touched.rowCount,
    note: touched.rows.some((r) => r.capacity > cap)
      ? 'Some days already have more bookings than the new capacity; those keep their current number.'
      : null });
});

router.post('/config/settings', requireAdmin, requireWrite, async (req, res) => {
  const entries = Object.entries(req.body?.settings || {});
  for (const [k, v] of entries) await settings.set(k, v);
  await admin.audit(req.admin.admin_id, 'settings_changed',
    entries.map(([k]) => k).join(','), req.body?.settings || {}, ip(req));
  res.json({ ok: true, changed: entries.length });
});

/* ────────────────────────────────────────────────────────────── closures */

router.get('/closures', requireAdmin, async (req, res) => {
  const rows = (await query(
    `SELECT cl.*, s.label AS slot_label, a.name AS created_by_name
       FROM closures cl
       LEFT JOIN place_slots s ON s.id = cl.slot_id
       LEFT JOIN admin_users a ON a.id = cl.created_by
      ORDER BY cl.travel_date DESC, cl.id DESC LIMIT 50`)).rows;
  res.json({ ok: true, rows });
});

/** What closing this date would do — read-only, and always shown before acting. */
router.post('/closures/preview', requireAdmin, async (req, res) => {
  const p = await place();
  const { travel_date, slot_ids } = req.body || {};
  if (!travel_date) return res.status(400).json({ ok: false, error: 'date_required' });

  res.json({ ok: true, ...(await closure.preview({
    placeId: p.id, travelDate: travel_date,
    slotIds: slot_ids && slot_ids.length ? slot_ids : null })) });
});

router.post('/closures', requireAdmin, requireWrite, async (req, res) => {
  const p = await place();
  const { travel_date, slot_ids, reason, kind } = req.body || {};
  if (!travel_date || !reason) {
    return res.status(400).json({ ok: false, error: 'date_and_reason_required' });
  }

  const r = await closure.close({
    placeId: p.id, travelDate: travel_date,
    slotIds: slot_ids && slot_ids.length ? slot_ids : null,
    reason, kind: kind || 'other', adminId: req.admin.admin_id });

  await admin.audit(req.admin.admin_id, 'closure_created', travel_date,
    { reason, slot_ids, tickets: r.tickets.length }, ip(req));

  // Telling the customers is a separate, resumable step: a WhatsApp API that is
  // slow must not make the closure itself look like it failed.
  res.json({ ok: true, closure: r.closure, tickets_affected: r.tickets.length });
});

router.post('/closures/:id/lift', requireAdmin, requireWrite, async (req, res) => {
  const done = await closure.lift({ closureId: req.params.id, adminId: req.admin.admin_id });
  await admin.audit(req.admin.admin_id, 'closure_lifted', req.params.id, {}, ip(req));
  res.json({ ok: !!done });
});

/** Refund one ticket by hand — the exception path, always attributed. */
router.post('/bookings/:ticketNo/refund', requireAdmin, requireWrite, async (req, res) => {
  const t = await booking.byTicketNo(req.params.ticketNo);
  if (!t) return res.status(404).json({ ok: false, error: 'not_found' });

  const r = await closure.refund(t.id, {
    reason: req.body?.reason || 'admin_refund', adminId: req.admin.admin_id });
  await admin.audit(req.admin.admin_id, 'refund', t.ticket_no,
    { reason: req.body?.reason, result: r }, ip(req));
  res.json(r);
});

/* ──────────────────────────────────────────────────────────────── audit */

router.get('/audit', requireAdmin, async (req, res) => {
  const rows = (await query(
    `SELECT aa.*, a.name AS admin_name
       FROM admin_audit aa
       LEFT JOIN admin_users a ON a.id = aa.admin_id
      ORDER BY aa.created_at DESC LIMIT 200`)).rows;
  res.json({ ok: true, rows });
});

/* ───────────────────────────────────────────────── customers' own words */

router.get('/messages', requireAdmin, async (req, res) => {
  const kind = req.query.kind === 'feedback' ? 'feedback' : 'support_request';
  const rows = (await query(
    `SELECT e.id, e.kind, e.detail, e.created_at,
            c.mobile, c.wa_profile_name
       FROM event_log e
       LEFT JOIN customers c ON c.id = e.customer_id
      WHERE e.kind = $1
      ORDER BY e.created_at DESC LIMIT 100`, [kind])).rows;
  res.json({ ok: true, rows: admin.canSeePersonal(req.admin.role) ? rows
    : rows.map((r) => ({ ...r, mobile: maskMobile(r.mobile) })) });
});

/* ═════════════════════════════════════════════════════ the ticket board */

router.get('/tickets', requireAdmin, async (req, res) => {
  const p = await place();
  const r = await analytics.ticketBoard(p.id, {
    state: req.query.state, q: req.query.q,
    limit: Math.min(Number(req.query.limit) || 100, 500),
    offset: Number(req.query.offset) || 0,
  });

  /* Whether the panel may show a live payment link.
     A checkout URL on an admin screen is a payable link to anyone who
     photographs that screen, so it stays behind a setting rather than a
     commented-out block: turning it off is a decision someone makes, not a
     deployment step someone forgets. */
  const showQr = await settings.bool('show_qr_in_admin', true);

  const rows = r.rows.map((t) => ({
    ...t,
    mobile: admin.canSeePersonal(req.admin.role) ? t.mobile : maskMobile(t.mobile),
    checkout_url: showQr && t.checkout_token
      ? `${(process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '')}/pay/${t.checkout_token}`
      : null,
    verdicts: t.verdicts ? t.verdicts.split(',') : [],
  }));

  res.json({ ok: true, counts: r.counts, rows, show_qr: showQr });
});

/**
 * The ticket card, as the customer received it.
 *
 * Kept for support: when somebody rings to say their ticket looks wrong, this
 * is what they are looking at. It is no longer a credential — the card cannot
 * be used to enter anything — so the old worry about rendering a working
 * ticket onto a screen has gone with the QR. The audit line stays, because it
 * still shows a visitor's plate and travel date.
 */
router.get('/tickets/:ticketNo/card.png', requireAdmin, async (req, res) => {
  const t = await booking.byTicketNo(req.params.ticketNo);
  if (!t) return res.status(404).json({ ok: false, error: 'no_ticket' });

  await admin.audit(req.admin.admin_id, 'view_ticket_card', t.ticket_no, {}, ip(req));
  const png = await ticketCard.render(t, await settings.all());
  res.type('image/png').set('Cache-Control', 'no-store').send(png);
});

router.get('/upcoming', requireAdmin, async (req, res) => {
  const p = await place();
  const d = await analytics.upcoming(p.id, Math.min(Number(req.query.days) || 14, 60));
  if (!admin.canSeePersonal(req.admin.role)) {
    d.latest = d.latest.map((x) => ({ ...x, mobile: maskMobile(x.mobile) }));
  }
  res.json({ ok: true, ...d });
});

/* ═══════════════════════════════════════════════════ live monitoring */

/**
 * What is happening right now.
 *
 * Polled by the Live page every few seconds. `since` keeps the payload small:
 * a screen left open all day asks only for what it has not already shown.
 */
router.get('/live', requireAdmin, async (req, res) => {
  const p = await place();
  const d = await analytics.live(p.id, req.query.since);

  if (!admin.canSeePersonal(req.admin.role)) {
    d.bookings = d.bookings.map((b) => ({ ...b, mobile: maskMobile(b.mobile) }));
  }
  res.json({ ok: true, ...d });
});

/* ══════════════════════════════════════════════════════════ analytics */

router.get('/analytics', requireAdmin, async (req, res) => {
  const p = await place();
  const { from, to } = window(req, 30);

  const [summary, daily, byHour, byWeekday, leadTime, repeatVisitors,
         newVsReturning, categories, slots, occupancy, bookingToEntry, operations] =
    await Promise.all([
      analytics.summary(p.id, { from, to }),
      analytics.daily(p.id, { from, to }),
      analytics.byHour(p.id, { from, to }),
      analytics.byWeekday(p.id, { from, to }),
      analytics.leadTime(p.id, { from, to }),
      analytics.repeatVisitors(p.id, { from, to }),
      analytics.newVsReturning(p.id, { from, to }),
      reports.categoryMix(p.id, { from, to }),
      reports.slotMix(p.id, { from, to }),
      analytics.occupancySeries(p.id, { from, to }),
      analytics.bookingToEntry(p.id, { from, to }),
      analytics.operations(p.id, { from, to }),
    ]);

  res.json({ ok: true, from, to, summary, daily, byHour, byWeekday, leadTime,
    repeatVisitors, newVsReturning, categories, slots, occupancy, bookingToEntry, operations });
});

/* ══════════════════════════════════════════ customers and vehicles */

router.get('/customers', requireAdmin, async (req, res) => {
  const p = await place();
  const r = await analytics.customers(p.id, {
    q: req.query.q, sort: req.query.sort,
    limit: Math.min(Number(req.query.limit) || 100, 500),
    offset: Number(req.query.offset) || 0,
  });

  if (req.query.q) {
    await admin.audit(req.admin.admin_id, 'search_customers', String(req.query.q), {}, ip(req));
  }

  const rows = admin.canSeePersonal(req.admin.role) ? r.rows
    : r.rows.map((c) => ({ ...c, mobile: maskMobile(c.mobile), wa_profile_name: null }));

  res.json({ ok: true, ...r, rows });
});

router.get('/customers/:mobile', requireAdmin, async (req, res) => {
  const p = await place();
  const d = await analytics.customerDetail(p.id, req.params.mobile);
  if (!d) return res.status(404).json({ ok: false, error: 'not_found' });

  await admin.audit(req.admin.admin_id, 'view_customer', req.params.mobile, {}, ip(req));
  res.json({ ok: true, ...d });
});

router.get('/vehicles', requireAdmin, async (req, res) => {
  const p = await place();
  res.json({ ok: true, ...(await analytics.vehicles(p.id, {
    q: req.query.q, sort: req.query.sort,
    limit: Math.min(Number(req.query.limit) || 100, 500),
    offset: Number(req.query.offset) || 0,
  })) });
});

router.get('/vehicles/:regNo', requireAdmin, async (req, res) => {
  const p = await place();
  const d = await analytics.vehicleDetail(p.id, String(req.params.regNo).toUpperCase());
  if (!d) return res.status(404).json({ ok: false, error: 'not_found' });

  await admin.audit(req.admin.admin_id, 'view_vehicle', req.params.regNo, {}, ip(req));

  if (!admin.canSeePersonal(req.admin.role)) {
    d.visits = d.visits.map((v) => ({ ...v, mobile: maskMobile(v.mobile) }));
  }
  res.json({ ok: true, ...d });
});

/* ═════════════════════════════════════════════════ staff performance */

router.get('/staff-performance', requireAdmin, async (req, res) => {
  const p = await place();
  const { from, to } = window(req, 30);
  const [rows, shifts] = await Promise.all([
    analytics.staffPerformance(p.id, { from, to }),
    analytics.shifts(p.id, { from, to }),
  ]);
  res.json({ ok: true, from, to, rows, shifts });
});

/* ────────────────────────────────────────────── daily / weekly / monthly */

/**
 * The full period report, in either shape.
 *
 *   GET /report/daily?date=2026-09-14&format=pdf
 *   GET /report/weekly?date=2026-09-14&format=csv
 *   GET /report/monthly?date=2026-09-01&format=pdf
 *
 * `date` is an anchor, not a range: a week is the Monday-to-Sunday week
 * containing it, and a month is the calendar month containing it. That is how a
 * district office reads a week, and asking an officer to work out the Monday
 * themselves is a way of producing wrong reports.
 */
router.get('/report/:period', requireAdmin, async (req, res) => {
  const period = ['daily', 'weekly', 'monthly'].includes(req.params.period)
    ? req.params.period : 'daily';
  const format = req.query.format === 'csv' ? 'csv' : 'pdf';
  const p = await place();

  const data = await periodReport.gather(p.id, period, req.query.date);

  // A viewer sees the operational report without the personal identifiers.
  if (!admin.canSeePersonal(req.admin.role)) {
    data.tickets = data.tickets.map((t) => ({ ...t, mobile: maskMobile(t.mobile) }));
    data.messages = data.messages.map((m) => ({ ...m, mobile: maskMobile(m.mobile) }));
  }

  await admin.audit(req.admin.admin_id, 'report_downloaded', `${period} ${data.from}..${data.to}`,
    { format, tickets: data.tickets.length }, ip(req));

  const base = `${p.code.toLowerCase()}-${period}-${data.from}`;

  if (format === 'csv') {
    res.type('text/csv').set('Content-Disposition', `attachment; filename="${base}.csv"`);
    return res.send(periodReport.toCsv(data));
  }

  const pdf = await reportPdf.render(data);
  res.type('application/pdf')
     .set('Content-Disposition', `attachment; filename="${base}.pdf"`)
     .send(pdf);
});

/** The same figures as JSON, for the panel to show before anyone downloads. */
router.get('/report/:period/summary', requireAdmin, async (req, res) => {
  const period = ['daily', 'weekly', 'monthly'].includes(req.params.period)
    ? req.params.period : 'daily';
  const p = await place();
  const d = await periodReport.gather(p.id, period, req.query.date);

  res.json({ ok: true,
    period, from: d.from, to: d.to, label: d.label,
    totals: d.revenue.totals,
    gate: d.gate,
    counts: {
      tickets: d.tickets.length, scans: d.scans.length,
      refunds: d.refunds.length, closures: d.closures.length,
      messages: d.messages.length,
    },
    days: d.revenue.days,
    categories: d.categories,
    slots: d.slots,
    staff: d.staff,
  });
});

/* ───────────────────────────────────────────────────────────── downloads */

/**
 * A report as CSV.
 *
 * CSV rather than a formatted PDF because the first thing anyone in an office
 * does with a report is open it in Excel and re-total it. Excel is given what
 * it wants directly.
 */
router.get('/export/:what', requireAdmin, async (req, res) => {
  const p = await place();
  const { from, to } = window(req, 30);
  let rows = [];
  let name = req.params.what;

  if (req.params.what === 'bookings') {
    rows = (await reports.bookings(p.id, { from, to, limit: 5000 })).rows.map((t) => ({
      ticket_no: t.ticket_no, date: t.travel_date, slot: t.slot_label,
      vehicle: t.reg_no, type: t.category_label,
      mobile: admin.canSeePersonal(req.admin.role) ? t.mobile : maskMobile(t.mobile),
      entry_rs: t.entry_paise / 100, booking_fee_rs: t.platform_paise / 100,
      gst_rs: t.gst_paise / 100, total_rs: t.total_paise / 100,
      status: t.status, booked_at: t.created_at,
    }));
  } else if (req.params.what === 'scans') {
    rows = (await reports.scans(p.id, { from, to, limit: 5000 })).rows.map((s) => ({
      scanned_at: s.scanned_at, verdict: s.verdict, ticket_no: s.ticket_no,
      vehicle: s.reg_no, staff: s.staff_name, checkpost: s.checkpost_name,
      offline: s.was_offline ? 'yes' : 'no',
    }));
  } else if (req.params.what === 'revenue') {
    rows = (await reports.revenue(p.id, { from, to })).days.map((d) => ({
      date: d.date, tickets: d.tickets,
      collected_rs: d.gross_paise / 100,
      department_entry_rs: d.entry_paise / 100,
      booking_fee_rs: d.platform_paise / 100,
      gst_rs: d.gst_paise / 100,
      gateway_fee_est_rs: d.gateway_fee_paise / 100,
      take_home_est_rs: d.take_home_paise / 100,
    }));
  } else {
    return res.status(404).json({ ok: false, error: 'unknown_report' });
  }

  await admin.audit(req.admin.admin_id, 'export', name, { from, to, rows: rows.length }, ip(req));

  res.type('text/csv').set('Content-Disposition',
    `attachment; filename="mullayanagiri-${name}-${from}-to-${to}.csv"`);
  res.send(toCsv(rows));
});

/** Minimal CSV: quote everything that could contain a comma or a quote. */
function toCsv(rows) {
  if (!rows.length) return 'no data\n';
  const cols = Object.keys(rows[0]);
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
}

module.exports = router;
