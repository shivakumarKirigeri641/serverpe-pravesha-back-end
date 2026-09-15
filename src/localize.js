/**
 * localize.js — the facts on a pass, in the visitor's language.
 *
 * i18n.js holds the labels ("Date of visit"). This holds the values that go
 * beside them — the place, the district, the slot, the vehicle type, the date,
 * the time — because a Kannada message with English values in it reads worse
 * than either language alone.
 *
 * Names come from the *_kn columns (023_kannada_names.sql), so a destination the
 * department adds brings its Kannada name with it. A missing translation falls
 * back to English rather than to a blank, which would be worse in a message the
 * visitor cannot reply to — except where a Kannada name can be built from facts
 * that ARE translated, as the checkpost name is below.
 *
 * Identifiers are never translated: the plate and the pass number are written
 * the same way on the vehicle, the pass and the checkpost screen.
 */

const ZONE = 'Asia/Kolkata';
const pick = (lang, kn, en) => (lang === 'kn' && kn ? kn : en);

const TYPE_EN = { BIKE: 'Bike', CAR: 'Car', TOOFAN: 'Toofan', TT: 'Tempo Traveller (TT)' };

const placeName = (t, lang) => pick(lang, t.place_name_kn, t.place_name);
const district = (t, lang) => pick(lang, t.district_kn, t.district);
const state = (lang) => pick(lang, 'ಕರ್ನಾಟಕ', 'Karnataka');
const placeWithDistrict = (t, lang) => `${placeName(t, lang)}, ${district(t, lang)}`;
const slotLabel = (t, lang) => pick(lang, t.slot_label_kn, t.slot_label);
const vehicleType = (t, lang) => pick(lang, t.category_label_kn, TYPE_EN[t.category_code] || t.category_label);
/*
 * A checkpost, in the visitor's language.
 *
 * Checkposts are added by the department and rarely come with a Kannada name,
 * so this used to fall back to English — which put "Mullayanagiri Main Gate" in
 * the middle of an otherwise Kannada message. When no Kannada name is stored but
 * the place's is, the gate is named from that: "ಮುಳ್ಳಯ್ಯನಗಿರಿ ಚೆಕ್‌ಪೋಸ್ಟ್". That
 * is built only from words already translated, never invented. A proper name set
 * in the panel still wins.
 */
const checkpostName = (cp, lang, t = null) => {
  if (!cp) return '';
  if (lang !== 'kn') return cp.name;
  if (cp.name_kn) return cp.name_kn;
  if (t && t.place_name_kn) return `${t.place_name_kn} ಚೆಕ್‌ಪೋಸ್ಟ್`;
  return cp.name;
};

/** "Saturday, 12 Sep 2026" / "ಶನಿವಾರ, 12 ಸೆಪ್ಟೆಂಬರ್ 2026" from a DATE. */
function longDate(yyyyMmDd, lang = 'en') {
  const [y, m, d] = String(yyyyMmDd).slice(0, 10).split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  if (lang !== 'kn') {
    return at.toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });
  }
  /* kn-IN puts the month before the day ("ಸೆಪ್ಟೆಂಬರ್ 12, 2026"). Rebuilt from
     parts so both languages read day-month-year, the way dates are written in
     Karnataka. */
  const p = Object.fromEntries(new Intl.DateTimeFormat('kn-IN', {
    timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).formatToParts(at).map((x) => [x.type, x.value]));
  return `${p.weekday}, ${p.day} ${p.month} ${p.year}`;
}

/**
 * "Sat, 12 Sep" / "ಶನಿ, 12 ಸೆಪ್ಟೆಂ" from a DATE — the short form a date list
 * or a one-line refusal needs, day before month in both languages.
 */
function shortDate(yyyyMmDd, lang = 'en') {
  const [y, m, d] = String(yyyyMmDd).slice(0, 10).split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  if (lang !== 'kn') {
    return at.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  }
  const p = Object.fromEntries(new Intl.DateTimeFormat('kn-IN', {
    timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short',
  }).formatToParts(at).map((x) => [x.type, x.value]));
  return `${p.weekday}, ${p.day} ${p.month}`;
}

/**
 * "12 Sep 2026, 12:42 PM IST" / "12 ಸೆಪ್ಟೆಂಬರ್ 2026, ಮಧ್ಯಾಹ್ನ 12:42".
 *
 * Kannada does not say AM and PM; it says which part of the day. kn-IN's own
 * formatter still prints "PM", so the period word is chosen here.
 */
function dateTime(ts, lang = 'en') {
  if (!ts) return '—';
  const at = new Date(ts);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONE, day: 'numeric', month: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: false,
  }).formatToParts(at).map((x) => [x.type, x.value]));
  const h = Number(p.hour) % 24;
  const mm = p.minute;

  if (lang !== 'kn') {
    const s = at.toLocaleString('en-IN', { timeZone: ZONE, day: '2-digit', month: 'short', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true });
    return `${s.replace(/\bam\b/i, 'AM').replace(/\bpm\b/i, 'PM')} IST`;
  }

  const month = new Intl.DateTimeFormat('kn-IN', { timeZone: ZONE, month: 'long' }).format(at);
  const period = h >= 5 && h < 12 ? 'ಬೆಳಿಗ್ಗೆ' : h >= 12 && h < 16 ? 'ಮಧ್ಯಾಹ್ನ' : h >= 16 && h < 19 ? 'ಸಂಜೆ' : 'ರಾತ್ರಿ';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${Number(p.day)} ${month} ${p.year}, ${period} ${h12}:${mm}`;
}

/** Last entry, "17:00" / "ಸಂಜೆ 5:00". */
function clock(hhmm, lang = 'en') {
  if (lang !== 'kn') return hhmm;
  const [h, m] = String(hhmm).split(':').map(Number);
  const period = h >= 5 && h < 12 ? 'ಬೆಳಿಗ್ಗೆ' : h >= 12 && h < 16 ? 'ಮಧ್ಯಾಹ್ನ' : h >= 16 && h < 19 ? 'ಸಂಜೆ' : 'ರಾತ್ರಿ';
  return `${period} ${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')}`;
}

const STATUS = {
  entry_recorded: { en: 'Entry recorded', kn: 'ಪ್ರವೇಶ ದಾಖಲಾಗಿದೆ' },
};
const status = (key, lang) => (STATUS[key] ? pick(lang, STATUS[key].kn, STATUS[key].en) : key);

/* The people on a per-person pass (056), in the reader's language. */
const persons = (n, lang) => {
  const k = Math.max(1, Number(n) || 1);
  return lang === 'kn' ? `${k} ಜನರು` : `${k} ${k === 1 ? 'person' : 'persons'}`;
};

module.exports = {
  placeName, district, state, placeWithDistrict, slotLabel, vehicleType, checkpostName,
  longDate, shortDate, dateTime, clock, status, persons,
};
