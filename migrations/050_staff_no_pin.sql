-- Gate staff sign in with a code sent to their phone; the PIN is gone.
--
-- WHAT GIVES ACCESS NOW. An administrator adds the staff member's mobile number
-- and keeps them enabled. That is the whole of it: a code is only ever sent to an
-- enabled number posted to a checkpost (see 048 and staffOtp.js), so switching a
-- person off in the panel is what takes the gate away from them.
--
-- WHY THE OLD PINS ARE ERASED, NOT JUST IGNORED. A PIN that still matches is a
-- second way through the gate that nobody is watching. The route that accepted it
-- is removed in the same change; clearing the hashes means that even an old copy
-- of the code could not let a remembered PIN back in.

ALTER TABLE staff ALTER COLUMN pin_hash DROP NOT NULL;

UPDATE staff SET pin_hash = NULL, failed_attempts = 0, locked_until = NULL, modified_at = now()
 WHERE pin_hash IS NOT NULL OR failed_attempts <> 0 OR locked_until IS NOT NULL;

COMMENT ON COLUMN staff.pin_hash IS 'Unused since 050: staff sign in with an SMS code. Always NULL.';
