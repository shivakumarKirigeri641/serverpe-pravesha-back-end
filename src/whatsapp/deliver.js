/**
 * deliver.js — the pass, into the chat, once it is paid for.
 *
 * Two messages, in this order: the pass itself written out as a message, then
 * the PDF. The message is what the visitor reads the moment they come back to
 * WhatsApp; the PDF is what they keep. Sending the PDF alone would leave them
 * opening a document to learn which date they booked.
 *
 * RUNS ONCE PER PASS. The browser callback, the webhook and the reconciler can
 * all confirm the same payment; only the call that actually turned the hold into
 * a pass delivers it, and a record in event_log makes a second delivery of the
 * same pass visible rather than silent.
 *
 * THE INVOICE IS CREATED FOR EVERY PASS AND NOT SENT. Each paid pass gets its
 * GST invoice and its number in the series at once, so the series stays
 * unbroken and the invoice is ready for the admin panel. Whether visitors also
 * receive it on WhatsApp is for the department to decide at the demo; turning
 * that on is the setting send_invoice = 'true'.
 */

const { query } = require('../gatepass/db');
const booking = require('../gatepass/booking');
const settings = require('../gatepass/settings');
const vehicle = require('../gatepass/vehicle');
const slotTime = require('../gatepass/slotTime');
const passPdf = require('../pdf/passPdf');
const { longDate, rupee } = require('../pdf/common');
const send = require('./send');
const phone = require('./phone');
const { t: tr, langOf } = require('../i18n');
const L = require('../localize');

async function docSettings() {
  return {
    productTagline: await settings.str('product_tagline', 'Entry made simple.'),
    productTaglineKn: await settings.str('product_tagline_kn', null),
    vendorTagline: await settings.str('vendor_tagline', 'Smart Clicks, Smart Taps.'),
    website: await settings.str('website', 'www.serverpe.in'),
    gstPercent: await settings.num('gst_percent_on_platform', 18),
    legalName: await settings.str('legal_name', 'ServerPe App Solutions'),
    address: await settings.str('business_address', ''),
    gstin: await settings.str('gstin', ''),
    udyam: await settings.str('udyam_number', ''),
    email: await settings.str('contact_email', ''),
    feeLabel: await settings.str('fee_label', 'Service & convenience fee'),
  };
}

/* By pass number: nothing personal in a URL that becomes a QR and a button. */
const verifyUrl = (t) =>
  `${(process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '')}${require('../config/paths').PASS_DETAILS_PATH}/${encodeURIComponent(t.ticket_no)}`;

/** The pass written as a WhatsApp message, in the visitor's chosen language. */
function passMessage(t, lang, { resend = false } = {}) {
  const d = vehicle.details(t);
  const type = L.vehicleType(t, lang);
  const last = slotTime.hhmm(slotTime.toMinutes(t.ends_at) - slotTime.LAST_ENTRY_BUFFER_MIN);
  const car = [d.make, d.model].filter(Boolean).join(' ');
  const rule = '━━━━━━━━━━━━━━━━━━';

  return [
    resend ? tr('passResent', lang) : tr('passConfirmed', lang),
    '',
    rule,
    tr('passTitle', lang),
    rule,
    `*${tr('passNo', lang)}:* *${t.ticket_no}*`,
    `*${tr('passStatus', lang)}:* ${t.status === 'used' ? tr('passUsedStatus', lang) : tr('passValid', lang)}`,
    '',
    tr('secVehicle', lang),
    `*${t.reg_no}*${car ? ` · ${car}` : ''}`,
    `${tr('vehType', lang)}: ${type}`,
    '',
    tr('secVisit', lang),
    L.placeWithDistrict(t, lang),
    `📅 ${L.longDate(t.travel_date, lang)}`,
    `🕐 ${L.slotLabel(t, lang)}`,
    `⏳ ${tr('lastEntry', lang)} ${L.clock(last, lang)}`,
    '',
    tr('secPayment', lang),
    `${tr('entryFee', lang)}: ${rupee(t.entry_paise)}`,
    `${tr('platformFee', lang)}: ${rupee(t.platform_paise)}`,
    `*${tr('totalPaid', lang)}: ${rupee(t.total_paise)}* · ${passPdf.paymentMethod(t.payment_raw, lang)}`,
    `${tr('paymentId', lang)}: ${t.gateway_payment_id || '—'}`,
    '',
    tr('secCheckpost', lang),
    tr('checkpostNote', lang),
    '',
    tr('pdfAttached', lang),
  ].join('\n');
}

