// Runs after `npm ci` (including on Render): builds the React voice UI and installs the
// Python voice-service dependencies into voice/.deps. Failures in the Python step are
// reported but not fatal — the rest of HaqSetu still works and /voice shows a fallback.
const { execSync } = require('child_process');
const path = require('path');
const root = path.join(__dirname, '..');
if (process.env.SKIP_POSTINSTALL === 'true') process.exit(0);
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });
try {
  run('npx vite build --config voice-ui/vite.config.js');
} catch (e) {
  console.error('[postinstall] voice UI build failed'); process.exit(1);
}
const py = process.env.PYTHON_BIN || 'python3';
try {
  run(`${py} -m pip install --disable-pip-version-check --no-cache-dir --break-system-packages --target voice/.deps -r voice/requirements.txt`);
} catch (e) {
  try { run(`${py} -m pip install --disable-pip-version-check --no-cache-dir --target voice/.deps -r voice/requirements.txt`); } catch (e2) {
    console.error('[postinstall] WARNING: could not install Python voice dependencies; the voice assistant will be unavailable.');
  }
}
