/**
 * temp-seed-origins.js — gives the demonstration vehicles somewhere to be from.
 *
 * WHY THIS EXISTS. Where a vehicle is registered is read off its number plate
 * and out of its registration certificate. The generated demonstration traffic
 * is all Karnataka and has no certificate behind it, so the "Where they come
 * from" screen has nothing to show. This writes plausible origins onto the
 * generated rows so the screen can be seen working.
 *
 * IT CALLS NOTHING. No ULIP, no VAHAN, no message to anybody: it only writes to
 * the database. The office names are written here by hand.
 *
 * IT IS FOR DEMONSTRATION DATA ONLY. Vehicles that carry a real registration
 * certificate we fetched (rc_status = 'ok') are left exactly as they are, so
 * nothing real is overwritten with something invented.
 *
 *   node scripts/temp-seed-origins.js            # 14% given out-of-state plates
 *   node scripts/temp-seed-origins.js --share=20
 *   node scripts/temp-seed-origins.js --undo     # takes the invented offices off
 *
 * Delete this file with the rest of the demonstration tooling before launch.
 */

require('dotenv').config();
const { query, one, tx } = require('../src/gatepass/db');

const NOTE = 'demo-origin';

/*
 * Karnataka's registering offices, by the code on the plate. Only the ones that
 * are long-standing and unambiguous are named; a code left out of this list is
 * shown on the screen as the bare code, which is the honest answer.
 */
const KA_OFFICES = {
  KA01: 'Bengaluru Central', KA02: 'Bengaluru West', KA03: 'Bengaluru East',
  KA04: 'Bengaluru North', KA05: 'Bengaluru South', KA06: 'Tumakuru',
  KA07: 'Kolar', KA09: 'Mysuru', KA10: 'Chamarajanagar', KA11: 'Mandya',
  KA12: 'Madikeri', KA13: 'Hassan', KA14: 'Shivamogga', KA15: 'Sagara',
  KA16: 'Chitradurga', KA17: 'Davanagere', KA18: 'Chikkamagaluru',
  KA19: 'Mangaluru', KA20: 'Udupi', KA21: 'Puttur', KA22: 'Belagavi',
  KA23: 'Chikkodi', KA24: 'Bailhongal', KA25: 'Hubballi-Dharwad', KA26: 'Gadag',
  KA27: 'Haveri', KA28: 'Vijayapura', KA29: 'Bagalkot', KA30: 'Karwar',
  KA31: 'Sirsi', KA32: 'Kalaburagi', KA33: 'Yadgir', KA34: 'Ballari',
  KA35: 'Hosapete', KA36: 'Raichur', KA37: 'Koppal', KA38: 'Bidar',
  KA41: 'Bengaluru North (Yeshwanthpur)', KA42: 'Ramanagara', KA44: 'Tiptur',
  KA51: 'Bengaluru (Electronic City)', KA53: 'Bengaluru (Jnanabharathi)',
};

/*
 * Who else comes up the hill, roughly as Chikkamagaluru actually sees it:
 * Kerala and Tamil Nadu first, then Maharashtra, the Telugu states and Goa,
 * with a thin tail of everybody else. `weight` is relative, not a percentage.
 */
const VISITING = [
  { code: 'KL', weight: 30, offices: [['11', 'Palakkad'], ['07', 'Thrissur'], ['01', 'Thiruvananthapuram'], ['09', 'Kozhikode'], ['02', 'Kollam']] },
  { code: 'TN', weight: 26, offices: [['09', 'Chennai Central'], ['38', 'Coimbatore'], ['43', 'Nilgiris'], ['33', 'Salem'], ['76', 'Hosur']] },
  { code: 'MH', weight: 13, offices: [['12', 'Pune'], ['01', 'Mumbai Central'], ['09', 'Kolhapur'], ['14', 'Pimpri-Chinchwad']] },
  { code: 'TG', weight: 10, offices: [['09', 'Hyderabad Central'], ['07', 'Rangareddy'], ['13', 'Nizamabad']] },
  { code: 'AP', weight: 7, offices: [['31', 'Visakhapatnam'], ['16', 'Vijayawada'], ['02', 'Anantapur']] },
  { code: 'GA', weight: 5, offices: [['03', 'Panaji'], ['06', 'Margao']] },
  { code: 'DL', weight: 3, offices: [['08', 'Delhi North West'], ['03', 'Delhi South']] },
  { code: 'GJ', weight: 2, offices: [['01', 'Ahmedabad'], ['05', 'Surat']] },
  { code: 'UP', weight: 2, offices: [['32', 'Lucknow'], ['16', 'Noida']] },
  { code: 'WB', weight: 1, offices: [['01', 'Kolkata']] },
  { code: 'RJ', weight: 1, offices: [['14', 'Jaipur']] },
];

