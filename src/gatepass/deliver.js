/**
 * deliver.js — turning a paid ticket into something a person can show.
 *
 * Three artefacts, because the gate and the accountant need different things:
 *
 *   * A TICKET CARD image, sent into the chat. It is a receipt, not a
 *     credential: the visitor shows nothing at the barrier, and this exists so
 *     they can check before setting off that the booking is for the right
 *     vehicle on the right day.
 *   * A TICKET PDF, for anyone who wants to print it or keep it, carrying the
 *     full conditions that will not fit on a phone-screen card.
 *   * A TAX INVOICE PDF — a separate document, built in invoicePdf.js. It was
 *     once a few lines at the foot of the ticket, which served neither reader:
 *     clutter at a barrier, and short of the particulars a tax invoice must
 *     carry. The entry fee appears there as a pure-agent reimbursement outside
 *     the taxable value, with GST on our service fee alone.
 *
 * Sending is idempotent. The three payment paths all end here, and a visitor
 * must not receive three tickets for one booking.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const PDFDocument = require('pdfkit');
const { query, one } = require('./db');
const pricing = require('./pricing');
const settings = require('./settings');
const send = require('../whatsapp/send');
const ticketCard = require('./ticketCard');
const store = require('../whatsapp/store');
const { invoicePdf } = require('./invoicePdf');
const { t: tr } = require('./i18n');

const INK = '#111827';
const MUTED = '#6b7280';
const RULE = '#d1d5db';
const ACCENT = '#0f766e';

const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['January', 'February', 'March', 'April', 'May', 'June',
             'July', 'August', 'September', 'October', 'November', 'December'];

function longDate(d) {
  const [y, m, day] = String(d).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  return `${DAY[dt.getUTCDay()]}, ${day} ${MON[m - 1]} ${y}`;
}

/** A place name that is safe in a filename: 'Mullayanagiri' from anything. */
const slug = (s) => String(s || 'Ticket').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');

const spaced = (reg) => String(reg).replace(/([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})/, '$1 $2 $3 $4').replace(/\s+/g, ' ').trim();

/* ─────────────────────────────────────────────────────────────────── PDF */

