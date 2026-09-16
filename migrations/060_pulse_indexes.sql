-- 060_pulse_indexes.sql
--
-- The admin panel asks "has anything changed?" every few seconds from every
-- open screen (adminLive.pulse). Since 2026-09-16 that question covers money
-- whatever date it is for — the newest pass change, payment, refund and the
-- count of failed checkouts — so each part must be an index lookup, not a scan
-- of a table that grows by a thousand rows a day.

CREATE INDEX IF NOT EXISTS idx_tickets_modified_at   ON tickets (modified_at);
CREATE INDEX IF NOT EXISTS idx_payments_paid_at      ON payments (paid_at);
CREATE INDEX IF NOT EXISTS idx_payments_refunded_at  ON payments (refunded_at);
CREATE INDEX IF NOT EXISTS idx_payments_failed       ON payments (id) WHERE status = 'failed';
