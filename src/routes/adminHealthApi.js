/**
 * adminHealthApi.js — System Health.
 *
 * Read-only, and it calls nobody: everything is measured from our own records
 * plus one live query to the database. Configuration is reported as set or not
 * set; no secret is ever read into a response.
 */

const express = require('express');
const { auth, needs } = require('./adminApi');
const healthCheck = require('../gatepass/adminHealth');

const router = express.Router();

router.get('/admin/api/health', auth, needs('health.view'), async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store').json({ ok: true, ...(await healthCheck.health()) });
  } catch (e) {
    console.error('[healthApi] %s', e.stack || e.message);
    res.status(500).json({ error: 'server_error', message: 'The health check itself failed.' });
  }
});

module.exports = router;
