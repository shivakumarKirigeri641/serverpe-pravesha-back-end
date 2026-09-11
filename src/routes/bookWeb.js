/**
 * routes/bookWeb.js — the booking form, as two web pages.
 *
 *   GET  /book/:token            page 1 — details, place, date, vehicle, slot
 *   POST /book/:token/vehicle      check a registration number (fetch)
 *   POST /book/:token/slots        live availability (fetch)
 *   POST /book/:token/review     page 2 — full review, agree, pay
 *   POST /book/:token/confirm      hold the place, hand back the payment link
 *
 * Opened by a Call-To-Action button in the chat, so it runs inside WhatsApp's
 * own browser: the visitor never leaves the app and lands back in the thread
 * when they close it. After payment the checkout page returns them to the
 * conversation, where the ticket and the invoice are waiting.
 *
 * WHY TWO PAGES RATHER THAN ONE LONG SCROLL
 *
 * The second page exists so that agreeing and paying is a deliberate act on a
 * screen that shows only what is being agreed to. Everything on it is
 * re-derived on the server from the choices posted — the price is never taken
 * from the browser, because a page is a client and a client can be edited.
 *
 * THE VEHICLE IS ON PAGE 1 AND IS NOT OPTIONAL. It was not in the list of
 * sections asked for, but the entry fee depends on the vehicle category and the
 * ticket is signed against the plate: without it there is no price to show and
 * no ticket to issue.
 *
 * THE TOKEN IS THE LOGIN — signed with the app secret, carrying the customer id
 * and mobile. No password, because the link arrived in a WhatsApp thread Meta
 * already proved belongs to that number.
 */

const express = require('express');
const booking = require('../gatepass/booking');
const inventory = require('../gatepass/inventory');
const vehicles = require('../gatepass/vehicle');
const pricing = require('../gatepass/pricing');
const customers = require('../gatepass/customers');
const checkout = require('../gatepass/checkout');
const plate = require('../gatepass/plate');
const db = require('../gatepass/db');
const settings = require('../gatepass/settings');
const { t, prettyDate } = require('../gatepass/i18n');
const { unsignToken, tokenState, spendToken } = require('./flowEndpoint');
const { wireJson, clientScript } = require('./wire');

const router = express.Router();

const rs = (p) => (p % 100 === 0 ? String(p / 100) : (p / 100).toFixed(2));

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** Masked to the last four digits, as asked: +91 ••••• •2415. */
const mask4 = (mobile) => {
  const d = String(mobile).replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `+91 ••••• •${d.slice(-4)}` : mobile;
};

async function who(token, { checkState = true } = {}) {
  const claim = unsignToken(token);
  if (!claim?.m) return null;

  /* A booking link is single use and short lived. Without this the link sat
     in the chat working for ever: scroll up, tap it again, book again. */
  if (checkState) {
    const st = await tokenState(token);
    if (!st.ok) return { spent: st.reason };
  }

  const c = await customers.byMobile(claim.m);
  if (!c) return null;
  return { customer: c, lang: c.language === 'en' ? 'en' : 'kn' };
}

/**
 * The page shown for a link that is spent, expired or unreadable.
 *
 * "Already used" and "expired" are told apart on purpose: somebody who has
 * booked wants to know their booking exists, not to wonder whether it failed.
 */
const expired = (res, reason) => {
  const line = reason === 'used'
    ? 'This booking link has already been used.<br>Your ticket is in the WhatsApp chat.'
    : reason === 'expired'
      ? 'This booking link has expired.'
      : 'This booking link is no longer valid.';
  return res.status(410).type('html').send(
    '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<body style="font:16px system-ui;padding:2rem;text-align:center;line-height:1.6">'
    + line + '<br><br>Send <b>hi</b> on WhatsApp to start again.</body>');
};

/* ────────────────────────────────────────────────────── shared page chrome */

