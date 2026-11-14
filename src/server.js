'use strict';
const { startBundledPostgres } = require('./bundledDb');

const PORT = Number(process.env.PORT || 3000);

(async () => {
  try {
    await startBundledPostgres(); // no-op when DATABASE_URL is set
    const { seedAll } = require('./seed'); // db.js reads DATABASE_URL on first require
    const r = await seedAll(); // idempotent: migrations + reference data + new seed schemes
    console.log(`[startup] database ready (${r.added} new, ${r.updated} updated seed schemes)`);
  } catch (e) {
    console.error('[startup] database setup failed', e);
    process.exit(1);
  }
  require('./voiceService').start();
  const { createApp } = require('./app');
  createApp().listen(PORT, () => console.log(`HaqSetu listening on :${PORT}`));
})();
