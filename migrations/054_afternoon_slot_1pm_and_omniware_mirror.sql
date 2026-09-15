-- The afternoon slot starts at 1 PM, and Omniware's bookings can be mirrored.
--
-- The department's current booking site (Omniware) sells 6 AM - 12 PM and
-- 1 PM - 6 PM; the gate closes for the hour in between. The slot keeps its code
-- '1206' so nothing that refers to it by code breaks — only the times and the
-- labels move.
--
-- omniware_booked is how many of a date's places Omniware has already sold,
-- copied in by scripts/sync-omniware-slots.js for testing. It is also counted
-- inside `booked`, so every screen and the claim in inventory.hold() see the
-- real limit without knowing Omniware exists. Kept apart so a re-sync replaces
-- the previous figure instead of adding to it, and --remove can take it out.

UPDATE place_slots
   SET starts_at = '13:00', ends_at = '18:00',
       label = 'Afternoon 1:00 PM - 6:00 PM',
       label_kn = 'ಮಧ್ಯಾಹ್ನ 1:00 - ಸಂಜೆ 6:00',
       modified_at = now()
 WHERE code = '1206';

ALTER TABLE slot_inventory
  ADD COLUMN IF NOT EXISTS omniware_booked integer NOT NULL DEFAULT 0 CHECK (omniware_booked >= 0);
