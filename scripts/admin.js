#!/usr/bin/env node
/**
 * admin.js — create the people who may open the admin panel.
 *
 *   node scripts/admin.js list
 *   node scripts/admin.js add "Shivakumar" 9886122415 admin
 *   node scripts/admin.js add "Tourism Dept" 9999999999 department SomePassword1
 *   node scripts/admin.js password 9886122415          # new password
 *   node scripts/admin.js disable 9886122415
 *
 * Roles: admin (everything), department (see and operate), viewer (read only).
 * A generated password is printed once; it is stored only as a scrypt hash.
 */

require('dotenv').config();
const crypto = require('crypto');
const { pool: getPool, query, one } = require('../src/gatepass/db');
const admin = require('../src/gatepass/admin');

/* Readable, typed once, long enough: four short words and a number beats a
   random string somebody will write on a sticky note. */
const WORDS = ['ridge', 'monsoon', 'summit', 'coffee', 'cloud', 'valley', 'shola', 'peak', 'trail', 'mist'];
const newPassword = () => {
  const pick = () => WORDS[crypto.randomInt(WORDS.length)];
  return `${pick()}-${pick()}-${crypto.randomInt(10, 100)}`;
};

const [cmd, ...args] = process.argv.slice(2);

async function main() {
  switch (cmd) {
    case 'list': {
      const { rows } = await query(
        `SELECT id, name, mobile, role, is_active, last_login_at, locked_until FROM admin_users ORDER BY id`);
      if (!rows.length) return console.log('no admin users yet — add one with: node scripts/admin.js add "Name" 9876543210 admin');
      rows.forEach((r) => console.log(
        `${String(r.id).padStart(3)}  ${r.name.padEnd(22)} ${r.mobile}  ${r.role.padEnd(11)}`
        + `${r.is_active ? '' : ' [disabled]'}`
        + `${r.locked_until && new Date(r.locked_until) > new Date() ? ' [locked]' : ''}`
        + `${r.last_login_at ? `  last in ${new Date(r.last_login_at).toLocaleString('en-IN')}` : '  never signed in'}`));
      return;
    }

    case 'add': {
      const [name, mobile, role = 'admin', given] = args;
      if (!name || !mobile) throw new Error('usage: add "Name" <mobile> [role] [password]');
      const password = given || newPassword();
      const row = await admin.upsert({ name, mobile, password, role });
      console.log(`\n  ${row.name} — ${row.mobile}  (${row.role})`);
      console.log(`  password: ${password}      (shown once; stored hashed)\n`);
      return;
    }

    case 'password': {
      const [mobile, given] = args;
      if (!mobile) throw new Error('usage: password <mobile> [password]');
      const m = admin.localMobile(mobile);
      const existing = await one('SELECT * FROM admin_users WHERE mobile = $1', [m]);
      if (!existing) throw new Error(`no admin user with mobile ${m}`);
      const password = given || newPassword();
      await query(
        `UPDATE admin_users SET password_hash = $2, failed_attempts = 0, locked_until = NULL, modified_at = now()
          WHERE id = $1`, [existing.id, await admin.hashPassword(password)]);
      console.log(`\n  ${existing.name} — new password: ${password}\n`);
      return;
    }

    case 'disable': {
      const [mobile] = args;
      if (!mobile) throw new Error('usage: disable <mobile>');
      const m = admin.localMobile(mobile);
      const { rows } = await query(
        'UPDATE admin_users SET is_active = false, modified_at = now() WHERE mobile = $1 RETURNING name', [m]);
      if (!rows.length) throw new Error(`no admin user with mobile ${m}`);
      /* Disabling must also end their session, or the open tab keeps working. */
      await query(`UPDATE admin_sessions s SET ended_at = now()
                     FROM admin_users u WHERE u.id = s.admin_id AND u.mobile = $1 AND s.ended_at IS NULL`, [m]);
      console.log(`${rows[0].name} disabled and signed out`);
      return;
    }

    default:
      console.log('  list | add "Name" <mobile> [role] [password] | password <mobile> | disable <mobile>');
  }
}

main()
  .then(() => getPool().end())
  .catch(async (e) => { console.error('\n  ' + e.message + '\n'); await getPool().end(); process.exit(1); });
