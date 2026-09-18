/**
 * checkout.js — taking the money, with three ways to hear that it worked.
 *
 * WHY A HOSTED PAGE AND NOT A PAYMENT LINK: a payment link is created by an API
 * call that can take seconds, and the customer waits on WhatsApp watching
 * nothing happen. Our own page opens instantly and starts Razorpay Checkout in
 * the browser, which is the flow people already recognise from every other
 * Indian site.
 *
 * WHY THREE CONFIRMATION PATHS: because two of them fail regularly.
 *
 *   1. The browser callback — instant, but only if the customer's browser comes
 *      back. They close the tab, the network drops, the UPI app does not return.
 *   2. The webhook — server to server, seconds later, but it depends on our URL
 *      being reachable and correctly configured. It has silently not arrived
 *      before, twice.
 *   3. The reconciler — a poll that asks Razorpay directly. Slower, and the
 *      only one that cannot be broken by something outside our control.
 *
 * All three end in the same idempotent call, so whichever arrives first issues
 * the ticket and the others do nothing.
 */

const crypto = require('crypto');
const Razorpay = require('razorpay');
const { query, one } = require('./db');

/**
 * Keys follow the mode, and the mode is a deployment fact.
 *
 * An earlier version preferred live keys whenever they were present, which
 * meant a laptop with live keys in its .env quietly charged real cards. Mode is
 * never a consequence of which variables happen to be set.
 *
 *   RAZORPAY_MODE=test   test keys, even on the production server — the
 *                        demo runs there before the Department approves
 *                        going live (user, 2026-09-18)
 *   RAZORPAY_MODE=live   live keys
 *   unset                live under NODE_ENV=production, test elsewhere
 */
function isLive() {
  const mode = String(process.env.RAZORPAY_MODE || '').trim().toLowerCase();
  if (mode === 'test') return false;
  if (mode === 'live') return true;
  return process.env.NODE_ENV === 'production';
}

function keys() {
  const live = isLive();
  const id = live ? process.env.RAZORPAY_LIVE_KEY : process.env.RAZORPAY_TEST_KEY;
  const secret = live ? process.env.RAZORPAY_LIVE_SECRET : process.env.RAZORPAY_TEST_SECRET;
  if (!id || !secret) {
    throw new Error(`Razorpay ${live ? 'live' : 'test'} keys are not configured`);
  }
  if (live && !id.startsWith('rzp_live')) throw new Error('Razorpay live mode but the key is not a live key');
  if (!live && id.startsWith('rzp_live')) throw new Error('live Razorpay key in test mode — refusing');
  return { id, secret, live };
}

let client = null;
function rzp() {
  if (!client) {
    const k = keys();
    client = new Razorpay({ key_id: k.id, key_secret: k.secret });
  }
  return client;
}

