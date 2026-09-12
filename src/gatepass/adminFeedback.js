/**
 * adminFeedback.js — what visitors said, and what may be quoted.
 *
 * TWO DIFFERENT THINGS LIVE HERE, and keeping them apart is the whole point.
 *
 * The first is an operational signal. A run of two-star ratings on Sunday
 * mornings is the only way anybody in an office will learn that the barrier
 * queue was an hour long, because nobody writes in to say so. That signal is
 * private, it belongs to whoever runs the gate, and it is most useful when it is
 * bad.
 *
 * The second is a testimonial. That is somebody's words and somebody's name on a
 * public marketing page, and it is a different permission entirely — one the
 * visitor never gave by tapping four stars. So nothing is public until a person
 * here publishes it deliberately, their name is recorded against that decision,
 * and the name shown to the world is chosen at that moment rather than lifted
 * from the booking. Unpublishing is one click and takes effect immediately.
 *
 * WHAT IS NEVER DONE: publishing automatically because a rating was high,
 * editing what somebody wrote, or showing a full mobile number. A testimonial
 * that has been improved is not a testimonial.
 */

const { query, one } = require('./db');
const slotTime = require('./slotTime');

const n = (v) => Number(v || 0);
const rowsOf = async (text, params) => (await query(text, params)).rows;
const asDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : (d ? String(d).slice(0, 10) : null));
const mask = (m) => (m ? `••••${String(m).slice(-4)}` : null);

