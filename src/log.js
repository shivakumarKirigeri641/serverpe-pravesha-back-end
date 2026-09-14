/**
 * log.js — what is happening, in words, on the console you are watching.
 *
 * The server used to say almost nothing: a request arrived, a pass was issued,
 * a message went out, and none of it reached the terminal. During a
 * demonstration — or the first live day — the console is the only window into
 * the running system, so it should read like a sentence rather than a stack of
 * JSON.
 *
 * One line per event, in IST, aligned so the eye can run down the middle:
 *
 *   07:12:45  wa    in   ••••2415  "hi"
 *   07:12:46  wa    out  ••••2415  welcome, terms and language
 *   07:13:02  book  held  PRV7K3M9Q2A  KA31N8147 · Car · 13 Sept · Morning
 *   07:13:40  pay   paid  ₹113  pay_R7xk…  PRV7K3M9Q2A
 *   07:31:10  gate  ENTER PRV7K3M9Q2A  KA31N8147 · Main Gate · Veeru · 6.2s
 *   07:31:55  gate  REFUSE already used — PRV7K3M9Q2A
 *
 * NUMBERS ARE MASKED, always: a console is copied into chat messages and
 * screenshots, and a visitor's number should not travel with it.
 *
 * Switches, for when it is too much or not enough:
 *   LOG_EVENTS=false   nothing but errors
 *   LOG_HTTP=false     no request lines
 *   LOG_HTTP_ALL=true  request lines for the admin panel's polling too
 */

const ZONE = 'Asia/Kolkata';

const on = (name, fallback = true) => {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return String(v).toLowerCase() !== 'false';
};

const EVENTS = () => on('LOG_EVENTS', true);
const HTTP = () => on('LOG_HTTP', true);
const HTTP_ALL = () => on('LOG_HTTP_ALL', false);

const clock = () => new Date().toLocaleTimeString('en-GB', { timeZone: ZONE, hour12: false });
const pad = (s, width) => String(s === undefined || s === null ? '' : s).padEnd(width);

/** The last four digits, and nothing else. */
const mask = (mobile) => (mobile ? `••••${String(mobile).slice(-4)}` : '—');

/** A line: time, what kind of thing, what happened. */
function event(tag, what, detail = '') {
  if (!EVENTS()) return;
  console.log(`${clock()}  ${pad(tag, 5)} ${pad(what, 6)} ${detail}`.trimEnd());
}

/* The things worth a line. Each takes what it needs and does its own wording,
   so callers stay one line and cannot get the format wrong. */
const log = {
  event,
  mask,

  waIn: (mobile, text) => event('wa', 'in', `${mask(mobile)}  ${text ? `"${String(text).replace(/\s+/g, ' ').slice(0, 60)}"` : '(no text)'}`),
  waOut: (mobile, what, note) => event('wa', 'out', `${mask(mobile)}  ${what}${note ? ` · ${note}` : ''}`),

  booked: (t, what = 'held') => event('book', what,
    `${t.ticket_no}  ${t.reg_no} · ${t.category_label || t.categoryLabel || ''} · ${String(t.travel_date).slice(0, 10)}`.replace(/ · $/, '')),

  paid: (amountPaise, paymentId, ticketNo) =>
    event('pay', 'paid', `₹${Math.round(Number(amountPaise || 0) / 100)}  ${paymentId || ''}  ${ticketNo || ''}`.trimEnd()),
  payFailed: (reason, orderId) => event('pay', 'failed', `${reason || 'unknown'}  ${orderId || ''}`.trimEnd()),

  gate: (verdict, detail) => event('gate',
    verdict === 'valid' || verdict === 'valid_override' ? 'ENTER' : verdict === 'undone' ? 'UNDO' : 'REFUSE', detail),

  admin: (who, action, subject) => event('admin', 'did', `${who} · ${String(action).replace(/_/g, ' ')}${subject ? ` · ${subject}` : ''}`),

  demo: (detail) => event('demo', 'tick', detail),

  /** One line per request, except the panel's own polling, which is noise. */
  http(req, res, ms) {
    if (!HTTP()) return;
    const path = req.originalUrl.split('?')[0];
    if (!HTTP_ALL()) {
      if (req.method === 'GET' && /^\/(public\/img|public\/images|favicon|assets)/.test(path)) return;
      if (req.method === 'GET' && /^\/admin\/api\/(live|alerts|demo|health|dashboard|session)/.test(path)) return;
    }
    const code = res.statusCode;
    const mark = code >= 500 ? '!!' : code >= 400 ? ' !' : '  ';
    event('http', req.method.toLowerCase(), `${mark} ${code} ${path} ${Math.round(ms)}ms`);
  },
};

/** Express middleware: times the request and prints it when it is done. */
log.middleware = (req, res, next) => {
  const started = process.hrtime.bigint();
  res.on('finish', () => log.http(req, res, Number(process.hrtime.bigint() - started) / 1e6));
  next();
};

module.exports = log;
