/**
 * enrolment.js — adding a person: name, mobile, a code to that mobile, and then
 * the account (user, 2026-09-16).
 *
 * ONE FORM FOR EVERYONE. Checkpost staff and panel users used to be added on two
 * screens, neither of which checked that the number belonged to the person. Now
 * both go through the same three steps, and the kind of account is the last
 * choice rather than the first screen.
 *
 * THE CODE PROVES THE NUMBER. A mistyped digit used to create an account for a
 * stranger's phone, who would then be the one receiving sign-in codes. The
 * person being added reads the code off their own phone, so the number is known
 * to be theirs before anything is switched on.
 *
 * NOTHING IS SENT, FOR NOW (user, 2026-09-15). As with sign-in, the code is the
 * fixed 1234 on a development server, and the step is refused on production
 * until codes are generated and sent — a fixed code there would prove nothing.
 *
 * WHO MAY ADD WHOM.
 *   checkpost staff     anyone who manages staff; a checkpost manager only to
 *                       their own gate (adminSettings applies that limit)
 *   a panel user        only whoever manages panel users — the super
 *                       administrator
 * The server decides from the signed-in account; the form only offers what it
 * will accept.
 */

const { query, one } = require('./db');
const admin = require('./admin');
const permissions = require('./permissions');
const settingsAdmin = require('./adminSettings');

const MINUTES = 10;          // to hand the phone over and read the code out
const VERIFIED_MINUTES = 15; // from typing the code to pressing Enable
const MAX_ATTEMPTS = 5;
const RESEND_SECONDS = 30;
const FIXED_CODE = '1234';

const onProduction = () => String(process.env.NODE_ENV || '').toLowerCase() === 'production';

/* The settings screens' own refusal, so their routes explain these the same way. */
const { Refusal } = settingsAdmin;
const refuse = (message, opts) => { throw new Refusal(message, opts); };

/* The kinds of account this person may create, for the form. */
const STAFF = 'staff';
function typesFor(actor) {
  const role = actor && actor.role;
  const out = [];
  if (permissions.can(role, 'settings.staff')) {
    out.push({ key: STAFF, label: 'Checkpost staff', description: 'Checks passes and sells them at a gate, from the gate app.' });
  }
  if (permissions.can(role, 'settings.users')) {
    for (const [key, r] of Object.entries(permissions.ROLES)) {
      if (key === 'department') continue;
      out.push({ key, label: r.label === 'Checkpost Manager' ? 'Checkpost admin' : r.label, description: r.description });
    }
  }
  return out;
}

/** What the form needs: the kinds on offer, and the gates they can be posted to. */
async function options(actor) {
  const gate = settingsAdmin.gateOf(actor);
  const checkposts = (await query(
    `SELECT c.id, c.name, p.name AS place FROM checkposts c JOIN places p ON p.id = c.place_id
      WHERE c.is_active AND ($1::bigint IS NULL OR c.id = $1) ORDER BY p.id, c.id`, [gate])).rows;
  return {
    types: typesFor(actor),
    checkposts: checkposts.map((c) => ({ id: String(c.id), name: c.name, place: c.place })),
    /* A checkpost admin posts people to their own gate and is not asked which. */
    fixedCheckpost: gate,
    codeMinutes: MINUTES,
  };
}

/* Already somebody? Said before a code is issued, so nobody reads a code out
   for an account that cannot be made. Both kinds are checked, because the
   answer differs by what is being added. */
async function existing(mobile) {
  const [staff, user] = await Promise.all([
    one(`SELECT id, name FROM staff WHERE mobile = $1`, [mobile]),
    one(`SELECT id, name, role FROM admin_users WHERE mobile = $1`, [mobile]),
  ]);
  return { staff, user };
}

/** "Get code" for the person being added. */
async function requestCode({ mobile, actor, ip = null }) {
  const m = admin.localMobile(mobile);
  if (m.length !== 10) refuse('Enter the 10-digit mobile number.', { code: 'bad_mobile' });
  if (onProduction()) {
    refuse('Codes are not set up on this server yet, so a number cannot be verified.', { status: 503, code: 'not_configured' });
  }

  const [recent] = (await query(
    `SELECT max(sent_at) AS last_sent FROM admin_otps WHERE mobile = $1 AND purpose = 'enrol'`, [m])).rows;
  if (recent.last_sent && Date.now() - new Date(recent.last_sent).getTime() < RESEND_SECONDS * 1000) {
    const wait = Math.ceil((RESEND_SECONDS * 1000 - (Date.now() - new Date(recent.last_sent).getTime())) / 1000);
    refuse(`A code was just issued. Wait ${wait} seconds before asking again.`, { status: 429, code: 'too_soon' });
  }

  await query(
    `UPDATE admin_otps SET expires_at = now()
      WHERE mobile = $1 AND purpose = 'enrol' AND consumed_at IS NULL AND expires_at > now()`, [m]);
  await query(
    `INSERT INTO admin_otps (mobile, code_hash, expires_at, ip, is_fixed, purpose, requested_by)
     VALUES ($1, $2, now() + ($3 || ' minutes')::interval, $4, true, 'enrol', $5)`,
    [m, await admin.hashPassword(FIXED_CODE), String(MINUTES), ip, actor.admin_id]);

  const { staff, user } = await existing(m);
  return {
    ok: true,
    minutes: MINUTES,
    message: 'Ask them for the 4-digit code sent to their phone.',
    /* Shown beside the form, so the person adding knows before the code is typed. */
    alreadyStaff: staff ? staff.name : null,
    alreadyUser: user ? user.name : null,
  };
}