const baseUrl = () => (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');

/**
 * Create the payment row and return the URL to send on WhatsApp.
 *
 * The Razorpay order is NOT created here. It is created when the page opens,
 * so a customer who never taps the link costs nothing and leaves no orphan
 * order — and so the page opens in one round trip instead of two.
 */
async function linkFor(ticket) {
  const token = crypto.randomBytes(16).toString('base64url');

  await query(
    `INSERT INTO payments (customer_id, amount_paise, entry_paise, platform_paise,
                           gst_paise, status, checkout_token)
     VALUES ($1, $2, $3, $4, $5, 'created', $6)`,
    [ticket.customer_id, ticket.total_paise, ticket.entry_paise,
     ticket.platform_paise, ticket.gst_paise, token]);

  // The payment row is what the token addresses, and it remembers which ticket
  // it is paying for. One direction only — a ticket can outlive several
  // abandoned payment attempts, and each of those needs its own token.
  await query(
    `UPDATE payments SET raw = jsonb_build_object('ticket_id', $2::bigint)
      WHERE checkout_token = $1`, [token, ticket.id]);

  return `${baseUrl()}/pay/${token}`;
}

/** The payment row behind a checkout token, with its ticket. */
async function byToken(token) {
  const p = await one('SELECT * FROM payments WHERE checkout_token = $1', [token]);
  if (!p) return null;
  const ticketId = p.raw?.ticket_id;
  const t = ticketId ? await one(
    `SELECT t.*, pl.name AS place_name, pl.name_kn AS place_name_kn,
            regexp_replace(s.label, '[[:space:]]+', ' ', 'g') AS slot_label, s.label_kn AS slot_label_kn,
            c.label AS category_label, cu.language AS customer_language
       FROM tickets t
       JOIN places pl ON pl.id = t.place_id
       JOIN place_slots s ON s.id = t.slot_id
       JOIN vehicle_categories c ON c.id = t.category_id
       LEFT JOIN customers cu ON cu.id = t.customer_id
      WHERE t.id = $1`, [ticketId]) : null;
  return { payment: p, ticket: t };
}

/**
 * Create the Razorpay order for a checkout page that is being opened.
 *
 * Reuses an existing order rather than making a second one if the customer
 * reloads the page — two orders for one ticket is how a double charge starts.
 */
async function ensureOrder(payment, ticket) {
  if (payment.order_id) return payment.order_id;

  const order = await rzp().orders.create({
    amount: payment.amount_paise,
    currency: 'INR',
    // Unique forever, because Razorpay remembers receipts across resets.
    receipt: ticket.reference_id.slice(0, 40),
    notes: {
      ticket_no: ticket.ticket_no,
      /* A per-person pass (056) has no plate; the note says who it covers instead. */
      reg_no: ticket.reg_no || `${ticket.persons || 1} persons`,
      travel_date: String(ticket.travel_date),
    },
  });

  await query('UPDATE payments SET order_id = $2 WHERE id = $1', [payment.id, order.id]);
  return order.id;
}

/**
 * Verify the signature Razorpay Checkout hands back in the browser.
 *
 * Without this the callback is just a URL the customer's browser hit, and
 * anyone could hit it claiming to have paid. The signature is an HMAC over
 * order_id|payment_id with our key secret, which only Razorpay and we can
 * compute.
 */
function verifyCallback({ order_id, payment_id, signature }) {
  const k = keys();
  const expected = crypto.createHmac('sha256', k.secret)
    .update(`${order_id}|${payment_id}`).digest('hex');
  const a = Buffer.from(String(signature || ''), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Verify a webhook body against the webhook secret — a different secret. */
function verifyWebhook(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK;
  if (!secret) return 'unset';
  const expected = crypto.createHmac('sha256', secret)
    .update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8'))
    .digest('hex');
  const a = Buffer.from(String(signature || ''), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return 'bad';
  return crypto.timingSafeEqual(a, b) ? 'ok' : 'bad';
}

/** Record a successful payment. Safe to call repeatedly for the same payment. */
async function markPaid(paymentId, rzpPaymentId, raw) {
  const r = await query(
    `UPDATE payments
        SET status = 'paid', payment_id = COALESCE(payment_id, $2),
            paid_at = COALESCE(paid_at, now()),
            raw = raw || $3::jsonb
      WHERE id = $1 AND status <> 'paid'
      RETURNING *`,
    [paymentId, rzpPaymentId || null, JSON.stringify({ gateway: raw || {} })]);
  return r.rows[0] || null;
}

async function markFailed(paymentId, reason) {
  await query(
    `UPDATE payments SET status = 'failed', raw = raw || $2::jsonb
      WHERE id = $1 AND status = 'created'`,
    [paymentId, JSON.stringify({ failed_reason: reason || 'unknown' })]);
}

/** Ask Razorpay directly — the path that no misconfiguration of ours can break. */
async function fetchOrderPayments(orderId) {
  try {
    const r = await rzp().orders.fetchPayments(orderId);
    return r.items || [];
  } catch (e) {
    console.error('[checkout] could not fetch order payments:', e.message);
    return [];
  }
}

/**
 * The payment as Razorpay recorded it: method, UPI id or card network, bank.
 *
 * The browser callback carries only ids, and "Paid by UPI · name@okaxis" on a
 * pass is worth one extra call. A failure here costs the pass that detail and
 * nothing else, so it returns null rather than throwing.
 */
async function fetchPayment(rzpPaymentId) {
  if (!rzpPaymentId) return null;
  try {
    return await rzp().payments.fetch(rzpPaymentId);
  } catch (e) {
    console.error('[checkout] could not fetch payment %s: %s', rzpPaymentId, e.message);
    return null;
  }
}

module.exports = {
  isLive, keys, linkFor, byToken, ensureOrder, verifyCallback, verifyWebhook,
  markPaid, markFailed, fetchOrderPayments, fetchPayment, baseUrl,
};
