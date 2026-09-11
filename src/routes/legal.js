/**
 * legal.js — the policies, and what the public website shows.
 *
 *   GET /legal            every policy, with the business and grievance contacts
 *   GET /legal/:code      one policy with its sections (code or slug)
 *   GET /public/site      destinations, fees and booking rules for pravesha.in
 *
 * Public on purpose: a privacy policy nobody can read is not a privacy policy,
 * and Meta, Razorpay and every visitor read these before anyone has an account.
 * They contain only business details already printed on the invoice.
 *
 * {{placeholders}} in the text are filled from app_settings at read time, so the
 * policies can never contradict the invoice and a change of address updates
 * every document at once.
 */

const express = require('express');
const { query } = require('../gatepass/db');
const settings = require('../gatepass/settings');

const router = express.Router();
const ok = (res, data) => res.set('Cache-Control', 'public, max-age=300').json({ success: true, ...data });
const fail = (res, code, error) => res.status(code).json({ success: false, error });

async function tokens() {
  const all = await settings.all();
  const t = Object.fromEntries(all);
  return {
    ...t,
    product_name: t.product_name || 'Pravesha',
    website: t.website || 'www.pravesha.in',
  };
}

function fill(text, t) {
  return String(text || '').replace(/\{\{(\w+)\}\}/g, (whole, key) =>
    (t[key] === null || t[key] === undefined || t[key] === '' ? whole : String(t[key])));
}

async function loadDoc(codeOrSlug) {
  const doc = (await query(
    `SELECT id, doc_code, slug, title, title_kn, version, summary, effective_from, requires_consent, modified_at
       FROM legal_documents WHERE (doc_code = $1 OR slug = $1) AND is_active`, [codeOrSlug])).rows[0];
  if (!doc) return null;
  const { rows } = await query(
    `SELECT section_no, title, description FROM legal_sections
      WHERE document_id = $1 AND is_active ORDER BY display_order, id`, [doc.id]);
  const t = await tokens();
  const { id, ...rest } = doc;
  return {
    ...rest,
    summary: fill(doc.summary, t),
    sections: rows.map((s) => ({ ...s, title: fill(s.title, t), description: fill(s.description, t).trim() })),
  };
}

router.get('/legal', async (req, res) => {
  try {
    const t = await tokens();
    const { rows } = await query(
      `SELECT doc_code, slug, title, title_kn, summary, version, effective_from
         FROM legal_documents WHERE is_active ORDER BY display_order, id`);
    ok(res, {
      documents: rows.map((d) => ({ ...d, summary: fill(d.summary, t) })),
      business: {
        product_name: t.product_name, legal_name: t.legal_name, legal_form: t.legal_form,
        address: t.business_address, gstin: t.gstin, udyam: t.udyam_number,
        email: t.contact_email, website: t.website, vendor_tagline: t.vendor_tagline,
        product_tagline: t.product_tagline,
      },
      /* Published by designation, not by personal name: the address is
         monitored by whoever holds the role, and a public page naming a private
         individual ages badly. `proprietor_name` stays available for documents
         that must name the proprietor. */
      grievance_officer: {
        name: t.grievance_officer_name || 'The Grievance Officer', email: t.contact_email,
        acknowledge_hours: Number(t.grievance_ack_hours || 24),
        resolve_days: Number(t.grievance_resolve_days || 15),
      },
    });
  } catch (e) { console.error('[legal] list:', e.message); fail(res, 500, 'Could not load policies.'); }
});

router.get('/legal/:code', async (req, res) => {
  try {
    const doc = await loadDoc(String(req.params.code));
    if (!doc) return fail(res, 404, 'No such policy.');
    ok(res, { document: doc });
  } catch (e) { console.error('[legal] read:', e.message); fail(res, 500, 'Could not load the policy.'); }
});

/**
 * What the website shows, from the same tables the booking uses: which
 * destinations are open and which are coming, the fee for each vehicle type,
 * the booking window and slot rules, and the WhatsApp link to start. The site
 * can never advertise a fee or a destination the booking would not honour.
 */
router.get('/public/site', async (req, res) => {
  try {
    const t = await tokens();
    const places = (await query(
      `SELECT p.id, p.code, p.name, p.name_kn, p.district, p.district_kn, p.is_active, p.booking_days_ahead,
              COALESCE(json_agg(json_build_object(
                'code', s.code, 'label', regexp_replace(s.label, '[[:space:]]+', ' ', 'g'),
                'label_kn', s.label_kn, 'starts_at', s.starts_at, 'ends_at', s.ends_at)
                ORDER BY s.sort_order) FILTER (WHERE s.id IS NOT NULL), '[]') AS slots
         FROM places p LEFT JOIN place_slots s ON s.place_id = p.id AND s.is_active
        GROUP BY p.id ORDER BY p.is_active DESC, p.id`)).rows;

    const live = places.find((p) => p.is_active);
    const fees = live ? (await query(
      `SELECT c.code, c.label, c.label_kn, pr.entry_paise, pr.platform_paise
         FROM place_pricing pr JOIN vehicle_categories c ON c.id = pr.category_id
        WHERE pr.place_id = $1 AND pr.is_active AND c.is_active ORDER BY c.sort_order`, [live.id])).rows
      .map((f) => ({ code: f.code, label: f.label, label_kn: f.label_kn,
        entry: Number(f.entry_paise) / 100, platform: Number(f.platform_paise) / 100,
        total: (Number(f.entry_paise) + Number(f.platform_paise)) / 100 })) : [];

    const wa = String(process.env.WHATSAPP_BUSINESS_PHONENUMBER || '').replace(/\D/g, '');
    ok(res, {
      product: { name: t.product_name, name_kn: t.product_name_kn, tagline: t.product_tagline,
        tagline_kn: t.product_tagline_kn },
      whatsapp: wa ? { number: wa, link: `https://wa.me/${wa}?text=${encodeURIComponent('hi')}` } : null,
      places: places.map(({ id, ...p }) => p),
      fees,
      platform_fee_percent: Number(t.platform_fee_percent || 0),
      rules: {
        booking_days_ahead: live ? live.booking_days_ahead : 14,
        release_hour: Number(t.booking_release_hour || 18),
        last_entry_minutes_before_end: 60,
        not_permitted: ['Autorickshaws', 'Buses and minibuses', 'Trucks and goods vehicles', 'Tractors and trailers'],
      },
      business: { legal_name: t.legal_name, address: t.business_address, email: t.contact_email,
        website: t.website, vendor_tagline: t.vendor_tagline },
    });
  } catch (e) { console.error('[site] read:', e.message); fail(res, 500, 'Could not load site data.'); }
});

module.exports = router;
module.exports.loadDoc = loadDoc;
