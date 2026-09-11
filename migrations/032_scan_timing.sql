-- 032_scan_timing.sql — how long a check took, and the indexes live monitoring needs.
--
-- "Average verification time" cannot be computed from a row that only records
-- when a check finished. The gate app knows both ends of it — the pass opened,
-- the entry was recorded — so it reports the elapsed milliseconds and they are
-- stored here. Null means a check from before this existed, or one recorded
-- without a measurement; the averages ignore those rather than counting them as
-- zero, which would quietly halve every figure.

BEGIN;

ALTER TABLE scans ADD COLUMN IF NOT EXISTS duration_ms integer;

COMMENT ON COLUMN scans.duration_ms IS
  'Milliseconds from the pass being opened at the gate to the entry being recorded. Null when not measured.';

-- Live monitoring reads the day's scans by time, constantly.
CREATE INDEX IF NOT EXISTS idx_scans_when ON scans (scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_scans_staff_when ON scans (staff_id, scanned_at DESC);

COMMIT;
