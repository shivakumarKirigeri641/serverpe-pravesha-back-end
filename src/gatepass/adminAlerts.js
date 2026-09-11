/**
 * adminAlerts.js — Notifications: what needs attention now, and what visitors
 * are being told.
 *
 * ALERTS ARE COMPUTED, NOT COLLECTED. Every alert here is a question asked of
 * the data at the moment the screen loads: is a slot full, are duplicate passes
 * being presented, is a gate unmanned during opening hours, are payments
 * failing? Nothing is written when an alert appears and nothing has to clear it
 * — it goes away when the situation does. The only thing stored is an
 * acknowledgement: somebody has seen it and does not want to be told again for
 * a few hours.
 *
 * ANNOUNCEMENTS are written by a person for visitors. A closure is the one that
 * also acts: it shuts the days it covers so nothing can be sold for them, and
 * lifting it opens exactly those days again. Passes already sold for a closed
 * day are not cancelled — they are counted and reported, because deciding what
 * to do about them is a judgement, not a side effect.
 */

const { query, one, tx } = require('./db');
const settings = require('./settings');
const slotTime = require('./slotTime');
const inventory = require('./inventory');

const n = (v) => Number(v || 0);
const rowsOf = async (text, params) => (await query(text, params)).rows;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : (d ? String(d).slice(0, 10) : null));
const shift = (date, days) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

class Refusal extends Error {
  constructor(message, { status = 400, code = 'invalid' } = {}) { super(message); this.status = status; this.code = code; }
}
const refuse = (message, opts) => { throw new Refusal(message, opts); };

const SEVERITY = { critical: 3, warning: 2, info: 1 };

/* ────────────────────────────────────────────────────────── alerts ── */

