import fs from 'fs';
import path from 'path';

/**
 * Resolves which python3 binary the genAI local fallback's pip packages
 * (yt-dlp/numpy/scipy/ruptures) were actually installed against.
 *
 * Confirmed live on Render: a bare 'python3' spawn at runtime resolves to
 * /usr/bin/python3, a *different* interpreter than whichever managed Python
 * `pip install` targeted during the build step — pip reported success, but
 * the runtime spawn failed with "No module named yt_dlp". Build and runtime
 * apparently don't share a PATH/interpreter there.
 *
 * scripts/install-python-fallback-deps.cjs (the postinstall hook that runs
 * that pip install) records the exact interpreter it used right after using
 * it. If that file is missing (e.g. install was skipped, or an environment
 * where build and runtime genuinely are the same interpreter), falls back
 * to a bare 'python3' — correct in Docker, where there's no such split.
 */
let cachedInterpreter: string | null = null;

export function getPythonInterpreter(): string {
  if (cachedInterpreter) return cachedInterpreter;

  const recordedPath = path.resolve(
    process.cwd(),
    'scripts',
    '.python-fallback-interpreter',
  );
  try {
    const recorded = fs.readFileSync(recordedPath, 'utf8').trim();
    cachedInterpreter = recorded || 'python3';
  } catch {
    cachedInterpreter = 'python3';
  }
  return cachedInterpreter;
}
