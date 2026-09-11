/**
 * adminPlacesApi.js — Destinations and Checkposts.
 *
 * Reading needs destinations.view; anything that changes a destination or a
 * checkpost needs destinations.manage, a reason, and leaves an audit row with
 * the values before and after.
 */

const express = require('express');
const { auth, needs } = require('./adminApi');
const admin = require('../gatepass/admin');
const destinations = require('../gatepass/adminDestinations');
const checkposts = require('../gatepass/adminCheckposts');

const router = express.Router();
const P = '/admin/api';
const ipOf = (req) => (req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim();

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e instanceof destinations.Refusal || e instanceof checkposts.Refusal) {
      return res.status(e.status).json({ error: e.code, message: e.message, detail: e.detail });
    }
    console.error('[placesApi] %s %s: %s', req.method, req.path, e.stack || e.message);
    res.status(500).json({ error: 'server_error', message: 'Something went wrong. Nothing was changed.' });
  }
};

const change = (action, fn) => handle(async (req, res) => {
  const { audit, reason, ...rest } = await fn(req);
  await admin.audit({ adminId: req.admin.admin_id, action, subject: audit.subject, before: audit.before, after: audit.after,
    reason: reason || null, ip: ipOf(req), sessionId: req.admin.session_id });
  res.json({ ok: true, ...rest });
});

/* ── Destinations ──────────────────────────────────────────────────────── */
router.get(`${P}/destinations`, auth, needs('destinations.view'), handle(async (req, res) => {
  res.set('Cache-Control', 'no-store').json({ ok: true, ...(await destinations.list()) });
}));

router.get(`${P}/destinations/images`, auth, needs('destinations.manage'), handle(async (req, res) => {
  res.json({ ok: true, images: await destinations.images() });
}));

router.get(`${P}/destinations/:id`, auth, needs('destinations.view'), handle(async (req, res) => {
  const found = await destinations.detail(req.params.id);
  if (!found) return res.status(404).json({ error: 'not_found', message: 'No such destination.' });
  res.set('Cache-Control', 'no-store').json({ ok: true, ...found });
}));

router.post(`${P}/destinations`, auth, needs('destinations.manage'),
  change('destination_added', (req) => destinations.create({ body: req.body || {}, reason: req.body?.reason, adminId: req.admin.admin_id })));

router.put(`${P}/destinations/:id`, auth, needs('destinations.manage'),
  change('destination_changed', (req) => destinations.update({ id: req.params.id, body: req.body || {}, reason: req.body?.reason, adminId: req.admin.admin_id })));

router.post(`${P}/destinations/:id/active`, auth, needs('destinations.manage'),
  change('destination_status_changed', (req) => destinations.setActive({ id: req.params.id, active: req.body?.active === true, reason: req.body?.reason, adminId: req.admin.admin_id })));

/* ── Checkposts ────────────────────────────────────────────────────────── */
router.get(`${P}/checkposts`, auth, needs('destinations.view'), handle(async (req, res) => {
  res.set('Cache-Control', 'no-store').json({ ok: true, ...(await checkposts.list()) });
}));

router.get(`${P}/checkposts/:id`, auth, needs('destinations.view'), handle(async (req, res) => {
  const found = await checkposts.detail(req.params.id);
  if (!found) return res.status(404).json({ error: 'not_found', message: 'No such checkpost.' });
  res.set('Cache-Control', 'no-store').json({ ok: true, ...found });
}));

router.post(`${P}/checkposts`, auth, needs('destinations.manage'),
  change('checkpost_added', (req) => checkposts.create({ body: req.body || {}, reason: req.body?.reason, adminId: req.admin.admin_id })));

router.put(`${P}/checkposts/:id`, auth, needs('destinations.manage'),
  change('checkpost_changed', (req) => checkposts.update({ id: req.params.id, body: req.body || {}, reason: req.body?.reason })));

router.post(`${P}/checkposts/:id/active`, auth, needs('destinations.manage'),
  change('checkpost_status_changed', (req) => checkposts.setActive({ id: req.params.id, active: req.body?.active === true, reason: req.body?.reason, adminId: req.admin.admin_id })));

module.exports = router;
