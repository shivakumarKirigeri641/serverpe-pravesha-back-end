-- 019_snapshot_per_dataset.sql — one cached snapshot per dataset, not per vehicle.
--
-- 018 added the dataset column but left UNIQUE (vehicle_id) in place, which
-- means the three datasets fight over one row: fetching FASTag would overwrite
-- the RC that eligibility and pricing are read from. The key has to include the
-- dataset for all three to coexist.

ALTER TABLE vehicle_snapshots DROP CONSTRAINT IF EXISTS vehicle_snapshots_unique;

ALTER TABLE vehicle_snapshots
  ADD CONSTRAINT vehicle_snapshots_unique UNIQUE (vehicle_id, dataset);
