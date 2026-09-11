-- 028_checkpost_staff.sql — what the checkpost view needs from the database.
--
-- The tables were built in 002 (staff, staff_checkposts, devices,
-- staff_sessions, scans) and are used unchanged. This adds only what the gate
-- screens actually query, plus the settings they read.

BEGIN;

-- A staff member is their mobile number, the same way a customer is: it is what
-- they type to sign in, so two rows sharing one cannot be allowed to exist.
-- Not a partial index: Postgres already allows repeated NULLs in a unique
-- index, and a plain one can be named in ON CONFLICT (mobile) when an
-- administrator re-issues a PIN for someone who already exists.
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_mobile ON staff (mobile);

-- The arrivals list: every pass for one place on one day, newest first. Without
-- this the gate's main screen is a sequential scan of every ticket ever sold.
CREATE INDEX IF NOT EXISTS idx_tickets_place_date
    ON tickets (place_id, travel_date, status);

-- "Has this vehicle got a pass today?" — typed at the gate, one plate at a time.
CREATE INDEX IF NOT EXISTS idx_tickets_reg_date
    ON tickets (reg_no, travel_date);

-- A pass's entry history, for the already-used answer ("entered at 09:12 by
-- Ramesh") and for the day's log.
CREATE INDEX IF NOT EXISTS idx_scans_ticket
    ON scans (ticket_id, scanned_at DESC);

CREATE INDEX IF NOT EXISTS idx_scans_checkpost_time
    ON scans (checkpost_id, scanned_at DESC);

-- A staff session is a shift, not a login: it lives until the shift ends or the
-- phone is idle for this long. Long enough that nobody re-enters a PIN mid-rush,
-- short enough that a phone left in a jeep overnight is signed out.
INSERT INTO app_settings (key, value, note)
VALUES ('staff_session_hours', '14', 'Hours a checkpost sign-in stays valid without activity')
ON CONFLICT (key) DO NOTHING;

-- Five wrong PINs and the account is locked for this long. The lock is on the
-- staff row, so moving to another phone does not reset it.
INSERT INTO app_settings (key, value, note)
VALUES ('staff_lock_minutes', '15', 'Minutes a staff account is locked after repeated wrong PINs')
ON CONFLICT (key) DO NOTHING;

COMMIT;
