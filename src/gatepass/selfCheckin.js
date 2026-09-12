/**
 * selfCheckin.js — "I am already at the checkpost."
 *
 * WHAT IT IS FOR. Somebody is turned away at the barrier for having no pass.
 * They book one standing there, on their phone, with the staff member watching
 * them do it. Sending them to the back of the queue to be checked in is asking
 * them to prove something everybody present can already see. A tick box on the
 * payment sheet records the entry along with the payment.
 *
 * WHY IT IS CHECKED RATHER THAN BELIEVED. A tick box on its own is a claim, and
 * the expensive failure is not fraud — nobody gains by marking themselves in —
 * but a mistap. Somebody booking from home who ticks it arrives at the barrier
 * holding a pass the gate reads as used, and being refused after paying is a far
 * worse morning than the queueing this saves. So the phone is asked where it is,
 * and the distance decides: from home it fails by kilometres.
 *
 * THE PHONE IS NOT TRUSTED WITH THE VERDICT. It reports coordinates; this
 * decides. A browser can be told to say anything, which matters less than it
 * sounds when the prize is skipping a queue — but a rule enforced on the client
 * is not a rule.
 *
 * AND IT IS STILL RECORDED AS UNWITNESSED. An entry nobody at the gate saw is a
 * different fact from one a staff member checked. The gate is told which it is
 * holding — a self-declared pass is shown as valid and still checkable, never
 * refused as already used — and the stronger fact replaces the weaker one when
 * somebody does check it. Reports can tell them apart, because the day the
 * question "how many got in unseen?" is asked, the answer has to exist.
 *
 * WITHOUT COORDINATES FOR THE GATE THERE IS NO OFFER. A checkpost whose position
 * nobody has recorded cannot tell near from far, and a box that cannot be
 * checked is worse than no box. It appears once somebody sets them.
 */

const { query, one } = require('./db');
const slotTime = require('./slotTime');

/*
 * "Could this vehicle drive through the barrier right now?"
 *
 * Deliberately not slotTime.check(), which answers a different question — that
 * one says whether a slot may still be SOLD, and a slot can be sold at five in
 * the morning for a window that opens at six. Somebody an hour early is turned
 * away at the gate, so they must not be able to record themselves as entered.
 * This is the gate's own window: from the moment the slot opens until entry
 * closes, an hour before it ends.
 */
function enterableNow(slot, at = new Date()) {
  const now = slotTime.nowIST(at);
  const startsAt = slotTime.toMinutes(String(slot.starts_at).slice(0, 5));
  const lastEntry = slotTime.toMinutes(String(slot.ends_at).slice(0, 5)) - slotTime.LAST_ENTRY_BUFFER_MIN;
  if (now.minutes < startsAt) return { ok: false, reason: 'too_early', opensAt: slotTime.hhmm(startsAt) };
  if (now.minutes >= lastEntry) return { ok: false, reason: 'too_late', lastEntry: slotTime.hhmm(lastEntry) };
  return { ok: true };
}

/* Metres between two points on the earth. Good to a metre at these distances,
   which is far finer than any phone reports. */
