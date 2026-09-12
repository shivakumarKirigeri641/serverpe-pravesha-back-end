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
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,interactive-widget=resizes-content">
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
  /* Room below the last field, so a field near the bottom can still be scrolled
     up above an on-screen keyboard instead of being pinned under it. */
  .wrap{max-width:520px;margin:0 auto;padding:0 0 45vh}
  input,select{scroll-margin:96px 0}
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
  input.plate{text-transform:uppercase;letter-spacing:0;font-weight:700;font-size:19px;text-align:center}
  /* The placeholder was reading as a filled-in value: same weight, same size,
     same spacing as a real entry. Lightened and un-bolded so it is plainly a
     hint and not somebody else's number already in the box. */
  input.plate::placeholder{color:var(--muted);opacity:.55;font-weight:400;letter-spacing:0;font-size:16px}
  .masked{letter-spacing:0}
  .locked{position:relative}
  .locked::after{content:'🔒';position:absolute;right:12px;top:50%;transform:translateY(-50%);
                 font-size:12px;opacity:.45;pointer-events:none}
  button{width:100%;padding:14px;font-size:16px;font-weight:650;border:0;border-radius:10px;
         background:var(--accent);color:#fff;font-family:inherit;cursor:pointer}
  button:disabled{opacity:.45;cursor:not-allowed}
  .hint{font-size:12.5px;color:var(--muted);margin-top:6px}
  /* Alerts are boxes with a strong edge and dark text on a light tint (light
     text on a deep tint in dark mode). Red text on a pale red ground was hard to
     read, and in dark mode — dark red on near-black red — close to invisible. */
  .msg{position:relative;padding:12px 14px 12px 44px;border-radius:10px;font-size:14.5px;
       line-height:1.5;margin-top:12px;display:none;border:1px solid;border-left-width:5px;font-weight:500}
  .msg.show{display:block}
  .msg::before{position:absolute;left:14px;top:11px;font-size:18px;line-height:1.2}
  .msg.bad{background:#fff1f0;color:#7a1410;border-color:#f3b5b0;border-left-color:#d92d20}
  .msg.bad::before{content:'⛔'}
  .msg.warn{background:#fff8e6;color:#6b4200;border-color:#f2d189;border-left-color:#e79a00}
  .msg.warn::before{content:'⚠️'}
  .msg-title{display:block;font-weight:700;font-size:15px;margin-bottom:2px}
  @media(prefers-color-scheme:dark){
    .msg.bad{background:#4a1512;color:#ffe1de;border-color:#8c2a22;border-left-color:#ff6b5f}
    .msg.warn{background:#3d2c05;color:#ffecc2;border-color:#7a5a12;border-left-color:#ffb020}
  }
  .vcard{border:1.5px solid var(--ok);background:var(--okbg);border-radius:11px;
         padding:13px 14px;margin-top:13px;display:none}
  .vcard.show{display:block}
  .vhead{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;
         letter-spacing:.06em;text-transform:uppercase;color:var(--ok);margin-bottom:10px}
  .vcheck{width:18px;height:18px;border-radius:50%;background:var(--ok);color:#fff;
          display:grid;place-items:center;font-size:11px}
  .vreg{margin-left:auto;
        letter-spacing:0;color:var(--ink);background:var(--card);border:1px solid var(--line);
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
  /* The confirmation sheet shown once a place is held. It slides up from the
     bottom on a phone, where a thumb reaches it, and dims the form behind so the
     only decisions left are pay or cancel. */
  .modal{position:fixed;inset:0;background:rgba(11,20,26,.62);z-index:50;display:flex;
         align-items:flex-end;justify-content:center;padding:0}
  .modal.hide{display:none}
  .sheet{background:var(--card);color:var(--ink);width:100%;max-width:520px;border-radius:18px 18px 0 0;
         padding:18px 18px 22px;box-shadow:0 -8px 30px rgba(0,0,0,.25);max-height:92vh;overflow:auto;
         animation:up .22s ease-out}
  @keyframes up{from{transform:translateY(40px);opacity:.3}to{transform:none;opacity:1}}
  @media(min-width:560px){.modal{align-items:center}.sheet{border-radius:18px}}
  .atgate{display:flex;gap:10px;align-items:flex-start;margin:12px 0 0;padding:12px 14px;
    border:1px solid var(--line);border-radius:12px;cursor:pointer}
  .atgate input{width:20px;height:20px;margin:1px 0 0;accent-color:#0b7a3f;flex:0 0 auto}
  .atgate b{display:block;font-size:15px}
  .atgate small{display:block;margin-top:2px;color:var(--muted);font-size:12.5px;line-height:1.35}
  .atgate.on{border-color:#0b7a3f;background:rgba(11,122,63,.06)}
  .atgate.busy{opacity:.6;pointer-events:none}
  .atgate.hide{display:none}
  #atGateMsg{margin-top:8px}
  #atGateMsg.good{display:block;border:1px solid rgba(11,122,63,.25);background:rgba(11,122,63,.06);
    color:#0b7a3f;padding:10px 12px;border-radius:10px;font-size:13.5px}
  .sheet-head{display:flex;gap:12px;align-items:center;margin-bottom:12px}
  .hold-icon{width:42px;height:42px;border-radius:50%;background:var(--okbg);display:grid;place-items:center;font-size:20px;flex:none}
  .sheet-title{font-weight:700;font-size:17px}
  .sheet-sub{font-size:13px;color:var(--muted)}
  .timer{display:flex;justify-content:space-between;align-items:center;border-radius:10px;padding:10px 14px;
         margin-bottom:12px;background:var(--okbg);border:1px solid rgba(29,168,81,.35);font-size:14px}
  .timer b{font-size:22px;font-variant-numeric:tabular-nums;letter-spacing:0}
  .timer.low{background:#fff4e0;border-color:#f2c26b;color:#6b4200}
  @media(prefers-color-scheme:dark){.timer.low{background:#3d2c05;border-color:#7a5a12;color:#ffecc2}}
  .sum{width:100%;border-collapse:collapse;font-size:14px;margin-bottom:6px}
  .sum th,.sum td{border:1px solid var(--line);padding:8px 10px;text-align:left}
  .sum th{color:var(--muted);font-weight:500;background:var(--bg);width:40%}
  .sum td{font-weight:600}
  .sum tr.total th,.sum tr.total td{font-size:16px;font-weight:700;background:rgba(0,168,132,.12);color:var(--ink)}
  button.ghost{background:transparent;color:var(--ink);border:1.5px solid var(--line);margin-top:10px}
  /* The slot cards style themselves — see bookingClient.js.
     WHY NOT HERE. This page lives in a module the server loads once at
     start-up; app.js is re-read from disk on every request. Ship a change to
     the markup and it reaches visitors at once while the CSS for it waits for
     a restart — which is exactly how the slot grid came to render on a phone
     as a run of unstyled text. Markup and styling now travel together in the
     file that is hot, so they cannot disagree. */
  /* The pointer back up to the slot grid. The slot sits under the date, above
     the vehicle, so after a vehicle is checked the next step is behind the
     visitor; without this the form looked finished with nothing to tap. */
  .nudge{display:flex;align-items:center;gap:12px;margin-top:12px;padding:12px 14px;border-radius:10px;
         background:#e8f1ff;border:1px solid #b9d3ff;border-left:5px solid #2f6fe4;color:#12325f}
  .nudge.hide{display:none}
  .nudge b{display:block;font-size:14.5px}
  .nudge span{display:block;font-size:13px;opacity:.9}
  .nudge div{flex:1}
  button.mini{width:auto;flex:none;padding:10px 14px;font-size:14px;margin:0;background:#2f6fe4}
  @media(prefers-color-scheme:dark){.nudge{background:#10284d;border-color:#274b82;border-left-color:#6aa1ff;color:#dbe8ff}}
  .sgrid.attn{animation:attn 1.1s ease-in-out 2}
  @keyframes attn{0%,100%{box-shadow:0 0 0 0 rgba(47,111,228,0)}50%{box-shadow:0 0 0 5px rgba(47,111,228,.45)}}
  @media(prefers-reduced-motion:reduce){.sgrid.attn{animation:none;box-shadow:0 0 0 3px rgba(47,111,228,.45)}}
  .checkpost{margin-top:14px;border-radius:10px;padding:11px 13px;background:var(--okbg);
             border:1px solid rgba(29,168,81,.35);border-left:3px solid var(--ok)}
  .checkpost-h{font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--ok);margin-bottom:4px}
  .checkpost p{margin:0;font-size:13.5px;line-height:1.5;color:var(--ink)}
  .rules{margin-top:14px;border:1px solid var(--line);border-left:3px solid var(--warn);
         border-radius:10px;padding:11px 13px;background:var(--warnbg)}
  .rules-h{font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;
           color:var(--warn);margin-bottom:6px}
  .rules ul{margin:0;padding-left:18px}
  .rules li{font-size:13px;line-height:1.5;margin:5px 0;color:var(--ink)}
  /* The review is one document: an outer summary that holds two tables, the
     visit and the payment, each with its own heading row. Read top to bottom it
     is the pass the visitor is about to pay for, laid out the way a receipt is. */
  .rev{width:100%;border-collapse:separate;border-spacing:0;border:1px solid var(--line);
       border-radius:12px;overflow:hidden;background:var(--card)}
  .rev>thead>tr>th{background:var(--head);color:var(--head-ink);text-align:left;padding:11px 14px;
                   font-size:13px;font-weight:700;letter-spacing:.04em}
  .rev>thead>tr>th span{float:right;
                        font-weight:600;opacity:.9;letter-spacing:0}
  .rev>tbody>tr>td{padding:12px}
  .rev>tbody>tr+tr>td{padding-top:0}
  .inner{width:100%;border-collapse:collapse;font-size:14px;border:1px solid var(--line)}
  .inner caption{caption-side:top;text-align:left;font-size:11px;font-weight:700;letter-spacing:.07em;
                 text-transform:uppercase;color:var(--accent);padding:0 0 6px}
  .inner th,.inner td{border:1px solid var(--line);padding:9px 11px;vertical-align:top}
  .inner th{width:38%;text-align:left;font-weight:500;color:var(--muted);background:var(--bg);font-size:13px}
  .inner td{font-weight:600}
  .inner.pay td{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
  .inner.pay th{width:auto}
  .inner.pay tr.total th,.inner.pay tr.total td{background:rgba(0,168,132,.12);color:var(--ink);
                                                font-weight:700;font-size:15.5px}
  .mono{letter-spacing:0}
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
  return '\u2022'.repeat(d.length - 4) + d.slice(-4);
}

/**
 * When the next date opens, said under the date list.
 *
 * Without it the list simply ends, and somebody looking for a date a fortnight
 * out cannot tell whether it is sold out, not allowed, or just not open yet.
 */
function releaseNote(w) {
  if (!w) return '';
  const h = w.releaseHour % 12 === 0 ? 12 : w.releaseHour % 12;
  const time = `${h}:00 ${w.releaseHour < 12 ? 'AM' : 'PM'}`;
  const d = new Date(`${w.next.date}T00:00:00Z`)
    .toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `Bookings open up to 2 weeks ahead. The next date, <b>${esc(d)}</b>, opens `
    + `${w.next.opensToday ? 'today' : 'tomorrow'} at ${time}.`;
}

function render({ token, customer, places, dates, tariff, feePercent, scriptVersion, releaseInfo }) {
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
    placeOpts, dateOpts, feeRows, placeName, scriptVersion: esc(scriptVersion || ''),
    releaseNote: releaseNote(releaseInfo),
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
    <div class="step"><span class="num">2</span>Where, when and time slot</div>
    <label for="place">Destination</label>
    <select id="place">${v.placeOpts}</select>
    <div class="msg warn" id="soon">Bookings for this destination are not open yet. Please choose Mullayanagiri.</div>
    <label for="date">Date of visit</label>
    <select id="date">${v.dateOpts}</select>
    <div class="hint">${v.releaseNote}</div>
    <label for="slots" style="margin-top:16px">Time slot</label>
    <div id="slots"></div>
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
    <input id="reg" class="plate" placeholder="KA01AB1234" maxlength="14" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="go" inputmode="text">
    <div class="hint">We look this up to set the correct entry fee.</div>
    <div style="margin-top:12px"><button type="button" id="check">Check vehicle</button></div>
    <div class="msg bad" id="verr"></div>
    <div class="vcard" id="vok">
      <div class="vhead"><span class="vcheck">&#10003;</span>Vehicle verified<span class="vreg" id="vreg"></span></div>
      <dl class="vgrid" id="vgrid"></dl>
      <div class="vfee" id="vfee"></div>
    </div>
    <div class="nudge hide" id="slotNudge">
      <div><b>Next: choose a time slot</b><span>Pick a slot in the grid above to see your review and pay.</span></div>
      <button type="button" class="mini" id="toSlots">Choose slot &#8593;</button>
    </div>
  </div>

  <div class="card hide" id="revCard">
    <div class="step"><span class="num">4</span>Review</div>
    <div id="review"></div>
    <div class="checkpost">
      <div class="checkpost-h">&#128706; At the checkpost</div>
      <p>No printout needed. Just drive up to the checkpost &mdash; staff will read your vehicle
      number and record your entry digitally. That&rsquo;s it.</p>
    </div>
    <div class="msg bad" id="payerr"></div>
    <div style="margin-top:14px"><button type="button" id="pay">Continue to payment</button></div>
    <div class="hint" style="text-align:center">Secure payment by Razorpay &middot; your pass arrives on WhatsApp</div>
  </div>
</form>
<div class="modal hide" id="holdModal" role="dialog" aria-modal="true" aria-labelledby="holdTitle">
  <div class="sheet">
    <div class="sheet-head">
      <div class="hold-icon">&#128274;</div>
      <div>
        <div class="sheet-title" id="holdTitle">Your place is held</div>
        <div class="sheet-sub">Reserved for this vehicle until you pay</div>
      </div>
    </div>
    <div class="timer" id="holdTimer">
      <span>Time left to pay</span><b id="holdClock">10:00</b>
    </div>
    <div id="holdSummary"></div>

    <!--
      "I am already at the checkpost."

      Hidden unless the server says this pass could be driven through the barrier
      this minute, at a gate whose position is on file. Ticking it asks the phone
      where it is; the server decides whether that is the gate. It starts
      unticked every time, because the expensive mistake here is a tick nobody
      meant — a pass marked entered while its owner is still at home.
    -->
    <label class="atgate hide" id="atGateRow">
      <input type="checkbox" id="atGate">
      <span>
        <b>I am already at the checkpost</b>
        <small id="atGateHint">Your entry will be recorded now, so you can drive through without waiting.</small>
      </span>
    </label>
    <div class="msg" id="atGateMsg"></div>

    <div class="msg bad" id="holdErr"></div>
    <button type="button" id="holdPay">Confirm &amp; pay</button>
    <button type="button" class="ghost" id="holdCancel">Cancel and release place</button>
    <div class="hint" style="text-align:center;margin-top:10px">Secure payment by Razorpay</div>
  </div>
</div>
<script src="/book/app.js?v=${v.scriptVersion}"></script>`;

module.exports = { render, expired };
