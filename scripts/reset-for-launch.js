/**
 * scripts/reset-for-launch.js — start the books at 1, once, before going live.
 *
 *   node scripts/reset-for-launch.js          shows what WOULD be removed; changes nothing
 *   node scripts/reset-for-launch.js --yes    does it, in one transaction
 *
 * WHY THE BOOKINGS GO WITH THE COUNTERS. The GST invoice series is audited for
 * holes and for repeats. Resetting the counter to 1 while PRV/26-27/000001
 * already exists would issue that number a second time — a duplicate invoice
 * number is worse than any gap. So the counter can only go back to 1 together
 * with every invoice, pass and payment made during testing.
 *
 * WHAT IS KEPT — how the service runs, not what happened in it:
 *   places, slots, capacity, pricing, vehicle categories and rules, checkposts
 *   and their coordinates, staff and their postings, panel users, legal
 *   documents, app settings, the audit trail, and the vehicle cache (every row
 *   in it is a paid lookup that would otherwise be bought again).
 *
 * WHAT IS REMOVED — everything a visitor or a gate did during testing:
 *   passes, payments, invoices, gate checks, grants, photographs, feedback,
 *   visitors, WhatsApp conversations, links, OTP codes, shifts, reports, alerts,
 *   remittances, expenses; places taken in every slot go back to zero.
 *
 * AND THE COUNTERS: the invoice series restarts at PRV/26-27/000001, pass
 * numbers restart at 1 for every date, and the evening-report markers are
 * cleared so the first real evening is not mistaken for one already sent.
 *
 * IT IS RE-RUNNABLE. Run it now, test some more, run it again the morning you
 * launch. It is not something to run after the first real visitor has paid.
 */

require('dotenv').config();
const { pool } = require('../src/gatepass/db');

const EXECUTE = process.argv.includes('--yes');

/* Children before parents, so no foreign key refuses a delete. */
const REMOVE = [
  'gate_photos', 'feedback', 'scans', 'invoices', 'ticket_grants', 'web_tokens',
  'tickets', 'payments', 'pass_day_counters',
  'wa_messages', 'wa_sessions', 'event_log', 'negative_reviews', 'data_deletion_requests',
  'contact_messages', 'customers',
  'staff_otps', 'staff_sessions', 'devices',
  'admin_reports', 'alert_acks', 'announcements', 'closures',
  'department_remittances', 'finance_expenses',
];

const KEEP = [
  'places', 'place_slots', 'slot_capacity', 'slot_inventory', 'place_pricing',
  'vehicle_categories', 'vehicle_class_map', 'vehicle_deny_rules',
  'checkposts', 'staff', 'staff_checkposts', 'admin_users', 'admin_audit',
  'legal_documents', 'legal_sections', 'app_settings', 'vehicles', 'vehicle_snapshots',
];

async function main() {
  const client = await pool().connect();
  const exists = async (t) => (await client.query('SELECT to_regclass($1) AS r', [`public.${t}`])).rows[0].r !== null;
  const count = async (t) => Number((await client.query(`SELECT count(*) AS c FROM ${t}`)).rows[0].c);

  try {
    const seq = (await client.query('SELECT last_value, is_called FROM pravesha_invoice_seq')).rows[0];
    const nextInvoice = seq.is_called ? Number(seq.last_value) + 1 : Number(seq.last_value);
    const held = (await client.query('SELECT COALESCE(sum(booked),0) b, COALESCE(sum(held),0) h FROM slot_inventory')).rows[0];

    console.log(EXECUTE ? '\nRESETTING FOR LAUNCH\n' : '\nDRY RUN — nothing will be changed. Add --yes to do it.\n');
    console.log('Database:', (await client.query('SELECT current_database() d')).rows[0].d, '\n');

    console.log('WILL BE REMOVED');
    for (const t of REMOVE) {
      if (!(await exists(t))) continue;
      const n = await count(t);
      if (n > 0) console.log(`  ${t.padEnd(26)} ${n}`);
    }
    console.log(`  ${'places taken in slots'.padEnd(26)} ${held.b} booked, ${held.h} held -> 0`);

    console.log('\nCOUNTERS');
    console.log(`  next invoice   PRV/26-27/${String(nextInvoice).padStart(6, '0')}  ->  PRV/26-27/000001`);
    console.log('  pass numbers   restart at 1 for every date');

    console.log('\nKEPT UNCHANGED');
    for (const t of KEEP) {
      if (!(await exists(t))) continue;
      console.log(`  ${t.padEnd(26)} ${await count(t)}`);
    }

    if (!EXECUTE) {
      console.log('\nNothing was changed.');
      return;
    }

    await client.query('BEGIN');
    for (const t of REMOVE) {
      if (await exists(t)) await client.query(`DELETE FROM ${t}`);
    }
    await client.query('UPDATE slot_inventory SET booked = 0, held = 0');
    await client.query("SELECT setval('pravesha_invoice_seq', 1, false)");
    /* The first real evening must not look like one already reported. */
    await client.query("DELETE FROM app_settings WHERE key LIKE 'report_sent_%'");
    await client.query('COMMIT');

    const after = (await client.query('SELECT last_value, is_called FROM pravesha_invoice_seq')).rows[0];
    const next = after.is_called ? Number(after.last_value) + 1 : Number(after.last_value);
    console.log('\nDone.');
    console.log(`  passes left     ${await count('tickets')}`);
    console.log(`  invoices left   ${await count('invoices')}`);
    console.log(`  next invoice    PRV/26-27/${String(next).padStart(6, '0')}`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\nFailed, and rolled back — nothing was changed:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main().then(() => process.exit(process.exitCode || 0));
