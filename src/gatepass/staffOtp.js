/**
 * staffOtp.js — signing a staff member in with a code sent to their phone.
 *
 * WHY A CODE AND NOT A PIN. A PIN was issued once by an administrator, told to a
 * staff member, and then lived in their memory or on a piece of paper by the
 * barrier. It was never rotated, it was passed on when somebody covered a shift,
 * and taking it away meant asking an administrator. A code sent to a number is
 * held by whoever is holding that phone, which is the thing actually being
 * authorised — and an administrator revokes access by switching the number off,
 * which is a decision they can make in the panel in two seconds.
 *
 * FOUR DIGITS IS TEN THOUSAND GUESSES. The code is not the security; the limits
 * are, and they are deliberately tight:
 *
 *   three minutes       — a code read off a lock screen and typed, nothing more
 *   five attempts       — then the code is dead and a new one must be asked for
 *   one live code       — asking again retires the last, so two are never valid
 *   one send a minute   — and a handful an hour, per number
 *   stored hashed       — a table of live codes is a list of ways through a gate
 *
 * WHO MAY EVEN ASK. Only a number that belongs to an active staff member posted
 * to a checkpost. Anybody else is told plainly that the number is not permitted,
 * in English and in Kannada, and no SMS is sent — an unknown number must not be
 * able to make this service text arbitrary people, and the refusal is the same
 * whether the number is a stranger's or a staff member who has been switched
 * off, because those two facts are nobody's business from outside.
 *
 * THE CODE IS NEVER RETURNED, LOGGED OR SHOWN. The only copies are the hash here
 * and the SMS on the phone. The one exception is the reserved 000 test range,
 * which cannot reach a handset: there the code is fixed so the flow can be
 * tested end to end without an SMS ever being sent.
 */

const crypto = require('crypto');
const { query, one } = require('./db');
const sms = require('../sms/fast2sms');
const staffModule = require('./staff');

const MINUTES = 3;            // how long a code lives
const MAX_ATTEMPTS = 5;       // wrong guesses before it is dead
const RESEND_SECONDS = 60;    // between one code and the next
const PER_HOUR = 6;           // codes per number per hour
const TEST_CODE = '1234';     // for the reserved 000 range only

/* Both languages, because the person reading this is at a barrier in Chikkamagaluru. */
const SAYS = {
  not_staff: {
    en: 'This mobile number is not permitted to login.',
    kn: 'ಈ ಮೊಬೈಲ್ ಸಂಖ್ಯೆಗೆ ಲಾಗಿನ್ ಅನುಮತಿ ಇಲ್ಲ.',
  },
  bad_mobile: {
    en: 'Enter the 10-digit mobile number.',
    kn: '10 ಅಂಕಿಯ ಮೊಬೈಲ್ ಸಂಖ್ಯೆಯನ್ನು ನಮೂದಿಸಿ.',
  },
  no_posting: {
    en: 'You are not posted to a checkpost yet. Please contact the administrator.',
    kn: 'ನಿಮ್ಮನ್ನು ಇನ್ನೂ ಯಾವುದೇ ಚೆಕ್‌ಪೋಸ್ಟ್‌ಗೆ ನೇಮಿಸಿಲ್ಲ. ನಿರ್ವಾಹಕರನ್ನು ಸಂಪರ್ಕಿಸಿ.',
  },
  too_soon: {
    en: 'A code was just sent. Wait a moment before asking for another.',
    kn: 'ಈಗಷ್ಟೇ ಕೋಡ್ ಕಳುಹಿಸಲಾಗಿದೆ. ಇನ್ನೊಂದನ್ನು ಕೇಳುವ ಮೊದಲು ಸ್ವಲ್ಪ ಕಾಯಿರಿ.',
  },
  too_many: {
    en: 'Too many codes requested. Please try again after an hour.',
    kn: 'ತುಂಬಾ ಬಾರಿ ಕೋಡ್ ಕೇಳಲಾಗಿದೆ. ಒಂದು ಗಂಟೆಯ ನಂತರ ಪ್ರಯತ್ನಿಸಿ.',
  },
  sms_failed: {
    en: 'The code could not be sent. Check the signal and try again.',
    kn: 'ಕೋಡ್ ಕಳುಹಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. ಸಿಗ್ನಲ್ ಪರಿಶೀಲಿಸಿ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
  },
  not_configured: {
    en: 'Sending codes is not set up on this server yet.',
    kn: 'ಈ ಸರ್ವರ್‌ನಲ್ಲಿ ಕೋಡ್ ಕಳುಹಿಸುವುದನ್ನು ಇನ್ನೂ ಸಿದ್ಧಪಡಿಸಿಲ್ಲ.',
  },
  no_code: {
    en: 'Ask for a code first.',
    kn: 'ಮೊದಲು ಕೋಡ್ ಕೇಳಿ.',
  },
  expired: {
    en: 'That code has expired. Ask for a new one.',
    kn: 'ಆ ಕೋಡ್ ಅವಧಿ ಮುಗಿದಿದೆ. ಹೊಸದನ್ನು ಕೇಳಿ.',
  },
  wrong: {
    en: 'That code is not right.',
    kn: 'ಆ ಕೋಡ್ ಸರಿಯಿಲ್ಲ.',
  },
  dead: {
    en: 'Too many wrong tries. Ask for a new code.',
    kn: 'ತುಂಬಾ ಬಾರಿ ತಪ್ಪಾಗಿದೆ. ಹೊಸ ಕೋಡ್ ಕೇಳಿ.',
  },
  sent: {
    en: 'A 4-digit code has been sent by SMS. It is valid for 3 minutes.',
    kn: '4 ಅಂಕಿಯ ಕೋಡ್ SMS ಮೂಲಕ ಕಳುಹಿಸಲಾಗಿದೆ. ಇದು 3 ನಿಮಿಷ ಮಾನ್ಯ.',
  },
};

