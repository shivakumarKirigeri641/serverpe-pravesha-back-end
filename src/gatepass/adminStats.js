/**
 * adminStats.js — the numbers the dashboard opens on.
 *
 * Every figure is for one day, IST, and is reported beside the same figure for
 * the day before, because a count on its own says nothing: forty arrivals is a
 * good morning or a collapse depending on what yesterday did.
 *
 * THE DEFINITIONS MATTER MORE THAN THE SQL. Each word means one thing here, and
 * the screens use it for nothing else:
 *
 *   booked        passes paid for, for this travel date, whenever they were bought
 *   advance       of those, bought on an earlier day
 *   sameDay       of those, bought on the day of travel
 *   cancelled     passes cancelled after payment
 *   expired       holds that were never paid for and lapsed
 *   arrived       passes presented at a gate — looked up, whatever the answer
 *   entered       passes actually recorded as entering: status 'used'
 *   yetToArrive   paid, not used, and their slot can still be entered
 *   skipped       paid, not used, and the last entry time has passed. A no-show
 *   duplicate     look-ups answered 'already_used' — the same pass twice, which
 *                 is the abuse an encrypted pass number exists to catch
 *   invalid       look-ups refused for any other reason
 *   repeatAttempt a refused vehicle presented again after being refused once
 *   suspicious    duplicates plus repeat attempts: the ones worth a human look
 *   collected     money received that day (paid_at), which is what reconciles
 *                 with the bank — not the value of the passes for that day
 *
 * WHAT IS NOT MEASURED COMES BACK AS NULL, NEVER AS ZERO. Rescheduling and a
 * vehicle-mismatch verdict do not exist in the product yet, and settlement data
 * is not fetched from Razorpay. A dashboard showing 0 for those teaches its
 * reader that nothing is happening, which is worse than an honest dash.
 *
 * "Skipped" is the only figure that moves during the day — a pass is not a
 * no-show until its slot closes — which is why it is computed from the slot's
 * last entry time rather than by a nightly job.
 */

const { query } = require('./db');
const slotTime = require('./slotTime');
const settings = require('./settings');

const rowsOf = async (text, params) => (await query(text, params)).rows;
const n = (v) => Number(v || 0);
const rupees = (paise) => Math.round(n(paise) / 100);

/**
 * Yesterday, relative to a date string.
 *
 * Plain UTC arithmetic on the calendar date rather than an IST instant: midnight
 * IST is the previous afternoon in UTC, so toISOString() on it lands a day early
 * — which briefly had the dashboard comparing today with the day before
 * yesterday.
 */
function previousDay(date) {
  const [y, m, d] = String(date).split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() - 1);
  return at.toISOString().slice(0, 10);
}

/**
 * Change from yesterday.
 *
 * A percentage is meaningless when yesterday was zero — "up 100%" from nothing
 * is a lie dressed as arithmetic — so that returns a null percentage, and the
 * screen says "new" instead of a number.
 */
function delta(today, yesterday) {
  const diff = today - yesterday;
  return {
    value: today,
    previous: yesterday,
    diff,
    percent: yesterday === 0 ? null : Math.round((diff / yesterday) * 1000) / 10,
    direction: diff === 0 ? 'flat' : diff > 0 ? 'up' : 'down',
  };
}

/* The gate can still admit a pass while its last entry time — the slot's end
   minus the same buffer the booking uses — is still ahead of the clock. */
const STILL_ENTERABLE = `(s.ends_at - make_interval(mins => $2::int)) > $3::time`;

