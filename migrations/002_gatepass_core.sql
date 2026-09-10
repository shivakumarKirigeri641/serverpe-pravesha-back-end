-- 002_gatepass_core.sql — entry tickets for Mullayanagiri.
--
-- THE PROBLEM THIS SCHEMA EXISTS TO SOLVE: today's ticket is a printable
-- document with nothing machine-verifiable on it. At the gate it is read, not
-- verified, so an altered ticket and a genuine one are indistinguishable. Every
-- decision below follows from closing that gap.
--
-- Three ideas carry the design:
--
--   * A ticket is SIGNED, not looked up. The QR carries plate, place, date,
--     slot and type inside an Ed25519 signature, so the gate rejects a tampered
--     ticket with no network at all. The server is needed only to answer "has
--     this one already come through?", which is state and must be central.
--
--   * ONE ACTIVE TICKET PER VEHICLE PER DATE, whoever books it. Not per mobile,
--     not per slot: a vehicle enters once a day. Enforced by a partial unique
--     index rather than by application code, because this is the rule the whole
--     product rests on and it must hold even when something else is wrong.
--
--   * CAPACITY IS CLAIMED, NOT COUNTED. A slot with 400 places and a 40-second
--     checkout will oversell if availability is read and then written. The
--     inventory row is updated with the check inside the statement, so two
--     people cannot both take the last place.
--
-- Built on 001: customers, vehicles, payments, api_calls, app_settings,
-- event_log.

BEGIN;

/* ═══════════════════════════════════════════════════ places and their slots */

