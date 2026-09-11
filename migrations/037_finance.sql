-- 037_finance.sql — the money screen: expenses, input tax credit, test invoices.

/* Invoices issued for seeded test passes carry their own TST/ series and this
   flag, so the real PRV/ series stays unbroken and test rows can be removed. */
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_invoices_issued_at ON invoices (issued_at DESC);

/*
 * What running Pravesha costs, entered by finance. The GST on a bill is kept
 * apart from its total so input tax credit can be claimed only on bills marked
 * eligible — and a vendor GSTIN and bill reference are what make it claimable.
 * Expenses are never deleted outright: a removal is recorded with its reason.
 */
CREATE TABLE IF NOT EXISTS finance_expenses (
  id            bigserial PRIMARY KEY,
  spent_on      date     NOT NULL,
  category      text     NOT NULL,
  vendor        text,
  vendor_gstin  text,
  bill_ref      text,
  description   text,
  amount_paise  integer  NOT NULL CHECK (amount_paise > 0),
  gst_paise     integer  NOT NULL DEFAULT 0 CHECK (gst_paise >= 0),
  itc_eligible  boolean  NOT NULL DEFAULT false,
  created_by    bigint   REFERENCES admin_users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  removed_at    timestamptz,
  removed_by    bigint   REFERENCES admin_users(id),
  remove_reason text,
  CONSTRAINT expense_gst_within_amount CHECK (gst_paise <= amount_paise),
  CONSTRAINT expense_itc_needs_gst CHECK (NOT itc_eligible OR gst_paise > 0)
);
CREATE INDEX IF NOT EXISTS idx_finance_expenses_spent ON finance_expenses (spent_on) WHERE removed_at IS NULL;

INSERT INTO app_settings (key, value, note) VALUES
  ('expense_categories', '["Hosting and servers","WhatsApp messaging","SMS and OTP","Payment gateway (other)","Software and tools","Staff and contractors","Travel","Marketing","Office and admin","Professional fees","Other"]',
   'Categories offered when recording an expense')
ON CONFLICT (key) DO NOTHING;
