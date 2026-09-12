-- 042_gate_onspot.sql — selling a pass at the barrier, including to vehicles
-- the register has never heard of.
--
-- THREE WAYS A VEHICLE CAN BE IDENTIFIED, and the difference matters enough to
-- record:
--
--   rc         VAHAN answered: make, model and class came from the register,
--              and the price follows from the class. This is every booking made
--              on WhatsApp, and most sold at the gate.
--   declared   The register has nothing — a temporary registration on a vehicle
--              bought last week, a dealer plate, or a lookup that simply failed
--              — so the staff member reads the vehicle and says what it is. The
--              price is then somebody's judgement, which is why it is written
--              down as theirs.
--   no_plate   No number to key anything on: a new vehicle being driven up on
--              its invoice, or a plate that has fallen off. It gets an
--              identifier of our own and whatever the staff member can put
--              against it — chassis number, driver's name and phone.
--
-- Without this distinction a declared Toofan and a verified one look identical
-- in every report, and nobody can tell which prices were read off the register
-- and which were somebody's guess at a barrier in the rain.

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS identified_by text NOT NULL DEFAULT 'rc'
    CHECK (identified_by IN ('rc', 'declared', 'no_plate')),
  ADD COLUMN IF NOT EXISTS identity_note text;

/* Who sold it, and where. issued_by already names a panel user; a pass sold at
   the barrier is sold by gate staff, who are not panel users at all. */
ALTER TABLE ticket_grants
  ADD COLUMN IF NOT EXISTS issued_by_staff bigint REFERENCES staff(id),
  ADD COLUMN IF NOT EXISTS checkpost_id    bigint REFERENCES checkposts(id),
  ADD COLUMN IF NOT EXISTS declared        boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_ticket_grants_staff ON ticket_grants (issued_by_staff, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicles_identified ON vehicles (identified_by) WHERE identified_by <> 'rc';
