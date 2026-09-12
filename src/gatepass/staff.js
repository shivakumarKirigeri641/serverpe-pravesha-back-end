/**
 * staff.js — who is on the gate, and the shift they are on.
 *
 * A checkpost entry is a government record: it says a named person recorded a
 * named vehicle at a named gate at a given minute. So the gate screen is not
 * "unlocked" — somebody signs in to it, and every row they create carries their
 * id and their session.
 *
 * A PIN, NOT A PASSWORD. Staff enter a six-digit PIN on a phone, in the rain,
 * wearing gloves. What makes that safe enough is not its length:
 *
 *   * the PIN is issued by an administrator, never chosen (a chosen PIN is 1234);
 *   * five wrong tries locks the account for a quarter of an hour, on the staff
 *     row, so trying a different phone does not reset the count;
 *   * a shift ends after a set idle time, so a phone left in a jeep is signed out;
 *   * one live session per person AND one per checkpost — signing in anywhere
 *     ends the previous shift, which is how a handover is recorded rather than
 *     two people sharing one login.
 *
 * The PIN is stored as a scrypt hash with a per-staff salt. Node's crypto does
 * this without another dependency, and scrypt is deliberately slow, which is
 * what a six-digit secret needs.
 */

const crypto = require('crypto');
const { query, one, tx } = require('./db');
const settings = require('./settings');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
const MAX_ATTEMPTS = 5;

const scrypt = (pin, salt) =>
  new Promise((resolve, reject) =>
    crypto.scrypt(String(pin), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p },
      (err, key) => (err ? reject(err) : resolve(key))));

/** 'scrypt$<salt hex>$<key hex>' — self-describing, so the format can change later. */
async function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pin, salt);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function pinMatches(pin, stored) {
  const [scheme, saltHex, keyHex] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = await scrypt(pin, Buffer.from(saltHex, 'hex'));
  const want = Buffer.from(keyHex, 'hex');
  return key.length === want.length && crypto.timingSafeEqual(key, want);
}

const isPin = (pin) => /^\d{6}$/.test(String(pin || ''));

/* Mobile numbers are stored as ten digits (see 001); a staff member may type
   their number with +91 or spaces. */
const localMobile = (m) => String(m || '').replace(/\D/g, '').replace(/^(?:0|91)(\d{10})$/, '$1');

/**
 * Sign in and open a shift.
 *
 * Returns { ok: false, error } for every refusal, with a message the gate
 * screen can show as-is. The refusals deliberately do not distinguish "no such
 * mobile" from "wrong PIN": at a gate, the person who mistypes is far more
 * common than the person probing, and both need the same instruction.
 */
async function signIn({ mobile, pin, checkpostId, deviceToken }) {
  const m = localMobile(mobile);
  if (m.length !== 10 || !isPin(pin)) {
    return { ok: false, error: 'bad_credentials', message: 'Check the mobile number and the 6-digit PIN.' };
  }

  const staff = await one(
    `SELECT * FROM staff WHERE mobile = $1 AND is_active`, [m]);

  /* A hash is computed even when there is no such staff member, so a wrong
     mobile answers in the same time as a wrong PIN. */
  const stored = staff ? staff.pin_hash : await hashPin('000000');
  const good = await pinMatches(pin, stored);

  if (!staff || !good) {
    if (staff) {
      const lockMinutes = await settings.num('staff_lock_minutes', 15);
      await query(
        `UPDATE staff
            SET failed_attempts = failed_attempts + 1,
                locked_until = CASE WHEN failed_attempts + 1 >= $2
                                    THEN now() + ($3 || ' minutes')::interval ELSE locked_until END,
                modified_at = now()
          WHERE id = $1`, [staff.id, MAX_ATTEMPTS, String(lockMinutes)]);
    }
    return { ok: false, error: 'bad_credentials', message: 'That mobile number and PIN do not match.' };
  }

  if (staff.locked_until && new Date(staff.locked_until) > new Date()) {
    return { ok: false, error: 'locked', lockedUntil: staff.locked_until,
      message: 'Too many wrong PINs. Please wait a few minutes, or ask the administrator to reset it.' };
  }

  return signInVerified({ staffId: staff.id, checkpostId, deviceToken });
}

/**
 * Open the shift, once we are satisfied who this is.
 *
 * Split out of signIn because there is now more than one way to prove it: a PIN
 * the administrator issued, or a code sent to the staff member's own phone.
 * Everything after that proof is identical, and must stay identical — one shift
 * per gate, one per person, a handover recorded rather than a session silently
 * replaced — so it lives in one place instead of being written twice and
 * drifting apart.
 */
