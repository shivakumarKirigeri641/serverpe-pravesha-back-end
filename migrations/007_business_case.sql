-- 007_business_case.sql — what it cost to build, and how it earns.
--
-- These sit in tables rather than in a slide because they will be asked about
-- more than once, will change, and must agree between the presentation, the
-- proposal and any later negotiation. A number typed into PowerPoint is a
-- number that will eventually contradict itself.
--
-- Ranges rather than single figures throughout: an honest "Rs.45,000 to
-- Rs.90,000" survives a question better than a precise number that turns out to
-- be an estimate.

BEGIN;

/* ═══════════════════════════════════════════════ what has been put in */

CREATE TABLE IF NOT EXISTS investment_items (
  id            bigserial PRIMARY KEY,
  sort_order    integer     NOT NULL DEFAULT 0,
  item          text        NOT NULL,
  description   text        NOT NULL,

  -- Ranges, in whole rupees. A single figure would be a guess wearing a
  -- disguise.
  expense_min   integer     NOT NULL DEFAULT 0,
  expense_max   integer     NOT NULL DEFAULT 0,

  -- 'one_time' | 'annual' | 'monthly'
  kind          text        NOT NULL DEFAULT 'one_time',

  -- 'done' | 'in_place' | 'planned' | 'needed'
  status        text        NOT NULL DEFAULT 'done',
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO investment_items
  (sort_order, item, description, expense_min, expense_max, kind, status, note) VALUES

  (10, 'Development laptop',
   'The machine everything is built and tested on.',
   60000, 90000, 'one_time', 'done',
   'Already owned. Replaced roughly every four years.'),

  (20, 'VPS / server hosting',
   'The server that runs the booking system, the database and the checkpost API.',
   9600, 24000, 'annual', 'in_place',
   'Scales with sites, not with tickets. One VPS carries several gates.'),

  (30, 'Development tooling',
   'VS Code, GitHub Copilot and Claude — the tools the software is written with.',
   18000, 36000, 'annual', 'in_place',
   'Per-seat subscriptions. This is what one person delivering at this pace costs.'),

  (40, 'Domain (.in)',
   'serverpe.in and the site subdomains.',
   800, 1500, 'annual', 'in_place', NULL),

  (50, 'Business email',
   'Hosted mail on the domain, for proposals, invoices and support.',
   1200, 3600, 'annual', 'in_place', NULL),

  (60, 'WhatsApp Business Platform',
   'Meta charges per conversation outside the free service window. Service replies '
   || 'to a customer who wrote first are free.',
   0, 12000, 'annual', 'in_place',
   'Near zero at current volumes: this flow answers customers rather than initiating.'),

  (70, 'Payment gateway',
   'Razorpay. Charged per transaction, not up front.',
   0, 0, 'one_time', 'in_place',
   'No fixed cost. Roughly 2% plus GST per payment, deducted from each collection.'),

  (80, 'GST and Udyam registration',
   'Registration and the filings that follow.',
   0, 3000, 'one_time', 'done', NULL),

  (90, 'Accounting and compliance',
   'GST returns, income tax filing and books.',
   6000, 18000, 'annual', 'in_place',
   'A proprietorship files far less than a private limited company.'),

  (100, 'SSL certificates',
   'HTTPS on every public endpoint.',
   0, 0, 'annual', 'in_place',
   'Let''s Encrypt. Free, automatically renewed.'),

  (110, 'Test handsets',
   'Phones for testing the customer flow and the checkpost scanner.',
   0, 15000, 'one_time', 'in_place',
   'Existing phones today. Gate handsets are the department''s to provide.'),

  (120, 'Backups and monitoring',
   'Off-server database backups and uptime alerting.',
   2400, 9600, 'annual', 'planned',
   'Needed before going live with a government department''s revenue.'),

  (130, 'Site visits and installation',
   'Travel to the checkpost, staff training, on-site support during the first weeks.',
   5000, 20000, 'one_time', 'planned',
   'Per site. Chikkamagaluru is a day trip from Bengaluru.'),

  (140, 'Professional indemnity cover',
   'Insurance against a claim arising from the software.',
   8000, 25000, 'annual', 'needed',
   'Not held today. Worth taking before a government contract is signed.'),

  (150, 'Home office',
   'Workspace, power and broadband.',
   18000, 42000, 'annual', 'in_place',
   'No commercial premises. This is a large part of why the charge to the department is small.')
ON CONFLICT DO NOTHING;

/* ═══════════════════════════════════════════ how the platform earns */

CREATE TABLE IF NOT EXISTS revenue_models (
  id             bigserial PRIMARY KEY,
  sort_order     integer NOT NULL DEFAULT 0,
  code           text    NOT NULL UNIQUE,
  title          text    NOT NULL,
  summary        text    NOT NULL,

  -- What the department is asked for, in words.
  department_pays text,
  visitor_pays    text,

  -- Indicative annual value to ServerPe at the seeded capacity, in rupees.
  value_min      integer NOT NULL DEFAULT 0,
  value_max      integer NOT NULL DEFAULT 0,

  effort         text,                    -- what it takes to run
  risk           text,                    -- what could go wrong with it
  is_primary     boolean NOT NULL DEFAULT false
);

INSERT INTO revenue_models
  (sort_order, code, title, summary, department_pays, visitor_pays,
   value_min, value_max, effort, risk, is_primary) VALUES

  (10, 'BOOKING_FEE', 'Booking fee on each ticket',
   'A flat percentage of the entry fee, paid by the visitor on top of it. GST and the '
   || 'payment gateway charge both come out of this, not out of the department''s money.',
   'Nothing', '10% of the entry fee', 0, 0,
   'None beyond running the platform.',
   'Margin is thin per ticket and moves with the gateway''s rate.', true),

  (20, 'AMC', 'Annual maintenance charge',
   'A fixed yearly charge per gate for support, updates, hosting and training. Predictable '
   || 'for both sides and independent of how busy a season is.',
   'Rs.1,20,000 per gate per year', 'Nothing extra', 120000, 120000,
   'Support commitment during gate hours.',
   'A department budget line has to be approved and renewed.', true),

  (30, 'MULTI_SITE', 'More sites on the same platform',
   'The largest opportunity by a distance. Places, slots, prices and capacities are already '
   || 'configuration, so a second waterfall or peak is set up in an afternoon and shares the '
   || 'same code, the same reports and the same signing infrastructure.',
   'AMC per gate', '10% of the entry fee', 240000, 1200000,
   'Almost none per additional site.',
   'Depends on the first site proving itself.', false),

  (40, 'ADD_ONS', 'Add-ons sold in the same conversation',
   'Parking, camera fees, guide charges or a trek permit can be sold in the same WhatsApp '
   || 'flow, with the department''s share passed through exactly as the entry fee is.',
   'Nothing', 'Only for what they choose', 60000, 300000,
   'One flow per add-on, then it runs itself.',
   'Needs departmental approval for each charge.', false),

  (50, 'REPORTING', 'Reporting and analytics module',
   'Season forecasting, crowd modelling and revenue projections beyond the standard reports '
   || 'that are included free.',
   'Optional annual charge', 'Nothing', 36000, 96000,
   'Built once, sold repeatedly.',
   'Departments may consider this part of the base service.', false),

  (60, 'WHITE_LABEL', 'The same system for other departments',
   'Forest check-posts, heritage sites, municipal parking — any place that sells a right to '
   || 'enter and checks it at a barrier has this exact problem.',
   'AMC per gate', 'Booking fee', 0, 0,
   'Some configuration per department.',
   'Longer sales cycle; a government reference is what unlocks it.', false)
ON CONFLICT (code) DO NOTHING;

/* ═════════════════════════════════════════════════ founder and dates */

INSERT INTO app_settings (key, value, note) VALUES
  ('business_since', '2025-08-01',
   'Date the proprietorship began operating.'),
  ('first_product_since', '2026-06',
   'When QuizPe went live.'),
  ('founder_title', 'Founder and Proprietor', NULL),
  ('founder_bio', '',
   'Two or three sentences on background and experience. TO BE FILLED.'),
  ('founder_years', '',
   'Years of professional experience. TO BE FILLED.'),
  ('amc_gate_min_paise', '9000000',
   'Lower end of the AMC range, per gate per year: Rs.90,000.'),
  ('amc_gate_max_paise', '15000000',
   'Upper end of the AMC range, per gate per year: Rs.1,50,000.'),
  ('gateway_fee_percent_full', '2.2',
   'Razorpay''s rate including its own GST, used for the per-ticket margin working.')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

COMMIT;