const say = (key, extra = {}) => ({ message: SAYS[key].en, messageKn: SAYS[key].kn, ...extra });

const digits = (m) => String(m || '').replace(/\D/g, '').slice(-10);
const isTest = (m) => /^000\d{7}$/.test(m);

/* A code with no pattern in it. randomInt is the right generator here: Math.random
   is predictable enough to matter when the whole secret is four digits. */
const mint = () => String(crypto.randomInt(0, 10000)).padStart(4, '0');

/**
 * "Get OTP".
 *
 * Returns { ok } and a message in both languages either way. It never says
 * whether the number exists as anything other than staff, and it never returns
 * the code — except for the reserved test range, where there is no SMS to read.
 */
async function request({ mobile, ip = null }) {
  const m = digits(mobile);
  if (m.length !== 10) return { ok: false, error: 'bad_mobile', ...say('bad_mobile') };

  const staff = await one(`SELECT * FROM staff WHERE mobile = $1 AND is_active`, [m]);
  if (!staff) return { ok: false, error: 'not_staff', ...say('not_staff') };

  const posts = (await query(
    `SELECT c.id FROM staff_checkposts sc
       JOIN checkposts c ON c.id = sc.checkpost_id AND c.is_active
      WHERE sc.staff_id = $1`, [staff.id])).rows;
  if (!posts.length) return { ok: false, error: 'no_posting', ...say('no_posting') };

  /* How often this number has asked. Both limits are per number rather than per
     staff member: the number is what receives the message and what somebody
     would abuse. */
  const [recent] = (await query(
    `SELECT count(*) FILTER (WHERE sent_at > now() - interval '1 hour') AS in_hour,
            max(sent_at) AS last_sent
       FROM staff_otps WHERE mobile = $1`, [m])).rows;

  if (recent.last_sent && Date.now() - new Date(recent.last_sent).getTime() < RESEND_SECONDS * 1000) {
    const wait = Math.ceil((RESEND_SECONDS * 1000 - (Date.now() - new Date(recent.last_sent).getTime())) / 1000);
    return { ok: false, error: 'too_soon', retryIn: wait, ...say('too_soon') };
  }
  if (Number(recent.in_hour) >= PER_HOUR) return { ok: false, error: 'too_many', ...say('too_many') };

  /*
   * WHAT GOES INTO THE REGISTERED TEMPLATE, in the order it was registered:
   *
   *   1  the code itself
   *   2  who is asking — the gate they are posted to where that fits the 30
   *      characters the template allows, otherwise the service's name
   *   3  how long it lasts, taken from MINUTES rather than typed, so the SMS
   *      cannot promise three minutes while the code expires in five
   *
   * The count and the order must match the registered template exactly. A
   * mismatch is not a formatting problem: the operator drops the message and the
   * staff member simply never receives it.
   */
  const where = await one(
    `SELECT p.name FROM staff_checkposts sc
       JOIN checkposts c ON c.id = sc.checkpost_id AND c.is_active
       JOIN places p ON p.id = c.place_id
      WHERE sc.staff_id = $1 ORDER BY c.id LIMIT 1`, [staff.id]);
  const brand = process.env.FAST2SMS_OTP_BRAND || 'Pravesha';
  const label = (() => {
    const named = where ? `${where.name} checkpost` : '';
    return named && named.length <= 30 ? named : brand;
  })();
  const validity = `${MINUTES} minutes`;

  const testing = isTest(m);
  const code = testing ? TEST_CODE : mint();
  /* The same scrypt hashing the PINs used, rather than a second scheme and a new
     dependency for the sake of four digits. */
  const hash = await staffModule.hashPin(code);

  /* One live code at a time: whatever was outstanding stops being valid the
     moment a new one is asked for. */
  await query(
    `UPDATE staff_otps SET expires_at = now()
      WHERE mobile = $1 AND consumed_at IS NULL AND expires_at > now()`, [m]);

  const row = await one(
    `INSERT INTO staff_otps (staff_id, mobile, code_hash, expires_at, ip, is_test)
     VALUES ($1, $2, $3, now() + ($4 || ' minutes')::interval, $5, $6)
     RETURNING id, expires_at`,
    [staff.id, m, hash, String(MINUTES), ip, testing]);

  if (testing) {
    /* No SMS exists for a reserved number, so the flow is testable without one. */
    return {
      ok: true, expiresAt: row.expires_at, minutes: MINUTES, testCode: code,
      ...say('sent'),
    };
  }

  const out = await sms.send(m, [code, label, validity], { purpose: 'staff-otp' });
  await query(`UPDATE staff_otps SET delivery = $2 WHERE id = $1`,
    [row.id, JSON.stringify(out.record || { error: out.error, message: out.message })]);

  if (!out.ok) {
    /* A code nobody can read is worse than no code: it is retired at once so the
       staff member may ask again immediately rather than waiting out the timer. */
    await query(`UPDATE staff_otps SET expires_at = now() WHERE id = $1`, [row.id]);
    return out.error === 'not_configured'
      ? { ok: false, error: 'not_configured', ...say('not_configured') }
      : { ok: false, error: 'sms_failed', ...say('sms_failed'), detail: out.message };
  }

  return { ok: true, expiresAt: row.expires_at, minutes: MINUTES, ...say('sent') };
}

