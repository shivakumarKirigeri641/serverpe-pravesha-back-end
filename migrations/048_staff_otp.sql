-- Signing in with a code sent by SMS.
--
-- WHAT IT REPLACES. A six-digit PIN that an administrator issued once, told a
-- staff member, and that then lived in that person's memory or on a piece of
-- paper by the barrier. It was never rotated, it was shared when somebody
-- covered a shift, and it could not be taken away without an administrator
-- being asked. A code sent to a phone number is held by whoever holds the phone,
-- which is the thing actually being authorised.
--
-- FOUR DIGITS IS TEN THOUSAND GUESSES, so the code alone is not the security —
-- the limits are. Three minutes of life, five attempts, one use, one live code
-- at a time per person, and a cap on how many can be asked for in an hour.
-- Stored hashed, because a table of live codes beside a table of mobile numbers
-- is a list of ways through the barrier.
--
-- THE ROW IS KEPT AFTER USE. Who asked for a code, from where, when, and whether
-- it was used — that is the audit trail for "somebody signed in as me", and it
-- is worth more than the few bytes it costs.

CREATE TABLE IF NOT EXISTS staff_otps (
  id           bigserial PRIMARY KEY,
  staff_id     bigint REFERENCES staff(id) ON DELETE CASCADE,
  mobile       text NOT NULL,
  code_hash    text NOT NULL,
  attempts     integer NOT NULL DEFAULT 0,
  sent_at      timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  -- What the SMS gateway said, so a code that never arrived can be told apart
  -- from one that was ignored.
  delivery     jsonb,
  ip           text,
  is_test      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- One live code per person is enforced when a code is issued — the previous one
-- is retired in the same statement — rather than by a unique index: "still
-- valid" depends on now(), and Postgres will not have a moving target in an
-- index predicate. The index here is the one every lookup actually uses.
CREATE INDEX IF NOT EXISTS idx_staff_otp_recent ON staff_otps (mobile, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_otp_open ON staff_otps (mobile, expires_at DESC) WHERE consumed_at IS NULL;
