-- What a shift did, kept with the shift.
--
-- WHY IT IS STORED, NOT ONLY WORKED OUT. The figures can be recomputed from
-- scans and sales at any time — but the handover is a moment: the staff member
-- saw these numbers on their phone, counted the cash against them, and ended
-- the shift. Keeping exactly what they were shown means an argument next week
-- about the cash is settled by what was on the screen, not by a query run after
-- somebody corrected a sale.
--
-- A shift that ended without the End shift button — taken over by the next
-- person, left idle, or the staff member disabled — has no handover saved; the
-- panel works its figures out from the records instead.

ALTER TABLE staff_sessions ADD COLUMN IF NOT EXISTS handover jsonb;
