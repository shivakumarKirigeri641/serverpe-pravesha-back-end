/**
 * rtoCodes.js — reading where a vehicle comes from off its number plate.
 *
 * WHAT IS RELIABLE, AND WHAT IS NOT. The first two letters of an Indian plate
 * are the state or union territory, and that never moves: KA is Karnataka
 * wherever the vehicle was bought. The two digits after it are the RTO office,
 * and those are neither stable nor publicly fixed — offices are split, renamed
 * and added. So the state is worked out here, from the plate; the district and
 * the office name are taken from the registration certificate when we have
 * fetched one, and shown as the bare code when we have not.
 *
 * Nothing here calls anything. It is a lookup table and two small functions.
 */

/* Every state and union territory code in use, and BH, the series that belongs
   to no state — a vehicle registered under it may be driven anywhere. */
const STATES = {
  AN: ['Andaman & Nicobar Islands', 'ut'],
  AP: ['Andhra Pradesh', 'state'],
  AR: ['Arunachal Pradesh', 'state'],
  AS: ['Assam', 'state'],
  BR: ['Bihar', 'state'],
  BH: ['Bharat series (no single state)', 'series'],
  CG: ['Chhattisgarh', 'state'],
  CH: ['Chandigarh', 'ut'],
  DD: ['Dadra & Nagar Haveli and Daman & Diu', 'ut'],
  DL: ['Delhi', 'ut'],
  DN: ['Dadra & Nagar Haveli', 'ut'],
  GA: ['Goa', 'state'],
  GJ: ['Gujarat', 'state'],
  HP: ['Himachal Pradesh', 'state'],
  HR: ['Haryana', 'state'],
  JH: ['Jharkhand', 'state'],
  JK: ['Jammu & Kashmir', 'ut'],
  KA: ['Karnataka', 'state'],
  KL: ['Kerala', 'state'],
  LA: ['Ladakh', 'ut'],
  LD: ['Lakshadweep', 'ut'],
  MH: ['Maharashtra', 'state'],
  ML: ['Meghalaya', 'state'],
  MN: ['Manipur', 'state'],
  MP: ['Madhya Pradesh', 'state'],
  MZ: ['Mizoram', 'state'],
  NL: ['Nagaland', 'state'],
  OD: ['Odisha', 'state'],
  OR: ['Odisha', 'state'],
  PB: ['Punjab', 'state'],
  PY: ['Puducherry', 'ut'],
  RJ: ['Rajasthan', 'state'],
  SK: ['Sikkim', 'state'],
  TG: ['Telangana', 'state'],
  TN: ['Tamil Nadu', 'state'],
  TR: ['Tripura', 'state'],
  TS: ['Telangana', 'state'],
  UK: ['Uttarakhand', 'state'],
  UA: ['Uttarakhand', 'state'],
  UP: ['Uttar Pradesh', 'state'],
  WB: ['West Bengal', 'state'],
};

/** The state or union territory a plate belongs to. */
function stateOf(regNo) {
  const code = String(regNo || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 2);
  const found = STATES[code];
  if (!found) return { code: code || '??', name: 'Not recognised', kind: 'unknown' };
  return { code, name: found[0], kind: found[1] };
}

/** The RTO code a plate carries — "KA31" — with no claim about its name. */
const rtoOf = (regNo) => String(regNo || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);

/**
 * The office, tidied, from an RC's own words.
 *
 * These arrive as "SIRSI  RTO, Karnataka" or "PUNJAB STA(RAC)/(AITP), Punjab":
 * an office, then the state. The state is already known from the plate, so only
 * the office is kept, with its double spaces and its trailing RTO taken off.
 */
function officeOf(registeredAt) {
  const raw = String(registeredAt || '').trim();
  if (!raw) return null;
  const office = raw.split(',')[0].replace(/\s+/g, ' ').replace(/\s+RTO$/i, '').trim();
  if (!office) return null;
  return office.replace(/\b[A-Z]{2,}\b/g, (w) => w.charAt(0) + w.slice(1).toLowerCase());
}

module.exports = { STATES, stateOf, rtoOf, officeOf };
