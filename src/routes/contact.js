/**
 * contact.js — the website's contact form.
 *
 *   POST /public/contact   { name, email, mobile?, subject?, message, company? }
 *
 * THE ROW IS WRITTEN BEFORE THE MAIL IS SENT, and kept whatever the mail server
 * does. Somebody complaining about a payment must not lose their message because
 * a mailbox was full, misconfigured, or not enabled yet; support can read the
 * table and the message can be re-sent.
 *
 * A MAIL FAILURE IS NOT THE VISITOR'S PROBLEM. They are told it was received —
 * because it was, durably — and the failure is recorded for us. The only thing
 * they are told differently is when the message itself was unusable.
 *
 * ABUSE. A public form that emails someone is a spam target, so: a honeypot
 * field real people never see, a minimum time between submissions from one
 * address, and hard length limits. Nothing that makes a genuine visitor prove
 * anything.
 */

const express = require('express');
const { query, one } = require('../gatepass/db');
const settings = require('../gatepass/settings');
const mail = require('../mail');

const router = express.Router();

const LIMITS = { name: 120, email: 180, mobile: 20, subject: 160, message: 4000 };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* One address may send a few messages an hour, not a few hundred. In memory on
   purpose: it protects the mailbox, and a restart forgetting it costs nothing. */
const seen = new Map();
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;

function tooMany(key) {
  const now = Date.now();
  const hits = (seen.get(key) || []).filter((t) => now - t < WINDOW_MS);
  hits.push(now);
  seen.set(key, hits);
  if (seen.size > 5000) for (const [k, v] of seen) if (!v.some((t) => now - t < WINDOW_MS)) seen.delete(k);
  return hits.length > MAX_PER_WINDOW;
}

const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

router.post('/public/contact', express.json({ limit: '16kb' }), async (req, res) => {
  const body = req.body || {};

  /* The honeypot: a field hidden from people and irresistible to bots. Answered
     as success so a bot learns nothing, and nothing is stored or sent. */
  if (clean(body.company, 50)) return res.json({ success: true, received: true });

  const name = clean(body.name, LIMITS.name);
  const email = clean(body.email, LIMITS.email).toLowerCase();
  const mobile = clean(body.mobile, LIMITS.mobile);
  const subject = clean(body.subject, LIMITS.subject);
  const message = String(body.message || '').trim().slice(0, LIMITS.message);

  if (name.length < 2) return res.status(400).json({ success: false, error: 'name', message: 'Please tell us your name.' });
  if (!EMAIL.test(email)) return res.status(400).json({ success: false, error: 'email', message: 'Please check the email address — that is where we will reply.' });
  if (message.length < 10) return res.status(400).json({ success: false, error: 'message', message: 'Please tell us a little more so we can help.' });

  const ip = (req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim();
  if (tooMany(email) || (ip && tooMany(`ip:${ip}`))) {
    return res.status(429).json({ success: false, error: 'too_many',
      message: 'We already have your messages. Please give us a little time to reply.' });
  }

  let row;
  try {
    row = await one(
      `INSERT INTO contact_messages (name, email, mobile, subject, message, ip, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`,
      [name, email, mobile || null, subject || null, message, ip || null, clean(req.get('user-agent'), 300) || null]);
  } catch (e) {
    console.error('[contact] store failed:', e.message);
    const to = (await settings.str('contact_email')) || 'support@pravesha.in';
    return res.status(500).json({ success: false, error: 'server',
      message: `We could not record that. Please email us directly at ${to}.` });
  }

  const to = (await settings.str('contact_email')) || 'support@pravesha.in';
  const out = await mail.send(mail.contactMail({ to, id: row.id, name, email, mobile, subject, message, ip }));

  await query(
    `UPDATE contact_messages SET mail_status = $2, mail_error = $3,
            sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE NULL END
      WHERE id = $1`,
    [row.id, out.status, out.error || null]);

  /* Received is received: the message is stored and will reach support either
     way, so the visitor gets one answer regardless of the mail server's mood. */
  res.json({ success: true, received: true, reference: `PVC${String(row.id).padStart(5, '0')}` });
});

module.exports = router;
