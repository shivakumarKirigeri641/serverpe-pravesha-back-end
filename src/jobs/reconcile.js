/**
 * jobs/reconcile.js — the backstop that does not depend on anyone calling us.
 *
 * This exists because the webhook has silently failed to arrive, twice, on a
 * real payment. When that happens the customer has paid and has no ticket, and
 * nothing in our system knows anything is wrong. That is the single worst
 * failure this product can have.
 *
 * So every 45 seconds we ask Razorpay directly about payments we started and
 * never heard the end of. It is the only confirmation path that cannot be
 * broken by a misconfigured URL, an expired tunnel or a dropped request.
 *
 * The window opens at 45 seconds rather than two minutes because a payment once
 * missed the old window by two seconds and sat unclaimed until the next pass.
 *
 * And the same job releases holds whose customers walked away, because a place
 * held by nobody is a place that cannot be sold.
 */

const { query } = require('../gatepass/db');
const checkout = require('../gatepass/checkout');
const booking = require('../gatepass/booking');
const inventory = require('../gatepass/inventory');
const deliver = require('../whatsapp/deliver');

const EVERY_MS = 45000;
const LOOK_BACK_MINUTES = 90;

let running = false;

async function pass() {
  if (running) return;          // a slow pass must not overlap the next one
  running = true;
  try {
    await claimPaid();
    const freed = await inventory.sweepExpiredHolds();
    if (freed) console.log('[reconcile] released %d expired hold(s)', freed);
  } catch (e) {
    console.error('[reconcile] pass failed:', e.message);
  } finally {
    running = false;
  }
}

/**
 * Payments we created, that have an order, that we still think are unpaid.
 *
 * Bounded by time so this never turns into a scan of every payment ever made:
 * anything older than the look-back was either settled or genuinely abandoned,
 * and both are handled elsewhere.
 */
async function claimPaid() {
  const rows = (await query(
    `SELECT * FROM payments
      WHERE status = 'created' AND order_id IS NOT NULL
        AND created_at > now() - ($1 || ' minutes')::interval
        AND created_at < now() - interval '30 seconds'
      ORDER BY created_at`, [String(LOOK_BACK_MINUTES)])).rows;

  for (const p of rows) {
    const payments = await checkout.fetchOrderPayments(p.order_id);
    const good = payments.find((x) => x.status === 'captured' || x.status === 'authorized');
    if (!good) continue;

    console.log('[reconcile] found unclaimed payment %s for order %s', good.id, p.order_id);

    await checkout.markPaid(p.id, good.id, good);

    const ticketId = p.raw?.ticket_id;
    if (!ticketId) {
      console.error('[reconcile] payment %s has no ticket recorded', p.id);
      continue;
    }

    const issued = await booking.markPaid(ticketId, p.id);
    if (!issued.ok) {
      // The customer paid and we cannot honour it — a person has to deal with
      // this, so it is logged loudly rather than retried forever.
      console.error('[reconcile] PAID BUT NOT ISSUED ticket %s: %s', ticketId, issued.reason);
      await query(
        `INSERT INTO event_log (customer_id, kind, detail) VALUES ($1, 'payment_unissued', $2)`,
        [p.customer_id, JSON.stringify({ ticket_id: ticketId, reason: issued.reason,
          razorpay_payment_id: good.id })]);
      continue;
    }

    /* Delivered only when this pass pulled it from held to paid; if the callback
       or webhook got there first, the visitor already has it. */
    if (!issued.already) {
      await deliver.deliverTicket(ticketId);
      console.log('[reconcile] issued pass for payment %s', good.id);
    }
  }
}

function start() {
  if (!process.env.RAZORPAY_TEST_KEY && !process.env.RAZORPAY_LIVE_KEY) {
    console.warn('[reconcile] no Razorpay keys — not starting');
    return;
  }
  console.log('[reconcile] watching for unconfirmed payments every %ds', EVERY_MS / 1000);
  setInterval(pass, EVERY_MS).unref();
  setTimeout(pass, 5000).unref();
}

module.exports = { start, pass };
