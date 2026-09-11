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

async function record({ mobile, direction, type, body, payload, waId, error }) {
  try {
    /* Stored in the spelling the rest of the schema uses, whichever spelling the
       caller happened to have. */
    mobile = phone.toLocal(mobile);
    await query(
      `INSERT INTO wa_messages (mobile, direction, message_type, body, payload,
                                wa_message_id, error_message)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT DO NOTHING`,
      [mobile, direction, type || null, body || null,
       payload ? JSON.stringify(payload) : null, waId || null, error || null]);
  } catch {
    /* The transcript is for us, not for the customer. Failing to write it must
       not fail the message that was actually delivered. */
  }
}

async function post(to, message) {
  const payload = { messaging_product: 'whatsapp', recipient_type: 'individual', to, ...message };

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

module.exports = { text, buttons, list, ctaUrl, post, record };
