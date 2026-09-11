-- 038_payments_settlements.sql — where each rupee went after the visitor paid.
--
-- Two settlements follow every payment:
--
--   1. Razorpay → Pravesha's bank, net of its fee. Recorded per payment from
--      Razorpay's settlement report (settlement id, UTR, date).
--   2. Pravesha → the Tourism Department, the entry fees collected as pure
--      agent. Remitted in batches covering a date range; a payment is remitted
--      when its payment date falls inside a recorded remittance.
--
-- Refunds may be partial: refunded_paise says how much went back. A payment
-- refunded in full has status 'refunded'; a partial refund leaves it 'paid'.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS refunded_paise  integer NOT NULL DEFAULT 0 CHECK (refunded_paise >= 0),
  ADD COLUMN IF NOT EXISTS refund_reason   text,
  ADD COLUMN IF NOT EXISTS settlement_id   text,
  ADD COLUMN IF NOT EXISTS settlement_utr  text,
  ADD COLUMN IF NOT EXISTS settled_at      timestamptz;

UPDATE payments SET refunded_paise = amount_paise WHERE status = 'refunded' AND refunded_paise = 0;

CREATE INDEX IF NOT EXISTS idx_payments_paid_at    ON payments (paid_at DESC) WHERE paid_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_status     ON payments (status);

CREATE TABLE IF NOT EXISTS department_remittances (
  id           bigserial PRIMARY KEY,
  covers_from  date    NOT NULL,
  covers_to    date    NOT NULL,
  amount_paise bigint  NOT NULL CHECK (amount_paise > 0),
  reference    text    NOT NULL,
  remitted_on  date    NOT NULL,
  note         text,
  is_test      boolean NOT NULL DEFAULT false,
  created_by   bigint  REFERENCES admin_users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT remittance_range CHECK (covers_from <= covers_to)
);
CREATE INDEX IF NOT EXISTS idx_department_remittances_range ON department_remittances (covers_from, covers_to);
