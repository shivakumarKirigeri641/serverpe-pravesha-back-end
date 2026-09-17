/**
 * policy.js — the policy pages the WhatsApp welcome links to.
 *
 *   GET /policy/terms     GET /policy/privacy     GET /policy/:slug
 *
 * SAME TEXT AS EVERYWHERE ELSE. These used to be hand-written HTML, which meant
 * the terms a visitor accepted in WhatsApp and the terms published on
 * pravesha.in were two documents that could drift apart — an unpleasant thing to
 * discover during a dispute. They now render legal_documents / legal_sections,
 * the same rows /legal serves to the website, with the same {{placeholders}}
 * filled from app_settings. One text, three renderings: this page, the website,
 * and the consent record.
 *
 * Served by this app rather than pointed at the website, because the link goes
 * out in the first message every visitor receives, and a link that 404s in front
 * of a government department is worse than no link at all. It also keeps working
 * before pravesha.in is live.
 *
 * Plain server-rendered HTML, read once, on a phone, on a hill with two bars of
 * signal: no scripts, no fonts to fetch, no layout that needs measuring.
 */

const express = require('express');
const { query } = require('../gatepass/db');
const settings = require('../gatepass/settings');

const router = express.Router();

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fill = (text, t) => String(text || '').replace(/\{\{(\w+)\}\}/g, (whole, key) =>
  (t[key] === null || t[key] === undefined || t[key] === '' ? whole : String(t[key])));

const longDate = (d) => {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(`${d}T00:00:00+05:30`);
  return Number.isNaN(date.getTime()) ? String(d)
    : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
};

const page = ({ title, titleKn, summary, version, effective, sections, business }) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Pravesha</title>
<style>
  :root { color-scheme: light dark; --ink:#12211f; --muted:#5d7169; --line:#e2ebe8; --bg:#fff; --accent:#075e54; }
  @media (prefers-color-scheme: dark) { :root { --ink:#e9efed; --muted:#9fb0aa; --line:#26332f; --bg:#111817; --accent:#25d366; } }
  * { box-sizing:border-box }
  body { margin:0; background:var(--bg); color:var(--ink);
         font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width:680px; margin:0 auto; padding:24px 20px 64px }
  header { border-bottom:3px solid var(--accent); padding-bottom:14px; margin-bottom:26px }
  .brand { font-weight:700; font-size:20px; letter-spacing:-.2px }
  .dept { color:var(--muted); font-size:13px; margin-top:2px }
  h1 { font-size:24px; margin:0 0 4px; letter-spacing:-.3px }
  .kn { color:var(--muted); font-size:15px; margin:0 0 10px }
  .summary { color:var(--ink); margin:0 0 14px }
  .updated { color:var(--muted); font-size:13px; margin-bottom:28px }
  h2 { font-size:17px; margin:30px 0 8px }
  h2 .no { color:var(--accent); margin-right:6px }
  p { color:var(--ink); white-space:pre-wrap }
  footer { margin-top:44px; padding-top:16px; border-top:1px solid var(--line);
           color:var(--muted); font-size:13px }
  a { color:var(--accent) }
</style></head><body><div class="wrap">
<header><div class="brand">Pravesha · ಪ್ರವೇಶ</div>
<div class="dept">Entry passes for vehicles and visitors to Karnataka&rsquo;s destinations</div></header>
<h1>${esc(title)}</h1>
${titleKn ? `<p class="kn">${esc(titleKn)}</p>` : ''}
${summary ? `<p class="summary">${esc(summary)}</p>` : ''}
<p class="updated">Version ${esc(version)} · Effective from ${esc(longDate(effective))}</p>
${sections.map((s) => `<h2><span class="no">${esc(s.section_no)}.</span>${esc(s.title)}</h2>\n<p>${esc(s.description)}</p>`).join('\n')}
<footer>${esc(business.legal_name)}${business.address ? `, ${esc(business.address)}` : ''}<br>
Questions? Write to <a href="mailto:${esc(business.email)}">${esc(business.email)}</a>, or reply <strong>help</strong> on WhatsApp.<br>
Pravesha™ is a trademark of ${esc(business.legal_name)}™. Approval from the Department of Tourism, Government of Karnataka, is awaited.</footer>
</div></body></html>`;

async function render(res, slug) {
  const doc = (await query(
    `SELECT id, slug, title, title_kn, summary, version, effective_from
       FROM legal_documents WHERE (slug = $1 OR doc_code = $1) AND is_active`, [slug])).rows[0];

  if (!doc) return res.status(404).type('html').send('<p>No such policy.</p>');

  const { rows: sections } = await query(
    `SELECT section_no, title, description FROM legal_sections
      WHERE document_id = $1 AND is_active ORDER BY display_order, id`, [doc.id]);

  const t = Object.fromEntries(await settings.all());

  res.set('Cache-Control', 'public, max-age=300').type('html').send(page({
    title: fill(doc.title, t),
    titleKn: doc.title_kn,
    summary: fill(doc.summary, t),
    version: doc.version,
    effective: doc.effective_from,
    sections: sections.map((s) => ({ ...s, title: fill(s.title, t), description: fill(s.description, t).trim() })),
    business: { legal_name: t.legal_name || 'ServerPe App Solutions', address: t.business_address, email: t.contact_email },
  }));
}

/* :slug covers every policy, so the data-deletion and refund pages are reachable
   from WhatsApp too; terms and privacy keep their own routes because those two
   URLs are already in messages people have received. */
router.get('/policy/:slug', async (req, res) => {
  try {
    await render(res, String(req.params.slug).toLowerCase());
  } catch (e) {
    console.error('[policy] %s: %s', req.params.slug, e.message);
    res.status(500).type('html').send('<p>This page could not be loaded. Please try again shortly.</p>');
  }
});

module.exports = router;
