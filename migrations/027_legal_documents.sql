-- 027_legal_documents.sql — the policies, as data, served to the website and the chat.
--
-- WHY IN THE DATABASE. Meta asks for a privacy policy, terms and a data-deletion
-- page before it will approve the app and the display name; Razorpay's website
-- review asks for terms, privacy, refund and cancellation, delivery and contact;
-- India's IT Rules ask for a grievance officer. These are read by the website at
-- pravesha.in, by the back-end's own /policy pages linked from WhatsApp, and
-- later edited from the admin panel. One copy, so the page a customer reads and
-- the page a reviewer reads cannot drift apart.
--
-- PLACEHOLDERS. {{legal_name}}, {{business_address}} and the rest are filled at
-- read time from app_settings, the same values printed on the GST invoice, so a
-- change of address updates every policy at once and no policy can contradict
-- the invoice.
--
-- THE TEXT DESCRIBES WHAT THE SYSTEM ACTUALLY DOES. Every plate entered is looked
-- up for its registration, FASTag and e-challan records; owner name, address,
-- chassis and engine numbers are removed before storing; passes are delivered on
-- WhatsApp; passes are not transferable. If the system changes, these change
-- with it. They have not been reviewed by a lawyer and should be before launch.

CREATE TABLE IF NOT EXISTS legal_documents (
  id               bigserial PRIMARY KEY,
  doc_code         text NOT NULL UNIQUE,
  title            text NOT NULL,
  title_kn         text,
  slug             text NOT NULL UNIQUE,
  summary          text,
  version          text NOT NULL DEFAULT '1.0',
  effective_from   date NOT NULL DEFAULT CURRENT_DATE,
  requires_consent boolean NOT NULL DEFAULT false,
  display_order    int NOT NULL DEFAULT 100,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  modified_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS legal_sections (
  id             bigserial PRIMARY KEY,
  document_id    bigint NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,
  section_no     text,
  title          text NOT NULL,
  description    text NOT NULL,
  display_order  int NOT NULL DEFAULT 100,
  is_active      boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS legal_sections_doc ON legal_sections (document_id, display_order);

/* A deletion request is recorded, not silently acted on: the visitor gets a
   reference, the work is done within the stated period, and what had to be kept
   by law is recorded alongside what was erased. */
CREATE TABLE IF NOT EXISTS data_deletion_requests (
  id            bigserial PRIMARY KEY,
  reference     text NOT NULL UNIQUE,
  customer_id   bigint REFERENCES customers(id) ON DELETE SET NULL,
  mobile        text NOT NULL,
  channel       text NOT NULL DEFAULT 'whatsapp',
  status        text NOT NULL DEFAULT 'received'
                CHECK (status IN ('received', 'in_progress', 'completed', 'rejected')),
  note          text,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);
CREATE INDEX IF NOT EXISTS data_deletion_mobile ON data_deletion_requests (mobile, requested_at DESC);

INSERT INTO app_settings (key, value) VALUES
  ('grievance_ack_hours', '24'),
  ('grievance_resolve_days', '15'),
  ('data_deletion_days', '30'),
  ('jurisdiction_city', 'Bengaluru'),
  ('policies_effective_from', '11 September 2026')
ON CONFLICT (key) DO NOTHING;

/* ───────────────────────────────────────────────────────────── documents ── */

INSERT INTO legal_documents (doc_code, title, title_kn, slug, summary, display_order, requires_consent) VALUES
 ('privacy', 'Privacy Policy', 'ಗೌಪ್ಯತಾ ನೀತಿ', 'privacy',
  'What {{product_name}} collects when you book an entry pass on WhatsApp, why, who sees it, how long it is kept, and how to have it deleted.', 10, true),
 ('terms', 'Terms & Conditions', 'ನಿಯಮಗಳು ಮತ್ತು ಷರತ್ತುಗಳು', 'terms',
  'The rules for booking and using a {{product_name}} vehicle entry pass.', 20, true),
 ('data_deletion', 'Data Deletion', 'ಡೇಟಾ ಅಳಿಸುವಿಕೆ', 'data-deletion',
  'How to ask {{product_name}} to delete your data, what happens next, and what the law requires us to keep.', 30, false),
 ('refund', 'Refund & Cancellation Policy', 'ಮರುಪಾವತಿ ಮತ್ತು ರದ್ದತಿ ನೀತಿ', 'refund-policy',
  'When a {{product_name}} pass is refunded, how, and how long it takes.', 40, false),
 ('delivery', 'Pass Delivery Policy', 'ಪಾಸ್ ವಿತರಣಾ ನೀತಿ', 'delivery-policy',
  'How and when your entry pass reaches you. Passes are digital; nothing is shipped.', 50, false),
 ('grievance', 'Grievance Redressal', 'ಕುಂದುಕೊರತೆ ಪರಿಹಾರ', 'grievance',
  'Who to contact with a complaint, and the time within which it will be answered.', 60, false)
ON CONFLICT (doc_code) DO NOTHING;

/* ──────────────────────────────────────────────────────────────── privacy ── */
INSERT INTO legal_sections (document_id, section_no, title, description, display_order)
SELECT d.id, s.no, s.title, s.body, s.ord FROM legal_documents d,
(VALUES
 ('1', 'Who we are', $$ {{product_name}} is a WhatsApp-based service for booking vehicle entry passes to hill destinations in Karnataka. It is a product of {{legal_name}} ({{legal_form}}), {{business_address}}. GSTIN {{gstin}}. In this policy "we" means {{legal_name}}.$$, 10),
 ('2', 'What we collect', $$When you use {{product_name}} we collect:
• your WhatsApp number and the profile name shown on your WhatsApp account;
• the language you choose and the time you accepted our terms;
• the vehicle registration number you enter;
• your booking: destination, date, time slot, vehicle category, amount and pass number;
• your payment reference and payment method as reported by our payment processor. We never receive or store your card number, UPI PIN or bank password;
• the messages you send to our WhatsApp number and our replies, kept as a record of the service provided.$$, 20),
 ('3', 'Vehicle records we look up', $$When you enter a registration number, we retrieve the vehicle's records from government vehicle databases through an authorised gateway: its registration certificate details, its FASTag status and its e-challan status. The registration details set the entry fee, because the fee depends on the vehicle category.
Before anything is stored we remove the owner's name, address, chassis number and engine number, so they cannot be displayed or recovered later. We keep the vehicle's make, model, variant, class, fuel and colour, and the FASTag and e-challan records, with the vehicle's registration number, so a repeat booking for the same vehicle does not need a fresh lookup. A record is refreshed after thirty days.
These records are retrieved for any registration number entered, including numbers entered by mistake.$$, 30),
 ('4', 'How we use it', $$We use your information only to: confirm the vehicle is permitted and set its fee; hold a place in the chosen slot; take payment; issue and deliver your pass and resend it when you ask; let checkpost staff verify and record your entry; send service messages about your booking, such as confirmation of entry or a closure affecting your date; prevent duplicate or fraudulent bookings; keep the accounting and tax records the law requires; and answer your questions and complaints.
We do not use your number for marketing and we do not send promotional messages.$$, 40),
 ('5', 'Who we share it with', $$We share information only as needed to provide the service:
• checkpost staff and the destination's administering authority see the vehicle number, destination, date, slot and pass status in order to admit the vehicle;
• our payment processor, Razorpay, handles your payment under its own privacy policy;
• Meta (WhatsApp) carries the messages between you and us;
• our hosting and vehicle-record gateway providers process data on our behalf under contract;
• authorities where the law requires it.
We do not sell or rent your information to anyone.$$, 50),
 ('6', 'How long we keep it', $$Booking, payment and invoice records are kept for eight years, the period Indian tax and accounting law requires. Vehicle records are kept with the vehicle's registration number and refreshed when older than thirty days. Message history is kept for as long as your account is active, and for up to one year afterwards to handle disputes. When a period ends, the data is deleted or irreversibly anonymised.$$, 60),
 ('7', 'Security', $$Data is held on access-controlled servers, transmitted over encrypted connections, and available only to people who need it for their work. Booking links are signed, expire, and stop working once used. Pass numbers are generated with a secret key and reveal nothing about you. No system is perfectly secure; if a breach affecting you occurs, we will notify you and the authorities as the law requires.$$, 70),
 ('8', 'Your rights', $$You can ask to see the information we hold about you, have it corrected, or have it deleted. Deletion requests are described on our Data Deletion page. You can also withdraw consent by stopping use of the service; information needed for a pass already issued, or required by law, is kept for the period stated above. Write to {{contact_email}} or to our Grievance Officer.$$, 80),
 ('9', 'Children', $${{product_name}} is intended for adults booking entry for a vehicle. We do not knowingly collect information from children.$$, 90),
 ('10', 'Changes to this policy', $$If this policy changes in a way that matters, the version and date at the top will change and you will be asked to accept the new version on WhatsApp before your next booking.$$, 100),
 ('11', 'Contact', $${{legal_name}}, {{business_address}}. Email {{contact_email}}. Website {{website}}.$$, 110)
) AS s(no, title, body, ord)
WHERE d.doc_code = 'privacy'
  AND NOT EXISTS (SELECT 1 FROM legal_sections x WHERE x.document_id = d.id);

/* ────────────────────────────────────────────────────────────────── terms ── */
INSERT INTO legal_sections (document_id, section_no, title, description, display_order)
SELECT d.id, s.no, s.title, s.body, s.ord FROM legal_documents d,
(VALUES
 ('1', 'The service', $${{product_name}}, a product of {{legal_name}}, issues entry passes for vehicles visiting hill destinations in Karnataka, booked on WhatsApp. A pass admits one vehicle to one destination on one date within one time slot. By booking you agree to these terms and to our Privacy Policy.$$, 10),
 ('2', 'Eligible vehicles', $$Passes are issued only for two-wheelers, cars and jeeps, Toofan-class vehicles and Tempo Travellers.
Autorickshaws, buses and minibuses, trucks and goods vehicles, tractors and trailers are not permitted, and a booking for them is refused.$$, 20),
 ('3', 'Vehicle number and fee', $$The entry fee depends on the vehicle category, which we determine from the vehicle's registration record. You must enter the correct registration number of the vehicle that will travel. If the registration record cannot be found, the booking cannot be completed online. The pass is valid only for the registration number shown on it.$$, 30),
 ('4', 'Booking window, slots and capacity', $$Bookings open up to two weeks ahead; each day at 6:00 PM the next date becomes available. Each destination, slot and vehicle category has a limited number of places. Last entry is one hour before a slot ends, and a slot cannot be booked for the same day after its last entry time. One pass is allowed per vehicle per date.$$, 40),
 ('5', 'Holding a place and paying', $$When you continue to payment, a place is held for your vehicle for a limited time shown on screen. If payment is not completed in that time, the place is released. The amount shown before payment is the entry fee plus a platform fee that includes GST; both are shown separately. Payments are processed by Razorpay. A pass is issued only after payment succeeds.$$, 50),
 ('6', 'Your pass', $$Your pass is sent to you on WhatsApp as a message and a PDF. You do not need a printout or a phone at the gate: checkpost staff read your vehicle number and record your entry. You can get your upcoming passes again at any time by choosing My passes on WhatsApp.$$, 60),
 ('7', 'Rules at the destination', $$• The pass is valid only for the vehicle number shown. Changing the vehicle at the checkpost is not allowed.
• Vehicles without a clear, readable number plate will not be allowed entry.
• One pass per vehicle for a date and slot. Repeat or duplicate bookings will be cancelled.
• Editing, copying or reselling a pass is illegal. Legal action will be taken against the vehicle and its owner.
• Follow the directions of checkpost and forest staff, and keep the environment clean.$$, 70),
 ('8', 'Cancellations, closures and refunds', $$Refunds and cancellations are governed by our Refund & Cancellation Policy.$$, 80),
 ('9', 'Our responsibility', $$We provide the booking and pass service. Access to a destination, road conditions, closures and conduct at the site are the responsibility of the authority administering the destination. To the extent the law allows, our liability for any claim relating to a pass is limited to the amount paid for that pass.$$, 90),
 ('10', 'Governing law', $$These terms are governed by the laws of India. Courts at {{jurisdiction_city}}, Karnataka have jurisdiction.$$, 100),
 ('11', 'Contact', $${{legal_name}}, {{business_address}}. Email {{contact_email}}.$$, 110)
) AS s(no, title, body, ord)
WHERE d.doc_code = 'terms'
  AND NOT EXISTS (SELECT 1 FROM legal_sections x WHERE x.document_id = d.id);

/* ─────────────────────────────────────────────────────────── data deletion ── */
INSERT INTO legal_sections (document_id, section_no, title, description, display_order)
SELECT d.id, s.no, s.title, s.body, s.ord FROM legal_documents d,
(VALUES
 ('1', 'How to request deletion', $$Send the message DELETE MY DATA to the {{product_name}} WhatsApp number, from the WhatsApp number you booked with. We reply with a reference number for your request.
We accept requests only from the number itself, because that proves the data is yours; a request typed into a web form could be made by anyone about anyone. If you no longer have that number, email {{contact_email}} from an address we can reply to, and we will verify your identity before acting.$$, 10),
 ('2', 'What we delete', $$Within {{data_deletion_days}} days of your request we delete or irreversibly anonymise: your WhatsApp profile name and language choice, your message history with us, and the link between your number and any vehicle you looked up.$$, 20),
 ('3', 'What the law requires us to keep', $$Records of passes that were paid for — the invoice, amount, payment reference, date and pass number — must be kept for eight years under Indian tax and accounting law. These are kept separately from your contact details and are used for no other purpose. A pass for a future date remains valid unless you also ask for it to be cancelled under our Refund & Cancellation Policy.$$, 30),
 ('4', 'Confirmation', $$When the request is completed we send a WhatsApp message to the same number, if it can still receive messages, confirming the date of deletion. You can ask about the status of a request at any time by quoting its reference to {{contact_email}}.$$, 40)
) AS s(no, title, body, ord)
WHERE d.doc_code = 'data_deletion'
  AND NOT EXISTS (SELECT 1 FROM legal_sections x WHERE x.document_id = d.id);

/* ───────────────────────────────────────────────────────────────── refund ── */
INSERT INTO legal_sections (document_id, section_no, title, description, display_order)
SELECT d.id, s.no, s.title, s.body, s.ord FROM legal_documents d,
(VALUES
 ('1', 'Passes are for a fixed date and slot', $$A pass is issued for one vehicle, destination, date and slot. It cannot be moved to another date, slot or vehicle, and it cannot be cancelled for a refund once issued, except in the cases below.$$, 10),
 ('2', 'Destination closed', $$If a destination is closed by the administering authority on your date — for weather, maintenance, safety or any other reason — and the closure prevents entry in your slot, the full amount you paid is refunded. We will tell you on WhatsApp.$$, 20),
 ('3', 'Payment taken but no pass issued', $$If money leaves your account but no pass is issued — for example the place was released before payment completed, or the payment could not be confirmed — the full amount is refunded automatically.$$, 30),
 ('4', 'Duplicate payments', $$If the same booking is paid for more than once, every payment after the first is refunded in full.$$, 40),
 ('5', 'How and when', $$Refunds go back to the original payment method through Razorpay. They are started within 2 working days and usually reach your account within {{refund_working_days}} working days after that, depending on your bank.$$, 50),
 ('6', 'Questions', $$Write to {{contact_email}} with your pass number or payment reference.$$, 60)
) AS s(no, title, body, ord)
WHERE d.doc_code = 'refund'
  AND NOT EXISTS (SELECT 1 FROM legal_sections x WHERE x.document_id = d.id);

/* ─────────────────────────────────────────────────────────────── delivery ── */
INSERT INTO legal_sections (document_id, section_no, title, description, display_order)
SELECT d.id, s.no, s.title, s.body, s.ord FROM legal_documents d,
(VALUES
 ('1', 'Digital passes only', $${{product_name}} passes are digital. Nothing is printed or shipped, and there are no delivery charges.$$, 10),
 ('2', 'When you receive it', $$Your pass is sent to the WhatsApp number you booked from as soon as payment is confirmed — usually within a minute — as a message and a PDF.$$, 20),
 ('3', 'If it does not arrive', $$Send hi to the {{product_name}} WhatsApp number and choose My passes: every upcoming pass is sent to you again. Your entry does not depend on the message: checkpost staff record entry by vehicle number. If you still need help, write to {{contact_email}} with your payment reference.$$, 30)
) AS s(no, title, body, ord)
WHERE d.doc_code = 'delivery'
  AND NOT EXISTS (SELECT 1 FROM legal_sections x WHERE x.document_id = d.id);

/* ────────────────────────────────────────────────────────────── grievance ── */
INSERT INTO legal_sections (document_id, section_no, title, description, display_order)
SELECT d.id, s.no, s.title, s.body, s.ord FROM legal_documents d,
(VALUES
 ('1', 'Grievance Officer', $$In accordance with the Information Technology Act, 2000 and the rules made under it, the Grievance Officer for {{product_name}} is:
{{proprietor_name}}, {{legal_name}}
{{business_address}}
Email: {{contact_email}}$$, 10),
 ('2', 'How to raise a grievance', $$Email the Grievance Officer with your WhatsApp number, your pass number or payment reference if you have one, and a description of the issue.$$, 20),
 ('3', 'Timelines', $$Your complaint will be acknowledged within {{grievance_ack_hours}} hours and resolved within {{grievance_resolve_days}} days of receipt.$$, 30)
) AS s(no, title, body, ord)
WHERE d.doc_code = 'grievance'
  AND NOT EXISTS (SELECT 1 FROM legal_sections x WHERE x.document_id = d.id);
