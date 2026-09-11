/**
 * i18n.js — every visitor-facing string, in both languages.
 *
 * The visitor is asked once which language they want, and after that they get
 * one language rather than two stacked in every bubble. This is where the pair
 * lives so the two versions cannot drift apart in different files.
 *
 * WHY THE FLOW STRINGS ARE HERE TOO
 *
 * A WhatsApp Flow's JSON is uploaded to Meta once and rendered on the phone;
 * text written into it is the same for everybody. So none of the labels can be
 * literals if the form is to be in the visitor's language — every one has to be
 * data-bound and supplied per request by the endpoint. That is why the Flow
 * section below is so long: those are the words that would otherwise be frozen
 * into the JSON.
 *
 * A missing key returns the key itself rather than an empty string. A visible
 * "slot_full" on a screen is a bug that gets fixed; a blank line is one that
 * ships.
 *
 * THE KANNADA STILL NEEDS A NATIVE SPEAKER. It is written to be plain and
 * respectful rather than literal, but it has not been reviewed by anyone whose
 * first language it is, and this is going in front of a government department.
 */

const S = {
  /* ── the conversation ─────────────────────────────────────────────── */

  greeting:            { kn: 'ನಮಸ್ಕಾರ',                    en: 'Hello' },
  what_would_you_like: { kn: 'ಏನು ಮಾಡಬೇಕು?',                en: 'What would you like to do?' },
  menu_button:         { kn: 'ಮೆನು',                        en: 'Menu' },

  menu_book:           { kn: 'ಟಿಕೆಟ್ ಬುಕ್ ಮಾಡಿ',            en: 'Book a ticket' },
  menu_book_desc:      { kn: 'ವಾಹನ ಪ್ರವೇಶ ಟಿಕೆಟ್',           en: 'Vehicle entry ticket' },
  menu_download:       { kn: 'ಟಿಕೆಟ್ ಪಡೆಯಿರಿ',              en: 'Download ticket' },
  menu_download_desc:  { kn: 'ಟಿಕೆಟ್ ಮತ್ತೆ ಪಡೆಯಿರಿ',           en: 'Get your ticket again' },
  menu_postpone:       { kn: 'ದಿನಾಂಕ ಬದಲಿಸಿ',               en: 'Change the date' },
  menu_postpone_desc:  { kn: 'ಬೇರೆ ದಿನಕ್ಕೆ ಬದಲಿಸಿ',          en: 'Move to another day' },
  menu_support:        { kn: 'ಸಹಾಯ',                        en: 'Support' },
  menu_support_desc:   { kn: 'ಬುಕಿಂಗ್ ಬಗ್ಗೆ ಮಾತನಾಡಿ',        en: 'Talk to us' },
  menu_feedback:       { kn: 'ಅಭಿಪ್ರಾಯ',                    en: 'Feedback' },
  menu_feedback_desc:  { kn: 'ಹೇಗಿತ್ತು ಎಂದು ತಿಳಿಸಿ',         en: 'Tell us how it went' },

  consent_agree:       { kn: 'ಒಪ್ಪಿ',                       en: 'Agree' },
  consent_policy:      { kn: 'ನಿಯಮಗಳು',                     en: 'Policy' },
  consent_thanks:      { kn: 'ಧನ್ಯವಾದ. ಈಗ ಏನು ಮಾಡಬೇಕು?',    en: 'Thank you. What would you like to do?' },

  /* Deliberately names no site. This platform serves the department's places,
     and which one is being visited is chosen inside the booking form — a
     welcome that hardcodes one hill is a welcome that has to be rewritten for
     the second site. */
  consent_book_here:   { kn: 'ಕರ್ನಾಟಕದ ಪ್ರವಾಸಿ ತಾಣಗಳಿಗೆ ವಾಹನ ಪ್ರವೇಶ ಟಿಕೆಟ್ ಇಲ್ಲಿಯೇ ಬುಕ್ ಮಾಡಿ — ಗೇಟ್‌ನಲ್ಲಿ ಸರತಿ ಇಲ್ಲ.',
                         en: 'Book vehicle entry tickets for Karnataka tourist places here — no queue at the gate.' },
  /* What replaced the QR promise. It says the thing visitors most want to
     hear — you do not have to produce anything at the gate — and it is also
     the honest description of how entry now works. */
  consent_qr:          { kn: 'ಗೇಟ್‌ನಲ್ಲಿ ತೋರಿಸಲು ಏನೂ ಬೇಡ. ಸಿಬ್ಬಂದಿ ನಿಮ್ಮ ವಾಹನ ಸಂಖ್ಯೆಯನ್ನು ನಮೂದಿಸಿ ಒಳಗೆ ಬಿಡುತ್ತಾರೆ.',
                         en: 'Nothing to show at the gate. The staff enter your vehicle number and you drive in.' },
  consent_ask:         { kn: 'ಸರಿಯಾದ ಶುಲ್ಕ ವಿಧಿಸಲು ನಿಮ್ಮ ವಾಹನ ಸಂಖ್ಯೆಯನ್ನು ಸರ್ಕಾರಿ ದಾಖಲೆಯೊಂದಿಗೆ ಪರಿಶೀಲಿಸುತ್ತೇವೆ. ವಾಹನ ಸಂಖ್ಯೆ, ಪ್ರಕಾರ ಮತ್ತು ನಿಮ್ಮ ಮೊಬೈಲ್ ಸಂಖ್ಯೆ ಮಾತ್ರ ಸಂಗ್ರಹಿಸುತ್ತೇವೆ.',
                         en: 'We check your vehicle number against government records to confirm the vehicle type. We store the vehicle number, type and your mobile number only.' },

  policy_heading:      { kn: 'ಗೌಪ್ಯತೆ — ಸಂಕ್ಷಿಪ್ತವಾಗಿ',      en: 'Privacy in short' },
  policy_full:         { kn: 'ಪೂರ್ಣ ನಿಯಮಗಳು',               en: 'Full terms' },
  policy_continue:     { kn: 'ಮುಂದುವರಿಯೋಣವೇ?',              en: 'Shall we continue?' },

  terms_link_label:    { kn: 'ನಿಯಮಗಳು ಮತ್ತು ಗೌಪ್ಯತಾ ನೀತಿ',   en: 'Terms & privacy policy' },
  agree_continue:      { kn: 'ಒಪ್ಪಿ ಮುಂದುವರಿಯಿರಿ',           en: 'Agree & continue' },
  read_before_agree:   { kn: 'ಮುಂದುವರಿಯುವ ಮೂಲಕ ನೀವು ಈ ನಿಯಮಗಳಿಗೆ ಒಪ್ಪುತ್ತೀರಿ.',
                         en: 'By continuing you agree to these terms.' },

  /* ── the booking steps in chat ────────────────────────────────────── */

  ask_plate:           { kn: 'ನಿಮ್ಮ *ವಾಹನ ಸಂಖ್ಯೆ* ಟೈಪ್ ಮಾಡಿ.',
                         en: 'Please type your *vehicle number*.' },
  ask_plate_example:   { kn: 'ಉದಾಹರಣೆ: KA 01 AB 1234',       en: 'Example: KA 01 AB 1234' },
  ask_plate_format:    { kn: 'ಸ್ಪೇಸ್ ಇರಲಿ, ಇಲ್ಲದಿರಲಿ — ಪರವಾಗಿಲ್ಲ.',
                         en: 'With or without spaces — either is fine.' },

  plate_err_empty:     { kn: 'ಅಲ್ಲಿ ವಾಹನ ಸಂಖ್ಯೆ ಓದಲಾಗಲಿಲ್ಲ.',
                         en: 'I could not read a vehicle number there.' },
  plate_err_length:    { kn: 'ಇದು ವಾಹನ ಸಂಖ್ಯೆಗೆ ತುಂಬಾ ಚಿಕ್ಕದು ಅಥವಾ ಉದ್ದವಾಗಿದೆ.',
                         en: 'That looks too short or too long for a vehicle number.' },
  plate_err_format:    { kn: 'ಇದು ವಾಹನ ಸಂಖ್ಯೆಯಂತೆ ಕಾಣುತ್ತಿಲ್ಲ.',
                         en: 'That does not look like a vehicle number.' },
  plate_err_state:     { kn: '"{code}" ಎಂಬುದು ರಾಜ್ಯದ ಸಂಕೇತವಾಗಿ ಗುರುತಿಸಲಾಗಲಿಲ್ಲ.',
                         en: 'I do not recognise "{code}" as a state code.' },
  plate_err_retry:     { kn: 'ಈ ರೀತಿ ಟೈಪ್ ಮಾಡಿ: *KA 01 AB 1234*',
                         en: 'Please type it like this: *KA 01 AB 1234*' },

  vehicle_number:      { kn: 'ವಾಹನ ಸಂಖ್ಯೆ',                  en: 'Vehicle number' },
  is_this_correct:     { kn: 'ಇದು ಸರಿಯೇ?',                   en: 'Is this correct?' },
  yes_correct:         { kn: 'ಹೌದು, ಸರಿ',                    en: 'Yes, correct' },
  change_number:       { kn: 'ಬದಲಾಯಿಸಿ',                     en: 'Change it' },

  which_place:         { kn: 'ಯಾವ ತಾಣಕ್ಕೆ ಭೇಟಿ ನೀಡುತ್ತೀರಿ?', en: 'Which place are you visiting?' },
  choose_place:        { kn: 'ತಾಣ ಆಯ್ಕೆಮಾಡಿ', en: 'Choose a place' },
  no_places:           { kn: 'ಸದ್ಯಕ್ಕೆ ಯಾವ ತಾಣವೂ ಬುಕಿಂಗ್‌ಗೆ ಲಭ್ಯವಿಲ್ಲ.', en: 'No places are open for booking just now.' },

  review_and_pay:      { kn: 'ಪರಿಶೀಲಿಸಿ ಪಾವತಿಸಿ', en: 'Review & Pay' },

  v_make:              { kn: 'ತಯಾರಕ', en: 'Make' },
  v_model:             { kn: 'ಮಾದರಿ', en: 'Model' },
  v_variant:           { kn: 'ವೆರಿಯೆಂಟ್', en: 'Variant' },
  v_type:              { kn: 'ವಾಹನದ ಪ್ರಕಾರ', en: 'Vehicle type' },
  v_fuel:              { kn: 'ಇಂಧನ', en: 'Fuel' },

  slot_ended:          { kn: 'ಈ ಸಮಯ ಇಂದಿಗೆ ಮುಗಿದಿದೆ', en: 'Already over for today' },
  slot_not_sellable:   { kn: 'ಈ ಸಮಯ ಇಂದಿಗೆ ಮುಗಿದಿದೆ. ಬೇರೆ ದಿನ ಅಥವಾ ಸಮಯ ಆಯ್ಕೆಮಾಡಿ.',
                         en: 'That slot is already over for today. Please choose another time or day.' },

  submit:              { kn: 'ಕಳುಹಿಸಿ', en: 'Submit' },
  back_to_whatsapp:    { kn: 'ವಾಟ್ಸ್ಆ್ಯಪ್‌ಗೆ ಹಿಂತಿರುಗಿ', en: 'Back to WhatsApp' },
  support_sub:         { kn: 'ನಿಮ್ಮ ಪ್ರಶ್ನೆ ತಿಳಿಸಿ', en: 'Tell us what went wrong' },
  support_type:        { kn: 'ಯಾವ ಬಗ್ಗೆ?', en: 'What is it about?' },
  support_details:     { kn: 'ವಿವರ', en: 'Details' },
  support_placeholder: { kn: 'ಏನಾಯಿತು ಎಂದು ಬರೆಯಿರಿ…', en: 'Describe what happened…' },
  support_logged:      { kn: 'ನಿಮ್ಮ ಪ್ರಶ್ನೆ ದಾಖಲಾಗಿದೆ. ಶೀಘ್ರದಲ್ಲೇ ಉತ್ತರಿಸುತ್ತೇವೆ.', en: 'Your question has been logged. We will reply shortly.' },
  support_thanks:      { kn: 'ಧನ್ಯವಾದಗಳು. ಇಂದೇ ಉತ್ತರಿಸುತ್ತೇವೆ.', en: 'Thank you. We will reply the same day.' },
  feedback_sub:        { kn: 'ಬುಕಿಂಗ್ ಹೇಗಿತ್ತು?', en: 'How was the booking?' },
  feedback_rating:     { kn: 'ಎಷ್ಟು ಸುಲಭವಾಗಿತ್ತು?', en: 'How easy was it?' },
  feedback_comments:   { kn: 'ಅಭಿಪ್ರಾಯ (ಐಚ್ಛಿಕ)', en: 'Comments (optional)' },
  feedback_placeholder:{ kn: 'ಏನು ಸುಧಾರಿಸಬೇಕು?', en: 'Anything we should improve?' },

  checking_vehicle:    { kn: 'ವಾಹನ ವಿವರ ಪರಿಶೀಲಿಸುತ್ತಿದ್ದೇವೆ…',
                         en: 'Checking the vehicle details…' },
  which_day:           { kn: 'ಯಾವ ದಿನ ಪ್ರಯಾಣ?',              en: 'Which day are you travelling?' },
  choose_date:         { kn: 'ದಿನಾಂಕ ಆಯ್ಕೆಮಾಡಿ',              en: 'Choose a date' },
  travel_date:         { kn: 'ಪ್ರಯಾಣದ ದಿನಾಂಕ',               en: 'Travel date' },
  closed_short:        { kn: 'ಮುಚ್ಚಲಾಗಿದೆ',                  en: 'closed' },
  release_note:        { kn: 'ಪ್ರತಿದಿನ {hour}:00 ಗಂಟೆಗೆ ಹೊಸ ದಿನಾಂಕ ತೆರೆಯುತ್ತದೆ.',
                         en: 'A new date opens every day at {hour}:00.' },

  morning:             { kn: 'ಬೆಳಗ್ಗೆ',                      en: 'Morning' },
  afternoon:           { kn: 'ಮಧ್ಯಾಹ್ನ',                     en: 'Afternoon' },
  slot_full:           { kn: 'ಭರ್ತಿ',                        en: 'FULL' },
  left:                { kn: 'ಬಾಕಿ',                         en: 'left' },
  choose_time:         { kn: 'ಪ್ರವೇಶದ ಸಮಯ ಆಯ್ಕೆಮಾಡಿ:',        en: 'Choose your entry time:' },
  sold_out:            { kn: 'ಈ ದಿನಕ್ಕೆ ಸ್ಥಳ ಉಳಿದಿಲ್ಲ.',      en: 'No places left for this day.' },
  type_hi_for_menu:    { kn: 'ಮೆನುಗೆ "hi" ಎಂದು ಕಳುಹಿಸಿ.',     en: 'Send "hi" for the menu.' },

  booking_summary:     { kn: 'ಬುಕಿಂಗ್ ವಿವರ',                 en: 'Booking summary' },
  place:               { kn: 'ತಾಣ',                          en: 'Place' },
  entry_time:          { kn: 'ಪ್ರವೇಶದ ಸಮಯ',                  en: 'Entry time' },
  entry_fee:           { kn: 'ಪ್ರವೇಶ ಶುಲ್ಕ',                 en: 'Entry fee' },
  service_fee:         { kn: 'ಸೇವಾ ಶುಲ್ಕ',                   en: 'Service fee' },
  total_pay:           { kn: 'ಒಟ್ಟು ಪಾವತಿ',                  en: 'Total to pay' },
  pay_button:          { kn: 'ಪಾವತಿಸಿ',                      en: 'Pay now' },

  held_for_minutes:    { kn: 'ನಿಮ್ಮ ಸ್ಥಳವನ್ನು {n} ನಿಮಿಷಗಳ ಕಾಲ ಕಾಯ್ದಿರಿಸಲಾಗಿದೆ.',
                         en: 'Your place is held for {n} minutes.' },

  vehicle_found:       { kn: 'ಸಿಕ್ಕಿತು 👍',                  en: 'Found it 👍' },
  entry_type:          { kn: 'ಪ್ರವೇಶ ಪ್ರಕಾರ',                en: 'Entry type' },

  /* ── ticket delivery ──────────────────────────────────────────────── */

  ticket_word:         { kn: 'ಟಿಕೆಟ್',                       en: 'Ticket' },
  gate_instruction:     { kn: 'ಗೇಟ್‌ನಲ್ಲಿ ತೋರಿಸಲು ಏನೂ ಬೇಡ — ಸಿಬ್ಬಂದಿ ನಿಮ್ಮ ವಾಹನ ಸಂಖ್ಯೆಯನ್ನು ನಮೂದಿಸುತ್ತಾರೆ. ಇದೇ ವಾಹನವನ್ನು ತನ್ನಿ.',
                         en: 'Nothing to show at the gate — the staff will enter your vehicle number. Please bring this vehicle.' },
  /* The ticket PDF stopped being the receipt when the invoice became its own
     document — a caption promising both would have the visitor looking for
     amounts that are no longer on that page. */
  ticket_and_receipt:  { kn: 'ನಿಮ್ಮ ಟಿಕೆಟ್ — ಮುದ್ರಿಸಬಹುದಾದ ಪ್ರತಿ.', en: 'Your ticket — printable copy.' },
  invoice_caption:     { kn: 'ನಿಮ್ಮ ಜಿಎಸ್‌ಟಿ ಬಿಲ್ (ತೆರಿಗೆ ಸರಕುಪಟ್ಟಿ).', en: 'Your GST tax invoice.' },
  safe_journey:        { kn: 'ಶುಭ ಪ್ರಯಾಣ! 🙏',               en: 'Have a good trip! 🙏' },

  /* ── feedback ─────────────────────────────────────────────────────── */

  feedback_ask:        { kn: 'ಬುಕಿಂಗ್ ಸುಲಭವಾಗಿತ್ತೇ? ನಿಮ್ಮ ಅಭಿಪ್ರಾಯ ತಿಳಿಸಿ — ಒಂದೆರಡು ಸಾಲು ಸಾಕು.',
                         en: 'Was the booking hassle-free? Tell us in a line or two — it helps us improve.' },
  feedback_thanks:     { kn: 'ಧನ್ಯವಾದಗಳು. ನಿಮ್ಮ ಅಭಿಪ್ರಾಯ ದಾಖಲಾಗಿದೆ. 🙏',
                         en: 'Thank you. Your feedback has been recorded. 🙏' },

  /* ── the booking Flow ─────────────────────────────────────────────── */

  flow_cta:            { kn: 'ಟಿಕೆಟ್ ಬುಕ್ ಮಾಡಿ',            en: 'Book a ticket' },
  flow_body:           { kn: 'ಕೆಳಗಿನ ಬಟನ್ ಒತ್ತಿ ವಿವರ ಭರ್ತಿ ಮಾಡಿ. ಒಂದೇ ಪರದೆಯಲ್ಲಿ ಎಲ್ಲವೂ.',
                         en: 'Tap below and fill in the details. It is all on one screen.' },

  /* DETAILS */
  f_title_details:     { kn: 'ಪ್ರವೇಶ ಟಿಕೆಟ್',               en: 'Entry ticket' },
  f_your_details:      { kn: 'ನಿಮ್ಮ ವಿವರ',                  en: 'Your details' },
  f_name:              { kn: 'ಹೆಸರು',                       en: 'Name' },
  f_number:            { kn: 'ವಾಟ್ಸ್ಆ್ಯಪ್ ಸಂಖ್ಯೆ',          en: 'WhatsApp number' },
  f_where_when:        { kn: 'ಎಲ್ಲಿಗೆ, ಯಾವಾಗ',              en: 'Where and when' },
  f_place:             { kn: 'ಪ್ರವಾಸಿ ತಾಣ',                 en: 'Visiting place' },
  f_date:              { kn: 'ಪ್ರಯಾಣದ ದಿನಾಂಕ',              en: 'Date of visit' },
  f_continue:          { kn: 'ಮುಂದೆ',                       en: 'Continue' },

  /* VEHICLE */
  f_title_vehicle:     { kn: 'ವಾಹನ',                        en: 'Vehicle' },
  f_vehicle_number:    { kn: 'ವಾಹನ ಸಂಖ್ಯೆ',                 en: 'Vehicle number' },
  f_vehicle_note:      { kn: 'ಟಿಕೆಟ್ ಈ ವಾಹನಕ್ಕೆ ಮಾತ್ರ ಮಾನ್ಯ. ಪಾವತಿಸುವ ಮೊದಲು ಸಂಖ್ಯೆ ಪರಿಶೀಲಿಸಿ.',
                         en: 'The ticket is valid only for this vehicle, so please check the number before paying.' },
  f_reg_label:         { kn: 'ನೋಂದಣಿ ಸಂಖ್ಯೆ',               en: 'Registration number' },
  f_reg_helper:        { kn: 'ಉದಾ: KA01AB1234',             en: 'e.g. KA01AB1234' },
  f_check:             { kn: 'ವಾಹನ ಪರಿಶೀಲಿಸಿ',              en: 'Check vehicle' },

  f_err_format:        { kn: 'ಇದು ವಾಹನ ಸಂಖ್ಯೆಯಂತೆ ಕಾಣುತ್ತಿಲ್ಲ. ದಯವಿಟ್ಟು ಪರಿಶೀಲಿಸಿ.',
                         en: 'That does not look like a registration number. Please check and try again.' },
  f_err_lookup:        { kn: 'ಈಗ ಪರಿಶೀಲಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. ಇನ್ನೊಮ್ಮೆ ಪ್ರಯತ್ನಿಸಿ.',
                         en: 'We could not check that number just now. Please try once more.' },
  f_err_notfound:      { kn: 'ಆ ಸಂಖ್ಯೆಗೆ ದಾಖಲೆ ಸಿಗಲಿಲ್ಲ. ಪರಿಶೀಲಿಸಿ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
                         en: 'No record found for that number. Please check it and try again.' },
  f_err_category:      { kn: 'ವಾಹನದ ಪ್ರಕಾರ ತಿಳಿಯಲಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಸಹಾಯ ಸಂಪರ್ಕಿಸಿ.',
                         en: 'We could not work out the vehicle type. Please contact support.' },
  f_err_clash:         { kn: '{reg} ವಾಹನಕ್ಕೆ {date} ದಿನಾಂಕಕ್ಕೆ ಈಗಾಗಲೇ ಟಿಕೆಟ್ ಇದೆ.',
                         en: '{reg} already has a ticket for {date}.' },

  /* An old registration is usually not in the RC database. Said plainly, so
     the visitor understands nothing is wrong with their vehicle or with what
     they typed — we simply have no record to read the type from. */
  f_type_title:        { kn: 'ವಾಹನದ ಪ್ರಕಾರ ಆಯ್ಕೆಮಾಡಿ',        en: 'Choose your vehicle type' },
  f_type_ask:          { kn: 'ಈ ಹಳೆಯ ನೋಂದಣಿ ಸಂಖ್ಯೆಗೆ ಸರ್ಕಾರಿ ದಾಖಲೆ ಸಿಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ನೀವು ಬರುತ್ತಿರುವ ವಾಹನದ ಪ್ರಕಾರವನ್ನು ಆಯ್ಕೆಮಾಡಿ.',
                         en: 'We have no government record for this registration number, which is normal for an older vehicle. Please choose the type of vehicle you are bringing.' },
  f_type_gate:         { kn: 'ಗೇಟ್‌ನಲ್ಲಿ ವಾಹನವನ್ನು ಪರಿಶೀಲಿಸಲಾಗುತ್ತದೆ.',
                         en: 'The vehicle is checked at the gate against the type chosen here.' },
  /* A new vehicle on a dealer's temporary number is not a suspicious vehicle,
     and the message must not read like one. */
  f_type_temp:         { kn: 'ತಾತ್ಕಾಲಿಕ ನೋಂದಣಿ ಸಂಖ್ಯೆಗಳು ಇನ್ನೂ ಸರ್ಕಾರಿ ದಾಖಲೆಯಲ್ಲಿ ಸೇರಿರುವುದಿಲ್ಲ. ದಯವಿಟ್ಟು ನಿಮ್ಮ ವಾಹನದ ಪ್ರಕಾರವನ್ನು ಆಯ್ಕೆಮಾಡಿ.',
                         en: 'A temporary registration is not in the government database yet. Please choose your vehicle type.' },

  /* SLOT */
  f_title_slot:        { kn: 'ಸಮಯ',                         en: 'Time slot' },
  f_choose_slot:       { kn: 'ಸಮಯ ಆಯ್ಕೆಮಾಡಿ',                en: 'Choose a slot' },
  f_slots_label:       { kn: 'ಲಭ್ಯವಿರುವ ಸಮಯ',               en: 'Available slots' },
  f_review:            { kn: 'ಪರಿಶೀಲಿಸಿ',                   en: 'Review booking' },
  f_slot_left:         { kn: '{cap} ರಲ್ಲಿ {left} ಬಾಕಿ',      en: '{left} of {cap} left' },
  f_slot_full:         { kn: 'ಭರ್ತಿ — ಸ್ಥಳ ಇಲ್ಲ',            en: 'Full — no places left' },
  f_slot_closed:       { kn: 'ಮುಚ್ಚಲಾಗಿದೆ',                 en: 'Closed' },

  /* REVIEW */
  f_title_review:      { kn: 'ಪರಿಶೀಲನೆ',                    en: 'Review' },
  f_your_booking:      { kn: 'ಬುಕಿಂಗ್ ವಿವರ',                en: 'Your booking' },
  f_vehicle:           { kn: 'ವಾಹನ',                        en: 'Vehicle' },
  f_agree:             { kn: 'ನಿಯಮಗಳಿಗೆ ಒಪ್ಪುತ್ತೇನೆ',        en: 'I agree to the terms' },
  f_terms_note:        { kn: 'ಬುಕ್ ಮಾಡಿದ ನಂತರ ರದ್ದುಪಡಿಸಲಾಗದು. ದಿನಾಂಕ ಒಮ್ಮೆ ಬದಲಾಯಿಸಬಹುದು.',
                         en: 'No cancellation once booked. The date can be changed once.' },
  f_pay_now:           { kn: 'ಈಗ ಪಾವತಿಸಿ',                  en: 'Pay now' },
  f_total:             { kn: 'ಒಟ್ಟು {amount}',              en: 'Total {amount}' },
  f_fee_note:          { kn: 'ಪ್ರವೇಶ ಶುಲ್ಕ {entry} ಇಲಾಖೆಗೆ + ಸೇವಾ ಶುಲ್ಕ {fee}',
                         en: 'Entry {entry} to the department + service fee {fee}' },
};

