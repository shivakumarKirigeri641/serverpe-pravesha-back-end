-- 005_commercials.sql — the commercial terms, as data.
--
-- These belong in the database for the same reason prices do: they appear in a
-- proposal document, on an invoice and in a conversation with a department, and
-- all three must say the same thing. A figure typed separately into a Word file
-- is a figure that will eventually disagree with the system.
--
-- The proposal document and the presentation are both generated from these
-- rows, so changing a number here changes every place it is quoted.

BEGIN;

INSERT INTO app_settings (key, value, note) VALUES
  ('platform_fee_percent', '10',
   'Our booking fee as a percentage of the entry fee. Quoted in the proposal; the actual per-category amounts live in place_pricing.'),

  ('amc_per_gate_annual_paise', '12000000',
   'Annual maintenance charge per checkpost, payable by the department: Rs.1,20,000.'),

  ('amc_covers',
   'Hosting and uptime; support on call during gate hours; software updates and new reports; staff training and PIN administration; WhatsApp and messaging costs; payment gateway integration and reconciliation.',
   'What the AMC includes. Stated explicitly so there is no argument later about what was covered.'),

  ('amc_excludes',
   'Checkpost handsets and their data connections; the payment gateway fee on refunds; any hardware at the gate.',
   'What the AMC does not include. Saying this in the proposal is cheaper than saying it in a dispute.'),

  ('contract_term', '1 year, renewable',
   'Term proposed to the department.'),

  ('settlement_terms', 'Weekly, every Monday, for the preceding week',
   'How and how often the entry fee collected is settled to the department. To be confirmed by the department.'),

  ('sla_response', 'Within 2 hours during gate hours (6 AM to 6 PM), same day otherwise',
   'Support response commitment.'),

  ('gateway_fee_percent', '2',
   'Payment gateway charge, used to estimate take-home. Razorpay charges this on the whole amount collected, including the department''s share.')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, note = EXCLUDED.note;

COMMIT;
