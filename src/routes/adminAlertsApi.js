/**
 * adminAlertsApi.js — Notifications: alerts and announcements.
 *
 * Alerts can be read by anyone who may watch the service and acknowledged by
 * those who run it. Announcements — and the closures that come with them —
 * change what visitors can book, so they need their own permission and are
 * audited with the days they shut or reopened.
 */

const express = require('express');
const { auth, needs } = require('./adminApi');
const admin = require('../gatepass/admin');
const alerts = require('../gatepass/adminAlerts');

const router = express.Router();
const P = '/admin/api/alerts';
const ipOf = (req) => (req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim();

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e instanceof alerts.Refusal) return res.status(e.status).json({ error: e.code, message: e.message });
    console.error('[alertsApi] %s %s: %s', req.method, req.path, e.stack || e.message);
    res.status(500).json({ error: 'server_error', message: 'Something went wrong. Nothing was changed.' });
  }
};

const change = (action, fn) => handle(async (req, res) => {
  const { audit, reason, ...rest } = await fn(req);
  await admin.audit({ adminId: req.admin.admin_id, action, subject: audit.subject, before: audit.before, after: audit.after,
    reason: reason || null, ip: ipOf(req), sessionId: req.admin.session_id });
  res.json({ ok: true, ...rest });
});

router.get(P, auth, needs('alerts.view'), handle(async (req, res) => {
  res.set('Cache-Control', 'no-store').json({ ok: true, ...(await alerts.alerts()) });
}));

router.get(`${P}/announcements`, auth, needs('alerts.view'), handle(async (req, res) => {
  res.set('Cache-Control', 'no-store').json({ ok: true, ...(await alerts.announcements()) });
}));

/* What a closure would affect, before anyone commits to it. */
router.get(`${P}/announcements/affected`, auth, needs('announcements.manage'), handle(async (req, res) => {
  const ok = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
  if (!ok(req.query.from) || !ok(req.query.to)) return res.status(400).json({ error: 'invalid', message: 'Choose the dates.' });
  res.json({ ok: true, ...(await alerts.affected(req.query.placeId || null, req.query.from, req.query.to)) });
}));

router.post(`${P}/ack`, auth, needs('alerts.act'),
  change('alert_acknowledged', (req) => alerts.acknowledge({ key: req.body?.key, hours: req.body?.hours, note: req.body?.note, adminId: req.admin.admin_id })));

router.post(`${P}/unack`, auth, needs('alerts.act'),
  change('alert_reopened', (req) => alerts.unacknowledge({ key: req.body?.key })));

router.post(`${P}/announcements`, auth, needs('announcements.manage'),
  change('announcement_published', (req) => alerts.createAnnouncement({ body: req.body || {}, adminId: req.admin.admin_id })));

router.post(`${P}/announcements/:id/end`, auth, needs('announcements.manage'),
  change('announcement_ended', (req) => alerts.endAnnouncement({ id: req.params.id, reason: req.body?.reason, adminId: req.admin.admin_id })));

module.exports = router;
