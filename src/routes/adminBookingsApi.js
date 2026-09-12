/**
 * adminBookingsApi.js — Ticket Management.
 *
 * Searching and opening a pass needs tickets.view. The two things that change
 * anything — cancelling a pass and sending it to the visitor again — need their
 * own permission, a reason, and leave an audit row.
 */

const express = require('express');
const { auth, needs } = require('./adminApi');
const admin = require('../gatepass/admin');
const bookings = require('../gatepass/adminBookings');
const booking = require('../gatepass/booking');
const passPdf = require('../pdf/passPdf');
const deliver = require('../whatsapp/deliver');

const router = express.Router();
const P = '/admin/api/tickets';
const ipOf = (req) => (req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim();

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e instanceof bookings.Refusal) return res.status(e.status).json({ error: e.code, message: e.message });
    console.error('[bookingsApi] %s %s: %s', req.method, req.path, e.stack || e.message);
    res.status(500).json({ error: 'server_error', message: 'Something went wrong. Nothing was changed.' });
  }
};

router.get(`${P}/search`, auth, needs('tickets.view'), handle(async (req, res) => {
  res.set('Cache-Control', 'no-store').json({ ok: true, ...(await bookings.search({
    q: req.query.q, state: req.query.state, from: req.query.from, to: req.query.to,
    placeId: req.query.placeId, limit: req.query.limit, offset: req.query.offset,
  })) });
}));

router.get(`${P}/:id/detail`, auth, needs('tickets.view'), handle(async (req, res) => {
  const found = await bookings.detail(req.params.id);
  if (!found) return res.status(404).json({ error: 'not_found', message: 'No pass with that number.' });
  res.set('Cache-Control', 'no-store').json({ ok: true, ...found });
}));

/*
 * A photograph taken at a barrier — the UPI screen behind a counter payment, or
 * a vehicle that had no number plate.
 *
 * The bytes, with the same permission that opens the pass itself. The panel
 * fetches this with the session token and shows it from a blob, the way it
 * already fetches reports: an <img src> cannot carry an Authorization header,
 * and a token in a URL would sit in browser history and in this server's own
 * logs for as long as they are kept.
 */
router.get('/admin/api/photo/:id', auth, needs('tickets.view'), handle(async (req, res) => {
  const row = await require('../gatepass/photos').bytesOf(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found', message: 'No such photograph.' });
  res.set('Content-Type', row.mime).set('Cache-Control', 'private, max-age=3600').send(row.bytes);
}));

/* The pass itself, exactly as the visitor received it. */
router.get(`${P}/:id/pass.pdf`, auth, needs('tickets.view'), handle(async (req, res) => {
  const t = await booking.byId(req.params.id);
  if (!t) return res.status(404).json({ error: 'not_found', message: 'No such pass.' });
  const pdf = await passPdf.render(t, { settings: await deliver.docSettings(), verifyUrl: deliver.verifyUrl(t), lang: 'en' });
  await admin.audit({ adminId: req.admin.admin_id, action: 'pass_opened', subject: `ticket:${t.ticket_no}`, ip: ipOf(req), sessionId: req.admin.session_id });
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `${req.query.inline === '1' ? 'inline' : 'attachment'}; filename="${passPdf.filename(t)}"`,
    'Content-Length': pdf.length,
    'Cache-Control': 'no-store',
    'Access-Control-Expose-Headers': 'Content-Disposition',
  });
  res.send(pdf);
}));

router.post(`${P}/:id/cancel`, auth, needs('tickets.cancel'), handle(async (req, res) => {
  const { audit, reason, ...rest } = await bookings.cancel({ id: req.params.id, reason: req.body?.reason, adminId: req.admin.admin_id });
  await admin.audit({ adminId: req.admin.admin_id, action: 'ticket_cancelled', subject: audit.subject, before: audit.before,
    after: audit.after, reason, ip: ipOf(req), sessionId: req.admin.session_id });
  res.json({ ok: true, ...rest });
}));

/*
 * Send the pass to the visitor again. The message goes to the number on the
 * pass and nowhere else, and whatsapp/send.js refuses test numbers outright.
 */
router.post(`${P}/:id/resend`, auth, needs('tickets.resend'), handle(async (req, res) => {
  const t = await booking.byId(req.params.id);
  if (!t) return res.status(404).json({ error: 'not_found', message: 'No such pass.' });
  if (t.status !== 'paid' && t.status !== 'used') {
    return res.status(409).json({ error: 'not_issued', message: 'Only a paid pass can be sent again.' });
  }
  const out = await deliver.resendPass(t.id);
  await admin.audit({ adminId: req.admin.admin_id, action: 'pass_resent', subject: `ticket:${t.ticket_no}`,
    detail: { ok: out.ok, reason: out.reason || null }, reason: req.body?.reason || null, ip: ipOf(req), sessionId: req.admin.session_id });
  if (!out.ok) {
    return res.status(502).json({ error: 'not_sent', message: 'WhatsApp did not accept the message. Try again in a moment.' });
  }
  if (out.testRecipient || out.dryRun) {
    return res.json({ ok: true, sent: false, sentTo: `••••${String(t.mobile).slice(-4)}`,
      message: out.testRecipient
        ? 'This is a test number, so nothing was actually sent.'
        : 'Sending is switched off on this server, so nothing was actually sent.' });
  }
  res.json({ ok: true, sent: true, sentTo: `••••${String(t.mobile).slice(-4)}`, message: 'The pass was sent again on WhatsApp.' });
}));

module.exports = router;
