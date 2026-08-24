import fs from 'fs';
import path from 'path';

const TARGET_DIR = path.resolve(process.cwd(), 'scripts', '.python-fallback-deps');

/**
 * Env vars for spawning the genAI local fallback's python3 scripts.
 *
 * scripts/install-python-fallback-deps.cjs installs yt-dlp/numpy/scipy/ruptures
 * into a fixed --target directory rather than pip's default user site-packages,
 * because that default depends on $HOME — which differs between Render's build
 * step and its running server (confirmed live: identical /usr/bin/python3
 * binary in both, yet "No module named yt_dlp" at runtime until this fix).
 * Pointing PYTHONPATH at that fixed directory makes the packages visible
 * regardless of $HOME.
 */
export function getPythonEnv(): NodeJS.ProcessEnv {
  if (!fs.existsSync(TARGET_DIR)) return process.env;
  const existing = process.env.PYTHONPATH;
  return {
    ...process.env,
    PYTHONPATH: existing ? `${TARGET_DIR}${path.delimiter}${existing}` : TARGET_DIR,
  };
}
