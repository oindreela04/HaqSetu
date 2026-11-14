'use strict';
/**
 * Starts the Python FastAPI voice service (voice/app.py) as a child process bound to
 * 127.0.0.1, restarts it if it crashes, and exposes a small client for the proxy routes.
 */
const { spawn } = require('child_process');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.VOICE_PORT || 8001);
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = process.env.VOICE_INTERNAL_SECRET || crypto.randomBytes(24).toString('hex');
let child = null;
let restarts = 0;
let ready = false;

function start() {
  if (process.env.VOICE_DISABLED === 'true') return;
  const root = path.join(__dirname, '..');
  const deps = path.join(root, 'voice', '.deps');
  const env = {
    ...process.env,
    VOICE_INTERNAL_SECRET: SECRET,
    PYTHONPATH: [deps, root, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
    PYTHONUNBUFFERED: '1',
  };
  child = spawn(process.env.PYTHON_BIN || 'python3', ['-m', 'uvicorn', 'voice.app:app', '--host', '127.0.0.1', '--port', String(PORT), '--log-level', 'warning'], { cwd: root, env, stdio: ['ignore', 'inherit', 'inherit'] });
  child.on('error', (e) => { console.error('[voice] could not start Python service:', e.message); });
  child.on('exit', (code) => {
    ready = false;
    if (restarts < 5) {
      restarts++;
      const wait = 2000 * restarts;
      console.warn(`[voice] service exited (${code}); restarting in ${wait / 1000}s`);
      setTimeout(start, wait);
    } else console.error('[voice] service keeps failing; voice assistant disabled until next deploy');
  });
  // Poll health
  const t0 = Date.now();
  const poll = async () => {
    try {
      const r = await fetch(`${BASE}/healthz`);
      if (r.ok) { ready = true; restarts = 0; console.log('[voice] service ready'); return; }
    } catch (_) { /* not yet */ }
    if (Date.now() - t0 < 60000 && child && child.exitCode === null) setTimeout(poll, 1000);
  };
  setTimeout(poll, 800);
}

async function call(method, p, { json, body, headers = {}, timeout = 45000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(`${BASE}${p}`, {
      method,
      headers: { 'x-internal-secret': SECRET, ...(json ? { 'content-type': 'application/json' } : {}), ...headers },
      body: json ? JSON.stringify(json) : body,
      signal: ctrl.signal,
    });
    return r;
  } finally {
    clearTimeout(timer);
  }
}

function stop() { if (child) { restarts = 99; child.kill('SIGTERM'); } }

module.exports = { start, stop, call, isReady: () => ready };
