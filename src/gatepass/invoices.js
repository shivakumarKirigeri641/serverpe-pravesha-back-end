/**
 * invoices.js — one GST invoice per paid pass, from an unbroken series.
 *
 * NO HOLES, NO REPEATS. A GST invoice series is audited for both. nextval() is
 * atomic, so no two invoices can share a number under any load. The subtler
 * failure is the hole: INSERT ... VALUES (nextval(...)) ON CONFLICT DO NOTHING
 * still consumes a number when the conflict fires, and the callback, webhook
 * and reconciler all arrive for the same payment. So the ticket row is locked
 * first and the existing invoice looked for under that lock; a number is drawn
 * only when an invoice is actually about to be written.
 *
 * THE AMOUNTS ARE STORED, NOT RECOMPUTED. An invoice states what was charged on
 * the day under the rates in force that day. Deriving it later from current
 * settings would quietly rewrite history the first time the fee changes.
 */

const { one, tx } = require('./db');
const settings = require('./settings');

/** April-to-March, in IST: an invoice issued at 00:30 on 1 April belongs to the new year. */
function financialYear(at = new Date()) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' })
    .formatToParts(at).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
  const y = Number(p.year);
  const start = Number(p.month) >= 4 ? y : y - 1;
  return `${String(start).slice(-2)}-${String(start + 1).slice(-2)}`;
}

/**
 * "PRV/26-27/000001" — sixteen characters, the most a GST invoice number may
 * carry, using only the separators the rules allow.
 */
const formatNo = (seq, at, prefix = 'PRV') => `${prefix}/${financialYear(at)}/${String(seq).padStart(6, '0')}`;

async function issue(ticketId) {
  const gstPct = await settings.num('gst_percent_on_platform', 18);
  const sac = await settings.str('sac_code', '998559');
  const pos = await settings.str('place_of_supply', '29-Karnataka');
  /* The prefix is a setting; its length is validated where it is changed, so the
     number stays within the sixteen characters a GST invoice number may carry. */
  const prefix = await settings.str('invoice_prefix', 'PRV');
  /* The supplier as at issue, frozen on the row like the amounts (062): no PDF
     is kept, so this is what every later rendering of the invoice shows. */
  const supplier = {
    legalName: await settings.str('legal_name', 'ServerPe App Solutions'),
    address: await settings.str('business_address', ''),
    gstin: await settings.str('gstin', ''),
    udyam: await settings.str('udyam_number', ''),
    email: await settings.str('contact_email', ''),
    website: await settings.str('website', 'www.serverpe.in'),
  };

  return tx(async (client) => {
    const t = (await client.query('SELECT * FROM tickets WHERE id = $1 FOR UPDATE', [ticketId])).rows[0];
    if (!t) throw new Error(`invoice: no ticket ${ticketId}`);
    if (t.status !== 'paid' && t.status !== 'used') throw new Error(`invoice: ticket ${ticketId} is ${t.status}`);

    const existing = (await client.query('SELECT * FROM invoices WHERE ticket_id = $1', [ticketId])).rows[0];
    if (existing) return existing;

    const seq = (await client.query("SELECT nextval('pravesha_invoice_seq') AS n")).rows[0].n;
    const service = Number(t.platform_paise);
    const taxable = Math.round(service * 100 / (100 + gstPct));

    const r = await client.query(
      `INSERT INTO invoices (invoice_no, ticket_id, customer_id, entry_paise, service_paise,
                             taxable_paise, gst_paise, total_paise, gst_percent, place_of_supply, sac_code, supplier)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [formatNo(seq, undefined, prefix), t.id, t.customer_id, t.entry_paise, service, taxable, service - taxable,
       t.total_paise, gstPct, pos, sac, JSON.stringify(supplier)]);
    return r.rows[0];
  });
}

const byTicket = (ticketId) => one('SELECT * FROM invoices WHERE ticket_id = $1', [ticketId]);

module.exports = { issue, byTicket, formatNo, financialYear };
