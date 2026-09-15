/*
 * What happens to an entry recorded at a gate with no signal, once the signal
 * comes back.
 *
 * The gate app keeps such an entry in a queue on the phone with an id it made
 * itself, and posts it to /staff/entry/offline when it can. This exercises the
 * server end of that: the entry lands at the time the phone recorded it, a
 * retry after a lost reply records nothing twice, and anything the phone could
 * not have known comes back as a refusal rather than silence.
 *
 * It writes to the database it is pointed at, and puts back what it touched —
 * so run it against the development database, never against production.
 *
 *   node scripts/test-offline-sync.js
 */
require('dotenv').config();
const { query } = require('../src/gatepass/db');
const checkin = require('../src/gatepass/checkin');

const ist = (d) => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'medium' });
const newId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

let passed = 0;
let failed = 0;
const check = (name, ok, detail) => {
  if (ok) { passed += 1; console.log(`  PASS  ${name}`); } else { failed += 1; console.log(`  FAIL  ${name}${detail ? `\n          ${detail}` : ''}`); }
};

/* Everything this run created or changed, so it can be put back. */
const touched = { clientIds: [], ticketIds: [] };

async function fixtures() {
  const { rows: [cp] } = await query(
    'SELECT id, name, place_id FROM checkposts WHERE is_active ORDER BY id LIMIT 1');
  const { rows: [se] } = await query(
    'SELECT id AS session_id, staff_id FROM staff_sessions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1');
  if (!cp) throw new Error('no active checkpost — seed one first');
  if (!se) throw new Error('no open staff session — sign in on the gate app first');
  return { checkpost: cp, session: se };
}

/** An unused, paid pass for today that no other test in this run has claimed. */
async function freshTicket() {
  const { rows } = await query(
    `SELECT id, ticket_no, reg_no FROM tickets
      WHERE travel_date = (now() AT TIME ZONE 'Asia/Kolkata')::date
        AND status = 'paid' AND used_at IS NULL
        AND NOT (id = ANY($1::bigint[]))
      ORDER BY id DESC LIMIT 1`, [touched.ticketIds.length ? touched.ticketIds : [0]]);
  if (rows[0]) { touched.ticketIds.push(rows[0].id); return rows[0]; }

  /* A development database rarely holds more spare passes than this file wants.
     Put an earlier one back to unused and use it again — cleanup does the same
     thing at the end, and each case keys off its own client id, not the pass. */
  const { rows: recycled } = await query(
    `UPDATE tickets SET status = 'paid', used_at = NULL, entry_source = NULL
      WHERE id = $1 RETURNING id, ticket_no, reg_no`, [touched.ticketIds[0]]);
  if (!recycled[0]) throw new Error('no paid pass for today — book one, or run the Omniware sync/seed');
  console.log(`        (reusing ${recycled[0].ticket_no} — no spare passes today)`);
  return recycled[0];
}

const scansFor = async (clientId) => (await query(
  'SELECT verdict, scanned_at, was_offline, ticket_no FROM scans WHERE raw_payload LIKE $1',
  [`%"clientId":"${clientId}"%`])).rows;

