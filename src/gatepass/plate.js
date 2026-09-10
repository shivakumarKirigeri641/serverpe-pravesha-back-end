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
const BHARAT = /^(\d{2})(BH)(\d{4})([A-Z]{1,2})$/;

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
    return {
      ok: true,
      reg_no: reg,
      pretty: `${bh[1]} BH ${bh[3]} ${bh[4]}`,
      series: 'BH',
    };
  }

  const m = reg.match(STANDARD);
  if (!m) return { ok: false, reg_no: reg, reason: 'format' };
  if (!STATES.has(m[1])) return { ok: false, reg_no: reg, reason: 'state' };

  return {
    ok: true,
    reg_no: reg,
    pretty: [m[1], m[2], m[3], m[4]].filter(Boolean).join(' '),
    series: 'STANDARD',
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

module.exports = { normalise, parse, normaliseMobile };
