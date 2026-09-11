/**
 * adminCheckposts.js — the physical entry points: who is on duty, how the gate
 * is coping, and how quickly a vehicle gets through.
 *
 * Everything here is measured, not claimed. "Working" means somebody is signed
 * in to the gate app and passes are being checked; the average verification time
 * is the time the app itself recorded between opening a vehicle and admitting
 * it, not an estimate. A gate that is open with nobody signed in says so.
 *
 * Staff are assigned to checkposts under Settings → Checkpost staff, which owns
 * PINs and postings. This screen shows who is posted where and what they did.
 */

const { query, one } = require('./db');
const slotTime = require('./slotTime');

const n = (v) => Number(v || 0);
const rowsOf = async (text, params) => (await query(text, params)).rows;

class Refusal extends Error {
  constructor(message, { status = 400, code = 'invalid' } = {}) { super(message); this.status = status; this.code = code; }
}
const refuse = (message, opts) => { throw new Refusal(message, opts); };

/* Open hours, from the slots themselves: a gate is "expected open" between the
   first slot's start and the last slot's end. */
async function openNow() {
  const [h] = await rowsOf('SELECT min(starts_at) AS opens, max(ends_at) AS closes FROM place_slots WHERE is_active');
  const now = slotTime.nowIST().minutes;
  const opens = h?.opens ? slotTime.toMinutes(h.opens) : 6 * 60;
  const closes = h?.closes ? slotTime.toMinutes(h.closes) : 18 * 60;
  return { open: now >= opens && now <= closes, opens: slotTime.hhmm(opens), closes: slotTime.hhmm(closes) };
}

const STATS = `
  (SELECT count(*) FROM staff_checkposts sc WHERE sc.checkpost_id = c.id) AS staff_assigned,
  (SELECT count(*) FROM staff_sessions ss WHERE ss.checkpost_id = c.id AND ss.ended_at IS NULL) AS on_duty,
  (SELECT min(ss.started_at) FROM staff_sessions ss WHERE ss.checkpost_id = c.id AND ss.ended_at IS NULL) AS on_duty_since,
  (SELECT count(*) FROM scans s WHERE s.checkpost_id = c.id AND (s.scanned_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date) AS checks_today,
  (SELECT count(*) FROM scans s WHERE s.checkpost_id = c.id AND s.verdict IN ('valid','valid_override')
      AND (s.scanned_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date) AS entries_today,
  (SELECT count(*) FROM scans s WHERE s.checkpost_id = c.id AND s.verdict NOT IN ('valid','valid_override')
      AND (s.scanned_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date) AS refused_today,
  (SELECT count(*) FROM scans s WHERE s.checkpost_id = c.id AND s.scanned_at > now() - interval '1 hour') AS last_hour,
  (SELECT avg(s.duration_ms) FROM scans s WHERE s.checkpost_id = c.id AND s.duration_ms IS NOT NULL
      AND s.scanned_at > now() - interval '7 days') AS avg_ms,
  (SELECT max(s.scanned_at) FROM scans s WHERE s.checkpost_id = c.id) AS last_activity`;

function shape(c, hours) {
  const onDuty = n(c.on_duty);
  const status = !c.is_active ? 'closed' : onDuty > 0 ? 'manned' : hours.open ? 'unmanned' : 'off_hours';
  return {
    id: String(c.id),
    name: c.name,
    place: c.place,
    placeId: c.place_id ? String(c.place_id) : null,
    active: c.is_active,
    note: c.note,
    latitude: c.latitude === null || c.latitude === undefined ? null : Number(c.latitude),
    longitude: c.longitude === null || c.longitude === undefined ? null : Number(c.longitude),
    status,
    statusLabel: { manned: 'Staff on duty', unmanned: 'Nobody signed in', off_hours: 'Outside opening hours', closed: 'Not in use' }[status],
    staffAssigned: n(c.staff_assigned),
    onDuty,
    onDutySince: c.on_duty_since,
    checksToday: n(c.checks_today),
    entriesToday: n(c.entries_today),
    refusedToday: n(c.refused_today),
    lastHour: n(c.last_hour),
    averageSeconds: c.avg_ms === null || c.avg_ms === undefined ? null : Math.round(n(c.avg_ms) / 100) / 10,
    lastActivity: c.last_activity,
  };
}

