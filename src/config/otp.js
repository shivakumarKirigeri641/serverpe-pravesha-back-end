/**
 * config/otp.js — whether sign-in codes are real, in one place (user, 2026-09-17).
 *
 *   IS_REAL_OTP=true   a random code is generated for every request and sent by
 *                      SMS: gate staff sign-in, admin panel sign-in, and the
 *                      code that proves a new person's number
 *   IS_REAL_OTP=false  (or unset) every code is 6416 and nothing is sent to
 *                      anybody
 *
 * Every screen that asks for a code reads this, so a server is either real
 * throughout or fixed throughout — never real for staff and fixed for the panel.
 *
 * A FIXED CODE ON A LIVE SERVER LETS ANYONE IN who knows a user's mobile number,
 * the Super Admin's included. The server says so loudly at start-up if
 * production runs with it off; whether to is the operator's decision, not this
 * file's.
 */

const crypto = require('crypto');

const DEFAULT_OTP = '6416';

const isRealOtp = () => /^(1|true|yes|on)$/i.test(String(process.env.IS_REAL_OTP || '').trim());

/* A code with no pattern in it: randomInt, not Math.random, when the whole
   secret is four digits. */
const mint = () => String(crypto.randomInt(0, 10000)).padStart(4, '0');

/** The code to issue now: a fresh random one when real, the fixed one when not. */
const newCode = () => (isRealOtp() ? mint() : DEFAULT_OTP);

module.exports = { DEFAULT_OTP, isRealOtp, newCode, mint };
