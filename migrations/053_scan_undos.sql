-- Entries a staff member took back within a minute of recording them.
--
-- WHY A TABLE OF ITS OWN, NOT A FLAG ON THE SCAN. Screen after screen counts a
-- refusal as "any check that was not valid". An entry marked undone in place
-- would be counted as a refusal on the live screen, in the handover, in the
-- negative tracking and in every report — for a vehicle nobody refused. So the
-- scan is moved here whole, with why and when, and every existing count stays
-- correct without being touched.
--
-- NOTHING IS LOST. Every column of the original scan is kept, so "was this
-- vehicle let in and then taken back?" still has an answer, with whose shift it
-- was and the reason they gave.

CREATE TABLE IF NOT EXISTS scan_undos (
  id              bigserial   PRIMARY KEY,
  scan_id         bigint      NOT NULL,
  ticket_id       bigint      REFERENCES tickets(id) ON DELETE SET NULL,
  ticket_no       text,
  reg_no          text,
  checkpost_id    bigint      REFERENCES checkposts(id) ON DELETE SET NULL,
  staff_id        bigint      REFERENCES staff(id) ON DELETE SET NULL,
  session_id      bigint      REFERENCES staff_sessions(id) ON DELETE SET NULL,
  verdict         text        NOT NULL,
  raw_payload     text,
  scanned_at      timestamptz,
  synced_at       timestamptz,
  was_offline     boolean,
  duration_ms     integer,
  reason          text        NOT NULL,
  -- Whether the visitor's WhatsApp confirmation was stopped before it went.
  notice_stopped  boolean     NOT NULL DEFAULT false,
  undone_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scan_undos_session ON scan_undos (session_id);
CREATE INDEX IF NOT EXISTS idx_scan_undos_staff   ON scan_undos (staff_id, undone_at DESC);
