-- 004_closures.sql — when the hill shuts.
--
-- Floods, landslides, a VIP visit, or the department simply deciding not to
-- open. In every case the same three things must happen: no more tickets sold
-- for that day, everyone who already holds one is told, and each of them ends
-- up either on another date or with their money back.
--
-- POSTPONE IS THE DEFAULT, REFUND IS THE FALLBACK. Moving a ticket to another
-- date costs nothing and keeps the department's collection where it is; a
-- refund burns the payment gateway's fee and, if the entry fee has already been
-- settled, means paying out money we no longer hold. So the customer is offered
-- a new date first — but never forced onto one, because someone who cannot come
-- another day is entitled to their money.
--
-- The neat part needs no schema at all: a postponed ticket is re-signed with
-- its new date, and the OLD QR invalidates itself. Its signed date no longer
-- matches the day it is presented, so the gate reads it as 'wrong_day'. No
-- revocation list, no blacklist, nothing to distribute to the phones.

BEGIN;

CREATE TABLE IF NOT EXISTS closures (
  id           bigserial PRIMARY KEY,
  place_id     bigint      NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  travel_date  date        NOT NULL,
  -- NULL means the whole day. A single slot closes just that half.
  slot_id      bigint      REFERENCES place_slots(id) ON DELETE CASCADE,

  -- Shown to the customer verbatim, so it is written for them and not for us:
  -- "heavy rain and landslide risk", not "ops decision 14/9".
  reason       text        NOT NULL,
  -- 'weather' | 'landslide' | 'vip' | 'maintenance' | 'other' — for reporting,
  -- because the department will eventually ask how many days were lost to rain.
  kind         text        NOT NULL DEFAULT 'other',

  tickets_affected  integer NOT NULL DEFAULT 0,
  tickets_postponed integer NOT NULL DEFAULT 0,
  tickets_refunded  integer NOT NULL DEFAULT 0,
  amount_paise      integer NOT NULL DEFAULT 0,

  created_by   bigint      REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- A closure can be lifted, which reopens booking. It does not un-refund or
  -- un-postpone anything already done.
  lifted_at    timestamptz,
  lifted_by    bigint      REFERENCES admin_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_closures_date ON closures (travel_date, place_id);

-- One live closure per place/date/slot. A second attempt updates the first
-- rather than sending every customer a duplicate message.
CREATE UNIQUE INDEX IF NOT EXISTS idx_closures_live_slot
    ON closures (place_id, travel_date, slot_id)
 WHERE lifted_at IS NULL AND slot_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_closures_live_day
    ON closures (place_id, travel_date)
 WHERE lifted_at IS NULL AND slot_id IS NULL;

/* ─────────────────────────────────────────────── what happened to a ticket */

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS closure_id bigint REFERENCES closures(id) ON DELETE SET NULL;

-- What the customer still has to decide, if anything.
--   NULL         nothing is wrong with this ticket
--   'offered'    the day was closed; they have been asked to choose
--   'postponed'  they took a new date
--   'refunded'   they took their money back
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS closure_outcome text;

-- Where it came from, so a ticket's history survives being moved.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS moved_from_date date;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS moved_from_slot_id bigint REFERENCES place_slots(id) ON DELETE SET NULL;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS moved_at timestamptz;
-- Counted so a ticket cannot be walked around the calendar indefinitely.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS move_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_tickets_awaiting_choice
    ON tickets (closure_id) WHERE closure_outcome = 'offered';

/* ────────────────────────────────────────────────────────────── settings */

INSERT INTO app_settings (key, value, note) VALUES
  ('closure_allow_refund', 'true',
   'Whether a customer affected by a closure may ask for their money back instead of a new date. Turning this off is not recommended.'),
  ('refund_working_days', '5-7',
   'What the refund message promises. Razorpay returns card and netbanking refunds in 5-7 working days; UPI is usually faster.'),
  ('max_moves_per_ticket', '2',
   'How many times one ticket may be moved to another date before the customer must take a refund instead.'),
  ('closure_template_name', 'gate_closure_notice',
   'The approved WhatsApp template used to reach customers whose 24-hour window has closed. Must exist and be approved in Meta.')
ON CONFLICT (key) DO NOTHING;

COMMIT;
