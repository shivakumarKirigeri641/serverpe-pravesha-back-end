/**
 * admin.js — who may open the admin panel, and a record of what they did.
 *
 * The panel can change prices, close a destination, cancel a pass and read a
 * visitor's details. So it is not "the site with more menus": it signs a named
 * person in, keeps their session, and writes an audit row for anything that
 * changes data.
 *
 * A PASSWORD, NOT A PIN. Unlike the gate — a phone at a barrier in the rain —
 * this is a desk, a keyboard and far more authority, so it takes a real
 * password, stored as a scrypt hash with a per-user salt. Five wrong tries locks
 * the account for a quarter of an hour, counted on the row, so trying another
 * browser does not help.
 *
 * ROLES — super admin, admin, checkpost manager, finance, viewer — and what
 * each may do are defined once in permissions.js. The route layer enforces them;
 * this module only reports the role.
 */

const crypto = require('crypto');
const { query, one } = require('./db');
const settings = require('./settings');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
const MAX_ATTEMPTS = 5;
const MIN_PASSWORD = 8;

/* Roles and what they may do live in permissions.js, shared with the panel. */
const permissions = require('./permissions');
const ROLES = Object.keys(permissions.ROLES);
const can = permissions.can;

const scrypt = (password, salt) =>
  new Promise((resolve, reject) =>
    crypto.scrypt(String(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p },
      (err, key) => (err ? reject(err) : resolve(key))));

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function passwordMatches(password, stored) {
  const [scheme, saltHex, keyHex] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = await scrypt(password, Buffer.from(saltHex, 'hex'));
  const want = Buffer.from(keyHex, 'hex');
  return key.length === want.length && crypto.timingSafeEqual(key, want);
}

const localMobile = (m) => String(m || '').replace(/\D/g, '').replace(/^(?:0|91)(\d{10})$/, '$1');

/** Sign in. Every refusal carries a sentence the screen can show as it is. */
async function signIn({ mobile, password, ip, userAgent }) {
  const m = localMobile(mobile);
  if (m.length !== 10 || !password) {
    return { ok: false, error: 'bad_credentials', message: 'Check the mobile number and password.' };
  }

  const user = await one(`SELECT * FROM admin_users WHERE mobile = $1 AND is_active`, [m]);

  /* A hash is computed even when there is no such user, so a wrong mobile takes
     as long to answer as a wrong password. */
  const stored = user ? user.password_hash : await hashPassword('not-a-real-password');
  const good = await passwordMatches(password, stored);

  if (user && user.locked_until && new Date(user.locked_until) > new Date()) {
    return { ok: false, error: 'locked', lockedUntil: user.locked_until,
      message: 'Too many wrong passwords. Please wait a few minutes.' };
  }

  if (!user || !good) {
    if (user) {
      const lockMinutes = await settings.num('admin_lock_minutes', 15);
      await query(
        `UPDATE admin_users
            SET failed_attempts = failed_attempts + 1,
                locked_until = CASE WHEN failed_attempts + 1 >= $2
                                    THEN now() + ($3 || ' minutes')::interval ELSE locked_until END,
                modified_at = now()
          WHERE id = $1`, [user.id, MAX_ATTEMPTS, String(lockMinutes)]);
    }
    return { ok: false, error: 'bad_credentials', message: 'That mobile number and password do not match.' };
  }

  const token = crypto.randomBytes(32).toString('base64url');
  await query(
    `INSERT INTO admin_sessions (admin_id, token, ip, user_agent) VALUES ($1,$2,$3,$4)`,
    [user.id, token, ip || null, userAgent || null]);
  await query(
    `UPDATE admin_users SET failed_attempts = 0, locked_until = NULL, last_login_at = now(), modified_at = now()
      WHERE id = $1`, [user.id]);

  await audit({ adminId: user.id, action: 'sign_in', ip });

  return { ok: true, token, user };
}

/** The session behind a token, or null. Also the idle-timeout check. */
async function sessionFor(token) {
  if (!token) return null;
  const hours = await settings.num('admin_session_hours', 12);
  const row = await one(
    `SELECT s.id AS session_id, s.started_at, s.last_seen_at,
            u.id AS admin_id, u.name, u.mobile, u.role, u.is_active
       FROM admin_sessions s
       JOIN admin_users u ON u.id = s.admin_id
      WHERE s.token = $1 AND s.ended_at IS NULL`, [token]);

  if (!row || !row.is_active) return null;

  if (Date.now() - new Date(row.last_seen_at).getTime() > hours * 3600 * 1000) {
    await query(`UPDATE admin_sessions SET ended_at = now() WHERE id = $1`, [row.session_id]);
    return null;
  }

  await query(`UPDATE admin_sessions SET last_seen_at = now() WHERE id = $1`, [row.session_id]);
  return row;
}

const signOut = (token) =>
  query(`UPDATE admin_sessions SET ended_at = now() WHERE token = $1 AND ended_at IS NULL`, [token]);

/**
 * Record something that changed.
 *
 * Deliberately never throws: an audit row that fails to write must not undo the
 * action it describes — the alternative is a price change rolled back because
 * the log was busy. A failure is logged loudly instead.
 */
async function audit({ adminId, action, subject = null, detail = {}, ip = null,
  before = undefined, after = undefined, reason = null, sessionId = null }) {
  try {
    await query(
      `INSERT INTO admin_audit (admin_id, action, subject, detail, ip, before_value, after_value, reason, session_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [adminId || null, action, subject, JSON.stringify(detail || {}), ip,
        before === undefined ? null : JSON.stringify(before),
        after === undefined ? null : JSON.stringify(after),
        reason || null, sessionId || null]);
    /* Also on the console: during a demonstration the terminal is the only
       place anybody is watching. */
    if (action !== 'sign_in') {
      const who = (await one('SELECT name FROM admin_users WHERE id = $1', [adminId]).catch(() => null))?.name || 'someone';
      require('../log').admin(who, action, subject);
    }
  } catch (e) {
    console.error('[admin] audit %s failed: %s', action, e.message);
  }
}

/** Administration, used by scripts/admin.js. */
async function upsert({ name, mobile, password, role = 'admin' }) {
  const m = localMobile(mobile);
  if (m.length !== 10) throw new Error('mobile must be 10 digits');
  if (!ROLES.includes(role)) throw new Error(`role must be one of ${ROLES.join(', ')}`);
  if (!password || String(password).length < MIN_PASSWORD) {
    throw new Error(`password must be at least ${MIN_PASSWORD} characters`);
  }

  const password_hash = await hashPassword(password);
  return one(
    `INSERT INTO admin_users (name, mobile, password_hash, role)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (mobile) DO UPDATE
        SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, role = EXCLUDED.role,
            is_active = true, failed_attempts = 0, locked_until = NULL, modified_at = now()
     RETURNING id, name, mobile, role`,
    [name, m, password_hash, role]);
}

module.exports = { signIn, signOut, sessionFor, audit, upsert, can, hashPassword, passwordMatches, localMobile, ROLES, MIN_PASSWORD };
