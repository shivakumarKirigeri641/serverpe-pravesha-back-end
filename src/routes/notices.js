/**
 * notices.js — announcements visitors may see.
 *
 * Public and unauthenticated on purpose: the website and the booking pages show
 * "closed for heavy rain" without signing in. Only what an administrator wrote
 * for visitors is here — never who is affected or how many passes are involved.
 */

const express = require('express');
const alerts = require('../gatepass/adminAlerts');

const router = express.Router();

router.get('/public/notices', async (req, res) => {
  try {
    res.set('Cache-Control', 'public, max-age=60').json({ ok: true, notices: await alerts.publicNotices() });
  } catch (e) {
    console.error('[notices] %s', e.message);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
