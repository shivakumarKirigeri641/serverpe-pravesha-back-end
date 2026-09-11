-- 006_company_profile.sql — who is proposing this.
--
-- A district administration's first question about an unfamiliar vendor is not
-- "how does the QR work". It is "who are you, are you registered, and what have
-- you delivered before". Those answers belong in the same place as everything
-- else the documents quote, so the proposal, the presentation and an invoice
-- cannot disagree about a GST number.
--
-- Values marked TO BE FILLED are left empty deliberately: a placeholder that
-- looks like a real registration number is worse than a blank, because a blank
-- gets noticed before the meeting and a plausible-looking wrong number does not.

BEGIN;

INSERT INTO app_settings (key, value, note) VALUES
  ('legal_name', 'ServerPe App Solutions',
   'The registered name of the proprietorship.'),

  ('legal_form', 'Sole Proprietorship',
   'Constitution of the business.'),

  ('proprietor_name', 'Shivakumar Kirigeri',
   'The proprietor, personally answerable for the engagement.'),

  ('gstin', '',
   'GST registration number. TO BE FILLED.'),

  ('udyam_number', '',
   'Udyam (MSME) registration number. TO BE FILLED.'),

  ('pan_masked', '',
   'PAN, masked for display in a proposal (e.g. ABCDE****F). TO BE FILLED.'),

  ('business_address', '',
   'Registered place of business as it appears on the GST certificate. TO BE FILLED.'),

  ('business_since', '',
   'Year the business began operating. TO BE FILLED.'),

  ('contact_email', 'admin@serverpe.in',
   'The address on proposals and invoices.'),

  ('website', 'www.serverpe.in', NULL),

  ('first_product_name', 'QuizPe',
   'The product that establishes a delivery record.'),

  ('first_product_line', 'A daily learning quiz for school children, delivered entirely on WhatsApp.',
   'One sentence, for a slide.'),

  ('first_product_since', '',
   'When QuizPe went live. TO BE FILLED.'),

  ('first_product_reach', '',
   'How far QuizPe reaches, in words that can be defended if questioned. TO BE FILLED.')
ON CONFLICT (key) DO NOTHING;

COMMIT;
