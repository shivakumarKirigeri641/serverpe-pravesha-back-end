/**
 * mail.js — outbound email, for the few things WhatsApp is not the place for.
 *
 * Right now that is one thing: a message somebody typed into the website's
 * contact form, forwarded to the support mailbox.
 *
 * IT DEGRADES INSTEAD OF FAILING. The mailbox may not be enabled yet, the SMTP
 * password may be missing, the host may be refusing connections. None of that
 * may lose the message: the caller writes the row first and asks this to send,
 * and a failure is reported back to be recorded — never thrown at the visitor,
 * who would be told to try again and would type it all out twice.
 *
 * REPLY-TO IS THE VISITOR, FROM IS US. Sending as the visitor's own address
 * would be forged mail and would fail SPF; support staff still just press reply.
 */

const nodemailer = require('nodemailer');

const cfg = () => ({
  host: process.env.MAIL_HOST,
  port: Number(process.env.MAIL_PORT || 465),
  secure: String(process.env.MAIL_SECURE || 'true') !== 'false',
  user: process.env.MAIL_USER || process.env.MAIL_USERNAME,
  pass: process.env.MAIL_PASSWORD || process.env.MAIL_PASS,
  fromName: process.env.MAIL_FROM_NAME || 'Pravesha',
  from: process.env.MAIL_FROM || process.env.MAIL_USER || process.env.MAIL_USERNAME,
});

const configured = () => {
  const c = cfg();
  return Boolean(c.host && c.user && c.pass && c.from);
};

let transport = null;
function transporter() {
  if (transport) return transport;
  const c = cfg();
  transport = nodemailer.createTransport({
    host: c.host, port: c.port, secure: c.secure,
    auth: { user: c.user, pass: c.pass },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
  });
  return transport;
}

/**
 * Send one message.
 * Returns { status: 'sent' | 'skipped' | 'failed', error }, never throws.
 *
 * 'skipped' means the mailbox is not set up yet — a deployment fact, not an
 * error in the request, and the stored row is the copy that matters until it is.
 */
async function send({ to, subject, text, html, replyTo }) {
  if (!configured()) {
    console.warn('[mail] not configured (MAIL_HOST/MAIL_USER/MAIL_PASSWORD); message stored, not sent');
    return { status: 'skipped', error: 'mail_not_configured' };
  }
  const c = cfg();
  try {
    const info = await transporter().sendMail({
      from: `"${c.fromName}" <${c.from}>`,
      to, subject, text, html, replyTo,
    });
    console.log('[mail] sent to %s (%s)', to, info.messageId);
    return { status: 'sent' };
  } catch (e) {
    console.error('[mail] send to %s failed: %s', to, e.message);
    return { status: 'failed', error: e.message.slice(0, 300) };
  }
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The contact form, as a mail support can read on a phone and reply to. */
function contactMail({ to, id, name, email, mobile, subject, message, ip }) {
  const when = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const lines = [
    `From:    ${name} <${email}>`,
    mobile ? `Mobile:  ${mobile}` : null,
    `Subject: ${subject || '—'}`,
    `When:    ${when} IST`,
    `Ref:     #${id}`,
    '',
    message,
  ].filter(Boolean);

  return {
    to,
    subject: `Pravesha contact: ${subject || name}`,
    replyTo: `${name} <${email}>`,
    text: lines.join('\n'),
    html: `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;color:#0d1b1e">
  <p style="margin:0 0 16px;font-weight:600">New message from the Pravesha website</p>
  <table style="border-collapse:collapse;font-size:14px">
    <tr><td style="padding:2px 12px 2px 0;color:#5d7169">From</td><td><b>${esc(name)}</b> &lt;<a href="mailto:${esc(email)}">${esc(email)}</a>&gt;</td></tr>
    ${mobile ? `<tr><td style="padding:2px 12px 2px 0;color:#5d7169">Mobile</td><td>${esc(mobile)}</td></tr>` : ''}
    <tr><td style="padding:2px 12px 2px 0;color:#5d7169">Subject</td><td>${esc(subject) || '—'}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#5d7169">When</td><td>${esc(when)} IST</td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#5d7169">Ref</td><td>#${esc(id)}${ip ? ` · ${esc(ip)}` : ''}</td></tr>
  </table>
  <div style="margin-top:18px;padding:14px 16px;background:#f2f6f4;border-radius:10px;white-space:pre-wrap">${esc(message)}</div>
  <p style="margin-top:18px;color:#5d7169;font-size:13px">Reply to this email and it goes straight back to them.</p>
</div>`,
  };
}

module.exports = { send, contactMail, configured };
