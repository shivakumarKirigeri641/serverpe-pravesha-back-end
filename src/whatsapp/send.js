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

module.exports = { text, buttons, list, ctaUrl, document, windowOpen, post, record };
