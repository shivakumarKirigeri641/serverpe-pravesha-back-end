-- 039_alerts_announcements.sql — operational alerts and visitor announcements.
--
-- ALERTS ARE NOT STORED. "This slot is full", "duplicate attempts are unusual",
-- "no staff on duty" are all questions the data already answers; storing them
-- would mean a second copy that can go stale and a job to keep it fresh. They
-- are computed when the screen asks. What IS stored is the human part: that
-- somebody has seen an alert and does not want to be told again for a while.
--
-- ANNOUNCEMENTS are the opposite: words a person wrote, for visitors. One of
-- them — a closure — also does something: it closes the days it covers, using
-- the closures table that already exists, so nothing can be sold for a day the
-- destination is shut.

CREATE TABLE IF NOT EXISTS alert_acks (
  alert_key       text PRIMARY KEY,
  acknowledged_by bigint REFERENCES admin_users(id),
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  quiet_until     timestamptz NOT NULL,
  note            text
);
CREATE INDEX IF NOT EXISTS idx_alert_acks_until ON alert_acks (quiet_until);

CREATE TABLE IF NOT EXISTS announcements (
  id          bigserial PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('closure', 'weather', 'notice')),
  place_id    bigint REFERENCES places(id) ON DELETE CASCADE,
  title       text NOT NULL,
  message     text NOT NULL,
  message_kn  text,
  starts_on   date NOT NULL,
  ends_on     date NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_by  bigint REFERENCES admin_users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  ended_by    bigint REFERENCES admin_users(id),
  ended_at    timestamptz,
  end_reason  text,
  CONSTRAINT announcement_range CHECK (starts_on <= ends_on)
);
CREATE INDEX IF NOT EXISTS idx_announcements_live ON announcements (starts_on, ends_on) WHERE is_active;

/* Which announcement closed a day, so lifting it reopens exactly those days. */
ALTER TABLE closures ADD COLUMN IF NOT EXISTS announcement_id bigint REFERENCES announcements(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_closures_live ON closures (place_id, travel_date) WHERE lifted_at IS NULL;

INSERT INTO app_settings (key, value, note) VALUES
  ('alert_slot_almost_full_percent', '90', 'A slot raises an alert at this much of its capacity'),
  ('alert_duplicate_attempts',       '5',  'Repeat attempts at the gate in three hours before it counts as unusual'),
  ('alert_payment_failures',         '5',  'Failed payments in two hours before it raises an alert'),
  ('alert_quiet_hours',              '6',  'How long an acknowledged alert stays quiet'),
  ('alert_high_traffic_factor',      '1.5','Entries this hour against the usual, before it counts as high traffic')
ON CONFLICT (key) DO NOTHING;
