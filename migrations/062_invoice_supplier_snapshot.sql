-- The supplier's particulars, frozen on each invoice when it is issued
-- (user, 2026-09-19).
--
-- WHY. Pravesha keeps no PDF files: an invoice is rendered from its row every
-- time it is sent, downloaded or regenerated (scripts/regenerate-docs.js). The
-- amounts were always stored on the row; the supplier block — legal name,
-- address, GSTIN, Udyam, contact — was read from today's settings, so a change
-- of address would have rewritten every earlier invoice. Now the row carries
-- those too, and an invoice renders the same however long afterwards.
--
-- Invoices issued before this migration take the particulars in force now,
-- which are the ones they were issued under.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS supplier jsonb;

UPDATE invoices SET supplier = jsonb_build_object(
    'legalName', COALESCE((SELECT value FROM app_settings WHERE key = 'legal_name'), 'ServerPe App Solutions'),
    'address',   COALESCE((SELECT value FROM app_settings WHERE key = 'business_address'), ''),
    'gstin',     COALESCE((SELECT value FROM app_settings WHERE key = 'gstin'), ''),
    'udyam',     COALESCE((SELECT value FROM app_settings WHERE key = 'udyam_number'), ''),
    'email',     COALESCE((SELECT value FROM app_settings WHERE key = 'contact_email'), ''),
    'website',   COALESCE((SELECT value FROM app_settings WHERE key = 'website'), 'www.serverpe.in'))
 WHERE supplier IS NULL;

COMMENT ON COLUMN invoices.supplier IS
  'Supplier particulars as at issue (legalName, address, gstin, udyam, email, website). The PDF reads these, not current settings.';
