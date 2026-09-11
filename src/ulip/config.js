/**
 * ulip/config.js — the settings for talking to ULIP directly.
 *
 * Ported from the GaadiPe gateway (serverpe-gaadipe-back-end/src/config.js),
 * keeping only what the ULIP modules read, so client.js, vahan.js, echallan.js,
 * fastag.js and cache.js run here unchanged apart from where they import this.
 *
 * ULIP AUTHORISES BY SOURCE IP. Only a whitelisted server can log in; anywhere
 * else login answers 412/403. So VEHICLE_SOURCE decides where vehicle data
 * comes from:
 *
 *   ulip     call ULIP from this process — the deployed Pravesha server
 *   gateway  call GATEWAY_BASE_URL over HTTP — a laptop, until the gateway is
 *            retired
 */

const int = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const bool = (v, d = false) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(String(v)));

const config = {
  ulip: {
    baseUrl: (process.env.ULIP_BASE_URL || 'https://www.ulip.dpiit.gov.in/ulip/v1.0.0').replace(/\/+$/, ''),
    username: process.env.ULIP_USERNAME || '',
    password: process.env.ULIP_PASSWORD || '',
    timeoutMs: int(process.env.ULIP_TIMEOUT_MS, 30_000),
    // ULIP's token idles out at ~30 minutes; refreshed well before that.
    tokenTtlMs: int(process.env.ULIP_TOKEN_TTL_MS, 25 * 60 * 1000),
    // '01' skips the JSON dataset when ULIP's VAHAN/04 adapter is broken.
    vahanPrimary: String(process.env.ULIP_VAHAN_PRIMARY || '04'),
    /* FASTAG/01 is a vehicle's toll-plaza crossings — where it has been, with
       coordinates and times. An entry pass has no use for a vehicle's travel
       history, and holding it for every plate typed in is a privacy liability
       the privacy policy does not cover. Off unless deliberately switched on,
       and if it is, the privacy policy must say so. Tag details (FASTAG/02)
       are fetched either way. */
    fastagCrossings: bool(process.env.ULIP_FASTAG_CROSSINGS, false),
  },

  /* In memory, and mainly for the negative answer: a plate ULIP says does not
     exist is remembered for a day, so a mistyped plate costs one call rather
     than one per attempt. Found vehicles are cached for thirty days in the
     database by vehicle.js, which is the cache that matters. */
  cache: {
    enabled: bool(process.env.ULIP_CACHE_ENABLED, true),
    rcMinutes: int(process.env.ULIP_CACHE_MINUTES_RC, 60),
    challanMinutes: int(process.env.ULIP_CACHE_MINUTES_CHALLAN, 60),
    fastagMinutes: int(process.env.ULIP_CACHE_MINUTES_FASTAG, 60),
    notFoundMinutes: int(process.env.ULIP_CACHE_MINUTES_NOT_FOUND, 60 * 24),
    maxEntries: int(process.env.ULIP_CACHE_MAX_ENTRIES, 5000),
  },

  logCalls: bool(process.env.LOG_ULIP_CALLS, true),

  source: () => String(process.env.VEHICLE_SOURCE || 'gateway').toLowerCase() === 'ulip' ? 'ulip' : 'gateway',
};

module.exports = { config };