async function alerts() {
  const today = slotTime.nowIST().date;
  const minutes = slotTime.nowIST().minutes;
  const [almostPct, dupLimit, failLimit, trafficFactor] = await Promise.all([
    settings.num('alert_slot_almost_full_percent', 90),
    settings.num('alert_duplicate_attempts', 5),
    settings.num('alert_payment_failures', 5),
    settings.num('alert_high_traffic_factor', 1.5),
  ]);

  const found = [];
  const add = (a) => found.push(a);

  /* 1 and 2 — slots full, and slots about to be. Today and the next three days. */
  const capacity = await rowsOf(
    `SELECT i.travel_date, i.capacity, i.booked, i.held, i.is_open, p.name AS place, p.id AS place_id,
            regexp_replace(s.label, '[[:space:]]+', ' ', 'g') AS slot, s.id AS slot_id, c.label AS vehicle, c.code
       FROM slot_inventory i
       JOIN places p ON p.id = i.place_id
       JOIN place_slots s ON s.id = i.slot_id
       JOIN vehicle_categories c ON c.id = i.category_id
      WHERE i.travel_date BETWEEN $1::date AND $2::date AND i.capacity > 0
      ORDER BY i.travel_date, s.starts_at, c.sort_order`, [today, shift(today, 3)]);

  for (const r of capacity) {
    const taken = n(r.booked) + n(r.held);
    const pct = Math.round((taken / n(r.capacity)) * 100);
    const when = asDate(r.travel_date);
    const where = `${r.place} · ${r.slot} · ${r.vehicle}`;
    if (!r.is_open) continue;
    if (taken >= n(r.capacity)) {
      add({ key: `slot_full:${r.place_id}:${r.slot_id}:${r.code}:${when}`, kind: 'slot_full', severity: when === today ? 'critical' : 'warning',
        title: `Slot full — ${where}`, detail: `${taken} of ${r.capacity} places taken for ${when}. Nothing more can be booked.`, date: when });
    } else if (pct >= almostPct) {
      add({ key: `slot_almost:${r.place_id}:${r.slot_id}:${r.code}:${when}`, kind: 'slot_almost_full', severity: 'warning',
        title: `Slot almost full — ${where}`, detail: `${pct}% taken for ${when}: ${n(r.capacity) - taken} place${n(r.capacity) - taken === 1 ? '' : 's'} left.`, date: when });
    }
  }

  /* 3 — repeat attempts at the gate: the same vehicle refused more than once. */
  const [dup] = await rowsOf(
    `SELECT count(*) AS attempts, count(DISTINCT reg_no) AS vehicles
       FROM scans
      WHERE scanned_at > now() - interval '3 hours' AND verdict NOT IN ('valid','valid_override')`);
  if (n(dup.attempts) >= dupLimit) {
    add({ key: `duplicates:${today}:${Math.floor(minutes / 180)}`, kind: 'duplicate_attempts', severity: n(dup.attempts) >= dupLimit * 3 ? 'critical' : 'warning',
      title: 'Unusual refusals at the gate',
      detail: `${n(dup.attempts)} passes were refused in the last three hours across ${n(dup.vehicles)} vehicle${n(dup.vehicles) === 1 ? '' : 's'}. Negative tracking has the detail.`,
      link: '/negative' });
  }

  /* 4 — high traffic: this hour against the same hour on other days. */
  const [traffic] = await rowsOf(
    `WITH now_hour AS (
       SELECT count(*) AS entries FROM scans
        WHERE verdict IN ('valid','valid_override') AND scanned_at > now() - interval '1 hour'),
     usual AS (
       SELECT COALESCE(avg(c), 0) AS avg_entries FROM (
         SELECT count(*) AS c FROM scans
          WHERE verdict IN ('valid','valid_override')
            AND scanned_at BETWEEN now() - interval '15 days' AND now() - interval '1 day'
            AND extract(hour FROM scanned_at AT TIME ZONE 'Asia/Kolkata') = extract(hour FROM now() AT TIME ZONE 'Asia/Kolkata')
          GROUP BY (scanned_at AT TIME ZONE 'Asia/Kolkata')::date) x)
     SELECT (SELECT entries FROM now_hour) AS entries, (SELECT avg_entries FROM usual) AS usual`);
  if (n(traffic.entries) > 20 && n(traffic.usual) > 0 && n(traffic.entries) > n(traffic.usual) * trafficFactor) {
    add({ key: `traffic:${today}:${Math.floor(minutes / 60)}`, kind: 'high_traffic', severity: 'warning',
      title: 'Traffic is higher than usual',
      detail: `${n(traffic.entries)} vehicles entered in the last hour, against ${Math.round(n(traffic.usual))} usual for this hour.`,
      link: '/live' });
  }

  /* 5 — a gate with nobody signed in while the destination is open. */
  const open = await rowsOf(
    `SELECT min(starts_at) AS opens, max(ends_at) AS closes FROM place_slots WHERE is_active`);
  const opensMin = open[0]?.opens ? slotTime.toMinutes(open[0].opens) : 6 * 60;
  const closesMin = open[0]?.closes ? slotTime.toMinutes(open[0].closes) : 18 * 60;
  if (minutes >= opensMin && minutes <= closesMin) {
    const gates = await rowsOf(
      `SELECT c.id, c.name, p.name AS place,
              (SELECT count(*) FROM staff_sessions ss WHERE ss.checkpost_id = c.id AND ss.ended_at IS NULL) AS on_duty,
              (SELECT max(sc.scanned_at) FROM scans sc WHERE sc.checkpost_id = c.id) AS last_check
         FROM checkposts c JOIN places p ON p.id = c.place_id WHERE c.is_active`);
    for (const g of gates) {
      if (n(g.on_duty) === 0) {
        add({ key: `staff_offline:${g.id}:${today}:${Math.floor(minutes / 60)}`, kind: 'staff_offline', severity: 'critical',
          title: `No staff on duty — ${g.name}`,
          detail: `${g.place} is open and nobody is signed in to the gate app at ${g.name}.${g.last_check ? ` Last check ${new Date(g.last_check).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}.` : ''}`,
          link: '/settings/staff' });
      }
    }
  }

  /* 6 — payments failing. */
  const [fails] = await rowsOf(
    `SELECT count(*) FILTER (WHERE status = 'failed') AS failed,
            count(*) FILTER (WHERE status IN ('paid','refunded')) AS paid
       FROM payments WHERE created_at > now() - interval '2 hours'`);
  const attempts = n(fails.failed) + n(fails.paid);
  if (n(fails.failed) >= failLimit && attempts > 0) {
    const rate = Math.round((n(fails.failed) / attempts) * 100);
    add({ key: `payment_failures:${today}:${Math.floor(minutes / 120)}`, kind: 'payment_failures', severity: rate >= 30 ? 'critical' : 'warning',
      title: 'Payments are failing more than usual',
      detail: `${n(fails.failed)} of ${attempts} payment attempts failed in the last two hours (${rate}%).`,
      link: '/payments' });
  }

  /* 7 — the plumbing: WhatsApp errors and vehicle look-up failures. */
  const [wa] = await rowsOf(
    `SELECT count(*) AS errors FROM wa_messages
      WHERE created_at > now() - interval '1 hour' AND direction = 'out'
        AND error_message IS NOT NULL AND error_message NOT IN ('dry_run', 'replies_disabled', 'test_recipient_not_sent')`);
  if (n(wa.errors) > 0) {
    add({ key: `whatsapp_errors:${today}:${Math.floor(minutes / 60)}`, kind: 'system_issue', severity: n(wa.errors) >= 5 ? 'critical' : 'warning',
      title: 'WhatsApp messages are failing',
      detail: `${n(wa.errors)} message${n(wa.errors) === 1 ? '' : 's'} could not be delivered in the last hour.`, link: '/health' });
  }
  const [lookups] = await rowsOf(
    `SELECT count(*) FILTER (WHERE NOT ok) AS failed, count(*) AS total
       FROM api_calls WHERE created_at > now() - interval '1 hour' AND NOT cache_hit`);
  if (n(lookups.failed) >= 3) {
    add({ key: `lookup_errors:${today}:${Math.floor(minutes / 60)}`, kind: 'system_issue', severity: 'warning',
      title: 'Vehicle look-ups are failing',
      detail: `${n(lookups.failed)} of ${n(lookups.total)} look-ups failed in the last hour. Visitors are being asked to choose their vehicle type.`, link: '/health' });
  }

  /* 8 — what visitors are being told right now. */
  const live = await rowsOf(
    `SELECT a.*, p.name AS place FROM announcements a LEFT JOIN places p ON p.id = a.place_id
      WHERE a.is_active AND a.ends_on >= $1::date ORDER BY a.starts_on`, [today]);
  for (const a of live) {
    add({ key: `announcement:${a.id}`, kind: a.kind === 'closure' ? 'closure' : 'announcement', severity: 'info',
      title: a.kind === 'closure' ? `Closed: ${a.title}` : a.title,
      detail: `${a.message}${a.place ? ` · ${a.place}` : ''} · ${asDate(a.starts_on)} to ${asDate(a.ends_on)}`,
      date: asDate(a.starts_on), announcementId: String(a.id) });
  }

  /* Acknowledged alerts stay out of the way until their quiet time is up. */
  const acks = await rowsOf('SELECT alert_key, quiet_until, note FROM alert_acks WHERE quiet_until > now()');
  const quiet = new Map(acks.map((a) => [a.alert_key, a]));

  const visible = found.filter((a) => !quiet.has(a.key));
  visible.sort((a, b) => SEVERITY[b.severity] - SEVERITY[a.severity] || a.title.localeCompare(b.title));

  return {
    at: new Date().toISOString(),
    alerts: visible,
    acknowledged: found.filter((a) => quiet.has(a.key)).map((a) => ({ ...a, quietUntil: quiet.get(a.key).quiet_until, note: quiet.get(a.key).note })),
    counts: {
      critical: visible.filter((a) => a.severity === 'critical').length,
      warning: visible.filter((a) => a.severity === 'warning').length,
      info: visible.filter((a) => a.severity === 'info').length,
    },
  };
}

