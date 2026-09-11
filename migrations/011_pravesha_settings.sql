-- 011_pravesha_settings.sql
--
-- The configuration that had only ever been set at runtime.
--
-- Everything below was applied by hand or by a one-off script against the old
-- shared database while the system was being built: the product name, the 13%
-- fee working values, the firm's statutory particulars, the one-move
-- postponement limit the department asked for, and the tatkal parameters.
--
-- None of it was in a migration, so a fresh database came up without any of
-- it — the ticket footer fell back to a default product name, postponement
-- silently allowed two moves instead of one, and the documents would have
-- quoted the wrong gateway rates. That is exactly the class of difference that
-- is invisible until a demo.
--
-- Written as upserts so this is safe to re-run and safe on a database that
-- already carries some of these values.

INSERT INTO app_settings (key, value) VALUES

  -- Identity ---------------------------------------------------------------
  ('product_name',            'Pravesha'),
  ('product_name_kn',         'ಪ್ರವೇಶ'),
  ('vendor_tagline',          'Smart Clicks, Smart Taps.'),
  ('authority_tagline',       'ಒಂದು ರಾಜ್ಯ. ಹಲವು ಜಗತ್ತುಗಳು.'),
  ('second_product_name',     'GaadiPe'),
  ('second_product_since',    'August 2026'),

  -- The firm, as it appears on invoices and in the proposal ----------------
  ('gstin',                   '29BSMPK7696H1ZT'),
  ('udyam_number',            'UDYAM-KR-27-0049293'),
  ('business_address',        '5th Floor, A501, The Orchard, Apricot Block, HMT Watch Factory Main Road, Jalahalli, Bengaluru 560013'),
  ('founder_years',           '15+'),
  ('founder_bio',             '15+ years of professional experience in IT and software development, across desktop and web application development.'),

  -- Commercial working values ----------------------------------------------
  -- Quoted by Razorpay for this proposal. The seed carried 2 rather than 2.2,
  -- which understated the gateway charge on every figure derived from it.
  ('gateway_fee_percent',     '2.2'),
  ('route_transfer_percent',  '0.25'),

  -- Operating rules ---------------------------------------------------------
  -- One free change of date, as the department asked. The seed default of 2
  -- contradicted what the proposal and the deck both state.
  ('max_moves_per_ticket',    '1'),
  -- The date exactly a fortnight out opens at 6 PM. Derived from the clock
  -- rather than a scheduled job, so there is no missed or double fire.
  ('booking_release_hour',    '18'),
  -- A vehicle arriving after its slot opens is still admitted for this long.
  ('slot_grace_minutes',      '60'),

  -- Tatkal: illustrative only. The department fixes all three. ---------------
  ('tatkal_entry_paise',      '15000'),
  ('tatkal_reserve_percent',  '10'),
  ('tatkal_peak_days',        '110'),

  -- Operational -------------------------------------------------------------
  -- The founder's own number, excluded from customer analytics so testing
  -- does not distort the figures shown to the department.
  ('internal_mobiles',        '9886122415'),
  -- QR codes and payment URLs visible in the admin panel. Useful while there
  -- is no second phone to scan with; turn off before the department uses it.
  ('show_qr_in_admin',        'true')

ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
