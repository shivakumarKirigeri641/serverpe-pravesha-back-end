-- A visitor who never chose a language is written to in English.
--
-- WHO THIS IS. Somebody sold a pass at the gate who has never messaged the bot,
-- or a visitor whose record was created before the language question existed.
-- They have not said which language they read, so the choice is ours, and the
-- neutral one is English — the language the welcome and the terms are already
-- written in, before anybody is asked.
--
-- WHY THE COLUMN DEFAULT AND NOT THE CODE. Every message decides its language
-- through langOf(), which trusts customers.language. Some callers load only that
-- one column, so teaching langOf() to look at language_asked_at instead would
-- quietly send English to people who chose Kannada. Correcting the stored value
-- keeps a single source of truth that every caller already reads.
--
-- ONLY THE UNASKED ARE CHANGED. A visitor who chose Kannada has language_asked_at
-- set and keeps Kannada; nothing here touches a choice somebody actually made.

ALTER TABLE customers ALTER COLUMN language SET DEFAULT 'en';

UPDATE customers
   SET language = 'en', modified_at = now()
 WHERE language_asked_at IS NULL
   AND language IS DISTINCT FROM 'en';
