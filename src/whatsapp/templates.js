/**
 * templates.js — approved WhatsApp templates, and the parameters that fill them.
 *
 * A template is how we reach a visitor outside WhatsApp's 24-hour window, and a
 * checkpost entry usually happens days after the booking conversation ended. So
 * the check-in message cannot be a free-form reply; it has to be one of these.
 *
 * ONE TEMPLATE PER LANGUAGE, NAMED SEPARATELY. The visitor chose English or
 * Kannada at the start, and they get the template written in that language with
 * every word-valued parameter in that language too — place, checkpost, date,
 * slot, vehicle type, status. Identifiers (plate, pass number) and the visitor's
 * own name go in as they are.
 *
 * PARAMETER ORDER IS THE CONTRACT WITH META. {{1}}..{{10}} must match the body
 * as approved, in both languages, or the send is rejected. They are built in
 * exactly one place for that reason.
 */

const L = require('../localize');
const send = require('./send');

/*
 * A VISITOR MUST NOT BE LEFT WITH NOTHING BECAUSE OF OUR PAPERWORK.
 *
 * Every template has to be created and approved in Meta's console before it can
 * be sent, and each language is a separate approval. Until a Kannada one is
 * through review, asking for it comes back as error 132001 — "Template name
 * does not exist in the translation" — and the visitor receives nothing at all.
 * Somebody who chose Kannada then walks through the barrier with no
 * confirmation, which is worse than reading it in English.
 *
 * So a template refused for that one reason is sent again in English. Only for
 * that reason: a wrong parameter count or a blocked number must keep failing
 * loudly rather than quietly sending a second message. Both attempts are in the
 * transcript, so the gap is visible for as long as it lasts — and the moment
 * review finishes, the first attempt succeeds and this never runs again.
 */
const NO_TRANSLATION = /132001|does not exist in the translation/i;

async function sendInLanguage(to, build, lang) {
  const first = await send.post(to, build(lang));
  if (first.ok || lang === 'en' || !NO_TRANSLATION.test(String(first.error || ''))) return first;

  console.warn('[wa] %s is not approved yet — sending the English one instead', build(lang).template?.name);
  const second = await send.post(to, build('en'));
  return { ...second, fellBackToEnglish: true, originalError: first.error };
}

const ENTRY_RECORDED = {
  en: { name: 'pv_checkpostentry_en_v2', language: 'en' },
  /* v3: v2 was registered with the wrong language (English), and a template's
     language cannot be changed after submission — so it was re-raised as v3. */
  kn: { name: 'pv_checkpostentry_kn_v3', language: 'kn' },
};

/**
 * The body parameters of the check-in template, in approved order.
 *
 * Meta rejects an empty parameter, so a pass without a slot sends the words for
 * "not applicable" rather than an empty string.
 */
function entryRecordedParams(t, { checkpost, recordedAt, statusKey = 'entry_recorded' }, lang) {
  const na = lang === 'kn' ? 'ಅನ್ವಯಿಸುವುದಿಲ್ಲ' : 'Not applicable';
  return [
    t.customer_name || t.wa_profile_name || (lang === 'kn' ? 'ಸಂದರ್ಶಕರೇ' : 'Visitor'), // {{1}} name
    /* {{2}} vehicle number — or, on a per-person pass (056), how many people:
       Meta rejects an empty parameter. */
    t.reg_no || (lang === 'kn' ? `${t.persons || 1} ಜನರು` : `${t.persons || 1} ${Number(t.persons) === 1 ? 'person' : 'persons'}`),
    L.vehicleType(t, lang),                      // {{3}} vehicle type
    t.ticket_no,                                 // {{4}} pass number
    L.placeWithDistrict(t, lang),                // {{5}} place of visit
    L.checkpostName(checkpost, lang, t) || na,   // {{6}} checkpost — Kannada even without name_kn
    L.longDate(t.travel_date, lang),             // {{7}} date of visit
    L.slotLabel(t, lang) || na,                  // {{8}} time slot
    L.dateTime(recordedAt, lang),                // {{9}} entry recorded at
    L.status(statusKey, lang),                   // {{10}} status
  ];
}

/** The full template payload, ready for the messages endpoint. */
function entryRecorded(t, opts, lang) {
  const tpl = ENTRY_RECORDED[lang === 'kn' ? 'kn' : 'en'];
  return {
    type: 'template',
    template: {
      name: tpl.name,
      language: { code: tpl.language },
      components: [
        { type: 'body', parameters: entryRecordedParams(t, opts, lang).map((text) => ({ type: 'text', text: String(text) })) },
        /* The URL button's fixed part is approved with the template; only the
           pass number is sent, and WhatsApp appends it. */
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: t.ticket_no }] },
      ],
    },
  };
}

/** Send it. Used by the checkpost view when an entry is recorded. */
const sendEntryRecorded = (to, t, opts, lang) =>
  sendInLanguage(to, (l) => entryRecorded(t, opts, l), lang);

/* ── The feedback request ───────────────────────────────────────────────── */

/**
 * "How was your visit?", sent after the entry-recorded message.
 *
 * A TEMPLATE, NOT A FREE MESSAGE, because the visitor is usually outside
 * WhatsApp's 24-hour window by the time they reach the gate — they booked the
 * night before — and a free message would simply not be delivered to exactly
 * the people most worth asking.
 *
 * ONE PER LANGUAGE, in the language the visitor chose. The place is sent in that
 * language too; the name is sent as they gave it.
 *
 * The button opens the rating page. Only the link's token is sent: the fixed
 * part of the URL is approved with the template and WhatsApp appends the token.
 *
 *   body   {{1}} visitor's name     {{2}} the place
 *   button {{1}} the rating token
 */