async function ticketPdf(t) {
  const dir = path.join(os.tmpdir(), 'serverpe-tickets');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `ticket-${t.ticket_no}.pdf`);

  const cfg = await settings.all();

  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  const stream = fs.createWriteStream(file);
  doc.pipe(stream);

  const W = 595.28;
  const M = 48;

  /* Header band */
  doc.rect(0, 0, W, 96).fill(ACCENT);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20)
     .text(t.place_name.toUpperCase(), M, 30);
  doc.font('Helvetica').fontSize(10)
     .text('VEHICLE ENTRY TICKET', M, 56, { characterSpacing: 2 });
  doc.font('Helvetica').fontSize(9)
     .text(cfg.collecting_for || 'Karnataka Tourism Department', M, 74);

  /* The booking code for support to quote, and the plate the gate looks up */
  let y = 128;
  doc.fillColor(MUTED).font('Helvetica').fontSize(9)
     .text('TICKET NUMBER', M, y, { characterSpacing: 1.5 });
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(30)
     .text(t.ticket_no, M, y + 14, { characterSpacing: 3 });

  /* The plate, printed large enough to check against a bumper from the
     driver's seat. It is the only thing the gate reads. */
  doc.rect(W - M - 200, y - 10, 200, 92).fill('#f4f8f7');
  doc.fillColor(MUTED).font('Helvetica').fontSize(7.5)
     .text('VEHICLE NUMBER', W - M - 200, y + 4, { width: 200, align: 'center', characterSpacing: 1.4 });
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(23)
     .text(t.reg_no, W - M - 200, y + 24, { width: 200, align: 'center' });
  doc.fillColor(MUTED).font('Helvetica').fontSize(7.5)
     .text('Nothing to show at the gate', W - M - 200, y + 60, { width: 200, align: 'center' });

  /* Details */
  y = 232;
  const row = (label, value, bold = false) => {
    doc.fillColor(MUTED).font('Helvetica').fontSize(8.5)
       .text(label.toUpperCase(), M, y, { characterSpacing: 1.2 });
    doc.fillColor(INK).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 15 : 12)
       .text(value, M, y + 12, { width: 300 });
    y += bold ? 44 : 40;
  };

  row('Vehicle number', t.reg_no, true);
  row('Vehicle type', t.category_label);
  row('Travel date', longDate(t.travel_date), true);
  row('Entry time', t.slot_label);

  /* Money, split the way it must be reported */
  y += 8;
  doc.moveTo(M, y).lineTo(W - M, y).lineWidth(0.5).strokeColor(RULE).stroke();
  y += 18;

  const money = (label, amount, bold = false) => {
    doc.fillColor(bold ? INK : MUTED).font(bold ? 'Helvetica-Bold' : 'Helvetica')
       .fontSize(bold ? 12 : 10)
       .text(label, M, y, { width: 320 });
    doc.fillColor(INK).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 10)
       .text(`Rs. ${pricing.rs(amount)}`, W - M - 120, y, { width: 120, align: 'right' });
    y += bold ? 22 : 18;
  };

  money(`Entry fee (collected for ${cfg.collecting_for || 'Karnataka Tourism Department'})`, t.entry_paise);
  money('Service fee (incl. GST)', t.platform_paise);
  doc.moveTo(M, y + 2).lineTo(W - M, y + 2).lineWidth(0.5).strokeColor(RULE).stroke();
  y += 12;
  money('Total paid', t.total_paise, true);

  doc.fillColor(MUTED).font('Helvetica').fontSize(7.5)
     .text(`GST of Rs. ${pricing.rs(t.gst_paise)} is included in the service fee. `
         + 'The entry fee is collected on behalf of the department as a pure agent '
         + 'and is not part of the taxable value.', M, y + 6, { width: W - M * 2 });

  /* Rules — short, and only the ones that get argued about at the gate */
  y += 46;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text('PLEASE NOTE', M, y, { characterSpacing: 1.2 });
  y += 14;
  const notes = [
    'The checkpost checks only your vehicle number. Make sure you booked with the number '
      + 'plate of the vehicle you will actually bring.',
    'Do not change the vehicle at the last moment. This number is what the staff enter and '
      + 'validate at the checkpost — a different vehicle will not be allowed in.',
    'There is nothing to show at the gate. Let the staff member enter your vehicle number, '
      + 'and you can move on.',
    'This ticket is valid only for the vehicle number and the date and time shown above.',
    'One entry per vehicle per day.',
  ];
  /* Advanced by where each note actually ended, not by a fixed step: these
     wrap to two lines and a fixed 14 points printed the next one on top. */
  for (const n of notes) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(8.5)
       .text(`•  ${n}`, M, y, { width: W - M * 2, lineGap: 1 });
    y = doc.y + 5;
  }

  /* Footer */
  doc.rect(0, 780, W, 62).fill('#f3f4f6');
  doc.fillColor(MUTED).font('Helvetica').fontSize(8)
     .text(`Reference: ${t.reference_id}`, M, 796, { width: W - M * 2 });
  doc.fillColor(MUTED).font('Helvetica').fontSize(8)
     .text(`Issued ${new Date().toLocaleString('en-IN')}   ·   Support ${cfg.support_mobile || ''}`,
           M, 810, { width: W - M * 2 });
  doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(8)
     .text(`Powered by ${cfg.merchant_name || 'ServerPe App Solutions'}`, M, 824, { width: W - M * 2 });

  doc.end();
  await new Promise((res, rej) => { stream.on('finish', res); stream.on('error', rej); });
  return file;
}

/* ─────────────────────────────────────────────────────────────── sending */

/**
 * Send the ticket to the customer.
 *
 * Guarded by an event_log entry rather than a column, because the guard has to
 * survive a redeploy and be visible when someone asks "was it sent?". A second
 * call returns quietly.
 */
