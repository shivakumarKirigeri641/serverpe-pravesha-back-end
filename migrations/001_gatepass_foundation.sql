-- 001_gatepass_foundation.sql — the pieces the ticket system stands on.
--
-- This database already holds the marketing site's tables. Everything added
-- here is prefixed by purpose rather than by product, because a second gate or
-- a second department should not need a second schema.
--
-- Four ideas worth stating once, since the rest of the system assumes them:
--
--   * A CUSTOMER IS A MOBILE NUMBER. There is no signup, no password, no
--     profile. WhatsApp already proved the number; asking for anything else
--     would be inventing an identity we do not need.
--
--   * A VEHICLE IS A NORMALISED REGISTRATION. People type "ka 31 n 8147",
--     "KA31-N-8147" and "ka31n8147" for one vehicle, so the stored form is
--     upper case and alphanumeric only, and everything joins on that.
--
--   * MONEY IS INTEGER PAISE, never a float. Rs.110 is 11000. A rupee that
--     rounds differently in two places is a reconciliation argument with a
--     government department.
--
--   * SETTINGS LIVE IN THE DATABASE. Prices, capacities, the commission
--     percentage and the booking window will all be argued about in a meeting;
--     none of them should need a deploy to change.

BEGIN;

/* ═══════════════════════════════════════════════════════════════ settings */

CREATE TABLE IF NOT EXISTS app_settings (
  key         text PRIMARY KEY,
  value       text NOT NULL,
  note        text,
  modified_at timestamptz NOT NULL DEFAULT now()
);

/* ══════════════════════════════════════════════════════ customers, vehicles */

CREATE TABLE IF NOT EXISTS customers (
  id              bigserial PRIMARY KEY,
  -- Ten digits, no country code, normalised on the way in so one person cannot
  -- arrive twice as '9886122415' and '+919886122415'.
  mobile          text        NOT NULL UNIQUE CHECK (mobile ~ '^[0-9]{10}$'),
  name            text,
  wa_profile_name text,
  wa_id           text,
  -- Our own numbers, kept out of visitor statistics.
  is_internal     boolean     NOT NULL DEFAULT false,
  is_blocked      boolean     NOT NULL DEFAULT false,
  blocked_reason  text,
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  modified_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vehicles (
  id             bigserial PRIMARY KEY,
  reg_no         text        NOT NULL UNIQUE CHECK (reg_no ~ '^[A-Z0-9]{5,11}$'),

  -- Denormalised from the RC lookup so a ticket, a report or a gate screen
  -- renders without opening a JSON snapshot.
  maker          text,
  model          text,
  fuel           text,
  vehicle_class  text,
  vehicle_category text,
  body_type      text,
  seats          integer,
  colour         text,
  reg_date       date,
  registered_at  text,

  -- Never stored: chassis, engine, owner name, address. This system sells
  -- entry to a hill, and none of that is needed to do it. What is not held
  -- cannot leak.
  rc_status      text,
  rc_fetched_at  timestamptz,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now()
);

-- The full lookup response, kept apart from the columns above so a mapping that
-- turns out wrong can be re-derived without paying for the call again.
CREATE TABLE IF NOT EXISTS vehicle_snapshots (
  id          bigserial PRIMARY KEY,
  vehicle_id  bigint      NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  data        jsonb       NOT NULL,
  source      text,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  CONSTRAINT vehicle_snapshots_unique UNIQUE (vehicle_id)
);

/* ════════════════════════════════════════════════════════ what upstream cost */

CREATE TABLE IF NOT EXISTS api_calls (
  id            bigserial PRIMARY KEY,
  customer_id   bigint      REFERENCES customers(id) ON DELETE SET NULL,
  vehicle_id    bigint      REFERENCES vehicles(id) ON DELETE SET NULL,
  reg_no        text,
  provider      text        NOT NULL DEFAULT 'ulip',
  dataset       text,
  cache_hit     boolean     NOT NULL DEFAULT false,
  ok            boolean     NOT NULL DEFAULT false,
  outcome       text,
  duration_ms   integer,
  -- Zero today. The column exists now so the history is complete on the day a
  -- provider starts charging; cost cannot be reconstructed backwards.
  cost_paise    integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_calls_when ON api_calls (created_at DESC);

/* ═══════════════════════════════════════════════════════════════ payments */

CREATE TABLE IF NOT EXISTS payments (
  id             bigserial PRIMARY KEY,
  customer_id    bigint      REFERENCES customers(id) ON DELETE SET NULL,
  amount_paise   integer     NOT NULL,
  -- The split, frozen at the moment of payment. A price change next month must
  -- never alter what a past settlement says.
  entry_paise    integer     NOT NULL DEFAULT 0,
  platform_paise integer     NOT NULL DEFAULT 0,
  gst_paise      integer     NOT NULL DEFAULT 0,

  status         text        NOT NULL DEFAULT 'created'
                 CHECK (status IN ('created', 'paid', 'failed', 'refunded')),
  gateway        text        NOT NULL DEFAULT 'razorpay',
  order_id       text,
  -- Unique so a replayed webhook cannot issue a second ticket for one payment.
  payment_id     text UNIQUE,
  refund_id      text,
  checkout_token text,
  raw            jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  paid_at        timestamptz,
  refunded_at    timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_checkout_token
    ON payments (checkout_token) WHERE checkout_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_pending
    ON payments (created_at) WHERE status = 'created';

/* ══════════════════════════════════════════════════════════ conversations */

CREATE TABLE IF NOT EXISTS wa_sessions (
  id              bigserial PRIMARY KEY,
  customer_id     bigint      REFERENCES customers(id) ON DELETE CASCADE,
  mobile          text        NOT NULL UNIQUE CHECK (mobile ~ '^[0-9]{10}$'),
  wa_id           text,
  profile_name    text,
  state           text        NOT NULL DEFAULT 'new',
  state_reason    text,
  context         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Meta allows a free-form reply only within 24 hours of the customer's last
  -- message. This is what decides whether we may speak at all.
  last_inbound_at  timestamptz,
  last_outbound_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  modified_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wa_messages (
  id            bigserial PRIMARY KEY,
  session_id    bigint      REFERENCES wa_sessions(id) ON DELETE CASCADE,
  mobile        text        NOT NULL,
  direction     text        NOT NULL CHECK (direction IN ('in', 'out')),
  message_type  text,
  body          text,
  payload       jsonb,
  template_name text,
  wa_message_id text,
  -- Set when a send failed, so a silent failure is visible rather than absent.
  error_message text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_messages_mobile ON wa_messages (mobile, created_at DESC);

/* ══════════════════════════════════════════════════════════════ event log */

-- One place to answer "what happened, and when". Consents, bookings, payments,
-- scans and admin actions all land here; the detail column keeps whatever that
-- kind of event needs without a column per event type.
CREATE TABLE IF NOT EXISTS event_log (
  id          bigserial PRIMARY KEY,
  customer_id bigint      REFERENCES customers(id) ON DELETE SET NULL,
  kind        text        NOT NULL,
  detail      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_log_kind ON event_log (kind, created_at DESC);

COMMIT;
