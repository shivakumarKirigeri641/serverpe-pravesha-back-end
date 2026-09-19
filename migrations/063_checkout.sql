-- Check-out: when a vehicle comes back down, the gate records it (user, 2026-09-19).
--
-- WHY. An entry says who went up; nothing said who came back. With the exit
-- recorded the Department sees who is still on the hill at any moment — the
-- list that matters in fog, a landslide or at closing time — and how long
-- visits last.
--
-- HOW, WITHOUT DISTURBING ENTRIES.
--
--   * tickets.exited_at: when the vehicle left, null while it is still inside.
--     A pass is still 'used' after it leaves; entry and exit are two facts about
--     one visit, not two states.
--
--   * exits: one row per pass, who recorded it, at which checkpost, and whether
--     the phone was offline. Exits are NOT written to scans: every report counts
--     a scan that is not 'valid' as a refused vehicle, and an exit is not one.
--
--   * client_id: an exit recorded on a phone with no signal carries the phone's
--     own id, so sending it twice records it once — as for offline entries.

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS exited_at timestamptz;

CREATE TABLE IF NOT EXISTS exits (
  id            bigserial   PRIMARY KEY,
  ticket_id     bigint      NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  checkpost_id  bigint      REFERENCES checkposts(id) ON DELETE SET NULL,
  staff_id      bigint      REFERENCES staff(id) ON DELETE SET NULL,
  session_id    bigint      REFERENCES staff_sessions(id) ON DELETE SET NULL,
  exited_at     timestamptz NOT NULL DEFAULT now(),
  -- An exit recorded without signal: when it finally reached us.
  synced_at     timestamptz,
  was_offline   boolean     NOT NULL DEFAULT false,
  client_id     text        UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exits_one_per_ticket UNIQUE (ticket_id)
);

CREATE INDEX IF NOT EXISTS idx_exits_when ON exits (exited_at DESC);

-- "Who is still inside": entered today, not yet left.
CREATE INDEX IF NOT EXISTS idx_tickets_inside
    ON tickets (place_id, travel_date)
 WHERE status = 'used' AND exited_at IS NULL;

COMMENT ON COLUMN tickets.exited_at IS
  'When the vehicle (or group) left through a checkpost. NULL while still inside, or if the exit was never recorded.';
