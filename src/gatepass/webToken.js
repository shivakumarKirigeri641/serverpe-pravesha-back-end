/**
 * webToken.js — the signed, single-use link handed out in the chat.
 *
 * The visitor is already identified: they are messaging us from their own
 * number. Asking them to log in to a web form to prove something WhatsApp has
 * already proven would be friction for no gain, so the link carries the proof.
 *
 * IT IS A BEARER CREDENTIAL, so it is treated as one:
 *
 *   signed     the payload is HMAC'd, so it cannot be edited into someone
 *              else's booking by changing a number in the URL.
 *   recorded   a signature has no memory. Without a row, the same link works
 *              forever -- scroll up the thread days later, tap it again, book
 *              again. Spending it is a state change.
 *   hashed     only the hash is stored. A leaked database should not hand
 *              somebody a working booking link for every customer.
 *   short      two hours. Long enough to finish, wander off, come back; short
 *              enough that a forwarded screenshot is worthless by evening.
 */

const crypto = require('crypto');
const { query, one } = require('./db');

const TTL_MINUTES = 120;

const secret = () => {
  const s = process.env.WEB_TOKEN_SECRET || process.env.WHATSAPP_APP_SECRET;
  if (!s) throw new Error('WEB_TOKEN_SECRET (or WHATSAPP_APP_SECRET) is not configured');
  return s;
};

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const unb64 = (s) => Buffer.from(s, 'base64url');

/**
 * Issue a link for this customer.
 *
 * The customer id travels in the token so the page can be rendered without a
 * database round trip to work out who is asking — but it is still checked
 * against the stored row, because a signature proves the value was ours and
 * says nothing about whether it has been used.
 */
async function issue(customerId, purpose = 'booking') {
  const payload = b64(JSON.stringify({ c: String(customerId), p: purpose, n: crypto.randomBytes(9).toString('hex') }));
  const sig = b64(crypto.createHmac('sha256', secret()).update(payload).digest());
  const token = `${payload}.${sig}`;

  await query(
    `INSERT INTO web_tokens (token_hash, customer_id, purpose, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' minutes')::interval)`,
    [hash(token), customerId, purpose, String(TTL_MINUTES)]);

  return token;
}

/**
 * Check a token presented back to us. Returns { ok, reason, row, customerId }.
 *
 * Signature first, database second: an invalid signature is not worth a query,
 * and checking it first means a flood of guessed tokens costs no I/O.
 */
async function verify(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return { ok: false, reason: 'malformed' };
  }
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return { ok: false, reason: 'malformed' };

  const expect = crypto.createHmac('sha256', secret()).update(payload).digest();
  const got = unb64(sig);
  if (got.length !== expect.length || !crypto.timingSafeEqual(got, expect)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let claims;
  try { claims = JSON.parse(unb64(payload).toString('utf8')); }
  catch { return { ok: false, reason: 'malformed' }; }

  const row = await one('SELECT * FROM web_tokens WHERE token_hash = $1', [hash(token)]);
  if (!row) return { ok: false, reason: 'unknown' };
  if (row.used_at) return { ok: false, reason: 'already_used' };
  if (new Date(row.expires_at) < new Date()) return { ok: false, reason: 'expired' };

  return { ok: true, row, customerId: String(row.customer_id), purpose: claims.p || row.purpose };
}

/**
 * Mark it spent, and say whether this call is the one that spent it.
 *
 * The WHERE clause carries used_at IS NULL so that two taps arriving together
 * cannot both succeed: the database decides, not the order the handlers ran in.
 * A booking is the one place where "probably only once" is not good enough.
 */
async function spend(token, ticketId = null) {
  const r = await query(
    `UPDATE web_tokens SET used_at = now(), ticket_id = COALESCE($2, ticket_id)
      WHERE token_hash = $1 AND used_at IS NULL
      RETURNING id`,
    [hash(token), ticketId]);
  return r.rows.length > 0;
}

const base = () => (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');

const linkFor = (token) => `${base()}/book/${token}`;

/* The same signed, single-use token, pointed at the rating page instead. Issued
   with purpose 'feedback' so a booking link can never be spent on a rating, nor
   the other way round. */
const feedbackLinkFor = (token) => `${base()}/rate/${token}`;

module.exports = { issue, verify, spend, linkFor, feedbackLinkFor, TTL_MINUTES };