async function run() {
  const { checkpost, session } = await fixtures();
  console.log(`\ngate: ${checkpost.name}  ·  staff_id ${session.staff_id}  ·  session ${session.session_id}`);

  /* 1 — the ordinary case: recorded at the barrier ten minutes ago, sent now. */
  console.log('\n1. An entry recorded ten minutes ago, arriving now');
  const t1 = await freshTicket();
  const id1 = newId(); touched.clientIds.push(id1);
  const at1 = new Date(Date.now() - 10 * 60 * 1000);
  const r1 = await checkin.recordOffline({ session, checkpost, ticketNo: t1.ticket_no, clientId: id1, at: at1.toISOString() });
  check('accepted', r1.ok === true, JSON.stringify(r1));
  /* Inside its slot it is `valid`; outside it, the staff member decided at the
     barrier with no way to ask anybody, and that is recorded as an override. */
  check('verdict is valid, or an override if the slot had closed',
    r1.verdict === 'valid' || r1.verdict === 'valid_override', `got ${r1.verdict}`);
  console.log(`        recorded as ${r1.verdict}`);
  const { rows: [after1] } = await query('SELECT status, used_at, entry_source FROM tickets WHERE id = $1', [t1.id]);
  check('pass is now used', after1.status === 'used', `status ${after1.status}`);
  const drift = Math.abs(new Date(after1.used_at).getTime() - at1.getTime());
  check('used_at is the phone\'s time, not the sync time', drift < 2000,
    `used_at ${ist(after1.used_at)} vs recorded ${ist(at1)} — ${Math.round(drift / 1000)}s apart`);
  const s1 = await scansFor(id1);
  check('one scan row, marked offline', s1.length === 1 && s1[0].was_offline === true, `${s1.length} rows`);

  /* 2 — the reply was lost and the phone sent it again. */
  console.log('\n2. The same entry sent twice (a reply lost to a dropping signal)');
  const r2 = await checkin.recordOffline({ session, checkpost, ticketNo: t1.ticket_no, clientId: id1, at: at1.toISOString() });
  check('reported as already recorded', r2.duplicate === true, JSON.stringify(r2));
  check('still accepted, so the app does not show a false problem', r2.ok === true, `ok ${r2.ok}`);
  const s2 = await scansFor(id1);
  check('still only one scan row', s2.length === 1, `${s2.length} rows`);

  /* 3 — used at the other gate while this phone had no signal. */
  console.log('\n3. The pass was used at another gate meanwhile');
  const t3 = await freshTicket();
  await query(`UPDATE tickets SET status = 'used', used_at = now(), entry_source = 'gate' WHERE id = $1`, [t3.id]);
  const id3 = newId(); touched.clientIds.push(id3);
  const r3 = await checkin.recordOffline({ session, checkpost, ticketNo: t3.ticket_no, clientId: id3, at: new Date(Date.now() - 5 * 60 * 1000).toISOString() });
  check('refused', r3.ok === false, JSON.stringify(r3));
  check('verdict says already used', r3.verdict === 'already_used', `got ${r3.verdict}`);
  check('the refusal is on the record too', (await scansFor(id3)).length === 1);

  /* 4 — a pass number the server has never heard of. */
  console.log('\n4. A pass number the server does not know');
  const id4 = newId(); touched.clientIds.push(id4);
  const r4 = await checkin.recordOffline({ session, checkpost, ticketNo: 'PRVZZZZZZZZ', clientId: id4, at: new Date().toISOString() });
  check('refused', r4.ok === false && r4.verdict === 'unknown_ticket', JSON.stringify(r4));
  check('logged, so the office can see it', (await scansFor(id4)).length === 1);

  /* 5 — a queued entry with no id cannot be trusted to be recorded once. */
  console.log('\n5. A queued entry with no usable id');
  const r5 = await checkin.recordOffline({ session, checkpost, ticketNo: 'PRVZZZZZZZZ', clientId: 'x', at: new Date().toISOString() });
  check('refused before touching anything', r5.error === 'bad_client_id', JSON.stringify(r5));

  /* 6 — a phone whose clock is wrong must not place an entry wherever it likes. */
  console.log('\n6. A phone with a wrong clock (a year ahead)');
  const t6 = await freshTicket();
  const id6 = newId(); touched.clientIds.push(id6);
  const daft = new Date(Date.now() + 365 * 24 * 3600 * 1000);
  const r6 = await checkin.recordOffline({ session, checkpost, ticketNo: t6.ticket_no, clientId: id6, at: daft.toISOString() });
  check('still recorded', r6.ok === true, JSON.stringify(r6));
  const { rows: [after6] } = await query('SELECT used_at FROM tickets WHERE id = $1', [t6.id]);
  const skew = Math.abs(new Date(after6.used_at).getTime() - Date.now());
  check('clamped to now instead of a year out', skew < 5 * 60 * 1000, `used_at ${ist(after6.used_at)}`);
}

async function cleanup() {
  for (const id of touched.clientIds) {
    await query('DELETE FROM scans WHERE raw_payload LIKE $1', [`%"clientId":"${id}"%`]);
  }
  if (touched.ticketIds.length) {
    await query(`UPDATE tickets SET status = 'paid', used_at = NULL, entry_source = NULL
                  WHERE id = ANY($1::bigint[])`, [touched.ticketIds]);
  }
  console.log(`\nput back: ${touched.ticketIds.length} passes, ${touched.clientIds.length} scan records`);
}

(async () => {
  try {
    await run();
  } catch (e) {
    failed += 1;
    console.error(`\n  ERROR  ${e.message}`);
  } finally {
    await cleanup().catch((e) => console.error(`cleanup failed: ${e.message}`));
  }
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
