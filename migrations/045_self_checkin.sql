-- "I am already at the checkpost."
--
-- WHAT IT IS FOR. A visitor turned away at the barrier for having no pass books
-- one standing there, on their phone, with the staff member watching. Making
-- them then queue to be checked in is asking them to prove they are where
-- everybody can see they are. A tick box on the payment sheet records the entry
-- with the payment.
--
-- WHY IT IS NOT SIMPLY "used". A pass marked used is a pass the gate refuses,
-- and the box can be ticked by somebody sitting at home who has misread it.
-- Refusing a paying visitor at a barrier because of a mistap on a form is a far
-- worse failure than the queueing it saves. So the entry is recorded AND its
-- source is kept: an entry nobody at the gate witnessed is a different fact from
-- one a staff member checked, and the gate is told which it is holding rather
-- than being left to treat them alike.
--
-- WHAT THE COLUMN CARRIES.
--   null    no entry recorded yet
--   'gate'  a staff member checked the vehicle at the barrier
--   'self'  the visitor declared it when paying, unwitnessed
--
-- A self-declared entry can still be checked at the gate afterwards, and doing
-- so moves it to 'gate' — the stronger fact replaces the weaker one.

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS entry_source text
  CHECK (entry_source IS NULL OR entry_source IN ('gate', 'self'));

-- Asked for at the moment of paying, acted on when the payment lands: the two
-- are separate events and the intent has to survive the gap between them.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS self_checkin_asked boolean NOT NULL DEFAULT false;

-- Entries that nobody witnessed are worth counting separately, and the reports
-- that do it filter on this column.
CREATE INDEX IF NOT EXISTS idx_tickets_entry_source ON tickets (travel_date, entry_source)
  WHERE entry_source IS NOT NULL;

-- Everything already recorded was recorded by a person at a barrier.
UPDATE tickets SET entry_source = 'gate' WHERE status = 'used' AND entry_source IS NULL;
