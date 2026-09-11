/**
 * adminSettingsApi.js — settings, access, free and on-spot passes, and the audit log.
 *
 * Every route that changes something:
 *
 *   * is guarded by the capability for that kind of change, not by a role name,
 *     so moving a permission between roles is a one-line change in
 *     permissions.js;
 *   * requires a reason, and refuses without one;
 *   * writes an audit row with who, what, when, the value before, the value
 *     after, the reason, the IP address and the session.
 *
 * A PIN or a password generated here is returned once in the response and never
 * written to the audit log: the log records that it was reset, not what to.
 */

const express = require('express');
const { auth, needs } = require('./adminApi');
const admin = require('../gatepass/admin');
const settingsAdmin = require('../gatepass/adminSettings');
const tickets = require('../gatepass/adminTickets');
const permissions = require('../gatepass/permissions');

const router = express.Router();
const json = express.json({ limit: '64kb' });
const P = '/admin/api';

const ipOf = (req) => (req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim();

/** Run a change, answer with its result, and audit it — or explain the refusal. */
const change = (action, fn) => async (req, res) => {
  try {
    const out = await fn(req);
    const { audit, reason, ...rest } = out;
    await admin.audit({
      adminId: req.admin.admin_id,
      action,
      subject: audit?.subject || null,
      before: audit?.before,
      after: audit?.after,
      reason: audit?.reason || reason || null,
      ip: ipOf(req),
      sessionId: req.admin.session_id,
    });
    res.json({ ok: true, ...rest });
  } catch (e) {
    if (e instanceof settingsAdmin.Refusal || e instanceof tickets.Refusal) {
      return res.status(e.status).json({ error: e.code, message: e.message, detail: e.detail });
    }
    console.error('[settingsApi] %s: %s', action, e.stack || e.message);
    res.status(500).json({ error: 'server_error', message: 'Something went wrong. Nothing was changed.' });
  }
};

const read = (fn) => async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store').json({ ok: true, ...(await fn(req)) });
  } catch (e) {
    if (e instanceof settingsAdmin.Refusal || e instanceof tickets.Refusal) {
      return res.status(e.status).json({ error: e.code, message: e.message });
    }
    console.error('[settingsApi] read: %s', e.stack || e.message);
    res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
  }
};

/* ── Pricing ───────────────────────────────────────────────────────────── */
router.get(`${P}/settings/pricing`, auth, needs('settings.pricing'), read((req) => settingsAdmin.pricing({ placeId: req.query.placeId })));
router.put(`${P}/settings/pricing`, json, auth, needs('settings.pricing'),
  change('pricing_changed', (req) => settingsAdmin.updatePricing({ ...req.body })));

/* ── Slots ─────────────────────────────────────────────────────────────── */
router.get(`${P}/settings/slots`, auth, needs('settings.slots'), read((req) => settingsAdmin.slots({ placeId: req.query.placeId })));
router.post(`${P}/settings/slots`, json, auth, needs('settings.slots'),
  change('slot_created', (req) => settingsAdmin.createSlot({ placeId: req.body.placeId, body: req.body, reason: req.body.reason })));
router.put(`${P}/settings/slots/:id`, json, auth, needs('settings.slots'),
  change('slot_updated', (req) => settingsAdmin.updateSlot({ slotId: req.params.id, body: req.body, reason: req.body.reason })));
router.delete(`${P}/settings/slots/:id`, json, auth, needs('settings.slots'),
  change('slot_deleted', (req) => settingsAdmin.deleteSlot({ slotId: req.params.id, reason: req.body?.reason || req.query.reason })));

/* ── Checkpost staff ───────────────────────────────────────────────────── */
router.get(`${P}/settings/staff`, auth, needs('settings.staff'), read(() => settingsAdmin.staffList()));
router.get(`${P}/settings/staff/:id/activity`, auth, needs('settings.staff'), read((req) => settingsAdmin.staffActivity(req.params.id)));
router.post(`${P}/settings/staff`, json, auth, needs('settings.staff'),
  change('staff_added', (req) => settingsAdmin.addStaff({ body: req.body, reason: req.body.reason })));
