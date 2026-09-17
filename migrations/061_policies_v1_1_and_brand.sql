-- 061_policies_v1_1_and_brand.sql — the address, the tagline, and every policy
-- rewritten to cover what the platform actually does (user, 2026-09-17).
--
-- THE ADDRESS starts at The Orchard: no floor or flat number on any public page,
-- policy or invoice. THE TAGLINE is "Entry made simple & secured."
--
-- THE POLICIES, VERSION 1.1. Version 1.0 described a vehicle pass booked on
-- WhatsApp and little else. Since then the platform gained per-person passes,
-- passes sold and issued at the checkpost, photographs at the barrier, a
-- self-check-in that reads the distance to the gate, vehicles identified by a
-- declared chassis number, blocking and a watchlist, feedback requests, reports
-- to officers, staff and officer accounts signed in by SMS code, and a public
-- website. Each is now stated, together with what the visitor is and is not
-- entitled to, the approval still awaited from the Department of Tourism, the
-- Digital Personal Data Protection Act, 2023, and the limits of our
-- responsibility.
--
-- Every section is replaced rather than patched, so no document is left half
-- old and half new. The Terms and the Privacy Policy require consent, so their
-- new version is put to each visitor on WhatsApp before their next booking.
--
-- FROM THE USER (2026-09-17): vehicle records come from Parivahan through ULIP;
-- visitors agree to promotional messages and alerts as well as service messages,
-- and can opt out; there is no cancellation and no refund of a pass — only money
-- taken without a pass being issued is returned; postponing a pass to another
-- date is coming, subject to approval.
--
-- THESE HAVE NOT BEEN REVIEWED BY A LAWYER. They should be before launch.

BEGIN;

/* ─────────────────────────────────────────────────────── brand and address ── */

UPDATE app_settings SET value = 'The Orchard, Apricot Block, HMT Watch Factory Main Road, Jalahalli, Bengaluru 560013', modified_at = now()
 WHERE key = 'business_address';
UPDATE app_settings SET value = 'Entry made simple & secured.', modified_at = now() WHERE key = 'product_tagline';
UPDATE app_settings SET value = 'ಪ್ರವೇಶ ಈಗ ಸರಳ ಮತ್ತು ಸುರಕ್ಷಿತ.', modified_at = now() WHERE key = 'product_tagline_kn';

INSERT INTO app_settings (key, value, note)
VALUES ('approval_status_note', 'Approval from the Department of Tourism, Government of Karnataka, is awaited.',
        'Stated on the website and in the policies until the approval is granted')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, modified_at = now();

/* ─────────────────────────────────────────────────────────────── versions ── */

UPDATE legal_documents SET version = '1.1', effective_from = CURRENT_DATE, modified_at = now(),
  summary = CASE doc_code
    WHEN 'privacy' THEN 'What {{product_name}} collects when you book or use an entry pass — for a vehicle or for people — and when staff and officers use it; why; who sees it; where it is kept and for how long; and your rights.'
    WHEN 'terms' THEN 'The rules for booking and using a {{product_name}} entry pass, for a vehicle or for people, and what we are and are not responsible for.'
    WHEN 'data_deletion' THEN 'How to ask {{product_name}} to delete your data, what happens next, and what the law requires us to keep.'
    WHEN 'refund' THEN 'Passes cannot be cancelled or refunded. When money is returned for a payment that did not produce a pass, and what is coming for postponing a pass.'
    WHEN 'delivery' THEN 'How and when your entry pass reaches you. Passes are digital; nothing is shipped.'
    WHEN 'grievance' THEN 'Who to contact with a complaint, the time within which it will be answered, and where to go next.'
    ELSE summary END
 WHERE doc_code IN ('privacy', 'terms', 'data_deletion', 'refund', 'delivery', 'grievance');

DELETE FROM legal_sections
 WHERE document_id IN (SELECT id FROM legal_documents
                        WHERE doc_code IN ('privacy', 'terms', 'data_deletion', 'refund', 'delivery', 'grievance'));

/* ───────────────────────────────────────────────────────────────── privacy ── */

