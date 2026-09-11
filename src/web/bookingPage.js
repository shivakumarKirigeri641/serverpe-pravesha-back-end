/**
 * bookingPage.js — the booking form, rendered server-side.
 *
 * One page, revealed a step at a time. Not four pages: a visitor on a hill road
 * with two bars of signal should pay the network cost once, and every step
 * after the first is then instant.
 *
 * No framework. The whole page is smaller than the JavaScript a framework would
 * need before it rendered anything, and this is opened from a chat by someone
 * who wants a ticket, not an application.
 */

const esc = (s) => String(s === null || s === undefined ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const SHELL = (title, body) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>${title} · Pravesha</title>
<style>
  /* WhatsApp's own palette. The form opens inside WhatsApp's browser straight
     from the chat, so it should look like part of it rather than a different
     product the chat handed you off to. */
  :root{color-scheme:light dark;--ink:#111b21;--muted:#667781;--line:#e9edef;--bg:#efeae2;
        --card:#fff;--accent:#008069;--accent2:#00a884;--accent-ink:#fff;--head:#008069;--head-ink:#fff;
        --ok:#1da851;--warn:#b45309;--bad:#b91c1c;
        --okbg:#e7f8ef;--badbg:#fdeaea;--warnbg:#fef6e7}
  @media(prefers-color-scheme:dark){:root{--ink:#e9edef;--muted:#8696a0;--line:#2a3942;--bg:#0b141a;
        --card:#111b21;--accent:#00a884;--accent2:#00a884;--accent-ink:#0b141a;--head:#202c33;--head-ink:#e9edef;
        --okbg:#0d2f22;--badbg:#3a1414;--warnbg:#3a2c10;--ok:#00d97e}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
       font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
       -webkit-text-size-adjust:100%}
  .wrap{max-width:520px;margin:0 auto;padding:0 0 120px}
  header{background:var(--head);color:var(--head-ink);padding:18px 20px 16px}
  .brand{font-weight:700;font-size:19px;letter-spacing:-.2px}
  .dept{opacity:.85;font-size:12.5px;margin-top:1px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;
        padding:18px;margin:14px 16px}
  .step{display:flex;align-items:center;gap:9px;font-size:12px;font-weight:700;
        letter-spacing:.07em;text-transform:uppercase;color:var(--muted);margin-bottom:13px}
  .num{width:21px;height:21px;border-radius:50%;background:var(--accent);color:#fff;
       display:grid;place-items:center;font-size:11.5px;flex:none}
  label{display:block;font-size:13.5px;font-weight:600;margin:14px 0 6px}
  input,select{width:100%;padding:12px 13px;font-size:16px;border:1.5px solid var(--line);
               border-radius:10px;background:var(--card);color:var(--ink);font-family:inherit}
  input:focus,select:focus{outline:none;border-color:var(--accent)}
  input[readonly]{background:var(--bg);color:var(--muted)}
  input.plate{text-transform:uppercase;letter-spacing:.12em;font-weight:700;font-size:19px;
              text-align:center;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  /* The placeholder was reading as a filled-in value: same weight, same size,
     same spacing as a real entry. Lightened and un-bolded so it is plainly a
     hint and not somebody else's number already in the box. */
  input.plate::placeholder{color:var(--muted);opacity:.55;font-weight:400;letter-spacing:.06em;font-size:16px}
  .masked{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.06em}
  .locked{position:relative}
  .locked::after{content:'🔒';position:absolute;right:12px;top:50%;transform:translateY(-50%);
                 font-size:12px;opacity:.45;pointer-events:none}
  button{width:100%;padding:14px;font-size:16px;font-weight:650;border:0;border-radius:10px;
         background:var(--accent);color:#fff;font-family:inherit;cursor:pointer}
  button:disabled{opacity:.45;cursor:not-allowed}
  .hint{font-size:12.5px;color:var(--muted);margin-top:6px}
  .msg{padding:12px 14px;border-radius:10px;font-size:14px;margin-top:12px;display:none}
  .msg.show{display:block}
  .msg.bad{background:var(--badbg);color:var(--bad)}
  .msg.warn{background:var(--warnbg);color:var(--warn)}
  .vcard{border:1.5px solid var(--ok);background:var(--okbg);border-radius:11px;
         padding:13px 14px;margin-top:13px;display:none}
  .vcard.show{display:block}
  .vhead{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;
         letter-spacing:.06em;text-transform:uppercase;color:var(--ok);margin-bottom:10px}
  .vcheck{width:18px;height:18px;border-radius:50%;background:var(--ok);color:#fff;
          display:grid;place-items:center;font-size:11px}
  .vreg{margin-left:auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
        letter-spacing:.08em;color:var(--ink);background:var(--card);border:1px solid var(--line);
        border-radius:6px;padding:2px 8px;text-transform:none;font-size:12.5px}
  .vgrid{display:grid;grid-template-columns:auto 1fr;margin:0;background:var(--card);
         border:1px solid var(--line);border-radius:9px;overflow:hidden}
  .vgrid dt,.vgrid dd{margin:0;padding:9px 12px;border-bottom:1px solid var(--line);font-size:14px}
  .vgrid dt{color:var(--muted);font-size:13px;white-space:nowrap;border-right:1px solid var(--line)}
  .vgrid dd{font-weight:600}
  .vgrid dt:nth-last-of-type(1),.vgrid dd:last-of-type{border-bottom:0}
  .vtype{display:inline-block;background:var(--accent);color:#fff;border-radius:20px;
         padding:2px 11px;font-size:12.5px;font-weight:650}
  .vfee{font-size:13px;color:var(--muted);margin-top:9px}
  .vfee b{color:var(--ink)}
  .badge{display:inline-block;background:var(--accent);color:#fff;border-radius:20px;
         padding:3px 11px;font-size:12px;font-weight:650;margin-top:9px}
  .slot{display:flex;align-items:center;gap:12px;border:1.5px solid var(--line);
        border-radius:11px;padding:13px;margin-bottom:10px;cursor:pointer}
  .slot.sel{border-color:var(--accent);background:rgba(0,168,132,.09)}
  .slot.full{opacity:.5;cursor:not-allowed}
  .slot input{width:auto;flex:none;accent-color:var(--accent)}
  .slot-main{flex:1}
  .slot-name{font-weight:650;font-size:14.5px;display:block}
  .slot-left{font-size:12.5px;color:var(--muted);margin-top:1px;display:block}
  .slot-left.closed{color:var(--bad)}
  .row{display:flex;justify-content:space-between;padding:7px 0;font-size:14.5px}
  .row.total{border-top:1.5px solid var(--line);margin-top:7px;padding-top:11px;
             font-weight:700;font-size:17px}
  .hide{display:none}
  .spin{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.35);
        border-top-color:#fff;border-radius:50%;animation:sp .7s linear infinite;
        vertical-align:-2px;margin-right:7px}
  @keyframes sp{to{transform:rotate(360deg)}}
  .fees{width:100%;border-collapse:collapse;font-size:14px}
  .fees th{text-align:right;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
           color:var(--muted);padding:0 4px 8px;border-bottom:1px solid var(--line)}
  .fees th:first-child{text-align:left}
  .fees td{padding:11px 4px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}
  .fees td:first-child{text-align:left;white-space:normal}
  .fees tr:last-child td{border-bottom:0}
  .fees .ico{font-size:17px;margin-right:7px;vertical-align:-2px}
  .fees .tot{font-weight:700}
  .fees td.calc{white-space:normal;line-height:1.3}
  .fees .plus{display:block;font-size:11.5px;color:var(--muted)}
  .fees tr.mine td{background:rgba(0,168,132,.10)}
  .fees tr.mine td:first-child{box-shadow:inset 3px 0 0 var(--accent)}
  .rules{margin-top:14px;border:1px solid var(--line);border-left:3px solid var(--warn);
         border-radius:10px;padding:11px 13px;background:var(--warnbg)}
  .rules-h{font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;
           color:var(--warn);margin-bottom:6px}
  .rules ul{margin:0;padding-left:18px}
  .rules li{font-size:13px;line-height:1.5;margin:5px 0;color:var(--ink)}
  .paygrid{width:100%;border-collapse:collapse;font-size:14.5px;margin-top:4px;
           border:1px solid var(--line);border-radius:10px;overflow:hidden}
  .paygrid td{border:1px solid var(--line);padding:10px 12px}
  .paygrid td:last-child{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
  .paygrid tr.total td{font-weight:700;font-size:16px;background:rgba(0,168,132,.10)}
  .sub{font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;
       color:var(--muted);margin:4px 0 4px}
  .sub.gap{margin-top:16px}
  footer{text-align:center;color:var(--muted);font-size:12px;padding:22px 16px}
</style></head><body><div class="wrap">
<header><div class="brand">Pravesha</div>
<div class="dept">Karnataka Tourism Department</div></header>
${body}
<footer>Entry passes are issued for two-wheelers, cars, Toofans and Tempo Travellers only.</footer>
</div></body></html>`;

function expired(reason) {
  const copy = {
    already_used: ['This link has already been used', 'Each booking link works once. Send <b>hi</b> on WhatsApp to start a new booking.'],
    expired: ['This link has expired', 'Booking links are valid for two hours. Send <b>hi</b> on WhatsApp to get a new one.'],
    bad_signature: ['This link is not valid', 'Please use the link exactly as it was sent to you on WhatsApp.'],
    malformed: ['This link is not valid', 'Please use the link exactly as it was sent to you on WhatsApp.'],
    unknown: ['This link is not valid', 'Send <b>hi</b> on WhatsApp to start a new booking.'],
  }[reason] || ['This link is not valid', 'Send <b>hi</b> on WhatsApp to start a new booking.'];

  return SHELL('Link expired', `<div class="card">
    <div style="font-size:34px;text-align:center;margin-bottom:6px">&#8987;</div>
    <h2 style="margin:0 0 8px;text-align:center;font-size:19px">${copy[0]}</h2>
    <p style="text-align:center;color:var(--muted);font-size:14.5px;margin:0">${copy[1]}</p>
  </div>`);
}

/**
 * Everything but the last four digits.
 *
 * The number is shown so the visitor can see the pass will reach the right
 * phone, not so it can be read over their shoulder — this form is opened on a
 * phone at a viewpoint, often with other people around.
 */
function mask(mobile) {
  const d = String(mobile || '').replace(/\D/g, '');
  if (d.length <= 4) return d;
  return '\u2022'.repeat(d.length - 4) + ' ' + d.slice(-4);
}

function render({ token, customer, places, dates, tariff, feePercent }) {
  const name = esc((customer && (customer.name || customer.wa_profile_name)) || '');
  const mobile = esc((customer && customer.mobile) || '');

  const placeOpts = places.map((p) => (p.is_active
    ? `<option value="${p.id}">${esc(p.name)} &mdash; ${esc(p.district)}</option>`
    : `<option value="${p.id}" data-soon="1">${esc(p.name)} &mdash; coming soon</option>`)).join('');

  const dateOpts = dates.map((d) =>
    `<option value="${d.value}">${esc(d.label)}${d.isToday ? ' (today)' : ''}</option>`).join('');

  /* A picture of the vehicle beside each fare, because the label alone is not
     how people recognise themselves: "Toofan / Maxi Cab" means nothing to
     someone who calls it a Cruiser, while the silhouette does. */
  const ICON = { BIKE: '🏍️', CAR: '🚗', TOOFAN: '🚙', TT: '🚐' };
  const rs = (paise) => '&#8377;' + (Number(paise) / 100).toFixed(2).replace(/\.00$/, '');
  const pct = feePercent === null || feePercent === undefined ? '' : `${feePercent}%`;
  const feeRows = tariff.map((t) => `<tr data-cat="${esc(t.categoryId)}">
        <td><span class="ico">${ICON[t.code] || '🚘'}</span>${esc(t.label)}</td>
        <td class="calc">${rs(t.entryPaise)} <span class="plus">+ ${pct} platform fee</span></td>
        <td class="tot">${rs(t.totalPaise)}</td></tr>`).join('');
  const live = places.find((p) => p.is_active);
  const placeName = esc(live ? live.name : '');

  return SHELL('Book entry pass', BODY({
    token: esc(token), name, maskedMobile: esc(mask(mobile)),
    placeOpts, dateOpts, feeRows, placeName,
  }));
}

const BODY = (v) => `
<form id="f" autocomplete="off">
  <input type="hidden" id="tok" value="${v.token}">

  <div class="card">
    <div class="step"><span class="num">1</span>Your details</div>
    <label for="name">Name</label>
    <div class="locked"><input id="name" value="${v.name}" readonly></div>
    <label for="mobile">WhatsApp number</label>
    <div class="locked"><input id="mobile" class="masked" value="${v.maskedMobile}" readonly></div>
    <div class="hint">Taken from your WhatsApp account.</div>
  </div>

  <div class="card">
    <div class="step"><span class="num">2</span>Where and when</div>
    <label for="place">Destination</label>
    <select id="place">${v.placeOpts}</select>
    <div class="msg warn" id="soon">Bookings for this destination are not open yet. Please choose Mullayanagiri.</div>
    <label for="date">Date of visit</label>
    <select id="date">${v.dateOpts}</select>
  </div>

  <div class="card">
    <div class="step"><span class="num">&#8377;</span>Entry fees &middot; ${v.placeName}</div>
    <table class="fees" id="fees">
      <thead><tr><th>Vehicle</th><th>Fee</th><th>Total</th></tr></thead>
      <tbody>${v.feeRows}</tbody>
    </table>
    <div class="rules">
      <div class="rules-h">Please note</div>
      <ul>
        <li>The pass is valid only for the vehicle number entered. Changing the vehicle at the checkpost is not allowed.</li>
        <li>Vehicles without a clear, readable number plate will not be allowed entry.</li>
        <li>One pass per vehicle for a date and slot. Repeat or duplicate bookings will be cancelled.</li>
        <li>Editing, copying or reselling a pass is illegal. Legal action will be taken against the vehicle and its owner.</li>
      </ul>
    </div>
  </div>

  <div class="card">
    <div class="step"><span class="num">3</span>Your vehicle</div>
    <label for="reg">Enter vehicle number</label>
    <input id="reg" class="plate" placeholder="KA01AB1234" maxlength="14" autocapitalize="characters" spellcheck="false">
    <div class="hint">We look this up to set the correct entry fee.</div>
    <div style="margin-top:12px"><button type="button" id="check">Check vehicle</button></div>
    <div class="msg bad" id="verr"></div>
    <div class="vcard" id="vok">
      <div class="vhead"><span class="vcheck">&#10003;</span>Vehicle verified<span class="vreg" id="vreg"></span></div>
      <dl class="vgrid" id="vgrid"></dl>
      <div class="vfee" id="vfee"></div>
    </div>
  </div>

  <div class="card hide" id="slotCard">
    <div class="step"><span class="num">4</span>Choose a time slot</div>
    <div id="slots"></div>
  </div>

  <div class="card hide" id="revCard">
    <div class="step"><span class="num">5</span>Review</div>
    <div id="review"></div>
    <div style="margin-top:14px"><button type="button" id="pay">Continue to payment</button></div>
  </div>
</form>
<script src="/book/app.js"></script>`;

module.exports = { render, expired };
