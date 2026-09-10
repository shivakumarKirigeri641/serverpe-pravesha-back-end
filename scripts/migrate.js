/**
 * scripts/migrate.js
 * ---------------------------------------------------------------------------
 *   node scripts/migrate.js           apply anything not yet applied
 *   node scripts/migrate.js --check   report only, change nothing
 *
 * Every migration runs inside a transaction and is recorded by filename, so
 * running this twice is safe and running it on a half-migrated database picks
 * up where it stopped.
 *
 * There is deliberately no --fresh here. This database already holds the
 * marketing site's tables and will hold ticket and payment records; a flag that
 * drops everything is not something that should exist within reach of a
 * production credential.
 * ---------------------------------------------------------------------------
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const CHECK = process.argv.includes('--check');
const DIR = path.join(__dirname, '..', 'migrations');

const client = () => new Client({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT) || 5432,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASEMAIN,
});

(async () => {
  const c = client();
  await c.connect();
  console.log(`\nserverpe migrations — ${process.env.PGUSER}@${process.env.PGHOST}/${process.env.PGDATABASEMAIN}`);
  console.log(`  mode: ${CHECK ? 'check' : 'apply'}\n`);

  await c.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )`);

  const done = new Set(
    (await c.query('SELECT filename FROM schema_migrations')).rows.map(r => r.filename));

  const files = fs.existsSync(DIR)
    ? fs.readdirSync(DIR).filter(f => f.endsWith('.sql')).sort()
    : [];

  let applied = 0;
  for (const f of files) {
    if (done.has(f)) { console.log(`  ok        ${f}`); continue; }
    if (CHECK) { console.log(`  PENDING   ${f}`); continue; }

    const sql = fs.readFileSync(path.join(DIR, f), 'utf8');
    try {
      // The file carries its own BEGIN/COMMIT where it needs one; wrapping the
      // record of it separately would let a migration succeed while the record
      // of it failed.
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [f]);
      console.log(`  applied   ${f}`);
      applied++;
    } catch (e) {
      console.error(`\n  FAILED    ${f}\n            ${e.message}\n`);
      await c.end();
      process.exit(1);
    }
  }

  console.log(`\n  ${CHECK ? 'Schema is up to date.' : `${applied} migration(s) applied.`}\n`);
  await c.end();
})().catch((e) => { console.error('\nmigrate failed:', e.message, '\n'); process.exit(1); });
