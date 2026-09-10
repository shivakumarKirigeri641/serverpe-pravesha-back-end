/**
 * staff.js — who is scanning, on what, and at which gate.
 *
 * A scanner without accountability is a scanner that can be lent to a friend.
 * Three rules, and each one closes a specific hole the department asked about:
 *
 *   * ONE LIVE SESSION PER STAFF MEMBER. Signing in anywhere ends the session
 *     everywhere else, so a shared PIN cannot put one person on two gates at
 *     once — it just knocks the first phone offline, visibly.
 *
 *   * ONE SCANNING DEVICE PER CHECKPOST. The backup phone sits idle until it
 *     deliberately takes over, so two people cannot both be "the gate" and each
 *     assume the other is checking.
 *
 *   * A DEVICE BELONGS TO A CHECKPOST. A PIN on an unregistered phone is
 *     useless, and a stolen registered phone is useless without a PIN. Neither
 *     alone gets anyone in.
 *
 * Both uniqueness rules are partial unique indexes in the database, not checks
 * here — two sign-ins racing each other would both pass an application check.
 */

const crypto = require('crypto');
const { query, one, tx } = require('./db');

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const SESSION_HOURS = 16;      // longer than any shift, shorter than a week

/* ────────────────────────────────────────────────────────────────── PINs */

/**
 * scrypt, not bcrypt — no native build to go wrong on a deploy, and it is what
 * Node ships with. The salt is stored alongside the hash.
 */
