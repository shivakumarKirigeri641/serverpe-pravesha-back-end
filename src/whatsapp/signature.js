/**
 * signature.js — proving a webhook came from Meta.
 *
 * The endpoint has to be publicly reachable for Meta to post to it, which means
 * anyone else can post to it too. Every payload is signed with the app secret;
 * an unsigned or wrongly signed body is discarded before it is parsed.
 *
 * THE SIGNATURE COVERS THE RAW BYTES. Not the parsed object, and not a
 * re-serialised copy of it: JSON.stringify(JSON.parse(body)) reorders nothing
 * but reformats spacing, and the digest then never matches. This is the reason
 * the webhook route takes express.raw() and parses afterwards.
 */

const crypto = require('crypto');

function verify(rawBody, header) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return { ok: false, reason: 'app_secret_not_configured' };
  if (!header) return { ok: false, reason: 'missing_signature' };

  const expected = 'sha256=' + crypto.createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  const a = Buffer.from(expected);
  const b = Buffer.from(String(header));

  /* Lengths must match before timingSafeEqual, which throws on a mismatch
     rather than returning false. */
  if (a.length !== b.length) return { ok: false, reason: 'bad_signature' };
  return crypto.timingSafeEqual(a, b)
    ? { ok: true }
    : { ok: false, reason: 'bad_signature' };
}

/**
 * The GET handshake Meta performs once when the URL is saved.
 * Returns the challenge to echo, or null to refuse.
 */
function challenge(q) {
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === token) {
    return q['hub.challenge'];
  }
  return null;
}

module.exports = { verify, challenge };
