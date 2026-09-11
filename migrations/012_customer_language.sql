-- 012_customer_language.sql
--
-- Which language a visitor is answered in.
--
-- Until now every message went out as Kannada and English stacked together,
-- which is safe but doubles the length of every screen and reads as a system
-- that could not decide. Asking once, on the first message, and remembering the
-- answer is shorter for everyone and is the difference between a bot that
-- speaks Kannada and one that merely contains it.
--
-- Defaults to 'kn'. The site is in Karnataka and the department is a Karnataka
-- department; a visitor who wants English will say so, and the default should
-- be the one that is right more often rather than the one that is easier for
-- the people building it.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'kn';

-- Only the two we actually render. A third value would silently fall back to
-- Kannada at the call site, which is the kind of half-working that is worse
-- than a clear failure.
ALTER TABLE customers
  DROP CONSTRAINT IF EXISTS customers_language_check;

ALTER TABLE customers
  ADD CONSTRAINT customers_language_check CHECK (language IN ('kn', 'en'));

-- Whether they have actually been asked, as distinct from holding the default.
-- Without this, a customer who has never seen the question is indistinguishable
-- from one who deliberately chose Kannada, and we would never ask again.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS language_asked_at timestamptz;

COMMENT ON COLUMN customers.language IS
  'Conversation language: kn (default) or en. Set from the first-contact question.';
COMMENT ON COLUMN customers.language_asked_at IS
  'When the language question was answered. NULL means never asked.';
