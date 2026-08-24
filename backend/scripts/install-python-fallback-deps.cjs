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
const path = require('path');

// Installed to a fixed --target dir next to this script rather than pip's
// default user site-packages. Confirmed live on Render: a bare 'python3'
// spawn at runtime resolves to the exact same interpreter pip used at
// build time (/usr/bin/python3 both times) yet still reports "No module
// named yt_dlp" — the real cause is that pip's default user-site location
// is derived from $HOME, and $HOME differs between Render's build step and
// its running server. --target sidesteps $HOME entirely; runtime reads
// this same fixed path back via PYTHONPATH (see pythonInterpreter.ts).
const TARGET_DIR = path.join(__dirname, '.python-fallback-deps');

try {
  execSync(
    `python3 -m pip install --break-system-packages --no-cache-dir --target "${TARGET_DIR}" yt-dlp numpy scipy ruptures`,
    {stdio: 'inherit'},
  );
  console.log(`[install-python-fallback-deps] done, installed to: ${TARGET_DIR}`);
} catch (err) {
  console.warn(
    '[install-python-fallback-deps] skipped (pip unavailable or install failed) — genAI local fallback for AUDIO_EXTRACTION/SEGMENTATION will not work in this environment:',
    err instanceof Error ? err.message : err,
  );
}
