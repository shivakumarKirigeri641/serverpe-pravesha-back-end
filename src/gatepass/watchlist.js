/**
 * watchlist.js — plates the gate must stop, or look at twice.
 *
 * 'block' stops the vehicle at the barrier whatever pass it holds, and tells the
 * staff member to call the office. 'check' lets it through but says why somebody
 * asked for a closer look. The gate asks about every plate it shows, so the
 * look-up is one query for a whole list, not one per vehicle.
 *
 * Changes are made from the panel with a reason and an audit row; nothing is
 * ever deleted — see 052.
 */

const { query, one } = require('./db');

const clean = (r) => String(r || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

class Refusal extends Error {
  constructor(message, { status = 400, code = 'refused' } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const LEVELS = {
  block: 'Blocked — do not allow entry',
  check: 'Check carefully',
};

const shape = (r) => ({
  id: String(r.id),
  regNo: r.reg_no,
  level: r.level,
  levelLabel: LEVELS[r.level] || r.level,
  reason: r.reason,
  addedBy: r.added_by_name || null,
  since: r.created_at,
  changedAt: r.modified_at,
  removedAt: r.removed_at || null,
  removedBy: r.removed_by_name || null,
  removedReason: r.removed_reason || null,
});

/** The live entries for a set of plates, as a Map keyed by plate. */
async function forPlates(regNos) {
  const plates = [...new Set((regNos || []).map(clean).filter(Boolean))];
  if (!plates.length) return new Map();
  const { rows } = await query(
    `SELECT id, reg_no, level, reason, created_at, modified_at FROM vehicle_watchlist
      WHERE removed_at IS NULL AND reg_no = ANY($1::text[])`, [plates]);
  return new Map(rows.map((r) => [r.reg_no, { level: r.level, reason: r.reason, since: r.created_at }]));
}

async function levelFor(regNo) {
  const map = await forPlates([regNo]);
  return map.get(clean(regNo)) || null;
}

/** The sentence a gate shows for a blocked plate. */
const gateMessage = (w) => `This vehicle is on the watchlist — do not allow entry. Call the office.${w && w.reason ? ` Reason: ${w.reason}` : ''}`;

async function list({ removed = false } = {}) {
  const { rows } = await query(
    `SELECT w.*, a.name AS added_by_name, r.name AS removed_by_name,
            (SELECT max(sc.scanned_at) FROM scans sc WHERE sc.reg_no = w.reg_no) AS last_seen
       FROM vehicle_watchlist w
       LEFT JOIN admin_users a ON a.id = w.added_by
       LEFT JOIN admin_users r ON r.id = w.removed_by
      WHERE ${removed ? 'w.removed_at IS NOT NULL' : 'w.removed_at IS NULL'}
      ORDER BY ${removed ? 'w.removed_at' : 'w.created_at'} DESC
      LIMIT 200`);
  return {
    entries: rows.map((r) => ({ ...shape(r), lastSeenAtGate: r.last_seen || null })),
    counts: (await one(
      `SELECT count(*) FILTER (WHERE level = 'block') AS block, count(*) FILTER (WHERE level = 'check') AS check
         FROM vehicle_watchlist WHERE removed_at IS NULL`)),
  };
}

/** Put a plate on the list, or change the level and reason of the live entry. */
async function add({ regNo, level, reason, adminId }) {
  const plate = clean(regNo);
  if (plate.length < 4 || plate.length > 17) throw new Refusal('Enter the vehicle number as it is on the plate.');
  if (!LEVELS[level]) throw new Refusal('Choose Blocked or Check carefully.');
  const why = String(reason || '').trim();
  if (why.length < 5) throw new Refusal('Say why, in a few words. The gate shows this to the staff member.');

  const before = await one(`SELECT * FROM vehicle_watchlist WHERE reg_no = $1 AND removed_at IS NULL`, [plate]);
  const row = before
    ? await one(
      `UPDATE vehicle_watchlist SET level = $2, reason = $3, modified_at = now() WHERE id = $1 RETURNING *`,
      [before.id, level, why])
    : await one(
      `INSERT INTO vehicle_watchlist (reg_no, level, reason, added_by) VALUES ($1, $2, $3, $4) RETURNING *`,
      [plate, level, why, adminId || null]);
  return { entry: shape(row), before: before ? shape(before) : null };
}

async function remove({ regNo, reason, adminId }) {
  const plate = clean(regNo);
  const why = String(reason || '').trim();
  if (why.length < 5) throw new Refusal('Say why it is coming off the list.');
  const row = await one(
    `UPDATE vehicle_watchlist SET removed_at = now(), removed_by = $2, removed_reason = $3, modified_at = now()
      WHERE reg_no = $1 AND removed_at IS NULL RETURNING *`, [plate, adminId || null, why]);
  if (!row) throw new Refusal('That vehicle is not on the watchlist.', { status: 404, code: 'not_found' });
  return { entry: shape(row) };
}

module.exports = { LEVELS, Refusal, clean, forPlates, levelFor, gateMessage, list, add, remove };
