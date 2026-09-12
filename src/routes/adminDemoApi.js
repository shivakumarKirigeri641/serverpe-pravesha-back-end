/**
 * adminDemoApi.js — TEMPORARY. The Demo & test data screen.
 *
 * Two things live here: the switch for demonstration mode, and the buttons that
 * fill or empty the demonstration database. Both are their own permissions —
 * demo.simulate and demo.reset — so they can be given to whoever is running a
 * demonstration without giving them anything else, and taken away entirely.
 *
 * TO REMOVE BEFORE LAUNCH: delete this file, src/demo/, src/simulation/, the
 * two demo capabilities in permissions.js, the scripts/temp-*.js files and the
 * panel's Demo page. Nothing else imports them.
 *
 * Every action refuses on a production server, only ever touches rows flagged
 * is_test, needs a reason, and is written to the audit trail.
 */

const express = require('express');
const { auth, needs } = require('./adminApi');
const admin = require('../gatepass/admin');
const simulation = require('../simulation');
const jobs = require('../demo/jobs');
const { query } = require('../gatepass/db');

const router = express.Router();
const P = '/admin/api/demo';
const ipOf = (req) => (req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim();
const n = (v) => Number(v || 0);

/* The same gate as demonstration mode: never on a production server. */
const onlyWhereAllowed = (req, res, next) => {
  if (simulation.allowed()) return next();
  res.status(409).json({
    error: 'not_allowed_here',
    message: 'This is a production server, so the demonstration tools are switched off. Set ALLOW_SIMULATION=true only if you really mean it.',
  });
};

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.code || 'invalid', message: e.message });
    console.error('[demoApi] %s %s: %s', req.method, req.path, e.stack || e.message);
    res.status(500).json({ error: 'server_error', message: 'Something went wrong. Nothing was changed.' });
  }
};

/** What is in the database, test against real. */
async function counts() {
  const [row] = (await query(
    `SELECT (SELECT count(*) FROM tickets)                      AS tickets,
            (SELECT count(*) FROM tickets WHERE is_test)        AS test_tickets,
            (SELECT count(*) FROM payments)                     AS payments,
            (SELECT count(*) FROM payments WHERE is_test)       AS test_payments,
            (SELECT count(*) FROM invoices)                     AS invoices,
            (SELECT count(*) FROM invoices WHERE is_test)       AS test_invoices,
            (SELECT count(*) FROM scans)                        AS scans,
            (SELECT count(*) FROM scans WHERE is_test)          AS test_scans,
            (SELECT count(*) FROM customers)                    AS visitors,
            (SELECT count(*) FROM customers WHERE is_test)      AS test_visitors,
            (SELECT count(*) FROM vehicles)                     AS vehicles,
            (SELECT count(*) FROM vehicles WHERE is_test)       AS test_vehicles,
            (SELECT count(*) FROM wa_messages)                  AS messages,
            (SELECT count(*) FROM wa_messages WHERE mobile LIKE '000%') AS test_messages,
            (SELECT min(travel_date) FROM tickets WHERE is_test) AS from_date,
            (SELECT max(travel_date) FROM tickets WHERE is_test) AS to_date`)).rows;
  const pair = (total, test) => ({ total: n(total), test: n(test), real: n(total) - n(test) });
  const day = (d) => (d ? String(d instanceof Date ? d.toISOString() : d).slice(0, 10) : null);
  return {
    tickets: pair(row.tickets, row.test_tickets),
    payments: pair(row.payments, row.test_payments),
    invoices: pair(row.invoices, row.test_invoices),
    scans: pair(row.scans, row.test_scans),
    visitors: pair(row.visitors, row.test_visitors),
    vehicles: pair(row.vehicles, row.test_vehicles),
    messages: pair(row.messages, row.test_messages),
    range: { from: day(row.from_date), to: day(row.to_date) },
  };
}

router.get(P, auth, needs('demo.simulate'), handle(async (req, res) => {
  res.set('Cache-Control', 'no-store').json({
    ok: true,
    available: simulation.allowed(),
    simulation: await simulation.status(),
    data: await counts(),
    jobs: jobs.status(),
    canReset: admin.can(req.admin.role, 'demo.reset'),
  });
}));

/* ── Demonstration mode ────────────────────────────────────────────────── */
router.put(`${P}/simulation`, express.json(), auth, needs('demo.simulate'), onlyWhereAllowed, handle(async (req, res) => {
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 5) {
    return res.status(400).json({ error: 'reason_required', message: 'Say why demonstration mode is being switched — it is recorded in the audit log.' });
  }
  const out = await simulation.set({ enabled: req.body?.enabled === true, rate: req.body?.rate, hours: req.body?.hours });
  await admin.audit({
    adminId: req.admin.admin_id,
    action: req.body?.enabled === true ? 'simulation_started' : 'simulation_stopped',
    subject: 'demo:simulation', before: out.before, after: out.after, reason,
    ip: ipOf(req), sessionId: req.admin.session_id,
  });
  res.json({ ok: true, simulation: await simulation.status() });
}));

/* ── Filling and emptying the database ─────────────────────────────────── */
router.post(`${P}/run`, express.json(), auth, needs('demo.simulate'), onlyWhereAllowed, handle(async (req, res) => {
  const action = String(req.body?.action || '');
  const definition = jobs.ACTIONS[action];
  if (!definition) return res.status(400).json({ error: 'invalid', message: 'No such action.' });

  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 5) {
    return res.status(400).json({ error: 'reason_required', message: 'Say why — it is recorded in the audit log.' });
  }

  /* Anything destructive needs the stronger permission and the words typed out:
     a mis-click must not be able to empty the database. */
  if (definition.destructive) {
    if (!admin.can(req.admin.role, 'demo.reset')) {
      return res.status(403).json({ error: 'not_allowed', message: 'Removing test data needs the reset permission.' });
    }
    if (String(req.body?.confirm || '').trim().toUpperCase() !== 'REMOVE TEST DATA') {
      return res.status(400).json({ error: 'confirm_required', message: 'Type REMOVE TEST DATA to confirm.' });
    }
  }

  const before = definition.destructive ? await counts() : null;
  const job = jobs.run({ action, options: req.body?.options || {}, by: req.admin.name });
  await admin.audit({
    adminId: req.admin.admin_id,
    action: definition.destructive ? 'demo_data_removed' : 'demo_data_seeded',
    subject: `demo:${action}`,
    before: before ? { testTickets: before.tickets.test, testPayments: before.payments.test } : null,
    after: { action, command: job.command },
    reason, ip: ipOf(req), sessionId: req.admin.session_id,
  });
  res.json({ ok: true, job, jobs: jobs.status() });
}));

router.get(`${P}/jobs`, auth, needs('demo.simulate'), handle(async (req, res) => {
  res.set('Cache-Control', 'no-store').json({ ok: true, jobs: jobs.status(), data: await counts() });
}));

module.exports = router;
