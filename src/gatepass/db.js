/**
 * db.js — one pool, and a transaction helper.
 *
 * connectDB() already builds the pool and hands the same one back on every
 * call, so this is just a shorter way to reach it plus the piece it does not
 * provide: a transaction that cannot leak a client. Booking money and claiming
 * capacity happen in the same breath or not at all.
 */

const { connectDB } = require('../database/connectDB');

const pool = () => connectDB();

const query = (text, params) => pool().query(text, params);

/** Run fn inside a transaction. Commits on return, rolls back on throw. */
async function tx(fn) {
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    // A rollback that itself fails must not hide the error that caused it.
    try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
    throw e;
  } finally {
    client.release();
  }
}

/** First row or null — the shape most lookups actually want. */
async function one(text, params) {
  const r = await query(text, params);
  return r.rows[0] || null;
}

module.exports = { pool, query, one, tx };
