/**
 * config/paths.js — the public URL prefix, in one place.
 *
 * The other ServerPe services use a long, explicit prefix rather than a bare
 * "/webhook": these URLs are pasted into Meta and Razorpay dashboards and live
 * there for years, so they say plainly which platform, which product and which
 * version is being addressed. A short path is easy to type once and impossible
 * to identify later when four products share a domain.
 *
 * Customer-facing links are deliberately NOT under this prefix. A ticket
 * payment link is read aloud, typed, and tapped on a phone with one bar of
 * signal — /pay/<token> earns its shortness.
 */

/* The middle segment is the product, matching its siblings:
     .../platform/quizpe/...   .../platform/gaadipe/...   .../platform/pravesha/...
   The first segment is the company and stays as it is. */
const PREFIX = '/serverpe/platform/pravesha/v1/public/users';

/* The public page for one pass: what the QR on the PDF and the button in the
   check-in message open. Read as a sentence -- whose service, what it is, what
   the page does -- because it is printed on a pass and shown to a visitor, and a
   bare /v/ looks like a shortener nobody should trust with a government pass.
   The pass number follows it; /v/<pass> is kept as an alias so passes already
   issued keep working. */
const PASS_DETAILS_PATH = '/karnataka-tourism/entry-pass/verify';

module.exports = { PREFIX, PASS_DETAILS_PATH };
