-- Policies v1.2: postponing a pass is now offered, and support requests on
-- WhatsApp (user, 2026-09-19).
--
-- The Refund & Cancellation Policy and the Terms said postponement was "coming
-- soon"; it now exists (gatepass/postpone.js), so its rules are stated here in
-- the same words the bot and the postpone page show, and the Privacy Policy says
-- what is recorded when a visitor postpones or writes to support.
--
-- Every document moves to 1.2 so visitors are asked to accept the new version
-- on WhatsApp before their next booking — the consent to these terms is then on
-- record like the rest.

/* ── Refund & Cancellation Policy §3 — the rules themselves ─────────────── */
UPDATE legal_sections s SET
  title = 'Postponing a pass',
  description = 'Instead of a refund, a pass may be moved to another date and slot, once, on these terms:
• A pass can be postponed only once.
• It can be postponed until 24 hours before the start of the slot it was booked for.
• The new date must be within the next 30 days, in a slot at the same destination that still has room for the vehicle or the number of people on the pass.
• There is no fee for postponing, and no refund, part-refund or difference in amount either way — the pass, the vehicle or number of people, and the amount paid stay the same.
• The pass number stays the same. The original date and slot are released for others and can no longer be used.
• A pass that has been used for entry, cancelled or not paid for cannot be postponed.
You can postpone from the WhatsApp menu ("Postpone pass"), where these terms are shown and you confirm that you agree to them before the pass is moved; our team can also postpone a pass on your request. The updated pass is sent to you on WhatsApp. The limits above may be changed with the approval of the administering authority; any change is published here before it applies.'
FROM legal_documents d
WHERE s.document_id = d.id AND d.doc_code = 'refund' AND s.section_no = '3';

/* ── Terms §15 — no refund, but postponement ─────────────────────────────── */
UPDATE legal_sections s SET
  title = 'No cancellation or refund; postponement',
  description = 'A pass cannot be cancelled, and the amount paid for it is not refunded, as set out in our Refund & Cancellation Policy. A pass may instead be postponed to another date and slot once, until 24 hours before its slot starts, to a date within the next 30 days where there is room — with no fee and no refund or difference in amount — on the terms in that policy. By postponing a pass you agree to those terms, and the time and version of your agreement are recorded.'
FROM legal_documents d
WHERE s.document_id = d.id AND d.doc_code = 'terms' AND s.section_no = '15';

/* ── Terms §20 — events beyond our control ───────────────────────────────── */
UPDATE legal_sections s SET
  description = 'We are not responsible for failing to provide the service because of events beyond our reasonable control, such as natural disasters, extreme weather, landslides, fire, epidemics, government orders, closures by the administering authority, strikes, civil disturbance, or failures of power, networks or third-party services. If such an event prevents entry on your date, no refund is made; the pass may be postponed to another date under the postponement terms in our Refund & Cancellation Policy, or as the administering authority directs.'
FROM legal_documents d
WHERE s.document_id = d.id AND d.doc_code = 'terms' AND s.section_no = '20';

/* ── Privacy §3 — what is collected when postponing or asking for support ── */
UPDATE legal_sections s SET
  description = s.description || '
• If you postpone a pass: the original and new date and slot, when you agreed to the postponement terms, the version of the terms, and the network address the request came from.
• If you write to us through Support on WhatsApp: the topic, your message, an email address if you give one, and the passes on your number, so that we can help without asking again.'
FROM legal_documents d
WHERE s.document_id = d.id AND d.doc_code = 'privacy' AND s.section_no = '3'
  AND s.description NOT LIKE '%If you postpone a pass%';

/* ── Privacy §7 — how it is used ─────────────────────────────────────────── */
UPDATE legal_sections s SET
  description = s.description || ' We also use it to move a pass you ask to postpone and send you the updated pass, and to answer support requests — a support message is emailed to our team and answered on WhatsApp.'
FROM legal_documents d
WHERE s.document_id = d.id AND d.doc_code = 'privacy' AND s.section_no = '7'
  AND s.description NOT LIKE '%postpone%';

/* ── Every document to 1.2, and the refund summary no longer "coming soon" ── */
UPDATE legal_documents SET version = '1.2', effective_from = CURRENT_DATE, modified_at = now(),
  summary = CASE doc_code
    WHEN 'refund' THEN 'Passes are not cancelled or refunded. A pass may be postponed once, until 24 hours before its slot, to a date within 30 days — with no fee. Money is returned only for failed or duplicate payments.'
    ELSE summary END
WHERE is_active;
