/**
 * whatsapp.js — the webhook endpoint.
 *
 * Its only job is HTTP: prove the request came from Meta, acknowledge it, and
 * hand the messages to inbox.js. Nothing about what a message means lives here.
 *
 * WHY IT ACKNOWLEDGES BEFORE IT WORKS. Meta expects a 200 quickly and retries
 * the whole delivery if it does not get one. Handling a message can mean a
 * registration lookup and a send, which is slower than that window — so
 * replying first and working after is what stops a slow lookup from producing
 * a duplicate delivery, and then a duplicate booking. Nothing is lost by it:
 * every message is already stored by the time it is processed.
 */

const express = require('express');
const signature = require('../whatsapp/signature');
const inbox = require('../whatsapp/inbox');
const { PREFIX } = require('../config/paths');

const router = express.Router();

/* The long, explicit prefix the other ServerPe services use. This URL is pasted
   into the Meta dashboard and stays there for years, so it says which platform,
   which product and which version is being addressed rather than claiming a
   bare "/webhook" that four products would compete for. */
const WEBHOOK = `${PREFIX}/whatsapp/webhook`;

/* The handshake Meta performs once, when the URL is saved in the dashboard. */
router.get(WEBHOOK, (req, res) => {
  const challenge = signature.challenge(req.query);
  if (challenge) {
    console.log('[wa] webhook verified');
    return res.status(200).send(challenge);
  }
  console.warn('[wa] webhook verification refused');
  return res.sendStatus(403);
});

/*
 * express.raw, not express.json.
 *
 * The signature is computed over the exact bytes Meta sent. Parsing first and
 * re-serialising to check it produces a different string and a digest that
 * never matches.
 */
router.post(WEBHOOK,
  express.raw({ type: '*/*', limit: '1mb' }),
  async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body || ''));
    const check = signature.verify(raw, req.get('x-hub-signature-256'));

    if (!check.ok) {
      console.warn('[wa] rejected delivery:', check.reason);
      /* 403, not 200: a bad signature is not a message we are choosing to
         ignore, it is someone who should stop. */
      return res.sendStatus(403);
    }

    let payload;
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      console.warn('[wa] unparseable body');
      return res.sendStatus(400);
    }

    res.sendStatus(200);

    /* Past the acknowledgement, nothing may throw into Express — the response
       is already gone and an unhandled rejection would take the process down. */
    setImmediate(() => { dispatch(payload).catch((e) => console.error('[wa] dispatch', e)); });
  });

async function dispatch(payload) {
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};

      /* ONLY OUR NUMBER. This WhatsApp Business Account also holds QuizPe's
         live number, and Meta delivers every number's events to every app
         subscribed to the account. Without this check a parent messaging QuizPe
         would be answered by Pravesha, from Pravesha's number. An event with no
         phone_number_id is not ours to act on either. */
      const ours = process.env.WHATSAPP_PHONE_NUMBER_ID;
      const target = value.metadata && value.metadata.phone_number_id;
      if (!ours || String(target) !== String(ours)) {
        if (value.messages?.length) {
          console.log('[wa] ignoring event for another number (%s)', target || 'none');
        }
        continue;
      }

      /* Delivery and read receipts arrive on the same webhook as messages.
         They are not replies and must not be treated as any. */
      if (value.statuses?.length) continue;

      const contacts = value.contacts || [];
      for (const msg of value.messages || []) {
        const contact = contacts.find((c) => c.wa_id === msg.from) || contacts[0];
        try {
          await inbox.handle(msg, contact);
        } catch (e) {
          console.error('[wa] handling', msg.id, e.message);
        }
      }
    }
  }
}

module.exports = router;
