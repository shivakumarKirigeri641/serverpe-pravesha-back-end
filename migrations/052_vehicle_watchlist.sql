-- The watchlist: number plates the gate must stop, or look at twice.
--
-- TWO LEVELS, BECAUSE THE GATE NEEDS TWO DIFFERENT INSTRUCTIONS.
--   block  the vehicle is not to be let in, whatever pass it holds. The gate
--          refuses it and tells the staff member to call the office.
--   check  the vehicle may go in, but the staff member is told why somebody
--          asked for a closer look — a repeated argument at the barrier, a type
--          declared by hand that looked wrong, a complaint.
--
-- A REASON IS ALWAYS WRITTEN DOWN, and nothing is deleted. Taking a plate off the
-- list stamps who took it off, when and why; the row stays, so the question
-- "was this car on the list last month?" still has an answer. At most one live
-- entry per plate.

CREATE TABLE IF NOT EXISTS vehicle_watchlist (
  id              bigserial   PRIMARY KEY,
  reg_no          text        NOT NULL,
  level           text        NOT NULL CHECK (level IN ('block', 'check')),
  reason          text        NOT NULL,
  added_by        bigint      REFERENCES admin_users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  modified_at     timestamptz NOT NULL DEFAULT now(),
  removed_at      timestamptz,
  removed_by      bigint      REFERENCES admin_users(id),
  removed_reason  text
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlist_live ON vehicle_watchlist (reg_no) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_watchlist_created ON vehicle_watchlist (created_at DESC);
