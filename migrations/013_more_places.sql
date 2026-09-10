-- 013_more_places.sql
--
-- The other Karnataka sites, so the booking form has something to choose
-- between.
--
-- Mullayanagiri is the one the proposal is written around and the only one
-- with confirmed prices. THE THREE BELOW ARE PLACEHOLDERS: their entry fees,
-- capacities and slot timings are copied from Mullayanagiri because nobody has
-- given us the real ones yet, and a form with one option in a dropdown looks
-- broken.
--
-- They are inserted as INACTIVE for exactly that reason. A visitor must not be
-- able to buy a Kodachadri ticket at a Mullayanagiri price against a capacity
-- somebody guessed. Turn one on only when its department has confirmed the
-- numbers:
--
--   UPDATE places SET is_active = true WHERE code = 'KUDREMUKHA';

INSERT INTO places (code, name, district, is_active)
VALUES
  ('KUDREMUKHA',  'Kudremukha Trek',   'Chikkamagaluru', false),
  ('KODACHADRI',  'Kodachadri Trek',   'Shivamogga',     false),
  ('JOGFALLS',    'Jog Falls',         'Shivamogga',     false)
ON CONFLICT (code) DO NOTHING;

-- Slots, pricing and capacity mirrored from Mullayanagiri so an activated site
-- is functional rather than half-configured. Every one of these numbers is a
-- placeholder to be replaced with what the department actually sets.
INSERT INTO place_slots (place_id, code, label, starts_at, ends_at, sort_order, is_active)
SELECT p.id, s.code, s.label, s.starts_at, s.ends_at, s.sort_order, s.is_active
  FROM places p
  CROSS JOIN (
    SELECT code, label, starts_at, ends_at, sort_order, is_active
      FROM place_slots
     WHERE place_id = (SELECT id FROM places WHERE code = 'MULLAYANAGIRI')
  ) s
 WHERE p.code IN ('KUDREMUKHA', 'KODACHADRI', 'JOGFALLS')
   AND NOT EXISTS (
     SELECT 1 FROM place_slots x WHERE x.place_id = p.id AND x.code = s.code);

INSERT INTO place_pricing (place_id, category_id, entry_paise, platform_paise,
                           effective_from, is_active)
SELECT p.id, pr.category_id, pr.entry_paise, pr.platform_paise,
       CURRENT_DATE, true
  FROM places p
  CROSS JOIN (
    SELECT category_id, entry_paise, platform_paise
      FROM place_pricing
     WHERE place_id = (SELECT id FROM places WHERE code = 'MULLAYANAGIRI')
       AND is_active
  ) pr
 WHERE p.code IN ('KUDREMUKHA', 'KODACHADRI', 'JOGFALLS')
   AND NOT EXISTS (
     SELECT 1 FROM place_pricing x
      WHERE x.place_id = p.id AND x.category_id = pr.category_id AND x.is_active);

INSERT INTO slot_capacity (place_id, slot_id, category_id, capacity)
SELECT p.id, ns.id, sc.category_id, sc.capacity
  FROM places p
  JOIN place_slots ns ON ns.place_id = p.id
  JOIN place_slots ms ON ms.code = ns.code
   AND ms.place_id = (SELECT id FROM places WHERE code = 'MULLAYANAGIRI')
  JOIN slot_capacity sc ON sc.slot_id = ms.id
 WHERE p.code IN ('KUDREMUKHA', 'KODACHADRI', 'JOGFALLS')
   AND NOT EXISTS (
     SELECT 1 FROM slot_capacity x
      WHERE x.place_id = p.id AND x.slot_id = ns.id AND x.category_id = sc.category_id);
