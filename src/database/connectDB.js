const { Pool, types } = require("pg");
require("dotenv").config();

// Keep DATE as string (no timezone changes)
types.setTypeParser(1082, (val) => val);

// Global pools (created only once)
let pool = null;

// 🔥 Common function to test pool connection once
function testConnection(pool, label) {
  pool
    .query("SELECT NOW()")
    .then(() => console.log(`✅ PostgreSQL connected: ${label}`))
    .catch((err) => console.error(`❌ Connection failed for ${label}`, err));
}

/* ============================================
   MAIN DB (PGDATABASEMAIN)
============================================ */
const connectDB = () => {
  if (!pool) {
    pool = new Pool({
      host: process.env.PGHOST,
      database: process.env.PGDATABASEMAIN,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      port: process.env.PGPORT,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
      keepAlive: true,
    });

    /* The database it actually connected to, not a name written here once.
       This line said "serverpeappsolutions" no matter which database was in
       use, which is how a connection to the wrong one stays invisible. */
    testConnection(pool, `${process.env.PGDATABASEMAIN} @ ${process.env.PGHOST}`);
  }
  return pool;
};

module.exports = { connectDB };
