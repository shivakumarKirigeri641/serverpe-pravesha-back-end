/**
 * personBookingPage.js — the booking form for a per-person destination (056).
 *
 * WHY A SEPARATE, SHORTER FORM. The vehicle form exists to identify a vehicle:
 * a plate, a registration lookup, a type that decides the price and the pool.
 * A per-person destination has none of that. The visitor chooses a date and how
 * many people are coming — one to the destination's limit, ten at Nandi Hills —
 * sees the price, and pays. Folding that into the vehicle form would put a
 * number plate field in front of people who are not bringing a vehicle.
 *
 * THE PRICE. The entry fee is per person; the platform fee is per pass (₹10 each
 * and ₹5 for the pass, user 2026-09-15). Both come from place_pricing for the
 * PERSON category, so a price change in the database is the price shown here.
 *
 * NOTHING ON THE PAGE IS TRUSTED. The count, the date and the place are checked
 * again when the visitor continues, and the hold claims the places inside the
 * same transaction that checks the capacity — two people booking the last seats
 * cannot both get them.
 */

const crypto = require('crypto');
const { one, query } = require('../gatepass/db');
const places = require('../gatepass/places');
const pricing = require('../gatepass/pricing');
const inventory = require('../gatepass/inventory');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const COPY = {
  en: {
    title: 'Book your entry pass',
    date: 'Date of visit',
    people: 'Number of people',
    upTo: (n) => `Up to ${n} people on one pass`,
    left: (n) => `${n} places left for this date`,
    full: 'This date is fully booked. Please choose another date.',
    closed: 'Bookings for this date have closed. Please choose another date.',
    checking: 'Checking places…',
    entry: (n, each) => `Entry fee · ${n} × ₹${each}`,
    platform: 'Platform fee (per pass, GST included)',
    total: 'Total payable',
    cont: (a) => `Continue to pay ₹${a}`,
    working: 'Holding your places…',
    noDates: 'No dates are open for booking right now.',
    placeUnavailable: 'Bookings for this destination are not open.',
    personsInvalid: (max) => `Choose between 1 and ${max} people.`,
    dateInvalid: 'That date can no longer be booked. Please choose another date.',
    soldOut: 'Those places have just been booked. Please choose fewer people or another date.',
    onlyLeft: (n) => (n > 0 ? `Only ${n} places are left for this date.` : 'This date is fully booked.'),
    noPrice: 'No fee is set for this destination yet.',
    cantHold: 'We could not hold your places just now. Please try again.',
    showPass: 'At the checkpost, show your pass number. Staff confirm how many of you are entering.',
    serverError: 'Something went wrong. Please try again.',
  },
  kn: {
    title: 'ಪ್ರವೇಶ ಪಾಸ್ ಕಾಯ್ದಿರಿಸಿ',
    date: 'ಭೇಟಿಯ ದಿನಾಂಕ',
    people: 'ಜನರ ಸಂಖ್ಯೆ',
    upTo: (n) => `ಒಂದು ಪಾಸ್‌ನಲ್ಲಿ ಗರಿಷ್ಠ ${n} ಜನರು`,
    left: (n) => `ಈ ದಿನಾಂಕಕ್ಕೆ ${n} ಸ್ಥಾನಗಳು ಬಾಕಿ`,
    full: 'ಈ ದಿನಾಂಕದ ಎಲ್ಲಾ ಸ್ಥಾನಗಳು ಭರ್ತಿಯಾಗಿವೆ. ಬೇರೆ ದಿನಾಂಕ ಆಯ್ಕೆಮಾಡಿ.',
    closed: 'ಈ ದಿನಾಂಕದ ಬುಕಿಂಗ್ ಮುಗಿದಿದೆ. ಬೇರೆ ದಿನಾಂಕ ಆಯ್ಕೆಮಾಡಿ.',
    checking: 'ಸ್ಥಾನಗಳನ್ನು ಪರಿಶೀಲಿಸಲಾಗುತ್ತಿದೆ…',
    entry: (n, each) => `ಪ್ರವೇಶ ಶುಲ್ಕ · ${n} × ₹${each}`,
    platform: 'ಪ್ಲಾಟ್‌ಫಾರ್ಮ್ ಶುಲ್ಕ (ಪ್ರತಿ ಪಾಸ್‌ಗೆ, GST ಸೇರಿ)',
    total: 'ಒಟ್ಟು ಪಾವತಿ',
    cont: (a) => `₹${a} ಪಾವತಿಸಲು ಮುಂದುವರಿಯಿರಿ`,
    working: 'ನಿಮ್ಮ ಸ್ಥಾನಗಳನ್ನು ಕಾಯ್ದಿರಿಸಲಾಗುತ್ತಿದೆ…',
    noDates: 'ಈಗ ಬುಕಿಂಗ್‌ಗೆ ಯಾವುದೇ ದಿನಾಂಕ ಲಭ್ಯವಿಲ್ಲ.',
    placeUnavailable: 'ಈ ಸ್ಥಳಕ್ಕೆ ಬುಕಿಂಗ್ ತೆರೆದಿಲ್ಲ.',
    personsInvalid: (max) => `1 ರಿಂದ ${max} ಜನರವರೆಗೆ ಆಯ್ಕೆಮಾಡಿ.`,
    dateInvalid: 'ಆ ದಿನಾಂಕವನ್ನು ಈಗ ಬುಕ್ ಮಾಡಲಾಗದು. ಬೇರೆ ದಿನಾಂಕ ಆಯ್ಕೆಮಾಡಿ.',
    soldOut: 'ಆ ಸ್ಥಾನಗಳು ಈಗಷ್ಟೇ ಬುಕ್ ಆಗಿವೆ. ಕಡಿಮೆ ಜನರನ್ನು ಅಥವಾ ಬೇರೆ ದಿನಾಂಕ ಆಯ್ಕೆಮಾಡಿ.',
    onlyLeft: (n) => (n > 0 ? `ಈ ದಿನಾಂಕಕ್ಕೆ ಕೇವಲ ${n} ಸ್ಥಾನಗಳು ಬಾಕಿ.` : 'ಈ ದಿನಾಂಕದ ಎಲ್ಲಾ ಸ್ಥಾನಗಳು ಭರ್ತಿಯಾಗಿವೆ.'),
    noPrice: 'ಈ ಸ್ಥಳಕ್ಕೆ ಇನ್ನೂ ಶುಲ್ಕ ನಿಗದಿಯಾಗಿಲ್ಲ.',
    cantHold: 'ಈಗ ನಿಮ್ಮ ಸ್ಥಾನಗಳನ್ನು ಕಾಯ್ದಿರಿಸಲಾಗಲಿಲ್ಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
    showPass: 'ಚೆಕ್‌ಪೋಸ್ಟ್‌ನಲ್ಲಿ ನಿಮ್ಮ ಪಾಸ್ ಸಂಖ್ಯೆಯನ್ನು ತೋರಿಸಿ. ಸಿಬ್ಬಂದಿ ಪ್ರವೇಶಿಸುವವರ ಸಂಖ್ಯೆಯನ್ನು ದೃಢೀಕರಿಸುತ್ತಾರೆ.',
    serverError: 'ಏನೋ ತಪ್ಪಾಗಿದೆ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
  },
};
const copyOf = (lang) => COPY[lang === 'kn' ? 'kn' : 'en'];

