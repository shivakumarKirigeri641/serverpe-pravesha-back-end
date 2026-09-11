-- 016_remove_qr.sql — the signed QR, removed.
--
-- WHY IT WENT. A ticket is bound to a vehicle, not to a person: whoever is
-- driving is nobody's business but the owner's. So the only thing that ever
-- mattered at the barrier was the number plate, and the QR was an elaborate way
-- of restating a number already written on the bumper in front of the officer.
--
-- It also bought less than it appeared to. A forged code was caught by its
-- signature — but a vehicle whose plate is not in the day's list is refused
-- whether it presents a perfect forgery or nothing at all. Having nothing to
-- forge is a stronger position than being good at spotting forgeries.
--
-- And it added failures that had nothing to do with entry: a flat battery, a
-- cracked screen, a deleted chat, sunlight on glass, a visitor who cannot find
-- the message while a queue builds behind them.
--
-- WHAT REPLACED IT. The staff member reads the last few characters off the
-- plate, types them, and picks the vehicle from what comes back. The gate holds
-- the day's bookings locally so this works with no signal.
--
-- DROPPING THE COLUMN IS DELIBERATE AND IRREVERSIBLE. The payloads are signed
-- with a key that no longer exists in the application, so they can no longer be
-- verified and nothing can read them; keeping them would leave a column of
-- unverifiable strings that a future reader would mistake for live data. The
-- tickets themselves are untouched — every booking keeps its number, plate,
-- date, slot and money.

ALTER TABLE tickets DROP COLUMN IF EXISTS qr_payload;

-- The verdicts a gate can now reach. 'invalid_signature' and 'unknown_ticket'
-- are gone: there is no signature to fail, and a plate that is not in the list
-- is 'not_found' — which is also what a staff member needs to be told, because
-- the answer is "sell them one or turn them back" rather than "this is fraud".
--
-- Rows already carrying the old verdicts are left exactly as they are. They are
-- a true record of what the gate decided on the day, and rewriting history to
-- match today's vocabulary would be the wrong kind of tidy.
COMMENT ON COLUMN scans.verdict IS
  'valid | already_used | wrong_day | wrong_slot | wrong_place | cancelled | not_paid | not_found. '
  'Historic rows may also carry invalid_signature or unknown_ticket, from the period when '
  'entry was by signed QR.';

COMMENT ON COLUMN scans.raw_payload IS
  'What the staff member typed — the last characters of the plate. Kept verbatim: in a dispute '
  'the argument is about what was entered, never about what we derived from it.';

-- This gated whether the admin panel could render a working ticket onto a
-- screen. There is no longer a credential to leak that way; it now governs only
-- whether a live payment link is shown, which is a much smaller thing but still
-- worth a switch.
UPDATE app_settings
   SET note = 'Show the live checkout link on the admin ticket board. A payment link on screen is payable by anyone who photographs it.'
 WHERE key = 'show_qr_in_admin';
