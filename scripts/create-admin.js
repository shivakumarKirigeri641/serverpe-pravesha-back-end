/**
 * scripts/create-admin.js — the first way into the panel.
 *
 *   node scripts/create-admin.js "Name" 9886122415 "a good password" [role]
 *
 * Roles: admin (everything), department (sees everything, changes nothing),
 * viewer (dashboard and reports only). Give the DC's office a 'department'
 * account — they should be able to check any number at any time without being
 * able to move a price by accident.
 *
 * Run again with the same mobile number to reset that person's password.
 */

require('dotenv').config();
const admin = require('../src/gatepass/admin');

const [, , name, mobileRaw, password, role = 'admin'] = process.argv;

if (!name || !mobileRaw || !password) {
  console.error('\n  usage: node scripts/create-admin.js "Name" 9886122415 "password" [admin|department|viewer]\n');
  process.exit(1);
}

const mobile = String(mobileRaw).replace(/\D/g, '').slice(-10);
if (mobile.length !== 10) {
  console.error('\n  That does not look like a 10-digit mobile number.\n');
  process.exit(1);
}
/*
 * Eight characters in production, no floor on a laptop.
 *
 * A short password is fine while testing against a local database with test
 * Razorpay keys and no real visitors in it. It is not fine on the deployed
 * system, where this account can see every citizen's number and the
 * department's collections — so the rule is enforced by where it runs, not by
 * remembering to change it back.
 */
const LOCAL = process.env.NODE_ENV !== 'production';
if (password.length < 8 && !LOCAL) {
  console.error('\n  Use at least 8 characters. This account can see every visitor and every rupee.\n');
  process.exit(1);
}

(async () => {
  const a = await admin.create({ name, mobile, password, role });
  if (password.length < 8) {
    console.warn('\n  WARNING: short password — acceptable on a laptop, never on the server.');
  }
  console.log(`\n  ${a.role.padEnd(11)} ${a.name}  ·  ${a.mobile}`);
  console.log('\n  Sign in at /admin with that mobile number and password.\n');
  process.exit(0);
})().catch((e) => { console.error('\n', e.message, '\n'); process.exit(1); });
