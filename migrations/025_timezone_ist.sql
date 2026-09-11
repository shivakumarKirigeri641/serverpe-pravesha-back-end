-- 025_timezone_ist.sql — the database itself runs in Indian time.
--
-- The application pins IST on every connection it opens (connectDB.js). This
-- covers everything else that connects: psql, a reporting tool, a backup
-- script, an admin at a console. Without it they inherit the server default,
-- which is IST on this machine and UTC on most cloud databases.
--
-- Storage is unaffected. timestamptz is always held as an absolute instant;
-- the setting only decides how instants are shown and how "today" is read.
--
-- Wrapped so a managed database that refuses ALTER DATABASE to a non-owner
-- does not block every later migration: the connection-level setting still
-- holds for the application.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET TimeZone TO %L', current_database(), 'Asia/Kolkata');
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ALTER DATABASE not permitted; relying on the connection-level TimeZone';
END $$;