/** The one category per-person passes use; chosen by per_person, never by is_active (see 056). */
const personCategory = () => one(`SELECT id FROM vehicle_categories WHERE per_person ORDER BY id LIMIT 1`);

const slotsOf = async (place) => {
  const full = (await places.list()).find((p) => String(p.id) === String(place.id));
  return full ? full.slots : [];
};

/** Places left on a date: the day's first bookable pool at this destination. */
async function availability({ placeId, travelDate }) {
  const place = await places.byId(placeId);
  if (!place || !place.is_active || place.booking_mode !== 'person') return { ok: false, error: 'place_unavailable' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(travelDate || ''))) return { ok: false, error: 'date_invalid' };
  const cat = await personCategory();
  if (!cat) return { ok: false, error: 'not_configured' };
  const pools = await inventory.forDate(place.id, cat.id, travelDate);
  const open = pools.find((s) => s.bookable);
  if (open) return { ok: true, bookable: true, remaining: open.remaining };
  const any = pools[0];
  return { ok: true, bookable: false, remaining: any ? any.remaining : 0, reason: any && any.timeClosed ? 'closed' : 'full' };
}

async function pageFor({ token, customer, place, lang }) {
  const C = copyOf(lang);
  const cat = await personCategory();
  const price = cat ? await pricing.forPlaceCategory(place.id, cat.id) : null;
  const dates = await places.bookableDates(place, await slotsOf(place));
  const max = Number(place.max_persons_per_pass) || 10;
  const each = price ? price.entryPaise / 100 : 0;
  const platform = price ? price.platformPaise / 100 : 0;
  const placeName = lang === 'kn' && place.name_kn ? place.name_kn : place.name;
  const district = lang === 'kn' && place.district_kn ? place.district_kn : place.district;
  const name = (customer && (customer.name || customer.wa_profile_name)) || '';

  const dateOpts = dates.map((d) =>
    `<option value="${esc(d.value)}">${esc(lang === 'kn' && d.labelKn ? d.labelKn : d.label)}</option>`).join('');

  const cfg = {
    token, placeId: String(place.id), max, each, platform,
    t: {
      left: C.left('{n}'), full: C.full, closed: C.closed, checking: C.checking,
      entry: C.entry('{n}', '{each}'), cont: C.cont('{a}'), working: C.working, serverError: C.serverError,
    },
  };

  return `<!doctype html><html lang="${lang === 'kn' ? 'kn' : 'en'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(C.title)} · ${esc(placeName)}</title>
<style>
:root{--brand:#075e54;--brand2:#128c7e;--ink:#111b21;--muted:#667781;--line:#e9edef;--bg:#efeae2}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Nirmala UI",sans-serif}
.wrap{max-width:480px;margin:0 auto;padding-bottom:28px}
header{background:var(--brand);color:#fff;padding:18px 20px}
header h1{margin:0;font-size:19px}header p{margin:4px 0 0;font-size:13px;opacity:.85}
.card{background:#fff;border:1px solid var(--line);border-radius:14px;margin:14px;padding:16px}
label{display:block;font-size:13px;color:var(--muted);margin:0 0 6px}
select{width:100%;font:inherit;padding:12px;border:1px solid var(--line);border-radius:10px;background:#fff}
.hint{font-size:13px;color:var(--muted);margin:8px 0 0}.warn{color:#b45309}.bad{color:#b91c1c}
.stepper{display:flex;align-items:center;gap:12px}
.stepper button{width:52px;height:52px;border-radius:12px;border:1px solid var(--line);background:#f7f8fa;font-size:26px;font-weight:700;color:var(--brand)}
.stepper button:disabled{opacity:.35}
.count{flex:1;text-align:center;font-size:30px;font-weight:800}
.row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line);font-size:15px}
.row:last-child{border-bottom:0}.row.total{font-weight:800;font-size:17px}
.cta{display:block;width:calc(100% - 28px);margin:6px 14px 0;padding:16px;border:0;border-radius:12px;background:var(--brand2);color:#fff;font:700 17px/1 inherit}
.cta:disabled{background:#9fb7b3}
.msg{margin:12px 14px 0;padding:12px 14px;border-radius:10px;background:#fdeaea;color:#b91c1c;font-size:14px;display:none}
.note{margin:12px 18px 0;font-size:13px;color:var(--muted);text-align:center}
</style></head><body><div class="wrap">
<header><h1>${esc(placeName)}</h1><p>${esc(district || '')}${name ? ` · ${esc(name)}` : ''}</p></header>

${dates.length ? `
<div class="card">
  <label for="date">${esc(C.date)}</label>
  <select id="date">${dateOpts}</select>
  <p class="hint" id="left">${esc(C.checking)}</p>
</div>

<div class="card">
  <label>${esc(C.people)}</label>
  <div class="stepper">
    <button type="button" id="minus" aria-label="−">−</button>
    <div class="count" id="count">1</div>
    <button type="button" id="plus" aria-label="+">+</button>
  </div>
  <p class="hint">${esc(C.upTo(max))}</p>
</div>

<div class="card">
  <div class="row"><span id="entryLabel"></span><span id="entryAmt"></span></div>
  <div class="row"><span>${esc(C.platform)}</span><span>₹${esc(platform)}</span></div>
  <div class="row total"><span>${esc(C.total)}</span><span id="total"></span></div>
</div>

<div class="msg" id="msg"></div>
<button class="cta" id="go" type="button" disabled></button>
<p class="note">${esc(C.showPass)}</p>` : `<div class="card"><p>${esc(C.noDates)}</p></div>`}
</div>
<script>
(function () {
  var cfg = ${JSON.stringify(cfg).replace(/</g, '\\u003c')};
  var el = function (id) { return document.getElementById(id); };
  if (!el('date')) return;
  var n = 1, left = null, bookable = false, busy = false;
  var fill = function (s, v) { return s.replace(/\\{(\\w+)\\}/g, function (_, k) { return v[k]; }); };
  var money = function (x) { return (Math.round(x * 100) / 100).toString(); };

  function post(path, body) {
    return fetch('/book/' + encodeURIComponent(cfg.token) + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }
  function show(text) { var m = el('msg'); m.textContent = text || ''; m.style.display = text ? 'block' : 'none'; }

  function draw() {
    el('count').textContent = n;
    el('minus').disabled = n <= 1 || busy;
    var cap = Math.min(cfg.max, left === null ? cfg.max : Math.max(left, 1));
    el('plus').disabled = n >= cap || busy;
    el('entryLabel').textContent = fill(cfg.t.entry, { n: n, each: money(cfg.each) });
    el('entryAmt').textContent = '₹' + money(n * cfg.each);
    var total = n * cfg.each + cfg.platform;
    el('total').textContent = '₹' + money(total);
    el('go').textContent = busy ? cfg.t.working : fill(cfg.t.cont, { a: money(total) });
    el('go').disabled = busy || !bookable || (left !== null && n > left);
  }

  function check() {
    left = null; bookable = false; el('left').className = 'hint'; el('left').textContent = cfg.t.checking; draw();
    post('/people/availability', { placeId: cfg.placeId, travelDate: el('date').value }).then(function (a) {
      if (!a || !a.ok) { el('left').textContent = cfg.t.serverError; el('left').className = 'hint bad'; return; }
      left = a.remaining; bookable = a.bookable && a.remaining > 0;
      if (!a.bookable) { el('left').textContent = a.reason === 'closed' ? cfg.t.closed : cfg.t.full; el('left').className = 'hint bad'; }
      else { el('left').textContent = fill(cfg.t.left, { n: a.remaining }); el('left').className = a.remaining <= 20 ? 'hint warn' : 'hint'; }
      if (left !== null && n > Math.max(left, 1)) n = Math.max(1, Math.min(n, left));
      draw();
    }).catch(function () { el('left').textContent = cfg.t.serverError; el('left').className = 'hint bad'; });
  }

  el('minus').onclick = function () { if (n > 1) { n--; show(''); draw(); } };
  el('plus').onclick = function () { if (n < cfg.max) { n++; show(''); draw(); } };
  el('date').onchange = function () { show(''); check(); };
  el('go').onclick = function () {
    if (busy) return;
    busy = true; show(''); draw();
    post('/people/confirm', { placeId: cfg.placeId, travelDate: el('date').value, persons: n }).then(function (r) {
      if (r && r.ok && r.payUrl) { window.location.href = r.payUrl; return; }
      busy = false; show((r && r.message) || cfg.t.serverError); check();
    }).catch(function () { busy = false; show(cfg.t.serverError); draw(); });
  };
  draw(); check();
})();
</script></body></html>`;
}

