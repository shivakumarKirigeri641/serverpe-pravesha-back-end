-- 008_invested_amounts.sql — what a thing costs, and what has actually been put in.
--
-- These are two different questions and the proposal asks both.
--
--   EXPENSE RANGE     what this item costs in the market, as a range. It is the
--                     figure that answers "what would it cost to run this?"
--   INVESTMENT RANGE  what has actually been spent on it so far. It answers
--                     "what have you already committed?" — which is the
--                     question a department is really asking when it wonders
--                     whether a one-person vendor is serious.
--
-- They differ in both directions. A laptop already owned is a large expense
-- that required no fresh investment for this project. Professional indemnity
-- cover is a real expense with nothing invested yet, because it has not been
-- bought. Collapsing the two into one column hides exactly the information
-- that makes the table worth showing.

BEGIN;

ALTER TABLE investment_items ADD COLUMN IF NOT EXISTS invested_min integer NOT NULL DEFAULT 0;
ALTER TABLE investment_items ADD COLUMN IF NOT EXISTS invested_max integer NOT NULL DEFAULT 0;

-- Default: what has been put in equals what it cost, for anything already in
-- place. The exceptions are corrected immediately below.
UPDATE investment_items
   SET invested_min = expense_min, invested_max = expense_max
 WHERE status IN ('done', 'in_place');

-- Already owned before this project began. A real cost, but not money raised
-- for this.
UPDATE investment_items SET invested_min = 0, invested_max = 0,
       note = 'Already owned before this project. Counted as an expense, not as fresh investment.'
 WHERE item = 'Development laptop';

-- Shared with the first product, so only a share of it belongs here.
UPDATE investment_items SET invested_min = 4800, invested_max = 12000,
       note = 'Shared with QuizPe. Only this project''s share is counted.'
 WHERE item = 'VPS / server hosting';

UPDATE investment_items SET invested_min = 9000, invested_max = 18000,
       note = 'Shared across both products.'
 WHERE item = 'Development tooling';

UPDATE investment_items SET invested_min = 9000, invested_max = 21000,
       note = 'Shared with the first product; half attributed here.'
 WHERE item = 'Home office';

-- Nothing spent yet on what has not been bought.
UPDATE investment_items SET invested_min = 0, invested_max = 0
 WHERE status IN ('planned', 'needed');

COMMIT;
