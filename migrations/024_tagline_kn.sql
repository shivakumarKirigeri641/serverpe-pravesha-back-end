-- 024_tagline_kn.sql — the product tagline for a Kannada pass header.
--
-- "Pravesha — Entry made simple." heads every English pass. A Kannada pass needs
-- its own line rather than the English one under a Kannada name. A setting, not
-- a constant, because a tagline is exactly the wording a department will want
-- to change after seeing it printed.
INSERT INTO app_settings (key, value) VALUES ('product_tagline_kn', 'ಪ್ರವೇಶ ಈಗ ಸರಳ.')
ON CONFLICT (key) DO NOTHING;
