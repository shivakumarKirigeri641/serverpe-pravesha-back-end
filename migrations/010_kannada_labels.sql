-- 010_kannada_labels.sql — Kannada for the rows that reach a slide.
--
-- The revenue models and investment items are read straight out of these tables
-- and printed on a slide shown to officers of the Karnataka government. Holding
-- only English in the row means the slide can only ever be half translated,
-- however carefully the surrounding deck is written.
--
-- Short labels only. The explanatory prose stays in English on the slide, with
-- the Kannada label above it — the same Kannada-first, English-beneath pattern
-- used on the ticket and in the proposal.

BEGIN;

ALTER TABLE revenue_models   ADD COLUMN IF NOT EXISTS title_kn text;
ALTER TABLE investment_items ADD COLUMN IF NOT EXISTS item_kn  text;

UPDATE revenue_models SET title_kn = v.kn FROM (VALUES
  ('BOOKING_FEE', 'ಪ್ರತಿ ಟಿಕೆಟ್‌ಗೆ ಸೇವಾ ಶುಲ್ಕ'),
  ('AMC',         'ವಾರ್ಷಿಕ ನಿರ್ವಹಣಾ ಶುಲ್ಕ'),
  ('MULTI_SITE',  'ಹೆಚ್ಚು ತಾಣಗಳು, ಅದೇ ವೇದಿಕೆ'),
  ('ADD_ONS',     'ಅದೇ ಸಂಭಾಷಣೆಯಲ್ಲಿ ಹೆಚ್ಚುವರಿ ಸೇವೆಗಳು'),
  ('REPORTING',   'ವರದಿ ಮತ್ತು ವಿಶ್ಲೇಷಣಾ ಮಾಡ್ಯೂಲ್'),
  ('WHITE_LABEL', 'ಇತರ ಇಲಾಖೆಗಳಿಗೆ ಅದೇ ವ್ಯವಸ್ಥೆ')
) AS v(code, kn) WHERE revenue_models.code = v.code;

UPDATE investment_items SET item_kn = v.kn FROM (VALUES
  ('Development laptop',            'ಅಭಿವೃದ್ಧಿ ಲ್ಯಾಪ್‌ಟಾಪ್'),
  ('VPS / server hosting',          'ಸರ್ವರ್ ಹೋಸ್ಟಿಂಗ್'),
  ('Development tooling',           'ಅಭಿವೃದ್ಧಿ ಪರಿಕರಗಳು'),
  ('Domain (.in)',                  'ಡೊಮೇನ್ (.in)'),
  ('Business email',                'ವ್ಯವಹಾರ ಇಮೇಲ್'),
  ('WhatsApp Business Platform',    'ವಾಟ್ಸ್ಆ್ಯಪ್ ಬಿಸಿನೆಸ್ ವೇದಿಕೆ'),
  ('Payment gateway',               'ಪಾವತಿ ಗೇಟ್‌ವೇ'),
  ('GST and Udyam registration',    'ಜಿಎಸ್‌ಟಿ ಮತ್ತು ಉದ್ಯಮ್ ನೋಂದಣಿ'),
  ('Accounting and compliance',     'ಲೆಕ್ಕಪತ್ರ ಮತ್ತು ಅನುಸರಣೆ'),
  ('SSL certificates',              'ಎಸ್‌ಎಸ್‌ಎಲ್ ಪ್ರಮಾಣಪತ್ರ'),
  ('Test handsets',                 'ಪರೀಕ್ಷಾ ಮೊಬೈಲ್‌ಗಳು'),
  ('Backups and monitoring',        'ಬ್ಯಾಕಪ್ ಮತ್ತು ಮೇಲ್ವಿಚಾರಣೆ'),
  ('Site visits and installation',  'ಸ್ಥಳ ಭೇಟಿ ಮತ್ತು ಅಳವಡಿಕೆ'),
  ('Professional indemnity cover',  'ವೃತ್ತಿಪರ ವಿಮೆ'),
  ('Home office',                   'ಮನೆ ಕಚೇರಿ')
) AS v(item, kn) WHERE investment_items.item = v.item;

COMMIT;
