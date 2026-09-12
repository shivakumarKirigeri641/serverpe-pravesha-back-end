/**
 * sms/fast2sms.js — the one place an SMS leaves this service.
 *
 * DLT, because India requires it: the header (SRVRPE) and the message template
 * are both registered with the operators, and a send quotes the registered
 * template's id rather than its text. Anything not registered is dropped by the
 * operator, silently, which is why the reply from the gateway is recorded
 * against the code it was sent for — a code that never arrived and a code that
 * was ignored look identical to everybody except this row.
 *
 * IT REFUSES BEFORE IT SENDS to anything that is not a plain ten-digit Indian
 * mobile, and to the reserved test range, in the same spirit as the WhatsApp
 * sender: a test that quietly texts a real stranger is worse than a test that
 * fails.
 *
 * THE CODE IS NEVER LOGGED. Not at debug level, not in an error, not in the
 * delivery record. The log says a code went to ••••2415 and nothing more; the
 * only copy that exists anywhere is a hash in the database and the SMS itself.
 */

const ENDPOINT = 'https://www.fast2sms.com/dev/bulkV2';

/* The reserved range the rest of the service uses for test recipients. */
const isTestNumber = (m) => /^000\d{7}$/.test(String(m));

const config = () => ({
  key: process.env.FAST2SMS_API_KEY || process.env.FAST2SMSAPIKEY || '',
  route: process.env.FAST2SMS_ROUTE || 'dlt',
  senderId: process.env.FAST2SMS_SENDER_ID || '',
  messageId: process.env.FAST2SMS_DLT_MESSAGE_ID || '',
  entityId: process.env.FAST2SMS_ENTITY_ID || '',
  timeoutMs: Number(process.env.FAST2SMS_TIMEOUT_MS || 12000),
});

/** Is this service able to send an SMS at all? */
function ready() {
  const c = config();
  const missing = [];
  if (!c.key) missing.push('FAST2SMSAPIKEY');
  if (!c.senderId) missing.push('FAST2SMS_SENDER_ID');
  if (!c.messageId) missing.push('FAST2SMS_DLT_MESSAGE_ID');
  return { ok: missing.length === 0, missing };
}

/**
 * Send one registered template to one number.
 *
 * `variables` fill the template's {#var#} placeholders in order, pipe-separated,
 * exactly as registered — an OTP template with one placeholder takes one value.
 * Getting the count wrong is not a formatting problem: the operator rejects the
 * message and the visitor simply never receives it.
 */
async function send(mobile, variables, { purpose = 'otp' } = {}) {
  const c = config();
  const state = ready();
  if (!state.ok) {
    return { ok: false, error: 'not_configured',
      message: `SMS is not configured: ${state.missing.join(', ')} missing.` };
  }

  const to = String(mobile || '').replace(/\D/g, '').slice(-10);
  if (!/^[6-9]\d{9}$/.test(to)) {
    return { ok: false, error: 'bad_number', message: 'That is not an Indian mobile number.' };
  }
  if (isTestNumber(to)) {
    /* Belt and braces — the reserved range cannot reach a handset anyway, but a
       send attempt to it means a test has wandered somewhere it should not. */
    return { ok: false, error: 'test_number', message: 'Refusing to text a reserved test number.' };
  }

  const values = (Array.isArray(variables) ? variables : [variables]).map((v) => String(v)).join('|');
  /*
   * THE KEY GOES IN THE HEADER, NOT THE BODY.
   *
   * Fast2SMS documents `authorization` as a form field for the GET form of this
   * endpoint and as a header for the POST form. Sent in the body of a POST it
   * answers 401 "Invalid Authentication, Check Authorization Key" — which reads
   * exactly like a wrong key and cost an afternoon to tell apart from one.
   */
  const body = new URLSearchParams({
    route: c.route,
    sender_id: c.senderId,
    message: c.messageId,
    variables_values: values,
    numbers: to,
    flash: '0',
    ...(c.entityId ? { entity_id: c.entityId } : {}),
  });

  const stop = AbortSignal.timeout ? AbortSignal.timeout(c.timeoutMs) : undefined;
  let res;
  let answer;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: c.key,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      signal: stop,
    });
    answer = await res.json().catch(async () => ({ raw: (await res.text().catch(() => '')).slice(0, 300) }));
  } catch (e) {
    /* The gateway being unreachable is not the staff member's fault and must not
       look like a wrong number. */
    return { ok: false, error: 'unreachable', message: 'Could not reach the SMS service. Try again in a moment.',
      detail: e.message };
  }

  const sent = res.ok && answer && (answer.return === true || answer.return === 'true');
  /* Recorded against the code, never the code itself. */
  const record = {
    at: new Date().toISOString(),
    purpose,
    status: res.status,
    return: answer ? answer.return : null,
    requestId: answer ? (answer.request_id || null) : null,
    message: answer ? (Array.isArray(answer.message) ? answer.message.join('; ') : answer.message || null) : null,
  };

  require('../log').event('sms', sent ? 'out' : 'fail',
    `••••${to.slice(-4)}  ${purpose}${record.message ? ` · ${record.message}` : ''}`);

  return sent
    ? { ok: true, record }
    : { ok: false, error: 'rejected', message: record.message || 'The SMS service refused the message.', record };
}

module.exports = { ready, send, isTestNumber, ENDPOINT };
