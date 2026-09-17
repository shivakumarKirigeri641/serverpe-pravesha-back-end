#!/usr/bin/env node
/**
 * scripts/reset-all.js — empty the database back to a clean, working start.
 *
 *   node scripts/reset-all.js           shows what would go and what stays; changes nothing
 *   node scripts/reset-all.js --yes     does it, in one transaction
 *
 * The admin panel's "Clean the database" action runs this with --yes.
 *
 * WHY A LIST OF WHAT STAYS, NOT A LIST OF WHAT GOES. The earlier clean-ups named
 * the tables they emptied, and every table added since — the watchlist, gate
 * photos, remittances, the vehicle cache, shifts — quietly survived them. Here
 * the tables that are kept are named, and every other table in the database is
 * emptied. A table added next month is cleaned without anybody remembering to.
 *
 * WHAT IS KEPT (user, 2026-09-17: "cleans everything except policies,
 * destinations, checkposts")
 *   policies        legal_documents, legal_sections
 *   destinations    every place, as it is — enabled or not — with its slots,
 *                   capacity and prices
 *   checkposts      every checkpost, as it is
 *   what those need to work at all
 *                   the vehicle types, class map and refusal rules the prices
 *                   are built on; app settings; the business content the site
 *                   shows (revenue models, investment items); the migration
 *                   history; and the super administrators with their sessions,
 *                   so whoever pressed the button is not signed out and can
 *                   still get in afterwards
 *
 * WHAT GOES — everything else: every pass, payment, invoice and refund; every
 * gate check, shift, photo and handover; every visitor, WhatsApp conversation,
 * feedback and link; staff and their postings; every other panel user; sign-in
 * codes; the watchlist; the vehicle cache; reports, alerts, announcements and
 * closures; remittances and expenses; API call logs; and the audit trail — which
 * then gets one entry saying the database was cleaned.
 *
 * AND THE COUNTERS restart: invoices at PRV/26-27/000001, pass numbers at 1 for
 * every date, row ids at 1. Demonstration traffic is switched off, and the
 * evening-report markers are cleared.
 *
 * It refuses a database that looks like production unless --force is given.
 */

require('dotenv').config();
const { pool } = require('../src/gatepass/db');

const EXECUTE = process.argv.includes('--yes');
const FORCED = process.argv.includes('--force');

/* Kept whole. */
const KEEP_WHOLE = [
  'legal_documents', 'legal_sections',
  'places', 'place_slots', 'slot_capacity', 'place_pricing', 'checkposts',
  'vehicle_categories', 'vehicle_class_map', 'vehicle_deny_rules',
  'app_settings', 'revenue_models', 'investment_items',
  'schema_migrations',
];

/* Kept, but only the super administrators' rows. */
const KEEP_SUPER_ADMIN = ['admin_users', 'admin_sessions'];

async function main() {
  const target = `${process.env.PGDATABASEMAIN || ''} @ ${process.env.PGHOST || ''}`;
  const looksLive = /prod/i.test(String(process.env.NODE_ENV)) || /prod/i.test(String(process.env.PGHOST));
  if (looksLive && !FORCED) {
    console.error(`\nRefusing: ${target} looks like production. Add --force if you are certain.\n`);
    process.exitCode = 1;
    return;
  }

  const client = await pool().connect();
  const rows = async (sql, params) => (await client.query(sql, params)).rows;
  const count = async (t) => Number((await rows(`SELECT count(*)::int AS c FROM ${t}`))[0].c);

  try {
    const all = (await rows(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`)).map((r) => r.tablename);
    const kept = new Set([...KEEP_WHOLE, ...KEEP_SUPER_ADMIN]);
    const empty = all.filter((t) => !kept.has(t));

    const supers = await rows(`SELECT id, name, mobile FROM admin_users WHERE role = 'super_admin' ORDER BY id`);
    if (!supers.length) throw new Error('There is no super administrator — nobody could sign in afterwards.');
    const others = await rows(`SELECT name, role FROM admin_users WHERE role <> 'super_admin' ORDER BY id`);

    console.log(EXECUTE ? '\nCLEANING THE DATABASE\n' : '\nDRY RUN — nothing will be changed. Add --yes to do it.\n');
    console.log(`Database: ${(await rows('SELECT current_database() AS d'))[0].d}\n`);

    console.log('EMPTIED');
    for (const t of empty) {
      const n = await count(t);
      if (n) console.log(`  ${t.padEnd(26)} ${n}`);
    }
    if (others.length) console.log(`  other panel users          ${others.map((u) => `${u.name} (${u.role})`).join(', ')}`);

    console.log('\nKEPT');
    for (const t of KEEP_WHOLE) if (all.includes(t)) console.log(`  ${t.padEnd(26)} ${await count(t)}`);
    console.log(`  super administrators       ${supers.map((u) => `${u.name} ••••${String(u.mobile).slice(-4)}`).join(', ')}`);

    if (!EXECUTE) { console.log('\nNothing was changed.\n'); return; }

    await client.query('BEGIN');

    /* One statement, so the order of foreign keys does not matter, and without
       CASCADE, so it cannot reach a kept table by accident — it would refuse
       instead. Identities restart, so the first new row of each is 1. */
    if (empty.length) await client.query(`TRUNCATE TABLE ${empty.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY`);

    /* Panel users other than the super administrators, sessions first. */
    await client.query(`DELETE FROM admin_sessions WHERE admin_id NOT IN (SELECT id FROM admin_users WHERE role = 'super_admin')`);
    await client.query(`DELETE FROM admin_users WHERE role <> 'super_admin'`);

    /* Counters and switches. */
    const seq = await rows(`SELECT to_regclass('public.pravesha_invoice_seq') AS s`);
    if (seq[0].s) await client.query(`SELECT setval('pravesha_invoice_seq', 1, false)`);
    await client.query(`DELETE FROM app_settings WHERE key LIKE 'report_sent_%'`);
    await client.query(`UPDATE app_settings SET value = 'false' WHERE key = 'simulation_enabled'`);
    await client.query(`DELETE FROM app_settings WHERE key IN ('simulation_started_at', 'simulation_until')`);

    /* The audit trail was emptied with the rest; its first entry says so. */
    await client.query(
      `INSERT INTO admin_audit (admin_id, action, detail) VALUES ($1, 'database_cleaned', $2)`,
      [supers[0].id, JSON.stringify({ kept: [...KEEP_WHOLE, 'super administrators'], by: 'scripts/reset-all.js' })]);

    await client.query('COMMIT');

    console.log('\nDone.');
    console.log(`  destinations   ${await count('places')}`);
    console.log(`  checkposts     ${await count('checkposts')}`);
    console.log(`  policies       ${await count('legal_documents')} documents`);
    console.log(`  panel users    ${await count('admin_users')} (super administrators)`);
    console.log(`  passes         ${await count('tickets')} · visitors ${await count('customers')} · staff ${await count('staff')}\n`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\nFailed, and rolled back — nothing was changed:', e.message, '\n');
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main().then(() => process.exit(process.exitCode || 0));
