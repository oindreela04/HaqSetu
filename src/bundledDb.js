'use strict';
/**
 * Starts a private PostgreSQL server inside this process's container (via the
 * `embedded-postgres` npm package) when no DATABASE_URL is configured.
 * Data is stored in a temporary directory and is lost when the host restarts.
 * Set DATABASE_URL to an external PostgreSQL for permanent storage.
 */
const os = require('os');
const path = require('path');
const fs = require('fs');

async function startBundledPostgres() {
  if (process.env.DATABASE_URL) return null;
  const EmbeddedPostgres = (await import('embedded-postgres')).default;
  const dir = process.env.BUNDLED_PG_DIR || path.join(os.tmpdir(), 'haqsetu-pg');
  const port = Number(process.env.BUNDLED_PG_PORT || 5433);
  const password = require('crypto').randomBytes(18).toString('hex');
  fs.rmSync(dir, { recursive: true, force: true }); // fresh cluster each boot (password changes)
  const pg = new EmbeddedPostgres({
    databaseDir: dir, user: 'haq', password, port, persistent: false,
    postgresFlags: ['-c', 'listen_addresses=127.0.0.1', '-c', 'max_connections=20', '-c', 'shared_buffers=32MB', '-c', 'work_mem=2MB', '-c', 'maintenance_work_mem=16MB'],
    onLog: () => {}, onError: (e) => console.error('[bundled-pg]', String(e).trim()),
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('haqsetu');
  process.env.DATABASE_URL = `postgres://haq:${password}@127.0.0.1:${port}/haqsetu`;
  process.env.EPHEMERAL_DB = process.env.EPHEMERAL_DB || 'true';
  process.env.PG_POOL_MAX = process.env.PG_POOL_MAX || '8';
  console.log('[startup] bundled PostgreSQL started — data resets when the server restarts');
  const stop = async () => { try { await pg.stop(); } catch (_) { /* ignore */ } process.exit(0); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  return pg;
}

module.exports = { startBundledPostgres };
