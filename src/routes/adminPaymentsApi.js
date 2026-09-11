/**
 * adminPaymentsApi.js — Payments & Settlements.
 *
 * Reading needs finance access. Recording a remittance to the Tourism
 * Department needs finance.remit and leaves an audit row; nothing here changes
 * a payment itself — refunds happen in Razorpay and settlements come from its
 * report.
 */

const express = require('express');
const { auth, needs } = require('./adminApi');
const admin = require('../gatepass/admin');
const finance = require('../gatepass/adminFinance');
const payments = require('../gatepass/adminPayments');

const router = express.Router();
const P = '/admin/api/payments';
const ipOf = (req) => (req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim();

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e instanceof payments.Refusal) return res.status(e.status).json({ error: e.code, message: e.message });
    console.error('[paymentsApi] %s %s: %s', req.method, req.path, e.stack || e.message);
    res.status(500).json({ error: 'server_error', message: 'Something went wrong. Nothing was changed.' });
  }
};

const periodOf = (q) => finance.periodFor({ preset: q.preset, from: q.from, to: q.to });

router.get(`${P}/overview`, auth, needs('finance.view'), handle(async (req, res) => {
  res.set('Cache-Control', 'no-store').json({ ok: true, ...(await payments.overview(periodOf(req.query))) });
}));

router.get(`${P}/list`, auth, needs('finance.view'), handle(async (req, res) => {
  const period = req.query.allDates === '1' ? {} : periodOf(req.query);
  res.set('Cache-Control', 'no-store').json({ ok: true, ...(await payments.list({
    q: req.query.q, state: req.query.state, from: period.from, to: period.to, limit: req.query.limit, offset: req.query.offset,
  })) });
}));

router.get(`${P}/remittances`, auth, needs('finance.view'), handle(async (req, res) => {
  res.set('Cache-Control', 'no-store').json({ ok: true, ...(await payments.remittances()) });
}));

router.get(`${P}/remittances/due`, auth, needs('finance.view'), handle(async (req, res) => {
  const ok = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
  if (!ok(req.query.from) || !ok(req.query.to)) return res.status(400).json({ error: 'invalid', message: 'Choose the dates.' });
  res.json({ ok: true, ...(await payments.remittanceDue(req.query.from, req.query.to)) });
}));

router.post(`${P}/remittances`, auth, needs('finance.remit'), handle(async (req, res) => {
  const { audit, reason, ...rest } = await payments.addRemittance({ body: req.body || {}, adminId: req.admin.admin_id });
  await admin.audit({ adminId: req.admin.admin_id, action: 'remittance_recorded', subject: audit.subject, before: audit.before,
    after: audit.after, reason, ip: ipOf(req), sessionId: req.admin.session_id });
  res.json({ ok: true, ...rest });
}));

/* Last, so /overview and /list are not taken for an id. */
router.get(`${P}/:id`, auth, needs('finance.view'), handle(async (req, res) => {
  const found = await payments.detail(req.params.id);
  if (!found) return res.status(404).json({ error: 'not_found', message: 'No such payment.' });
  res.set('Cache-Control', 'no-store').json({ ok: true, ...found });
}));

module.exports = router;
