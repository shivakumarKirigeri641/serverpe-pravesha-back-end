/**
 * ─────────────────────────────────────────────────────────────
 *  In-memory Rate Limiter Middleware
 *  Zero external dependencies – uses a Map with auto-cleanup.
 *
 *  Three tiers are exported:
 *    • globalLimiter   – generous blanket limit for ALL routes
 *    • authLimiter     – strict limit for OTP / login / signup
 *    • sensitiveOpLimiter – medium limit for payments, orders, etc.
 * ─────────────────────────────────────────────────────────────
 */

/**
 * Creates a rate-limiter middleware.
 *
 * @param {Object}  opts
 * @param {number}  opts.windowMs       – Time window in milliseconds
 * @param {number}  opts.maxRequests    – Max requests allowed in the window
 * @param {string}  [opts.message]      – Custom error message
 * @param {number}  [opts.cleanupIntervalMs] – How often stale entries are purged
 * @returns {Function} Express middleware
 */
function createRateLimiter({
  windowMs = 60 * 1000,
  maxRequests = 100,
  message = "Too many requests. Please try again later.",
  cleanupIntervalMs = 5 * 60 * 1000,
} = {}) {
  /** @type {Map<string, { count: number, resetTime: number }>} */
  const hits = new Map();

  /* ── Periodic cleanup to prevent unbounded memory growth ── */
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (now >= entry.resetTime) {
        hits.delete(key);
      }
    }
  }, cleanupIntervalMs);

  /* Allow the Node process to exit even if the timer is pending */
  if (cleanupTimer.unref) {
    cleanupTimer.unref();
  }

  /* ── Middleware ── */
  return (req, res, next) => {
    /* Derive a stable client identifier (IP) */
    const clientIp =
      (req.headers["x-forwarded-for"] &&
        req.headers["x-forwarded-for"].split(",")[0].trim()) ||
      req.socket?.remoteAddress ||
      "unknown";

    const now = Date.now();
    let entry = hits.get(clientIp);

    if (!entry || now >= entry.resetTime) {
      /* First request in this window – create / reset entry */
      entry = { count: 1, resetTime: now + windowMs };
      hits.set(clientIp, entry);
    } else {
      entry.count += 1;
    }

    /* Attach standard rate-limit headers (RFC 6585 / draft-ietf-httpapi-ratelimit-headers) */
    const remaining = Math.max(0, maxRequests - entry.count);
    const retryAfterSec = Math.ceil((entry.resetTime - now) / 1000);

    res.setHeader("X-RateLimit-Limit", maxRequests);
    res.setHeader("X-RateLimit-Remaining", remaining);
    res.setHeader("X-RateLimit-Reset", Math.ceil(entry.resetTime / 1000));

    if (entry.count > maxRequests) {
      res.setHeader("Retry-After", retryAfterSec);
      return res.status(429).json({
        statuscode: 429,
        powered_by: "ServerPe App Solutions",
        successstatus: false,
        message,
        retry_after_seconds: retryAfterSec,
      });
    }

    next();
  };
}

/* ─── Pre-configured limiters ─────────────────────────────── */

/**
 * Global limiter – applies to every route.
 * 200 requests per 1 minute per IP.
 */
const globalLimiter = createRateLimiter({
  windowMs: 1 * 60 * 1000,       // 1 minute
  maxRequests: 200,
  message: "Too many requests from this IP. Please slow down.",
});

/**
 * Auth / OTP limiter – strict.
 * 5 requests per 2 minutes per IP (send-otp, verify-otp, login).
 * Prevents OTP flooding and brute-force login attempts.
 */
const authLimiter = createRateLimiter({
  windowMs: 2 * 60 * 1000,       // 2 minutes
  maxRequests: 5,
  message:
    "Too many authentication attempts from this IP. Please wait 2 minutes before trying again.",
});

/**
 * Sensitive operations limiter – moderate.
 * 15 requests per 5 minutes per IP (payments, orders, feedback, contact-us).
 */
const sensitiveOpLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,       // 5 minutes
  maxRequests: 15,
  message:
    "You're performing this action too frequently. Please try again shortly.",
});

module.exports = {
  createRateLimiter,
  globalLimiter,
  authLimiter,
  sensitiveOpLimiter,
};
