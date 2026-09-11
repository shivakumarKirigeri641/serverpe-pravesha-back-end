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

const router = express.Router();

/* The handshake Meta performs once, when the URL is saved in the dashboard. */
router.get('/webhook/whatsapp', (req, res) => {
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
router.post('/webhook/whatsapp',
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
