/**
 * adminConversations.js — the WhatsApp conversations, as support reads them.
 *
 * Every message in and out is already recorded (wa_messages): what the visitor
 * typed or tapped, and exactly what was sent back, including the ones Meta
 * refused and why. This module turns that into a list of conversations and a
 * readable thread, and lays the booking's own events — passes held, payments
 * that failed or succeeded, entries at the gate — into the same timeline, so
 * "the visitor says they paid" can be answered from one screen.
 *
 * WHAT IS NOT HERE, AND WHY. Nothing records a visitor's device, operating
 * system, browser, IP address or location: WhatsApp does not give them to a
 * business, and the booking page does not store them. The technical panel says
 * so rather than showing blanks, and collecting any of them would be a change to
 * the privacy policy before it was a change to this file. Location in particular
 * has no use in an entry pass.
 *
 * WHO SEES WHAT. Everyone who can open the panel sees conversations with the
 * number masked. The full number and the identifiers in the technical panel are
 * returned only to a role that may configure the system, and opening a thread
 * with them is written to the audit trail.
 */

const { query, one } = require('./db');

const rowsOf = async (text, params) => (await query(text, params)).rows;
const n = (v) => Number(v || 0);
const mask = (m) => (m ? `••••${String(m).slice(-4)}` : null);