async function acknowledge({ key, hours, note, adminId }) {
  if (!key) refuse('Which alert?');
  const quiet = Math.max(1, Math.min(72, Number(hours) || await settings.num('alert_quiet_hours', 6)));
  await query(
    `INSERT INTO alert_acks (alert_key, acknowledged_by, quiet_until, note)
     VALUES ($1, $2, now() + ($3 || ' hours')::interval, $4)
     ON CONFLICT (alert_key) DO UPDATE SET acknowledged_by = EXCLUDED.acknowledged_by,
       acknowledged_at = now(), quiet_until = EXCLUDED.quiet_until, note = EXCLUDED.note`,
    [key, adminId || null, String(quiet), String(note || '').trim().slice(0, 300) || null]);
  return { quietHours: quiet, audit: { subject: `alert:${key}`, before: null, after: { quietHours: quiet } }, reason: note || null };
}

async function unacknowledge({ key }) {
  await query('DELETE FROM alert_acks WHERE alert_key = $1', [key]);
  return { audit: { subject: `alert:${key}`, before: { quiet: true }, after: null } };
}

/* ─────────────────────────────────────────────────── announcements ── */

async function announcements() {
  const today = slotTime.nowIST().date;
  const rows = await rowsOf(
    `SELECT a.*, p.name AS place, u.name AS created_by_name, e.name AS ended_by_name,
            (SELECT count(*) FROM closures c WHERE c.announcement_id = a.id AND c.lifted_at IS NULL) AS days_closed
       FROM announcements a
       LEFT JOIN places p ON p.id = a.place_id
       LEFT JOIN admin_users u ON u.id = a.created_by
       LEFT JOIN admin_users e ON e.id = a.ended_by
      ORDER BY a.is_active DESC, a.starts_on DESC LIMIT 50`);
  const places = await rowsOf('SELECT id, name FROM places WHERE is_active ORDER BY id');
  return {
    today,
    places: places.map((p) => ({ id: String(p.id), name: p.name })),
    announcements: rows.map((a) => ({
      id: String(a.id), kind: a.kind, place: a.place, placeId: a.place_id ? String(a.place_id) : null,
      title: a.title, message: a.message, messageKn: a.message_kn,
      startsOn: asDate(a.starts_on), endsOn: asDate(a.ends_on),
      active: a.is_active, live: a.is_active && asDate(a.starts_on) <= today && asDate(a.ends_on) >= today,
      daysClosed: n(a.days_closed), createdBy: a.created_by_name, createdAt: a.created_at,
      endedBy: a.ended_by_name, endedAt: a.ended_at, endReason: a.end_reason,
    })),
  };
}

