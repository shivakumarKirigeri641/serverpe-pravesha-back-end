#!/usr/bin/env node
/**
 * regenerate-docs.js — a pass or tax invoice as a PDF file, rebuilt from the
 * database (user, 2026-09-19).
 *
 *   node scripts/regenerate-docs.js 42                         pass no. 42, and its invoice
 *   node scripts/regenerate-docs.js PRV/26-27/000007           that invoice, and its pass
 *   node scripts/regenerate-docs.js 42 43 PRV/26-27/000009     several at once
 *   node scripts/regenerate-docs.js --date 2026-09-26          every pass for that day
 *   node scripts/regenerate-docs.js 42 --pass-only | --invoice-only
 *   node scripts/regenerate-docs.js 42 --lang kn               the pass in Kannada
 *   node scripts/regenerate-docs.js 42 --out C:\Users\me\Downloads
 *
 * WHY THERE ARE NO FILES TO FIND. Pravesha stores no PDFs. Every pass and
 * invoice is rendered from its rows when it is sent on WhatsApp, downloaded in
 * the panel or asked for here — by the same code (src/pdf), from the same rows,
 * so what this writes is what the visitor received. The amounts were always
 * stored on the invoice row, and since 062 so is the supplier block, so an
 * invoice renders the same however long afterwards.
 *
 * Reads only: nothing is sent, nothing in the database changes.
 * Files go to ./regenerated/<today>/ unless --out says otherwise.
 */

require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { pool, one, query } = require('../src/gatepass/db');
const booking = require('../src/gatepass/booking');
const passPdf = require('../src/pdf/passPdf');
const invoicePdf = require('../src/pdf/invoicePdf');
const { docSettings, verifyUrl } = require('../src/whatsapp/deliver');
const { langOf } = require('../src/i18n');

const args = process.argv.slice(2);
const has = (n) => args.includes(`--${n}`);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const valued = new Set(['--date', '--out', '--lang'].flatMap((f) => { const i = args.indexOf(f); return i >= 0 ? [i + 1] : []; }));
const wanted = args.filter((a, i) => !a.startsWith('--') && !valued.has(i));

const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const OUT = path.resolve(flag('out') || path.join(__dirname, '..', 'regenerated', today));

/** A pass by its number, or by the number of its invoice. */
async function find(ref) {
  if (String(ref).includes('/')) {
    const inv = await one('SELECT * FROM invoices WHERE invoice_no = $1', [ref.toUpperCase()]);
    return inv ? { t: await booking.byId(inv.ticket_id), inv } : null;
  }
  const t = await booking.byTicketNo(ref);
  if (!t) return null;
  return { t, inv: await one('SELECT * FROM invoices WHERE ticket_id = $1', [t.id]) };
}

async function main() {
  if (!wanted.length && !flag('date')) {
    console.log('usage: node scripts/regenerate-docs.js <pass no. | invoice no.> … [--date YYYY-MM-DD] [--pass-only | --invoice-only] [--lang en|kn] [--out dir]');
    process.exitCode = 1;
    return;
  }

  const found = [];
  for (const ref of wanted) {
    const f = await find(ref);
    if (f && f.t) found.push(f); else console.log(`  not found: ${ref}`);
  }
  if (flag('date')) {
    const ids = (await query(
      `SELECT id FROM tickets WHERE travel_date = $1 AND status IN ('paid', 'used') ORDER BY id`, [flag('date')])).rows;
    for (const { id } of ids) {
      const t = await booking.byId(id);
      found.push({ t, inv: await one('SELECT * FROM invoices WHERE ticket_id = $1', [id]) });
    }
    console.log(`  ${ids.length} paid passes for ${flag('date')}`);
  }
  if (!found.length) return;

  fs.mkdirSync(OUT, { recursive: true });
  const settings = await docSettings();
  let written = 0;

  for (const { t, inv } of found) {
    if (!has('invoice-only')) {
      const lang = flag('lang') || langOf({ language: t.customer_language });
      const pdf = await passPdf.render(t, { settings, verifyUrl: verifyUrl(t), lang });
      fs.writeFileSync(path.join(OUT, passPdf.filename(t)), pdf);
      console.log(`  pass     ${t.ticket_no}  ${t.reg_no || `${t.persons || 1} persons`}  ${String(t.travel_date).slice(0, 10)}  → ${passPdf.filename(t)}`);
      written += 1;
    }
    if (!has('pass-only')) {
      if (!inv) { console.log(`  invoice  none for pass ${t.ticket_no} (free pass, or not paid)`); continue; }
      const pdf = await invoicePdf.render(t, inv, { settings });
      fs.writeFileSync(path.join(OUT, invoicePdf.filename(inv)), pdf);
      console.log(`  invoice  ${inv.invoice_no}  → ${invoicePdf.filename(inv)}`);
      written += 1;
    }
  }
  console.log(`\n  ${written} file${written === 1 ? '' : 's'} in ${OUT}\n`);
}

main()
  .catch((e) => { console.error(`\n  ${e.message}\n`); process.exitCode = 1; })
  .finally(() => pool().end());