const STATE_NAMES = require('../src/gatepass/rtoCodes').STATES;
const arg = (name, fallback) => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? found.split('=')[1] : fallback;
};
const pick = (list) => list[Math.floor(Math.random() * list.length)];

/** One draw from VISITING, by weight. */
function visitingState() {
  const total = VISITING.reduce((a, s) => a + s.weight, 0);
  let at = Math.random() * total;
  for (const s of VISITING) { at -= s.weight; if (at <= 0) return s; }
  return VISITING[0];
}

async function undo() {
  const r = await query(`UPDATE vehicles SET registered_at = NULL WHERE identity_note = $1`, [NOTE]);
  await query(`UPDATE vehicles SET identity_note = NULL WHERE identity_note = $1`, [NOTE]);
  console.log(`Took the invented offices off ${r.rowCount} vehicle(s). Plates are left as they are.`);
}

async function main() {
  if (process.argv.includes('--undo')) return undo();

  const share = Math.min(60, Math.max(0, Number(arg('share', '14'))));

  /* Only vehicles that actually came through a gate, and only generated ones:
     anything with a real certificate behind it is left alone. */
  const rows = (await query(
    `SELECT DISTINCT v.id, v.reg_no
       FROM vehicles v
       JOIN scans s ON s.reg_no = v.reg_no AND s.verdict IN ('valid','valid_override')
      WHERE (v.rc_status IS DISTINCT FROM 'ok' OR v.is_test)
      ORDER BY v.id`)).rows;
  if (rows.length === 0) { console.log('No generated vehicles have come through a gate yet — seed occupancy first.'); return; }

  const wanted = Math.round((rows.length * share) / 100);
  const shuffled = [...rows].sort(() => Math.random() - 0.5);
  const moving = new Set(shuffled.slice(0, wanted).map((r) => r.id));

  let moved = 0;
  let named = 0;
  await tx(async (client) => {
    const q = (text, params) => client.query(text, params);
    for (const v of rows) {
      if (moving.has(v.id)) {
        /* Out of state: a new plate, and the office that would have issued it.
           The plate changes everywhere it is written down, in one transaction,
           or a pass and its vehicle stop agreeing with each other. */
        const st = visitingState();
        const [rtoNumber, office] = pick(st.offices);
        const tail = String(v.reg_no).replace(/[^A-Za-z0-9]/g, '').slice(4) || '0001';
        let next = `${st.code}${rtoNumber}${tail}`;
        const clash = await q(`SELECT 1 FROM vehicles WHERE reg_no = $1 AND id <> $2`, [next, v.id]);
        if (clash.rows.length) next = `${st.code}${rtoNumber}${tail.slice(0, -1)}${Math.floor(Math.random() * 10)}`;

        const stateName = (STATE_NAMES[st.code] || ['India'])[0];
        await q(`UPDATE vehicles SET reg_no = $1, registered_at = $2, identity_note = $3 WHERE id = $4`,
          [next, `${office} RTO, ${stateName}`, NOTE, v.id]);
        await q(`UPDATE tickets SET reg_no = $1 WHERE reg_no = $2`, [next, v.reg_no]);
        await q(`UPDATE scans   SET reg_no = $1 WHERE reg_no = $2`, [next, v.reg_no]);
        moved += 1;
        named += 1;
      } else {
        /* Staying in Karnataka: only the office name is filled in, and only
           where the code on the plate is one we can name with confidence. */
        const office = KA_OFFICES[String(v.reg_no).slice(0, 4).toUpperCase()];
        if (!office) continue;
        await q(`UPDATE vehicles SET registered_at = $1, identity_note = $2 WHERE id = $3`,
          [`${office} RTO, Karnataka`, NOTE, v.id]);
        named += 1;
      }
    }
  });

  console.log(`${rows.length} vehicles seen at a gate. ${moved} given out-of-state plates, ${named} given a registering office.`);
  const check = await one(
    `SELECT count(DISTINCT left(reg_no, 2)) AS states, count(registered_at) AS with_office FROM vehicles`);
  console.log(`Now: ${check.states} state codes on the plates, ${check.with_office} vehicles with an office.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
