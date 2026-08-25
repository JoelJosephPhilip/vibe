/*
 * Installs Deno for the AUDIO_EXTRACTION fallback's yt-dlp calls. yt-dlp
 * shells out to a JS runtime to solve YouTube's "n challenge" (a signature
 * puzzle gating some formats) -- without one, extraction can fail outright
 * with "the page needs to be reloaded" for videos that require it. Deno is
 * yt-dlp's default-supported runtime for this.
 *
 * Installed to a fixed directory next to this script rather than Deno's own
 * default (~/.deno) -- same reasoning as install-python-fallback-deps.cjs:
 * confirmed live on Render that $HOME differs between the build step and
 * the running server, so anything installed under $HOME at build time is
 * invisible at runtime.
 *
 * Wired into package.json's postinstall (Render) and backend/Dockerfile's
 * runtime stage (Docker/Cloud Run) -- see install-python-fallback-deps.cjs
 * for why both are needed. Non-fatal on failure: yt-dlp still downloads
 * audio without Deno, just can't solve the n challenge for videos that need
 * it -- degrades to that rather than breaking the whole install.
 */
'use strict';

const {execSync} = require('child_process');
const path = require('path');

const DENO_INSTALL_DIR = path.join(__dirname, '.deno');

try {
  execSync('curl -fsSL https://deno.land/install.sh | sh -s -- --no-modify-path', {
    stdio: 'inherit',
    env: {...process.env, DENO_INSTALL: DENO_INSTALL_DIR},
  });
  console.log(`[install-deno] done, installed to: ${DENO_INSTALL_DIR}`);
} catch (err) {
  console.warn(
    '[install-deno] skipped (install failed) — yt-dlp will run without a JS runtime, some YouTube videos may fail to extract:',
    err instanceof Error ? err.message : err,
  );
}
