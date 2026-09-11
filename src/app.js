/**
 * app.js — the server.
 *
 * Routes are mounted in one place and the webhook is mounted before any JSON
 * body parser, because it needs the raw bytes to check its signature. A global
 * express.json() above it would consume the stream and leave nothing to verify.
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1); // ngrok and any reverse proxy in front of this

app.use(cors());

/* Mounted first, and with no body parser above it. See the note in the route. */
app.use('/', require('./routes/whatsapp'));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/', require('./routes/policy'));
app.use('/', require('./routes/bookWeb'));

app.get('/health', async (req, res) => {
  const out = { ok: true, service: 'pravesha', time: new Date().toISOString() };
  try {
    const { one } = require('./gatepass/db');
    const r = await one('SELECT current_database() AS db, now() AS t');
    out.db = r.db;
  } catch (e) {
    out.ok = false;
    out.db = `unavailable: ${e.message}`;
  }
  res.status(out.ok ? 200 : 503).json(out);
});

app.use((req, res) => res.status(404).json({ error: 'not_found', path: req.path }));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[app]', err);
  res.status(500).json({ error: 'server_error' });
});

const PORT = process.env.PORT || 5005;
app.listen(PORT, () => {
  console.log(`\nPravesha listening on :${PORT}`);
  console.log(`  public   ${process.env.PUBLIC_BASE_URL || '(PUBLIC_BASE_URL not set)'}`);
  console.log(`  webhook  ${process.env.PUBLIC_BASE_URL || ''}${require('./config/paths').PREFIX}/whatsapp/webhook`);
  console.log(`  terms    ${process.env.PUBLIC_BASE_URL || ''}/policy/terms`);
  console.log(`  replies  ${String(process.env.WHATSAPP_REPLY_ENABLED) !== 'false' ? 'enabled' : 'disabled'}`
    + `${String(process.env.WHATSAPP_DRY_RUN) === 'true' ? ' (DRY RUN)' : ''}\n`);
});

module.exports = app;
