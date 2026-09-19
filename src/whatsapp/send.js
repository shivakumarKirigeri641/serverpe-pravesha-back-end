/**
 * send.js — outbound messages, and a record of every one.
 *
 * WHATSAPP_DRY_RUN exists so the whole flow can be walked through without a
 * phone and without spending a conversation: the payload is logged and stored
 * exactly as it would have been sent, and nothing leaves the machine.
 */

const { query } = require('../gatepass/db');
const phone = require('./phone');

const GRAPH = 'https://graph.facebook.com/v21.0';
const dry = () => String(process.env.WHATSAPP_DRY_RUN) === 'true';
const enabled = () => String(process.env.WHATSAPP_REPLY_ENABLED) !== 'false';

/**
 * NEVER MESSAGE A NUMBER THAT WAS INVENTED FOR TESTING.
 *
 * Seeded test data has visitors with mobile numbers, and some server paths send
 * to a visitor without them having written first — the check-in template, sent
 * when a gate records an entry, is one. Recording an entry against a seeded pass
 * once caused a real send attempt to a made-up number; it failed only because
 * the template was not yet approved. A made-up number can belong to a real
 * stranger, so this is refused here, below every caller, where no future path
 * can forget it:
 *
 *   * numbers in the reserved test range (starting 000), which no Indian mobile
 *     can have and which the seeder now uses exclusively, and
 *   * any number whose customer row is marked is_test.
 *
 * A refused message is still recorded, with the reason, so the transcript shows
 * what would have been sent.
 */
const TEST_RANGE = /^000\d{7}$/;

async function isTestRecipient(to) {
  const local = phone.toLocal(to);
  if (TEST_RANGE.test(local)) return true;
  try {
    const { rows } = await query('SELECT 1 FROM customers WHERE mobile = $1 AND is_test LIMIT 1', [local]);
    return rows.length > 0;
  } catch {
    /* If we cannot tell, we do not send: a missed message to a real visitor is
       recoverable, a message to a stranger is not. */
    return true;
  }
}

async function record({ mobile, direction, type, body, payload, waId, error }) {
  try {
    /* Stored in the spelling the rest of the schema uses, whichever spelling the
       caller happened to have. */
    mobile = phone.toLocal(mobile);
    await query(
      `INSERT INTO wa_messages (session_id, mobile, direction, message_type, body, payload,
                                wa_message_id, error_message)
       VALUES ((SELECT id FROM wa_sessions WHERE mobile = $1), $1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT DO NOTHING`,
      [mobile, direction, type || null, body || null,
       payload ? JSON.stringify(payload) : null, waId || null, error || null]);
  } catch {
    /* The transcript is for us, not for the customer. Failing to write it must
       not fail the message that was actually delivered. */
  }
}

/** What an outgoing message is, in three words, for the console. */
function describe(message) {
  if (!message) return 'message';
  if (message.type === 'text') return `"${String(message.text?.body || '').replace(/\s+/g, ' ').slice(0, 50)}"`;
  if (message.type === 'template') return `template ${message.template?.name || ''}`.trim();
  if (message.type === 'interactive') {
    const i = message.interactive || {};
    if (i.type === 'button') return `buttons: ${(i.action?.buttons || []).map((b) => b.reply?.title).join(', ')}`;
    if (i.type === 'list') return `list: ${(i.action?.sections || []).flatMap((x) => (x.rows || []).map((r) => r.title)).slice(0, 4).join(', ')}`;
    if (i.type === 'cta_url') return `link: ${i.action?.parameters?.display_text || 'open'}`;
  }
  return message.type || 'message';
}

/**
 * ONLY THESE NUMBERS, WHILE TESTING (user, 2026-09-19).
 *
 * WHATSAPP_ONLY_TO=9886122415[,…] — when set, a message to any other number is
 * not sent, only recorded with the reason, so the transcript still shows what
 * would have gone out. Unset, everyone booking receives their messages as usual.
 * Checked here, below every caller, so no path can forget it.
 */
const allowedOnly = () => String(process.env.WHATSAPP_ONLY_TO || '')
  .split(',').map((m) => phone.toLocal(m.trim())).filter(Boolean);

