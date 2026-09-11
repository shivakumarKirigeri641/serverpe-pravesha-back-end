-- 021_wa_dedup.sql — one inbound message, handled once.
--
-- Meta retries a webhook until it gets a 200, and it will deliver the same
-- message again after a timeout even when the first delivery was processed
-- fine. Without a key on the message id, a slow reply is a second welcome
-- message -- and later in the flow, a second booking.
--
-- The id is unique per message and is the natural key. NULLs are allowed
-- through because outbound rows are written before Meta has assigned one.

CREATE UNIQUE INDEX IF NOT EXISTS wa_messages_inbound_unique
  ON wa_messages (wa_message_id)
  WHERE wa_message_id IS NOT NULL AND direction = 'in';

CREATE INDEX IF NOT EXISTS wa_messages_mobile_recent
  ON wa_messages (mobile, created_at DESC);
