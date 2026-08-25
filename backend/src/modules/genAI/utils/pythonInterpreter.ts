import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// This compiled file lives at build/modules/genAI/utils/pythonInterpreter.js
// (tsconfig: rootDir src -> outDir build, mirrored 1:1) — four levels above
// __dirname is the backend/ root, sibling to scripts/. Resolving via
// __dirname rather than process.cwd() means this doesn't depend on the
// runtime process's working directory matching whatever
// scripts/install-python-fallback-deps.cjs assumed at build time; it's tied
// to where this file itself was placed on disk, which the build always
// gets right.
const TARGET_DIR = path.resolve(__dirname, '../../../../scripts/.python-fallback-deps');
const DENO_BIN_DIR = path.resolve(__dirname, '../../../../scripts/.deno/bin');

/**
 * Env vars for spawning the genAI local fallback's python3 scripts.
 *
 * scripts/install-python-fallback-deps.cjs installs yt-dlp/numpy/scipy/ruptures
 * into this fixed --target directory rather than pip's default user
 * site-packages, because that default depends on $HOME — which differs
 * between Render's build step and its running server (confirmed live:
 * identical /usr/bin/python3 binary in both, yet "No module named yt_dlp" at
 * runtime until this fix). Pointing PYTHONPATH at the fixed directory makes
 * the packages visible regardless of $HOME.
 *
 * Also prepends scripts/install-deno.cjs's fixed install directory to PATH,
 * for the same $HOME reason — yt-dlp shells out to `deno` by name to solve
 * YouTube's "n challenge"; if it's not resolvable on PATH, extraction can
 * fail outright ("the page needs to be reloaded") for videos that need it.
 */
export function getPythonEnv(): NodeJS.ProcessEnv {
  const env = {...process.env};

  if (fs.existsSync(TARGET_DIR)) {
    env.PYTHONPATH = env.PYTHONPATH ? `${TARGET_DIR}${path.delimiter}${env.PYTHONPATH}` : TARGET_DIR;
  }
  if (fs.existsSync(DENO_BIN_DIR)) {
    env.PATH = env.PATH ? `${DENO_BIN_DIR}${path.delimiter}${env.PATH}` : DENO_BIN_DIR;
  }

  return env;
}
