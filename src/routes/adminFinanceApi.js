/**
 * adminFinanceApi.js — My GST & Invoices.
 *
 * Reading needs finance access; recording expenses or changing how input tax
 * credit is counted needs finance.expenses, a reason, and leaves an audit row.
 * Every invoice PDF opened or downloaded is audited too: an invoice carries a
 * visitor's name and part of their number.
 */

const express = require('express');
const { auth, needs } = require('./adminApi');
const admin = require('../gatepass/admin');
const finance = require('../gatepass/adminFinance');
const invoicePdf = require('../pdf/invoicePdf');
const { docSettings } = require('../whatsapp/deliver');

const router = express.Router();
const P = '/admin/api/finance';
const ipOf = (req) => (req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim();

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e instanceof finance.Refusal) return res.status(e.status).json({ error: e.code, message: e.message });
    console.error('[financeApi] %s %s: %s', req.method, req.path, e.stack || e.message);
    res.status(500).json({ error: 'server_error', message: 'Something went wrong. Nothing was changed.' });
  }
};

const periodOf = (q) => finance.periodFor({ preset: q.preset, from: q.from, to: q.to });

router.get(`${P}/summary`, auth, needs('finance.view'), handle(async (req, res) => {
  res.set('Cache-Control', 'no-store').json({ ok: true, ...(await finance.summary(periodOf(req.query))) });
}));

/* Since day one. No period: the whole history is the question (user, 2026-09-20). */
router.get(`${P}/lifetime`, auth, needs('finance.view'), handle(async (req, res) => {
  res.set('Cache-Control', 'no-store').json({ ok: true, ...(await finance.lifetime()) });
}));

router.get(`${P}/invoices`, auth, needs('finance.view'), handle(async (req, res) => {
  const period = req.query.preset ? periodOf(req.query) : { from: req.query.from, to: req.query.to };
  res.set('Cache-Control', 'no-store').json({ ok: true, ...(await finance.invoices({
    q: req.query.q, from: period.from, to: period.to, status: req.query.status, limit: req.query.limit, offset: req.query.offset,
  })) });
}));

router.get(`${P}/invoices/:id/pdf`, auth, needs('finance.view'), handle(async (req, res) => {
  const found = await finance.invoice(req.params.id);
  if (!found || !found.t) return res.status(404).json({ error: 'not_found', message: 'No such invoice.' });
  const pdf = await invoicePdf.render(found.t, found.inv, { settings: await docSettings() });
  await admin.audit({ adminId: req.admin.admin_id, action: 'invoice_opened', subject: `invoice:${found.inv.invoice_no}`,
    ip: ipOf(req), sessionId: req.admin.session_id, detail: { ticketNo: found.t.ticket_no } });
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `${req.query.inline === '1' ? 'inline' : 'attachment'}; filename="${invoicePdf.filename(found.inv)}"`,
    'Content-Length': pdf.length,
    'Cache-Control': 'no-store',
    'Access-Control-Expose-Headers': 'Content-Disposition',
  });
  res.send(pdf);
}));

router.get(`${P}/expenses`, auth, needs('finance.view'), handle(async (req, res) => {
  const period = periodOf(req.query);
  res.set('Cache-Control', 'no-store').json({ ok: true, ...(await finance.expenses(period)) });
}));

const change = (action, fn) => handle(async (req, res) => {
  const { audit, reason, ...rest } = await fn(req);
  await admin.audit({ adminId: req.admin.admin_id, action, subject: audit.subject, before: audit.before, after: audit.after,
    reason: reason || req.body?.note || null, ip: ipOf(req), sessionId: req.admin.session_id });
  res.json({ ok: true, ...rest });
});

router.post(`${P}/expenses`, auth, needs('finance.expenses'),
  change('expense_recorded', (req) => finance.addExpense({ body: req.body || {}, adminId: req.admin.admin_id })));
router.delete(`${P}/expenses/:id`, auth, needs('finance.expenses'),
  change('expense_removed', (req) => finance.removeExpense({ id: req.params.id, reason: req.body?.reason, adminId: req.admin.admin_id })));
router.put(`${P}/itc-gateway`, auth, needs('finance.expenses'),
  change('itc_setting_changed', (req) => finance.setGatewayItc({ include: req.body?.include === true, reason: req.body?.reason })));

module.exports = router;
