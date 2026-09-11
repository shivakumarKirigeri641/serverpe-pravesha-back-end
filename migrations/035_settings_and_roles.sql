-- 035_settings_and_roles.sql — configuration from the panel, and who may do it.

BEGIN;

/* ── Roles ───────────────────────────────────────────────────────────────
   Six roles, as the department will organise itself. Checkpost staff are the
   gate app's accounts (the staff table), not panel users, so they are not a
   panel role here. 'department' stays valid for any row that already has it. */
ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_role_check;
ALTER TABLE admin_users ADD CONSTRAINT admin_users_role_check
  CHECK (role IN ('super_admin', 'admin', 'checkpost_manager', 'finance', 'viewer', 'department'));

-- The first administrator becomes the super administrator: somebody must be
-- able to manage users and GST from the first day.
UPDATE admin_users SET role = 'super_admin'
 WHERE id = (SELECT min(id) FROM admin_users WHERE is_active)
   AND NOT EXISTS (SELECT 1 FROM admin_users WHERE role = 'super_admin');

/* ── Audit: what it was, what it became, and why ─────────────────────────── */
ALTER TABLE admin_audit ADD COLUMN IF NOT EXISTS before_value jsonb;
ALTER TABLE admin_audit ADD COLUMN IF NOT EXISTS after_value jsonb;
ALTER TABLE admin_audit ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE admin_audit ADD COLUMN IF NOT EXISTS session_id bigint;
CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit (action, created_at DESC);

/* ── Slots that open and close on dates ──────────────────────────────────
   Null means always. The booking reads these (places.js, inventory.js,
   bookWeb confirm), so a slot outside its dates is not offered or sold. */
ALTER TABLE place_slots ADD COLUMN IF NOT EXISTS valid_from date;
ALTER TABLE place_slots ADD COLUMN IF NOT EXISTS valid_to date;
ALTER TABLE place_slots ADD COLUMN IF NOT EXISTS modified_at timestamptz NOT NULL DEFAULT now();

/* ── Passes issued from the panel: free and on-spot ──────────────────────
   A pass the visitor did not buy on WhatsApp carries its reason, who asked,
   who approved and how it was paid for, beside the ticket it produced. */
CREATE TABLE IF NOT EXISTS ticket_grants (
  id                bigserial PRIMARY KEY,
  ticket_id         bigint      NOT NULL UNIQUE REFERENCES tickets(id) ON DELETE CASCADE,
  kind              text        NOT NULL CHECK (kind IN ('free', 'onspot')),
  reason_code       text,
  reason            text,
  approved_by       bigint      REFERENCES admin_users(id) ON DELETE SET NULL,
  issued_by         bigint      REFERENCES admin_users(id) ON DELETE SET NULL,
  payment_method    text,
  payment_reference text,
  amount_paise      integer     NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT free_needs_reason CHECK (kind <> 'free' OR (reason IS NOT NULL AND length(trim(reason)) >= 5))
);
CREATE INDEX IF NOT EXISTS idx_ticket_grants_kind ON ticket_grants (kind, created_at DESC);

/* ── Settings the panel edits ────────────────────────────────────────────── */
INSERT INTO app_settings (key, value, note) VALUES
  ('invoice_prefix', 'PRV', 'Prefix of every invoice number, before the financial year and sequence'),
  ('gst_inclusive', 'true', 'Service fee is GST-inclusive. Only inclusive pricing is supported.'),
  ('free_ticket_reasons', '["Government official on duty","Emergency or rescue services","Forest or tourism department staff","Media on assignment","Disabled visitor","Complaint resolution","Other (explain)"]',
   'Reasons offered when issuing a free pass; a written explanation is always required as well')
ON CONFLICT (key) DO NOTHING;

COMMIT;
