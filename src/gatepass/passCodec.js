/**
 * passCodec.js — pass numbers that are encrypted, unique by construction, and
 * decodable with the key.
 *
 *   PRV + 8 characters  <->  (date of visit, sequence number for that date)
 *
 * WHAT IS INSIDE. The date of visit and that date's booking sequence (1st pass
 * for 18 September, 2nd, ...). Packed as one integer, encrypted with a keyed
 * permutation, written in a 31-character alphabet. Decrypting with the key
 * gives the date and sequence back; without the key the numbers look random, and
 * consecutive passes for the same date share nothing visible.
 *
 * WHY NOT THE VEHICLE NUMBER TOO. A plate is about 50 bits and eight characters
 * of this alphabet hold about 40, so date + plate + sequence would need a pass
 * number around 22 characters long — too long to read aloud at a barrier. The
 * vehicle is bound to the pass in the database instead, where
 * idx_tickets_one_per_vehicle_per_date already enforces it.
 *
 * UNIQUE BY CONSTRUCTION. Encryption here is a permutation: two different
 * (date, sequence) pairs can never produce the same pass number, and the
 * sequence is handed out by the database per date. No random draw, so nothing
 * to collide and nothing to retry.
 *
 * HOW. A balanced Feistel network over 40 bits (20 + 20), twelve rounds, each
 * round function HMAC-SHA256 under PASS_NUMBER_KEY with the round number mixed
 * in — a Luby-Rackoff construction, which is a pseudorandom permutation for four
 * rounds and more. 31^8 is smaller than 2^40, so an output that lands outside
 * the alphabet's range is encrypted again until it lands inside ("cycle
 * walking"); decryption walks back the same way. The result is a permutation of
 * exactly the 31^8 values eight characters can spell.
 *
 * THE KEY MUST NEVER CHANGE once passes exist. The numbers stay in the database
 * and keep working if it does, but they can no longer be decoded — and the next
 * pass could encrypt to a number already issued. Keep it with the database
 * backups, and set the same value in production.
 *
 * GUESSING. A made-up number decrypts to some (date, sequence), but dates are
 * spread across two thousand years of range: almost every guess decodes to a
 * date nowhere near the booking window, so it can be rejected without even
 * looking it up. The rest still need a matching row in the database.
 */

const crypto = require('crypto');

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const BASE = BigInt(ALPHABET.length);   // 31
const LEN = 8;
const DOMAIN = BASE ** BigInt(LEN);     // 31^8 = 852,891,037,441
const HALF_BITS = 20n;
const HALF_MASK = (1n << HALF_BITS) - 1n;
const ROUNDS = 12;

const SEQ_BITS = 20n;                   // up to 1,048,575 passes per date
const SEQ_MAX = Number((1n << SEQ_BITS) - 1n);
const EPOCH = Date.UTC(2026, 0, 1);     // day 0 = 1 January 2026
const DAY_MS = 86_400_000;

let keyCache = null;
function key() {
  if (keyCache) return keyCache;
  const hex = process.env.PASS_NUMBER_KEY || '';
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('PASS_NUMBER_KEY must be set to 64 hex characters (32 bytes)');
  }
  keyCache = Buffer.from(hex, 'hex');
  return keyCache;
}

function roundFn(round, half) {
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(round, 0);
  msg.writeUInt32BE(Number(half), 4);
  const mac = crypto.createHmac('sha256', key()).update(msg).digest();
  return BigInt(mac.readUInt32BE(0)) & HALF_MASK;
}

function feistel(x, decrypt) {
  let l = (x >> HALF_BITS) & HALF_MASK;
  let r = x & HALF_MASK;
  if (!decrypt) {
    for (let i = 0; i < ROUNDS; i += 1) [l, r] = [r, l ^ roundFn(i, r)];
  } else {
    for (let i = ROUNDS - 1; i >= 0; i -= 1) [l, r] = [r ^ roundFn(i, l), l];
  }
  return (l << HALF_BITS) | r;
}

/* Cycle walking: stay inside [0, 31^8) so every result spells eight characters. */
function permute(x, decrypt) {
  let y = x;
  do { y = feistel(y, decrypt); } while (y >= DOMAIN);
  return y;
}

function toText(n) {
  let s = '';
  let v = n;
  for (let i = 0; i < LEN; i += 1) { s = ALPHABET[Number(v % BASE)] + s; v /= BASE; }
  return s;
}

function fromText(s) {
  let v = 0n;
  for (const ch of s) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) return null;
    v = v * BASE + BigInt(i);
  }
  return v;
}

const dayIndex = (yyyyMmDd) => {
  const [y, m, d] = String(yyyyMmDd).slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH) / DAY_MS);
};
const dayToDate = (i) => new Date(EPOCH + i * DAY_MS).toISOString().slice(0, 10);

/** (date of visit, sequence for that date) -> "PRV7K3M9Q2A". */
function encode(travelDate, seq) {
  const day = dayIndex(travelDate);
  if (day < 0) throw new Error(`pass numbers start at 2026-01-01, got ${travelDate}`);
  if (!Number.isInteger(seq) || seq < 1 || seq > SEQ_MAX) throw new Error(`sequence out of range: ${seq}`);
  const plain = (BigInt(day) << SEQ_BITS) | BigInt(seq);
  if (plain >= DOMAIN) throw new Error('date beyond the pass number range');
  return `PRV${toText(permute(plain, false))}`;
}

/**
 * "PRV7K3M9Q2A" -> { travelDate, seq }, or null when it is not a pass number in
 * this scheme (wrong shape, an older random number, or a sequence of 0 — which
 * encode() never issues, so a decoded 0 is proof of a made-up number).
 */
function decode(passNo) {
  const core = String(passNo || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (!/^PRV[0-9A-Z]{8}$/.test(core)) return null;
  const n = fromText(core.slice(3));
  if (n === null || n >= DOMAIN) return null;
  const plain = permute(n, true);
  const seq = Number(plain & ((1n << SEQ_BITS) - 1n));
  const day = Number(plain >> SEQ_BITS);
  if (seq === 0) return null;
  return { travelDate: dayToDate(day), seq };
}

/**
 * A quick, offline judgement of a pass number: does it decode to a date anyone
 * could actually hold a pass for? Used before a database lookup, and usable at a
 * checkpost with no signal.
 */
function plausible(passNo, { from, to } = {}) {
  const d = decode(passNo);
  if (!d) return false;
  if (from && d.travelDate < from) return false;
  if (to && d.travelDate > to) return false;
  return true;
}

module.exports = { encode, decode, plausible, SEQ_MAX };
