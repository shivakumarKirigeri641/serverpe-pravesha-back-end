#!/usr/bin/env node
/**
 * whatsapp-templates-push.js — submit Pravesha's WhatsApp templates to a
 * WhatsApp Business account for approval.
 *
 *   node scripts/whatsapp-templates-push.js          list what would be submitted
 *   node scripts/whatsapp-templates-push.js --send   submit them
 *
 * WHY: templates belong to a WhatsApp Business account, not to a number or an
 * app. Should Pravesha's number ever move to another account, its approved
 * templates stay behind. Their exact wording was saved from Meta to
 * scripts/whatsapp-templates.json (2026-09-18), and this script submits that
 * wording unchanged, under the same names, to the account in
 * WHATSAPP_BUSINESS_ID.
 *
 * A template already on the account, under the same name and language, is
 * skipped. Submitting sends nothing to anyone; Meta only reviews the wording.
 */

require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const GRAPH = 'https://graph.facebook.com/v21.0';
const FILE = path.join(__dirname, 'whatsapp-templates.json');
const send = process.argv.includes('--send');

const token = process.env.WHATSAPP_ACCESS_TOKEN;
const waba = process.env.WHATSAPP_BUSINESS_ID;

async function main() {
  if (!token || !waba) throw new Error('WHATSAPP_ACCESS_TOKEN and WHATSAPP_BUSINESS_ID must be set');
  const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));

  const existing = (await axios.get(`${GRAPH}/${waba}/message_templates`, {
    params: { access_token: token, fields: 'name,language,status', limit: 200 },
  })).data.data;
  const has = new Map(existing.map((t) => [`${t.name}|${t.language}`, t.status]));

  console.log(`\n  account ${waba} · ${saved.length} saved templates${send ? '' : ' · listing only, add --send to submit'}\n`);
  for (const t of saved) {
    const key = `${t.name}|${t.language}`;
    if (has.has(key)) { console.log(`  skip    ${t.language.padEnd(3)} ${t.name} (already ${has.get(key)})`); continue; }
    if (!send) { console.log(`  submit  ${t.language.padEnd(3)} ${t.name}`); continue; }

    const body = { name: t.name, language: t.language, category: t.category, components: t.components };
    if (t.parameter_format) body.parameter_format = t.parameter_format;
    try {
      const r = await axios.post(`${GRAPH}/${waba}/message_templates`, body, { params: { access_token: token } });
      console.log(`  sent    ${t.language.padEnd(3)} ${t.name} → ${r.data.status || 'submitted'}`);
    } catch (e) {
      const err = e.response ? e.response.data.error : { message: e.message };
      console.log(`  FAILED  ${t.language.padEnd(3)} ${t.name}: ${err.error_user_msg || err.message}`);
    }
  }
  console.log('');
}

main().catch((e) => {
  console.error(`\n  ${e.response ? JSON.stringify(e.response.data) : e.message}\n`);
  process.exit(1);
});
