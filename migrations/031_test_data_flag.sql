-- 031_test_data_flag.sql — mark rows that exist only for testing.
--
-- A demo needs hundreds of vehicles and bookings. Those rows sit in the same
-- tables as real ones, and the vehicle cache in particular is load-bearing: a
-- row there with a recent rc_fetched_at means the booking will NOT call ULIP for
-- that plate. That is exactly what makes seeded data safe and free — and exactly
-- why it must be impossible to mistake for a real record.
--
-- So every seeded row carries is_test, which means: invented, never fetched from
-- a government source, and safe to delete. `node scripts/seed-test-data.js
-- --remove` deletes precisely these rows and nothing else.

BEGIN;

ALTER TABLE vehicles  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE tickets   ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE payments  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE scans     ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_vehicles_test  ON vehicles (is_test)  WHERE is_test;
CREATE INDEX IF NOT EXISTS idx_tickets_test   ON tickets (is_test)   WHERE is_test;
CREATE INDEX IF NOT EXISTS idx_customers_test ON customers (is_test) WHERE is_test;

COMMIT;
