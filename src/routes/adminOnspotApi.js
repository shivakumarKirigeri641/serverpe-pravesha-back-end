/**
 * adminOnspotApi.js — passes sold at a barrier.
 *
 * Needs onspot.view, which the roles that run a gate or count the money have.
 * Every figure here is money, so there is no redaction to do: a role that may
 * not see money has no business on this screen at all, and is refused the whole
 * of it rather than shown a version with the numbers cut out.
 */

const express = require('express');
const { auth, needs } = require('./adminApi');
const onspot = require('../gatepass/adminOnspot');

const router = express.Router();
const P = '/admin/api/onspot';

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    console.error('[onspotApi] %s %s: %s', req.method, req.path, e.stack || e.message);
    res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
  }
};

const dates = (req) => ({
  from: /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || '')) ? req.query.from : null,
  to: /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || '')) ? req.query.to : null,
});

router.get(`${P}/summary`, auth, needs('onspot.view'), handle(async (req, res) => {
  const period = dates(req);
  const [summary, reconcile] = await Promise.all([
    onspot.summary(period),
    onspot.reconcile(period),
  ]);
  res.set('Cache-Control', 'no-store').json({ ok: true, ...summary, reconcile });
}));

router.get(P, auth, needs('onspot.view'), handle(async (req, res) => {
  const out = await onspot.list({
    ...dates(req),
    method: req.query.method,
    kind: req.query.kind,
    staffId: req.query.staffId,
    q: req.query.q,
    limit: req.query.limit,
    offset: req.query.offset,
  });
  res.set('Cache-Control', 'no-store').json({ ok: true, ...out });
}));

module.exports = router;
