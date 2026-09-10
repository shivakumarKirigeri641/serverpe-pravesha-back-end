/**
 * scripts/make-flow.js — create, upload and validate the booking Flow at Meta.
 *
 *   node scripts/make-flow.js              create if needed, upload the JSON
 *   node scripts/make-flow.js --list       what Flows exist and their status
 *   node scripts/make-flow.js --publish    make it live for everyone
 *
 * A Flow lives in Meta, not in this repo. The JSON here is the source; this
 * pushes it up and reports what Meta thinks of it.
 *
 * DRAFT IS TESTABLE. A Flow does not need publishing to be tried — a draft can
 * be sent to your own number and behaves exactly like the real thing, with a
 * "draft" marker on the message. Publishing is what lets it go to visitors, and
 * a published Flow's JSON can no longer be edited freely, so it is the last
 * step rather than the first.
 *
 * VALIDATION HAPPENS ON UPLOAD. Meta checks every screen, component and data
 * binding and returns precise errors — wrong component name, a ${data.x} with
 * no matching field, a routing model that does not match the screens. Those
 * errors are the point of this script: they are far more specific than anything
 * that surfaces later on a phone.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const V = process.env.WHATSAPP_API_VERSION || 'v21.0';
const WABA = process.env.WHATSAPP_BUSINESS_ID;
const TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const NAME = process.env.FLOW_NAME || 'Pravesha entry ticket booking';
const JSON_PATH = path.join(__dirname, '..', 'src', 'whatsapp', 'flows', 'booking.flow.json');

const LIST = process.argv.includes('--list');
const PUBLISH = process.argv.includes('--publish');

const api = async (method, p, body, headers = {}) => {
  const r = await fetch(`https://graph.facebook.com/${V}/${p}`, {
    method, headers: { Authorization: `Bearer ${TOKEN}`, ...headers }, body });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};

const endpointUri = () => {
  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  const prefix = require('../src/config/paths').PREFIX;
  return `${base}${prefix}/flow/booking`;
};

(async () => {
  if (LIST) {
    const r = await api('GET', `${WABA}/flows?fields=id,name,status,categories,validation_errors`);
    console.log(`\n  Flows on this WABA (${r.status}):`);
    for (const f of r.json.data || []) {
      console.log(`    ${f.id}  ${String(f.status).padEnd(10)} ${f.name}`);
      for (const e of f.validation_errors || []) console.log(`        ! ${e.error_type}: ${e.message}`);
    }
    if (!(r.json.data || []).length) console.log('    (none)');
    console.log('');
    process.exit(0);
  }

  /* Find an existing Flow by name rather than storing an id in .env: the id is
     Meta's to hand out, and a stale one in a config file is worse than a lookup. */
  const existing = await api('GET', `${WABA}/flows?fields=id,name,status`);
  let flow = (existing.json.data || []).find((f) => f.name === NAME);

  if (!flow) {
    const r = await api('POST', `${WABA}/flows`,
      new URLSearchParams({
        name: NAME,
        categories: JSON.stringify(['APPOINTMENT_BOOKING']),
        endpoint_uri: endpointUri(),
      }), { 'Content-Type': 'application/x-www-form-urlencoded' });

    if (r.status >= 400) {
      console.error(`\n  could not create the Flow (${r.status}):`);
      console.error(JSON.stringify(r.json, null, 1).slice(0, 700));
      process.exit(1);
    }
    flow = { id: r.json.id, name: NAME, status: 'DRAFT' };
    console.log(`\n  created Flow ${flow.id}`);
  } else {
    console.log(`\n  found Flow ${flow.id} (${flow.status})`);
    /* The endpoint moves every time ngrok restarts, so keep it current. */
    const u = await api('POST', `${flow.id}`,
      new URLSearchParams({ endpoint_uri: endpointUri() }),
      { 'Content-Type': 'application/x-www-form-urlencoded' });
    if (u.status >= 400) {
      console.error('  could not update endpoint_uri:',
        JSON.stringify(u.json).slice(0, 300));
    }
  }

  console.log(`  endpoint: ${endpointUri()}`);

  if (PUBLISH) {
    const r = await api('POST', `${flow.id}/publish`);
    console.log(`\n  publish -> ${r.status} ${JSON.stringify(r.json).slice(0, 300)}\n`);
    process.exit(r.status >= 400 ? 1 : 0);
  }

  /* Upload the JSON. Meta validates it here and the errors are specific. */
  const form = new FormData();
  form.append('name', 'flow.json');
  form.append('asset_type', 'FLOW_JSON');
  form.append('file', new Blob([fs.readFileSync(JSON_PATH)], { type: 'application/json' }),
    'flow.json');

  const up = await api('POST', `${flow.id}/assets`, form);

  console.log(`\n  upload -> ${up.status}`);
  const errs = up.json?.validation_errors || [];
  if (errs.length) {
    console.log(`\n  ${errs.length} VALIDATION ERROR(S):`);
    for (const e of errs) {
      console.log(`    ${e.error_type || ''} ${e.pointers ? JSON.stringify(e.pointers) : ''}`);
      console.log(`      ${e.message}`);
    }
    console.log('');
    process.exit(1);
  }
  if (up.status >= 400) {
    console.error(JSON.stringify(up.json, null, 1).slice(0, 900));
    process.exit(1);
  }

  console.log('  JSON accepted with no validation errors.');
  console.log(`\n  FLOW_ID=${flow.id}   (put this in .env)\n`);
  process.exit(0);
})().catch((e) => { console.error('\n ', e.message, '\n'); process.exit(1); });
