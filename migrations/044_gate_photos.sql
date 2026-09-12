-- Photographs taken at the barrier.
--
-- WHY THE DATABASE HOLDS THE BYTES. There is no object store in this deployment
-- and the filesystem under the app is not guaranteed to survive a redeploy. The
-- volume here is a handful of on-spot sales a day at roughly 150 KB each after
-- the phone has shrunk the image, so the bytes live in the row: one thing to
-- back up, one thing to restore, and a photograph that cannot be separated from
-- the sale it proves. If either assumption changes — real volume, or a bucket to
-- write to — this table becomes a pointer and the bytes move out.
--
-- WHY A PHOTOGRAPH AT ALL. Two questions the gate cannot otherwise answer. A UPI
-- payment at a barrier is a reference number somebody typed, and a typo is
-- indistinguishable from a payment that never happened until the reconciliation
-- fails a week later; the screen the visitor held up settles it. And a vehicle
-- with no number plate is identified by whatever was written down about it — a
-- chassis number, a driver's name — none of which can be checked afterwards. A
-- picture of the vehicle can.
--
-- IT IS TAKEN BEFORE THE PASS EXISTS, because the sale is not finished while the
-- staff member is holding up a camera. So ticket_id is null until the sale
-- completes and claims it; anything never claimed is rubbish and is swept away.

CREATE TABLE IF NOT EXISTS gate_photos (
  id            bigserial PRIMARY KEY,
  ticket_id     bigint REFERENCES tickets(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('upi', 'vehicle', 'plate', 'other')),
  mime          text NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  bytes         bytea NOT NULL,
  byte_size     integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 3145728),
  width         integer,
  height        integer,
  taken_by      bigint REFERENCES staff(id) ON DELETE SET NULL,
  taken_by_admin bigint REFERENCES admin_users(id) ON DELETE SET NULL,
  checkpost_id  bigint REFERENCES checkposts(id) ON DELETE SET NULL,
  note          text,
  is_test       boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Every lookup is either "the photos for this pass" or the sweep for unclaimed
-- ones, so those are the two indexes.
CREATE INDEX IF NOT EXISTS idx_gate_photos_ticket ON gate_photos (ticket_id) WHERE ticket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gate_photos_unclaimed ON gate_photos (created_at) WHERE ticket_id IS NULL;
