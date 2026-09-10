-- 014_web_tokens.sql
--
-- Booking links are single use.
--
-- The link handed out in the chat is a signed token: it proves who the visitor
-- is and needs no password. But a signature has no memory, so the same link
-- kept working after a booking was made — scroll up in the thread, tap it
-- again, and book a second time. Worse, it stayed valid indefinitely.
--
-- So each issued token is recorded, and spending it is a state change. The page
-- refuses a token that has been spent, and refuses one that has expired.
--
-- ONLY THE HASH IS STORED. The token is a bearer credential for the length of
-- its life; a leaked database should not hand somebody a working booking link
-- for every customer. The hash is enough to recognise one presented back to us.
--
-- Support and feedback links are recorded here too, with their own purpose, but
-- are not spent on use: somebody may reasonably send two support messages, and
-- being told their link is dead when they have a second thing to report would
-- be its own support ticket.

CREATE TABLE IF NOT EXISTS web_tokens (
  id           bigserial PRIMARY KEY,
  token_hash   text NOT NULL UNIQUE,
  customer_id  bigint REFERENCES customers(id) ON DELETE CASCADE,
  purpose      text NOT NULL DEFAULT 'booking',
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL DEFAULT now() + interval '2 hours',
  used_at      timestamptz,
  ticket_id    bigint REFERENCES tickets(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS web_tokens_customer_idx ON web_tokens (customer_id, purpose);
CREATE INDEX IF NOT EXISTS web_tokens_expiry_idx   ON web_tokens (expires_at)
  WHERE used_at IS NULL;

COMMENT ON TABLE  web_tokens IS
  'Issued web links. Booking tokens are single use; the hash is stored, never the token.';
COMMENT ON COLUMN web_tokens.used_at IS
  'When the token was spent. A booking token with this set is refused.';
COMMENT ON COLUMN web_tokens.ticket_id IS
  'The booking this token produced, so a spent link can say what it was spent on.';