function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pin), salt, 32);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function checkPin(pin, stored) {
  try {
    const [algo, saltB64, hashB64] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(String(pin), salt, expected.length);
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Six digits, issued by an administrator. Never chosen by the holder. */
function generatePin() {
  return String(crypto.randomInt(100000, 1000000));
}

/* ───────────────────────────────────────────────────────────── sign-in */

/**
 * Sign a staff member in at a checkpost on a device.
 *
 * Returns { ok, session, staff, checkpost, keys } or { ok:false, reason } where
 * reason distinguishes: 'unknown_device', 'device_revoked', 'bad_pin',
 * 'locked', 'not_assigned', 'gate_busy'.
 *
 * These are kept apart because the person holding the phone needs to know which
 * one it is — "wrong PIN" and "this phone is not registered to this gate" call
 * for completely different next steps.
 */
async function signIn({ deviceToken, pin, takeover = false }) {
  const device = await one(
    `SELECT d.*, c.name AS checkpost_name, c.place_id
       FROM devices d JOIN checkposts c ON c.id = d.checkpost_id
      WHERE d.device_token = $1`, [deviceToken]);

  if (!device) return { ok: false, reason: 'unknown_device' };
  if (device.revoked_at) return { ok: false, reason: 'device_revoked' };

  // The PIN identifies the person. Only staff assigned to THIS checkpost are
  // considered, so the same PIN digits belonging to someone at another gate
  // cannot open this one.
  const candidates = (await query(
    `SELECT s.* FROM staff s
       JOIN staff_checkposts sc ON sc.staff_id = s.id
      WHERE sc.checkpost_id = $1 AND s.is_active`, [device.checkpost_id])).rows;

  const staff = candidates.find((s) => checkPin(pin, s.pin_hash));

  if (!staff) {
    // Count the failure against every unlocked candidate at this gate. Without
    // this, a PIN could be brute-forced at leisure — six digits is a million
    // guesses, which is minutes for a script.
    await query(
      `UPDATE staff SET failed_attempts = failed_attempts + 1,
              locked_until = CASE WHEN failed_attempts + 1 >= $2
                                  THEN now() + ($3 || ' minutes')::interval
                                  ELSE locked_until END
        WHERE id IN (SELECT staff_id FROM staff_checkposts WHERE checkpost_id = $1)`,
      [device.checkpost_id, MAX_ATTEMPTS, String(LOCK_MINUTES)]);
    return { ok: false, reason: 'bad_pin' };
  }

  if (staff.locked_until && new Date(staff.locked_until) > new Date()) {
    return { ok: false, reason: 'locked', until: staff.locked_until };
  }

  return tx(async (client) => {
    // End this person's session anywhere else. One human, one live session.
    await client.query(
      `UPDATE staff_sessions SET ended_at = now(), ended_reason = 'signed_in_elsewhere'
        WHERE staff_id = $1 AND ended_at IS NULL`, [staff.id]);

    const busy = (await client.query(
      `SELECT ss.*, s.name AS staff_name FROM staff_sessions ss
         JOIN staff s ON s.id = ss.staff_id
        WHERE ss.checkpost_id = $1 AND ss.ended_at IS NULL`, [device.checkpost_id])).rows[0];

    if (busy && !takeover) {
      return { ok: false, reason: 'gate_busy', held_by: busy.staff_name, since: busy.started_at };
    }
    if (busy) {
      // A deliberate handover, recorded as one. Shift changes are normal; what
      // must never happen is a silent swap with no record of who had the gate.
      await client.query(
        `UPDATE staff_sessions SET ended_at = now(), ended_reason = 'taken_over' WHERE id = $1`,
        [busy.id]);
    }

    const token = crypto.randomBytes(24).toString('base64url');
    const session = (await client.query(
      `INSERT INTO staff_sessions (staff_id, checkpost_id, device_id, token)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [staff.id, device.checkpost_id, device.id, token])).rows[0];

    await client.query(
      `UPDATE staff SET failed_attempts = 0, locked_until = NULL WHERE id = $1`, [staff.id]);
    await client.query('UPDATE devices SET last_seen_at = now() WHERE id = $1', [device.id]);

    return {
      ok: true, session, token,
      staff: { id: staff.id, name: staff.name },
      checkpost: { id: device.checkpost_id, name: device.checkpost_name, place_id: device.place_id },
      took_over_from: busy ? busy.staff_name : null,
    };
  });
}

/** The session behind a scanner token, or null if it has ended or aged out. */
async function sessionFor(token) {
  if (!token) return null;
  const s = await one(
    `SELECT ss.*, st.name AS staff_name, c.name AS checkpost_name, c.place_id
       FROM staff_sessions ss
       JOIN staff st ON st.id = ss.staff_id
       JOIN checkposts c ON c.id = ss.checkpost_id
      WHERE ss.token = $1 AND ss.ended_at IS NULL`, [token]);

  if (!s) return null;
  const ageHours = (Date.now() - new Date(s.started_at).getTime()) / 3600000;
  if (ageHours > SESSION_HOURS) {
    await query(
      `UPDATE staff_sessions SET ended_at = now(), ended_reason = 'expired' WHERE id = $1`, [s.id]);
    return null;
  }
  await query('UPDATE staff_sessions SET last_seen_at = now() WHERE id = $1', [s.id]);
  return s;
}

async function signOut(token) {
  const r = await query(
    `UPDATE staff_sessions SET ended_at = now(), ended_reason = 'signed_out'
      WHERE token = $1 AND ended_at IS NULL RETURNING *`, [token]);
  return r.rows[0] || null;
}

/* ────────────────────────────────────────────────────── admin operations */

async function create({ name, mobile, pin, checkpostIds = [] }) {
  const chosen = pin || generatePin();
  const s = (await query(
    `INSERT INTO staff (name, mobile, pin_hash) VALUES ($1, $2, $3) RETURNING *`,
    [name, mobile || null, hashPin(chosen)])).rows[0];

  for (const id of checkpostIds) {
    await query(
      `INSERT INTO staff_checkposts (staff_id, checkpost_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`, [s.id, id]);
  }
  // The plain PIN is returned exactly once, here. It is never stored and cannot
  // be recovered — a lost PIN is reset, not looked up.
  return { staff: s, pin: chosen };
}

async function resetPin(staffId) {
  const pin = generatePin();
  await query(
    `UPDATE staff SET pin_hash = $2, failed_attempts = 0, locked_until = NULL,
            modified_at = now() WHERE id = $1`, [staffId, hashPin(pin)]);
  // End any live session: whoever had the old PIN should not keep the gate.
  await query(
    `UPDATE staff_sessions SET ended_at = now(), ended_reason = 'pin_reset'
      WHERE staff_id = $1 AND ended_at IS NULL`, [staffId]);
  return pin;
}

async function registerDevice({ checkpostId, label, isPrimary = false }) {
  const token = crypto.randomBytes(24).toString('base64url');
  const d = (await query(
    `INSERT INTO devices (checkpost_id, label, device_token, is_primary)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [checkpostId, label, token, isPrimary])).rows[0];
  return { device: d, token };
}

const revokeDevice = (id) =>
  query('UPDATE devices SET revoked_at = now() WHERE id = $1', [id]);

module.exports = {
  hashPin, checkPin, generatePin, signIn, sessionFor, signOut,
  create, resetPin, registerDevice, revokeDevice,
};
