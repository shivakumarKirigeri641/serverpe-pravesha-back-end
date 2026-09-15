-- Signing in to the panel with a code, a role for the Deputy Commissioner, and
-- a checkpost for each checkpost manager (user, 2026-09-15).
--
-- A ROLE FOR THE DC. Almost everything the panel shows, including the audit
-- trail — but not editing prices, and not the checkpost manager's own work at
-- the gate. What that means capability by capability is in permissions.js; the
-- database only has to accept the name.
--
-- A CHECKPOST FOR A CHECKPOST MANAGER. A manager runs one gate. With a second
-- destination coming, a manager at Mullayanagiri must not see Kodachadri's
-- passes, staff or cash. The column is nullable: every other role spans all
-- checkposts, and a manager without one sees nothing scoped until assigned.
--
-- CODES FOR THE PANEL. Kept apart from staff_otps, which belong to gate staff
-- and are joined to the staff table; a panel user is a different person record
-- with far more authority. Same shape, same limits, stored hashed, kept after
-- use as the record of who signed in.

-- The role list lives in one CHECK constraint whose name was generated when the
-- table was made, so it is found rather than named.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'admin_users'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE admin_users DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE admin_users ADD CONSTRAINT admin_users_role_check
  CHECK (role IN ('super_admin', 'admin', 'dc', 'checkpost_manager', 'finance', 'viewer', 'department'));

ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS checkpost_id bigint REFERENCES checkposts(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS admin_otps (
  id           bigserial PRIMARY KEY,
  admin_id     bigint REFERENCES admin_users(id) ON DELETE CASCADE,
  mobile       text NOT NULL,
  code_hash    text NOT NULL,
  attempts     integer NOT NULL DEFAULT 0,
  sent_at      timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  -- What an SMS gateway said, once codes are sent. Empty while they are fixed.
  delivery     jsonb,
  ip           text,
  -- A fixed development code rather than one that was generated and sent.
  is_fixed     boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_otp_recent ON admin_otps (mobile, sent_at DESC);
