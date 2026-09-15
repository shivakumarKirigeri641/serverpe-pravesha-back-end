-- Passes that count people rather than a vehicle (user, 2026-09-15).
--
-- WHY. A destination such as Nandi Hills may charge per person — ₹10 each, up
-- to ten people on one pass, from one pool for the whole day — while
-- Mullayanagiri charges per vehicle. Both have to run on the same platform:
-- the same WhatsApp number, the same payment, the same gate app. Mullayanagiri
-- must not change at all.
--
-- HOW, IN THE SMALLEST CHANGE THAT KEEPS EVERYTHING JOINED.
--
--   * A destination says how it books: 'vehicle' (the default, and every place
--     that exists today) or 'person', with the most people one pass may carry.
--
--   * Per-person passes belong to one category, PERSON, marked per_person.
--     Reports, lists and analytics join a pass to its category; a real category
--     keeps these passes in those joins instead of silently dropping them.
--
--   * A pass says what kind it is and how many people it carries. A vehicle pass
--     must still name its vehicle and plate — the constraint below keeps that
--     true — and only a person pass may leave them empty. Nothing about a
--     vehicle pass is loosened.
--
--   * Capacity is still slot_inventory, counted in people at a person place: a
--     pass for four holds four places, and the existing check that booked plus
--     held never exceeds capacity still guards it.
--
--   * The gate records how many people it let in on a person pass, which may be
--     fewer than were booked, never more.

ALTER TABLE places
  ADD COLUMN IF NOT EXISTS booking_mode text NOT NULL DEFAULT 'vehicle';
ALTER TABLE places DROP CONSTRAINT IF EXISTS places_booking_mode_check;
ALTER TABLE places ADD CONSTRAINT places_booking_mode_check
  CHECK (booking_mode IN ('vehicle', 'person'));

ALTER TABLE places
  ADD COLUMN IF NOT EXISTS max_persons_per_pass integer NOT NULL DEFAULT 10;
ALTER TABLE places DROP CONSTRAINT IF EXISTS places_max_persons_check;
ALTER TABLE places ADD CONSTRAINT places_max_persons_check
  CHECK (max_persons_per_pass BETWEEN 1 AND 50);

ALTER TABLE vehicle_categories
  ADD COLUMN IF NOT EXISTS per_person boolean NOT NULL DEFAULT false;

-- is_active = false ON PURPOSE. More than twenty queries list "the vehicle
-- types" with WHERE is_active — the booking form, pricing, slots and capacity,
-- on-spot sales, live monitoring, reports, the public price list. PERSON is not
-- a vehicle type and must not appear in any of them for a vehicle destination.
-- Left inactive, every one of those lists skips it untouched, while every join
-- from a pass to its category (which does not filter on is_active) still finds
-- it. A per-person destination selects this category by per_person, never by
-- is_active. Switching it "on" in an admin screen would be a mistake.
INSERT INTO vehicle_categories (code, label, label_kn, sort_order, is_active, per_person)
SELECT 'PERSON', 'Visitors (per person)', 'ಪ್ರವಾಸಿಗರು (ಪ್ರತಿ ವ್ಯಕ್ತಿಗೆ)', 99, false, true
 WHERE NOT EXISTS (SELECT 1 FROM vehicle_categories WHERE code = 'PERSON');
UPDATE vehicle_categories SET per_person = true, is_active = false WHERE code = 'PERSON';

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS pass_kind text NOT NULL DEFAULT 'vehicle';
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_pass_kind_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_pass_kind_check
  CHECK (pass_kind IN ('vehicle', 'person'));

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS persons integer NOT NULL DEFAULT 1;
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_persons_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_persons_check
  CHECK (persons BETWEEN 1 AND 50);

ALTER TABLE tickets ALTER COLUMN vehicle_id DROP NOT NULL;
ALTER TABLE tickets ALTER COLUMN reg_no DROP NOT NULL;

-- A vehicle pass still names its vehicle and its plate.
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_vehicle_pass_has_vehicle;
ALTER TABLE tickets ADD CONSTRAINT tickets_vehicle_pass_has_vehicle
  CHECK (pass_kind = 'person' OR (vehicle_id IS NOT NULL AND reg_no IS NOT NULL));

ALTER TABLE scans
  ADD COLUMN IF NOT EXISTS persons integer;
ALTER TABLE scans DROP CONSTRAINT IF EXISTS scans_persons_check;
ALTER TABLE scans ADD CONSTRAINT scans_persons_check
  CHECK (persons IS NULL OR persons BETWEEN 1 AND 50);
