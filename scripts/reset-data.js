/**
 * scripts/reset-data.js — empty the transactional tables, keep the setup.
 *
 *   node scripts/reset-data.js          show what would go, change nothing
 *   node scripts/reset-data.js --yes    actually do it
 *
 * Testing leaves a trail: a customer, a session, forty WhatsApp messages, a
 * vehicle looked up, a ticket, the inventory rows those touched. None of it is
 * wanted in a database that is about to be demonstrated, and picking it out by
 * hand is how the wrong row gets deleted.
 *
 * WHAT GOES: bookings, payments, scans, customers, vehicles, conversations,
 * events, closures and the day-by-day slot inventory.
 *
 * WHAT STAYS: places, slots, vehicle categories, prices, capacities, settings,
 * the investment and revenue tables, staff and admin accounts. Everything that
 * came from a migration or was configured on purpose.
 *
 * Staff and admin ACCOUNTS stay but their SESSIONS go, so a reset logs everyone
 * out without making anybody re-create a login.
 *
 * TWO GUARDS, because this is unrecoverable:
 *   - it refuses to run against a database whose name is not Pravesha's,
 *     which is what stops a stray .env pointing it at QuizPe;
 *   - it does nothing at all without --yes.
 */

require('dotenv').config();
const { query, tx } = require('../src/gatepass/db');

const GO = process.argv.includes('--yes');
const FORCE = process.argv.includes('--force-database');

/* Order matters only for readability — this truncates in one statement with
   CASCADE, so foreign keys between these tables are not a problem. */
const WIPE = [
  'web_tokens',
  'scans',
  'invoices',
  'tickets',
  'payments',
  'closures',
  'slot_inventory',
  'vehicle_snapshots',
  'vehicles',
  'event_log',
  'wa_messages',
  'wa_sessions',
  'customers',
  'api_calls',
  'admin_audit',
  'admin_sessions',
  'staff_sessions',
  'devices',
];

const KEEP = [
  'places', 'place_slots', 'vehicle_categories', 'vehicle_class_map',
  'place_pricing', 'slot_capacity', 'checkposts', 'app_settings',
  'investment_items', 'revenue_models', 'staff', 'staff_checkposts',
  'admin_users', 'schema_migrations',
];

(async () => {
  const db = process.env.PGDATABASEMAIN || '';

  if (!/pravesha/i.test(db) && !FORCE) {
    console.error(`\n  refusing to touch "${db}".`);
    console.error('  This only runs against a Pravesha database. If that is genuinely');
    console.error('  the one you mean, re-run with --force-database.\n');
    process.exit(1);
  }

  console.log(`\n  database: ${db} @ ${process.env.PGHOST}`);

  const counts = [];
  let total = 0;
  for (const t of WIPE) {
    try {
      const n = (await query(`SELECT count(*)::int AS c FROM ${t}`)).rows[0].c;
      if (n) { counts.push([t, n]); total += n; }
    } catch { /* table not present in this schema version */ }
  }

  if (!total) {
    console.log('  nothing to clear — already empty.\n');
    process.exit(0);
  }

  console.log(`\n  would delete ${total} row(s):`);
  for (const [t, n] of counts) console.log(`    ${t.padEnd(20)} ${n}`);

  if (!GO) {
    console.log('\n  nothing changed. Re-run with --yes to clear it.\n');
    process.exit(0);
  }

  /* One statement, one transaction: a half-cleared database with tickets gone
     but their scans still present is worse than either state. RESTART IDENTITY
     puts the sequences back to 1 so a fresh demo starts at ticket 1 rather
     than 3,029. */
  await tx(async (c) => {
    await c.query(`TRUNCATE TABLE ${WIPE.join(', ')} RESTART IDENTITY CASCADE`);

    /* RESTART IDENTITY only resets sequences OWNED by a truncated column, and
       the invoice series is a standalone sequence — it would otherwise survive
       a wipe and the first invoice of a fresh demo would be numbered 00042.
       Restarting a GST series is only ever acceptable because this script
       refuses to run outside a Pravesha database that is being reset for a
       demo; against real books it would be a serious thing to do. */
    await c.query('ALTER SEQUENCE IF EXISTS pravesha_invoice_seq RESTART WITH 1');
  });

  const after = [];
  for (const t of KEEP) {
    try {
      after.push(`${t}=${(await query(`SELECT count(*)::int AS c FROM ${t}`)).rows[0].c}`);
    } catch { /* not present */ }
  }

  console.log(`\n  cleared ${total} row(s).`);
  console.log(`  kept: ${after.join(', ')}\n`);
  process.exit(0);
})().catch((e) => { console.error('\n ', e.message, '\n'); process.exit(1); });