/** Everything counted from one day's passes, gate activity and money. */
async function forDay(date, { today, nowTime }) {
  const buffer = slotTime.LAST_ENTRY_BUFFER_MIN;
  const isToday = date === today;
  /* A past day has closed entirely; a future one has not begun. Using the real
     clock only for today keeps every other day's figures stable. */
  const clock = isToday ? nowTime : (date < today ? '23:59:59' : '00:00:00');

  const [passes] = await rowsOf(
    `SELECT
       count(*) FILTER (WHERE t.status IN ('paid','used'))                        AS booked,
       count(*) FILTER (WHERE t.status IN ('paid','used')
                          AND (t.created_at AT TIME ZONE 'Asia/Kolkata')::date < t.travel_date) AS advance,
       count(*) FILTER (WHERE t.status IN ('paid','used')
                          AND (t.created_at AT TIME ZONE 'Asia/Kolkata')::date = t.travel_date) AS same_day,
       count(*) FILTER (WHERE t.status = 'cancelled')                             AS cancelled,
       count(*) FILTER (WHERE t.status = 'expired')                               AS expired,
       count(*) FILTER (WHERE t.status = 'held')                                  AS holding,
       count(*) FILTER (WHERE t.status = 'used')                                  AS entered,
       count(*) FILTER (WHERE t.status = 'paid' AND ${STILL_ENTERABLE})           AS yet_to_arrive,
       count(*) FILTER (WHERE t.status = 'paid' AND NOT ${STILL_ENTERABLE})       AS skipped,
       COALESCE(sum(t.total_paise)    FILTER (WHERE t.status IN ('paid','used')), 0) AS value_paise,
       COALESCE(sum(t.entry_paise)    FILTER (WHERE t.status IN ('paid','used')), 0) AS entry_paise,
       COALESCE(sum(t.platform_paise) FILTER (WHERE t.status IN ('paid','used')), 0) AS platform_paise,
       COALESCE(sum(t.gst_paise)      FILTER (WHERE t.status IN ('paid','used')), 0) AS gst_paise
     FROM tickets t
     JOIN place_slots s ON s.id = t.slot_id
    WHERE t.travel_date = $1`, [date, buffer, clock]);

  /* Gate activity is counted by when it happened, not by travel date. */
  const [gate] = await rowsOf(
    `SELECT
       count(*)                                                            AS lookups,
       count(*) FILTER (WHERE verdict IN ('valid','valid_override'))       AS valid,
       count(*) FILTER (WHERE verdict = 'valid_override')                  AS allowed_late,
       count(*) FILTER (WHERE verdict = 'already_used')                    AS duplicate,
       count(*) FILTER (WHERE verdict IN ('unknown_ticket','wrong_day','wrong_place','not_paid','cancelled')) AS invalid,
       count(*) FILTER (WHERE verdict = 'wrong_slot')                      AS outside_slot,
       count(DISTINCT ticket_id) FILTER (WHERE ticket_id IS NOT NULL)      AS arrived
     FROM scans
    WHERE (scanned_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date`, [date]);

  /* A vehicle refused, then presented again: every attempt after the first. */
  const [repeat] = await rowsOf(
    `SELECT COALESCE(sum(attempts - 1), 0) AS repeat_attempts
       FROM (SELECT reg_no, count(*) AS attempts
               FROM scans
              WHERE (scanned_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date
                AND reg_no IS NOT NULL
                AND verdict NOT IN ('valid','valid_override')
              GROUP BY reg_no
             HAVING count(*) > 1) AS repeats`, [date]);

  const [money] = await rowsOf(
    `SELECT COALESCE(sum(amount_paise), 0) AS collected_paise,
            count(*)                        AS payments,
            COALESCE(sum(COALESCE((raw->'gateway'->>'fee')::bigint, 0)), 0) AS gateway_fee_paise,
            count(*) FILTER (WHERE (raw->'gateway'->>'fee') IS NOT NULL)    AS with_fee
       FROM payments
      WHERE status = 'paid' AND (paid_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date`, [date]);

  const [refunds] = await rowsOf(
    `SELECT count(*) AS refunds, COALESCE(sum(amount_paise), 0) AS refunded_paise
       FROM payments
      WHERE refunded_at IS NOT NULL AND (refunded_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date`, [date]);

  const byCategory = await rowsOf(
    `SELECT c.id, c.code, c.label, count(t.id) AS booked
       FROM vehicle_categories c
       LEFT JOIN tickets t ON t.category_id = c.id AND t.travel_date = $1 AND t.status IN ('paid','used')
      WHERE c.is_active
      GROUP BY c.id, c.code, c.label, c.sort_order
      ORDER BY c.sort_order, c.id`, [date]);

  return {
    booked: n(passes.booked),
    advance: n(passes.advance),
    sameDay: n(passes.same_day),
    cancelled: n(passes.cancelled),
    expired: n(passes.expired),
    holding: n(passes.holding),
    entered: n(passes.entered),
    arrived: n(gate.arrived),
    yetToArrive: n(passes.yet_to_arrive),
    skipped: n(passes.skipped),

    lookups: n(gate.lookups),
    valid: n(gate.valid),
    allowedLate: n(gate.allowed_late),
    duplicate: n(gate.duplicate),
    invalid: n(gate.invalid),
    outsideSlot: n(gate.outside_slot),
    repeatAttempt: n(repeat.repeat_attempts),
    suspicious: n(gate.duplicate) + n(repeat.repeat_attempts),

    valuePaise: n(passes.value_paise),
    entryPaise: n(passes.entry_paise),
    platformPaise: n(passes.platform_paise),
    gstPaise: n(passes.gst_paise),
    collectedPaise: n(money.collected_paise),
    payments: n(money.payments),
    gatewayFeePaise: n(money.gateway_fee_paise),
    gatewayFeeKnown: n(money.with_fee) > 0,
    refunds: n(refunds.refunds),
    refundedPaise: n(refunds.refunded_paise),

    byCategory: Object.fromEntries(byCategory.map((r) => [r.code, { label: r.label, booked: n(r.booked) }])),
  };
}