/** How many passes are already sold for a place across a date range. */
async function affected(placeId, from, to) {
  const [r] = await rowsOf(
    `SELECT count(*) AS passes, count(DISTINCT t.customer_id) AS visitors, COALESCE(sum(t.total_paise), 0) AS paise
       FROM tickets t
      WHERE t.status IN ('paid','held') AND t.travel_date BETWEEN $1::date AND $2::date
        AND ($3::bigint IS NULL OR t.place_id = $3)`, [from, to, placeId || null]);
  return { passes: n(r.passes), visitors: n(r.visitors), amount: Math.round(n(r.paise)) / 100 };
}

async function createAnnouncement({ body, adminId }) {
  const today = slotTime.nowIST().date;
  const kind = ['closure', 'weather', 'notice'].includes(body.kind) ? body.kind : refuse('Choose what kind of announcement this is.');
  const title = String(body.title || '').trim();
  const message = String(body.message || '').trim();
  if (title.length < 3) refuse('Give the announcement a short title.');
  if (message.length < 10) refuse('Write what visitors should know, in a sentence or two.');
  const from = String(body.startsOn || '');
  const to = String(body.endsOn || from);
  if (!DATE.test(from) || !DATE.test(to)) refuse('Choose the dates it covers.');
  if (to < from) refuse('It must start before it ends.');
  if (kind === 'closure' && to < today) refuse('A closure cannot be for dates that have already passed.');
  const place = body.placeId ? await one('SELECT * FROM places WHERE id = $1', [body.placeId]) : null;
  if (body.placeId && !place) refuse('No such destination.', { status: 404 });
  if (kind === 'closure' && !place) refuse('Choose the destination being closed.');

  const hit = kind === 'closure' ? await affected(place?.id, from > today ? from : today, to) : null;

  const out = await tx(async (c) => {
    const a = (await c.query(
      `INSERT INTO announcements (kind, place_id, title, message, message_kn, starts_on, ends_on, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [kind, place?.id || null, title, message, String(body.messageKn || '').trim() || null, from, to, adminId])).rows[0];

    if (kind === 'closure') {
      /* Close every day from today onwards that the announcement covers: a past
         day cannot be un-sold, and closing it would only confuse the reports. */
      const slots = (await c.query('SELECT id FROM place_slots WHERE place_id = $1 AND is_active', [place.id])).rows;
      const cats = (await c.query('SELECT id FROM vehicle_categories WHERE is_active')).rows;
      for (let day = from > today ? from : today; day <= to; day = shift(day, 1)) {
        for (const s of slots) {
          for (const cat of cats) {
            await inventory.ensure(place.id, s.id, cat.id, day);
          }
          await c.query(
            `UPDATE slot_inventory SET is_open = false, closed_note = $4, modified_at = now()
              WHERE place_id = $1 AND slot_id = $2 AND travel_date = $3::date`, [place.id, s.id, day, title]);
        }
        await c.query(
          `INSERT INTO closures (place_id, travel_date, reason, kind, tickets_affected, created_by, announcement_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [place.id, day, `${title} — ${message}`, kind, hit.passes, adminId, a.id]);
      }
    }
    return a;
  });

  return {
    announcement: { id: String(out.id), kind, title, startsOn: from, endsOn: to, place: place?.name || null },
    affected: hit,
    audit: { subject: `announcement:${out.id}`, before: null, after: { kind, title, place: place?.name || 'all destinations', from, to, passesAffected: hit?.passes ?? null } },
    reason: message,
  };
}

