/*
 * Installs the Python packages the genAI local fallback needs
 * (AUDIO_EXTRACTION: yt-dlp; SEGMENTATION: numpy/scipy/ruptures — see
 * backend/scripts/segment.py) via pip, run as a postinstall hook.
 *
 * Needed specifically for Render: its buildCommand is a plain
 * `npm install --include=dev && tsc` with no separate step for anything
 * outside npm — unlike backend/Dockerfile, which installs these explicitly
 * in its runtime stage (that stage never runs `pnpm install` at all, it
 * only copies node_modules from the builder stage, so a postinstall hook
 * alone wouldn't reach it — the Dockerfile's own explicit install stays).
 * Render's native build/runtime is a single environment, so a postinstall
 * hook lands in the right place there.
 *
 * Failure here is non-fatal (falls back to a warning, doesn't fail the
 * whole install) — this only affects local-fallback availability, not the
 * rest of the app, and the Docker builder stage doesn't have python3/pip on
 * PATH at all (only the runtime stage does), so it's expected to no-op
 * there.
 */
'use strict';

const {execSync} = require('child_process');
const fs = require('fs');
const path = require('path');

// Written next to this script; read at runtime by
// backend/src/modules/genAI/utils/pythonInterpreter.ts. Confirmed live on
// Render: a bare 'python3' spawn at runtime resolves to /usr/bin/python3,
// a *different* interpreter than whichever managed Python `pip` targeted
// during this build step ("No module named yt_dlp" despite pip reporting
// success) — build and runtime apparently don't share a PATH/interpreter
// there. Recording the exact interpreter pip just used, right after using
// it, sidesteps needing to know why.
const INTERPRETER_FILE = path.join(__dirname, '.python-fallback-interpreter');

try {
  execSync(
    'python3 -m pip install --break-system-packages --no-cache-dir yt-dlp numpy scipy ruptures',
    {stdio: 'inherit'},
  );
  const interpreterPath = execSync('python3 -c "import sys; print(sys.executable)"')
    .toString()
    .trim();
  fs.writeFileSync(INTERPRETER_FILE, interpreterPath);
  console.log(`[install-python-fallback-deps] done, interpreter: ${interpreterPath}`);
} catch (err) {
  console.warn(
    '[install-python-fallback-deps] skipped (pip unavailable or install failed) — genAI local fallback for AUDIO_EXTRACTION/SEGMENTATION will not work in this environment:',
    err instanceof Error ? err.message : err,
  );
}