/** The words a message carries, whatever shape it was stored in. */
function render(m) {
  const p = m.payload || {};

  if (m.direction === 'in') {
    const i = p.interactive || {};
    return {
      kind: m.message_type === 'interactive' ? 'tap' : (m.message_type || 'text'),
      text: m.body || i.button_reply?.title || i.list_reply?.title || p.text?.body || null,
      tapped: i.button_reply?.id || i.list_reply?.id || null,
    };
  }

  if (p.type === 'text' || p.text) return { kind: 'text', text: p.text?.body || m.body };

  if (p.type === 'interactive' || p.interactive) {
    const i = p.interactive || {};
    const out = {
      kind: i.type === 'cta_url' ? 'link' : i.type === 'list' ? 'list' : 'buttons',
      header: i.header?.text || null,
      text: i.body?.text || m.body || null,
      footer: i.footer?.text || null,
    };
    if (i.type === 'button') out.buttons = (i.action?.buttons || []).map((b) => b.reply?.title);
    if (i.type === 'list') {
      out.buttonText = i.action?.button || null;
      out.options = (i.action?.sections || []).flatMap((s) => (s.rows || []).map((r) => r.title));
    }
    if (i.type === 'cta_url') {
      out.linkText = i.action?.parameters?.display_text || null;
      /* The booking link carries a single-use token; support has no business
         holding a live one, so only the page it pointed at is shown. */
      const url = i.action?.parameters?.url || '';
      out.linkTo = url ? url.replace(/\/book\/[^/?#]+/, '/book/…') : null;
    }
    return out;
  }

  if (p.type === 'document' || p.document) {
    const d = p.document || {};
    return { kind: 'document', filename: d.filename || null, text: d.caption || m.body || null };
  }

  if (p.type === 'template' || p.template) {
    const t = p.template || {};
    return {
      kind: 'template',
      template: t.name,
      language: t.language?.code,
      params: (t.components || []).find((c) => c.type === 'body')?.parameters?.map((x) => x.text) || [],
    };
  }

  return { kind: m.message_type || 'unknown', text: m.body };
}

/** Why a send did not go, in words support can repeat to a visitor. */
function failureOf(error) {
  if (!error) return null;
  if (/test_recipient_not_sent/.test(error)) return 'Not sent: test number';
  if (/replies_disabled|dry_run/.test(error)) return 'Not sent: replies switched off';
  if (/131047|re-engagement|24 hours/i.test(error)) return 'Not delivered: more than 24 hours since the visitor last wrote';
  if (/132001/.test(error)) return 'Not delivered: template not approved yet';
  return `Not delivered: ${error}`;
}

/**
 * The conversation list, most recent first, with where each conversation stands.
 *
 * "Status" is read from what actually happened, newest fact first: a failed send
 * matters more than a pass issued last week.
 */
async function list({ q = null, limit = 30, offset = 0 } = {}) {
  const term = q ? String(q).trim() : null;
  const digits = term ? term.replace(/\D/g, '') : '';

  const rows = await rowsOf(
    `WITH threads AS (
       SELECT m.mobile,
              max(m.created_at)                                   AS last_at,
              count(*)                                            AS messages,
              count(*) FILTER (WHERE m.direction = 'in')           AS inbound,
              count(*) FILTER (WHERE m.error_message IS NOT NULL)  AS failed,
              max(m.created_at) FILTER (WHERE m.direction = 'in')  AS last_in_at
         FROM wa_messages m
        GROUP BY m.mobile)
     SELECT th.*, c.id AS customer_id, c.name, c.wa_profile_name, c.language, c.is_test,
            last.direction AS last_direction, last.message_type AS last_type, last.body AS last_body,
            last.payload AS last_payload, last.error_message AS last_error,
            tk.ticket_no, tk.status AS ticket_status, tk.travel_date,
            pay.status AS payment_status
       FROM threads th
       JOIN customers c ON c.mobile = th.mobile
       LEFT JOIN LATERAL (
         SELECT direction, message_type, body, payload, error_message
           FROM wa_messages WHERE mobile = th.mobile ORDER BY created_at DESC, id DESC LIMIT 1) last ON true
       LEFT JOIN LATERAL (
         SELECT ticket_no, status, travel_date FROM tickets
          WHERE customer_id = c.id ORDER BY created_at DESC LIMIT 1) tk ON true
       LEFT JOIN LATERAL (
         SELECT status FROM payments WHERE customer_id = c.id ORDER BY created_at DESC LIMIT 1) pay ON true
      WHERE ($1::text IS NULL
             OR ($2 <> '' AND th.mobile LIKE '%' || $2 || '%')
             OR c.name ILIKE '%' || $1 || '%'
             OR c.wa_profile_name ILIKE '%' || $1 || '%'
             OR EXISTS (SELECT 1 FROM tickets t WHERE t.customer_id = c.id
                         AND (t.ticket_no ILIKE '%' || $1 || '%' OR t.reg_no ILIKE '%' || upper($1) || '%')))
      ORDER BY th.last_at DESC, c.id
      LIMIT $3 OFFSET $4`,
    [term, digits, Math.max(1, Math.min(100, Number(limit) || 30)), Math.max(0, Number(offset) || 0)]);

  return rows.map((r) => {
    const preview = render({ direction: r.last_direction, message_type: r.last_type, body: r.last_body, payload: r.last_payload });
    const previewText = preview.text || (preview.kind === 'document' ? `📄 ${preview.filename || 'Document'}`
      : preview.kind === 'template' ? `Template: ${preview.template}` : preview.kind);

    let status = { key: 'open', label: 'Conversation' };
    if (r.last_error) status = { key: 'failed', label: 'Send failed' };
    else if (r.ticket_status === 'used') status = { key: 'entered', label: 'Entered' };
    else if (r.ticket_status === 'paid') status = { key: 'pass', label: 'Pass issued' };
    else if (r.payment_status === 'failed') status = { key: 'payment_failed', label: 'Payment failed' };
    else if (r.ticket_status === 'held') status = { key: 'paying', label: 'At payment' };
    else if (r.ticket_status === 'expired') status = { key: 'abandoned', label: 'Abandoned payment' };
    else if (!r.ticket_no) status = { key: 'browsing', label: 'No booking yet' };

    return {
      id: String(r.customer_id),
      name: r.name || r.wa_profile_name || null,
      mobile: mask(r.mobile),
      language: r.language,
      isTest: r.is_test,
      ticketNo: r.ticket_no,
      travelDate: r.travel_date instanceof Date ? r.travel_date.toISOString().slice(0, 10) : r.travel_date,
      lastAt: r.last_at,
      lastFrom: r.last_direction === 'in' ? 'visitor' : 'pravesha',
      preview: String(previewText || '').replace(/\*/g, '').slice(0, 120),
      messages: n(r.messages),
      failed: n(r.failed),
      status,
      /* Free-form replies are only allowed for 24 hours after the visitor last
         wrote; after that only an approved template can reach them. */
      windowOpen: r.last_in_at ? (Date.now() - new Date(r.last_in_at).getTime()) < 24 * 3600 * 1000 : false,
    };
  });
}

/** One conversation: messages and booking events in one timeline, and the profile beside it. */
async function thread(customerId, { technical = false } = {}) {
  if (!/^\d+$/.test(String(customerId || ''))) return null;
  const c = await one(`SELECT * FROM customers WHERE id = $1`, [customerId]);
  if (!c) return null;

  const [messages, tickets, payments, scans, session, deletion] = await Promise.all([
    rowsOf(`SELECT id, direction, message_type, body, payload, error_message, created_at, wa_message_id, session_id
              FROM wa_messages WHERE mobile = $1 ORDER BY created_at, id LIMIT 1000`, [c.mobile]),
    rowsOf(`SELECT t.id, t.ticket_no, t.reg_no, t.travel_date, t.status, t.total_paise, t.created_at, t.used_at,
                   t.held_until, t.is_test,
                   regexp_replace(s.label, '[[:space:]]+', ' ', 'g') AS slot_label,
                   p.name AS place_name, cat.label AS category_label
              FROM tickets t
              JOIN place_slots s ON s.id = t.slot_id
              JOIN places p ON p.id = t.place_id
              JOIN vehicle_categories cat ON cat.id = t.category_id
             WHERE t.customer_id = $1 ORDER BY t.created_at DESC LIMIT 200`, [c.id]),
    rowsOf(`SELECT id, status, amount_paise, created_at, paid_at, refunded_at, order_id, payment_id, raw, is_test
              FROM payments WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 200`, [c.id]),
    rowsOf(`SELECT sc.verdict, sc.scanned_at, sc.ticket_no, st.name AS staff_name, cp.name AS checkpost_name
              FROM scans sc JOIN tickets t ON t.id = sc.ticket_id
              LEFT JOIN staff st ON st.id = sc.staff_id
              LEFT JOIN checkposts cp ON cp.id = sc.checkpost_id
             WHERE t.customer_id = $1 ORDER BY sc.scanned_at DESC LIMIT 200`, [c.id]),
    one(`SELECT id, wa_id, profile_name, state, last_inbound_at, last_outbound_at, created_at
           FROM wa_sessions WHERE mobile = $1`, [c.mobile]),
    rowsOf(`SELECT reference, status, requested_at, completed_at FROM data_deletion_requests
             WHERE customer_id = $1 OR mobile = $2 ORDER BY requested_at DESC`, [c.id, c.mobile]),
  ]);

  /* The timeline: messages, and the moments in the booking they relate to. */
  const timeline = [];
  for (const m of messages) {
    timeline.push({
      type: 'message',
      id: `m${m.id}`,
      at: m.created_at,
      from: m.direction === 'in' ? 'visitor' : 'pravesha',
      ...render(m),
      failure: failureOf(m.error_message),
    });
  }
  for (const t of tickets) {
    timeline.push({ type: 'event', id: `t${t.id}`, at: t.created_at, event: 'booking',
      title: 'Booking started', detail: `${t.ticket_no} · ${t.reg_no} · ${t.place_name}, ${t.slot_label}` });
    if (t.status === 'expired') {
      timeline.push({ type: 'event', id: `te${t.id}`, at: t.held_until || t.created_at, event: 'abandoned',
        title: 'Held place released', detail: `${t.ticket_no} · payment was not completed in time` });
    }
    if (t.used_at) {
      timeline.push({ type: 'event', id: `tu${t.id}`, at: t.used_at, event: 'entered',
        title: 'Entered at the gate', detail: `${t.ticket_no} · ${t.reg_no}` });
    }
  }
  for (const p of payments) {
    const simulated = p.raw?.gateway?.simulated;
    if (p.raw?.failed_reason) {
      timeline.push({ type: 'event', id: `pf${p.id}`, at: p.created_at, event: 'payment_failed',
        title: 'Payment failed', detail: `₹${p.amount_paise / 100} · ${p.raw.failed_reason}` });
    }
    if (p.paid_at) {
      timeline.push({ type: 'event', id: `pp${p.id}`, at: p.paid_at, event: 'payment_paid',
        title: simulated ? 'Payment received (simulated)' : 'Payment received',
        detail: `₹${p.amount_paise / 100}${p.raw?.gateway?.method ? ` · ${String(p.raw.gateway.method).toUpperCase()}` : ''}` });
    }
    if (p.refunded_at) {
      timeline.push({ type: 'event', id: `pr${p.id}`, at: p.refunded_at, event: 'refund',
        title: 'Refunded', detail: `₹${p.amount_paise / 100}` });
    }
  }
  for (const s of scans.filter((x) => !['valid', 'valid_override'].includes(x.verdict))) {
    timeline.push({ type: 'event', id: `s${s.ticket_no}${s.scanned_at}`, at: s.scanned_at, event: 'refused',
      title: 'Refused at the gate', detail: `${s.ticket_no} · ${s.verdict.replace(/_/g, ' ')}${s.staff_name ? ` · ${s.staff_name}` : ''}` });
  }
  timeline.sort((a, b) => new Date(a.at) - new Date(b.at));

  const used = tickets.filter((t) => t.status === 'used');
  const lastIn = session?.last_inbound_at || messages.filter((m) => m.direction === 'in').pop()?.created_at || null;

  const profile = {
    id: String(c.id),
    name: c.name || c.wa_profile_name || null,
    whatsappName: c.wa_profile_name || session?.profile_name || null,
    mobile: mask(c.mobile),
    language: c.language === 'kn' ? 'Kannada' : c.language === 'en' ? 'English' : 'Not chosen',
    termsAccepted: c.terms_accepted_at ? { at: c.terms_accepted_at, version: c.terms_version } : null,
    firstSeen: c.first_seen_at || c.created_at,
    lastSeen: c.last_seen_at,
    blocked: c.is_blocked ? (c.blocked_reason || 'Blocked') : null,
    isTest: c.is_test,
    windowOpen: lastIn ? (Date.now() - new Date(lastIn).getTime()) < 24 * 3600 * 1000 : false,
    vehicles: [...new Set(tickets.map((t) => t.reg_no))],
    visits: used.length,
    passes: tickets.map((t) => ({
      ticketNo: t.ticket_no, regNo: t.reg_no, type: t.category_label, place: t.place_name,
      travelDate: t.travel_date instanceof Date ? t.travel_date.toISOString().slice(0, 10) : t.travel_date,
      slot: t.slot_label, status: t.status, amount: Math.round(t.total_paise / 100),
      bookedAt: t.created_at, enteredAt: t.used_at, isTest: t.is_test,
    })),
    payments: payments.map((p) => ({
      status: p.status, amount: Math.round(p.amount_paise / 100), at: p.paid_at || p.created_at,
      method: p.raw?.gateway?.method || null, simulated: Boolean(p.raw?.gateway?.simulated),
      failedReason: p.raw?.failed_reason || null,
    })),
    deletionRequests: deletion.map((d) => ({ reference: d.reference, status: d.status, at: d.requested_at })),
  };

  const counts = {
    messages: messages.length,
    fromVisitor: messages.filter((m) => m.direction === 'in').length,
    fromPravesha: messages.filter((m) => m.direction === 'out').length,
    failedSends: messages.filter((m) => m.error_message).length,
  };

  return {
    profile,
    counts,
    timeline,
    /* Only for a role that may configure the system. */
    technical: technical ? {
      customerId: String(c.id),
      mobile: c.mobile,
      whatsappId: c.wa_id || session?.wa_id || null,
      sessionId: session ? String(session.id) : null,
      sessionState: session?.state || null,
      sessionStarted: session?.created_at || null,
      lastInbound: lastIn,
      /* The session row is not always told about replies; the transcript is. */
      lastOutbound: session?.last_outbound_at
        || messages.filter((m) => m.direction === 'out').pop()?.created_at || null,
      firstSeen: c.first_seen_at || c.created_at,
      termsVersion: c.terms_version || null,
      /* Stated, not left blank: nothing here was ever collected. */
      notCollected: ['Device type', 'Operating system', 'Browser / user agent', 'IP address', 'Location'],
      notCollectedReason: 'WhatsApp does not share these with a business, and the booking page does not store them. '
        + 'Collecting any of them would require a change to the privacy policy first.',
    } : null,
  };
}

module.exports = { list, thread, render, failureOf };
