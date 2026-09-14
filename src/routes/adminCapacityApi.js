/**
 * adminCapacityApi.js — today's capacity and slot closures, from live monitoring.
 *
 * Reading needs live.view: it is what the live screen shows. Changing needs
 * capacity.today. Every change carries a reason and writes an audit row with the
 * numbers before and after — and, for a closure, how many visitors were told and
 * how many could not be reached.
 */

const express = require('express');
const { auth, needs } = require('./adminApi');
const admin = require('../gatepass/admin');
const capacity = require('../gatepass/capacityToday');

const router = express.Router();
const json = express.json({ limit: '32kb' });
const P = '/admin/api/capacity';

const ipOf = (req) => (req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim();

const change = (action, fn) => async (req, res) => {
  try {
    const out = await fn(req);
    const { audit, reason, ...rest } = out;
    await admin.audit({
      adminId: req.admin.admin_id, action,
      subject: audit?.subject || null, before: audit?.before, after: audit?.after,
      reason: reason || null, ip: ipOf(req), sessionId: req.admin.session_id,
    });
    res.json({ ok: true, ...rest });
  } catch (e) {
    if (e instanceof capacity.Refusal) return res.status(e.status).json({ error: e.code, message: e.message });
    console.error('[capacityApi] %s: %s', action, e.stack || e.message);
    res.status(500).json({ error: 'server_error', message: 'Something went wrong. Nothing was changed.' });
  }
};

router.get(`${P}/today`, auth, needs('live.view'), async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store').json({ ok: true, ...(await capacity.today({ placeId: req.query.placeId || null })) });
  } catch (e) {
    console.error('[capacityApi] today: %s', e.stack || e.message);
    res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
  }
});

router.post(`${P}/set`, json, auth, needs('capacity.today'),
  change('capacity_changed_today', (req) => capacity.setCapacity({
    slotId: req.body?.slotId, categoryId: req.body?.categoryId, capacity: req.body?.capacity, reason: req.body?.reason,
  })));

router.post(`${P}/close`, json, auth, needs('capacity.today'),
  change('slot_closed_today', (req) => capacity.closeSlot({
    slotId: req.body?.slotId, reason: req.body?.reason, notify: req.body?.notify === true,
    message: req.body?.message, messageKn: req.body?.messageKn, adminId: req.admin.admin_id,
  })));

router.post(`${P}/reopen`, json, auth, needs('capacity.today'),
  change('slot_reopened_today', (req) => capacity.reopenSlot({
    slotId: req.body?.slotId, reason: req.body?.reason, adminId: req.admin.admin_id,
  })));

module.exports = router;
