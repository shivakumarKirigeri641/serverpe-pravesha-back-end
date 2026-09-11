-- 023_kannada_names.sql — the names a Kannada reader actually sees.
--
-- A visitor who chose Kannada was getting Kannada labels around English
-- values: "ಭೇಟಿ: Mullayanagiri, Chikkamagaluru · Morning 6:00 AM". The labels
-- were translated and the facts were not, which reads worse than either
-- language alone. The check-in template has the same problem ten times over:
-- every parameter that is a word needs a Kannada form to fill it with.
--
-- THE NAMES LIVE BESIDE THE ENGLISH ONES, NOT IN A LOOKUP IN CODE. A place is
-- added or renamed by the department, and its Kannada name has to arrive in the
-- same row at the same time; a translation table in JavaScript is how a new
-- destination ends up with no Kannada name at all.
--
-- Plates and pass numbers are not translated. They are identifiers, written the
-- same way on the vehicle, the pass and the checkpost screen, and a Kannada-
-- numeral plate would match none of them.

ALTER TABLE places ADD COLUMN IF NOT EXISTS name_kn text;
ALTER TABLE places ADD COLUMN IF NOT EXISTS district_kn text;
ALTER TABLE place_slots ADD COLUMN IF NOT EXISTS label_kn text;
ALTER TABLE vehicle_categories ADD COLUMN IF NOT EXISTS label_kn text;
ALTER TABLE checkposts ADD COLUMN IF NOT EXISTS name_kn text;

UPDATE places SET name_kn = 'ಮುಳ್ಳಯ್ಯನಗಿರಿ',     district_kn = 'ಚಿಕ್ಕಮಗಳೂರು' WHERE code = 'MULLAYANAGIRI';
UPDATE places SET name_kn = 'ಕುದುರೆಮುಖ ಚಾರಣ',   district_kn = 'ಚಿಕ್ಕಮಗಳೂರು' WHERE code = 'KUDREMUKHA';
UPDATE places SET name_kn = 'ಕೊಡಚಾದ್ರಿ ಚಾರಣ',    district_kn = 'ಶಿವಮೊಗ್ಗ'    WHERE code = 'KODACHADRI';
UPDATE places SET name_kn = 'ಜೋಗ ಜಲಪಾತ',        district_kn = 'ಶಿವಮೊಗ್ಗ'    WHERE code = 'JOGFALLS';

UPDATE place_slots SET label_kn = 'ಬೆಳಿಗ್ಗೆ 6:00 - ಮಧ್ಯಾಹ್ನ 12:00' WHERE code = '0612';
UPDATE place_slots SET label_kn = 'ಮಧ್ಯಾಹ್ನ 12:00 - ಸಂಜೆ 6:00'    WHERE code = '1206';

/* The four fare categories, as the visitor names their own vehicle — not the
   RC's class. */
UPDATE vehicle_categories SET label_kn = 'ದ್ವಿಚಕ್ರ ವಾಹನ'          WHERE code = 'BIKE';
UPDATE vehicle_categories SET label_kn = 'ಕಾರು'                 WHERE code = 'CAR';
UPDATE vehicle_categories SET label_kn = 'ಟೂಫಾನ್'               WHERE code = 'TOOFAN';
UPDATE vehicle_categories SET label_kn = 'ಟೆಂಪೋ ಟ್ರಾವೆಲರ್ (TT)'   WHERE code = 'TT';

UPDATE checkposts SET name_kn = 'ಮುಳ್ಳಯ್ಯನಗಿರಿ ಮುಖ್ಯ ದ್ವಾರ' WHERE name = 'Mullayanagiri Main Gate';