async function endAnnouncement({ id, reason, adminId }) {
  const why = String(reason || '').trim();
  if (why.length < 5) refuse('Say why this is being ended — it is recorded in the audit log.', { code: 'reason_required' });
  const a = await one('SELECT * FROM announcements WHERE id = $1 AND is_active', [id]);
  if (!a) refuse('No such announcement, or it has already ended.', { status: 404, code: 'not_found' });

  const reopened = await tx(async (c) => {
    await c.query('UPDATE announcements SET is_active = false, ended_at = now(), ended_by = $2, end_reason = $3 WHERE id = $1', [id, adminId, why]);
    if (a.kind !== 'closure') return 0;
    const days = (await c.query(
      `UPDATE closures SET lifted_at = now(), lifted_by = $2 WHERE announcement_id = $1 AND lifted_at IS NULL
       RETURNING place_id, travel_date`, [id, adminId])).rows;
    for (const d of days) {
      /* Only days this closure shut are reopened, and only if no other live
         closure still covers them. */
      const other = (await c.query(
        `SELECT 1 FROM closures WHERE place_id = $1 AND travel_date = $2 AND lifted_at IS NULL LIMIT 1`, [d.place_id, d.travel_date])).rows[0];
      if (other) continue;
      await c.query(
        `UPDATE slot_inventory SET is_open = true, closed_note = NULL, modified_at = now()
          WHERE place_id = $1 AND travel_date = $2`, [d.place_id, d.travel_date]);
    }
    return days.length;
  });

  return {
    reopened,
    reason: why,
    audit: { subject: `announcement:${id}`, before: { active: true, kind: a.kind, title: a.title }, after: { active: false, daysReopened: reopened } },
  };
}

/** What the website and the booking flow may show. */
async function publicNotices() {
  const today = slotTime.nowIST().date;
  const rows = await rowsOf(
    `SELECT a.kind, a.title, a.message, a.message_kn, a.starts_on, a.ends_on, p.name AS place
       FROM announcements a LEFT JOIN places p ON p.id = a.place_id
      WHERE a.is_active AND a.starts_on <= $1::date AND a.ends_on >= $1::date
      ORDER BY CASE a.kind WHEN 'closure' THEN 0 WHEN 'weather' THEN 1 ELSE 2 END, a.starts_on`, [today]);
  return rows.map((r) => ({
    kind: r.kind, title: r.title, message: r.message, messageKn: r.message_kn,
    place: r.place, from: asDate(r.starts_on), to: asDate(r.ends_on),
  }));
}

module.exports = { Refusal, alerts, acknowledge, unacknowledge, announcements, affected, createAnnouncement, endAnnouncement, publicNotices };
