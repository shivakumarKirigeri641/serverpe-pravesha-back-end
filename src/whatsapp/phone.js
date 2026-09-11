/**
 * phone.js — one number, two spellings.
 *
 * The database stores ten digits and enforces it: customers and wa_sessions
 * both carry CHECK (mobile ~ '^[0-9]{10}$'). WhatsApp addresses the same person
 * as 919886122415, country code included, and will not accept anything else as
 * a recipient.
 *
 * Both spellings are therefore correct, in different places, and the conversion
 * lives here so that no caller has to remember which one it is holding. Getting
 * this wrong does not fail loudly: it creates a second customer row for the same
 * person, and their bookings stop being their bookings.
 */

/** As stored: ten digits, no country code. */
function toLocal(waNumber) {
  const digits = String(waNumber || '').replace(/\D/g, '');
  /* Take the last ten rather than stripping a leading 91 -- a number can
     legitimately contain 91 elsewhere, and the last ten digits are the
     subscriber number in every case we handle. */
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

/** As addressed: country code included, no plus. */
function toWa(local, cc = '91') {
  const digits = String(local || '').replace(/\D/g, '');
  if (digits.length > 10) return digits;
  return cc + digits;
}

/** Ten digits and starting like an Indian mobile. */
const isValid = (local) => /^[6-9][0-9]{9}$/.test(String(local || ''));

module.exports = { toLocal, toWa, isValid };