async function list() {
  const today = slotTime.nowIST().date;
  const hours = await openNow();
  const rows = await rowsOf(
    `SELECT c.*, p.name AS place, ${STATS}
       FROM checkposts c JOIN places p ON p.id = c.place_id
      ORDER BY c.is_active DESC, p.name, c.name`, [today]);
  const places = await rowsOf('SELECT id, name, is_active FROM places ORDER BY is_active DESC, id');
  return {
    today,
    hours,
    places: places.map((p) => ({ id: String(p.id), name: p.name, active: p.is_active })),
    checkposts: rows.map((c) => shape(c, hours)),
  };
}

async function detail(id) {
  const today = slotTime.nowIST().date;
  const hours = await openNow();
  const c = await one(`SELECT c.*, p.name AS place, ${STATS} FROM checkposts c JOIN places p ON p.id = c.place_id WHERE c.id = $2`, [today, id]);
  if (!c) return null;

  const staff = await rowsOf(
    `SELECT s.id, s.name, s.is_active,
            (SELECT started_at FROM staff_sessions ss WHERE ss.staff_id = s.id AND ss.checkpost_id = $1 AND ss.ended_at IS NULL LIMIT 1) AS on_duty_since,
            (SELECT count(*) FROM scans sc WHERE sc.staff_id = s.id AND sc.checkpost_id = $1
                AND (sc.scanned_at AT TIME ZONE 'Asia/Kolkata')::date = $2::date) AS checks_today,
            (SELECT avg(sc.duration_ms) FROM scans sc WHERE sc.staff_id = s.id AND sc.checkpost_id = $1
                AND sc.duration_ms IS NOT NULL AND sc.scanned_at > now() - interval '7 days') AS avg_ms
       FROM staff s JOIN staff_checkposts x ON x.staff_id = s.id
      WHERE x.checkpost_id = $1 ORDER BY s.is_active DESC, s.name`, [id, today]);

  const recent = await rowsOf(
    `SELECT s.verdict, s.scanned_at, s.reg_no, s.ticket_no, s.duration_ms, st.name AS staff
       FROM scans s LEFT JOIN staff st ON st.id = s.staff_id
      WHERE s.checkpost_id = $1 ORDER BY s.scanned_at DESC LIMIT 25`, [id]);

  const hourly = await rowsOf(
    `SELECT h AS hour,
            count(s.id) FILTER (WHERE s.verdict IN ('valid','valid_override')) AS entries,
            count(s.id) FILTER (WHERE s.verdict NOT IN ('valid','valid_override')) AS refused
       FROM generate_series(0, 23) h
       LEFT JOIN scans s ON s.checkpost_id = $1
        AND (s.scanned_at AT TIME ZONE 'Asia/Kolkata')::date = $2::date
        AND extract(hour FROM s.scanned_at AT TIME ZONE 'Asia/Kolkata') = h
      GROUP BY h ORDER BY h`, [id, today]);

  const shifts = await rowsOf(
    `SELECT ss.started_at, ss.ended_at, ss.ended_reason, s.name AS staff
       FROM staff_sessions ss JOIN staff s ON s.id = ss.staff_id
      WHERE ss.checkpost_id = $1 ORDER BY ss.started_at DESC LIMIT 10`, [id]);

  return {
    checkpost: shape(c, hours),
    hours,
    staff: staff.map((s) => ({
      id: String(s.id), name: s.name, active: s.is_active, onDutySince: s.on_duty_since,
      checksToday: n(s.checks_today), averageSeconds: s.avg_ms === null ? null : Math.round(n(s.avg_ms) / 100) / 10,
    })),
    recent: recent.map((r) => ({
      verdict: r.verdict, at: r.scanned_at, regNo: r.reg_no, ticketNo: r.ticket_no,
      seconds: r.duration_ms === null ? null : Math.round(n(r.duration_ms) / 100) / 10, staff: r.staff,
    })),
    hourly: hourly.map((h) => ({ hour: n(h.hour), label: `${String(n(h.hour)).padStart(2, '0')}:00`, entries: n(h.entries), refused: n(h.refused) })),
    shifts: shifts.map((s) => ({ staff: s.staff, startedAt: s.started_at, endedAt: s.ended_at, endedReason: s.ended_reason })),
  };
}

