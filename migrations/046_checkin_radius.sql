-- How close is "at the checkpost".
--
-- A phone's idea of where it is comes with a margin: a good fix on open ground
-- is a few metres, a bad one on a wooded hill road is fifty or more, and the
-- barrier itself may sit in the shadow of the hill. Three hundred metres is
-- close enough that somebody at home fails it by kilometres, and loose enough
-- that a visitor queueing at the barrier is not refused because of the trees.
--
-- Per checkpost, because gates differ: one on an open ridge can be tightened,
-- one in a valley may need more room.
ALTER TABLE checkposts ADD COLUMN IF NOT EXISTS checkin_radius_m integer NOT NULL DEFAULT 300
  CHECK (checkin_radius_m BETWEEN 50 AND 5000);

-- Where the visitor said they were, and how far that was from the barrier.
-- Kept with the entry rather than only in a log: an entry nobody witnessed is
-- worth being able to question later, and "how did this one get recorded" has
-- to have an answer.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS self_checkin_m integer;
