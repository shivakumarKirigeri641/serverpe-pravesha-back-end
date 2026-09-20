#!/usr/bin/env node
/**
 * clean-db.js — empty the operational data, keep the configuration.
 *
 * WHAT THIS IS FOR. Between building and demonstrating, the database fills with
 * test bookings, test visitors, WhatsApp transcripts and the sessions of
 * whoever was signed in. None of it should be on screen in front of a customer,
 * and deleting it by hand table by table gets the order wrong and leaves
 * orphans behind.
 *
 * THE KEEP LIST IS THE SPECIFICATION, NOT THE DELETE LIST. Everything not
 * named in KEEP is emptied. That way a table added next month is wiped by
 * default rather than silently surviving because nobody remembered to add it
 * here — the failure mode of a delete list is a demo with last month's data in
 * one corner of one screen, which is the exact thing this script exists to
 * prevent.
 *
 * WHAT SURVIVES is what the platform cannot invent for itself: the settings,
 * the legal documents, the destination with its slots, capacities and prices,
 * the vehicle categories and their rules, and the administrator accounts —
 * without the last of those nobody could sign in to set the rest up again.
 *
 * WHAT DOES NOT SURVIVE, and has to be re-created afterwards: checkposts and
 * gate staff. That is deliberate and was asked for; the script says so at the
 * end rather than letting it be discovered at a barrier.
 *
 *   node scripts/clean-db.js              # show what would go, change nothing
 *   node scripts/clean-db.js --yes        # do it
 *
 * TRUNCATE ... CASCADE in one transaction, so there is no window in which half
 * the tables are empty, and no need to work out the foreign-key order by hand.
 */

const { query, tx } = require('../src/gatepass/db');

/* Configuration and reference data. Emptying any of these means re-seeding
   before a single pass can be sold. */
const KEEP = new Set([
  'schema_migrations',
  'app_settings',
  'legal_documents', 'legal_sections',
  'places', 'place_slots', 'place_pricing', 'slot_capacity',
  'vehicle_categories', 'vehicle_class_map', 'vehicle_deny_rules',
  'revenue_models', 'investment_items',
  /* Without an administrator there is no way back in. */
  'admin_users',
  /*
   * A checkpost is a barrier that exists in the world, not a row somebody made
   * while testing, so it belongs with the configuration. It is also
   * load-bearing: admin_users.checkpost_id references it, so TRUNCATE CASCADE
   * on checkposts silently empties every administrator account and locks
   * everyone out of the panel. Found the hard way on 2026-09-20 — the cascade
   * check below now refuses to let it happen again.
   */
  'checkposts',
]);

/* Emptied, and their numbering restarted, so the first pass after this is
   pass 1 and the first invoice is .../000001 rather than continuing a series
   that has nothing behind it. */
const SEQUENCES = ['pravesha_invoice_seq'];

async function tables() {
  const { rows } = await query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`);
  return rows.map((r) => r.table_name);
}

/**
 * Which kept tables a CASCADE would reach.
 *
 * TRUNCATE ... CASCADE does not stop at the tables it is given: it follows
 * every foreign key pointing at them. A kept table that references a wiped one
 * is therefore emptied too, silently, inside the same transaction. That is how
 * the administrator accounts disappeared the first time this ran. It is now
 * computed before anything is touched, and the run refuses.
 */
async function cascadeRisk(wipe, kept) {
  const { rows } = await query(
    `SELECT tc.table_name AS child, ccu.table_name AS parent
       FROM information_schema.table_constraints tc
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`);
  const wiped = new Set(wipe);
  const keptSet = new Set(kept);
  const hits = new Map();
  for (const r of rows) {
    if (keptSet.has(r.child) && wiped.has(r.parent) && r.child !== r.parent) {
      if (!hits.has(r.child)) hits.set(r.child, new Set());
      hits.get(r.child).add(r.parent);
    }
  }
  return [...hits].map(([child, parents]) => ({ child, parents: [...parents] }));
}

async function counts(names) {
  const out = {};
  for (const t of names) {
    // eslint-disable-next-line no-await-in-loop
    out[t] = Number((await query(`SELECT count(*) AS c FROM "${t}"`)).rows[0].c);
  }
  return out;
}

async function main() {
  const go = process.argv.includes('--yes');
  const all = await tables();
  const wipe = all.filter((t) => !KEEP.has(t));
  const before = await counts(all);

  const kept = all.filter((t) => KEEP.has(t));
  const rows = wipe.reduce((a, t) => a + before[t], 0);

  console.log('\nKEEPING (%d tables):', kept.length);
  console.log('  ' + kept.map((t) => `${t}=${before[t]}`).join('\n  '));
  console.log('\nEMPTYING (%d tables, %d rows):', wipe.length, rows);
  console.log('  ' + wipe.filter((t) => before[t] > 0).map((t) => `${t}=${before[t]}`).join('\n  '));
  const empty = wipe.filter((t) => before[t] === 0).length;
  if (empty) console.log('  (and %d already empty)', empty);

  /* Checked on a dry run too — the whole point is to find out before, not after. */
  const risk = await cascadeRisk(wipe, kept);
  if (risk.length) {
    console.log('\nREFUSING TO RUN — CASCADE would also empty these kept tables:');
    for (const r of risk) console.log('  %s  (references %s)', r.child, r.parents.join(', '));
    console.log('\nEither move those parents into KEEP, or accept the loss by taking the child out of it.\n');
    process.exitCode = 1;
    return;
  }

  if (!go) {
    console.log('\nNothing was changed. Re-run with --yes to empty these.\n');
    return;
  }

  await tx(async (client) => {
    await client.query(`TRUNCATE TABLE ${wipe.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
    for (const s of SEQUENCES) {
      // eslint-disable-next-line no-await-in-loop
      await client.query(`ALTER SEQUENCE "${s}" RESTART WITH 1`);
    }
  });

  const after = await counts(all);
  const leftover = wipe.filter((t) => after[t] > 0);
  const lost = kept.filter((t) => after[t] !== before[t]);

  console.log('\nDone. %d rows removed.', rows - wipe.reduce((a, t) => a + after[t], 0));
  if (leftover.length) console.log('STILL NOT EMPTY: %s', leftover.join(', '));
  /* CASCADE reaches past the list it was given. If it took something from the
     keep list, that is a schema surprise and has to be said out loud. */
  if (lost.length) console.log('WARNING — CASCADE also emptied kept tables: %s', lost.map((t) => `${t} ${before[t]}→${after[t]}`).join(', '));

  console.log('\nRe-create before the gate app can be used:');
  console.log('  1. a checkpost  (admin panel → Places → Checkposts)');
  console.log('  2. gate staff   (admin panel → Operate → Checkpost staff → Add person)');
  console.log('Kept: settings, legal documents, %s with its slots/prices, vehicle categories, %d admin user(s).\n',
    (await query('SELECT name FROM places LIMIT 1')).rows[0]?.name || 'the destination', after.admin_users);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.stack || e.message); process.exit(1); });
