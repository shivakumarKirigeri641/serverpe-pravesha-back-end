#!/usr/bin/env node
/**
 * seed-test-payments.js — settlement, refund and pending-payment history for
 * the seeded test data, so Payments & Settlements has something to show.
 *
 *   node scripts/seed-test-payments.js            add it
 *   node scripts/seed-test-payments.js --remove   take it all back out
 *
 * Touches only rows flagged is_test. Nothing is sent to Razorpay, WhatsApp or
 * anyone else; no vehicle is looked up. What it does:
 *
 *   * settles every test payment older than two days, T+2 at 11:00 IST, one
 *     settlement id and UTR per day — the way Razorpay batches them;
 *   * links the failed test payments to the abandoned (expired) test passes
 *     of the same visitor, and leaves a few abandoned checkouts pending;
 *   * refunds a handful of skipped past passes in full (destination closed)
 *     and a few more in part (entry fee only), marking fully refunded passes
 *     cancelled — the original status is kept in raw so --remove restores it;
 *   * records weekly remittances of entry fees to the Tourism Department,
 *     Monday to Sunday, paid the following Tuesday, up to the last full week.
 */

require('dotenv').config();
const { query, tx } = require('../src/gatepass/db');
const slotTime = require('../src/gatepass/slotTime');

const shift = (date, days) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

async function remove() {
  await tx(async (c) => {
    const restored = await c.query(
      `UPDATE tickets t SET status = p.raw->'seeded_refund'->>'ticket_status', modified_at = now()
         FROM payments p
        WHERE p.is_test AND p.raw ? 'seeded_refund' AND t.payment_id = p.id AND t.is_test`);
    const refunds = await c.query(
      `UPDATE payments SET status = 'paid', refunded_paise = 0, refunded_at = NULL, refund_id = NULL, refund_reason = NULL,
              raw = raw - 'seeded_refund'
        WHERE is_test AND raw ? 'seeded_refund'`);
    const pending = await c.query(`DELETE FROM payments WHERE is_test AND raw->>'seeded' = 'pending'`);
    const links = await c.query(`UPDATE payments SET raw = raw - 'ticket_id' - 'seeded_link' WHERE is_test AND raw ? 'seeded_link'`);
    const settled = await c.query(`UPDATE payments SET settlement_id = NULL, settlement_utr = NULL, settled_at = NULL WHERE is_test AND settlement_id LIKE 'setl_TEST%'`);
    const remit = await c.query('DELETE FROM department_remittances WHERE is_test');
    console.log(`restored ${restored.rowCount} passes · reverted ${refunds.rowCount} refunds · removed ${pending.rowCount} pending · unlinked ${links.rowCount} failed · unsettled ${settled.rowCount} · removed ${remit.rowCount} remittances`);
  });
}