INSERT INTO legal_sections (document_id, section_no, title, description, display_order)
SELECT d.id, s.no, s.title, s.body, s.ord FROM legal_documents d,
(VALUES
 ('1', 'Who we are', $${{product_name}} is a service for booking entry passes — for vehicles and for people — to destinations in Karnataka, on WhatsApp and at the checkpost. It is a product of {{legal_name}} ({{legal_form}}), {{business_address}}. GSTIN {{gstin}}.
In this policy "we" means {{legal_name}}. Under the Digital Personal Data Protection Act, 2023 we are the Data Fiduciary for the personal data described here.
{{product_name}} is not a government website and is not operated by a government department. {{approval_status_note}}$$, 10),

 ('2', 'Who this policy covers', $$• Visitors who book, buy or are issued a pass, whether on WhatsApp, at a checkpost counter or free of charge.
• Checkpost staff, checkpost administrators and officers who use the gate app or the administration panel.
• Anyone who visits our website or writes to us through it.$$, 20),

 ('3', 'What we collect from visitors', $$• Your WhatsApp number and the profile name shown on your WhatsApp account; the name you give, if any.
• The language you choose, and the date, time and version of the terms you accepted.
• For a vehicle pass: the vehicle registration number. Where a vehicle has no readable number plate or no record can be found, the details written down at the checkpost instead — such as a chassis number, a description of the vehicle or the driver's name.
• For a pass for people: the number of people it admits.
• Your booking: destination, date, time slot, pass type, amount, pass number and invoice.
• Your payment reference and method as reported by our payment processor. We never receive or store your card number, UPI PIN or bank password. For a payment made at a checkpost counter: the method, the reference typed in and, where taken, a photograph of the payment confirmation screen.
• Photographs taken at the checkpost when a pass is sold there — of the vehicle, its number plate or a payment screen — to prove the sale and identify the vehicle.
• If you choose to check yourself in at the gate: your phone's location is read once, and only the distance from the gate is stored, never the location itself.
• The time your entry is recorded, the checkpost and the staff member who recorded it.
• Feedback and ratings you give after your visit.
• The messages you send to our WhatsApp number and our replies, kept as a record of the service provided.$$, 30),

 ('4', 'Vehicle records we look up', $$When a registration number is entered, we retrieve the vehicle's records from the Government of India's Parivahan systems of the Ministry of Road Transport and Highways — VAHAN for the registration certificate and e-Challan for traffic challans — and its FASTag records, through ULIP (Unified Logistics Interface Platform), the Government of India platform through which authorised users access these records. The registration details set the entry fee, because the fee depends on the vehicle category.
Before anything is stored we remove the owner's name, address, chassis number and engine number from these records. We keep the vehicle's make, model, variant, class, fuel and colour, and the FASTag and e-challan records, with the registration number, so a repeat booking does not need a fresh lookup. A record is refreshed after thirty days.
These records are retrieved for any registration number entered, including numbers entered by mistake, and are used only as described in this policy. The records are the government's; we are not responsible for errors in them. If a vehicle's category is shown wrongly, the correction must be made with the Regional Transport Office.$$, 40),

 ('5', 'What we collect from staff and officers', $$For people who use the gate app or the administration panel: name, mobile number, role, the checkpost they are posted to, sign-in codes (stored only in scrambled form), sign-in and sign-out times, shifts, the device and network address used, and a record of the actions they take — passes checked, entries recorded, passes sold or issued free, and settings changed. This record is kept so that every action can be traced to the person who took it.$$, 50),

 ('6', 'Website visitors', $$Our website does not use advertising or tracking cookies and does not run analytics that follow you across sites. If you write to us through the contact form, we keep your name, contact details and message to answer you. Our servers keep ordinary technical logs, such as network addresses and times of requests, for security.$$, 60),

 ('7', 'How we use it', $$We use personal data to: confirm a vehicle is permitted and set its fee; hold a place and take payment; issue, deliver and resend passes; let checkpost staff verify passes and record entry; send confirmations, alerts and notices about your booking and your visit; issue GST invoices and keep the accounts and tax records the law requires; prevent duplicate, fraudulent or abusive bookings, including blocking numbers or vehicles that misuse the service; ask for feedback after a visit and use ratings and comments, without your name or number, to improve the service and in reports; prepare reports on passes, entries and collections for the administering authority; secure the service and trace actions to the people who took them; answer questions and complaints; and, where you have agreed, send promotional messages about {{product_name}}, its destinations, new features and offers.$$, 70),

 ('8', 'Consent and legal grounds', $$By tapping Agree on WhatsApp, or by booking, buying or accepting a pass, you consent to the use of your personal data described here, including receiving service messages, alerts and promotional messages from us on WhatsApp and by SMS.
You can stop promotional messages at any time by replying STOP to the {{product_name}} WhatsApp number or writing to {{contact_email}}; service messages about a pass you hold, such as its confirmation, entry record and closure notices, continue while the pass is valid.
Some processing does not depend on consent: keeping accounting and tax records, responding to lawful requests from authorities, and preventing fraud, as the law allows. Withdrawing consent does not affect what was done before it, or records the law requires us to keep.$$, 80),

 ('9', 'Who we share it with', $$We share personal data only as needed to provide the service:
• checkpost staff and the administering authority see the vehicle number or number of people, destination, date, slot and pass status in order to admit you, and receive reports on passes, entries and collections;
• the registration number is sent to ULIP and the Parivahan systems to retrieve the vehicle's records;
• Razorpay processes payments under its own privacy policy;
• Meta (WhatsApp) carries messages between you and us;
• our SMS provider delivers messages and sign-in codes;
• our hosting and email providers process data on our behalf under contract;
• authorities, where the law requires it.
We do not sell or rent personal data to anyone.$$, 90),

 ('10', 'Where it is kept', $$Our servers and databases are located in India. Meta and Razorpay may process data outside India under their own terms. Checkpost phones keep a copy of the day's expected passes so entries can be recorded without signal; that copy is replaced each day and removed when staff sign out.$$, 100),

 ('11', 'How long we keep it', $$• Passes, payments, invoices, refunds and the photographs that prove counter sales: eight years, the period Indian tax and accounting law requires.
• Vehicle records: with the registration number, refreshed when older than thirty days.
• WhatsApp message history: while you use the service and up to one year afterwards, to handle disputes.
• Staff and officer action records: eight years, as part of the accounting record.
• Sign-in codes: until used or expired; photographs never attached to a sale are deleted.
When a period ends, the data is deleted or irreversibly anonymised.$$, 110),

 ('12', 'Security', $$Data is held on access-controlled servers, sent over encrypted connections, and available only to people whose role needs it. Staff and officers sign in with codes sent to their own mobile numbers, and each role sees only what it needs. Booking links are signed, expire and stop working once used. Pass numbers are generated with a secret key and reveal nothing about you. No system is perfectly secure; if a breach affecting you occurs, we will notify you and the Data Protection Board of India as the law requires.$$, 120),

 ('13', 'Your rights', $$Under the Digital Personal Data Protection Act, 2023 you may ask to access the personal data we hold about you, have it corrected or completed, have it erased, withdraw consent, and nominate another person to exercise these rights if you die or become incapable. Erasure is described on our Data Deletion page. Data we must keep by law is kept for the period stated above. Write to {{contact_email}} or to our Grievance Officer. If you are not satisfied with our answer, you may complain to the Data Protection Board of India.$$, 130),

 ('14', 'Children', $$Passes are booked and paid for by adults. A pass for people may admit children in the group; we record only the number of people and nothing about any child. We do not knowingly collect personal data from children.$$, 140),

 ('15', 'Changes to this policy', $$When this policy changes in a way that matters, the version and date at the top change, and you are asked to accept the new version on WhatsApp before your next booking.$$, 150),

 ('16', 'Contact', $${{legal_name}}, {{business_address}}. Email {{contact_email}}. Website {{website}}. Complaints: see our Grievance Redressal page.$$, 160)
) AS s(no, title, body, ord)
WHERE d.doc_code = 'privacy';

/* ─────────────────────────────────────────────────────────────────── terms ── */

INSERT INTO legal_sections (document_id, section_no, title, description, display_order)
SELECT d.id, s.no, s.title, s.body, s.ord FROM legal_documents d,
(VALUES
 ('1', 'About the service', $${{product_name}} is a product of {{legal_name}} ({{legal_form}}), {{business_address}}. It lets visitors book entry passes — for a vehicle or for people — to destinations in Karnataka on WhatsApp, and lets the administering authority sell, issue and check passes at the checkpost.
We provide the booking, payment, pass and checking technology. The entry fee is set by the authority administering each destination and is collected on its behalf. {{product_name}} is not a government website, and we are not a government department or its agent except as the authority appoints us.$$, 10),

 ('2', 'Approval status', $${{approval_status_note}} Until it is granted, the service, its destinations, fees and features may be limited, changed, suspended or withdrawn at any time. A pass already issued is honoured for its date unless the administering authority directs otherwise.$$, 20),

 ('3', 'Accepting these terms', $$You accept these terms and our Privacy Policy when you tap Agree on WhatsApp, or when you book, buy, accept or use a pass. Your acceptance, with the version accepted, is recorded electronically and is valid under the Information Technology Act, 2000. You must be at least 18 years old and able to enter a binding contract. If you book for a group, you accept these terms on behalf of everyone the pass admits.$$, 30),

 ('4', 'Types of pass', $$• A vehicle pass admits one vehicle, with its occupants, to one destination on one date within one time slot, and is valid only for the registration number shown on it.
• A pass for people admits the number of people shown on it to one destination on one date within one time slot, where the destination sells passes that way.
• A pass may be bought on WhatsApp, or at a checkpost counter where the authority sells passes there.
• A free pass may be issued at the authority's discretion; it carries no fee and cannot be refunded or transferred.
A pass cannot be transferred, sold on, or used for another vehicle, date, slot or destination.$$, 40),

 ('5', 'Eligible vehicles', $$Vehicle passes are issued only for two-wheelers, cars and jeeps, Toofan-class vehicles and Tempo Travellers, or as the administering authority decides for each destination.
Autorickshaws, buses and minibuses, trucks and goods vehicles, tractors and trailers are not permitted, and a booking for them is refused.$$, 50),

 ('6', 'Correct information', $$You must enter the correct registration number of the vehicle that will travel, and the correct number of people. The vehicle category, and so the fee, is determined from the vehicle's registration record in the Government of India's Parivahan (VAHAN) system, retrieved through ULIP; if the record cannot be found, the booking cannot be completed online. We rely on that record as it is; if it shows the category wrongly, the correction must be made with the Regional Transport Office, and no fee is adjusted.
Where a vehicle's details are declared at a checkpost instead — for a vehicle without a readable plate or record — the person declaring them is responsible for their accuracy. If a vehicle's category or details are found to be different from those declared or booked, entry may be refused, the difference in fee may be charged, and the pass may be cancelled without a refund.$$, 60),

 ('7', 'Fees and taxes', $$The amount you pay is the entry fee set by the administering authority plus our {{fee_label}}, which includes GST at {{gst_percent_on_platform}}%. Both are shown before you pay, and a GST invoice is issued for every paid pass. The amount shown before payment is final for that booking. Fees may change for bookings made later. If a fee is plainly shown wrongly because of an error, we may cancel the booking and return the amount paid.$$, 70),

 ('8', 'Booking window, slots and capacity', $$Bookings open up to two weeks ahead; each day at 6:00 PM the next date becomes available. Each destination, slot and vehicle category has a limited number of places, set by the administering authority, which may change capacity or close a slot or destination at any time. Last entry is one hour before a slot ends, and a slot cannot be booked for the same day after its last entry time. One pass is allowed per vehicle per date.$$, 80),

 ('9', 'Holding a place and paying', $$When you continue to payment, a place is held for your vehicle or group for {{hold_minutes}} minutes. If payment is not completed in that time, the place is released. Payments are processed by Razorpay; a pass is issued only after payment is confirmed. Do not pay twice for the same booking. Repeatedly holding places without paying may lead to your number being blocked.$$, 90),

 ('10', 'Your pass and your entry', $$Your pass is sent on WhatsApp as a message and a PDF. You do not need a printout: checkpost staff find your pass by vehicle number or pass number and record your entry. A pass admits once; leaving and entering again needs a new pass. You must arrive within your slot and before its last entry time. Where offered, you may check yourself in when you are at the gate, which uses your phone's location once.$$, 100),

 ('11', 'Rules at the destination', $$• The pass is valid only for the vehicle number or the number of people shown on it. Changing the vehicle at the checkpost is not allowed.
• Vehicles without a clear, readable number plate may be refused entry.
• One pass per vehicle for a date and slot. Repeat or duplicate bookings will be cancelled.
• Editing, copying or reselling a pass is illegal and will be reported; legal action may be taken against the vehicle's owner and the persons involved.
• Checkpost staff may check the vehicle, the number of people and the pass, and may photograph the vehicle or its plate where a pass is sold at the gate.
• Follow the directions of checkpost, police and forest staff, the laws on traffic, plastic, alcohol and protected areas, and keep the destination clean.
• The decision of checkpost staff on entry at the gate is final, subject to your right to raise a grievance afterwards.$$, 110),

 ('12', 'Refusal of entry and blocking', $$Entry may be refused, without a refund, if the vehicle or group does not match the pass, the plate is unreadable, the pass is for another date, slot or destination, the last entry time has passed, the pass has already been used, or these terms or the rules at the destination are broken. We may block a WhatsApp number or a vehicle from booking, with or without notice, for fraud, misuse, abuse of staff, repeated abandoned bookings or any breach of these terms.$$, 120),

 ('13', 'Things you must not do', $$You must not: book with false information; use bots, scripts or automated means to book or to read the service; book to resell or tout passes; create, alter or copy passes; attempt to get around capacity, fees or blocks; interfere with or probe the security of the service; or use the service for anything unlawful.$$, 130),

 ('14', 'Messages we send', $$By agreeing to these terms you agree to receive from us, on WhatsApp and by SMS:
• service messages — your pass, payment confirmations, confirmation of entry, and requests for feedback;
• alerts and notices — closures, changes to slots or timings, weather or safety advisories and reminders about your visit;
• promotional messages — news about {{product_name}}, its destinations, new features and offers.
You can stop promotional messages at any time by replying STOP or writing to {{contact_email}}. Service messages and alerts about a pass you hold continue while it is valid. Staff and officers receive sign-in codes by SMS.$$, 140),

 ('15', 'No cancellation or refund', $$A pass cannot be cancelled, and the amount paid for it is not refunded, as set out in our Refund & Cancellation Policy. Postponing a pass to another date is planned and will be offered once approved; its terms, including any charge, will be published before it starts.$$, 150),

 ('16', 'Services we depend on', $$The service depends on WhatsApp, Razorpay, ULIP and the Government of India's Parivahan systems, SMS and hosting providers, and mobile networks at the destination. We do not control them and are not responsible for their failures, delays or errors, including errors in government records. If a message does not arrive, your pass is still valid and entry is recorded by vehicle or pass number.$$, 160),

 ('17', 'Our responsibility', $$We provide the booking and pass service with reasonable care, but "as is" and without any promise that it will be uninterrupted or error-free. Access to a destination, road and weather conditions, closures, safety, and conduct at the site are the responsibility of the authority administering the destination and of the visitor. We are not responsible for injury, loss, theft, damage or delay suffered at or on the way to a destination. To the extent the law allows, our total liability for any claim relating to a pass is limited to the amount paid for that pass, and we are not liable for indirect or consequential loss.$$, 170),

 ('18', 'Your responsibility to us', $$You agree to make good any loss, claim or penalty we suffer because you gave false information, misused a pass or the service, or broke these terms or the law.$$, 180),

 ('19', 'Trademarks and content', $${{product_name}}™ is a trademark of {{legal_name}}™. The service, its software, text, designs and passes belong to {{legal_name}} or its licensors. You may not copy, adapt or reuse them without written permission. Names and marks of government departments and destinations belong to their owners and are used only to describe the service.$$, 190),

 ('20', 'Events beyond our control', $$We are not responsible for failing to provide the service because of events beyond our reasonable control, such as natural disasters, extreme weather, landslides, fire, epidemics, government orders, closures by the administering authority, strikes, civil disturbance, or failures of power, networks or third-party services. If such an event prevents entry on your date, no refund is made; once postponement is available, the pass may be moved to another date under its terms, or as the administering authority directs.$$, 200),

 ('21', 'Changes to these terms', $$We may change these terms. When they change in a way that matters, the version and date at the top change, and you are asked to accept the new version on WhatsApp before your next booking. A pass already issued remains subject to the terms accepted when it was booked, except where a change is required by law.$$, 210),

 ('22', 'Governing law and disputes', $$These terms are governed by the laws of India. Please raise any complaint with our Grievance Officer first. Courts at {{jurisdiction_city}}, Karnataka have exclusive jurisdiction, without affecting any right you have under the Consumer Protection Act, 2019.$$, 220),

 ('23', 'General', $$If any part of these terms is found unenforceable, the rest remains in force. These terms, with the policies they refer to, are the whole agreement between you and us about the service. Our not enforcing a term is not a waiver of it.$$, 230),

 ('24', 'Contact', $${{legal_name}}, {{business_address}}. Email {{contact_email}}.$$, 240),

 ('25', 'Your WhatsApp number', $$Passes, links and messages go to the WhatsApp number you book from. Keep that number and your phone secure, and do not share booking links: anyone holding a link or your phone can act on your booking. We are not responsible for bookings made or passes received through your number by someone else.$$, 245)
) AS s(no, title, body, ord)
WHERE d.doc_code = 'terms';

/* ────────────────────────────────────────────────────────────── data deletion ── */

INSERT INTO legal_sections (document_id, section_no, title, description, display_order)
SELECT d.id, s.no, s.title, s.body, s.ord FROM legal_documents d,
(VALUES
 ('1', 'How to request deletion', $$Send the message DELETE MY DATA to the {{product_name}} WhatsApp number, from the WhatsApp number you booked with. We reply with a reference number for your request.
We accept requests only from the number itself, because that proves the data is yours; a request typed into a web form could be made by anyone about anyone. If you no longer have that number, email {{contact_email}} from an address we can reply to, and we will verify your identity before acting.$$, 10),

 ('2', 'What we delete', $$Within {{data_deletion_days}} days of your request we delete or irreversibly anonymise: your WhatsApp profile name, the name you gave and your language choice; your message history with us; your feedback; and the link between your number and any vehicle you looked up.$$, 20),

 ('3', 'What the law requires us to keep', $$Records of passes that were paid for — the invoice, amount, payment reference, date, pass number, entry record and any photograph proving a counter sale — must be kept for eight years under Indian tax and accounting law. They are kept separately from your contact details and used for no other purpose. A pass for a future date remains valid unless you also ask for it to be cancelled under our Refund & Cancellation Policy.$$, 30),

 ('4', 'Staff and officers', $$Staff and officers who leave should ask the administering authority, or write to {{contact_email}}, to have their account closed. Their sign-in access ends at once. The record of actions they took is kept for eight years as part of the accounting record, and their contact details are removed from everything else.$$, 40),

 ('5', 'Confirmation', $$When the request is completed we send a WhatsApp message to the same number, if it can still receive messages, confirming the date of deletion. You can ask about the status of a request at any time by quoting its reference to {{contact_email}}.$$, 50),

 ('6', 'Stopping messages without deleting your data', $$To stop promotional messages only, reply STOP to the {{product_name}} WhatsApp number or write to {{contact_email}}. Your passes and bookings are not affected.$$, 60)
) AS s(no, title, body, ord)
WHERE d.doc_code = 'data_deletion';

/* ─────────────────────────────────────────────────────────────────── refund ── */

INSERT INTO legal_sections (document_id, section_no, title, description, display_order)
SELECT d.id, s.no, s.title, s.body, s.ord FROM legal_documents d,
(VALUES
 ('1', 'No cancellation, no refund', $$Every {{product_name}} pass is final. Once issued, a pass cannot be cancelled, and the amount paid for it — the entry fee and the {{fee_label}} — is not refunded, for any reason, including:
• not travelling, changing plans, or arriving after the last entry time;
• booking the wrong date, slot, destination, vehicle number or number of people;
• entry refused because the vehicle or group does not match the pass, the plate is unreadable, details were declared wrongly, or the terms or the rules at the destination were broken;
• weather, traffic, road conditions, or a closure of the destination or slot by the administering authority;
• the service being changed, suspended or withdrawn;
• a pass already used, or a free pass.
This applies equally to passes booked on WhatsApp and passes bought at a checkpost counter.$$, 10),

 ('2', 'When money is returned', $$Money is returned only where no pass was sold for it:
• Payment taken but no pass issued — for example the place was released before payment completed, or the payment could not be confirmed. The full amount is returned automatically.
• Duplicate payment — if the same booking is paid for more than once, every payment after the first is returned in full.$$, 20),

 ('3', 'Postponing a pass (coming soon)', $$Moving a pass to another date is planned, subject to the approval of the administering authority. It is not available yet. When it is introduced, its conditions — how far ahead, how many times, and any charge — will be published here and in our Terms & Conditions before it starts.$$, 30),

 ('4', 'How and when money is returned', $$Money is returned to the original payment method through Razorpay. It is started within 2 working days and usually reaches your account within {{refund_working_days}} working days after that, depending on your bank. A counter payment is returned by the original method where possible, or to an account of the payer after verification.$$, 40),

 ('5', 'Payment disputes', $$Please write to us before raising a dispute or chargeback with your bank. A chargeback on a pass that was issued, and especially one that was used, will be contested with the booking, payment and entry records.$$, 50),

 ('6', 'Questions', $$Write to {{contact_email}} with your pass number or payment reference.$$, 60)
) AS s(no, title, body, ord)
WHERE d.doc_code = 'refund';

/* ───────────────────────────────────────────────────────────────── delivery ── */

INSERT INTO legal_sections (document_id, section_no, title, description, display_order)
SELECT d.id, s.no, s.title, s.body, s.ord FROM legal_documents d,
(VALUES
 ('1', 'Digital passes only', $${{product_name}} passes are digital. Nothing is printed or shipped, and there are no delivery charges.$$, 10),

 ('2', 'Passes booked on WhatsApp', $$Your pass is sent to the WhatsApp number you booked from as soon as payment is confirmed — usually within a minute — as a message and a PDF. It is sent only to that number; we cannot send it to another number.$$, 20),

 ('3', 'Passes bought or issued at a checkpost', $$A pass bought at a checkpost counter, or issued free, is shown to you there, and is sent on WhatsApp to the number you give if you ask for it. It is valid whether or not the message arrives.$$, 30),

 ('4', 'If it does not arrive', $$Send hi to the {{product_name}} WhatsApp number and choose My passes: every upcoming pass is sent to you again. Your entry does not depend on the message: checkpost staff find your pass by vehicle number or pass number. If you still need help, write to {{contact_email}} with your payment reference.$$, 40)
) AS s(no, title, body, ord)
WHERE d.doc_code = 'delivery';

/* ──────────────────────────────────────────────────────────────── grievance ── */

INSERT INTO legal_sections (document_id, section_no, title, description, display_order)
SELECT d.id, s.no, s.title, s.body, s.ord FROM legal_documents d,
(VALUES
 ('1', 'Grievance Officer', $$In accordance with the Information Technology Act, 2000, the Consumer Protection (E-Commerce) Rules, 2020 and the Digital Personal Data Protection Act, 2023, the Grievance Officer for {{product_name}} is:
{{grievance_officer_name}}, {{legal_name}}
{{business_address}}
Email: {{contact_email}}$$, 10),

 ('2', 'How to raise a grievance', $$Email the Grievance Officer with your WhatsApp number, your pass number or payment reference if you have one, and a description of the issue. Complaints about entry at a checkpost may also be raised with the staff or the administering authority on the spot.$$, 20),

 ('3', 'Timelines', $$Your complaint will be acknowledged within {{grievance_ack_hours}} hours and resolved within {{grievance_resolve_days}} days of receipt.$$, 30),

 ('4', 'If you are not satisfied', $$If your complaint is not resolved to your satisfaction, you may contact the National Consumer Helpline (1915, consumerhelpline.gov.in) or approach the Consumer Commission under the Consumer Protection Act, 2019. Complaints about personal data may be taken to the Data Protection Board of India.$$, 40)
) AS s(no, title, body, ord)
WHERE d.doc_code = 'grievance';

COMMIT;