class Refusal extends Error {
  constructor(message, { status = 400, code = 'refused' } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const refuse = (message, opts) => { throw new Refusal(message, opts); };

/** How the period looks at a glance, and whether it is getting better or worse. */
async function overview({ from, to }) {
  const period = { from: from || slotTime.nowIST().date, to: to || from || slotTime.nowIST().date };

  const [totals] = await rowsOf(
    `SELECT count(*)                                   AS answers,
            COALESCE(avg(rating), 0)                   AS average,
            count(*) FILTER (WHERE rating >= 4)        AS happy,
            count(*) FILTER (WHERE rating <= 2)        AS unhappy,
            count(*) FILTER (WHERE comment IS NOT NULL) AS with_words,
            count(*) FILTER (WHERE is_published)       AS published
       FROM feedback
      WHERE NOT is_test AND ${'(created_at AT TIME ZONE \'Asia/Kolkata\')::date'} BETWEEN $1::date AND $2::date`,
    [period.from, period.to]);

  const byStar = await rowsOf(
    `SELECT rating, count(*) AS answers
       FROM feedback
      WHERE NOT is_test AND (created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1::date AND $2::date
      GROUP BY rating ORDER BY rating DESC`, [period.from, period.to]);

  const daily = await rowsOf(
    `SELECT d::date AS day, count(f.*) AS answers, COALESCE(avg(f.rating), 0) AS average
       FROM generate_series($1::date, $2::date, '1 day') d
       LEFT JOIN feedback f ON (f.created_at AT TIME ZONE 'Asia/Kolkata')::date = d::date AND NOT f.is_test
      GROUP BY d ORDER BY d`, [period.from, period.to]);

  /*
   * How many people were asked, against how many answered. A four-star average
   * from nine people out of six hundred is not a four-star service, and a screen
   * that shows the average without the response rate invites exactly that
   * mistake.
   */
  const [asked] = await rowsOf(
    `SELECT count(*) AS entered
       FROM tickets
      WHERE status = 'used' AND travel_date BETWEEN $1::date AND $2::date AND NOT is_test`,
    [period.from, period.to]);

  return {
    period,
    totals: {
      answers: n(totals.answers),
      average: Math.round(n(totals.average) * 10) / 10,
      happy: n(totals.happy),
      unhappy: n(totals.unhappy),
      withWords: n(totals.with_words),
      published: n(totals.published),
      entered: n(asked.entered),
      responseRate: n(asked.entered) ? Math.round((n(totals.answers) / n(asked.entered)) * 100) : null,
    },
    byStar: [5, 4, 3, 2, 1].map((r) => ({
      rating: r,
      answers: n((byStar.find((x) => n(x.rating) === r) || {}).answers),
    })),
    daily: daily.map((r) => ({ day: asDate(r.day), answers: n(r.answers), average: Math.round(n(r.average) * 10) / 10 })),
  };
}

/** The answers themselves. */
async function list({ from = null, to = null, rating = null, state = null, q = null, limit = 50, offset = 0 } = {}) {
  const term = String(q || '').trim();
  const size = Math.max(1, Math.min(200, Number(limit) || 50));
  const skip = Math.max(0, Number(offset) || 0);

  const rows = await rowsOf(
    `SELECT f.id, f.rating, f.comment, f.source, f.created_at, f.modified_at,
            f.is_published, f.published_at, f.display_name, f.decision_note,
            u.name AS published_by,
            cu.name AS visitor, cu.wa_profile_name, t.mobile, t.ticket_no, t.travel_date, t.reg_no,
            p.name AS place
       FROM feedback f
       LEFT JOIN customers cu ON cu.id = f.customer_id
       LEFT JOIN tickets t ON t.id = f.ticket_id
       LEFT JOIN places p ON p.id = f.place_id
       LEFT JOIN admin_users u ON u.id = f.published_by
      WHERE NOT f.is_test
        AND ($1::date IS NULL OR (f.created_at AT TIME ZONE 'Asia/Kolkata')::date >= $1::date)
        AND ($2::date IS NULL OR (f.created_at AT TIME ZONE 'Asia/Kolkata')::date <= $2::date)
        AND ($3::int  IS NULL OR f.rating = $3::int)
        AND ($4::text IS NULL
             OR ($4 = 'published' AND f.is_published)
             OR ($4 = 'unpublished' AND NOT f.is_published)
             OR ($4 = 'words' AND f.comment IS NOT NULL)
             OR ($4 = 'unhappy' AND f.rating <= 2))
        AND ($5::text IS NULL
             OR f.comment ILIKE '%' || $5 || '%'
             OR cu.name ILIKE '%' || $5 || '%'
             OR t.ticket_no ILIKE '%' || $5 || '%'
             OR t.reg_no ILIKE '%' || $5 || '%')
      ORDER BY f.created_at DESC
      LIMIT $6 OFFSET $7`,
    [/^\d{4}-\d{2}-\d{2}$/.test(String(from || '')) ? from : null,
      /^\d{4}-\d{2}-\d{2}$/.test(String(to || '')) ? to : null,
      [1, 2, 3, 4, 5].includes(Number(rating)) ? Number(rating) : null,
      ['published', 'unpublished', 'words', 'unhappy'].includes(state) ? state : null,
      term || null, size, skip]);

  const [count] = await rowsOf(
    `SELECT count(*) AS total FROM feedback f WHERE NOT f.is_test`);

  return {
    total: n(count.total),
    limit: size,
    offset: skip,
    feedback: rows.map((r) => ({
      id: String(r.id),
      rating: n(r.rating),
      comment: r.comment,
      at: r.created_at,
      editedAt: r.modified_at && r.modified_at > r.created_at ? r.modified_at : null,
      source: r.source,
      visitor: r.visitor || r.wa_profile_name || null,
      mobile: mask(r.mobile),
      ticketNo: r.ticket_no,
      regNo: r.reg_no,
      travelDate: asDate(r.travel_date),
      place: r.place,
      published: r.is_published === true,
      publishedAt: r.published_at,
      publishedBy: r.published_by,
      displayName: r.display_name,
      note: r.decision_note,
    })),
  };
}

/**
 * Publish, or take down.
 *
 * A reason is required in both directions and lands in the audit trail: putting
 * a stranger's words on a public page, and taking them down again, are both
 * decisions somebody should be able to account for later.
 */
async function setPublished({ id, publish, displayName, reason, adminId }) {
  const f = await one(
    `SELECT f.*, cu.name AS visitor, cu.wa_profile_name
       FROM feedback f LEFT JOIN customers cu ON cu.id = f.customer_id
      WHERE f.id = $1`, [id]);
  if (!f) refuse('No such feedback.', { status: 404, code: 'not_found' });

  const why = String(reason || '').trim();
  if (why.length < 4) refuse('Write a short reason — it goes in the audit trail.', { code: 'reason_required' });

  if (publish) {
    if (!f.comment || !String(f.comment).trim()) {
      refuse('There is nothing to quote: this visitor gave a rating without any words.', { code: 'nothing_to_quote' });
    }
    /* A name is chosen for publication rather than taken from the booking: the
       name somebody typed to receive a pass is not a name they offered to see
       printed on a marketing page. */
    const shown = String(displayName || '').trim();
    if (shown.length < 2) refuse('Choose the name to show with it — a first name is usually right.', { code: 'name_required' });

    await query(
      `UPDATE feedback SET is_published = true, published_at = now(), published_by = $2,
              display_name = $3, decision_note = $4, modified_at = now()
        WHERE id = $1`, [f.id, adminId || null, shown.slice(0, 60), why.slice(0, 300)]);
  } else {
    await query(
      `UPDATE feedback SET is_published = false, published_at = NULL, decision_note = $2, modified_at = now()
        WHERE id = $1`, [f.id, why.slice(0, 300)]);
  }

  return {
    reason: why,
    audit: {
      subject: `feedback:${f.id}`,
      before: { published: f.is_published === true, displayName: f.display_name },
      after: { published: Boolean(publish), displayName: publish ? String(displayName || '').trim() : null,
        rating: n(f.rating), quoted: publish ? String(f.comment || '').slice(0, 120) : null },
    },
  };
}

/**
 * What the marketing site may show. No names beyond the one chosen, no dates
 * more precise than a month, and never a mobile number or a pass number: a
 * testimonial page is not a place to be able to work out who came when.
 */
async function published({ limit = 12 } = {}) {
  const rows = await rowsOf(
    `SELECT f.id, f.rating, f.comment, f.display_name, f.published_at, p.name AS place
       FROM feedback f LEFT JOIN places p ON p.id = f.place_id
      WHERE f.is_published AND NOT f.is_test AND f.comment IS NOT NULL
      ORDER BY f.published_at DESC
      LIMIT $1`, [Math.max(1, Math.min(50, Number(limit) || 12))]);

  return rows.map((r) => ({
    id: String(r.id),
    rating: n(r.rating),
    comment: r.comment,
    name: r.display_name,
    place: r.place,
    month: r.published_at
      ? new Date(r.published_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', month: 'long', year: 'numeric' })
      : null,
  }));
}

module.exports = { Refusal, overview, list, setPublished, published };
