-- 059_toofan_label_drops_maxi_cab.sql
--
-- The Rs 150 rate is for Toofan-type vehicles (user, 2026-09-15).
--
-- The category was labelled "Toofan / Maxi Cab", which stopped being true in
-- 058: a Maxi Cab is a licence to carry up to twelve for hire, so an Innova
-- Crysta taxi is one, and it pays the car rate. Leaving "Maxi Cab" on the rate
-- card would promise a driver the Toofan rate and then charge him something
-- else at the barrier — an argument at a gate, and a fair one.
--
-- Named by the vehicles people actually recognise instead. Nobody at a
-- checkpost says "maxi cab"; they say Toofan, Trax or Cruiser, and those are
-- exactly the models the Rs 150 rule matches on.

UPDATE vehicle_categories
   SET label    = 'Toofan / Trax / Cruiser',
       label_kn = 'ಟೂಫಾನ್ / ಟ್ರಾಕ್ಸ್ / ಕ್ರೂಸರ್'
 WHERE code = 'TOOFAN';
