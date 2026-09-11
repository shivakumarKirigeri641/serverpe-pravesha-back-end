/**
 * plate.js — one vehicle, one stored string.
 *
 * People type "ka 31 n 8147", "KA31-N-8147", "ka31n8147" and "KA.31.N.8147"
 * for the same vehicle. All of them must become one row, because the rule that
 * one vehicle books once per day is worthless if two spellings are two
 * vehicles.
 *
 * Validation is deliberately shaped, not merely "letters and digits": a typo
 * that still looks like a plate would otherwise be accepted, sold a ticket, and
 * discovered at the gate.
 */

// Normal Indian civilian format: KA 31 N 8147 — state, district, series
// (0-3 letters), number (1-4 digits).
const STANDARD = /^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/;

// Bharat series: 22 BH 1234 AA — year, BH, number, series.
// One to four digits accepted and padded to four, for the same reason as the
// standard format below: the scheme numbers from 0001 and a visitor typing the
// number off their RC book will leave the leading zeros off.
const BHARAT = /^(\d{2})(BH)(\d{1,4})([A-Z]{1,2})$/;

/*
 * Pre-1989 plates: MYE 3033, MYS 505, CNC 1234 — three letters and up to four
 * digits, from before the present state-district scheme.
 *
 * These are not a curiosity. An old jeep or a farm vehicle from Chikkamagaluru
 * district that has never been re-registered still carries one, still drives up
 * to Mullayanagiri, and was being turned away by the format check with "that
 * does not look like a vehicle number" — which, to the person holding a valid
 * RC book, is simply wrong.
 *
 * The pattern is loose by necessity: the old series codes were issued by
 * regional offices that no longer exist and were never published as a list we
 * could check against, so there is nothing to validate the three letters
 * against. That is a deliberate trade. The cost of being loose is that a
 * three-letter typo could be accepted; the cost of being strict is refusing a
 * genuine vehicle at the point of sale. The first is caught at the gate by an
 * officer reading the plate; the second loses a visitor.
 */
const LEGACY = /^([A-Z]{3})(\d{1,4})$/;

/**
 * Pad the number to four digits: KA01M1 -> KA01M0001.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS. The number on an Indian plate is four
 * digits, issued from 0001, and it is written both ways in the wild — the RC
 * book and VAHAN carry KA01M0001, the bumper may be painted KA01M1, and the
 * owner will type whichever they are looking at.
 *
 * Without one canonical form those are two different strings, and three things
 * break at once:
 *
 *   THE ONE-TICKET RULE. The unique index is on (vehicle_id, travel_date). Book
 *   once as KA01M1 and once as KA01M0001 and the database sees two vehicles, so
 *   one car holds two tickets for one day — the exact thing the index exists to
 *   prevent.
 *
 *   THE RC LOOKUP. VAHAN is asked for the string we hold. The unpadded form
 *   misses, the vehicle comes back unclassified, and a car is charged as
 *   whatever the visitor then picks.
 *
 *   THE GATE. Entry is now a trailing match on the plate: the staff member
 *   reads the last four characters and types them. "0001" does not match a
 *   stored "KA01M1", so a genuine visitor is told they have no booking while
 *   they are sitting at the barrier holding their phone.
 *
 * NOT APPLIED TO THE OLD SERIES. A pre-1989 plate really was issued as MYE 505,
 * three digits, and padding it would invent a registration number that has
 * never existed. Those plates are canonical exactly as they are written.
 */
const pad4 = (n) => String(n).padStart(4, '0');

/**
 * A temporary registration: KA 01 TR 1234.
 *
 * Issued by the dealer under Rule 43 while the permanent number is processed,
 * valid about a month, and — the part that matters here — NOT in the public
 * registration lookup. A brand new car genuinely cannot be classified from the
 * database, however well the system is working.
 *
 * Worth telling apart from any other miss, because the two need different
 * words. "We have no record of this vehicle" sounds like an accusation to
 * somebody who bought the car last Tuesday; "temporary registrations are not in
 * the database yet" is simply true, and it is also the honest reason the
 * visitor is being asked to name the vehicle type themselves.
 *
 * TR only in the series position: a plate like KA01TR1234 is temporary, while
 * KA01T1234 is an ordinary series that happens to start with T.
 */
const isTemporary = (reg) => /^[A-Z]{2}\d{1,2}TR\d{1,4}$/.test(String(reg || ''));

// The 37 valid registering authorities. A plate starting with "KH" is a typo,
// not a state, and catching it here is far cheaper than catching it at a gate
// three hundred kilometres away.
const STATES = new Set([
  'AN','AP','AR','AS','BR','CG','CH','DD','DL','DN','GA','GJ','HP','HR','JH',
  'JK','KA','KL','LA','LD','MH','ML','MN','MP','MZ','NL','OD','OR','PB','PY',
  'RJ','SK','TN','TR','TS','UK','UA','UP','WB',
]);

/** Strip everything that is not a letter or digit, and upper-case the rest. */
function normalise(input) {
  return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Returns { ok, reg_no, pretty, reason }.
 *
 * `pretty` is the spaced form to echo back for confirmation — showing the
 * person the plate as it appears on their bumper is what makes a typo visible
 * before money changes hands.
 */
function parse(input) {
  const reg = normalise(input);

  if (!reg) return { ok: false, reason: 'empty' };
  if (reg.length < 5 || reg.length > 11) return { ok: false, reg_no: reg, reason: 'length' };

  const bh = reg.match(BHARAT);
  if (bh) {
    const canon = `${bh[1]}BH${pad4(bh[3])}${bh[4]}`;
    return {
      ok: true,
      reg_no: canon,
      pretty: `${bh[1]} BH ${pad4(bh[3])} ${bh[4]}`,
      series: 'BH',
    };
  }

  /* Tried after the modern format, never before it: "KA31N8147" cannot match
     LEGACY, but keeping the order explicit means a future widening of one
     pattern cannot start swallowing the other's plates. */
  const m = reg.match(STANDARD);
  if (!m) {
    const old = reg.match(LEGACY);
    if (old) {
      return {
        ok: true,
        reg_no: reg,
        pretty: `${old[1]} ${old[2]}`,
        series: 'LEGACY',
        /* A plate this old is unlikely to be in the RC database, so the caller
           has to be ready to ask the visitor what the vehicle is rather than
           charging them the fallback rate. Saying so here means the booking
           page does not have to infer it from an empty lookup. */
        legacy: true,
      };
    }
    return { ok: false, reg_no: reg, reason: 'format' };
  }
  if (!STATES.has(m[1])) return { ok: false, reg_no: reg, reason: 'state' };

  /* Rebuilt from the parts rather than returned as typed, so the stored string
     is the canonical one whichever way the visitor wrote it. */
  const canon = `${m[1]}${m[2]}${m[3]}${pad4(m[4])}`;
  const temporary = isTemporary(canon);
  return {
    ok: true,
    reg_no: canon,
    pretty: [m[1], m[2], m[3], pad4(m[4])].filter(Boolean).join(' '),
    series: temporary ? 'TEMP' : 'STANDARD',
    /* Like `legacy`, this tells the booking page to expect the lookup to come
       back empty and to ask rather than to treat it as a fault. */
    temporary,
  };
}

/** Ten digits, no country code, so one person is never two customers. */
function normaliseMobile(input) {
  const d = String(input || '').replace(/\D/g, '');
  if (d.length === 10) return d;
  if (d.length === 12 && d.startsWith('91')) return d.slice(2);
  if (d.length === 11 && d.startsWith('0')) return d.slice(1);
  return null;
}

module.exports = { normalise, parse, normaliseMobile, isTemporary };
