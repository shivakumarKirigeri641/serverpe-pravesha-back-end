/**
 * verify.js — what the QR on a pass opens. Information only: entry is decided
 * at the checkpost by the vehicle number, and nothing here is part of that.
 *
 * Read from the database at the moment of scanning, never from anything printed
 * on the pass. A PDF can be edited; this page cannot, so the only thing a scan
 * can ever show is the truth as it stands now — paid, used, cancelled, or no
 * such pass.
 *
 * It shows what the barrier needs and nothing else: vehicle number, date, slot,
 * destination and status. No name and no phone number. Anyone who scans a
 * photographed pass learns which vehicle it is for, which is already painted on
 * the vehicle.
 */

const express = require('express');
const booking = require('../gatepass/booking');
const { details } = require('../gatepass/vehicle');
const { longDate } = require('../pdf/common');

const router = express.Router();

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STATE = {
  paid: { label: 'VALID', color: '#0b7a3f', bg: '#e7f8ef', note: 'This pass is paid and valid for the date and slot below.' },
  used: { label: 'ALREADY USED', color: '#8a5a00', bg: '#fff6e5', note: 'This pass has already been used for entry.' },
  cancelled: { label: 'CANCELLED', color: '#b91c1c', bg: '#fdeaea', note: 'This pass has been cancelled and is not valid.' },
  expired: { label: 'NOT VALID', color: '#b91c1c', bg: '#fdeaea', note: 'This booking was never paid for. It is not a valid pass.' },
  held: { label: 'NOT VALID', color: '#b91c1c', bg: '#fdeaea', note: 'Payment for this booking has not been completed.' },
};

/*
 * Addressed by PASS NUMBER, not booking reference.
 *
 * The reference was the first choice and was wrong for a public link: it spells
 * out the last four digits of the visitor's phone number, the plate and the
 * date, in a URL that is printed as a QR and sent in a WhatsApp button. The
 * pass number carries nothing personal, is shorter (a less dense QR, which scans
 * more reliably off a phone screen in sunlight) and is not guessable at 31^8.
 *
 * Case and stray slashes are forgiven: a code read aloud and typed, or mangled
 * by a messaging app, still finds its pass. Old reference links keep working.
 */
const { PASS_DETAILS_PATH } = require('../config/paths');

router.get([`${PASS_DETAILS_PATH}/:code`, `${PASS_DETAILS_PATH}/:code/`, '/v/:code', '/v/:code/'], async (req, res) => {
  const code = decodeURIComponent(String(req.params.code || '')).trim().toUpperCase();
  let t = null;
  try {
    /* A pass number in any spelling — PRV7K3M9Q2A, PRV-7K3M-9Q2A, lower case —
       else an old booking-reference link. */
    t = /^PRV[0-9A-Z]{8}$/.test(code.replace(/[^0-9A-Z]/g, ''))
      ? await booking.byTicketNo(code)
      : await booking.byReference(code);
  } catch { t = null; }

  const shell = (inner) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Pass details · Pravesha</title>
<style>
body{margin:0;background:#efeae2;color:#111b21;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:460px;margin:0 auto}
header{background:#075e54;color:#fff;padding:16px 20px}
header b{font-size:18px}header div{font-size:12px;opacity:.85}
.card{background:#fff;border-radius:14px;margin:16px;padding:18px;border:1px solid #e9edef}
.status{border-radius:12px;padding:14px;text-align:center;font-weight:800;font-size:22px;letter-spacing:.08em}
.note{text-align:center;font-size:14px;color:#667781;margin:8px 0 14px}
table{width:100%;border-collapse:collapse;font-size:14.5px}
th,td{border:1px solid #e9edef;padding:9px 11px;text-align:left}
th{background:#f3f6f7;color:#667781;font-weight:500;width:42%}
td{font-weight:600}
.plate{letter-spacing:0}
footer{text-align:center;font-size:12px;color:#667781;padding:10px 16px 24px}
</style></head><body><div class="wrap">
<header><b>Pravesha</b><div>Department of Tourism, Government of Karnataka</div></header>
${inner}
<footer>Checked ${esc(new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }))} IST<br>
Pravesha is a product of ServerPe App Solutions</footer></div></body></html>`;

  if (!t) {
    return res.status(404).type('html').send(shell(`<div class="card">
      <div class="status" style="background:#fdeaea;color:#b91c1c">NO SUCH PASS</div>
      <p class="note">No pass matches this code. It may have been altered.</p></div>`));
  }

  const st = STATE[t.status] || STATE.expired;
  const d = details(t);
  res.type('html').send(shell(`<div class="card">
    <div class="status" style="background:${st.bg};color:${st.color}">${st.label}</div>
    <p class="note">${st.note}</p>
    <table>
      <tr><th>Pass number</th><td>${esc(t.ticket_no)}</td></tr>
      ${t.pass_kind === 'person'
    /* A per-person pass (056): how many people, and no vehicle. */
    ? `<tr><th>Visitors</th><td>${esc(require('../localize').persons(t.persons, 'en'))}</td></tr>`
    : `<tr><th>Vehicle number</th><td class="plate">${esc(t.reg_no)}</td></tr>
      <tr><th>Vehicle</th><td>${esc([d.make, d.model].filter(Boolean).join(' ') || '—')}</td></tr>`}
      <tr><th>Destination</th><td>${esc(t.place_name)}</td></tr>
      <tr><th>Date of visit</th><td>${esc(longDate(t.travel_date))}</td></tr>
      <tr><th>Time slot</th><td>${esc(t.slot_label)}</td></tr>
    </table>
    <p class="note" style="margin:14px 0 0;font-size:12.5px">${t.pass_kind === 'person'
    ? 'For information only. Show this pass number at the checkpost &mdash; staff confirm how many of you are entering.'
    : 'For information only. Entry is by vehicle number &mdash; checkpost staff record your vehicle at the gate.'}</p></div>`));
});

module.exports = router;
