/**
 * shiftSummary.js — what one shift at a gate did, for the handover.
 *
 * WHAT A HANDOVER NEEDS. The next person, and the office, want to know three
 * things about a shift: how many vehicles went through, how many were turned
 * away or let in outside their slot, and how much money the staff member is
 * holding. The last one is the one that matters most at the end of a day — cash
 * taken at a barrier is only as good as the count at handover.
 *
 * WHAT COUNTS AS THIS SHIFT. Checks carry the session they were made in, so
 * those are exact. A pass sold at the barrier carries the staff member and the
 * gate, not the session, so a sale belongs to this shift when it was made by this
 * person at this gate between the shift's start and its end.
 *
 * Amounts are rupees, rounded to the paisa, because this is read by a person.
 */

const { one } = require('./db');

const n = (v) => Number(v || 0);
const rupees = (paise) => Math.round(n(paise)) / 100;

async function forSession(sessionId) {
  const s = await one(
    `SELECT ss.id, ss.staff_id, ss.checkpost_id, ss.started_at, ss.ended_at, ss.ended_reason,
            st.name AS staff_name, cp.name AS checkpost_name
       FROM staff_sessions ss
       JOIN staff st ON st.id = ss.staff_id
       LEFT JOIN checkposts cp ON cp.id = ss.checkpost_id
      WHERE ss.id = $1`, [sessionId]);
  if (!s) return null;

  const until = s.ended_at || new Date();

  const checks = await one(
    `SELECT count(*)                                                            AS checks,
            count(*) FILTER (WHERE verdict IN ('valid', 'valid_override'))      AS entries,
            count(*) FILTER (WHERE verdict = 'valid_override')                  AS overrides,
            count(*) FILTER (WHERE verdict NOT IN ('valid', 'valid_override'))  AS refused,
            round(avg(duration_ms) FILTER (WHERE duration_ms IS NOT NULL))      AS avg_ms
       FROM scans
      WHERE session_id = $1`, [s.id]);

  const sales = await one(
    `SELECT count(*)                                                              AS sold,
            count(*) FILTER (WHERE t.status = 'used')                             AS sold_entered,
            COALESCE(sum(g.amount_paise), 0)                                      AS total,
            COALESCE(sum(g.amount_paise) FILTER (WHERE g.payment_method = 'cash'), 0) AS cash,
            COALESCE(sum(g.amount_paise) FILTER (WHERE g.payment_method = 'upi'), 0)  AS upi,
            COALESCE(sum(g.amount_paise) FILTER (WHERE g.payment_method = 'card'), 0) AS card,
            count(*) FILTER (WHERE g.declared)                                    AS declared
       FROM ticket_grants g
       JOIN tickets t ON t.id = g.ticket_id
      WHERE g.kind = 'onspot'
        AND g.issued_by_staff = $1
        AND (g.checkpost_id = $2 OR g.checkpost_id IS NULL)
        AND g.created_at >= $3 AND g.created_at <= $4`,
    [s.staff_id, s.checkpost_id, s.started_at, until]);

  const minutes = Math.max(0, Math.round((new Date(until).getTime() - new Date(s.started_at).getTime()) / 60000));

  return {
    sessionId: String(s.id),
    staff: s.staff_name,
    checkpost: s.checkpost_name,
    startedAt: s.started_at,
    endedAt: s.ended_at,
    endedReason: s.ended_reason,
    minutes,
    checks: n(checks.checks),
    /* Checked and let in at the barrier, plus passes sold here with the entry
       recorded at the same moment — both are vehicles this person let through. */
    entries: n(checks.entries) + n(sales.sold_entered),
    overrides: n(checks.overrides),
    refused: n(checks.refused),
    averageSeconds: checks.avg_ms === null ? null : Math.round(n(checks.avg_ms) / 100) / 10,
    sold: {
      count: n(sales.sold),
      entered: n(sales.sold_entered),
      declared: n(sales.declared),
      total: rupees(sales.total),
      cash: rupees(sales.cash),
      upi: rupees(sales.upi),
      card: rupees(sales.card),
    },
  };
}

/** Work the summary out and keep it with the shift — called as the shift ends. */
async function save(sessionId) {
  const summary = await forSession(sessionId);
  if (!summary) return null;
  await one(`UPDATE staff_sessions SET handover = $2 WHERE id = $1 RETURNING id`, [sessionId, JSON.stringify(summary)]);
  return summary;
}

module.exports = { forSession, save };
