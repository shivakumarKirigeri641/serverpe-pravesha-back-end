-- 058_maxi_cab_is_a_car_unless_the_model_says_otherwise.sql
--
-- An Innova Crysta is a car (user, 2026-09-15).
--
-- WHAT WAS WRONG. "Maxi Cab" is not a kind of vehicle, it is a licence: the
-- Motor Vehicles Act calls anything carrying more than 6 and not more than 12
-- passengers for hire a Maxi Cab. An 8-seat Innova Crysta taxi, a Force Toofan
-- and a 12-seat Force Traveller are all Maxi Cabs, and VAHAN files all three
-- under the same class and the same category. So the class alone cannot say
-- what a vehicle is, and the row that read it as "Toofan" priced an Innova at
-- the Toofan rate.
--
-- WHAT DECIDES INSTEAD. The model, which is the only field that distinguishes
-- them:
--
--   TRAVELLER, TEMPO                         -> Tempo Traveller   Rs 200
--   TOOFAN, TRAX, CRUISER, TAVERA, WINGER…   -> Toofan            Rs 150
--   anything else carrying up to 12          -> Car               Rs 100
--
-- A commercially registered Innova therefore pays the car rate, the same as the
-- identical vehicle in private hands.
--
-- The class row is kept rather than deleted, pointed at Car and dropped below
-- the two model rows, so a Maxi Cab whose model we do not recognise is priced
-- as a car instead of falling through to "please tell us what this is" at the
-- barrier. Deliberately generous: the failure it replaces is overcharging, and
-- undercharging a rare vehicle is the cheaper mistake of the two.

-- The class-only Maxi Cab row: now Car, and below the model rows.
UPDATE vehicle_class_map
   SET category_id = (SELECT id FROM vehicle_categories WHERE code = 'CAR'),
       pattern     = 'MAXI.?CAB|MAXICAB|OMNI',
       priority    = 60,
       note        = 'Maxi Cab is a licence, not a body: a car unless a model row above says otherwise'
 WHERE pattern = 'MAXI.?CAB|TOOFAN|TRAX|OMNI|MAXICAB';

-- A class that literally says Toofan or Trax is still a Toofan, whatever the
-- model field holds. Above the Maxi Cab row, below the model rows.
INSERT INTO vehicle_class_map (category_id, pattern, priority, note)
SELECT (SELECT id FROM vehicle_categories WHERE code = 'TOOFAN'),
       'TOOFAN|TRAX', 85,
       'The class itself names a Toofan'
 WHERE NOT EXISTS (SELECT 1 FROM vehicle_class_map WHERE pattern = 'TOOFAN|TRAX');
