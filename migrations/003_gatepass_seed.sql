-- 003_gatepass_seed.sql — Mullayanagiri, ready to sell.
--
-- Everything here is a starting value, not a decision cast in code: prices,
-- capacities and the booking window all live in tables precisely so the
-- department can change them from the admin panel without a deploy. Seeded so
-- the demo has something real to run against on the first boot.
--
-- Numbers confirmed with the assistant commissioner's office: 400 cars, 150
-- bikes, 100 Toofan, 100 Tempo Traveller — PER SLOT, and the day has two slots.
-- Entry is Rs.100 for a car today; the other categories are set proportionally
-- and are the first thing to correct if the department says otherwise.
--
-- The platform fee is ours and is shown as its own line everywhere. Entry money
-- is collected as a pure agent for the department (CGST Rule 33) and is not our
-- revenue, so GST applies to the platform fee alone.

BEGIN;

/* ══════════════════════════════════════════════════════════════ the place */

INSERT INTO places (code, name, district, booking_days_ahead)
VALUES ('MULLAYANAGIRI', 'Mullayanagiri', 'Chikkamagaluru', 14)
ON CONFLICT (code) DO NOTHING;

-- Two slots, split at noon. The code is what appears in a reference id and in
-- conversation, so it reads as the hours it covers.
INSERT INTO place_slots (place_id, code, label, starts_at, ends_at, sort_order)
SELECT p.id, v.code, v.label, v.s::time, v.e::time, v.ord
  FROM places p
  CROSS JOIN (VALUES
    ('0612', 'Morning  6:00 AM - 12:00 PM',   '06:00', '12:00', 1),
    ('1206', 'Afternoon 12:00 PM - 6:00 PM',  '12:00', '18:00', 2)
  ) AS v(code, label, s, e, ord)
 WHERE p.code = 'MULLAYANAGIRI'
ON CONFLICT (place_id, code) DO NOTHING;

/* ═══════════════════════════════════════════════════════════ what can enter */

INSERT INTO vehicle_categories (code, label, sort_order)
VALUES ('BIKE',   'Two-wheeler',       1),
       ('CAR',    'Car / Jeep / SUV',  2),
       ('TOOFAN', 'Toofan / Maxi Cab', 3),
       ('TT',     'Tempo Traveller',   4)
ON CONFLICT (code) DO NOTHING;

-- ULIP returns a vehicle class in words. This turns those words into a gate
-- category. Highest priority wins, so the specific rules sit above the general
-- ones — 'MAXI CAB' must be read before the plain 'CAB' that would otherwise
-- swallow it.
INSERT INTO vehicle_class_map (category_id, pattern, priority, note)
SELECT c.id, v.pattern, v.priority, v.note
  FROM vehicle_categories c
  JOIN (VALUES
    ('TT',     'TEMPO.?TRAVELLER|OMNI.?BUS|MINI.?BUS|EDUCATIONAL.?BUS|BUS', 90,  'Tempo Traveller and small buses'),
    ('TOOFAN', 'MAXI.?CAB|TOOFAN|TRAX|OMNI|MAXICAB',                        80,  'Maxi cab class'),
    ('BIKE',   'M-?CYCLE|MOTOR.?CYCLE|SCOOTER|MOPED|TWO.?WHEELER|M.?CYCLE/SCOOTER', 70, 'Two-wheelers'),
    ('CAR',    'MOTOR.?CAR|LMV|JEEP|SUV|CAR|LIGHT.?MOTOR|MOTOR.?CAB|TAXI',  50,  'Cars, jeeps and taxis'),
    -- The safety net. An unrecognised class is charged as a car rather than
    -- refused: a visitor turned away at the gate over a class string is a worse
    -- failure than a few rupees of price difference, and the admin panel shows
    -- what landed here so the mapping can be corrected.
    ('CAR',    '.*',                                                          1,  'Fallback for unmapped classes')
  ) AS v(code, pattern, priority, note) ON v.code = c.code
 WHERE NOT EXISTS (SELECT 1 FROM vehicle_class_map WHERE pattern = v.pattern);

/* ═════════════════════════════════════════════════════════════════ pricing */

-- entry_paise goes to Karnataka Tourism. platform_paise is ours, and GST is
-- computed on that alone at the moment of payment.
INSERT INTO place_pricing (place_id, category_id, entry_paise, platform_paise)
SELECT p.id, c.id, v.entry, v.platform
  FROM places p
  CROSS JOIN (VALUES
    ('BIKE',    5000,  500),
    ('CAR',    10000, 1000),
    ('TOOFAN', 15000, 1500),
    ('TT',     20000, 2000)
  ) AS v(code, entry, platform)
  JOIN vehicle_categories c ON c.code = v.code
 WHERE p.code = 'MULLAYANAGIRI'
   AND NOT EXISTS (
     SELECT 1 FROM place_pricing pp
      WHERE pp.place_id = p.id AND pp.category_id = c.id);

/* ═══════════════════════════════════════════════════════════════ capacity */

-- Per slot, not per day: a vehicle that books the morning has taken a morning
-- place, and the afternoon starts full again.
INSERT INTO slot_capacity (place_id, slot_id, category_id, capacity)
SELECT p.id, s.id, c.id, v.cap
  FROM places p
  JOIN place_slots s ON s.place_id = p.id
  CROSS JOIN (VALUES
    ('BIKE',   150),
    ('CAR',    400),
    ('TOOFAN', 100),
    ('TT',     100)
  ) AS v(code, cap)
  JOIN vehicle_categories c ON c.code = v.code
 WHERE p.code = 'MULLAYANAGIRI'
ON CONFLICT (place_id, slot_id, category_id) DO NOTHING;

/* ════════════════════════════════════════════════════════════ the gate itself */

INSERT INTO checkposts (place_id, name)
SELECT p.id, 'Mullayanagiri Main Gate'
  FROM places p
 WHERE p.code = 'MULLAYANAGIRI'
   AND NOT EXISTS (SELECT 1 FROM checkposts WHERE place_id = p.id);

/* ══════════════════════════════════════════════════════════════ settings */

INSERT INTO app_settings (key, value, note) VALUES
  ('gst_percent_on_platform', '18',
   'GST applies to the platform fee only; entry money is collected as a pure agent (CGST Rule 33).'),
  ('hold_minutes', '10',
   'How long a slot is held while a customer is at the payment page before it is released.'),
  ('ticket_qr_version', '1',
   'Signature payload version. Bump only alongside a scanner release that understands it.'),
  ('booking_cutoff_minutes', '0',
   'Minutes before a slot starts after which it can no longer be booked. 0 = up to start time.'),
  ('same_day_booking', 'true',
   'Whether today itself can be booked.'),
  ('support_mobile', '9886122415',
   'Shown on tickets and at the gate when something needs a human.'),
  ('merchant_name', 'ServerPe App Solutions', NULL),
  ('collecting_for', 'Karnataka Tourism Department',
   'Named on the invoice as the party the entry fee is collected for.')
ON CONFLICT (key) DO NOTHING;

COMMIT;