function metresBetween(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

const far = (m) => (m > 1500 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);

/** The gate a visitor to this place would be standing at. */
async function gateFor(placeId) {
  return one(
    `SELECT id, name, latitude, longitude, checkin_radius_m
       FROM checkposts
      WHERE place_id = $1 AND is_active AND latitude IS NOT NULL AND longitude IS NOT NULL
      ORDER BY id LIMIT 1`, [placeId]);
}

/**
 * Should the box be shown at all?
 *
 * Only for a pass that could be used the moment it is paid for: today, in a slot
 * that is open and has not passed its last entry. A pass for tomorrow cannot be
 * entered today whatever the visitor ticks, and offering the box there is an
 * invitation to exactly the mistake this guards against.
 */
async function offered({ placeId, slotId, travelDate }) {
  const gate = await gateFor(placeId);
  if (!gate) return { offered: false, reason: 'no_gate_location' };
  if (String(travelDate).slice(0, 10) !== slotTime.nowIST().date) return { offered: false, reason: 'not_today' };

  const slot = await one(`SELECT * FROM place_slots WHERE id = $1 AND place_id = $2 AND is_active`, [slotId, placeId]);
  if (!slot) return { offered: false, reason: 'no_slot' };
  const window = enterableNow(slot);
  if (!window.ok) return { offered: false, reason: window.reason };

  return { offered: true, gate: gate.name, radiusM: gate.checkin_radius_m };
}

/**
 * Is this phone at the gate?
 *
 * A fix vaguer than the radius itself is refused: a position that could be
 * anywhere within half a kilometre cannot show somebody is within three hundred
 * metres, and accepting it would make the check theatre.
 */
async function verify({ placeId, latitude, longitude, accuracy = null }) {
  const gate = await gateFor(placeId);
  if (!gate) {
    return { ok: false, reason: 'no_gate_location',
      message: 'This gate cannot confirm arrivals yet. The staff member will check you in.' };
  }

  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { ok: false, reason: 'no_position',
      message: 'We could not read your location. The staff member will check you in.' };
  }

  const distance = metresBetween(lat, lng, Number(gate.latitude), Number(gate.longitude));
  const margin = Number(accuracy) || 0;
  if (margin > gate.checkin_radius_m) {
    return { ok: false, reason: 'too_vague', distance,
      message: 'Your phone is not sure enough where it is. The staff member will check you in.' };
  }
  if (distance > gate.checkin_radius_m) {
    return { ok: false, reason: 'too_far', distance,
      message: `You appear to be about ${far(distance)} from ${gate.name}. Your pass will be checked when you arrive.` };
  }

  return { ok: true, gate, distance,
    message: `You are at ${gate.name}. Your entry will be recorded when you pay.` };
}

/**
 * Record the entry, once the money is in.
 *
 * Everything is checked again here — not because the visitor may have moved, but
 * because time has: a payment can take minutes, and a slot that closes meanwhile
 * must not admit anybody. Failure is quiet: the pass is perfectly good, and the
 * visitor is simply checked in at the barrier like everybody else, which is the
 * thing this was saving them and not something worth failing a paid booking for.
 */
async function recordIfAsked(ticket) {
  if (!ticket || ticket.self_checkin_asked !== true) return { recorded: false, reason: 'not_asked' };
  if (ticket.status === 'used') return { recorded: false, reason: 'already_used' };

  const now = slotTime.nowIST();
  if (String(ticket.travel_date instanceof Date ? ticket.travel_date.toISOString() : ticket.travel_date).slice(0, 10) !== now.date) {
    return { recorded: false, reason: 'not_today' };
  }

  const slot = await one(`SELECT * FROM place_slots WHERE id = $1`, [ticket.slot_id]);
  const window = slot ? enterableNow(slot) : { ok: false, reason: 'no_slot' };
  if (!window.ok) return { recorded: false, reason: window.reason };

  const gate = await gateFor(ticket.place_id);

  const marked = await one(
    `UPDATE tickets SET status = 'used', used_at = now(), entry_source = 'self', modified_at = now()
      WHERE id = $1 AND status = 'paid' RETURNING used_at`, [ticket.id]);
  if (!marked) return { recorded: false, reason: 'not_paid' };

  /* The same row a barrier would write, so live monitoring, the activity feed
     and every report see it without knowing this feature exists — except that it
     carries no staff member, which is precisely the point. */
  await query(
    `INSERT INTO scans (ticket_id, ticket_no, reg_no, checkpost_id, staff_id, verdict, raw_payload, scanned_at)
     VALUES ($1,$2,$3,$4,NULL,'valid',$5, now())`,
    [ticket.id, ticket.ticket_no, ticket.reg_no, gate ? gate.id : null,
      JSON.stringify({ selfDeclared: true, metresFromGate: ticket.self_checkin_m })]);

  require('../log').event('gate', 'self',
    `${ticket.ticket_no}  ${ticket.reg_no} · declared at the gate${ticket.self_checkin_m != null ? ` · ${ticket.self_checkin_m}m` : ''}`);

  return { recorded: true, at: marked.used_at, gate: gate ? gate.name : null };
}

module.exports = { metresBetween, enterableNow, gateFor, offered, verify, recordIfAsked };
