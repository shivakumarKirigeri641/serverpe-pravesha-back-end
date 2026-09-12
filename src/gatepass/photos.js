/**
 * photos.js — pictures taken at the barrier.
 *
 * A staff member selling a pass on the spot can photograph two things: the UPI
 * screen the visitor is holding up, and the vehicle itself when it has no number
 * plate to record. Both are evidence for a question asked later — did this
 * payment happen, and what actually came through the gate — and neither can be
 * reconstructed from anything else in the system.
 *
 * THE PHONE SHRINKS THE IMAGE, NOT THIS. A modern camera produces four megabytes
 * that prove nothing more than a hundred and fifty kilobytes do, and the phone at
 * a hill checkpost is on whatever signal it can find. The browser scales and
 * re-encodes before uploading; this end simply refuses anything too large, and
 * refuses it politely enough that the staff member knows to try again rather than
 * wondering whether the sale went through.
 *
 * PHOTOGRAPHS ARRIVE BEFORE THE PASS EXISTS. Nothing is sold while somebody is
 * holding up a camera, so an upload returns an id and the sale quotes those ids
 * when it completes. Unclaimed pictures are rubbish — an abandoned sale, a
 * duplicate shot — and are swept on every upload rather than by a scheduled job
 * nobody will remember exists.
 */

const { query, one } = require('./db');

const MAX_BYTES = 2 * 1024 * 1024;           // after the phone has shrunk it
const KINDS = ['upi', 'vehicle', 'plate', 'other'];
const MIMES = { 'image/jpeg': true, 'image/png': true, 'image/webp': true };

class PhotoRefusal extends Error {
  constructor(message, code = 'bad_photo', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const refuse = (message, code, status) => { throw new PhotoRefusal(message, code, status); };

/** A data URL from a canvas, back into bytes. */
function decode(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
  if (!m) refuse('That does not look like a photograph. Take it again.', 'bad_image');
  const bytes = Buffer.from(m[2].replace(/\s/g, ''), 'base64');
  if (!bytes.length) refuse('The photograph came through empty. Take it again.', 'empty_image');
  if (bytes.length > MAX_BYTES) {
    refuse('That photograph is too large to send from a gate. Take it again — the app will shrink it.', 'too_large', 413);
  }
  return { mime: m[1], bytes };
}

/**
 * Keep a photograph, unattached, and hand back its id.
 *
 * Taken by a staff member at a gate, or by somebody at the desk in the panel —
 * whichever it was is recorded, because a photograph nobody is accountable for
 * is not evidence.
 */
async function keep({ dataUrl, kind, note = null, staffId = null, adminId = null, checkpostId = null, width = null, height = null, isTest = false }) {
  if (!KINDS.includes(String(kind))) refuse('Say what the photograph is of.', 'bad_kind');
  const { mime, bytes } = decode(dataUrl);
  if (!MIMES[mime]) refuse('Photographs must be JPEG, PNG or WebP.', 'bad_mime');

  /* Sweep what was never claimed. A sale abandoned yesterday leaves a picture
     nobody will ever look at, and it is somebody's number plate. */
  await query(`DELETE FROM gate_photos WHERE ticket_id IS NULL AND created_at < now() - interval '12 hours'`).catch(() => {});

  const row = await one(
    `INSERT INTO gate_photos (kind, mime, bytes, byte_size, width, height, taken_by, taken_by_admin, checkpost_id, note, is_test)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id, kind, mime, byte_size, width, height, created_at`,
    [kind, mime, bytes, bytes.length,
      Number(width) || null, Number(height) || null,
      staffId || null, adminId || null, checkpostId || null,
      note ? String(note).slice(0, 300) : null, isTest === true]);

  return {
    id: String(row.id), kind: row.kind, mime: row.mime,
    size: Number(row.byte_size), width: row.width, height: row.height, at: row.created_at,
  };
}

/**
 * Attach photographs to the pass they belong to.
 *
 * Only ones this gate took, and only ones not already spoken for: an id from
 * somebody else's sale cannot be quoted into this one. Silently ignoring the
 * rest is deliberate — a pass that is already sold must not fail over a picture.
 */
async function claim(ticketId, ids, { staffId = null, checkpostId = null } = {}) {
  const list = (Array.isArray(ids) ? ids : [ids])
    .map((x) => String(x || '').trim())
    .filter((x) => /^\d+$/.test(x));
  if (!list.length) return 0;

  const out = await query(
    `UPDATE gate_photos SET ticket_id = $1
      WHERE id = ANY($2::bigint[]) AND ticket_id IS NULL
        AND ($3::bigint IS NULL OR taken_by = $3::bigint OR checkpost_id = $4::bigint)`,
    [ticketId, list, staffId, checkpostId]);
  return out.rowCount;
}

/** What is on file for a pass — the list, without the bytes. */
async function forTicket(ticketId) {
  const rows = (await query(
    `SELECT p.id, p.kind, p.mime, p.byte_size, p.width, p.height, p.note, p.created_at,
            s.name AS staff_name, u.name AS admin_name
       FROM gate_photos p
       LEFT JOIN staff s ON s.id = p.taken_by
       LEFT JOIN admin_users u ON u.id = p.taken_by_admin
      WHERE p.ticket_id = $1 ORDER BY p.id`, [ticketId])).rows;
  return rows.map((r) => ({
    id: String(r.id), kind: r.kind, mime: r.mime, size: Number(r.byte_size),
    width: r.width, height: r.height, note: r.note, at: r.created_at,
    by: r.staff_name || r.admin_name || null,
  }));
}

/** The bytes, for whoever is allowed to look. */
async function bytesOf(id) {
  if (!/^\d+$/.test(String(id))) return null;
  return one(`SELECT id, mime, bytes, byte_size, ticket_id, checkpost_id, created_at FROM gate_photos WHERE id = $1`, [id]);
}

module.exports = { PhotoRefusal, MAX_BYTES, KINDS, keep, claim, forTicket, bytesOf };
