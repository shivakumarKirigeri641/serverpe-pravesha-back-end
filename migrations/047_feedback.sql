-- What visitors thought, and which of it may be quoted.
--
-- WHY IT IS ASKED AT ALL. The only signal this service has about whether a visit
-- went well is the absence of a complaint, which is not a signal. A rating asked
-- once, immediately after the pass arrives, costs the visitor two taps and is the
-- only way anybody will know that the barrier queue was an hour long on Sunday.
--
-- WHY PUBLISHING IS A SEPARATE, DELIBERATE ACT. A rating is given to us; a
-- testimonial is shown to the world with somebody's name on it. Those are not
-- the same permission, and treating them as one — publishing whatever scores
-- five stars — would put a stranger's words and name on a marketing page they
-- never agreed to appear on. So nothing is public until a person in the panel
-- publishes it, with their own name against that decision, and the name shown
-- is chosen at that moment rather than taken from the booking.
--
-- ONE PER PASS. The link carries the pass it was asked about, and a second
-- opinion about the same visit is an edit, not a new row: the unique index says
-- so, and submitting again updates what is there.

CREATE TABLE IF NOT EXISTS feedback (
  id             bigserial PRIMARY KEY,
  ticket_id      bigint REFERENCES tickets(id) ON DELETE SET NULL,
  customer_id    bigint REFERENCES customers(id) ON DELETE SET NULL,
  place_id       bigint REFERENCES places(id) ON DELETE SET NULL,
  rating         integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment        text,
  -- Where it came from, so a rating asked for in one place is never confused
  -- with one volunteered somewhere else.
  source         text NOT NULL DEFAULT 'whatsapp',
  -- Published as a testimonial: a decision, its author, and the name to show.
  is_published   boolean NOT NULL DEFAULT false,
  published_at   timestamptz,
  published_by   bigint REFERENCES admin_users(id) ON DELETE SET NULL,
  display_name   text,
  -- Why it was published or taken down; the audit row carries the same words.
  decision_note  text,
  is_test        boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  modified_at    timestamptz NOT NULL DEFAULT now()
);

-- One opinion per pass; asking twice edits rather than duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_one_per_ticket ON feedback (ticket_id) WHERE ticket_id IS NOT NULL;

-- The two ways it is read: newest first in the panel, and published only on the
-- marketing site.
CREATE INDEX IF NOT EXISTS idx_feedback_recent ON feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_published ON feedback (published_at DESC) WHERE is_published;