/** Weekday and month names, so a date reads naturally in either language. */
const DAYS = {
  kn: ['ಭಾನು', 'ಸೋಮ', 'ಮಂಗಳ', 'ಬುಧ', 'ಗುರು', 'ಶುಕ್ರ', 'ಶನಿ'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};
const MONTHS = {
  kn: ['ಜನವರಿ', 'ಫೆಬ್ರವರಿ', 'ಮಾರ್ಚ್', 'ಏಪ್ರಿಲ್', 'ಮೇ', 'ಜೂನ್',
       'ಜುಲೈ', 'ಆಗಸ್ಟ್', 'ಸೆಪ್ಟೆಂಬರ್', 'ಅಕ್ಟೋಬರ್', 'ನವೆಂಬರ್', 'ಡಿಸೆಂಬರ್'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
       'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

const lang = (l) => (l === 'en' ? 'en' : 'kn');

/**
 * One string, in one language, with {placeholders} filled.
 *
 * @param l    'kn' | 'en'
 * @param key  a key from the table above
 * @param vars values for any {placeholder} in it
 */
function t(l, key, vars) {
  const row = S[key];
  if (!row) return key;                 // visible, so it gets noticed and fixed
  let out = row[lang(l)] ?? row.kn ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  }
  return out;
}

/** "ಬುಧ, 24 ಸೆಪ್ಟೆಂಬರ್" or "Wed, 24 Sep". */
function prettyDate(dateStr, l) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const L = lang(l);
  return `${DAYS[L][dt.getUTCDay()]}, ${d} ${MONTHS[L][m - 1]}`;
}

module.exports = { t, prettyDate, lang, STRINGS: S };