/** Continue: re-check the place, date, count and places left, then hold and hand over to payment. */
async function confirm({ token, customer, lang, placeId, travelDate, persons }) {
  const C = copyOf(lang);
  const fail = (error, message) => ({ ok: false, error, message });
  const booking = require('../gatepass/booking');
  const checkout = require('../gatepass/checkout');

  const place = await places.byId(placeId);
  if (!place || !place.is_active || place.booking_mode !== 'person') return fail('place_unavailable', C.placeUnavailable);

  const max = Number(place.max_persons_per_pass) || 10;
  const n = Math.floor(Number(persons));
  if (!Number.isFinite(n) || n < 1 || n > max) return fail('persons_invalid', C.personsInvalid(max));

  const allowed = (await places.bookableDates(place, await slotsOf(place))).map((d) => d.value);
  if (!allowed.includes(String(travelDate))) return fail('date_invalid', C.dateInvalid);

  const cat = await personCategory();
  if (!cat) return fail('not_configured', C.cantHold);
  const pools = await inventory.forDate(place.id, cat.id, travelDate);
  const pool = pools.find((s) => s.bookable);
  if (!pool) return fail('sold_out', C.onlyLeft(0));
  if (pool.remaining < n) return fail('sold_out', C.onlyLeft(pool.remaining));
  const slot = await one(`SELECT * FROM place_slots WHERE id = $1 AND place_id = $2`, [pool.slotId, place.id]);

  /* Continue tapped twice, or the count changed and tapped again: whatever this
     link held before goes back first, so one link never holds two passes. */
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const prior = await one(
    `SELECT t.id FROM web_tokens w JOIN tickets t ON t.id = w.ticket_id
      WHERE w.token_hash = $1 AND t.status = 'held'`, [hash]);
  if (prior) await booking.releaseHold(prior.id);

  const held = await booking.hold({ customer, place, slot, categoryId: cat.id, travelDate, persons: n });
  if (!held.ok) {
    return fail(held.reason, { sold_out: C.soldOut, no_price: C.noPrice }[held.reason] || C.cantHold);
  }

  await query('UPDATE web_tokens SET ticket_id = $2 WHERE token_hash = $1', [hash, held.ticket.id]);
  const payUrl = await checkout.linkFor(held.ticket);
  return { ok: true, ticketNo: held.ticket.ticket_no, payUrl, amount: pricing.rupees(held.ticket.total_paise) };
}

module.exports = { pageFor, availability, confirm, personCategory };