/** Capacity for the day: what was offered, what went, what is left. */
async function slots(date) {
  const rows = await rowsOf(
    `SELECT p.id AS place_id, p.name AS place_name, p.code AS place_code,
            s.id AS slot_id, s.code AS slot_code,
            regexp_replace(s.label, '[[:space:]]+', ' ', 'g') AS slot_label,
            s.starts_at, s.ends_at,
            c.code AS category_code, c.label AS category_label,
            COALESCE(i.capacity, cap.capacity, 0) AS capacity,
            COALESCE(i.booked, 0) AS booked,
            COALESCE(i.held, 0) AS held,
            COALESCE(i.is_open, true) AS is_open,
            i.closed_note
       FROM places p
       JOIN place_slots s ON s.place_id = p.id AND s.is_active
       JOIN vehicle_categories c ON c.is_active
       LEFT JOIN slot_capacity cap ON cap.place_id = p.id AND cap.slot_id = s.id AND cap.category_id = c.id
       LEFT JOIN slot_inventory i ON i.place_id = p.id AND i.slot_id = s.id AND i.category_id = c.id
                                 AND i.travel_date = $1
      WHERE p.is_active
      ORDER BY p.id, s.sort_order, c.sort_order`, [date]);

  const bySlot = new Map();
  for (const r of rows) {
    const key = `${r.place_id}:${r.slot_id}`;
    if (!bySlot.has(key)) {
      bySlot.set(key, {
        placeId: String(r.place_id), placeName: r.place_name, placeCode: r.place_code,
        slotId: String(r.slot_id), slotCode: r.slot_code, slotLabel: r.slot_label,
        startsAt: r.starts_at, endsAt: r.ends_at,
        isOpen: r.is_open, closedNote: r.closed_note,
        capacity: 0, booked: 0, held: 0, available: 0, occupancyPercent: 0, categories: [],
      });
    }
    const slot = bySlot.get(key);
    const capacity = n(r.capacity);
    const booked = n(r.booked);
    const held = n(r.held);
    const available = Math.max(0, capacity - booked - held);
    slot.capacity += capacity;
    slot.booked += booked;
    slot.held += held;
    slot.available += available;
    slot.categories.push({ code: r.category_code, label: r.category_label, capacity, booked, held, available });
  }

  return [...bySlot.values()].map((s) => ({
    ...s,
    occupancyPercent: s.capacity ? Math.round(((s.booked + s.held) / s.capacity) * 100) : 0,
  }));
}

/** Capacity per vehicle type across every slot, for the breakdown table. */
function capacityByVehicle(slotRows, todayCats, yesterdayCats) {
  const totals = new Map();
  for (const slot of slotRows) {
    for (const c of slot.categories) {
      if (!totals.has(c.code)) {
        totals.set(c.code, { code: c.code, label: c.label, capacity: 0, booked: 0, held: 0, available: 0 });
      }
      const t = totals.get(c.code);
      t.capacity += c.capacity;
      t.booked += c.booked;
      t.held += c.held;
      t.available += c.available;
    }
  }
  return [...totals.values()].map((t) => ({
    ...t,
    occupancyPercent: t.capacity ? Math.round(((t.booked + t.held) / t.capacity) * 100) : 0,
    /* Compared on passes sold rather than on the inventory counter, so today and
       yesterday are measured the same way. */
    ...delta(todayCats[t.code]?.booked || 0, yesterdayCats[t.code]?.booked || 0),
  }));
}

const recentEntries = (limit = 8) => rowsOf(
  `SELECT sc.verdict, sc.scanned_at, sc.ticket_no, sc.reg_no,
          st.name AS staff_name, cp.name AS checkpost_name, c.label AS category_label
     FROM scans sc
     LEFT JOIN staff st ON st.id = sc.staff_id
     LEFT JOIN checkposts cp ON cp.id = sc.checkpost_id
     LEFT JOIN tickets t ON t.id = sc.ticket_id
     LEFT JOIN vehicle_categories c ON c.id = t.category_id
    ORDER BY sc.scanned_at DESC
    LIMIT $1`, [limit]);

const trend = (date, days = 14) => rowsOf(
  `SELECT d::date AS day,
          (SELECT count(*) FROM tickets t WHERE t.travel_date = d::date AND t.status IN ('paid','used')) AS booked,
          (SELECT count(*) FROM tickets t WHERE t.travel_date = d::date AND t.status = 'used') AS entered,
          (SELECT COALESCE(sum(amount_paise),0) FROM payments p
            WHERE p.status = 'paid' AND (p.paid_at AT TIME ZONE 'Asia/Kolkata')::date = d::date) AS collected_paise
     FROM generate_series($1::date - ($2::int - 1), $1::date, '1 day') AS d`, [date, days]);

