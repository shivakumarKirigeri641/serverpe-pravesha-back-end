-- 017_declared_category.sql — bookings where the visitor told us the vehicle type.
--
-- THE CASE THIS EXISTS FOR. The entry fee depends on what the vehicle is, and
-- normally we read that from the registration record rather than asking: a
-- person asked "is this a car or a Toofan?" will answer whichever is cheaper,
-- and the gate then has an argument on its hands.
--
-- But the record is not always there. A pre-1989 registration predates the
-- database entirely. A very new vehicle may not have propagated. And the lookup
-- itself can be down. Refusing to sell a ticket in those cases would turn away
-- a genuine visitor over a database we do not control, so instead the visitor
-- is shown the categories with their prices and picks one.
--
-- WHY IT IS RECORDED RATHER THAN JUST ALLOWED. A self-declared category is the
-- one place in this system where the price is set by the person paying it. That
-- is a reasonable trade at the point of sale and an unreasonable one to leave
-- invisible, so the ticket carries a flag and the gate is told: the staff member
-- has the vehicle in front of them and is the only one who can see that a
-- "two-wheeler" is a Tempo Traveller.
--
-- `declared_reason` separates the two cases that look identical in the data and
-- are not the same thing at all: 'no_record' is a vehicle the database genuinely
-- does not have, which is expected and permanent; 'lookup_failed' is our
-- supplier being unreachable, which is temporary and, if it ever shows up in
-- bulk, means every booking that hour was self-priced and should be looked at.

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS category_declared boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS declared_reason   text;

COMMENT ON COLUMN tickets.category_declared IS
  'True when the vehicle category came from the visitor rather than from the registration record. '
  'Surfaced at the gate so the staff member checks the vehicle against the type charged.';

COMMENT ON COLUMN tickets.declared_reason IS
  'no_record = the registration database has no such vehicle (expected for pre-1989 plates). '
  'lookup_failed = our supplier was unreachable (temporary; a run of these is worth investigating).';

-- Finding them is a support and audit question — "which bookings priced
-- themselves today?" — so it is worth an index on the few rows that are true.
CREATE INDEX IF NOT EXISTS idx_tickets_declared
    ON tickets (travel_date, place_id) WHERE category_declared;