function shell({ title, product, header, sub, body, extraCss = '' }) {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Kannada:wght@400;600&display=swap" rel="stylesheet">
<style>
 :root{--ink:#0f1c1a;--muted:#5b6b67;--teal:#0a9e8e;--deep:#075e54;--line:#dde5e3;
   --bg:#f6f8f7;--card:#fff;--good:#15803d;--bad:#b91c1c}
 @media(prefers-color-scheme:dark){:root{--ink:#eef2f0;--muted:#9fb0ac;--line:#283533;
   --bg:#0e1413;--card:#161e1d}}
 *{box-sizing:border-box}
 body{margin:0;background:var(--bg);color:var(--ink);
   font:16px/1.5 "Noto Sans Kannada",-apple-system,"Segoe UI",Roboto,sans-serif}
 header{background:linear-gradient(135deg,var(--teal),var(--deep));color:#fff;padding:18px 20px}
 header b{font-size:19px;display:block}
 header span{opacity:.9;font-size:13px}
 main{max-width:520px;margin:0 auto;padding:16px}
 .card{background:var(--card);border:1px solid var(--line);border-radius:14px;
   padding:16px;margin:0 0 14px}
 h2{font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);
   margin:0 0 12px;font-weight:600}
 label{display:block;font-size:13px;color:var(--muted);margin:0 0 6px}
 select,input[type=text]{width:100%;padding:13px;font:inherit;color:var(--ink);
   background:var(--bg);border:1px solid var(--line);border-radius:10px}
 .ro{font-weight:600;padding:2px 0 10px}
 .row{display:flex;gap:8px}.row input{flex:1}
 button{width:100%;padding:15px;font:600 16px/1 inherit;border:0;border-radius:10px;
   background:var(--teal);color:#fff;margin-top:14px}
 button[disabled]{opacity:.4}
 .mini{width:auto;padding:13px 18px;margin:0}
 .slot{display:flex;justify-content:space-between;align-items:center;gap:10px;
   border:1px solid var(--line);border-radius:10px;padding:13px;margin:0 0 8px;cursor:pointer}
 .slot.off{opacity:.45;cursor:not-allowed}
 .slot.sel{border-color:var(--teal);box-shadow:0 0 0 2px var(--teal) inset}
 .slot small{color:var(--muted);display:block}
 .err{color:var(--bad);font-size:14px;margin:10px 0 0}
 .ok{color:var(--good);font-size:14px;margin:10px 0 0}
 .line{display:flex;justify-content:space-between;color:var(--muted);
   font-size:14px;padding:4px 0}
 .tot{display:flex;justify-content:space-between;font-weight:600;font-size:18px;
   border-top:1px solid var(--line);margin-top:8px;padding-top:10px}
 .vcard{border:1px solid var(--line);border-radius:10px;padding:12px;margin-top:12px;background:var(--bg)}
 /* The vehicle-type choice, shown only when there is no RC record to read it
    from. Laid out as cards with the price on each, because the price is the
    thing the choice actually changes and hiding it until later reads as a
    trick. Wide targets: this is tapped on a phone, often in a car park. */
 .hint{color:var(--muted);font-size:13.5px;line-height:1.5;margin:8px 0}
 .types{display:grid;gap:8px;margin:10px 0 4px}
 .type{display:flex;justify-content:space-between;align-items:center;width:100%;
   text-align:left;background:var(--bg);color:inherit;border:1px solid var(--line);
   border-radius:10px;padding:13px;margin:0;font-size:15px;cursor:pointer}
 .type small{color:var(--muted);font-size:15px;font-weight:600}
 .type.sel{border-color:var(--teal);box-shadow:0 0 0 2px var(--teal) inset}
 /* The review is a grid, not a list of rows: a light ground, hairline cells
    and a small gap, so a glance separates label from value without reading. */
 .grid{display:grid;grid-template-columns:auto 1fr;gap:1px;background:var(--line);
   border:1px solid var(--line);border-radius:10px;overflow:hidden;margin-top:4px}
 .grid>div{background:var(--bg);padding:10px 12px;font-size:14.5px}
 .grid>div:nth-child(odd){color:var(--muted);white-space:nowrap}
 .grid>div:nth-child(even){text-align:right;font-weight:600}
 .grid .big{font-size:17px}

 .vhead{color:var(--good);font-weight:600;margin-bottom:8px}
 .hide{display:none}
 .agree{display:flex;gap:10px;align-items:flex-start;font-size:14px;margin-top:6px}
 .agree input{width:auto;margin-top:4px}
 .note{color:var(--muted);font-size:12.5px;margin-top:10px}
 footer{text-align:center;color:var(--muted);font-size:12px;padding:6px 0 28px}
 a{color:var(--teal)}
 ${extraCss}
</style></head><body>
<header><b>${esc(header)}</b><span>${esc(sub)}</span></header>
<main>${body}</main>
<footer>${esc(product)}</footer>
</body></html>`;
}

/* ───────────────────────────────────────────────────────── page 1 */

router.get('/book/:token', async (req, res) => {
  const me = await who(req.params.token);
  if (!me || me.spent) return expired(res, me?.spent);

  const L = me.lang;
  const cfg = await settings.all();
  const places = (await db.query(
    'SELECT id, name, district FROM places WHERE is_active ORDER BY id')).rows;
  const dates = places.length ? await booking.bookableDates(places[0]) : [];
  const T = (k, v) => esc(t(L, k, v));

  const body = `
<div class="card">
  <h2>${T('f_your_details')}</h2>
  <label>${T('f_name')}</label>
  <div class="ro">${esc(me.customer.wa_profile_name || '')}</div>
  <label>${T('f_number')}</label>
  <div class="ro">${esc(mask4(me.customer.mobile))}</div>
</div>

<form method="POST" action="/book/${esc(req.params.token)}/review" id="f">
<div class="card">
  <h2>${T('f_where_when')}</h2>
  <label for="place">${T('f_place')}</label>
  <select id="place" name="place_id">${places.map((p) =>
    `<option value="${p.id}">${esc(p.name)}${p.district ? ' — ' + esc(p.district) : ''}</option>`).join('')}</select>

  <label for="date" style="margin-top:14px">${T('f_date')}</label>
  <select id="date" name="travel_date">${dates.map((d) =>
    `<option value="${d}">${esc(prettyDate(d, L))}</option>`).join('')}</select>

  <label for="reg" style="margin-top:14px">${T('f_reg_label')}</label>
  <div class="row">
    <input type="text" id="reg" name="reg_no" placeholder="${T('f_reg_helper')}"
      autocapitalize="characters" autocomplete="off">
    <button type="button" class="mini" id="check">${T('f_check')}</button>
  </div>
  <div id="vres"></div>
</div>

<div class="card hide" id="slotcard">
  <h2>${T('f_choose_slot')}</h2>
  <div id="slots"></div>
  <input type="hidden" name="slot" id="slotv">
  <input type="hidden" name="category_id" id="catv">
</div>

<div class="card hide" id="pricecard">
  <h2>${T('total_pay')}</h2>
  <div class="line"><span>${T('entry_fee')}</span><span id="pEntry"></span></div>
  <div class="line"><span>${T('service_fee')}</span><span id="pFee"></span></div>
  <div class="tot"><span>${T('total_pay')}</span><span id="pTot"></span></div>
  <button type="submit" id="go">${T('review_and_pay')}</button>
</div>
</form>

<script>
const $=i=>document.getElementById(i);
let V=null;
/* Request and response bodies are AES-GCM sealed, so what crosses the wire —
   and what shows in a network tab — is one opaque string rather than prices,
   plates and live availability in readable JSON. See routes/wire.js for the
   format and for what this does and does not protect. */
${clientScript(req.params.token)}
const post=wpost;

function reset(){V=null;$('vres').innerHTML='';$('slotv').value='';
  $('slotcard').classList.add('hide');$('pricecard').classList.add('hide');}
$('place').onchange=reset;$('date').onchange=reset;$('reg').oninput=reset;

$('check').onclick=async()=>{
  $('check').disabled=true;$('vres').innerHTML='';
  const r=await post('vehicle',{reg_no:$('reg').value,place_id:$('place').value,
    travel_date:$('date').value});
  $('check').disabled=false;
  if(!r.ok){$('vres').innerHTML='<p class="err">'+r.error+'</p>';return;}

  /* No RC record — an old registration, usually. Ask instead of guessing:
     the guess is always the car rate, and it is the visitor who pays it. */
  if(r.needs_type){
    $('vres').innerHTML='<div class="vcard"><div class="vhead">'+r.reg_pretty+'</div>'
      +'<p class="hint">'+(r.why||'')+'</p>'
      +'<div class="types">'+r.types.map(x=>'<button type="button" class="type" '
        +'data-id="'+x.id+'" data-e="'+x.entry+'" data-f="'+x.fee+'" data-t="'+x.total+'">'
        +'<span>'+x.label+'</span><small>\\u20b9'+x.total+'</small></button>').join('')
      +'</div><p class="hint">${T('f_type_gate')}</p></div>';
    document.querySelectorAll('.type').forEach(b=>b.onclick=()=>{
      document.querySelectorAll('.type').forEach(o=>o.classList.remove('sel'));
      b.classList.add('sel');
      chosen({category_id:+b.dataset.id,entry:b.dataset.e,fee:b.dataset.f,total:b.dataset.t});
    });
    return;
  }

  const d=r.vehicle||{};
  const line=(k,v)=>v?'<div class="line"><span>'+k+'</span><span>'+v+'</span></div>':'';
  $('vres').innerHTML=
    '<div class="vcard"><div class="vhead">&#10003; '+r.reg_pretty+'</div>'
    +line('${T('v_make')}',d.make)
    +line('${T('v_model')}',d.model)
    +line('${T('v_variant')}',d.variant)
    +line('${T('v_type')}',d.type)
    +line('${T('entry_type')}',r.category)
    +'</div>';
  chosen(r);
};

/* Everything from "we know what this vehicle is" onwards, shared by both
   routes into it: the RC told us, or the visitor did. */
async function chosen(r){
  V=r;$('catv').value=r.category_id;
  const s=await post('slots',{place_id:$('place').value,travel_date:$('date').value,
    category_id:r.category_id});
  $('slots').innerHTML=s.slots.map(x=>'<div class="slot'+(x.open?'':' off')+
    '" data-c="'+x.code+'"><span>'+x.label+'<small>'+x.note+'</small></span></div>').join('');
  $('slotcard').classList.remove('hide');
  document.querySelectorAll('.slot').forEach(el=>el.onclick=()=>{
    if(el.classList.contains('off'))return;
    document.querySelectorAll('.slot').forEach(o=>o.classList.remove('sel'));
    el.classList.add('sel');$('slotv').value=el.dataset.c;
    $('pEntry').textContent='\\u20b9'+V.entry;$('pFee').textContent='\\u20b9'+V.fee;
    $('pTot').textContent='\\u20b9'+V.total;
    $('pricecard').classList.remove('hide');
    $('pricecard').scrollIntoView({behavior:'smooth',block:'center'});});
};
$('f').onsubmit=e=>{if(!$('slotv').value){e.preventDefault();}};
</script>`;

  res.type('html').send(shell({
    title: cfg.product_name || 'Pravesha',
    product: cfg.merchant_name || 'ServerPe App Solutions',
    header: cfg.product_name || 'Pravesha',
    sub: t(L, 'consent_book_here'),
    body,
  }));
});

/* ───────────────────────────────────────────────────────── page 2 */

router.post('/book/:token/review', express.urlencoded({ extended: false }), async (req, res) => {
  const me = await who(req.params.token);
  if (!me || me.spent) return expired(res, me?.spent);

  const L = me.lang;
  const cfg = await settings.all();
  const T = (k, v) => esc(t(L, k, v));

  /* Everything shown here is re-derived from the database, not taken from the
     form. The only things trusted from the browser are which place, which
     date, which slot and which plate — and each is looked up again. */
  try {
    const place = await db.one('SELECT * FROM places WHERE id = $1 AND is_active',
      [Number(req.body.place_id)]);
    const slot = await db.one('SELECT * FROM place_slots WHERE place_id = $1 AND code = $2',
      [place.id, String(req.body.slot)]);
    const p = plate.parse(String(req.body.reg_no || ''));
    if (!p.ok) throw new Error(t(L, 'f_err_format'));

    const vehicle = (await vehicles.resolve(p.reg_no, { customerId: me.customer.id }))?.vehicle;

    /* Same rule as /confirm: the RC decides the category where it can, and the
       visitor's own answer is used only where it could not. Deriving it here
       and choosing it there would show one price on this page and charge
       another at the gateway. */
    const category = vehicles.isClassified(vehicle)
      ? await pricing.categoryForVehicle(vehicle)
      : await db.one('SELECT * FROM vehicle_categories WHERE id = $1 AND is_active',
          [Number(req.body.category_id)]);
    if (!category) throw new Error(t(L, 'f_err_category'));

    const price = await pricing.priceFor(place.id, category.id);
    const total = price.entry_paise + price.platform_paise;

    const body = `
<div class="card">
  <h2>${T('f_your_booking')}</h2>
  ${(() => {
    const d = vehicles.details(vehicle);
    const cell = (k, v, cls = '') => (v
      ? `<div>${esc(k)}</div><div class="${cls}">${esc(v)}</div>` : '');
    /* One grid, everything in it. Three separate cards made the reader compare
       three boxes to answer one question — "is this the booking I meant?" */
    return `<div class="grid">
      ${cell(t(L, 'f_place'), place.name, 'big')}
      ${cell(t(L, 'travel_date'), prettyDate(req.body.travel_date, L), 'big')}
      ${cell(t(L, 'entry_time'), slot.label || slot.code)}
      ${cell(t(L, 'vehicle_number'), p.reg_no, 'big')}
      ${cell(t(L, 'v_make'), d.make)}
      ${cell(t(L, 'v_model'), d.model)}
      ${cell(t(L, 'v_variant'), d.variant)}
      ${cell(t(L, 'v_type'), d.type)}
      ${cell(t(L, 'entry_type'), category.label)}
      ${cell(t(L, 'entry_fee'), '₹' + rs(price.entry_paise))}
      ${cell(t(L, 'service_fee'), '₹' + rs(price.platform_paise))}
    </div>`;
  })()}
  <div class="tot"><span>${T('total_pay')}</span><span>&#8377;${rs(total)}</span></div>

  <label class="agree"><input type="checkbox" id="agree">
    <span>${T('f_agree')} — <a href="/policy" target="_blank">${T('terms_link_label')}</a></span></label>
  <div class="note">${T('f_terms_note')}</div>
  <button id="pay" disabled>${T('f_pay_now')}</button>
  <div id="perr"></div>
</div>

<script>
${clientScript(req.params.token)}
const D=${JSON.stringify({
  place_id: place.id, travel_date: req.body.travel_date,
  slot: slot.code, reg_no: p.reg_no, category_id: category.id })};
document.getElementById('agree').onchange=e=>{
  document.getElementById('pay').disabled=!e.target.checked;};
document.getElementById('pay').onclick=async()=>{
  const b=document.getElementById('pay');b.disabled=true;
  document.getElementById('perr').innerHTML='';
  const r=await wpost('confirm',Object.assign({agree:true},D));
  if(r.ok&&r.pay){location.href=r.pay;return;}
  b.disabled=false;
  document.getElementById('perr').innerHTML='<p class="err">'+(r.error||'')+'</p>';
};
</script>`;

    return res.type('html').send(shell({
      title: cfg.product_name || 'Pravesha',
      product: cfg.merchant_name || 'ServerPe App Solutions',
      header: t(L, 'f_your_booking'),
      sub: `${place.name} · ${prettyDate(req.body.travel_date, L)}`,
      body,
    }));
  } catch (e) {
    console.error('[book] review failed:', e.stack || e.message);
    return res.type('html').send(shell({
      title: 'Pravesha', product: cfg.merchant_name || 'ServerPe App Solutions',
      header: 'Pravesha', sub: '',
      body: `<div class="card"><p class="err">${esc(e.message)}</p>
             <button onclick="history.back()">${T('change_number')}</button></div>`,
    }));
  }
});

/* ───────────────────────────────────────────────────────── the API */

router.post('/book/:token/vehicle', express.json(), wireJson, async (req, res) => {
  const me = await who(req.params.token);
  if (!me || me.spent) return res.status(410).json({ ok: false, spent: me?.spent || 'invalid', error: 'This link is no longer valid. Send hi on WhatsApp to start again.' });
  const L = me.lang;

  const p = plate.parse(String(req.body?.reg_no || ''));
  if (!p.ok) return res.json({ ok: false, error: t(L, 'f_err_format') });

  let v;
  try {
    /* resolve() returns { vehicle, ok, fresh } - the row is on .vehicle. Treating
       the wrapper as the vehicle silently produced a nameless vehicle and the
       fallback category, which is the wrong entry fee. */
    v = (await vehicles.resolve(p.reg_no, { customerId: me.customer.id }))?.vehicle;
  } catch (e) {
    console.error('[book] lookup failed:', e.message);
    return res.json({ ok: false, error: t(L, 'f_err_lookup') });
  }
  if (!v) return res.json({ ok: false, error: t(L, 'f_err_notfound') });

  /* An old registration is usually not in the RC database at all, so there is
     nothing to classify and nothing to show. Rather than guess — the guess is
     always "car", and always the higher fee — offer the categories with their
     prices and let the visitor say which one they are driving.

     The choice is honoured only for a vehicle the database could not classify.
     Where the RC did answer, the category comes from the RC and the client
     cannot override it; see /confirm, which recomputes it. */
  /* Checked before anything else is offered, and for both routes below: being
     told at the payment step that this vehicle already has a ticket for the
     day is a worse experience than being told now. */
  const date = String(req.body?.travel_date || '');
  if (date) {
    const clash = await booking.existingForDate(v.id, date);
    if (clash) {
      return res.json({ ok: false,
        error: t(L, 'f_err_clash', { reg: p.reg_no, date: prettyDate(date, L) }) });
    }
  }

  const placeId = Number(req.body?.place_id);

  /* An old registration is usually not in the RC database at all, so there is
     nothing to classify and nothing to show. Rather than guess — the guess is
     always "car", and always the higher fee — offer the categories with their
     prices and let the visitor say which one they are driving.

     The choice is honoured only for a vehicle the database could not classify.
     Where the RC did answer, the category comes from the RC and the client
     cannot override it; /confirm recomputes it and ignores what was sent. */
  if (!vehicles.isClassified(v)) {
    const list = await db.query(
      `SELECT id, code, label FROM vehicle_categories WHERE is_active ORDER BY sort_order, id`);
    const types = [];
    for (const c of list.rows) {
      try {
        const pr = await pricing.priceFor(placeId, c.id);
        types.push({
          id: c.id, label: c.label,
          entry: rs(pr.entry_paise), fee: rs(pr.platform_paise),
          total: rs(pr.entry_paise + pr.platform_paise),
        });
      } catch { /* a category with no price at this place is simply not on offer */ }
    }
    if (!types.length) return res.json({ ok: false, error: t(L, 'f_err_category') });
    return res.json({ ok: true, needs_type: true, reg_pretty: p.reg_no, types,
      why: t(L, p.temporary ? 'f_type_temp' : 'f_type_ask') });
  }

  const category = await pricing.categoryForVehicle(v);
  if (!category) return res.json({ ok: false, error: t(L, 'f_err_category') });

  const price = await pricing.priceFor(placeId, category.id);
  return res.json({
    ok: true,
    reg_pretty: p.reg_no,
    vehicle: vehicles.details(v),
    description: vehicles.describe(v) || null,
    category: category.label,
    category_id: category.id,
    entry: rs(price.entry_paise),
    fee: rs(price.platform_paise),
    total: rs(price.entry_paise + price.platform_paise),
  });
});

router.post('/book/:token/slots', express.json(), wireJson, async (req, res) => {
  const me = await who(req.params.token);
  if (!me || me.spent) return res.status(410).json({ ok: false, spent: me?.spent || 'invalid', error: 'This link is no longer valid. Send hi on WhatsApp to start again.' });
  const L = me.lang;

  const date = String(req.body.travel_date);
  const cutoff = await settings.num('same_day_cutoff_minutes', 60);
  const av = await inventory.availability(
    Number(req.body.place_id), date, Number(req.body.category_id));

  return res.json({
    ok: true,
    slots: av.map((a) => {
      /* A slot that has already ended today is shown and disabled rather than
         hidden: "already over for today" tells the visitor what happened,
         whereas a missing row just looks broken. */
      const inTime = booking.slotSellable(a, date, cutoff);
      const free = Number(a.available) > 0;
      return {
        code: a.code,
        label: a.label || a.code,
        note: !inTime ? t(L, 'slot_ended')
          : !a.is_open ? (a.closed_note || t(L, 'f_slot_closed'))
          : free ? t(L, 'f_slot_left', { left: a.available, cap: a.capacity })
          : t(L, 'f_slot_full'),
        open: inTime && !!a.is_open && free,
      };
    }),
  });
});

router.post('/book/:token/confirm', express.json(), wireJson, async (req, res) => {
  const me = await who(req.params.token);
  if (!me || me.spent) return res.status(410).json({ ok: false, spent: me?.spent || 'invalid', error: 'This link is no longer valid. Send hi on WhatsApp to start again.' });
  const L = me.lang;

  if (!req.body?.agree) return res.json({ ok: false, error: t(L, 'f_agree') });

  try {
    const place = await db.one('SELECT * FROM places WHERE id = $1 AND is_active',
      [Number(req.body.place_id)]);
    const slot = await db.one('SELECT * FROM place_slots WHERE place_id = $1 AND code = $2',
      [place.id, String(req.body.slot)]);
    const p = plate.parse(String(req.body.reg_no));

    /* The whole result, not just the row. `reason` is the only place that tells
       "the database has no such vehicle" apart from "our supplier was down",
       and those are different facts: the first is expected and permanent, the
       second is temporary and, if it appears in bulk, means every booking that
       hour was self-priced. Inferring it from rc_fetched_at does not work —
       both cases leave it null. */
    const rv = await vehicles.resolve(p.reg_no, { customerId: me.customer.id });
    const vehicle = rv?.vehicle;
    if (!vehicle) return res.json({ ok: false, error: t(L, 'f_err_notfound') });

    /* THE PRICE IS DECIDED HERE, NOT BY THE BROWSER.
       This used to read category_id straight off the request, which meant
       anyone could post the two-wheeler id with a car's plate and buy a ₹57
       ticket for a ₹113 vehicle. The category now comes from the RC record,
       and the number the client sent is ignored outright.

       The one exception is a vehicle the RC database could not classify — an
       old registration, mostly — where there is nothing to derive from and the
       visitor was asked. Even then the id is looked up rather than trusted:
       it must be an active category with a price at this place. */
    let category;
    const known = vehicles.isClassified(vehicle);
    if (known) {
      category = await pricing.categoryForVehicle(vehicle);
    } else {
      category = await db.one(
        `SELECT * FROM vehicle_categories WHERE id = $1 AND is_active`,
        [Number(req.body.category_id)]);
    }
    if (!category) return res.json({ ok: false, error: t(L, 'f_err_category') });

    /* The clock is checked again here, not only when the list was drawn.
       A page can sit open on a phone for an hour, and the slot that was
       sellable when it loaded may have ended by the time Pay is tapped. */
    const cutoff = await settings.num('same_day_cutoff_minutes', 60);
    if (!booking.slotSellable(slot, String(req.body.travel_date), cutoff)) {
      return res.json({ ok: false, error: t(L, 'slot_not_sellable') });
    }

    /* A ticket whose price the visitor chose is marked as such. The gate is the
       only place anyone can see that a "two-wheeler" is in fact a Tempo
       Traveller, and the staff member cannot check what they are not told. */
    const held = await booking.hold({
      customer: me.customer, vehicle, place, slot, category,
      travelDate: String(req.body.travel_date),
      declared: !known,
      declaredReason: known ? null
        : (rv?.reason === 'lookup_failed' ? 'lookup_failed' : 'no_record'),
    });
    if (!held?.ok) return res.json({ ok: false, error: held?.reason || 'could not hold' });

    /* Spent here, not after payment: the booking exists now, and the link
       must not produce a second one while the first is still unpaid. */
    await spendToken(req.params.token, held.ticket.id);

    return res.json({ ok: true, pay: await checkout.linkFor(held.ticket) });
  } catch (e) {
    console.error('[book] confirm failed:', e.stack || e.message);
    return res.json({ ok: false, error: e.message });
  }
});

module.exports = router;
/* Shared with the support and feedback pages so all three look like one
   product rather than three pages that happen to be on the same host. */
module.exports.shell = shell;
module.exports.who = who;
module.exports.esc = esc;
module.exports.expired = expired;
