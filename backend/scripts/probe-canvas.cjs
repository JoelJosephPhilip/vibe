/*
 * TEMPORARY diagnostic, not a real feature. Checks whether the `canvas`
 * npm package (a native node-gyp module needing Cairo/Pango) can compile
 * on Render's native Node buildpack (no apt/apk available there) --
 * needed to know if bgutil-ytdlp-pot-provider's HTTP server (which
 * depends on canvas via bgutils-js) is even installable here before
 * building the rest of the PO-token integration around it. Remove after
 * the answer is known either way.
 */
'use strict';
const { execSync } = require('child_process');
try {
  execSync('npm install canvas --no-save --prefix /tmp/canvas-probe', {
    stdio: 'inherit',
    env: process.env,
  });
  console.log('[probe-canvas] SUCCESS: canvas installed cleanly');
} catch (err) {
  console.warn('[probe-canvas] FAILED:', err instanceof Error ? err.message : err);
}