/** The code, read back by the person being added. */
async function verifyCode({ mobile, code }) {
  const m = admin.localMobile(mobile);
  const typed = String(code || '').replace(/\D/g, '');
  if (m.length !== 10 || typed.length !== 4) refuse('That code is not right.', { code: 'wrong' });

  const otp = await one(
    `SELECT * FROM admin_otps WHERE mobile = $1 AND purpose = 'enrol' AND consumed_at IS NULL
      ORDER BY sent_at DESC LIMIT 1`, [m]);
  if (!otp) refuse('Ask for a code first.', { code: 'no_code' });
  if (new Date(otp.expires_at) <= new Date()) refuse('That code has expired. Ask for a new one.', { code: 'expired' });
  if (otp.attempts >= MAX_ATTEMPTS) refuse('Too many wrong codes. Ask for a new one.', { code: 'dead' });

  if (!(await admin.passwordMatches(typed, otp.code_hash))) {
    const r = await one(`UPDATE admin_otps SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts`, [otp.id]);
    const left = Math.max(0, MAX_ATTEMPTS - Number(r.attempts));
    refuse(left === 0 ? 'Too many wrong codes. Ask for a new one.' : `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.`,
      { code: left === 0 ? 'dead' : 'wrong' });
  }
  await query(`UPDATE admin_otps SET consumed_at = now() WHERE id = $1`, [otp.id]);
  return { ok: true, verified: true, minutes: VERIFIED_MINUTES };
}

/*
 * The proof that this number was verified a moment ago, spent in the same
 * statement that checks it — so one verified number makes one account, however
 * many times Enable is pressed.
 */
async function spendProof(mobile) {
  const r = await query(
    `UPDATE admin_otps SET enrolled_at = now()
      WHERE id = (SELECT id FROM admin_otps
                   WHERE mobile = $1 AND purpose = 'enrol' AND consumed_at IS NOT NULL
                     AND enrolled_at IS NULL AND consumed_at > now() - ($2 || ' minutes')::interval
                   ORDER BY consumed_at DESC LIMIT 1)
        AND enrolled_at IS NULL
      RETURNING id`, [mobile, String(VERIFIED_MINUTES)]);
  return r.rowCount > 0;
}

/** "Enable": the account, of the kind chosen, for the number just verified. */
async function enrol({ body, actor }) {
  const m = admin.localMobile(body.mobile);
  if (m.length !== 10) refuse('Enter the 10-digit mobile number.', { code: 'bad_mobile' });
  const name = String(body.name || '').trim();
  if (name.length < 2) refuse('Give the person’s name.');
  const type = String(body.type || '');
  const allowed = typesFor(actor).map((t) => t.key);
  if (!allowed.includes(type)) refuse('You cannot add that kind of account.', { status: 403, code: 'not_allowed' });

  /* Checked before the proof is spent, so a refusal here leaves the verified
     number usable for a corrected attempt. */
  const { staff, user } = await existing(m);
  if (type === STAFF && staff) refuse(`${staff.name} is already checkpost staff with this number.`, { status: 409, code: 'exists' });
  if (type !== STAFF && user) refuse(`${user.name} already has a panel account with this number.`, { status: 409, code: 'exists' });
  const posts = body.checkpostIds || (body.checkpostId ? [body.checkpostId] : []);
  if (type === STAFF && settingsAdmin.gateOf(actor) === '0') refuse('Your account has no checkpost. Ask the super administrator to assign one.', { status: 403, code: 'no_checkpost' });
  if (type === STAFF && !actor.checkpost_id && !posts.length) refuse('Choose the checkpost they will report to.', { code: 'checkpost_required' });
  if (type === 'checkpost_manager' && !String(body.checkpostId || '').trim()) {
    refuse('Choose the checkpost this admin will run.', { code: 'checkpost_required' });
  }

  if (!(await spendProof(m))) {
    refuse('Verify the mobile number with a code first.', { status: 409, code: 'not_verified' });
  }

  const reason = String(body.reason || '').trim() || `Added and verified by code as ${type === STAFF ? 'checkpost staff' : type}`;
  if (type === STAFF) {
    const out = await settingsAdmin.addStaff({
      body: { name, mobile: m, checkpostIds: posts },
      reason, actor,
    });
    return { kind: 'staff', action: 'staff_added', ...out };
  }
  const out = await settingsAdmin.addUser({ body: { name, mobile: m, role: type, checkpostId: body.checkpostId }, reason });
  return { kind: 'user', action: 'user_added', ...out };
}

module.exports = { Refusal, options, requestCode, verifyCode, enrol, MINUTES, FIXED_CODE };
