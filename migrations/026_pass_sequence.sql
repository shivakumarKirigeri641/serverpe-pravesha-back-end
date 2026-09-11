-- 026_pass_sequence.sql — a booking sequence per date of visit, for encrypted
-- pass numbers.
--
-- A pass number is now the encryption of (date of visit, sequence for that
-- date) — see src/gatepass/passCodec.js. The sequence has to come from the
-- database, handed out atomically, because two bookings for the same date in
-- the same instant must never receive the same one: that is the whole of what
-- makes the pass number unique by construction.
--
-- ONE ROW PER DATE, INCREMENTED IN PLACE. INSERT ... ON CONFLICT DO UPDATE takes
-- the row lock, so concurrent bookings for a date queue on it for the moment the
-- increment takes, and each gets the next number. It runs inside the booking's
-- own transaction, after the capacity is claimed: a booking that fails for a
-- sold-out slot rolls the increment back with everything else, so a full slot
-- does not burn sequence numbers.

CREATE TABLE IF NOT EXISTS pass_day_counters (
  travel_date  date PRIMARY KEY,
  last_seq     integer NOT NULL DEFAULT 0 CHECK (last_seq >= 0 AND last_seq <= 1048575),
  modified_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS pass_seq integer;

/* The pair the pass number encrypts, unique. Passes issued before this scheme
   carry no sequence and are left out of the index. */
CREATE UNIQUE INDEX IF NOT EXISTS tickets_date_pass_seq
  ON tickets (travel_date, pass_seq) WHERE pass_seq IS NOT NULL;