async function seed() {
  const today = slotTime.nowIST().date;

  await tx(async (c) => {
    /* 1. Settlements: T+2 at 11:00 IST. */
    const settled = await c.query(
      `UPDATE payments p
          SET settled_at = (((p.paid_at AT TIME ZONE 'Asia/Kolkata')::date + 2) + time '11:00') AT TIME ZONE 'Asia/Kolkata',
              settlement_id = 'setl_TEST' || to_char((p.paid_at AT TIME ZONE 'Asia/Kolkata')::date + 2, 'YYYYMMDD'),
              settlement_utr = 'TESTUTR' || to_char((p.paid_at AT TIME ZONE 'Asia/Kolkata')::date + 2, 'YYYYMMDD')
        WHERE p.is_test AND p.status IN ('paid', 'refunded') AND p.settled_at IS NULL
          AND (p.paid_at AT TIME ZONE 'Asia/Kolkata')::date + 2 <= $1::date`, [today]);

    /* 2. Failed payments belong to an abandoned pass of the same visitor. */
    const linked = await c.query(
      `WITH pairs AS (
         SELECT DISTINCT ON (p.id) p.id AS payment_id, t.id AS ticket_id
           FROM payments p
           JOIN tickets t ON t.customer_id = p.customer_id AND t.is_test AND t.status = 'expired'
          WHERE p.is_test AND p.status = 'failed' AND NOT (p.raw ? 'ticket_id')
          ORDER BY p.id, abs(extract(epoch FROM t.created_at - p.created_at)))
       UPDATE payments p SET raw = p.raw || jsonb_build_object('ticket_id', pairs.ticket_id, 'seeded_link', true)
         FROM pairs WHERE p.id = pairs.payment_id`);

    /* 3. A few checkouts opened and never finished. */
    const pending = await c.query(
      `INSERT INTO payments (customer_id, amount_paise, entry_paise, platform_paise, gst_paise, status, created_at, raw, is_test)
       SELECT t.customer_id, t.total_paise, t.entry_paise, t.platform_paise, t.gst_paise, 'created',
              now() - (row_number() OVER (ORDER BY t.id)) * interval '17 minutes',
              jsonb_build_object('ticket_id', t.id, 'seeded', 'pending'), true
         FROM tickets t
        WHERE t.is_test AND t.status = 'paid' AND t.travel_date >= $1::date
          AND NOT EXISTS (SELECT 1 FROM payments x WHERE x.is_test AND x.raw->>'seeded' = 'pending')
        ORDER BY md5(t.id::text) LIMIT 12`, [today]);

    /* Refunds are seeded once: a second run must not refund more passes. */
    const refundedBefore = Number((await c.query(`SELECT count(*) AS n FROM payments WHERE is_test AND raw ? 'seeded_refund'`)).rows[0].n);
    const refundLimit = (n) => (refundedBefore ? 0 : n);

    /* 4. Full refunds: skipped past passes, destination closed. */
    const full = await c.query(
      `WITH pick AS (
         SELECT t.id AS ticket_id, t.status, t.travel_date, p.id AS payment_id
           FROM tickets t JOIN payments p ON p.id = t.payment_id
          WHERE t.is_test AND p.is_test AND t.status = 'paid' AND p.status = 'paid' AND p.refunded_paise = 0
            AND t.travel_date BETWEEN $1::date AND $2::date
          ORDER BY md5(t.id::text || 'full') LIMIT $3)
       UPDATE payments p
          SET status = 'refunded', refunded_paise = p.amount_paise,
              refunded_at = ((pick.travel_date + 1) + time '12:30') AT TIME ZONE 'Asia/Kolkata',
              refund_id = 'rfnd_TEST' || p.id, refund_reason = 'Destination closed for the day — heavy rain',
              raw = p.raw || jsonb_build_object('seeded_refund', jsonb_build_object('ticket_status', pick.status))
         FROM pick WHERE p.id = pick.payment_id
       RETURNING pick.ticket_id`, [shift(today, -20), shift(today, -2), refundLimit(9)]);
    await c.query(`UPDATE tickets SET status = 'cancelled', modified_at = now() WHERE id = ANY($1::bigint[])`, [full.rows.map((r) => r.ticket_id)]);

    /* 5. Partial refunds: the entry fee only, the service fee kept. */
    const partial = await c.query(
      `WITH pick AS (
         SELECT t.id AS ticket_id, t.status, t.travel_date, p.id AS payment_id
           FROM tickets t JOIN payments p ON p.id = t.payment_id
          WHERE t.is_test AND p.is_test AND t.status = 'paid' AND p.status = 'paid' AND p.refunded_paise = 0
            AND t.travel_date BETWEEN $1::date AND $2::date
          ORDER BY md5(t.id::text || 'part') LIMIT $3)
       UPDATE payments p
          SET refunded_paise = p.entry_paise,
              refunded_at = ((pick.travel_date + 2) + time '15:00') AT TIME ZONE 'Asia/Kolkata',
              refund_id = 'rfnd_TEST' || p.id, refund_reason = 'Entry fee returned — approach road closed after booking',
              raw = p.raw || jsonb_build_object('seeded_refund', jsonb_build_object('ticket_status', pick.status))
         FROM pick WHERE p.id = pick.payment_id`, [shift(today, -25), shift(today, -3), refundLimit(7)]);

    /* 6. Weekly remittances to the Department, up to the last full week. */
    const [y, m, d] = today.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const lastSunday = shift(today, -(dow === 0 ? 7 : dow));
    const first = (await c.query(
      `SELECT min((paid_at AT TIME ZONE 'Asia/Kolkata')::date) AS d FROM payments WHERE is_test AND paid_at IS NOT NULL`)).rows[0].d;
    let weeks = 0;
    if (first) {
      const f = first instanceof Date ? first.toISOString().slice(0, 10) : String(first);
      const [fy, fm, fd] = f.split('-').map(Number);
      const fdow = new Date(Date.UTC(fy, fm - 1, fd)).getUTCDay();
      for (let monday = shift(f, -((fdow + 6) % 7)); shift(monday, 6) <= lastSunday; monday = shift(monday, 7)) {
        const sunday = shift(monday, 6);
        const exists = (await c.query('SELECT 1 FROM department_remittances WHERE covers_from = $1 AND covers_to = $2', [monday, sunday])).rows[0];
        if (exists) continue;
        const due = (await c.query(
          `SELECT COALESCE(sum(entry_paise - LEAST(entry_paise, refunded_paise)), 0) AS due
             FROM payments WHERE is_test AND status IN ('paid','refunded') AND (paid_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1::date AND $2::date`,
          [monday, sunday])).rows[0].due;
        if (Number(due) <= 0) continue;
        await c.query(
          `INSERT INTO department_remittances (covers_from, covers_to, amount_paise, reference, remitted_on, note, is_test)
           VALUES ($1,$2,$3,$4,$5,$6,true)`,
          [monday, sunday, due, `TEST-NEFT-${sunday.replace(/-/g, '')}`, shift(sunday, 2), 'Weekly entry-fee remittance (test data)']);
        weeks += 1;
      }
    }

    console.log(`settled ${settled.rowCount} · linked ${linked.rowCount} failed · ${pending.rowCount} pending · ${full.rowCount} full refunds · ${partial.rowCount} partial refunds · ${weeks} weekly remittances`);
  });
}

(process.argv.includes('--remove') ? remove() : seed())
  .then(() => process.exit(0))
  .catch((e) => { console.error(e.message); process.exit(1); });