async function deliverTicket(ticketId) {
  const t = await booking.byId(ticketId);
  if (!t) return { ok: false, reason: 'not_found' };
  if (t.status !== 'paid' && t.status !== 'used') return { ok: false, reason: `status_${t.status}` };

  /* Issued before anything is sent: the invoice is a record of the sale, not
     of the delivery, and a pass whose message fails still had a sale. A failure
     here is logged and must not stop the visitor receiving their pass. */
  let invoice = null;
  try {
    invoice = await require('../gatepass/invoices').issue(t.id);
  } catch (e) {
    console.error('[deliver] invoice not issued for %s: %s', t.ticket_no, e.message);
    await logEvent(t, 'invoice_failed', { error: e.message });
  }

  const to = phone.toWa(t.mobile);
  const lang = langOf((await query('SELECT language FROM customers WHERE id = $1', [t.customer_id])).rows[0]);

  if (!await send.windowOpen(to)) {
    /* Outside WhatsApp's 24-hour window a free-form message is refused. The pass
       is valid regardless -- entry is by number plate -- so this is logged for a
       template follow-up rather than treated as a failed booking. */
    await logEvent(t, 'pass_delivery_window_closed', {});
    console.warn('[deliver] 24h window closed for %s, pass %s not sent', t.mobile, t.ticket_no);
    return { ok: false, reason: 'window_closed' };
  }

  const s = await docSettings();
  const msg = await send.text(to, passMessage(t, lang));

  const pdf = await passPdf.render(t, { settings: s, verifyUrl: verifyUrl(t), lang });
  const doc = await send.document(to, pdf, {
    filename: passPdf.filename(t),
    caption: tr('pdfCaption', lang, { ticket: t.ticket_no, plate: t.reg_no, date: L.longDate(t.travel_date, lang) }),
  });

  if (invoice && String(await settings.str('send_invoice', 'false')) === 'true') {
    await sendInvoice(t, invoice, to, s);
  }

  await logEvent(t, 'pass_delivered', { message: msg.ok, pdf: doc.ok, pdf_error: doc.error || null,
    invoice_no: invoice ? invoice.invoice_no : null });
  return { ok: msg.ok && doc.ok, message: msg, document: doc };
}

/**
 * The same pass again, on request from "My passes".
 *
 * Deliberately not deliverTicket(): that one issues the invoice and records the
 * sale's delivery, and neither should happen twice because a visitor looked
 * their pass up. This only renders and sends — from the database as it is now,
 * so a pass that has since been used says so.
 */
async function resendPass(ticketId) {
  const t = await booking.byId(ticketId);
  if (!t || (t.status !== 'paid' && t.status !== 'used')) return { ok: false, reason: 'not_found' };

  const to = phone.toWa(t.mobile);
  const lang = langOf((await query('SELECT language FROM customers WHERE id = $1', [t.customer_id])).rows[0]);
  const s = await docSettings();

  const msg = await send.text(to, passMessage(t, lang, { resend: true }));
  const pdf = await passPdf.render(t, { settings: s, verifyUrl: verifyUrl(t), lang });
  const doc = await send.document(to, pdf, {
    filename: passPdf.filename(t),
    caption: tr('pdfCaption', lang, { ticket: t.ticket_no, plate: t.reg_no, date: L.longDate(t.travel_date, lang) }),
  });

  await logEvent(t, 'pass_resent', { message: msg.ok, pdf: doc.ok });
  return { ok: msg.ok && doc.ok };
}

async function sendInvoice(t, inv, to, s) {
  const invoicePdf = require('../pdf/invoicePdf');
  const pdf = await invoicePdf.render(t, inv, { settings: s });
  return send.document(to, pdf, { filename: invoicePdf.filename(inv), caption: `Tax invoice ${inv.invoice_no}` });
}

async function logEvent(t, kind, detail) {
  try {
    await query('INSERT INTO event_log (customer_id, kind, detail) VALUES ($1, $2, $3)',
      [t.customer_id, kind, JSON.stringify({ ticket_id: t.id, ticket_no: t.ticket_no, ...detail })]);
  } catch { /* the log is for us; it must not undo a delivered pass */ }
}

module.exports = { deliverTicket, resendPass, passMessage, docSettings, verifyUrl };
