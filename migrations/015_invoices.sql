-- 015_invoices.sql
--
-- The GST invoice series.
--
-- The ticket PDF is what a visitor shows at a barrier. This is the document
-- their accountant wants, and the two have almost nothing in common: one needs
-- a large QR and four short rules, the other needs a GSTIN, a SAC code and the
-- pure-agent split stated in a way that survives a scrutiny notice.
--
-- WHY A SEQUENCE AND NOT COUNT(*) + 1. Two payments confirming in the same
-- second both read the same count and build the same number. invoice_no is
-- UNIQUE, so one of them fails — and a customer who has PAID gets no invoice.
-- A GST series must have no holes and no repeats; nextval() is atomic and gives
-- every caller its own number under any load.
--
-- WHAT THE AMOUNTS MEAN, and why they are stored rather than recomputed: an
-- invoice is a statement of what was charged on a particular day under the
-- rates in force that day. Re-deriving it later from current settings would
-- quietly rewrite history the first time the fee percentage changes.

CREATE SEQUENCE IF NOT EXISTS pravesha_invoice_seq START 1;

CREATE TABLE IF NOT EXISTS invoices (
  id             bigserial PRIMARY KEY,
  invoice_no     text NOT NULL UNIQUE,
  ticket_id      bigint NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  customer_id    bigint REFERENCES customers(id) ON DELETE SET NULL,

  -- The pure-agent split, as it must appear on the document.
  entry_paise    integer NOT NULL,   -- collected for the department, NOT taxable
  service_paise  integer NOT NULL,   -- our fee, GST-inclusive
  taxable_paise  integer NOT NULL,   -- the fee less the GST inside it
  gst_paise      integer NOT NULL,
  total_paise    integer NOT NULL,
  gst_percent    numeric(5,2) NOT NULL,

  place_of_supply text,
  sac_code        text,
  issued_at       timestamptz NOT NULL DEFAULT now(),

  -- One invoice per ticket. A second call returns the first.
  CONSTRAINT invoices_one_per_ticket UNIQUE (ticket_id)
);

CREATE INDEX IF NOT EXISTS invoices_customer_idx ON invoices (customer_id);
CREATE INDEX IF NOT EXISTS invoices_issued_idx   ON invoices (issued_at);

COMMENT ON COLUMN invoices.entry_paise IS
  'Entry fee collected for the department as pure agent under Rule 33, CGST Rules 2017. Excluded from taxable value.';
COMMENT ON COLUMN invoices.taxable_paise IS
  'The service fee net of the GST inside it. This alone is the taxable supply.';

-- The two particulars the invoice needs that nothing else in the system knows.
--
-- SAC: what we sell is a booking-and-collection service for somebody else's
-- ticket, which does not sit cleanly under any of the narrower reservation
-- headings, so this is the residual travel-arrangement code. It is a setting
-- rather than a constant precisely because it is the kind of thing a CA
-- corrects after looking at one filed return.
--
-- PLACE OF SUPPLY: a visitor is an unregistered person whose address we do not
-- hold, so under s.12(2)(b) IGST Act the place of supply is our own location.
-- Karnataka, therefore, on every invoice — and the tax is always CGST + SGST.
INSERT INTO app_settings (key, value) VALUES
  ('sac_code',        '998559'),
  ('place_of_supply', '29-Karnataka')
ON CONFLICT (key) DO NOTHING;
