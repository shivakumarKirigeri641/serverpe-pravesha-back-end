#!/usr/bin/env node
/**
 * cleanup.js — empty the transactional tables before a demo or a test run.
 *
 *   node scripts/cleanup.js                 show what would be deleted
 *   node scripts/cleanup.js --yes           delete it
 *   node scripts/cleanup.js --yes --cache   also drop the cached vehicle records
 *
 * WHAT IT DELETES: bookings, payments, invoices, gate entries, the WhatsApp
 * conversation, booking links, held capacity, the daily pass counter and website
 * contact messages. In other words, everything a test produced.
 *
 * WHAT IT KEEPS: everything somebody configured — destinations, slots, prices,
 * capacities, settings, the policies, checkposts and staff. Those are not test
 * data, and re-seeding them by hand before a demo is how a demo goes wrong.
 *
 * THE VEHICLE CACHE IS KEPT unless --cache is given. Each row there cost a paid
 * ULIP call, and keeping it means a demo of a plate looked up last week does not
 * spend another one.
 *
 * It refuses to run against a production database unless --force is also given:
 * this is the one script in the repository that destroys data.
 */

require('dotenv').config();
const { pool: getPool, query } = require('../src/gatepass/db');

const args = new Set(process.argv.slice(2));
const CONFIRMED = args.has('--yes');
const WITH_CACHE = args.has('--cache');
const FORCED = args.has('--force');

/* Order matters: children before parents, so foreign keys never block. */
const TABLES = [
  'scans',
  'staff_sessions',
  'invoices',
  'tickets',
  'payments',
  'slot_inventory',
  'pass_day_counters',
  'web_tokens',
  'wa_messages',
  'wa_sessions',
  'data_deletion_requests',
  'contact_messages',
  'api_calls',
  'event_log',
  'customers',
];

const CACHE_TABLES = ['vehicle_snapshots', 'vehicles'];

const KEEP = 'places, place_slots, place_pricing, slot_capacity, vehicle_categories, '
  + 'vehicle_class_map, vehicle_deny_rules, checkposts, staff, app_settings, legal_documents, legal_sections';

async function counts(tables) {
  const out = [];
  for (const t of tables) {
    try {
      const { rows } = await query(`SELECT count(*)::int AS n FROM ${t}`);
      out.push([t, rows[0].n]);
    } catch {
      /* A table from a migration this database has not applied. */
    }
  }
  return out;
}

(async () => {
  const target = `${process.env.PGDATABASEMAIN} @ ${process.env.PGHOST}`;
  const looksLive = /prod/i.test(String(process.env.NODE_ENV)) || /prod/i.test(String(process.env.PGHOST));
  if (looksLive && !FORCED) {
    console.error(`\n  Refusing: ${target} looks like production. Add --force if you are certain.\n`);
    await getPool().end();
    process.exit(1);
  }

  const tables = WITH_CACHE ? [...TABLES, ...CACHE_TABLES] : TABLES;
  const before = await counts(tables);
  const total = before.reduce((n, [, c]) => n + c, 0);

  console.log(`\n  ${target}`);
  for (const [t, n] of before) if (n) console.log(`    ${String(n).padStart(7)}  ${t}`);
  if (!total) console.log('    already empty');
  if (!WITH_CACHE) {
    const cache = await counts(CACHE_TABLES);
    const kept = cache.reduce((n, [, c]) => n + c, 0);
    if (kept) console.log(`\n  keeping ${kept} cached vehicle rows (--cache also clears them)`);
  }
  console.log(`\n  keeping configuration: ${KEEP}\n`);

  if (!CONFIRMED) {
    console.log('  Nothing deleted. Run again with --yes to delete.\n');
    await getPool().end();
    return;
  }

  /* One statement, one transaction: TRUNCATE with CASCADE would reach tables
     this script has not listed, so each is named and the identities restart so a
     fresh run starts at #1. */
  await query(`TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY`);
  console.log(`  Deleted ${total} rows from ${tables.length} tables.\n`);

  await getPool().end();
})().catch(async (e) => {
  console.error('\n  ' + e.message + '\n');
  await getPool().end();
  process.exit(1);
});
