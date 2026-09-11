-- 036_pricing_effective_time.sql
--
-- A price takes effect at a moment, not on a day.
--
-- effective_from was a date, with one row allowed per vehicle type per day. The
-- panel now changes prices, and a correction made an hour after a mistake would
-- have been refused until tomorrow. It becomes a timestamp: existing rows keep
-- midnight IST of their date, the uniqueness stays (a new row always has a later
-- moment), and one index guarantees there is only ever one current price.

ALTER TABLE place_pricing
  ALTER COLUMN effective_from TYPE timestamptz
    USING (effective_from::timestamp AT TIME ZONE 'Asia/Kolkata'),
  ALTER COLUMN effective_from SET DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS idx_place_pricing_one_active
  ON place_pricing (place_id, category_id) WHERE is_active;
