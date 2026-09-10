/**
 * admin.js — who may see the panel, and what they did while they were there.
 *
 * This panel shows a government department's revenue, every visitor's mobile
 * number and every vehicle that came up the hill. It is not a staff PIN screen,
 * and it does not get a shared password.
 *
 * Three roles, because three different people need three different things:
 *
 *   admin       everything, including prices, staff and closures
 *   department  everything about visitors and money, but changes nothing
 *   viewer      the dashboard and reports only
 *
 * Every read of personal data and every change is written to admin_audit. A
 * privacy policy that says "only authorised staff can see your data" is only
 * true if there is a record of which authorised person saw it.
 */

const crypto = require('crypto');
const { query, one } = require('./db');

const SESSION_HOURS = 12;
const MAX_ATTEMPTS = 8;
const LOCK_MINUTES = 15;

/* ────────────────────────────────────────────────────────────── passwords */

/** scrypt, as for staff PINs: no native build to fail on a deploy day. */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 32);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function checkPassword(pw, stored) {
  try {
    const [algo, saltB64, hashB64] = String(stored || '').split('$');
    if (algo !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(String(pw), Buffer.from(saltB64, 'base64'), expected.length);
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/* ──────────────────────────────────────────────────────────────── sign in */

async function login({ mobile, password, ip, userAgent }) {
  const admin = await one(
    `SELECT * FROM admin_users WHERE mobile = $1 AND is_active`, [mobile]);

  // The same answer whether the account does not exist or the password is
  // wrong. Telling a stranger which mobile numbers are administrators is a free
  // gift to whoever is guessing.
  if (!admin || !checkPassword(password, admin.password_hash)) {
    await recordFailure(mobile, ip);
    return { ok: false, reason: 'invalid' };
  }

  const recent = await one(
    `SELECT count(*)::int AS n FROM admin_audit
      WHERE action = 'login_failed' AND subject = $1
        AND created_at > now() - ($2 || ' minutes')::interval`,
    [mobile, String(LOCK_MINUTES)]);
  if (recent.n >= MAX_ATTEMPTS) return { ok: false, reason: 'locked' };

  const token = crypto.randomBytes(32).toString('base64url');
  await query(
    `INSERT INTO admin_sessions (admin_id, token, ip, user_agent) VALUES ($1,$2,$3,$4)`,
    [admin.id, token, ip || null, userAgent || null]);
  await query(`UPDATE admin_users SET last_login_at = now() WHERE id = $1`, [admin.id]);
  await audit(admin.id, 'login', mobile, {}, ip);

  return {
    ok: true, token,
    admin: { id: admin.id, name: admin.name, mobile: admin.mobile, role: admin.role },
  };
}

async function recordFailure(mobile, ip) {
  await query(
    `INSERT INTO admin_audit (action, subject, detail, ip) VALUES ('login_failed', $1, '{}', $2)`,
    [mobile, ip || null]);
}

async function sessionFor(token) {
  if (!token) return null;
  const s = await one(
    `SELECT ss.*, a.name, a.mobile, a.role, a.is_active
       FROM admin_sessions ss
       JOIN admin_users a ON a.id = ss.admin_id
      WHERE ss.token = $1 AND ss.ended_at IS NULL`, [token]);

  if (!s || !s.is_active) return null;
  if ((Date.now() - new Date(s.started_at).getTime()) / 3600000 > SESSION_HOURS) {
    await query(`UPDATE admin_sessions SET ended_at = now() WHERE id = $1`, [s.id]);
    return null;
  }
  await query(`UPDATE admin_sessions SET last_seen_at = now() WHERE id = $1`, [s.id]);
  return s;
}

const logout = (token) =>
  query(`UPDATE admin_sessions SET ended_at = now() WHERE token = $1 AND ended_at IS NULL`, [token]);

/* ───────────────────────────────────────────────────────────────── audit */

async function audit(adminId, action, subject, detail = {}, ip = null) {
  await query(
    `INSERT INTO admin_audit (admin_id, action, subject, detail, ip)
     VALUES ($1,$2,$3,$4,$5)`,
    [adminId || null, action, subject || null, JSON.stringify(detail), ip]);
}

/** Only 'admin' may change anything that costs money or moves people. */
const canWrite = (role) => role === 'admin';
const canSeePersonal = (role) => role === 'admin' || role === 'department';

async function create({ name, mobile, password, role = 'admin' }) {
  const r = await query(
    `INSERT INTO admin_users (name, mobile, password_hash, role)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (mobile) DO UPDATE SET
        name = EXCLUDED.name, password_hash = EXCLUDED.password_hash,
        role = EXCLUDED.role, is_active = true
     RETURNING id, name, mobile, role`,
    [name, mobile, hashPassword(password), role]);
  return r.rows[0];
}

module.exports = {
  hashPassword, checkPassword, login, logout, sessionFor, audit,
  canWrite, canSeePersonal, create,
};
