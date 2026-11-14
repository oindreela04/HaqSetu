'use strict';
const { createApp } = require('./app');
const { seedAll } = require('./seed');

const PORT = Number(process.env.PORT || 3000);

(async () => {
  try {
    const r = await seedAll(); // idempotent: migrations + reference data + new seed schemes
    console.log(`[startup] database ready (${r.added} new seed schemes)`);
  } catch (e) {
    console.error('[startup] database setup failed', e);
    process.exit(1);
  }
  createApp().listen(PORT, () => console.log(`HaqSetu listening on :${PORT}`));
})();
