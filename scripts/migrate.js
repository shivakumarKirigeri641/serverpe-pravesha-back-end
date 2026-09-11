/**
 * migrate.js — apply every .sql in migrations/ that has not run yet.
 *
 * Ordering is the filename, which is why they are numbered. Each file runs
 * inside one transaction: a migration that fails leaves nothing behind, so the
 * fix is to edit the file and run again rather than to work out by hand how far
 * the last attempt got.
 */
const fs = require('fs');
const path = require('path');
const { pool: getPool } = require('../src/gatepass/db');
const pool = getPool();

const DIR = path.join(__dirname, '..', 'migrations');

(async () => {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);

  const done = new Set(
    (await pool.query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename));

  const pending = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql') && !done.has(f)).sort();
  if (!pending.length) { console.log('nothing to apply'); await pool.end(); return; }

  for (const file of pending) {
    const sql = fs.readFileSync(path.join(DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log('applied', file);
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('FAILED ', file, '\n  ', e.message);
      client.release();
      await pool.end();
      process.exit(1);
    }
    client.release();
  }
  await pool.end();
})();
