-- 009_service_fee_13.sql — the service fee moves to 13%, and why.
--
-- THE COMMITMENT THIS PAYS FOR: the department receives the nominal entry fee
-- in full, straight into its own account, with nothing deducted. Not "less
-- charges", not "net of gateway fees" — the whole hundred rupees.
--
-- Somebody has to carry the payment gateway's charge and the Route transfer
-- charge, and at 10% those two came to about Rs.3.23 on a Rs.113 transaction,
-- leaving too little to run a support commitment on. At 13% the promise is
-- affordable and can be made without qualification, which is worth far more in
-- a government meeting than three percentage points.
--
-- Rounded to whole rupees. A visitor asked for Rs.56.50 wonders why; Rs.57 is
-- simply the price. The rounding is upward and small, and is stated in the
-- proposal rather than buried.

BEGIN;

UPDATE app_settings
   SET value = '13',
       note = 'Gross service and convenience fee as a percentage of the entry fee, paid by the '
           || 'visitor. All payment gateway and Route transfer charges are met from this fee; '
           || 'the department receives the entry fee without deduction.',
       modified_at = now()
 WHERE key = 'platform_fee_percent';

/* A new price row for each category, effective today. The old rows stay exactly
   as they are: every ticket already sold keeps the figures it was sold at, and
   the history of what was charged when survives. */
INSERT INTO place_pricing (place_id, category_id, entry_paise, platform_paise, effective_from)
SELECT p.id, c.id, v.entry, v.fee, CURRENT_DATE
  FROM places p
  CROSS JOIN (VALUES
    -- entry, service fee at 13% rounded to the nearest rupee
    ('BIKE',    5000,   700),   -- 6.50 -> 7
    ('CAR',    10000,  1300),   -- 13.00
    ('TOOFAN', 15000,  2000),   -- 19.50 -> 20
    ('TT',     20000,  2600)    -- 26.00
  ) AS v(code, entry, fee)
  JOIN vehicle_categories c ON c.code = v.code
 WHERE p.code = 'MULLAYANAGIRI'
ON CONFLICT (place_id, category_id, effective_from)
DO UPDATE SET entry_paise = EXCLUDED.entry_paise,
              platform_paise = EXCLUDED.platform_paise,
              is_active = true;

/* What the department is being promised, in words, so the ticket, the proposal
   and the agreement all say the same thing. */
INSERT INTO app_settings (key, value, note) VALUES
  ('department_receives_gross', 'true',
   'The department receives the nominal entry fee with no deduction of any kind. All payment '
   || 'gateway and transfer charges are borne by ServerPe out of the service fee.'),
  ('fee_label', 'Service & convenience fee',
   'What the visitor''s charge is called on the payment page, the ticket and the invoice.')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, note = EXCLUDED.note;

COMMIT;
