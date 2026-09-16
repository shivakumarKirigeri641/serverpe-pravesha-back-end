-- 059_enrolment_codes.sql
--
-- Adding a person in Settings proves their mobile number first (user,
-- 2026-09-16): name and number, a code to that number, and only then is the
-- account switched on, as checkpost staff or as a panel user.
--
-- The codes live in admin_otps beside the sign-in codes, told apart by purpose.
-- Kept apart on purpose: sign-in takes the newest unspent code for a number,
-- and an enrolment code must never be the one it takes — nor a sign-in code be
-- accepted as proof that a number was checked.
--
-- A code is consumed when it is typed correctly (consumed_at, as for sign-in).
-- Enrolling with it spends it a second time (enrolled_at), so one verified
-- number creates one account, and the proof expires if nobody uses it.

ALTER TABLE admin_otps
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'sign_in';

ALTER TABLE admin_otps DROP CONSTRAINT IF EXISTS admin_otps_purpose_check;
ALTER TABLE admin_otps
  ADD CONSTRAINT admin_otps_purpose_check CHECK (purpose IN ('sign_in', 'enrol'));

-- Who asked for an enrolment code: the administrator adding the person.
ALTER TABLE admin_otps
  ADD COLUMN IF NOT EXISTS requested_by bigint REFERENCES admin_users (id) ON DELETE SET NULL;

ALTER TABLE admin_otps
  ADD COLUMN IF NOT EXISTS enrolled_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_admin_otp_purpose ON admin_otps (purpose, mobile, sent_at DESC);
