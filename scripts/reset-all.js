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
 * WHAT IS KEPT
 *   policies        legal_documents, legal_sections
 *   pricing         the default destination's prices, and the vehicle types,
 *                   class map and refusal rules the prices are built on
 *   the destination the default one (the first active place) with its slots
 *                   and capacity — enabled
 *   the checkpost   the default one (its first checkpost) — enabled
 *   running it      admin users and their sessions (so nobody is signed out
 *                   mid-click), app settings, the business content shown on the
 *                   site (revenue models, investment items), the audit trail,
 *                   and the migration history
 *
 * WHAT GOES — everything else, including: every pass, payment, invoice and
 * refund; every gate check, shift, photo and handover; every visitor, WhatsApp
 * conversation, feedback and link; staff and their postings (re-enable their
 * numbers under Checkpost staff); the watchlist; the vehicle cache; reports,
 * alerts, announcements and closures; remittances and expenses; the other
 * destinations with their slots, capacity, prices and checkposts.
 *
 * THE AUDIT TRAIL STAYS on purpose: it is how anybody later can see that the
 * database was cleaned, when, and by whom. Nothing else in it describes data.
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
  'vehicle_categories', 'vehicle_class_map', 'vehicle_deny_rules',
  'admin_users', 'admin_sessions', 'admin_audit',
  'app_settings', 'revenue_models', 'investment_items',
  'schema_migrations',
];

/* Kept, but only the default destination's rows. */
const KEEP_DEFAULT_PLACE = ['places', 'place_slots', 'slot_capacity', 'place_pricing', 'checkposts'];

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
    const kept = new Set([...KEEP_WHOLE, ...KEEP_DEFAULT_PLACE]);
    const empty = all.filter((t) => !kept.has(t));

    const place = (await rows(`SELECT id, name FROM places ORDER BY is_active DESC, id LIMIT 1`))[0];
    if (!place) throw new Error('There is no destination at all — nothing to keep as the default.');
    const checkpost = (await rows(`SELECT id, name FROM checkposts WHERE place_id = $1 ORDER BY is_active DESC, id LIMIT 1`, [place.id]))[0];

    console.log(EXECUTE ? '\nCLEANING THE DATABASE\n' : '\nDRY RUN — nothing will be changed. Add --yes to do it.\n');
    console.log(`Database: ${(await rows('SELECT current_database() AS d'))[0].d}\n`);

    console.log('EMPTIED');
    for (const t of empty) {
      const n = await count(t);
      if (n) console.log(`  ${t.padEnd(26)} ${n}`);
    }
    const otherPlaces = await rows(`SELECT name FROM places WHERE id <> $1 ORDER BY id`, [place.id]);
    const otherCheckposts = await rows(`SELECT name FROM checkposts WHERE id <> $1 ORDER BY id`, [checkpost ? checkpost.id : 0]);
    if (otherPlaces.length) console.log(`  other destinations         ${otherPlaces.map((p) => p.name).join(', ')} (with their slots, capacity and prices)`);
    if (otherCheckposts.length) console.log(`  other checkposts           ${otherCheckposts.map((c) => c.name).join(', ')}`);

    console.log('\nKEPT');
    console.log(`  default destination        ${place.name} — enabled, with its slots, capacity and prices`);
    console.log(`  default checkpost          ${checkpost ? `${checkpost.name} — enabled` : 'none exists for this destination'}`);
    for (const t of KEEP_WHOLE) if (all.includes(t)) console.log(`  ${t.padEnd(26)} ${await count(t)}`);

    if (!EXECUTE) { console.log('\nNothing was changed.\n'); return; }

    await client.query('BEGIN');

    /* One statement, so the order of foreign keys does not matter, and without
       CASCADE, so it cannot reach a kept table by accident — it would refuse
       instead. Identities restart, so the first new row of each is 1. */
    if (empty.length) await client.query(`TRUNCATE TABLE ${empty.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY`);

    /* The other destinations, children first. */
    await client.query(`DELETE FROM checkposts WHERE id <> $1`, [checkpost ? checkpost.id : 0]);
    for (const t of ['place_pricing', 'slot_capacity', 'place_slots']) {
      await client.query(`DELETE FROM ${t} WHERE place_id <> $1`, [place.id]);
    }
    await client.query(`DELETE FROM places WHERE id <> $1`, [place.id]);

    /* The two that stay are switched on. */
    await client.query(`UPDATE places SET is_active = true WHERE id = $1`, [place.id]);
    if (checkpost) await client.query(`UPDATE checkposts SET is_active = true WHERE id = $1`, [checkpost.id]);

    /* Counters and switches. */
    const seq = await rows(`SELECT to_regclass('public.pravesha_invoice_seq') AS s`);
    if (seq[0].s) await client.query(`SELECT setval('pravesha_invoice_seq', 1, false)`);
    await client.query(`DELETE FROM app_settings WHERE key LIKE 'report_sent_%'`);
    await client.query(`UPDATE app_settings SET value = 'false' WHERE key = 'simulation_enabled'`);
    await client.query(`DELETE FROM app_settings WHERE key IN ('simulation_started_at', 'simulation_until')`);

    await client.query('COMMIT');

    console.log('\nDone.');
    console.log(`  destinations   ${await count('places')}  (${place.name})`);
    console.log(`  checkposts     ${await count('checkposts')}${checkpost ? `  (${checkpost.name})` : ''}`);
    console.log(`  passes         ${await count('tickets')}`);
    console.log(`  visitors       ${await count('customers')}`);
    console.log(`  staff          ${await count('staff')}`);
    console.log(`  policies       ${await count('legal_documents')} documents\n`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\nFailed, and rolled back — nothing was changed:', e.message, '\n');
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main().then(() => process.exit(process.exitCode || 0));
