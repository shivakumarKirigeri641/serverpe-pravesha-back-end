-- 030_admin_access.sql — what the admin panel needs to sign people in.
--
-- The tables were built in 002 (admin_users, admin_sessions, admin_audit). This
-- adds the lockout columns a password login needs, the settings it reads, and
-- the indexes its two hot lookups use.

BEGIN;

-- Same protection the gate has: repeated wrong passwords lock the account, on
-- the row, so moving to another browser does not reset the count.
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS failed_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS locked_until timestamptz;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS modified_at timestamptz NOT NULL DEFAULT now();

-- Every request carries the session token, so it is looked up constantly.
CREATE INDEX IF NOT EXISTS idx_admin_sessions_live
    ON admin_sessions (token) WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_admin_audit_admin
    ON admin_audit (admin_id, created_at DESC);

-- A desk session, not a gate shift: shorter, because an admin panel can change
-- prices and cancel passes, and it is left open on a laptop.
INSERT INTO app_settings (key, value, note)
VALUES ('admin_session_hours', '12', 'Hours an admin sign-in stays valid without activity')
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_settings (key, value, note)
VALUES ('admin_lock_minutes', '15', 'Minutes an admin account is locked after repeated wrong passwords')
ON CONFLICT (key) DO NOTHING;

-- The dashboard's own queries: money collected on a day, and a day's entries.
CREATE INDEX IF NOT EXISTS idx_payments_paid_at ON payments (paid_at DESC) WHERE status = 'paid';
CREATE INDEX IF NOT EXISTS idx_tickets_created ON tickets (created_at DESC);

COMMIT;
