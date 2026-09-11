#!/usr/bin/env node
/**
 * seed-test-invoices.js — tax invoices for the seeded test passes.
 *
 *   node scripts/seed-test-invoices.js            issue invoices for test passes that have none
 *   node scripts/seed-test-invoices.js --remove   delete every test invoice
 *
 * Test data only, and kept apart from the real thing on purpose:
 *
 *   * only tickets flagged is_test, paid through a payment flagged is_test;
 *   * numbered TST/YY-YY/000001 from their own count, never from
 *     pravesha_invoice_seq — a GST invoice series must have no holes, and
 *     deleting test invoices numbered from it would leave hundreds;
 *   * flagged invoices.is_test, so --remove (and seed-test-data --remove) can
 *     take them out again;
 *   * dated when the payment was made, exactly as a real invoice would be.
 *
 * Nothing is sent to anyone and no vehicle is looked up.
 */

require('dotenv').config();
const { query, tx } = require('../src/gatepass/db');
const settings = require('../src/gatepass/settings');

(async () => {
  if (process.argv.includes('--remove')) {
    const r = await query('DELETE FROM invoices WHERE is_test');
    console.log(`removed ${r.rowCount} test invoices`);
    process.exit(0);
  }

  const gst = await settings.num('gst_percent_on_platform', 18);
  const sac = await settings.str('sac_code', '998559');
  const pos = await settings.str('place_of_supply', '29-Karnataka');

  const made = await tx(async (client) => {
    const r = await client.query(
      `WITH due AS (
         SELECT t.id, t.customer_id, t.entry_paise, t.platform_paise, t.total_paise, p.paid_at,
                CASE WHEN extract(month FROM p.paid_at AT TIME ZONE 'Asia/Kolkata') >= 4
                     THEN extract(year FROM p.paid_at AT TIME ZONE 'Asia/Kolkata')::int
                     ELSE extract(year FROM p.paid_at AT TIME ZONE 'Asia/Kolkata')::int - 1 END AS fy_start
           FROM tickets t
           JOIN payments p ON p.id = t.payment_id
          WHERE t.is_test AND p.is_test AND p.status = 'paid' AND p.paid_at IS NOT NULL
            AND t.status IN ('paid', 'used') AND t.total_paise > 0
            AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.ticket_id = t.id)
       ), numbered AS (
         SELECT d.*, right(fy_start::text, 2) || '-' || right((fy_start + 1)::text, 2) AS fy,
                row_number() OVER (PARTITION BY fy_start ORDER BY paid_at, id) AS rn
           FROM due d
       )
       INSERT INTO invoices (invoice_no, ticket_id, customer_id, entry_paise, service_paise, taxable_paise,
                             gst_paise, total_paise, gst_percent, place_of_supply, sac_code, issued_at, is_test)
       SELECT 'TST/' || n.fy || '/' || lpad((n.rn + (SELECT count(*) FROM invoices i WHERE i.is_test AND i.invoice_no LIKE 'TST/' || n.fy || '/%'))::text, 6, '0'),
              n.id, n.customer_id, n.entry_paise, n.platform_paise,
              round(n.platform_paise * 100.0 / (100 + $1))::int,
              n.platform_paise - round(n.platform_paise * 100.0 / (100 + $1))::int,
              n.total_paise, $1, $3, $2, n.paid_at, true
         FROM numbered n`, [gst, sac, pos]);
    return r.rowCount;
  });

  const [s] = (await query(`SELECT count(*) AS n, min(invoice_no) AS first, max(invoice_no) AS last FROM invoices WHERE is_test`)).rows;
  console.log(`issued ${made} test invoices · ${s.n} in all · ${s.first} … ${s.last}`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
