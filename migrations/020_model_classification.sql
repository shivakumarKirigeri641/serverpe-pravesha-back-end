-- 020_model_classification.sql — when the registration class cannot tell two
-- vehicles apart, the model can.
--
-- THE CASE THIS EXISTS FOR. A Force Cruiser is a Toofan and pays 150. A Kia
-- Seltos is a car and pays 100. VAHAN describes both identically:
--
--   Force Cruiser  -> Motor Car / LIGHT MOTOR VEHICLE / 10 seats
--   Kia Seltos     -> Motor Car / LIGHT MOTOR VEHICLE /  5 seats
--
-- Nothing in the class or the category separates them, so a class map alone will
-- always charge the Cruiser car rates. Seats look like the answer and are not:
-- the same field reports 2 for a fifteen-metre Volvo coach (see 018). What does
-- separate them reliably is the maker and model, which are the fields VAHAN
-- keeps accurately because they come from the manufacturer rather than from a
-- clerk choosing a category.
--
-- SO MODEL MATCHING IS ADDED AS A SECOND WAY FOR A ROW TO MATCH, not as a
-- replacement. Class matching still does the bulk of the work -- it is broad and
-- covers vehicles nobody has listed by name. Model matching sits above it for
-- the handful of cases where the class is genuinely ambiguous.
--
-- THIS LIST WILL BE INCOMPLETE AND THAT IS THE EXPECTED STATE. It names the
-- vehicles that actually work these routes. A Toofan-class vehicle nobody has
-- listed falls through to its registration class and pays car rates, which is
-- wrong by fifty rupees and not wrong enough to justify guessing from seats.

ALTER TABLE vehicle_class_map ADD COLUMN IF NOT EXISTS model_pattern text;

COMMENT ON COLUMN vehicle_class_map.model_pattern IS
  'Matched against "maker model". A row matches if its class pattern hits OR this does.';

/* A row may now carry a model pattern instead of a class pattern, so the class
   pattern can no longer be required. */
ALTER TABLE vehicle_class_map ALTER COLUMN pattern DROP NOT NULL;

/* Tempo Travellers. The Force Traveller registers as Maxi Cab / LIGHT PASSENGER
   VEHICLE, which the Maxi Cab row below would otherwise price as a Toofan.
   Confirmed: KA13AA6804 -> FORCE MOTORS LIMITED / TRAVELLER T1 / 13 seats. */
INSERT INTO vehicle_class_map (category_id, pattern, model_pattern, priority, note)
SELECT id, 'LIGHT.?PASSENGER.?VEHICLE', 'TRAVELLER|TEMPO', 95,
       'Tempo Traveller by model — outranks the Maxi Cab row'
  FROM vehicle_categories WHERE code = 'TT'
ON CONFLICT DO NOTHING;

/* Toofan-class people carriers that register as plain Motor Car.
   Confirmed: HR24AF4132 -> FORCE MOTORS LIMITED / CRUISER / 10 seats. */
INSERT INTO vehicle_class_map (category_id, pattern, model_pattern, priority, note)
SELECT id, NULL, 'CRUISER|TRAX|TOOFAN|TAVERA|SUMO.?GOLD|WINGER', 94,
       'Toofan-class by model — these register as Motor Car and would price as cars'
  FROM vehicle_categories WHERE code = 'TOOFAN'
ON CONFLICT DO NOTHING;

