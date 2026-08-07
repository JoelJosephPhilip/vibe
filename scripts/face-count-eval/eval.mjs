/**
 * Offline face-count detection accuracy evaluation (#1222).
 *
 * Runs the ACTUAL production model config from
 * frontend/src/components/ai/FaceDetectorWorker.ts (same npm package,
 * version, and options - see harness.html) inside a real headless Chromium
 * via Playwright, since @mediapipe/tasks-vision's FaceDetector requires a
 * real browser environment (confirmed empirically: it hangs indefinitely in
 * plain Node, even with jsdom polyfilling `document` - the WASM module's
 * init promise never settles). This is genuine runtime parity, not a Node
 * approximation of it.
 *
 * (Two earlier versions of this harness existed: a Python + MediaPipe Tasks
 * API version, then a Node + @tensorflow-models/face-detection + tfjs-wasm
 * version. Both tested a different library than what actually runs in
 * production after #1222's browser detector swap. This version closes that
 * gap for real.)
 *
 * Usage:
 *   npm install
 *   npx playwright install chromium   # one-time
 *   node setup-mediapipe-assets.mjs    # one-time: copies WASM, downloads model
 *   node eval.mjs [--labels data/labels.csv] [--frames-dir data/frames]
 *                 [--output reports/face-count-eval-results.json]
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUCKETS = ['0', '1', '2+'];

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
  '.tflite': 'application/octet-stream',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

function parseArgs() {
  const args = { labels: 'data/labels.csv', framesDir: 'data/frames', output: 'reports/face-count-eval-results.json' };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--labels') args.labels = argv[++i];
    else if (argv[i] === '--frames-dir') args.framesDir = argv[++i];
    else if (argv[i] === '--output') args.output = argv[++i];
  }
  return args;
}

function parseCsv(csvText) {
  // Tolerate CRLF line endings - labels.csv gets appended to by both this
  // repo's Python capture tools (csv.writer defaults to \r\n per RFC 4180)
  // and plain-\n edits, so lines can be mixed.
  const lines = csvText.trim().split(/\r?\n/);
  const header = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(',').map((c) => c.trim());
    const row = {};
    header.forEach((key, i) => (row[key] = cells[i]));
    return row;
  });
}

function bucketCount(n) {
  if (n <= 0) return '0';
  if (n === 1) return '1';
  return '2+';
}

function binaryMetrics(rows, targetBucket) {
  let tp = 0, fp = 0, fn = 0;
  for (const row of rows) {
    const truePositive = row.gtBucket === targetBucket;
    const predPositive = row.predBucket === targetBucket;
    if (truePositive && predPositive) tp++;
    else if (!truePositive && predPositive) fp++;
    else if (truePositive && !predPositive) fn++;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1 };
}

function startStaticServer(rootDir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      const filePath = path.join(rootDir, urlPath);
      if (!filePath.startsWith(rootDir)) {
        res.writeHead(403);
        res.end();
        return;
      }
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end();
          return;
        }
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  const args = parseArgs();
  const labelsPath = path.resolve(process.cwd(), args.labels);
  const framesDir = path.resolve(process.cwd(), args.framesDir);
  const outputPath = path.resolve(process.cwd(), args.output);

  const modelPath = path.join(__dirname, 'models', 'blaze_face_short_range.tflite');
  if (!fs.existsSync(modelPath)) {
    throw new Error(`Model not found at ${modelPath}. Run: node setup-mediapipe-assets.mjs`);
  }

  const server = await startStaticServer(__dirname);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    page.on('pageerror', (err) => console.error('  [browser error]', err.message));

    await page.goto(`${baseUrl}/harness.html`);
    await page.waitForFunction(() => window.harnessReady === true);

    const rows = parseCsv(fs.readFileSync(labelsPath, 'utf8'));
    const results = [];

    for (const row of rows) {
      const { count, scores } = await page.evaluate((filename) => window.detectFrame(filename), row.filename);
      const groundTruth = Number(row.ground_truth_face_count);
      results.push({
        frame_id: row.frame_id,
        filename: row.filename,
        ground_truth_face_count: groundTruth,
        predicted_face_count: count,
        scores,
        condition_tags: row.condition_tags,
        gtBucket: bucketCount(groundTruth),
        predBucket: bucketCount(count),
      });
    }

    const noFaceMetrics = binaryMetrics(results, '0');
    const multipleFacesMetrics = binaryMetrics(results, '2+');

    const confusion = {};
    for (const gt of BUCKETS) {
      confusion[gt] = {};
      for (const pred of BUCKETS) confusion[gt][pred] = 0;
    }
    for (const row of results) confusion[row.gtBucket][row.predBucket]++;

    const byCondition = {};
    for (const row of results) {
      const correct = row.gtBucket === row.predBucket;
      for (const tag of String(row.condition_tags).split('|')) {
        byCondition[tag] ??= { total: 0, correct: 0 };
        byCondition[tag].total++;
        if (correct) byCondition[tag].correct++;
      }
    }
    const conditionBreakdown = Object.fromEntries(
      Object.entries(byCondition)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([tag, v]) => [tag, { ...v, accuracy: v.total ? v.correct / v.total : null }]),
    );

    const output = {
      dataset_size: results.length,
      runtime: '@mediapipe/tasks-vision FaceDetector (real headless Chromium via Playwright) - same config as production frontend/src/components/ai/FaceDetectorWorker.ts',
      no_face_metrics: noFaceMetrics,
      multiple_faces_metrics: multipleFacesMetrics,
      confusion_matrix: { labels: BUCKETS, matrix: BUCKETS.map((gt) => BUCKETS.map((pred) => confusion[gt][pred])) },
      condition_breakdown: conditionBreakdown,
      per_frame: results.map(({ gtBucket, predBucket, ...rest }) => rest),
    };

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

    console.log(`\nEvaluated ${results.length} frames\n`);
    console.log('NO_FACE metrics:', noFaceMetrics);
    console.log('MULTIPLE_FACES metrics:', multipleFacesMetrics);
    console.log(`\nConfusion matrix (rows=ground truth, cols=predicted), labels=${JSON.stringify(BUCKETS)}:`);
    for (const gt of BUCKETS) console.log(` ${gt}:`, BUCKETS.map((pred) => confusion[gt][pred]));
    console.log('\nBy condition tag:');
    for (const [tag, stats] of Object.entries(conditionBreakdown)) {
      console.log(`  ${tag}: ${stats.correct}/${stats.total} correct`);
    }
    console.log(`\nWrote ${outputPath}`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
