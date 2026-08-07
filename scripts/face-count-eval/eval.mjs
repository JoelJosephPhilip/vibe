/**
 * Offline face-count detection accuracy evaluation (#1222).
 *
 * Runs the ACTUAL production model config from
 * frontend/src/components/ai/FaceDetectorWorker.ts:
 *
 *   @tensorflow-models/face-detection, SupportedModels.MediaPipeFaceDetector
 *   runtime: "tfjs", modelType: "full", maxFaces: 10
 *
 * via the @tensorflow/tfjs-backend-wasm CPU backend - the Node equivalent of
 * the browser's CPU-fallback path when WebGL is unavailable. Same npm
 * package, same version, same weights as production - this is true runtime
 * parity, not a different detector standing in for it.
 *
 * (An earlier version of this harness used Python + MediaPipe's Tasks API
 * instead, which is a different wrapper around the same underlying model
 * family. This version replaces that with the actual production dependency
 * to remove that gap entirely.)
 *
 * Usage:
 *   npm install
 *   node eval.mjs [--labels data/labels.csv] [--frames-dir data/frames]
 *                 [--output reports/face-count-eval-results.json]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-wasm';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import * as faceDetection from '@tensorflow-models/face-detection';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUCKETS = ['0', '1', '2+'];

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
  const lines = csvText.trim().split('\n');
  const header = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row = {};
    header.forEach((key, i) => (row[key] = cells[i]));
    return row;
  });
}

function loadImageAsTensor(filePath) {
  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();

  let width, height, data; // data: flat RGBA Uint8Array/Buffer

  if (ext === '.png') {
    const png = PNG.sync.read(buffer);
    ({ width, height, data } = png);
  } else {
    const decoded = jpeg.decode(buffer, { useTArray: true });
    ({ width, height, data } = decoded);
  }

  // Drop the alpha channel - tf.tensor3d for these models expects RGB.
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    rgb[j] = data[i];
    rgb[j + 1] = data[i + 1];
    rgb[j + 2] = data[i + 2];
  }

  return tf.tensor3d(rgb, [height, width, 3], 'int32');
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

async function main() {
  const args = parseArgs();
  const labelsPath = path.resolve(process.cwd(), args.labels);
  const framesDir = path.resolve(process.cwd(), args.framesDir);
  const outputPath = path.resolve(process.cwd(), args.output);

  setWasmPaths(path.join(__dirname, 'node_modules', '@tensorflow', 'tfjs-backend-wasm', 'dist') + path.sep);
  await tf.setBackend('wasm');
  await tf.ready();
  console.log(`tfjs backend: ${tf.getBackend()}`);

  const detector = await faceDetection.createDetector(
    faceDetection.SupportedModels.MediaPipeFaceDetector,
    { runtime: 'tfjs', modelType: 'full', maxFaces: 10 },
  );

  const rows = parseCsv(fs.readFileSync(labelsPath, 'utf8'));
  const results = [];

  for (const row of rows) {
    const imagePath = path.join(framesDir, row.filename);
    const imageTensor = loadImageAsTensor(imagePath);
    const faces = await detector.estimateFaces(imageTensor);
    imageTensor.dispose();

    const groundTruth = Number(row.ground_truth_face_count);
    results.push({
      frame_id: row.frame_id,
      filename: row.filename,
      ground_truth_face_count: groundTruth,
      predicted_face_count: faces.length,
      condition_tags: row.condition_tags,
      gtBucket: bucketCount(groundTruth),
      predBucket: bucketCount(faces.length),
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
    runtime: '@tensorflow-models/face-detection (MediaPipeFaceDetector, tfjs runtime, modelType=full) via @tensorflow/tfjs-backend-wasm - same config as production frontend/src/components/ai/FaceDetectorWorker.ts',
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
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
