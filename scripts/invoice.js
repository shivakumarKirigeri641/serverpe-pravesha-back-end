/**
 * invoice.js — write a pass's GST invoice to a PDF, for an admin.
 *
 *   node scripts/invoice.js PRV-7K3M-9Q2A            -> ./Pravesha-Invoice-PRV-26-27-000001.pdf
 *   node scripts/invoice.js PRV-7K3M-9Q2A ./out
 *
 * Invoices are created for every paid pass but not sent to visitors. Until the
 * admin panel exists this is how one is retrieved — deliberately a command on
 * the server rather than a URL, because an invoice carries a visitor's name and
 * an unauthenticated link to it would be public to anyone who guessed one.
 */

const fs = require('fs');
const path = require('path');
const booking = require('../src/gatepass/booking');
const invoices = require('../src/gatepass/invoices');
const invoicePdf = require('../src/pdf/invoicePdf');
const { docSettings } = require('../src/whatsapp/deliver');

(async () => {
  const [passNo, outDir = '.'] = process.argv.slice(2);
  if (!passNo) {
    console.error('usage: node scripts/invoice.js <PASS-NUMBER> [output-dir]');
    process.exit(2);
  }
  const t = await booking.byTicketNo(passNo.trim().toUpperCase());
  if (!t) { console.error(`no pass ${passNo}`); process.exit(1); }

  const inv = await invoices.byTicket(t.id) || await invoices.issue(t.id);
  const pdf = await invoicePdf.render(t, inv, { settings: await docSettings() });
  const file = path.join(outDir, invoicePdf.filename(inv));
  fs.writeFileSync(file, pdf);
  console.log(`${inv.invoice_no} -> ${file}`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