const FEEDBACK_REQUEST = {
  /* Named per language, the same way the entry templates are. */
  en: { name: 'pv_feedback_en_v1', language: 'en' },
  /* v3: v2 was recorded by Meta as MARKETING; v3 is the same message raised
     again as UTILITY (user, 2026-09-15). */
  kn: { name: 'pv_feedback_kn_v3', language: 'kn' },
};

function feedbackParams(t, lang) {
  return [
    t.customer_name || t.wa_profile_name || (lang === 'kn' ? 'ಸಂದರ್ಶಕರೇ' : 'Visitor'), // {{1}}
    L.placeName(t, lang),                                                             // {{2}}
  ];
}

function feedbackRequest(t, token, lang) {
  const tpl = FEEDBACK_REQUEST[lang === 'kn' ? 'kn' : 'en'];
  return {
    type: 'template',
    template: {
      name: tpl.name,
      language: { code: tpl.language },
      components: [
        { type: 'body', parameters: feedbackParams(t, lang).map((text) => ({ type: 'text', text: String(text) })) },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: token }] },
      ],
    },
  };
}

const sendFeedbackRequest = (to, t, token, lang) =>
  sendInLanguage(to, (l) => feedbackRequest(t, token, l), lang);

/* ── The period report ──────────────────────────────────────────────────── */

/**
 * The daily, weekly or monthly report, as approved.
 *
 * ONE TEMPLATE FOR THREE PERIODS. Which period it is rides in the header, so
 * there is one registration to keep approved rather than three that can drift
 * apart. No buttons: this is a statement, not a conversation.
 *
 * THE HEADER AND THE BODY NUMBER THEIR VARIABLES SEPARATELY — the header's
 * {{1}} is "daily", the body's {{1}} is the date — which is why the report
 * hands them over as two lists and they are kept apart all the way here. Merge
 * them anywhere along the way and the month appears in the vehicle count.
 */
const PERIOD_REPORT = { name: 'pv_checkpostreport_v1', language: 'en' };

function periodReport({ header, body }) {
  return {
    type: 'template',
    template: {
      name: PERIOD_REPORT.name,
      language: { code: PERIOD_REPORT.language },
      components: [
        { type: 'header', parameters: header.map((text) => ({ type: 'text', text: String(text) })) },
        { type: 'body', parameters: body.map((text) => ({ type: 'text', text: String(text) })) },
      ],
    },
  };
}

/**
 * Send one report to one number.
 *
 * Deliberately takes a number rather than a list: who receives this is a
 * decision about money and it belongs with whoever is choosing the recipients,
 * not buried in a fan-out loop here.
 */
const sendPeriodReport = (to, vars) => send.post(to, periodReport(vars));

/* ── A notice about a pass: a slot closed or changed on the day ────────────── */

/**
 * "An update about your pass", sent when a slot is closed from live monitoring.
 *
 * A TEMPLATE, because the people it is for booked days ago and are outside the
 * 24-hour window; a free message would reach only the few who wrote recently.
 * Until Meta approves it, the sender falls back to a chat message for those few
 * and counts the rest as not reached — nothing needs switching when it is
 * approved.
 *
 * WHAT THE OFFICE WROTE GOES IN AS ONE PARAMETER, in the visitor's language when
 * a Kannada version was written. WhatsApp refuses a parameter with a line break
 * or a run of spaces, so it is flattened here.
 *
 *   body {{1}} name  {{2}} pass number  {{3}} place  {{4}} date  {{5}} slot  {{6}} the notice
 */
const SLOT_NOTICE = {
  en: { name: 'pv_slotnotice_en_v1', language: 'en' },
  kn: { name: 'pv_slotnotice_kn_v1', language: 'kn' },
};

const flat = (s) => String(s || '').replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim().slice(0, 700);

function slotNoticeParams(t, notice, lang) {
  return [
    t.customer_name || t.wa_profile_name || (lang === 'kn' ? 'ಸಂದರ್ಶಕರೇ' : 'Visitor'), // {{1}}
    t.ticket_no,                                                                      // {{2}}
    L.placeName(t, lang),                                                             // {{3}}
    L.longDate(t.travel_date, lang),                                                  // {{4}}
    L.slotLabel(t, lang) || (lang === 'kn' ? 'ಅನ್ವಯಿಸುವುದಿಲ್ಲ' : 'Not applicable'),  // {{5}}
    flat(notice),                                                                     // {{6}}
  ];
}

function slotNotice(t, notice, lang) {
  const tpl = SLOT_NOTICE[lang === 'kn' ? 'kn' : 'en'];
  return {
    type: 'template',
    template: {
      name: tpl.name,
      language: { code: tpl.language },
      components: [
        { type: 'body', parameters: slotNoticeParams(t, notice, lang).map((text) => ({ type: 'text', text: String(text) })) },
      ],
    },
  };
}

const sendSlotNotice = (to, t, notice, lang) =>
  sendInLanguage(to, (l) => slotNotice(t, notice, l), lang);

module.exports = {
  sendInLanguage,
  entryRecorded, entryRecordedParams, sendEntryRecorded, ENTRY_RECORDED,
  feedbackRequest, feedbackParams, sendFeedbackRequest, FEEDBACK_REQUEST,
  periodReport, sendPeriodReport, PERIOD_REPORT,
  slotNotice, slotNoticeParams, sendSlotNotice, SLOT_NOTICE,
};
