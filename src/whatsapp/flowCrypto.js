/**
 * whatsapp/flowCrypto.js — the encryption WhatsApp Flows requires.
 *
 * A Flow that fetches data mid-form (checking a registration number, reading
 * live slot counts) talks to us through a "data exchange" endpoint, and Meta
 * will not send plaintext to it. Every request is doubly encrypted:
 *
 *   encrypted_aes_key    a one-time AES key, RSA-encrypted with OUR public key
 *   encrypted_flow_data  the actual payload, AES-GCM encrypted with that key
 *   initial_vector       the IV for it
 *
 * So each request is: RSA-decrypt the key, then AES-decrypt the body with it.
 *
 * THE REPLY IS ENCRYPTED WITH THE SAME KEY BUT A FLIPPED IV. Every byte of the
 * initialisation vector is inverted before encrypting the response. This is the
 * detail that silently breaks Flows integrations: the request decrypts fine,
 * the reply looks fine in a log, and the client shows a generic error because
 * it cannot decrypt what came back. There is no error message telling you why.
 *
 * AES-GCM appends a 16-byte authentication tag to the ciphertext. Node wants it
 * handed over separately, so it is split off on the way in and concatenated on
 * the way out.
 *
 * If the private key cannot be loaded, requests are refused rather than
 * answered in plaintext — a Flow endpoint that degrades to unencrypted is worse
 * than one that is down, because it looks like it works.
 */

const crypto = require('crypto');

const TAG_BYTES = 16;

/**
 * The private key, from PRAVESHA_FLOW_PRIVATE_KEY.
 *
 * Stored base64 in the environment rather than as a path: the key has to
 * survive a deploy to a host where we do not control the filesystem, and a
 * multi-line PEM in a .env file is a reliable source of silent breakage.
 */
function privateKey() {
  const raw = process.env.FLOW_PRIVATE_KEY;
  if (!raw) throw new Error('FLOW_PRIVATE_KEY is not set');

  const pem = raw.includes('BEGIN')
    ? raw.replace(/\\n/g, '\n')
    : Buffer.from(raw, 'base64').toString('utf8');

  return crypto.createPrivateKey({
    key: pem,
    passphrase: process.env.FLOW_PRIVATE_KEY_PASSPHRASE || undefined,
  });
}

/**
 * Decrypt one request from Meta.
 *
 * @returns { body, aesKey, iv } — aesKey and iv are needed to encrypt the reply
 */
function decryptRequest({ encrypted_flow_data, encrypted_aes_key, initial_vector }) {
  if (!encrypted_flow_data || !encrypted_aes_key || !initial_vector) {
    const e = new Error('missing encrypted fields');
    e.status = 400;
    throw e;
  }

  let aesKey;
  try {
    aesKey = crypto.privateDecrypt(
      { key: privateKey(), padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      Buffer.from(encrypted_aes_key, 'base64'));
  } catch (err) {
    /* Meta reads 421 as "the key is wrong, re-fetch it" and will ask the user
       to try again rather than showing a dead form. Any other status here just
       looks like an outage. */
    const e = new Error(`cannot decrypt the AES key: ${err.message}`);
    e.status = 421;
    throw e;
  }

  const iv = Buffer.from(initial_vector, 'base64');
  const payload = Buffer.from(encrypted_flow_data, 'base64');

  const body = payload.subarray(0, -TAG_BYTES);
  const tag = payload.subarray(-TAG_BYTES);

  const decipher = crypto.createDecipheriv(`aes-${aesKey.length * 8}-gcm`, aesKey, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(body), decipher.final()]);

  return { body: JSON.parse(plain.toString('utf8')), aesKey, iv };
}

/**
 * Encrypt one reply, with the IV inverted as the protocol requires.
 *
 * Returns base64 text — the endpoint sends it as a bare string body, not JSON.
 */
function encryptResponse(response, aesKey, iv) {
  const flipped = Buffer.from(iv.map((b) => ~b & 0xff));

  const cipher = crypto.createCipheriv(`aes-${aesKey.length * 8}-gcm`, aesKey, flipped);
  const out = Buffer.concat([
    cipher.update(JSON.stringify(response), 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return out.toString('base64');
}

module.exports = { decryptRequest, encryptResponse };
