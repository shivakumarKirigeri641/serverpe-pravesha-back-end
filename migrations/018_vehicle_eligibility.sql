-- 018_vehicle_eligibility.sql — which vehicles may buy a pass, and which may not.
--
-- THE CASE THIS EXISTS FOR. Autos, tractors, trailers, trucks and buses are not
-- allowed up these hills. Until now nothing in the data said so. The class map
-- ended in a catch-all row -- '.*' -> CAR -- which meant an autorickshaw did not
-- get refused: it was quietly classified as a car and sold a hundred-rupee pass.
-- The refusal has to happen in the booking flow, before money changes hands,
-- because a vehicle turned away at the checkpost after paying is a refund and an
-- argument at a barrier with a queue behind it.
--
-- WHY THE RULES ARE ROWS AND NOT CODE. The registration strings come from VAHAN
-- and we do not control them. A class we have never seen will turn up, and the
-- fix has to be an INSERT that takes effect immediately -- not a deploy, at a
-- checkpost, on a Sunday.
--
-- WHICH FIELD IS TRUSTED, AND WHY IT IS NOT THE OBVIOUS ONE. Four live lookups
-- decided this:
--
--   seats      -- a Hero Splendor reports 2. A 15-metre Volvo coach also reports
--                2. The field is not passenger capacity and must never gate
--                anything. An earlier design here used a seat threshold to tell
--                a Tempo Traveller from a bus; it would have sold that coach a
--                two-hundred-rupee Tempo Traveller pass.
--   body_type  -- a Hero Pleasure scooter reports 'PICK UP'. Free text, and
--                unmaintained.
--   gross_weight -- 0 on both two-wheelers sampled. Useful to confirm a heavy
--                vehicle, useless to confirm a light one.
--   vehicle_category -- 'TWO WHEELER(NT)', 'LIGHT MOTOR VEHICLE', 'THREE
--                WHEELER(T)', 'LIGHT GOODS VEHICLE', 'MEDIUM GOODS VEHICLE',
--                'HEAVY PASSENGER VEHICLE'. Structural, consistent, and the
--                (T)/(NT) suffix separates transport from non-transport.
--
-- So eligibility reads vehicle_category first and vehicle_class second, and
-- ignores the other three.

CREATE TABLE IF NOT EXISTS vehicle_deny_rules (
  id           bigserial PRIMARY KEY,
  code         text NOT NULL,
  /* Matched against vehicle_category first, then vehicle_class. Case-insensitive. */
  pattern      text NOT NULL,
  /* Higher wins, so a narrow rule can be added above a broad one without
     rewriting the broad one. */
  priority     int  NOT NULL DEFAULT 100,
  /* Shown to the customer. Kannada matters here: this is the one message in the
     flow that ends the conversation, and it should not end it in English only. */
  reason_en    text NOT NULL,
  reason_kn    text,
  is_active    boolean NOT NULL DEFAULT true,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vehicle_deny_rules_active
  ON vehicle_deny_rules (is_active, priority DESC);

/* Confirmed against live VAHAN responses. The commented plate on each row is the
   lookup the pattern was written from -- so the next person can re-check it
   rather than trust this comment. */
INSERT INTO vehicle_deny_rules (code, pattern, priority, reason_en, reason_kn, note) VALUES
  ('AUTO',    'THREE.?WHEELER|AUTO.?RICKSHAW|E.?RICKSHAW',            900,
   'Autorickshaws are not permitted on this route.',
   'ಈ ಮಾರ್ಗದಲ್ಲಿ ಆಟೋ ರಿಕ್ಷಾಗಳಿಗೆ ಅನುಮತಿ ಇಲ್ಲ.',
   'KA04AF1581 Bajaj RE -> THREE WHEELER(T) / Three Wheeler (Passenger)'),

  ('GOODS',   'GOODS.?VEHICLE|GOODS.?CARRIER|TRUCK|LORRY|TIPPER|TANKER', 890,
   'Goods vehicles are not permitted on this route.',
   'ಈ ಮಾರ್ಗದಲ್ಲಿ ಸರಕು ವಾಹನಗಳಿಗೆ ಅನುಮತಿ ಇಲ್ಲ.',
   'KA01AH4470 Tata Ace -> LIGHT GOODS VEHICLE; KA53A7932 Eicher -> MEDIUM GOODS VEHICLE'),

  ('BUS',     'HEAVY.?PASSENGER|^BUS$|OMNI.?BUS|MINI.?BUS|EDUCATIONAL.?INSTITUTION', 880,
   'Buses and minibuses are not permitted on this route.',
   'ಈ ಮಾರ್ಗದಲ್ಲಿ ಬಸ್ ಮತ್ತು ಮಿನಿ ಬಸ್‌ಗಳಿಗೆ ಅನುಮತಿ ಇಲ್ಲ.',
   'MH12VT7537 Volvo 9600S -> HEAVY PASSENGER VEHICLE / Bus'),

  ('TRACTOR', 'TRACTOR|TRAILER|HARVESTER|CONSTRUCTION.?EQUIP',        870,
   'Tractors and trailers are not permitted on this route.',
   'ಈ ಮಾರ್ಗದಲ್ಲಿ ಟ್ರ್ಯಾಕ್ಟರ್ ಮತ್ತು ಟ್ರೇಲರ್‌ಗಳಿಗೆ ಅನುಮತಿ ಇಲ್ಲ.',
   'Not yet sampled from a live lookup -- patterns are from the VAHAN class list.')
ON CONFLICT DO NOTHING;

/* THE CATCH-ALL IS REMOVED, NOT REPLACED.
   '.*' -> CAR was the row that made an unrecognised vehicle a car at car prices.
   Migration 017 already built the honest answer for a vehicle we cannot identify:
   show the categories and let the visitor pick, recorded as a declared category
   so the gate knows to look. An unmatched class now takes that path instead of
   being guessed at. */
DELETE FROM vehicle_class_map WHERE pattern = '.*';

/* Buses were mapped into the Tempo Traveller category, which both contradicted
   the rule above and priced a coach at 200 rupees. Tempo Travellers are matched
   on their own class words; if a real TT turns out to register as OMNI BUS, the
   deny rule above catches it first and this needs revisiting with a live sample
   in hand. */
UPDATE vehicle_class_map
   SET pattern = 'TEMPO.?TRAVELLER|TEMPO',
       note    = 'Tempo Traveller only -- bus classes moved to vehicle_deny_rules'
 WHERE pattern LIKE '%TEMPO%';

/* One vehicle now yields three upstream datasets and each is cached separately,
   so a snapshot has to say which one it is. Existing rows are all RC. */
ALTER TABLE vehicle_snapshots ADD COLUMN IF NOT EXISTS dataset text;
UPDATE vehicle_snapshots SET dataset = 'rc' WHERE dataset IS NULL;
ALTER TABLE vehicle_snapshots ALTER COLUMN dataset SET DEFAULT 'rc';
ALTER TABLE vehicle_snapshots ALTER COLUMN dataset SET NOT NULL;

CREATE INDEX IF NOT EXISTS vehicle_snapshots_latest
  ON vehicle_snapshots (vehicle_id, dataset, fetched_at DESC);

/* Eligibility is decided from the RC, so the verdict is worth keeping next to
   the vehicle: the checkpost view needs it without re-deriving, and a refusal
   that was correct at booking time should still read as correct at the gate. */
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS is_allowed boolean;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS deny_code text;
