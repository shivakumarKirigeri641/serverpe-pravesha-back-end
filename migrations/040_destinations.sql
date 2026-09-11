-- 040_destinations.sql — a destination is more than a name.
--
-- Pravesha is built for Mullayanagiri first, but the shape of the product is
-- one platform with many destinations. What a destination needs before it can
-- sell a pass — prices, slots with capacity, and a checkpost to check passes at
-- — is already modelled. What was missing is everything a visitor is told about
-- it, and everything an administrator needs to judge whether it is ready.

ALTER TABLE places
  ADD COLUMN IF NOT EXISTS description    text,
  ADD COLUMN IF NOT EXISTS description_kn text,
  ADD COLUMN IF NOT EXISTS rules          jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS rules_kn       jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS images         jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS latitude       numeric(9,6),
  ADD COLUMN IF NOT EXISTS longitude      numeric(9,6),
  ADD COLUMN IF NOT EXISTS address        text,
  ADD COLUMN IF NOT EXISTS how_to_reach   text,
  ADD COLUMN IF NOT EXISTS contact_number text,
  ADD COLUMN IF NOT EXISTS modified_at    timestamptz NOT NULL DEFAULT now();

/* Checkposts gain what the checkpost screen shows and the gate app needs. */
ALTER TABLE checkposts
  ADD COLUMN IF NOT EXISTS note        text,
  ADD COLUMN IF NOT EXISTS latitude    numeric(9,6),
  ADD COLUMN IF NOT EXISTS longitude   numeric(9,6),
  ADD COLUMN IF NOT EXISTS modified_at timestamptz NOT NULL DEFAULT now();

UPDATE places SET
  description = COALESCE(description,
    'Karnataka''s highest peak at 1,930 metres, in the Baba Budangiri range above Chikkamagaluru. '
    || 'The road to the summit is narrow and steep, and entry is limited to keep the hill from being overrun.'),
  rules = CASE WHEN rules = '[]'::jsonb THEN jsonb_build_array(
    'One pass per vehicle per day; the pass is for the vehicle, not for each person in it.',
    'Reach the checkpost within your slot. Entry closes an hour before the slot ends.',
    'Carry the vehicle''s registration papers. The number on the pass must match the number plate.',
    'No plastic beyond the checkpost. Carry your waste back down with you.',
    'The road may close at short notice in heavy rain or fog.') ELSE rules END
WHERE code = 'MULLAYANAGIRI';