/**
 * Everything the dashboard needs, in one call — one call rather than eight,
 * because a dashboard that fires eight requests shows eight different moments
 * of the same day.
 */
async function dashboard({ date } = {}) {
  const now = slotTime.nowIST();
  const today = now.date;
  const day = date || today;
  const yesterday = previousDay(day);
  const nowTime = `${slotTime.hhmm(now.minutes)}:00`;

  const [t, y, slotRows, entries, trendRows, feePercent, gstPercent] = await Promise.all([
    forDay(day, { today, nowTime }),
    forDay(yesterday, { today, nowTime }),
    slots(day),
    recentEntries(),
    trend(day),
    settings.num('platform_fee_percent', 13),
    settings.num('gst_percent_on_platform', 18),
  ]);

  const compare = (key) => delta(t[key], y[key]);

  const capacity = slotRows.reduce((acc, s) => ({
    capacity: acc.capacity + s.capacity,
    booked: acc.booked + s.booked,
    held: acc.held + s.held,
    available: acc.available + s.available,
  }), { capacity: 0, booked: 0, held: 0, available: 0 });

  /* The department's share is the entry fee; ours is the service fee, out of
     which GST and the gateway's cut are paid. Net is what is actually left.
     The gateway's fee is only known once Razorpay reports it on the payment, so
     it is null rather than zero until then. */
  const serviceFee = rupees(t.platformPaise);
  const gst = rupees(t.gstPaise);
  const gatewayCharges = t.gatewayFeeKnown ? rupees(t.gatewayFeePaise) : null;
  const netRevenue = serviceFee - gst - (gatewayCharges || 0);

  return {
    date: day,
    comparedWith: yesterday,
    isToday: day === today,
    serverTime: slotTime.hhmm(now.minutes),
    /* The service fee is configuration, not a constant in a screen. */
    config: { serviceFeePercent: feePercent, gstPercentOnServiceFee: gstPercent },

    bookings: {
      total: compare('booked'),
      advance: compare('advance'),
      sameDay: compare('sameDay'),
      cancelled: compare('cancelled'),
      expired: compare('expired'),
      /* Rescheduling does not exist in the product yet. */
      rescheduled: null,
    },

    visitors: {
      booked: compare('booked'),
      arrived: compare('arrived'),
      entered: compare('entered'),
      yetToArrive: compare('yetToArrive'),
      skipped: compare('skipped'),
      cancelled: compare('cancelled'),
      expired: compare('expired'),
    },

    verification: {
      lookups: compare('lookups'),
      valid: compare('valid'),
      used: compare('entered'),
      duplicate: compare('duplicate'),
      invalid: compare('invalid'),
      repeatAttempt: compare('repeatAttempt'),
      outsideSlot: compare('outsideSlot'),
      allowedLate: compare('allowedLate'),
      suspicious: compare('suspicious'),
      /* Staff look a vehicle up by its own number, so a pass cannot be presented
         against a different vehicle: there is nothing to mismatch. */
      vehicleMismatch: null,
    },

    capacity: {
      ...capacity,
      occupancyPercent: capacity.capacity ? Math.round(((capacity.booked + capacity.held) / capacity.capacity) * 100) : 0,
      byVehicle: capacityByVehicle(slotRows, t.byCategory, y.byCategory),
    },

    slots: slotRows,

    revenue: {
      ticketValue: delta(rupees(t.valuePaise), rupees(y.valuePaise)),
      departmentAmount: rupees(t.entryPaise),
      serviceFee,
      gst,
      gatewayCharges,
      netRevenue,
      collected: delta(rupees(t.collectedPaise), rupees(y.collectedPaise)),
      payments: compare('payments'),
      refunds: { count: t.refunds, rupees: rupees(t.refundedPaise) },
      /* Settlement data is not fetched from Razorpay yet. */
      pendingSettlement: null,
    },

    recent: entries.map((r) => ({
      verdict: r.verdict, at: r.scanned_at, ticketNo: r.ticket_no, regNo: r.reg_no,
      staff: r.staff_name, checkpost: r.checkpost_name, type: r.category_label,
    })),

    trend: trendRows.map((r) => ({
      day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day),
      booked: n(r.booked),
      entered: n(r.entered),
      collected: rupees(r.collected_paise),
    })),
  };
}

module.exports = { dashboard, forDay, slots, delta, previousDay };
