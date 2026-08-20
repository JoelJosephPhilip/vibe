/*
 * Docker build-time warm-up for the local transcription fallback (see
 * LocalTranscriptionService). nodejs-whisper compiles whisper.cpp lazily on
 * first use (not at `npm install` time) and downloads the ggml model on
 * first use too, as one bundled step (see its autoDownloadModel.js) —
 * running that here, during the image build, means the compiled binary and
 * model ship baked into the image instead of paying that cost (and needing
 * a C++ toolchain) on the first real request.
 *
 * Requires the Dockerfile's builder stage to install real GNU wget (`apk add
 * wget`) — the vendored download-ggml-model.sh shells out to
 * `wget --no-config`, which Alpine's BusyBox-provided wget (present by
 * default, no install needed) doesn't support.
 *
 * Not run automatically; wired into backend/Dockerfile as an explicit
 * builder-stage RUN step. Safe to skip locally — LocalTranscriptionService
 * would just compile/download on first real use instead.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { nodewhisper } = require('nodejs-whisper');

const MODEL_ROOT = path.resolve(process.cwd(), 'whisper-models');
const MODEL_NAME = process.env.WHISPER_MODEL_NAME || 'tiny.en';

function writeSilentWav(filePath, seconds = 1, sampleRate = 16000) {
  const numSamples = seconds * sampleRate;
  const dataSize = numSamples * 2; // 16-bit mono PCM
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  fs.writeFileSync(filePath, buf);
}

async function main() {
  fs.mkdirSync(MODEL_ROOT, {recursive: true});

  const warmupFile = path.join(os.tmpdir(), 'nodejs-whisper-warmup.wav');
  writeSilentWav(warmupFile);

  await nodewhisper(warmupFile, {
    modelName: MODEL_NAME,
    autoDownloadModelName: MODEL_NAME,
    modelRootPath: MODEL_ROOT,
    removeWavFileAfterTranscription: true,
    logger: console,
  });

  console.log(`[warmup-whisper] whisper.cpp compiled and "${MODEL_NAME}" model cached at ${MODEL_ROOT}`);
}

main().catch(err => {
  console.error('[warmup-whisper] failed:', err);
  process.exit(1);
});
