-- 065 — where slot availability comes from, as a setting rather than a deploy.
--
-- It used to be the SLOTS_TYPE environment variable: unset meant our own
-- database decided what was free, SLOTS_TYPE=1 meant the department's live
-- Omniware counts were folded in first. Changing it needed an edit on the
-- server and a restart, which during a demonstration is not a switch at all.
--
-- The default is our own database. Mirroring a third party's numbers is the
-- unusual choice and the one that can fail in public, so it is the one that has
-- to be asked for -- and on a fresh install nothing reaches out to Omniware
-- until somebody turns it on.
--
-- Any omniware_booked already folded into a slot is taken back out the next
-- time that date's availability is read while the setting says 'db'
-- (omniwareSlots.refreshDate), so no row is left claiming places that our own
-- passes never took.

INSERT INTO app_settings (key, value, note)
VALUES ('slots_source', 'db',
        'Where slot availability comes from: db = our own database alone; omniware = the department''s live sold counts are folded in first.')
ON CONFLICT (key) DO NOTHING;
