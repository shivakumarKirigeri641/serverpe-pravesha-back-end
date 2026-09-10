/**
 * scripts/create-db.js — create the Pravesha database, if it is not there.
 *
 *   node scripts/create-db.js
 *
 * Deployment is meant to be two commands and no manual steps:
 *
 *   node scripts/create-db.js
 *   node scripts/migrate.js
 *
 * This exists because `createdb` needs the postgres client tools on PATH, and
 * on a fresh server they often are not — while the `pg` driver this project
 * already depends on can do it perfectly well.
 *
 * A database cannot be created inside a transaction, and CREATE DATABASE has
 * no IF NOT EXISTS, so existence is checked first and the call skipped rather
 * than the error swallowed. Swallowing it would hide a genuine permission
 * problem behind the same message as "already there".
 *
 * It never drops anything. Recreating a database is a decision that belongs to
 * a person with a backup in hand, not to a script that runs on deploy.
 */

require('dotenv').config();
const { Client } = require('pg');

const NAME = process.env.PGDATABASEMAIN;
if (!NAME) {
  console.error('\n  PGDATABASEMAIN is not set. Nothing to create.\n');
  process.exit(1);
}

/* Connect to the maintenance database rather than the one being created. */
const admin = () => new Client({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT) || 5432,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGADMINDB || 'postgres',
});

(async () => {
  const c = admin();
  await c.connect();
  console.log(`\n  ${process.env.PGUSER}@${process.env.PGHOST}:${process.env.PGPORT || 5432}`);

  const { rows } = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [NAME]);

  if (rows.length) {
    console.log(`  database "${NAME}" already exists — nothing to do\n`);
  } else {
    // The name comes from configuration, not from user input, but it is still
    // an identifier being interpolated into DDL: quote it properly.
    await c.query(`CREATE DATABASE "${NAME.replace(/"/g, '""')}"`);
    console.log(`  created database "${NAME}"\n`);
  }

  await c.end();
  console.log('  next:  node scripts/migrate.js\n');
  process.exit(0);
})().catch((e) => {
  console.error(`\n  could not create the database: ${e.message}\n`);
  process.exit(1);
});