/**
 * The code, typed back.
 *
 * On success this opens the shift through the ordinary sign-in path, so
 * everything that has always been true of a shift — one per gate, one per
 * person, handovers recorded — stays true however somebody authenticated.
 */
async function verify({ mobile, code, checkpostId = null, deviceToken = null }) {
  const m = digits(mobile);
  const typed = String(code || '').replace(/\D/g, '');
  if (m.length !== 10) return { ok: false, error: 'bad_mobile', ...say('bad_mobile') };
  if (typed.length !== 4) return { ok: false, error: 'wrong', ...say('wrong') };

  const otp = await one(
    `SELECT * FROM staff_otps
      WHERE mobile = $1 AND consumed_at IS NULL
      ORDER BY sent_at DESC LIMIT 1`, [m]);

  if (!otp) return { ok: false, error: 'no_code', ...say('no_code') };
  if (new Date(otp.expires_at) <= new Date()) return { ok: false, error: 'expired', ...say('expired') };
  if (otp.attempts >= MAX_ATTEMPTS) return { ok: false, error: 'dead', ...say('dead') };

  const good = await staffModule.pinMatches(typed, otp.code_hash);
  if (!good) {
    const left = await one(
      `UPDATE staff_otps SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts`, [otp.id]);
    const remaining = Math.max(0, MAX_ATTEMPTS - Number(left.attempts));
    return remaining === 0
      ? { ok: false, error: 'dead', ...say('dead') }
      : { ok: false, error: 'wrong', attemptsLeft: remaining, ...say('wrong') };
  }

  /* Spent the moment it works, so the same code cannot open a second shift. */
  await query(`UPDATE staff_otps SET consumed_at = now() WHERE id = $1`, [otp.id]);

  const signed = await staffModule.signInVerified({ staffId: otp.staff_id, checkpostId, deviceToken });
  if (!signed.ok) return signed;

  require('../log').event('gate', 'in', `${signed.staff.name} · ••••${m.slice(-4)} · ${signed.checkpost.name}`);
  return signed;
}

module.exports = { MINUTES, MAX_ATTEMPTS, RESEND_SECONDS, PER_HOUR, SAYS, request, verify };