async function signInVerified({ staffId, checkpostId = null, deviceToken = null }) {
  const staff = await one(`SELECT * FROM staff WHERE id = $1 AND is_active`, [staffId]);
  if (!staff) {
    return { ok: false, error: 'not_staff', message: 'This mobile number is not permitted to login.',
      messageKn: 'ಈ ಮೊಬೈಲ್ ಸಂಖ್ಯೆಗೆ ಲಾಗಿನ್ ಅನುಮತಿ ಇಲ್ಲ.' };
  }

  /* Which gate. One posting is the normal case and is chosen for them; somebody
     posted to two must say which, because every entry is stamped with it. */
  const posts = (await query(
    `SELECT c.id, c.name, c.name_kn, c.place_id, p.name AS place_name, p.name_kn AS place_name_kn,
            p.district, p.district_kn
       FROM staff_checkposts sc
       JOIN checkposts c ON c.id = sc.checkpost_id AND c.is_active
       JOIN places p ON p.id = c.place_id
      WHERE sc.staff_id = $1
      ORDER BY c.id`, [staff.id])).rows;

  if (!posts.length) {
    return { ok: false, error: 'no_posting', message: 'You are not posted to a checkpost yet. Please contact the administrator.' };
  }
  const post = checkpostId
    ? posts.find((c) => String(c.id) === String(checkpostId))
    : (posts.length === 1 ? posts[0] : null);

  if (!post) {
    return { ok: false, error: 'choose_checkpost', message: 'Choose your checkpost.',
      checkposts: posts.map((c) => ({ id: String(c.id), name: c.name, placeName: c.place_name })) };
  }

  const device = deviceToken
    ? await one(`SELECT * FROM devices WHERE device_token = $1 AND revoked_at IS NULL`, [deviceToken])
    : null;

  const token = crypto.randomBytes(32).toString('base64url');

  /* Opening a shift closes whatever was open — for this person and for this
     gate. Both unique indexes in 002 demand it, and a handover is exactly this
     event: the previous holder is marked 'taken_over', not deleted. */
  const session = await tx(async (client) => {
    await client.query(
      `UPDATE staff_sessions SET ended_at = now(), ended_reason = 'signed_in_elsewhere'
        WHERE staff_id = $1 AND ended_at IS NULL`, [staff.id]);
    await client.query(
      `UPDATE staff_sessions SET ended_at = now(), ended_reason = 'taken_over'
        WHERE checkpost_id = $1 AND ended_at IS NULL`, [post.id]);
    const { rows } = await client.query(
      `INSERT INTO staff_sessions (staff_id, checkpost_id, device_id, token)
       VALUES ($1, $2, $3, $4) RETURNING *`, [staff.id, post.id, device ? device.id : null, token]);
    await client.query(
      `UPDATE staff SET failed_attempts = 0, locked_until = NULL, modified_at = now() WHERE id = $1`, [staff.id]);
    if (device) await client.query(`UPDATE devices SET last_seen_at = now() WHERE id = $1`, [device.id]);
    return rows[0];
  });

  return { ok: true, token, session, staff, checkpost: post };
}

/** The shift behind a token, or null. Also the idle-timeout check. */
async function sessionFor(token) {
  if (!token) return null;
  const hours = await settings.num('staff_session_hours', 14);
  const row = await one(
    `SELECT ss.id AS session_id, ss.started_at, ss.last_seen_at,
            s.id AS staff_id, s.name AS staff_name, s.mobile AS staff_mobile, s.is_active,
            c.id AS checkpost_id, c.name AS checkpost_name, c.name_kn AS checkpost_name_kn,
            c.place_id, p.name AS place_name, p.name_kn AS place_name_kn, p.district, p.district_kn
       FROM staff_sessions ss
       JOIN staff s ON s.id = ss.staff_id
       JOIN checkposts c ON c.id = ss.checkpost_id
       JOIN places p ON p.id = c.place_id
      WHERE ss.token = $1 AND ss.ended_at IS NULL`, [token]);

  if (!row || !row.is_active) return null;

  if (Date.now() - new Date(row.last_seen_at).getTime() > hours * 3600 * 1000) {
    await query(`UPDATE staff_sessions SET ended_at = now(), ended_reason = 'expired' WHERE id = $1`, [row.session_id]);
    return null;
  }

  await query(`UPDATE staff_sessions SET last_seen_at = now() WHERE id = $1`, [row.session_id]);
  return row;
}

const signOut = (token) =>
  query(`UPDATE staff_sessions SET ended_at = now(), ended_reason = 'signed_out'
          WHERE token = $1 AND ended_at IS NULL`, [token]);

/** Administration, used by scripts/staff.js — never exposed to the gate. */
async function upsert({ name, mobile, pin, checkpostIds = [] }) {
  const m = localMobile(mobile);
  if (m.length !== 10) throw new Error('mobile must be 10 digits');
  if (!isPin(pin)) throw new Error('pin must be exactly 6 digits');

  const pin_hash = await hashPin(pin);
  const row = await one(
    `INSERT INTO staff (name, mobile, pin_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (mobile) DO UPDATE
        SET name = EXCLUDED.name, pin_hash = EXCLUDED.pin_hash, is_active = true,
            failed_attempts = 0, locked_until = NULL, modified_at = now()
     RETURNING *`, [name, m, pin_hash]);

  for (const id of checkpostIds) {
    await query(`INSERT INTO staff_checkposts (staff_id, checkpost_id) VALUES ($1, $2)
                 ON CONFLICT DO NOTHING`, [row.id, id]);
  }
  return row;
}

module.exports = { signIn, signInVerified, signOut, sessionFor, upsert, hashPin, pinMatches, localMobile };
