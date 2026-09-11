-- 033_admin_reports.sql — a register of the reports that were generated.
--
-- A report printed for a department meeting will be quoted back weeks later:
-- "the September report said 6,877 entries". The Report ID on the page is how
-- that sentence gets checked — which period, generated when, by whom, and a
-- fingerprint of the figures, so a report can be told apart from an edited copy.
-- The PDF itself is not stored: it can be regenerated, and a stored file would
-- be one more copy of visitor-derived data to protect.

BEGIN;

CREATE TABLE IF NOT EXISTS admin_reports (
  id            bigserial PRIMARY KEY,
  report_no     text        NOT NULL UNIQUE,
  kind          text        NOT NULL CHECK (kind IN ('daily', 'weekly', 'monthly', 'custom')),
  period_from   date        NOT NULL,
  period_to     date        NOT NULL,
  format        text        NOT NULL CHECK (format IN ('pdf', 'xlsx', 'csv')),
  generated_by  bigint      REFERENCES admin_users(id) ON DELETE SET NULL,
  generated_at  timestamptz NOT NULL DEFAULT now(),
  -- SHA-256 of the figures the report was drawn from.
  figures_sha256 text       NOT NULL,
  bytes         integer
);

CREATE INDEX IF NOT EXISTS idx_admin_reports_when ON admin_reports (generated_at DESC);

COMMIT;
