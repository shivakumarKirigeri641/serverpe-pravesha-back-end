/**
 * scripts/seed-demo-staff.js — one gate, two people, two phones.
 *
 *   node scripts/seed-demo-staff.js
 *
 * The admin panel does this properly. This exists so the demo can be set up
 * from a laptop in a minute, and so the PINs and device links are printed
 * somewhere they can be copied from.
 *
 * Running it again resets the PINs rather than creating duplicate staff — which
 * is what you want the morning of a demo when nobody remembers the number.
 */

require('dotenv').config();
const db = require('../src/gatepass/db');
const staff = require('../src/gatepass/staff');

const PEOPLE = [
  // Names only. A staff member is identified by their PIN and their checkpost;
  // inventing phone numbers for them would put fictional people's numbers into a
  // government system.
  { name: 'Ravi Kumar' },
  { name: 'Suresh Gowda' },
];

const PHONES = [
  { label: 'Gate phone 1', primary: true },
  { label: 'Gate phone 2 (backup)', primary: false },
];

(async () => {
  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  const cp = await db.one(
    `SELECT c.*, p.name AS place_name FROM checkposts c
       JOIN places p ON p.id = c.place_id
      WHERE p.code = 'MULLAYANAGIRI' ORDER BY c.id LIMIT 1`);

  if (!cp) { console.error('No checkpost found — run the migrations first.'); process.exit(1); }

  console.log(`\n${cp.place_name} · ${cp.name}\n`);
  console.log('STAFF');

  for (const p of PEOPLE) {
    let row = await db.one('SELECT * FROM staff WHERE name = $1', [p.name]);
    let pin;
    if (row) {
      pin = await staff.resetPin(row.id);
      await db.query(
        `INSERT INTO staff_checkposts (staff_id, checkpost_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`, [row.id, cp.id]);
    } else {
      const made = await staff.create({ name: p.name, checkpostIds: [cp.id] });
      row = made.staff; pin = made.pin;
    }
    console.log(`  ${row.name.padEnd(16)} PIN ${pin}`);
  }

  console.log('\nDEVICES  (open the link once on each phone — it remembers)');
  for (const ph of PHONES) {
    let d = await db.one(
      'SELECT * FROM devices WHERE checkpost_id = $1 AND label = $2', [cp.id, ph.label]);
    if (!d) {
      const made = await staff.registerDevice({
        checkpostId: cp.id, label: ph.label, isPrimary: ph.primary });
      d = made.device;
    }
    console.log(`  ${ph.label}`);
    console.log(`    ${base}/scan?device=${d.device_token}`);
  }

  console.log('\nOnly one of these phones can hold the gate at a time.');
  console.log('Signing in on the second one offers a takeover, and records it.\n');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
