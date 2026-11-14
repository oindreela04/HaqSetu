'use strict';
/**
 * Free-tier hosts put idle services to sleep after ~15 minutes, which makes the next
 * visitor wait ~1 minute and (with the bundled database) resets accounts.
 * During Indian daytime this pings the public URL every 10 minutes so citizens get a fast,
 * stable site. It stays off at night to respect the hosting plan's monthly hour allowance.
 * Configure with KEEP_AWAKE=false, KEEP_AWAKE_START_IST / KEEP_AWAKE_END_IST (hours, 24h).
 */
function istHour(d = new Date()) {
  return (d.getUTCHours() + 5 + (d.getUTCMinutes() + 30 >= 60 ? 1 : 0)) % 24;
}

function start() {
  const url = process.env.SITE_URL;
  if (!url || process.env.KEEP_AWAKE === 'false' || process.env.NODE_ENV !== 'production') return;
  const from = Number(process.env.KEEP_AWAKE_START_IST || 7);
  const to = Number(process.env.KEEP_AWAKE_END_IST || 23);
  const tick = async () => {
    const h = istHour();
    if (h >= from && h < to) {
      try { await fetch(`${url.replace(/\/$/, '')}/healthz`, { headers: { 'user-agent': 'haqsetu-keepawake' } }); } catch (_) { /* ignore */ }
    }
  };
  setInterval(tick, 10 * 60 * 1000).unref();
  console.log(`[keep-awake] active ${from}:00–${to}:00 IST`);
}

module.exports = { start, istHour };
