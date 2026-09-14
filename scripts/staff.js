#!/usr/bin/env node
/**
 * staff.js — add checkpost staff from the command line.
 *
 * The admin panel is the usual place for this. Staff have no PIN: once their
 * mobile number is added and enabled they sign in to the gate app with a code
 * sent to that number, and disabling them is how access is taken away.
 *
 *   node scripts/staff.js list
 *   node scripts/staff.js checkposts
 *   node scripts/staff.js add "Ramesh K" 9886122415 1        # checkpost id 1
 *   node scripts/staff.js disable 9886122415
 */

require('dotenv').config();
const { pool: getPool, query, one } = require('../src/gatepass/db');
const staff = require('../src/gatepass/staff');

const [cmd, ...args] = process.argv.slice(2);

async function main() {
  switch (cmd) {
    case 'checkposts': {
      const { rows } = await query(
        `SELECT c.id, c.name, p.name AS place, c.is_active
           FROM checkposts c JOIN places p ON p.id = c.place_id ORDER BY c.id`);
      rows.forEach((r) => console.log(`${String(r.id).padStart(3)}  ${r.place} — ${r.name}${r.is_active ? '' : '  (inactive)'}`));
      return;
    }

    case 'list': {
      const { rows } = await query(
        `SELECT s.id, s.name, s.mobile, s.is_active,
                COALESCE(string_agg(c.name, ', ' ORDER BY c.name), '—') AS posts,
                (SELECT started_at FROM staff_sessions ss WHERE ss.staff_id = s.id AND ss.ended_at IS NULL) AS on_duty_since
           FROM staff s
           LEFT JOIN staff_checkposts sc ON sc.staff_id = s.id
           LEFT JOIN checkposts c ON c.id = sc.checkpost_id
          GROUP BY s.id ORDER BY s.id`);
      if (!rows.length) return console.log('no staff yet — add one with: node scripts/staff.js add "Name" 9876543210 1');
      rows.forEach((r) => console.log(
        `${String(r.id).padStart(3)}  ${r.name.padEnd(22)} ${r.mobile}  ${r.posts}` +
        `${r.is_active ? '' : '  [disabled]'}` +
        `${r.on_duty_since ? `  [on duty since ${new Date(r.on_duty_since).toLocaleString('en-IN')}]` : ''}`));
      return;
    }

    case 'add': {
      const [name, mobile, checkpostId] = args;
      if (!name || !mobile || !checkpostId) throw new Error('usage: add "Name" <mobile> <checkpostId>');
      const post = await one('SELECT c.id, c.name, p.name AS place FROM checkposts c JOIN places p ON p.id = c.place_id WHERE c.id = $1', [checkpostId]);
      if (!post) throw new Error(`no checkpost with id ${checkpostId} — run: node scripts/staff.js checkposts`);
      const row = await staff.upsert({ name, mobile, checkpostIds: [post.id] });
      console.log(`\n  ${row.name} — ${row.mobile}`);
      console.log(`  posted to ${post.place} — ${post.name}`);
      console.log('  enabled: they sign in to the gate app with a code sent to this number\n');
      return;
    }

    case 'disable': {
      const [mobile] = args;
      if (!mobile) throw new Error('usage: disable <mobile>');
      const m = staff.localMobile(mobile);
      const { rows: off } = await query('UPDATE staff SET is_active = false, modified_at = now() WHERE mobile = $1 RETURNING name', [m]);
      if (!off.length) throw new Error(`no staff with mobile ${m}`);
      /* Disabling must also end the shift, or the phone in their hand keeps working. */
      await query(`UPDATE staff_sessions ss SET ended_at = now(), ended_reason = 'signed_out'
                     FROM staff s WHERE s.id = ss.staff_id AND s.mobile = $1 AND ss.ended_at IS NULL`, [m]);
      console.log(`${off[0].name} disabled and signed out`);
      return;
    }

    default:
      console.log(require('fs').readFileSync(__filename, 'utf8').split('*/')[0].split('\n').slice(2).join('\n').replace(/^ \* ?/gm, ''));
  }
}

main()
  .then(() => getPool().end())
  .catch(async (e) => { console.error('\n  ' + e.message + '\n'); await getPool().end(); process.exit(1); });
