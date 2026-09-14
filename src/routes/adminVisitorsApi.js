/**
 * adminVisitorsApi.js — look a visitor up, for handling a complaint.
 *
 * Needs tickets.view: somebody who may open any pass may see whose passes they
 * are. Money is stripped on the way out for anybody without finance.view, the
 * same as the vehicle register, so the only way to see a rupee is to be allowed
 * to. Nothing here changes anything.
 */

const express = require('express');
const { auth, needs } = require('./adminApi');
const admin = require('../gatepass/admin');
const visitors = require('../gatepass/adminVisitors');

const router = express.Router();
const P = '/admin/api/visitors';

function stripMoney(value) {
  if (Array.isArray(value)) return value.map(stripMoney);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (visitors.MONEY_KEYS.includes(k)) continue;
      out[k] = stripMoney(v);
    }
    return out;
  }
  return value;
}

const shown = (req, body) => (admin.can(req.admin.role, 'finance.view') ? body : { ...stripMoney(body), moneyHidden: true });

const handle = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) {
    console.error('[visitorsApi] %s %s: %s', req.method, req.path, e.stack || e.message);
    res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
  }
};

router.get(P, auth, needs('tickets.view'), handle(async (req, res) => {
  res.set('Cache-Control', 'no-store').json({ ok: true, ...(await visitors.search({ q: req.query.q, limit: req.query.limit })) });
}));

router.get(`${P}/:id`, auth, needs('tickets.view'), handle(async (req, res) => {
  const out = await visitors.detail(req.params.id);
  if (!out) return res.status(404).json({ error: 'not_found', message: 'No such visitor.' });
  res.set('Cache-Control', 'no-store').json({ ok: true, ...shown(req, out) });
}));

module.exports = router;
