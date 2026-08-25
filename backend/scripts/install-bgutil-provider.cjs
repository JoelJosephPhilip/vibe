/*
 * Installs the Node-side half of the bgutil-ytdlp-pot-provider PO-token
 * provider (see install-python-fallback-deps.cjs for the pip-installed
 * yt-dlp plugin half). Together they give yt-dlp a proof-of-origin token,
 * which is currently the only non-cookie, non-paid-proxy mitigation for
 * YouTube's "Sign in to confirm you're not a bot" bot-check on datacenter
 * IPs (confirmed live on Render this session: cookies and player-client
 * spoofing both got rotated/blocked within one test session; a residential
 * proxy is the only method reported as reliable, but that's a paid
 * external service, not something this script can set up).
 *
 * Uses the "script mode" provider (the repo's option (b), not the
 * always-running HTTP server option (a)): yt-dlp spawns `node
 * server/build/main.js` itself per call rather than this app managing a
 * second long-running process/port. The repo's own docs call this
 * unsuitable for high-concurrency use (~1 new Node process per call), but
 * this fallback already only ever handles one job's AUDIO_EXTRACTION at a
 * time (see GenAIService's inFlightFallbacks guard), so that tradeoff
 * doesn't apply here.
 *
 * Installed to a fixed directory next to this script rather than the
 * repo's own default (~/bgutil-ytdlp-pot-provider) -- same $HOME-differs-
 * between-build-and-runtime reason as install-deno.cjs. yt-dlp is pointed
 * at this fixed path via the `server_home` extractor-arg (see
 * pythonInterpreter.ts / LocalAudioExtractionService.ts) instead of
 * relying on the default.
 *
 * Non-fatal on failure: yt-dlp still runs without a PO token, just more
 * likely to hit the bot-check on a flagged IP -- degrades to that rather
 * than breaking the whole install.
 */
'use strict';

const {execSync} = require('child_process');
const path = require('path');
const fs = require('fs');

const INSTALL_DIR = path.join(__dirname, '.bgutil-provider');
const SERVER_DIR = path.join(INSTALL_DIR, 'server');
// Pin to a fixed release so the Node-side script and the pip-installed
// plugin (install-python-fallback-deps.cjs) stay on versions the repo
// tested together -- the plugin resolves whichever bgutil-ytdlp-pot-provider
// version pip installs, so bump both together if this changes.
const VERSION_TAG = '1.3.2';

try {
  if (!fs.existsSync(INSTALL_DIR)) {
    execSync(
      `git clone --single-branch --branch ${VERSION_TAG} --depth 1 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git "${INSTALL_DIR}"`,
      {stdio: 'inherit'},
    );
  }
  execSync('npm ci && npx tsc', {stdio: 'inherit', cwd: SERVER_DIR});
  console.log(`[install-bgutil-provider] done, installed to: ${SERVER_DIR}`);
} catch (err) {
  console.warn(
    '[install-bgutil-provider] skipped (install failed) — yt-dlp will run without a PO token, more likely to hit YouTube\'s bot-check on flagged IPs:',
    err instanceof Error ? err.message : err,
  );
}
