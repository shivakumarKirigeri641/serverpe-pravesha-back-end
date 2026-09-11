-- 029_support_contact.sql — a support mailbox of our own, and somewhere for the
-- website's contact form to land.

BEGIN;

-- Every policy, invoice and page reads this one key, so changing it here moves
-- the address everywhere at once.
UPDATE app_settings SET value = 'support@pravesha.in', modified_at = now()
 WHERE key = 'contact_email';

-- The Grievance Officer is published by designation, not by personal name. The
-- IT Rules require the officer's name, designation and contact to be published;
-- this shows the designation and a monitored address, which is what the public
-- pages carry. `proprietor_name` stays in the settings for documents that need
-- the proprietor named.
INSERT INTO app_settings (key, value, note)
VALUES ('grievance_officer_name', 'The Grievance Officer',
        'How the Grievance Officer is named on public pages and policies')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, modified_at = now();

UPDATE legal_sections SET description = replace(description, '{{proprietor_name}}', '{{grievance_officer_name}}')
 WHERE description LIKE '%{{proprietor_name}}%';

/* ────────────────────────────────────────────────── website contact form ── */

-- The form emails support@pravesha.in, but the row is written first and kept
-- whatever the mail server does. A mailbox that is full, misconfigured or not
-- enabled yet must never lose somebody's complaint — it can be read here and
-- re-sent.
CREATE TABLE IF NOT EXISTS contact_messages (
  id          bigserial PRIMARY KEY,
  name        text        NOT NULL,
  email       text        NOT NULL,
  mobile      text,
  subject     text,
  message     text        NOT NULL,
  -- What we could see about the sender, for abuse and for finding their booking.
  source      text        NOT NULL DEFAULT 'website',
  ip          text,
  user_agent  text,
  -- 'pending' until the mail server accepts it; 'sent', or 'failed' with why.
  mail_status text        NOT NULL DEFAULT 'pending'
              CHECK (mail_status IN ('pending', 'sent', 'failed', 'skipped')),
  mail_error  text,
  sent_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_messages_created ON contact_messages (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_messages_pending ON contact_messages (mail_status) WHERE mail_status <> 'sent';

COMMIT;
