/**
 * routes/whatsapp.js — the webhook Meta talks to.
 *
 * Two responsibilities and nothing else: prove the request is really from Meta,
 * and answer it immediately.
 *
 * ANSWERING IMMEDIATELY IS NOT AN OPTIMISATION. Meta retries any webhook it
 * does not get a 200 for within seconds, and a retry re-delivers the same
 * message. If a booking took four seconds — a vehicle lookup plus a payment row
 * — Meta would deliver it again while we were still working, and the customer
 * would get two of everything. So: acknowledge first, then handle.
 *
 * The replay guard in store.alreadySeen closes the remaining gap, because a
 * retry can still arrive if our 200 is lost on the way back.
 */

const express = require('express');
const signature = require('../whatsapp/signature');
const store = require('../whatsapp/store');
const flow = require('../whatsapp/flow');

const router = express.Router();

/* Meta's one-time verification handshake when the URL is saved. */
router.get('/whatsapp/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('[wa] webhook verified');
    return res.status(200).send(challenge);
  }
  console.warn('[wa] webhook verification failed — token mismatch');
  return res.sendStatus(403);
});

router.post('/whatsapp/webhook', async (req, res) => {
  const verdict = signature.verify(
    req.rawBody, req.get('x-hub-signature-256'), process.env.WHATSAPP_APP_SECRET);

  if (verdict === signature.BAD) {
    console.error('[wa] REJECTED webhook — signature does not match');
    return res.sendStatus(401);
  }
  if (verdict === signature.MISSING) {
    console.warn('[wa] webhook had no signature header');
    return res.sendStatus(401);
  }
  if (verdict === signature.UNSET) {
    console.warn('[wa] WHATSAPP_APP_SECRET not set — accepting unverified webhook');
  }

  // Acknowledge before doing anything that can take time.
  res.sendStatus(200);

  try {
    await dispatch(req.body);
  } catch (e) {
    console.error('[wa] handler threw:', e.stack || e.message);
  }
});

/**
 * Pull the messages out of Meta's envelope.
 *
 * The payload also carries delivery receipts and read receipts, which are
 * noise here — only `messages` matters.
 */
async function dispatch(body) {
  for (const entry of body?.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const contact = value.contacts?.[0];

      // WHICH NUMBER WAS THIS SENT TO?
      //
      // Both ServerPe numbers sit on one WhatsApp Business Account, and a
      // webhook subscription is per-app-per-account — so this endpoint receives
      // messages addressed to the OTHER product's number too. Without this
      // check, a QuizPe parent typing "hi" would be answered with a
      // Mullayanagiri booking prompt.
      //
      // Their own app still receives its own copy; we simply decline to answer
      // what was never addressed to us.
      const toNumberId = value.metadata?.phone_number_id;
      if (toNumberId && process.env.WHATSAPP_PHONE_NUMBER_ID
          && String(toNumberId) !== String(process.env.WHATSAPP_PHONE_NUMBER_ID)) {
        console.log('[wa] ignoring message for another number (%s → %s)',
          toNumberId, value.metadata?.display_phone_number || '');
        continue;
      }

      for (const m of value.messages || []) {
        const mobile = String(m.from || '').replace(/\D/g, '').slice(-10);
        if (!mobile) continue;

        if (await store.alreadySeen(m.id)) {
          console.log('[wa] duplicate delivery ignored:', m.id);
          continue;
        }

        const msg = {
          mobile,
          waId: m.from,
          profileName: contact?.profile?.name || null,
          messageId: m.id,
          text: m.text?.body || null,
          buttonId: m.interactive?.button_reply?.id || m.button?.payload || null,
          listId: m.interactive?.list_reply?.id || null,
          type: m.type,
        };

        const session = await store.touchInbound(mobile, {
          waId: m.from, profileName: msg.profileName });
        await store.logInbound({
          mobile, sessionId: session.id, type: m.type,
          body: msg.text || msg.buttonId || msg.listId, payload: m });
        await store.markSeen(m.id, mobile);

        if (String(process.env.WHATSAPP_REPLY_ENABLED).toLowerCase() === 'false') {
          console.log('[wa] replies disabled — logged only');
          continue;
        }

        console.log('[wa] in  %s %s %s', mobile, m.type,
          (msg.text || msg.buttonId || msg.listId || '').slice(0, 40));
        await flow.handle(msg);
      }
    }
  }
}

module.exports = router;