function validate(body, { creating = false } = {}) {
  const out = {};
  if (creating || body.name !== undefined) {
    const name = String(body.name || '').trim();
    if (name.length < 3) refuse('Give the checkpost a name, e.g. "Mullayanagiri Main Gate".');
    out.name = name;
  }
  if (body.note !== undefined) out.note = String(body.note || '').trim().slice(0, 500) || null;
  for (const [field, column] of [['latitude', 'latitude'], ['longitude', 'longitude']]) {
    if (body[field] !== undefined) {
      const v = body[field] === '' || body[field] === null ? null : Number(body[field]);
      if (v !== null && !Number.isFinite(v)) refuse('The location must be a number, or empty.');
      out[column] = v;
    }
  }
  return out;
}

async function create({ body, reason, adminId }) {
  const why = String(reason || '').trim();
  if (why.length < 5) refuse('Say why this checkpost is being added — it is recorded in the audit log.', { code: 'reason_required' });
  const place = await one('SELECT * FROM places WHERE id = $1', [body.placeId]);
  if (!place) refuse('Choose the destination this checkpost belongs to.', { code: 'place' });
  const fields = validate(body, { creating: true });
  if (await one('SELECT 1 FROM checkposts WHERE place_id = $1 AND lower(name) = lower($2)', [place.id, fields.name])) {
    refuse('That destination already has a checkpost with this name.', { status: 409, code: 'exists' });
  }
  const cols = ['place_id', ...Object.keys(fields)];
  const vals = [place.id, ...Object.keys(fields).map((k) => fields[k])];
  const row = await one(
    `INSERT INTO checkposts (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`, vals);
  return {
    checkpost: { id: String(row.id), name: row.name, place: place.name },
    reason: why,
    audit: { subject: `checkpost:${row.id}`, before: null, after: { name: row.name, place: place.name } },
  };
}

async function update({ id, body, reason }) {
  const why = String(reason || '').trim();
  if (why.length < 5) refuse('Say what changed and why — it is recorded in the audit log.', { code: 'reason_required' });
  const before = await one('SELECT * FROM checkposts WHERE id = $1', [id]);
  if (!before) refuse('No such checkpost.', { status: 404, code: 'not_found' });
  const fields = validate(body);
  if (!Object.keys(fields).length) refuse('Nothing has changed.', { code: 'no_change' });
  const cols = Object.keys(fields);
  const after = await one(
    `UPDATE checkposts SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, modified_at = now() WHERE id = $1 RETURNING *`,
    [id, ...cols.map((c) => fields[c])]);
  const pick = (r) => Object.fromEntries(cols.map((c) => [c, r[c]]));
  return { reason: why, audit: { subject: `checkpost:${id}`, before: pick(before), after: pick(after) } };
}

/**
 * Take a checkpost out of use, or bring it back.
 *
 * Closing one ends any shift open at it — a phone still checking passes at a
 * gate that is meant to be shut is exactly what this is for — and refuses if it
 * is the only checkpost an open destination has.
 */
async function setActive({ id, active, reason, adminId }) {
  const why = String(reason || '').trim();
  if (why.length < 5) refuse('Say why — it is recorded in the audit log.', { code: 'reason_required' });
  const c = await one('SELECT c.*, p.name AS place, p.is_active AS place_active FROM checkposts c JOIN places p ON p.id = c.place_id WHERE c.id = $1', [id]);
  if (!c) refuse('No such checkpost.', { status: 404, code: 'not_found' });
  if (c.is_active === active) refuse(active ? 'It is already in use.' : 'It is already out of use.', { code: 'no_change' });

  if (!active && c.place_active) {
    const [others] = await rowsOf('SELECT count(*) AS c FROM checkposts WHERE place_id = $1 AND is_active AND id <> $2', [c.place_id, id]);
    if (n(others.c) === 0) {
      refuse(`${c.place} is open for booking and this is its only checkpost. Add another, or close the destination first.`, { status: 409, code: 'last_checkpost' });
    }
  }

  const ended = await query(
    active ? 'SELECT 1 WHERE false' : `UPDATE staff_sessions SET ended_at = now(), ended_reason = 'signed_out' WHERE checkpost_id = $1 AND ended_at IS NULL`,
    active ? [] : [id]);
  await query('UPDATE checkposts SET is_active = $2, modified_at = now() WHERE id = $1', [id, active]);

  return {
    reason: why,
    shiftsEnded: active ? 0 : ended.rowCount,
    audit: { subject: `checkpost:${id}`, before: { active: c.is_active }, after: { active, shiftsEnded: active ? 0 : ended.rowCount } },
  };
}

module.exports = { Refusal, list, detail, create, update, setActive };
