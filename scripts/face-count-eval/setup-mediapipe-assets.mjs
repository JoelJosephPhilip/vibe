/**
 * Downloads the face detector .tflite model used by eval.mjs's browser
 * harness (#1222). The @mediapipe/tasks-vision WASM runtime itself is
 * served straight out of node_modules by eval.mjs's static server, so it
 * doesn't need copying - only the model, which isn't bundled in the npm
 * package.
 *
 * Run once after `npm install`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL_DEST = path.join(__dirname, 'models', 'blaze_face_short_range.tflite');
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

function downloadModel() {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(MODEL_DEST)) {
      console.log(`[setup-mediapipe-assets] already present: ${MODEL_DEST}`);
      resolve();
      return;
    }
    fs.mkdirSync(path.dirname(MODEL_DEST), { recursive: true });
    console.log(`[setup-mediapipe-assets] downloading ${MODEL_URL}`);
    const file = fs.createWriteStream(MODEL_DEST);
    https
      .get(MODEL_URL, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Model download failed: HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
      })
      .on('error', reject);
  });
}

downloadModel()
  .then(() => console.log('[setup-mediapipe-assets] done'))
  .catch((err) => {
    console.error('[setup-mediapipe-assets] FAILED:', err.message);
    process.exit(1);
  });
