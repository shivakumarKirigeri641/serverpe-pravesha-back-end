/**
 * adminFeedbackApi.js — what visitors said, and what may be quoted.
 *
 * Reading needs feedback.view. Publishing needs feedback.publish, which is a
 * deliberately narrower permission: putting a stranger's words and name on a
 * public marketing page is not the same act as reading them, and the roles that
 * should be able to do the second are not automatically the ones that should be
 * able to do the first.
 *
 * Publishing and taking down both require a reason and both write an audit row.
 * Somebody should be able to answer "who put this on our website, and why"
 * months later without anybody having to remember.
 */

const express = require('express');
const { auth, needs } = require('./adminApi');
const admin = require('../gatepass/admin');
const feedback = require('../gatepass/adminFeedback');

const router = express.Router();
const P = '/admin/api/feedback';
const json = express.json({ limit: '32kb' });
const ipOf = (req) => (req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim();

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e instanceof feedback.Refusal) return res.status(e.status).json({ error: e.code, message: e.message });
    console.error('[feedbackApi] %s %s: %s', req.method, req.path, e.stack || e.message);
    res.status(500).json({ error: 'server_error', message: 'Something went wrong. Nothing was changed.' });
  }
};

router.get(`${P}/overview`, auth, needs('feedback.view'), handle(async (req, res) => {
  res.set('Cache-Control', 'no-store').json({ ok: true, ...(await feedback.overview({ from: req.query.from, to: req.query.to })) });
}));

router.get(P, auth, needs('feedback.view'), handle(async (req, res) => {
  res.set('Cache-Control', 'no-store').json({ ok: true, ...(await feedback.list({
    from: req.query.from, to: req.query.to, rating: req.query.rating,
    state: req.query.state, q: req.query.q, limit: req.query.limit, offset: req.query.offset,
  })) });
}));

router.post(`${P}/:id/publish`, json, auth, needs('feedback.publish'), handle(async (req, res) => {
  const out = await feedback.setPublished({
    id: req.params.id,
    publish: req.body?.publish === true,
    displayName: req.body?.displayName,
    reason: req.body?.reason,
    adminId: req.admin.admin_id,
  });
  await admin.audit({
    adminId: req.admin.admin_id,
    action: req.body?.publish === true ? 'testimonial_published' : 'testimonial_withdrawn',
    subject: out.audit.subject,
    before: out.audit.before,
    after: out.audit.after,
    reason: out.reason,
    ip: ipOf(req),
    sessionId: req.admin.session_id,
  });
  res.json({ ok: true });
}));

module.exports = router;