async function post(to, message) {
  const payload = { messaging_product: 'whatsapp', recipient_type: 'individual', to, ...message };

  const only = allowedOnly();
  if (only.length && !only.includes(phone.toLocal(to))) {
    await record({ mobile: to, direction: 'out', type: message.type, payload,
      body: message.text?.body, error: 'not_on_allowlist_not_sent' });
    console.log('[wa] not sent to %s — WHATSAPP_ONLY_TO allows only %s', to, only.join(', '));
    return { ok: true, dryRun: true, notAllowed: true };
  }

  if (await isTestRecipient(to)) {
    await record({ mobile: to, direction: 'out', type: message.type, payload,
      body: message.text?.body, error: 'test_recipient_not_sent' });
    return { ok: true, dryRun: true, testRecipient: true };
  }

  if (dry() || !enabled()) {
    await record({ mobile: to, direction: 'out', type: message.type, payload,
      body: message.text?.body, error: dry() ? 'dry_run' : 'replies_disabled' });
    return { ok: true, dryRun: true };
  }

  const url = `${GRAPH}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    const out = await res.json().catch(() => ({}));
    const waId = out?.messages?.[0]?.id || null;
    const err = res.ok ? null : (out?.error?.message || `http_${res.status}`);

    await record({ mobile: to, direction: 'out', type: message.type, payload,
      body: message.text?.body, waId, error: err });

    if (!res.ok) console.error('[wa] send failed', res.status, err);
    else require('../log').waOut(to, describe(message));
    return { ok: res.ok, waId, error: err };
  } catch (e) {
    await record({ mobile: to, direction: 'out', type: message.type, payload,
      body: message.text?.body, error: e.message });
    console.error('[wa] send threw', e.message);
    return { ok: false, error: e.message };
  }
}

const text = (to, body, preview = false) =>
  post(to, { type: 'text', text: { preview_url: preview, body } });

/** Up to three buttons — Meta's limit, and worth failing loudly on rather than truncating. */
function buttons(to, body, list, header) {
  if (list.length > 3) throw new Error('WhatsApp allows at most 3 reply buttons');
  return post(to, {
    type: 'interactive',
    interactive: {
      type: 'button',
      ...(header ? { header: { type: 'text', text: header } } : {}),
      body: { text: body },
      action: { buttons: list.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })) },
    },
  });
}

/** A single-select list — used for places, slots and categories. */
function list(to, { body, header, footer, button, sections }) {
  return post(to, {
    type: 'interactive',
    interactive: {
      type: 'list',
      ...(header ? { header: { type: 'text', text: header } } : {}),
      body: { text: body },
      ...(footer ? { footer: { text: footer } } : {}),
      action: { button, sections },
    },
  });
}

/**
 * A button that opens a URL, rather than a link in the message body.
 *
 * WhatsApp renders a plain link as text the visitor has to notice and tap
 * accurately; cta_url gives a full-width button and opens the page in the
 * in-app browser, so the booking form appears without leaving the chat.
 */
function ctaUrl(to, { body, header, footer, displayText, url }) {
  return post(to, {
    type: 'interactive',
    interactive: {
      type: 'cta_url',
      ...(header ? { header: { type: 'text', text: header } } : {}),
      body: { text: body },
      ...(footer ? { footer: { text: footer } } : {}),
      action: { name: 'cta_url', parameters: { display_text: displayText, url } },
    },
  });
}

/**
 * A PDF, uploaded to WhatsApp first and then sent by media id.
 *
 * NOT BY LINK. A document message can point at a URL instead, but WhatsApp's
 * servers then have to fetch it — through ngrok today, which serves an
 * interstitial warning page to anything it does not recognise, and through
 * whatever is in front of production later. Uploading the bytes removes every
 * one of those from the path between a paid visitor and their pass.
 *
 * Takes a Buffer: the PDF is rendered in memory, so there is no file on disk to
 * collide with another pass issued in the same second.
 */
async function document(to, buffer, { filename, caption } = {}) {
  /* Not on the testing allowlist: not even uploaded (see allowedOnly). */
  const only = allowedOnly();
  if (only.length && !only.includes(phone.toLocal(to))) {
    await record({ mobile: to, direction: 'out', type: 'document',
      payload: { document: { filename, caption, bytes: buffer.length } },
      body: caption, error: 'not_on_allowlist_not_sent' });
    return { ok: true, dryRun: true, notAllowed: true };
  }

  if (await isTestRecipient(to)) {
    await record({ mobile: to, direction: 'out', type: 'document',
      payload: { document: { filename, caption, bytes: buffer.length } },
      body: caption, error: 'test_recipient_not_sent' });
    return { ok: true, dryRun: true, testRecipient: true };
  }

  if (dry() || !enabled()) {
    await record({ mobile: to, direction: 'out', type: 'document',
      payload: { document: { filename, caption, bytes: buffer.length } },
      body: caption, error: dry() ? 'dry_run' : 'replies_disabled' });
    return { ok: true, dryRun: true };
  }

  let mediaId;
  try {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', 'application/pdf');
    form.append('file', new Blob([buffer], { type: 'application/pdf' }), filename);
    const up = await fetch(`${GRAPH}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
      body: form,
      signal: AbortSignal.timeout(30000),
    });
    const j = await up.json().catch(() => ({}));
    if (!j.id) {
      const err = j.error?.message || `upload_http_${up.status}`;
      console.error('[wa] media upload failed:', err);
      await record({ mobile: to, direction: 'out', type: 'document', body: caption,
        payload: { document: { filename } }, error: err });
      return { ok: false, error: err };
    }
    mediaId = j.id;
  } catch (e) {
    console.error('[wa] media upload threw:', e.message);
    return { ok: false, error: e.message };
  }

  return post(to, { type: 'document', document: { id: mediaId, filename, caption } });
}

/**
 * Can we still send a free-form message to this number?
 *
 * WhatsApp allows it for 24 hours after the visitor's last message; after that
 * only an approved template gets through, and anything else fails silently from
 * the visitor's side. A payment normally lands minutes after they tapped Book,
 * so this is almost always open — the check exists for the payment that the
 * reconciler finds hours later.
 */
async function windowOpen(to) {
  const r = await query(
    `SELECT last_inbound_at > now() - interval '24 hours' AS open
       FROM wa_sessions WHERE mobile = $1`, [phone.toLocal(to)]);
  return !!(r.rows[0] && r.rows[0].open);
}

module.exports = { text, buttons, list, ctaUrl, document, windowOpen, post, record, isTestRecipient, TEST_RANGE };
