/**
 * sign.js — the signed QR, and why it is shaped this way.
 *
 * THE FRAUD THIS EXISTS TO KILL: today's ticket is a document. Someone buys one
 * for KA01AB1234 on Sunday, opens it in an editor, changes the plate and the
 * date, and prints ten of them. At the gate a person reads it and waves it
 * through, because a read ticket and a verified ticket look identical.
 *
 * Two properties fix that, and both had to be true at once:
 *
 *   1. THE TICKET CANNOT BE EDITED. Every field a person would want to change
 *      — plate, date, slot, place, category — is inside the signature. Change
 *      one character and the signature fails.
 *
 *   2. THE GATE NEEDS NO NETWORK TO KNOW. Verification is a public-key check
 *      over the payload itself, so a phone with no signal still catches every
 *      forgery. Only "has this ticket already come through?" needs the server,
 *      and that is genuinely shared state.
 *
 * WHY Ed25519 AND NOT AN HMAC: an HMAC would be simpler, but verifying one
 * requires the same secret that creates one. That secret would have to sit in
 * every staff phone, and a secret in a phone at a hill station is a secret that
 * gets extracted — at which point the holder can mint tickets that verify
 * perfectly. With Ed25519 the phones carry only the public key: enough to check
 * a signature, useless for making one. That asymmetry is the entire reason for
 * the choice.
 *
 * The payload is compact on purpose. A QR that holds less is a QR with larger
 * modules, and larger modules scan faster on a dusty windscreen at 7 a.m.
 */

const crypto = require('crypto');

const VERSION = 'S1';           // bump only with a scanner that understands it
const SEP = '|';

function privateKey() {
  const b64 = process.env.TICKET_SIGN_PRIVATE_KEY;
  if (!b64) throw new Error('TICKET_SIGN_PRIVATE_KEY is not set');
  return crypto.createPrivateKey({
    key: Buffer.from(b64, 'base64'), format: 'der', type: 'pkcs8',
  });
}

function publicKey() {
  const b64 = process.env.TICKET_SIGN_PUBLIC_KEY;
  if (!b64) throw new Error('TICKET_SIGN_PUBLIC_KEY is not set');
  return crypto.createPublicKey({
    key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki',
  });
}

/**
 * The signed part, as one line. Field order is fixed forever: the scanner
 * splits on position, so re-ordering these would silently invalidate every
 * ticket already in someone's phone.
 *
 * S1|TICKETNO|PLACE|YYYYMMDD|SLOT|CAT|REGNO|KEYID
 */
function body(t) {
  return [
    VERSION,
    t.ticket_no,
    t.place_code,
    String(t.travel_date).replace(/-/g, ''),
    t.slot_code,
    t.category_code,
    t.reg_no,
    process.env.TICKET_SIGN_KEY_ID || 'k1',
  ].join(SEP);
}

/** Sign a ticket. Returns the full string that goes into the QR. */
function signTicket(t) {
  const b = body(t);
  const sig = crypto.sign(null, Buffer.from(b, 'utf8'), privateKey());
  return b + SEP + sig.toString('base64url');
}

/**
 * Verify a scanned string. Returns { ok, reason, ticket }.
 *
 * This answers exactly one question — "did we issue this, unaltered?" — and
 * deliberately no others. Whether the day is right, the gate is right, or the
 * ticket has already been used are separate checks with their own verdicts,
 * because a staff member needs to be told which of those went wrong. Collapsing
 * them into "invalid" would make a forged ticket and a Tuesday ticket look the
 * same at the gate, and they call for very different responses.
 */
function verifyTicket(raw) {
  const s = String(raw || '').trim();
  const parts = s.split(SEP);
  if (parts.length !== 9) return { ok: false, reason: 'malformed' };
  if (parts[0] !== VERSION) return { ok: false, reason: 'version' };

  const b = parts.slice(0, 8).join(SEP);
  let good = false;
  try {
    good = crypto.verify(
      null, Buffer.from(b, 'utf8'), publicKey(), Buffer.from(parts[8], 'base64url'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!good) return { ok: false, reason: 'signature' };

  const d = parts[3];
  return {
    ok: true,
    ticket: {
      ticket_no: parts[1],
      place_code: parts[2],
      travel_date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
      slot_code: parts[4],
      category_code: parts[5],
      reg_no: parts[6],
      key_id: parts[7],
    },
  };
}

/** What the scanner app is given at sign-in. Never the private key. */
function scannerKeys() {
  return {
    key_id: process.env.TICKET_SIGN_KEY_ID || 'k1',
    public_key: process.env.TICKET_SIGN_PUBLIC_KEY,
    version: VERSION,
  };
}

module.exports = { signTicket, verifyTicket, scannerKeys, VERSION };
