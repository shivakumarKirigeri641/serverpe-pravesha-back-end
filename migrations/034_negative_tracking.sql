-- 034_negative_tracking.sql — reviewing suspicious activity, and the thresholds.
--
-- Negative events themselves are not new rows: every refusal is already in
-- scans, every failed payment in payments, every abandoned hold in tickets.
-- What is new is what an administrator does about them — a note, a dismissal,
-- blocking a number — which must be recorded against the thing reviewed, with
-- who and when, so "action taken" is a fact and not a memory.

BEGIN;

CREATE TABLE IF NOT EXISTS negative_reviews (
  id           bigserial PRIMARY KEY,
  -- What was reviewed: one gate check, one payment, a vehicle or a visitor.
  subject_type text        NOT NULL CHECK (subject_type IN ('scan', 'payment', 'ticket', 'vehicle', 'customer')),
  subject_id   text        NOT NULL,
  action       text        NOT NULL CHECK (action IN ('reviewed', 'dismissed', 'escalated', 'blocked', 'unblocked', 'note')),
  note         text,
  admin_id     bigint      REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_negative_reviews_subject ON negative_reviews (subject_type, subject_id, created_at DESC);

-- Refusals looked up by vehicle across days, for repeat and suspicious detection.
CREATE INDEX IF NOT EXISTS idx_scans_reg_when ON scans (reg_no, scanned_at DESC) WHERE reg_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_failed ON payments (customer_id, created_at DESC) WHERE status = 'failed';
CREATE INDEX IF NOT EXISTS idx_tickets_expired ON tickets (customer_id, created_at DESC) WHERE status = 'expired';

-- The lines between "unlucky" and "suspicious". Settings, not constants: they
-- will be argued about once real traffic exists.
INSERT INTO app_settings (key, value, note) VALUES
  ('negative_suspicious_attempts', '3', 'Failed gate attempts by one vehicle or visitor that mark them suspicious'),
  ('negative_window_days', '7', 'Days of history the suspicious-attempt count looks back over'),
  ('negative_duplicate_minutes', '15', 'A pass presented again within this many minutes of its entry is a double check, not a reuse attempt'),
  ('abuse_abandoned_holds_per_day', '3', 'Payment holds abandoned by one number in a day that count as booking abuse'),
  ('abuse_vehicles_per_date', '4', 'Different vehicles booked by one number for one date that count as booking abuse')
ON CONFLICT (key) DO NOTHING;

COMMIT;