router.put(`${P}/settings/staff/:id`, json, auth, needs('settings.staff'),
  change('staff_updated', (req) => settingsAdmin.updateStaff({ staffId: req.params.id, body: req.body, reason: req.body.reason })));
router.post(`${P}/settings/staff/:id/active`, json, auth, needs('settings.staff'),
  change('staff_access_changed', (req) => settingsAdmin.setStaffActive({ staffId: req.params.id, active: req.body.active === true, reason: req.body.reason })));
router.post(`${P}/settings/staff/:id/reset-pin`, json, auth, needs('settings.staff'),
  change('staff_pin_reset', (req) => settingsAdmin.resetStaffPin({ staffId: req.params.id, reason: req.body.reason })));

/* ── Panel users and roles ─────────────────────────────────────────────── */
router.get(`${P}/settings/users`, auth, needs('settings.users'), read(() => settingsAdmin.users()));
router.post(`${P}/settings/users`, json, auth, needs('settings.users'),
  change('user_added', (req) => settingsAdmin.addUser({ body: req.body, reason: req.body.reason })));
router.put(`${P}/settings/users/:id`, json, auth, needs('settings.users'),
  change('user_updated', (req) => settingsAdmin.updateUser({ userId: req.params.id, body: req.body, reason: req.body.reason, actorId: req.admin.admin_id })));
router.post(`${P}/settings/users/:id/active`, json, auth, needs('settings.users'),
  change('user_access_changed', (req) => settingsAdmin.setUserActive({ userId: req.params.id, active: req.body.active === true, reason: req.body.reason, actorId: req.admin.admin_id })));
router.post(`${P}/settings/users/:id/reset-password`, json, auth, needs('settings.users'),
  change('user_password_reset', (req) => settingsAdmin.resetUserPassword({ userId: req.params.id, reason: req.body.reason })));

/* ── Permissions: readable by anyone signed in, so nobody has to guess ─── */
router.get(`${P}/settings/permissions`, auth, read((req) => ({ ...permissions.matrix(), yourRole: req.admin.role })));

/* ── GST and business: super administrator only ────────────────────────── */
router.get(`${P}/settings/gst`, auth, needs('settings.gst'), read(() => settingsAdmin.gst()));
router.put(`${P}/settings/gst`, json, auth, needs('settings.gst'),
  change('gst_business_changed', (req) => settingsAdmin.updateGst({ body: req.body, reason: req.body.reason })));

/* ── Free and on-spot passes ───────────────────────────────────────────── */
router.get(`${P}/tickets/availability`, auth, (req, res, next) => (
  admin.can(req.admin.role, 'tickets.free') || admin.can(req.admin.role, 'tickets.onspot') ? next()
    : res.status(403).json({ error: 'not_allowed', message: 'Your account does not have permission for that.' })
), read((req) => tickets.availability({ placeId: req.query.placeId, date: req.query.date })));

router.get(`${P}/tickets/grants`, auth, read(async (req) => ({ grants: await tickets.grants({ kind: req.query.kind }) })));

router.post(`${P}/tickets/free`, json, auth, needs('tickets.free'),
  change('free_ticket_issued', (req) => tickets.freeTicket({ body: req.body, adminId: req.admin.admin_id })));
router.post(`${P}/tickets/onspot`, json, auth, needs('tickets.onspot'),
  change('onspot_ticket_issued', (req) => tickets.onspotTicket({ body: req.body, adminId: req.admin.admin_id })));

/* ── Audit log ─────────────────────────────────────────────────────────── */
router.get(`${P}/audit`, auth, needs('audit.view'), read((req) => settingsAdmin.auditLog({
  q: req.query.q, action: req.query.action, adminId: /^\d+$/.test(String(req.query.adminId || '')) ? req.query.adminId : null,
  from: req.query.from, to: req.query.to, before: /^\d+$/.test(String(req.query.before || '')) ? req.query.before : null,
  limit: req.query.limit,
})));

module.exports = router;