CREATE TABLE IF NOT EXISTS places (
  id          bigserial PRIMARY KEY,
  code        text        NOT NULL UNIQUE,           -- 'MULLAYANAGIRI'
  name        text        NOT NULL,
  district    text,
  -- How far ahead booking opens. Per place, because a trek may differ.
  booking_days_ahead integer NOT NULL DEFAULT 14,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS place_slots (
  id          bigserial PRIMARY KEY,
  place_id    bigint      NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  -- '0612' reads the same in a reference id, a report and a conversation.
  code        text        NOT NULL,
  label       text        NOT NULL,                  -- '6:00 AM - 12:00 PM'
  starts_at   time        NOT NULL,
  ends_at     time        NOT NULL,
  sort_order  integer     NOT NULL DEFAULT 0,
  is_active   boolean     NOT NULL DEFAULT true,
  CONSTRAINT place_slots_unique UNIQUE (place_id, code)
);

/* ══════════════════════════════════════════════ vehicle categories and price */

CREATE TABLE IF NOT EXISTS vehicle_categories (
  id          bigserial PRIMARY KEY,
  code        text        NOT NULL UNIQUE,           -- BIKE | CAR | TOOFAN | TT
  label       text        NOT NULL,
  sort_order  integer     NOT NULL DEFAULT 0,
  is_active   boolean     NOT NULL DEFAULT true
);

-- What a vehicle class means in gate terms. Kept as data because the mapping
-- will be wrong for something on the first busy Sunday, and fixing it must not
-- need a deploy.
CREATE TABLE IF NOT EXISTS vehicle_class_map (
  id          bigserial PRIMARY KEY,
  category_id bigint      NOT NULL REFERENCES vehicle_categories(id) ON DELETE CASCADE,
  -- Case-insensitive regular expression, matched against the vehicle class,
  -- category and body type joined together.
  pattern     text        NOT NULL,
  -- Higher wins, so a specific rule can sit above a general one.
  priority    integer     NOT NULL DEFAULT 0,
  note        text
);

-- Price is per place, so a second gate can charge differently without a schema
-- change. entry_paise is the department's; platform_paise is ours and appears
-- as a separate line on every invoice.
CREATE TABLE IF NOT EXISTS place_pricing (
  id             bigserial PRIMARY KEY,
  place_id       bigint   NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  category_id    bigint   NOT NULL REFERENCES vehicle_categories(id) ON DELETE CASCADE,
  entry_paise    integer  NOT NULL,
  platform_paise integer  NOT NULL,
  effective_from date     NOT NULL DEFAULT CURRENT_DATE,
  is_active      boolean  NOT NULL DEFAULT true,
  CONSTRAINT place_pricing_unique UNIQUE (place_id, category_id, effective_from)
);

/* ═══════════════════════════════════════════════════════════════ inventory */

-- The template: how many of each type each slot holds on an ordinary day.
CREATE TABLE IF NOT EXISTS slot_capacity (
  id          bigserial PRIMARY KEY,
  place_id    bigint   NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  slot_id     bigint   NOT NULL REFERENCES place_slots(id) ON DELETE CASCADE,
  category_id bigint   NOT NULL REFERENCES vehicle_categories(id) ON DELETE CASCADE,
  capacity    integer  NOT NULL CHECK (capacity >= 0),
  CONSTRAINT slot_capacity_unique UNIQUE (place_id, slot_id, category_id)
);

-- The live count for one date, created on demand from the template — so a
-- holiday, a landslide or a VIP closure can be edited for a single day without
-- touching the template.
--
-- booked = paid tickets. held = checkouts in flight, released on failure or
-- expiry. Availability is capacity - booked - held, and it is never read and
-- then written: the claim happens inside one statement.
CREATE TABLE IF NOT EXISTS slot_inventory (
  id           bigserial PRIMARY KEY,
  place_id     bigint  NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  slot_id      bigint  NOT NULL REFERENCES place_slots(id) ON DELETE CASCADE,
  category_id  bigint  NOT NULL REFERENCES vehicle_categories(id) ON DELETE CASCADE,
  travel_date  date    NOT NULL,
  capacity     integer NOT NULL CHECK (capacity >= 0),
  booked       integer NOT NULL DEFAULT 0 CHECK (booked >= 0),
  held         integer NOT NULL DEFAULT 0 CHECK (held >= 0),
  is_open      boolean NOT NULL DEFAULT true,
  closed_note  text,
  modified_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT slot_inventory_unique UNIQUE (place_id, travel_date, slot_id, category_id),
  CONSTRAINT slot_inventory_not_oversold CHECK (booked + held <= capacity)
);

CREATE INDEX IF NOT EXISTS idx_inventory_date ON slot_inventory (travel_date, place_id);

/* ═════════════════════════════════════════════════════════════════ tickets */

CREATE TABLE IF NOT EXISTS tickets (
  id            bigserial PRIMARY KEY,

  -- Six characters from an alphabet with no 0/O or 1/I/L: readable aloud over a
  -- phone, and a billion combinations.
  ticket_no     text        NOT NULL UNIQUE,
  -- mobile-vehicle-date-slot. Ours, for support and reconciliation; never
  -- printed, and never a way through the gate.
  reference_id  text        NOT NULL UNIQUE,

  customer_id   bigint      NOT NULL REFERENCES customers(id),
  vehicle_id    bigint      NOT NULL REFERENCES vehicles(id),
  place_id      bigint      NOT NULL REFERENCES places(id),
  slot_id       bigint      NOT NULL REFERENCES place_slots(id),
  category_id   bigint      NOT NULL REFERENCES vehicle_categories(id),
  payment_id    bigint      REFERENCES payments(id) ON DELETE SET NULL,

  travel_date   date        NOT NULL,
  -- Denormalised because a ticket must render, scan and reconcile years later
  -- even if a vehicle row is edited or a price changes.
  reg_no        text        NOT NULL,
  mobile        text        NOT NULL,
  entry_paise    integer    NOT NULL,
  platform_paise integer    NOT NULL,
  gst_paise      integer    NOT NULL DEFAULT 0,
  total_paise    integer    NOT NULL,

  status        text        NOT NULL DEFAULT 'held'
                CHECK (status IN ('held', 'paid', 'used', 'expired', 'cancelled')),
  -- The signed string encoded into the QR. Stored so a ticket can be re-sent
  -- without re-signing, and so an old signature can be examined in a dispute.
  qr_payload    text,
  used_at       timestamptz,
  held_until    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  modified_at   timestamptz NOT NULL DEFAULT now()
);

-- THE RULE THE PRODUCT RESTS ON: one vehicle, one date, one ticket — whoever
-- books it and whichever slot. Expired holds and cancellations fall out of the
-- index, so a failed payment never blocks a genuine retry.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_one_per_vehicle_per_date
    ON tickets (vehicle_id, travel_date)
 WHERE status IN ('held', 'paid', 'used');

CREATE INDEX IF NOT EXISTS idx_tickets_date ON tickets (travel_date, place_id);
CREATE INDEX IF NOT EXISTS idx_tickets_customer ON tickets (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_held ON tickets (held_until) WHERE status = 'held';

/* ═══════════════════════════════════════════════════ checkposts and staff */

CREATE TABLE IF NOT EXISTS checkposts (
  id          bigserial PRIMARY KEY,
  place_id    bigint      NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staff (
  id              bigserial PRIMARY KEY,
  name            text        NOT NULL,
  mobile          text,
  -- Six digits, hashed. Issued and reset by the administrator, never chosen by
  -- the holder — a PIN people pick is 1234, and a shared PIN destroys the only
  -- thing this table exists to provide.
  pin_hash        text        NOT NULL,
  is_active       boolean     NOT NULL DEFAULT true,
  failed_attempts integer     NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  modified_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staff_checkposts (
  staff_id     bigint NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  checkpost_id bigint NOT NULL REFERENCES checkposts(id) ON DELETE CASCADE,
  PRIMARY KEY (staff_id, checkpost_id)
);

-- A device is registered to ONE checkpost, once, by the administrator. Two
-- locks: a leaked PIN is useless on an unregistered phone, and a stolen phone
-- is useless without a PIN.
CREATE TABLE IF NOT EXISTS devices (
  id            bigserial PRIMARY KEY,
  checkpost_id  bigint      NOT NULL REFERENCES checkposts(id) ON DELETE CASCADE,
  label         text        NOT NULL,               -- 'Gate phone', 'Backup'
  device_token  text        NOT NULL UNIQUE,
  is_primary    boolean     NOT NULL DEFAULT false,
  last_seen_at  timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Who was on duty, where, on what, and when they handed over. This table is
-- what turns a scanner into something a department can audit.
CREATE TABLE IF NOT EXISTS staff_sessions (
  id           bigserial PRIMARY KEY,
  staff_id     bigint      NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  checkpost_id bigint      NOT NULL REFERENCES checkposts(id) ON DELETE CASCADE,
  device_id    bigint      REFERENCES devices(id) ON DELETE SET NULL,
  token        text        NOT NULL UNIQUE,
  started_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ended_at     timestamptz,
  -- 'signed_out' | 'taken_over' | 'signed_in_elsewhere' | 'expired'
  ended_reason text
);

-- One live session per staff member: signing in anywhere ends it everywhere.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_one_per_staff
    ON staff_sessions (staff_id) WHERE ended_at IS NULL;

-- One scanning device per checkpost at a time; the backup stays idle until it
-- takes over.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_one_per_checkpost
    ON staff_sessions (checkpost_id) WHERE ended_at IS NULL;

/* ═══════════════════════════════════════════════════════════════════ scans */

-- EVERY scan, including the rejected ones. The negatives are the point: a
-- report showing which tickets were altered, duplicated or presented on the
-- wrong day is the evidence that the system is working.
CREATE TABLE IF NOT EXISTS scans (
  id           bigserial PRIMARY KEY,
  ticket_id    bigint      REFERENCES tickets(id) ON DELETE SET NULL,
  ticket_no    text,
  reg_no       text,
  checkpost_id bigint      REFERENCES checkposts(id) ON DELETE SET NULL,
  staff_id     bigint      REFERENCES staff(id) ON DELETE SET NULL,
  device_id    bigint      REFERENCES devices(id) ON DELETE SET NULL,
  session_id   bigint      REFERENCES staff_sessions(id) ON DELETE SET NULL,

  -- valid | already_used | wrong_day | wrong_place | wrong_slot |
  -- invalid_signature | unknown_ticket | cancelled
  verdict      text        NOT NULL,
  -- What the phone actually read, kept verbatim: in a dispute the argument is
  -- always about what was presented, not about what we decided.
  raw_payload  text,
  scanned_at   timestamptz NOT NULL DEFAULT now(),
  -- When the phone was offline, this is when it finally reached us. The gap
  -- between the two is worth seeing.
  synced_at    timestamptz,
  was_offline  boolean     NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_scans_when ON scans (scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_scans_ticket ON scans (ticket_id, scanned_at);
CREATE INDEX IF NOT EXISTS idx_scans_staff ON scans (staff_id, scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_scans_negative ON scans (scanned_at DESC)
 WHERE verdict <> 'valid';

/* ═══════════════════════════════════════════════════════════════════ admin */

-- Not a shared PIN: this holds a department's revenue and citizens' vehicle
-- data.
CREATE TABLE IF NOT EXISTS admin_users (
  id            bigserial PRIMARY KEY,
  name          text        NOT NULL,
  mobile        text        NOT NULL UNIQUE,
  password_hash text,
  role          text        NOT NULL DEFAULT 'admin'
                CHECK (role IN ('admin', 'department', 'viewer')),
  is_active     boolean     NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id           bigserial PRIMARY KEY,
  admin_id     bigint      NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token        text        NOT NULL UNIQUE,
  ip           text,
  user_agent   text,
  started_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ended_at     timestamptz
);

-- Who looked at what. An administrator can see more than a customer ever
-- should, and a privacy policy is only true if that access is recorded.
CREATE TABLE IF NOT EXISTS admin_audit (
  id         bigserial PRIMARY KEY,
  admin_id   bigint      REFERENCES admin_users(id) ON DELETE SET NULL,
  action     text        NOT NULL,
  subject    text,
  detail     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  ip         text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_when ON admin_audit (created_at DESC);

COMMIT;
