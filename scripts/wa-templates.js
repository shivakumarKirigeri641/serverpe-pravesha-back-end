/**
 * scripts/wa-templates.js — submit the message templates Meta must approve.
 *
 *   node scripts/wa-templates.js            list what exists and its status
 *   node scripts/wa-templates.js --submit   create anything missing
 *
 * WHY TEMPLATES EXIST AT ALL: Meta only allows free-form messages inside 24
 * hours of the customer's own last message. Every message this system needs to
 * send OUTSIDE that window — a closure notice to someone who booked last week,
 * a reminder the night before — must be an approved template or it simply will
 * not deliver.
 *
 * Approval takes anywhere from minutes to a day, which is why this is run well
 * before it is needed rather than on the morning something goes wrong.
 *
 * All of these are UTILITY, not MARKETING. They follow a transaction the
 * customer initiated, which is both true and the category that delivers
 * reliably; miscategorising a utility message as marketing is how a closure
 * notice ends up silently undelivered to half the people who need it.
 */

require('dotenv').config();

const API = `https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION || 'v21.0'}`;
const WABA = process.env.WHATSAPP_BUSINESS_ID;
const TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

const TEMPLATES = [
  {
    name: 'gate_closure_notice',
    category: 'UTILITY',
    language: 'en',
    // {{1}} ticket no · {{2}} date · {{3}} reason · {{4}} amount
    body:
      'Your Mullayanagiri entry ticket {{1}} for {{2}} cannot be used: {{3}}.\n\n'
      + 'We are sorry for the trouble. Reply MENU to move your ticket to another day at no extra '
      + 'cost, or to request a full refund of Rs.{{4}} (5-7 working days).',
    example: ['A7K2M9', 'Sunday, 14 September', 'heavy rain and landslide risk', '110'],
    why: 'The only way to reach someone whose travel day has been closed. Without this, a '
       + 'visitor drives three hours to a shut barrier.',
  },
  {
    name: 'gate_trip_reminder',
    category: 'UTILITY',
    language: 'en',
    // {{1}} vehicle · {{2}} date · {{3}} slot
    body:
      'Reminder: your Mullayanagiri entry ticket for {{1}} is valid tomorrow, {{2}}, {{3}}.\n\n'
      + 'Please keep the QR code ready at the checkpost. Reply MENU to see your ticket again.',
    example: ['KA 31 N 8147', 'Sunday, 14 September', '6:00 AM - 12:00 PM'],
    why: 'Cuts down the "I lost the QR" queue at the gate, and reminds people which half of the '
       + 'day they booked.',
  },
  {
    name: 'gate_refund_done',
    category: 'UTILITY',
    language: 'en',
    // {{1}} ticket no · {{2}} amount · {{3}} working days
    body:
      'Your Mullayanagiri ticket {{1}} has been cancelled and Rs.{{2}} refunded to your original '
      + 'payment method. It should reach you within {{3}} working days.',
    example: ['A7K2M9', '110', '5-7'],
    why: 'A refund the customer cannot see is a support call. This closes the loop even when the '
       + 'conversation window has expired.',
  },
];

async function existing() {
  const res = await fetch(
    `${API}/${WABA}/message_templates?limit=100&access_token=${TOKEN}`);
  const j = await res.json();
  if (j.error) throw new Error(j.error.message);
  return j.data || [];
}

async function submit(t) {
  const res = await fetch(`${API}/${WABA}/message_templates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: t.name,
      category: t.category,
      language: t.language,
      components: [{
        type: 'BODY',
        text: t.body,
        example: { body_text: [t.example] },
      }],
    }),
  });
  const j = await res.json();
  if (j.error) return { ok: false, error: `${j.error.code}: ${j.error.message}` };
  return { ok: true, id: j.id, status: j.status };
}

(async () => {
  if (!WABA || !TOKEN) {
    console.error('\n  WHATSAPP_BUSINESS_ID and WHATSAPP_ACCESS_TOKEN must be set.\n');
    process.exit(1);
  }

  const have = await existing();
  const byName = Object.fromEntries(have.map((t) => [t.name, t]));
  const doSubmit = process.argv.includes('--submit');

  console.log(`\nMessage templates on WABA ${WABA}\n`);

  for (const t of TEMPLATES) {
    const found = byName[t.name];
    if (found) {
      const mark = found.status === 'APPROVED' ? 'ok      '
        : found.status === 'REJECTED' ? 'REJECTED'
        : 'pending ';
      console.log(`  ${mark}  ${t.name.padEnd(22)} ${found.status}`);
      if (found.status === 'REJECTED') {
        console.log(`            reason: ${found.rejected_reason || 'not given'}`);
      }
      continue;
    }

    if (!doSubmit) {
      console.log(`  MISSING   ${t.name.padEnd(22)} — run with --submit to create`);
      continue;
    }

    const r = await submit(t);
    console.log(r.ok
      ? `  created   ${t.name.padEnd(22)} ${r.status || 'PENDING'}`
      : `  FAILED    ${t.name.padEnd(22)} ${r.error}`);
  }

  console.log('\n  Approval usually takes minutes but can take a day. Nothing that needs a');
  console.log('  template can be sent until its status is APPROVED.\n');
  process.exit(0);
})().catch((e) => { console.error('\n', e.message, '\n'); process.exit(1); });
