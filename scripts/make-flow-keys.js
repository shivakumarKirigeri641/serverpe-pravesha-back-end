/**
 * scripts/make-flow-keys.js — the RSA key pair WhatsApp Flows needs.
 *
 *   node scripts/make-flow-keys.js            generate, print, upload
 *   node scripts/make-flow-keys.js --check    show what Meta currently holds
 *   node scripts/make-flow-keys.js --no-upload  generate only
 *
 * Meta encrypts every Flow data-exchange request with our public key, so it has
 * to hold the public half and we have to hold the private half. This does both
 * in one step, because doing them separately is how they end up mismatched —
 * and a mismatch shows up only as a generic error inside the Flow, with nothing
 * in any log to say the key is wrong.
 *
 * The private key is printed base64 for the environment rather than written to
 * a file. It must go into .env by hand: a script that edits .env is a script
 * that will one day truncate it.
 *
 * IF THIS KEY IS LOST, the Flow stops working until a new pair is generated and
 * re-uploaded. It is not derivable from anything else. Back it up with the
 * signing key.
 */

require('dotenv').config();
const crypto = require('crypto');

const CHECK = process.argv.includes('--check');
const NO_UPLOAD = process.argv.includes('--no-upload');

const V = process.env.WHATSAPP_API_VERSION || 'v21.0';
const ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

const api = async (method, path, body) => {
  const r = await fetch(`https://graph.facebook.com/${V}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body,
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};

(async () => {
  if (!ID || !TOKEN) {
    console.error('\n  WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN must be set.\n');
    process.exit(1);
  }

  if (CHECK) {
    const r = await api('GET', `${ID}/whatsapp_business_encryption`);
    console.log(`\n  what Meta holds (${r.status}):`);
    console.log(JSON.stringify(r.json, null, 1).slice(0, 700));
    console.log(`\n  FLOW_PRIVATE_KEY in .env: ${process.env.FLOW_PRIVATE_KEY ? 'set' : 'NOT SET'}\n`);
    process.exit(0);
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  console.log('\n  ── put this line in .env (one line, base64) ──\n');
  console.log(`FLOW_PRIVATE_KEY=${Buffer.from(privateKey).toString('base64')}\n`);

  /* Proves the pair works before it is uploaded. A key that round-trips here
     but fails at Meta is a Meta problem; one that fails here was never going to
     work, and finding that out now is cheaper. */
  const probe = crypto.publicEncrypt(
    { key: publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from('pravesha'));
  const back = crypto.privateDecrypt(
    { key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    probe).toString();
  console.log(`  self-test: ${back === 'pravesha' ? 'key pair round-trips correctly' : 'FAILED'}`);

  if (NO_UPLOAD) {
    console.log('\n  --no-upload: not sending the public key to Meta.\n');
    process.exit(0);
  }

  const r = await api('POST', `${ID}/whatsapp_business_encryption`,
    new URLSearchParams({ business_public_key: publicKey }));

  if (r.status >= 400) {
    console.error(`\n  upload FAILED (${r.status}):`);
    console.error(JSON.stringify(r.json, null, 1).slice(0, 500));
    console.error('\n  The private key above is still valid — set it in .env and retry the upload.\n');
    process.exit(1);
  }

  console.log(`  uploaded the public key to Meta (${r.status})`);

  const check = await api('GET', `${ID}/whatsapp_business_encryption`);
  const status = check.json?.data?.[0]?.business_public_key_signature_status;
  console.log(`  Meta reports signature status: ${status || '(none)'}`);
  console.log('\n  next: put FLOW_PRIVATE_KEY in .env and restart the server.\n');
  process.exit(0);
})().catch((e) => { console.error('\n ', e.message, '\n'); process.exit(1); });
