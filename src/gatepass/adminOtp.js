/**
 * adminOtp.js — signing in to the admin panel with a code instead of a password.
 *
 * REAL OR FIXED IS IS_REAL_OTP (user, 2026-09-17), the one switch every code in
 * the project reads (config/otp.js). Off, the code is 6416 and nothing is sent;
 * on, a random code is generated and sent by SMS through the same registered
 * template the gate app uses.
 *
 * THE SAME LIMITS AS THE GATE APP. A code lives three minutes, dies after five
 * wrong tries, is spent the moment it works, and only the newest one counts.
 * Stored hashed, with the panel's own scrypt, and the row is kept after use as
 * the record of who signed in and from where.
 *
 * IT DOES NOT SAY WHO IS A PANEL USER. Asking for a code for a number that is not
 * one answers exactly as it would for one that is; the refusal comes only when a
 * code is typed, and it is the same refusal a wrong code gets. The password
 * sign-in keeps the same rule.
 */

const { query, one } = require('./db');
const admin = require('./admin');

const MINUTES = 3;
const MAX_ATTEMPTS = 5;
const RESEND_SECONDS = 30;
const PER_HOUR = 10;
const otpMode = require('../config/otp');
const FIXED_CODE = otpMode.DEFAULT_OTP;

const SENT = 'Enter the 4-digit code.';

/** "Get code". */
async function request({ mobile, ip = null }) {
  const m = admin.localMobile(mobile);
  if (m.length !== 10) return { ok: false, error: 'bad_mobile', message: 'Enter the 10-digit mobile number.' };

  const user = await one(`SELECT id FROM admin_users WHERE mobile = $1 AND is_active`, [m]);
  /* Not a panel user: the same answer, and no code to type. */
  if (!user) return { ok: true, minutes: MINUTES, message: SENT };

  const [recent] = (await query(
    `SELECT count(*) FILTER (WHERE sent_at > now() - interval '1 hour') AS in_hour, max(sent_at) AS last_sent
       FROM admin_otps WHERE mobile = $1 AND purpose = 'sign_in'`, [m])).rows;
  if (recent.last_sent && Date.now() - new Date(recent.last_sent).getTime() < RESEND_SECONDS * 1000) {
    const wait = Math.ceil((RESEND_SECONDS * 1000 - (Date.now() - new Date(recent.last_sent).getTime())) / 1000);
    return { ok: false, error: 'too_soon', retryIn: wait, message: `A code was just issued. Wait ${wait} seconds before asking again.` };
  }
  if (Number(recent.in_hour) >= PER_HOUR) {
    return { ok: false, error: 'too_many', message: 'Too many codes this hour. Try again later.' };
  }

  /* One live code at a time: asking again retires the last one. */
  await query(
    `UPDATE admin_otps SET expires_at = now()
      WHERE mobile = $1 AND purpose = 'sign_in' AND consumed_at IS NULL AND expires_at > now()`, [m]);
  const code = otpMode.newCode();
  const row = await one(
    `INSERT INTO admin_otps (admin_id, mobile, code_hash, expires_at, ip, is_fixed)
     VALUES ($1, $2, $3, now() + ($4 || ' minutes')::interval, $5, $6) RETURNING id`,
    [user.id, m, await admin.hashPassword(code), String(MINUTES), ip, !otpMode.isRealOtp()]);

  if (otpMode.isRealOtp()) {
    const sent = await sendCode(m, code, MINUTES, 'admin-otp');
    if (!sent.ok) {
      /* A code nobody can read is retired at once, so asking again is not
         blocked by the resend wait. */
      await query(`UPDATE admin_otps SET expires_at = now() WHERE id = $1`, [row.id]);
      return { ok: false, error: sent.error, message: 'The code could not be sent just now. Try again, or use your password.' };
    }
  }

  return { ok: true, minutes: MINUTES, message: SENT };
}

/* The registered SMS template takes the code, who is asking and how long it
   lasts, in that order — the same three the gate app's code sends. */
async function sendCode(mobile, code, minutes, purpose) {
  const sms = require('../sms/fast2sms');
  const brand = process.env.FAST2SMS_OTP_BRAND || 'Pravesha';
  const out = await sms.send(mobile, [code, brand.slice(0, 30), `${minutes} minutes`], { purpose });
  return out.ok ? { ok: true } : { ok: false, error: out.error === 'not_configured' ? 'not_configured' : 'sms_failed' };
}

const WRONG = 'That code is not right.';

/** The code, typed back. On success, a session exactly like a password sign-in's. */
async function verify({ mobile, code, ip = null, userAgent = null }) {
  const m = admin.localMobile(mobile);
  const typed = String(code || '').replace(/\D/g, '');
  if (m.length !== 10 || typed.length !== 4) return { ok: false, error: 'wrong', message: WRONG };

  const otp = await one(
    `SELECT * FROM admin_otps WHERE mobile = $1 AND purpose = 'sign_in' AND consumed_at IS NULL
      ORDER BY sent_at DESC LIMIT 1`, [m]);
  if (!otp) return { ok: false, error: 'wrong', message: WRONG };
  if (new Date(otp.expires_at) <= new Date()) {
    return { ok: false, error: 'expired', message: 'That code has expired. Ask for a new one.' };
  }
  if (otp.attempts >= MAX_ATTEMPTS) {
    return { ok: false, error: 'dead', message: 'Too many wrong codes. Ask for a new one.' };
  }

  if (!(await admin.passwordMatches(typed, otp.code_hash))) {
    const r = await one(`UPDATE admin_otps SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts`, [otp.id]);
    const left = Math.max(0, MAX_ATTEMPTS - Number(r.attempts));
    return left === 0
      ? { ok: false, error: 'dead', message: 'Too many wrong codes. Ask for a new one.' }
      : { ok: false, error: 'wrong', attemptsLeft: left, message: `${WRONG} ${left} ${left === 1 ? 'try' : 'tries'} left.` };
  }

  /* Spent the moment it works, so the same code cannot open a second session. */
  await query(`UPDATE admin_otps SET consumed_at = now() WHERE id = $1`, [otp.id]);

  /* Switched off between asking and typing: no way in. */
  const user = await one(`SELECT * FROM admin_users WHERE id = $1 AND is_active`, [otp.admin_id]);
  if (!user) return { ok: false, error: 'wrong', message: WRONG };

  const token = await admin.openSession({ user, ip, userAgent, method: 'otp' });
  return { ok: true, token };
}

module.exports = { MINUTES, MAX_ATTEMPTS, FIXED_CODE, request, verify, sendCode };
