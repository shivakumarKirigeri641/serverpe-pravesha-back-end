/**
 * adminOutlookApi.js — how full the coming days already are.
 *
 * Reading only, and it changes nothing: dashboard.view is enough. Money is not
 * in the answer at all, so there is nothing to redact for roles without
 * finance.view.
 */

const express = require('express');
const { auth, needs } = require('./adminApi');
const outlook = require('../gatepass/adminOutlook');

const router = express.Router();

router.get('/admin/api/outlook', auth, needs('dashboard.view'), async (req, res) => {
  try {
    const data = await outlook.outlook({
      placeId: req.query.placeId || null,
      days: req.query.days,
      from: req.query.from || null,
    });
    res.set('Cache-Control', 'no-store').json({ ok: true, ...data });
  } catch (e) {
    console.error('[outlookApi] %s', e.stack || e.message);
    res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
  }
});

module.exports = router;
