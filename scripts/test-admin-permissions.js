/*
 * Every admin API route, called as every role — the way somebody would who
 * copied a request out of the browser's network tab and replayed it.
 *
 * The panel hides what a role may not use, but hiding a menu item protects
 * nothing: the route itself must refuse. This reads each route and the
 * capability it demands straight from src/routes/admin*.js, signs in a
 * throwaway user of each role, and checks:
 *
 *   * a role WITHOUT the capability is refused (403) on every route, reads and
 *     writes alike — the guard runs before any handler, so a refused write
 *     changes nothing;
 *   * a role WITH it gets through on read routes (writes are not replayed with
 *     permission, because they would change data).
 *
 * The throwaway users sit in the reserved 000 range, which no SMS can reach,
 * and are deleted at the end with their sessions. Run it against a development
 * server:
 *
 *   node scripts/test-admin-permissions.js          (server on PORT, default 5005)
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { query } = require('../src/gatepass/db');
const { can } = require('../src/gatepass/permissions');

const BASE = process.env.TEST_BASE || `http://localhost:${process.env.PORT || 5005}`;
const ROLES = ['super_admin', 'admin', 'dc', 'checkpost_manager', 'finance', 'viewer'];
const MOBILE = (i) => `00000009${String(i).padStart(2, '0')}`;

/* Routes that check a second capability inside the handler, on top of needs().
   An issued report carries revenue and GST, so downloading one also takes
   finance.view — the figures on screen stay available to reports.view. */
const ALSO_NEEDS = { '/admin/api/reports/download': 'finance.view' };

/* ── the routes, as written ─────────────────────────────────────────────── */
function routes() {
  const dir = path.join(__dirname, '..', 'src', 'routes');
  const out = [];
  for (const file of fs.readdirSync(dir).filter((f) => /^admin.*\.js$/.test(f))) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    const prefix = (src.match(/const P = '([^']+)'/) || [])[1];
    /* Three ways a route names its path: `${P}/…`, the bare prefix P, or a
       literal '/admin/api/…'. Missing one means routes silently go untested. */
    const re = /router\.(get|post|put|patch|delete)\(\s*(?:`\$\{P\}([^`]*)`|(P)\b|'([^']+)')([^\n]*)/g;
    let m;
    while ((m = re.exec(src))) {
      const url = m[2] !== undefined ? prefix + m[2] : m[3] ? prefix : m[4];
      const cap = (m[5].match(/needs\('([^']+)'\)/) || [])[1] || null;
      out.push({ file, method: m[1].toUpperCase(), path: url, cap });
    }
  }
  return out;
}

async function call(token, method, url) {
  const res = await fetch(BASE + url.replace(/:[A-Za-z]+/g, '0'), {
    method,
    headers: { Authorization: `Bearer ${token}`, 'X-Admin-Token': token, 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : '{}',
  });
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, body };
}

(async () => {
  const tokens = {};
  const failures = [];
  let checks = 0;
  const fail = (msg) => failures.push(msg);

  try {
    await query(`DELETE FROM admin_users WHERE mobile LIKE '00000009%'`);
    for (const [i, role] of ROLES.entries()) {
      const { rows: [u] } = await query(
        `INSERT INTO admin_users (name, mobile, role, is_active) VALUES ($1, $2, $3, true) RETURNING id`,
        [`Permission test ${role}`, MOBILE(i), role]);
      tokens[role] = crypto.randomBytes(32).toString('base64url');
      await query(`INSERT INTO admin_sessions (admin_id, token) VALUES ($1, $2)`, [u.id, tokens[role]]);
    }

    /* The session must actually work, or every "403" below would be a 401. */
    const who = await call(tokens.viewer, 'GET', '/admin/api/session');
    if (who.status !== 200) throw new Error(`test session not accepted (${who.status}) — check how the panel sends its token`);

    const all = routes();
    const guarded = all.filter((r) => r.cap);
    const unguarded = all.filter((r) => !r.cap);

    for (const r of guarded) {
      for (const role of ROLES) {
        const allowed = can(role, r.cap) && (!ALSO_NEEDS[r.path] || can(role, ALSO_NEEDS[r.path]));
        if (!allowed) {
          checks += 1;
          const { status } = await call(tokens[role], r.method, r.path);
          if (status !== 403) fail(`${role.padEnd(17)} ${r.method.padEnd(6)} ${r.path}  needs ${r.cap} — expected 403, got ${status}`);
        } else if (r.method === 'GET') {
          checks += 1;
          const { status } = await call(tokens[role], r.method, r.path);
          if (status === 401 || status === 403) fail(`${role.padEnd(17)} GET    ${r.path}  has ${r.cap} — was refused (${status})`);
        }
      }
    }

    /* The route found in the audit: guarded inline, and filtered by kind. */
    for (const role of ['viewer', 'finance']) {
      checks += 1;
      const { status } = await call(tokens[role], 'GET', '/admin/api/tickets/grants');
      if (status !== 403) fail(`${role} GET /admin/api/tickets/grants — expected 403, got ${status}`);
    }
    checks += 1;
    const cm = await call(tokens.checkpost_manager, 'GET', '/admin/api/tickets/grants?kind=free');
    const kinds = new Set((cm.body?.grants || []).map((g) => g.kind));
    if (cm.status !== 200 || kinds.has('free')) fail(`checkpost_manager GET /tickets/grants?kind=free — got ${cm.status}, kinds ${[...kinds]}`);

    console.log(`\nadmin routes found: ${all.length}  (guarded by a capability: ${guarded.length})`);
    console.log('routes with no capability guard (reviewed by hand):');
    unguarded.forEach((r) => console.log(`  ${r.method.padEnd(6)} ${r.path}   [${r.file}]`));
    console.log(`\n${checks} checks, ${failures.length} failed`);
    failures.forEach((f) => console.log(`  FAIL  ${f}`));
  } catch (e) {
    failures.push(e.message);
    console.error(`\nERROR  ${e.message}`);
  } finally {
    const { rowCount } = await query(`DELETE FROM admin_users WHERE mobile LIKE '00000009%'`);
    console.log(`removed ${rowCount} throwaway users (and their sessions)\n`);
  }
  process.exit(failures.length ? 1 : 0);
})();
