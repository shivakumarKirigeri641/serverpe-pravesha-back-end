/**
 * verify.js — what the QR on a pass opens.
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

router.get('/v/:ref', async (req, res) => {
  let t = null;
  try { t = await booking.byReference(String(req.params.ref)); } catch { t = null; }

  const shell = (inner) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Pass verification · Pravesha</title>
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
.plate{font-family:ui-monospace,Menlo,monospace;letter-spacing:.12em}
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
      <tr><th>Vehicle number</th><td class="plate">${esc(t.reg_no)}</td></tr>
      <tr><th>Vehicle</th><td>${esc([d.make, d.model].filter(Boolean).join(' ') || '—')}</td></tr>
      <tr><th>Destination</th><td>${esc(t.place_name)}</td></tr>
      <tr><th>Date of visit</th><td>${esc(longDate(t.travel_date))}</td></tr>
      <tr><th>Time slot</th><td>${esc(t.slot_label)}</td></tr>
    </table></div>`));
});

module.exports = router;
