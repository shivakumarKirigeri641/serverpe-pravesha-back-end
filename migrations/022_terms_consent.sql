-- 022_terms_consent.sql — a record that the visitor agreed, and to what.
--
-- The welcome message now carries the terms and the privacy notice, and nobody
-- reaches the booking without tapping through them. That tap is worth storing:
-- this is a government-facing service handling vehicle registration data, and
-- "they agreed" is not a useful answer without a time and a version attached.
--
-- THE VERSION IS STORED, NOT JUST THE TIMESTAMP. Terms change. A consent
-- recorded against v1 says nothing about v2, and the only way to know who needs
-- asking again is to have kept which text they actually saw.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS terms_version text;

CREATE INDEX IF NOT EXISTS customers_terms
  ON customers (terms_version, terms_accepted_at);
