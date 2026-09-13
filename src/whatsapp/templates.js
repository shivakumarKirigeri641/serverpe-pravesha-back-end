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

const ENTRY_RECORDED = {
  en: { name: 'pv_checkpostentry_en_v2', language: 'en' },
  kn: { name: 'pv_checkpostentry_kn_v2', language: 'kn' },
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
    t.reg_no,                                    // {{2}} vehicle number
    L.vehicleType(t, lang),                      // {{3}} vehicle type
    t.ticket_no,                                 // {{4}} pass number
    L.placeWithDistrict(t, lang),                // {{5}} place of visit
    L.checkpostName(checkpost, lang) || na,      // {{6}} checkpost
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
const sendEntryRecorded = (to, t, opts, lang) => send.post(to, entryRecorded(t, opts, lang));

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

module.exports = {
  entryRecorded, entryRecordedParams, sendEntryRecorded, ENTRY_RECORDED,
  periodReport, sendPeriodReport, PERIOD_REPORT,
};
