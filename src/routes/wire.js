/**
 * wire.js — the booking API's request and response bodies, encrypted.
 *
 * WHAT THIS IS, STATED HONESTLY, because a security note that oversells itself
 * is worse than none. The pages are served over HTTPS, so the bodies are
 * already encrypted between the phone and the server: nobody on the network,
 * on the café wifi or at the ISP can read them either way. What this layer
 * adds is that the bodies are opaque to someone looking at the traffic INSIDE
 * the browser — the network tab, an intercepting proxy with its own root
 * certificate, a scraper pointed at the endpoints.
 *
 * The key is derived from the visitor's own single-use booking token, so every
 * booking link has a different one and a captured body cannot be replayed
 * against another. But the browser must hold the token to use the page at all,
 * which means a determined person with devtools open can always recover the
 * key for THEIR OWN session and read THEIR OWN traffic. That is inherent to
 * running code in a browser and no scheme fixes it.
 *
 * SO THIS IS A DETERRENT, NOT A BOUNDARY, and nothing may depend on it:
 *
 *   * it stops casual inspection and cheap scraping of prices and availability;
 *   * it makes a hand-crafted request to the API substantially more work;
 *   * it does NOT authorise anything, and it does NOT make a client-supplied
 *     value trustworthy.
 *
 * The real protection is that the server never believes the browser about
 * anything that costs money: the vehicle category is derived from the RC
 * record, the price is read from the database, the slot's availability is
 * claimed atomically, and the token is single-use. Those hold whether the body
 * arrived encrypted, in plain JSON, or from curl.
 */

const crypto = require('crypto');

/*
 * A single server secret, stretched per-token. Reusing the session secret
 * would mean one leak compromises both; and a missing secret must not silently
 * degrade to a predictable key, so it falls back to a random one generated at
 * boot — which breaks decryption loudly on restart rather than pretending to
 * encrypt with a guessable key.
 */
const SECRET = process.env.WIRE_SECRET
  || process.env.TOKEN_SECRET
  || crypto.randomBytes(32).toString('hex');

if (!process.env.WIRE_SECRET && !process.env.TOKEN_SECRET) {
  console.warn('[wire] no WIRE_SECRET set — using a random key for this process. '
             + 'Pages served before a restart will fail to decrypt after it.');
}

/** 32 bytes, bound to one booking token. */
function keyFor(token) {
  return crypto.createHmac('sha256', SECRET).update(`wire:${token}`).digest();
}

/** The key as the browser receives it, to import into WebCrypto. */
const keyHex = (token) => keyFor(token).toString('hex');

/**
 * Encrypt an object.
 *
 * AES-256-GCM, with a fresh 12-byte IV every time. GCM rather than CBC because
 * it authenticates as well as encrypts: a body altered in transit fails to
 * open rather than decrypting into something subtly different. The IV must
 * never repeat under one key, hence random per call and never a counter.
 *
 * Wire format is one base64 string: iv (12) | tag (16) | ciphertext.
 */
function seal(obj, token) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyFor(token), iv);
  const body = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
}

/**
 * Decrypt one, or return null.
 *
 * Never throws: a body that will not open is indistinguishable from a body
 * that was never sent, and both are answered with the same refusal. Reporting
 * WHY it failed would tell someone probing the endpoint whether they had the
 * key right, the tag right, or neither.
 */
function open(payload, token) {
  try {
    const raw = Buffer.from(String(payload), 'base64');
    if (raw.length < 29) return null;              // iv + tag + at least a byte
    const d = crypto.createDecipheriv('aes-256-gcm', keyFor(token), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Express middleware for the token-scoped JSON API.
 *
 * Unwraps `{ d: "<sealed>" }` into req.body, and wraps whatever the route
 * passes to res.json back up again. Routes are written as though none of this
 * exists — that is the point: an encryption layer that every handler has to
 * remember to call is one that will eventually be forgotten in a new handler.
 *
 * PLAIN JSON IS STILL ACCEPTED on the way in. The booking page always seals,
 * but the test suites post plain bodies, and a page cached in a phone's
 * browser from before a deploy would otherwise start failing silently. A plain
 * request is answered in plain, so the two never half-meet.
 */
function wireJson(req, res, next) {
  const token = req.params.token;
  const sealed = req.body && typeof req.body.d === 'string' ? req.body.d : null;

  if (sealed) {
    const opened = open(sealed, token);
    if (!opened) return res.status(400).json({ ok: false, error: 'bad_request' });
    req.body = opened;
    req.wire = true;
  }

  if (req.wire) {
    /* Written with res.send rather than res.json ON PURPOSE. The global
       branding middleware wraps res.json and adds powered_by and website to
       every object that passes through it — which, on a sealed response,
       produced {"d":"…","powered_by":"…","website":"…"}: the payload hidden
       and two plaintext fields sitting beside it announcing who built it.
       Harmless, but it defeats the point of the exercise, and these endpoints
       are internal to one booking link rather than a public API anybody is
       meant to read a vendor name off. */
    res.json = (obj) => res.type('application/json')
      .send(JSON.stringify({ d: seal(obj, token) }));
  }
  next();
}

/**
 * The browser half, as a script fragment for a page's <script> block.
 *
 * Defines one function, `wpost(path, body)`, which both booking pages use in
 * place of fetch. Kept here rather than written out in each page so the two
 * halves of the format — and particularly the tag position, which is the part
 * that goes wrong — are described in one file.
 *
 * FALLS BACK TO PLAIN JSON when crypto.subtle is missing. WebCrypto requires a
 * secure context, so a page served over plain http to an IP address on a
 * laptop has no crypto.subtle at all. Failing hard there would mean the
 * booking form silently doing nothing during a demo on a local network; the
 * server accepts plain bodies for exactly this reason, and nothing depends on
 * the sealing for its safety.
 */
function clientScript(token) {
  return `
const WT=${JSON.stringify(token)};
const WK=(window.crypto&&crypto.subtle)?crypto.subtle.importKey('raw',
  Uint8Array.from(${JSON.stringify(keyHex(token))}.match(/../g).map(h=>parseInt(h,16))),
  'AES-GCM',false,['encrypt','decrypt']):null;
const wb64=b=>btoa(String.fromCharCode.apply(null,new Uint8Array(b)));
const wunb=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function wseal(o){
  const k=await WK,iv=crypto.getRandomValues(new Uint8Array(12));
  const ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},k,
    new TextEncoder().encode(JSON.stringify(o))));
  /* Node keeps the 16-byte GCM tag in its own field; WebCrypto appends it to
     the ciphertext. Moving it to the front is what makes the two agree. */
  const body=ct.slice(0,ct.length-16),tag=ct.slice(ct.length-16);
  const out=new Uint8Array(28+body.length);
  out.set(iv,0);out.set(tag,12);out.set(body,28);
  return wb64(out);
}
async function wopen(s){
  const k=await WK,raw=wunb(s),iv=raw.slice(0,12),tag=raw.slice(12,28),body=raw.slice(28);
  const j=new Uint8Array(body.length+16);j.set(body,0);j.set(tag,body.length);
  return JSON.parse(new TextDecoder().decode(
    await crypto.subtle.decrypt({name:'AES-GCM',iv},k,j)));
}
async function wpost(p,b){
  const payload=WK?{d:await wseal(b)}:b;
  const r=await fetch('/book/'+WT+'/'+p,{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
    .then(x=>x.json());
  return (r&&typeof r.d==='string')?wopen(r.d):r;
}`;
}

module.exports = { seal, open, keyFor, keyHex, wireJson, clientScript };