async function sendTicket(ticketId, { force = false } = {}) {
  const t = await one(
    `SELECT t.*, p.name AS place_name, s.label AS slot_label, c.label AS category_label,
            cu.language, cu.wa_profile_name AS customer_name,
            pay.payment_id AS payment_ref, pay.order_id, pay.gateway
       FROM tickets t
       JOIN places p ON p.id = t.place_id
       JOIN place_slots s ON s.id = t.slot_id
       JOIN vehicle_categories c ON c.id = t.category_id
       LEFT JOIN customers cu ON cu.id = t.customer_id
       LEFT JOIN payments pay ON pay.id = t.payment_id
      WHERE t.id = $1`, [ticketId]);

  if (!t) return { ok: false, reason: 'not_found' };
  if (t.status !== 'paid' && t.status !== 'used') return { ok: false, reason: 'not_paid' };

  if (!force) {
    const sent = await one(
      `SELECT 1 FROM event_log
        WHERE kind = 'ticket_sent' AND detail->>'ticket_no' = $1 LIMIT 1`, [t.ticket_no]);
    if (sent) return { ok: true, already: true };
  }

  /* The caption is in the visitor's language; the PDF and the ticket card are
     not touched. Those two are shown to a uniformed officer at the barrier and
     are deliberately bilingual — the officer and the visitor may not share a
     language, and the ticket has to be readable by both. */
  const L = t.language === 'en' ? 'en' : 'kn';

  const caption =
    `🎟️ *${tr(L, 'ticket_word')} ${t.ticket_no}*\n\n`
    + `${t.reg_no}  ·  ${t.category_label}\n`
    + `${longDate(t.travel_date)}\n${t.slot_label}\n${t.place_name}\n\n`
    + tr(L, 'gate_instruction');

  // A composed card rather than a bare summary: it has to look like a
  // government ticket to the relative who asks whether it is genuine.
  const png = await ticketCard.render(t, await settings.all());
  const img = await send.image(t.mobile, png, { filename: `${t.ticket_no}.png`, caption });

  let pdf = null;
  try {
    const file = await ticketPdf(t);
    pdf = await send.document(t.mobile, file, {
      filename: `${slug(t.place_name)}-${t.ticket_no}.pdf`,
      caption: tr(L, 'ticket_and_receipt'),
    });
  } catch (e) {
    // A PDF that failed to render must not cost the customer their ticket —
    // and in any case nothing they hold is what gets them through the gate.
    console.error('[deliver] pdf failed:', e.message);
  }

  /* The tax invoice, as a second document.
     Sent after the ticket, never instead of it, and wrapped separately for the
     same reason: an invoice that fails to render is an accounting inconvenience
     the visitor can be sent later. The invoice ROW is created either way — the
     number is reserved and the amounts are frozen even if the PDF or the send
     fails, so a resend produces the same document rather than a new one. */
  let invoice = null;
  try {
    const { file, invoice: row } = await invoicePdf(t);
    invoice = await send.document(t.mobile, file, {
      filename: `Invoice-${row.invoice_no.replace(/\//g, '-')}.pdf`,
      caption: tr(L, 'invoice_caption'),
    });
  } catch (e) {
    console.error('[deliver] invoice failed:', e.message);
  }

  await query(
    `INSERT INTO event_log (customer_id, kind, detail) VALUES ($1, 'ticket_sent', $2)`,
    [t.customer_id, JSON.stringify({
      ticket_no: t.ticket_no, reg_no: t.reg_no, travel_date: t.travel_date,
      image_ok: !!img?.ok, pdf_ok: !!pdf?.ok, invoice_ok: !!invoice?.ok })]);

  /* No "Book another".
     One vehicle may hold one ticket per day, so offering another booking
     immediately after issuing one offers something the rules will refuse. What
     is worth asking at this moment is whether it was easy — the visitor has
     just been all the way through, and this is the only point where they can
     answer from memory rather than from recollection. */
  await send.text(t.mobile, `${tr(L, 'safe_journey')}\n\n${tr(L, 'feedback_ask')}`)
    .catch(() => {});

  /* The state is only moved if the visitor is still where the payment left
     them. This runs from the payment webhook, minutes after the fact and
     entirely outside the conversation — by now they may have gone back to the
     menu and asked for support, and dropping "feedback_message" on top of that
     would send their support question into the feedback log instead.
     Compare first, then set. */
  try {
    const s = await store.get(t.mobile);
    if (!s || s.state === 'awaiting_payment' || s.state === 'menu' || s.state === 'idle') {
      await store.setState(t.mobile, 'feedback_message', {});
    }
  } catch { /* the prompt still went out; the state is a convenience */ }

  return { ok: true, image: img, pdf, invoice };
}

module.exports = { sendTicket, ticketPdf, longDate, spaced };
