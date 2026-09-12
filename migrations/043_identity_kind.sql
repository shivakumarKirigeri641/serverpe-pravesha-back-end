-- 043_identity_kind.sql — what the identification actually is.
--
-- A free-text note gets "white car" written in it on a busy morning, which
-- identifies nothing. Recording the kind alongside the value means the entry can
-- be checked for shape — a chassis number has 6+ characters, a licence has its
-- own form — and means the tracking screen can say what was taken rather than
-- showing a sentence somebody typed.
--
-- The chassis number is first among these on purpose: it is stamped on the
-- vehicle, printed on the invoice and on the temporary registration paper, and
-- it stays with the vehicle for life. When a temporary registration becomes a
-- permanent one, the chassis is what links the two.

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS identity_kind text
    CHECK (identity_kind IS NULL OR identity_kind IN ('chassis', 'engine', 'tr_paper', 'invoice', 'licence', 'other'));
