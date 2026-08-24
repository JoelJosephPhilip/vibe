import { injectable, inject } from 'inversify';
import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import axios from 'axios';
import { nodewhisper } from 'nodejs-whisper';
import { ANOMALIES_TYPES } from '#root/modules/anomalies/types.js';
import { CloudStorageService } from '#root/modules/anomalies/index.js';
import { aiConfig } from '#root/config/ai.js';
import { storageConfig } from '#root/config/storage.js';
import { TaskStatus, trascriptGenerationData } from '../classes/transformers/GenAI.js';

/**
 * Local fallback for TRANSCRIPT_GENERATION, used when the external AI server
 * is unreachable (see GenAIService._callAiServerOrFallback). Downloads the
 * segment's audio, transcribes it with a local whisper.cpp build (via
 * nodejs-whisper), and uploads the result to the same GCS location a real
 * webhook response would use — so it's indistinguishable to the rest of the
 * pipeline (GenAIService.updateJob, fetchTranscriptChunks) from a real one.
 *
 * whisper.cpp's own audio-format conversion shells out to a plain `ffmpeg` on
 * PATH. On the Docker/Cloud Run image that's `apk add ffmpeg`; on Render's
 * native Node buildpack there's no system ffmpeg, so this falls back to the
 * `ffmpeg-static` npm package's bundled binary the first time it's needed.
 */
@injectable()
export class LocalTranscriptionService {
  private ffmpegPathEnsured = false;

  constructor(
    @inject(ANOMALIES_TYPES.CloudStorageService)
    private readonly cloudStorageService: CloudStorageService,
  ) {}

  async transcribe(jobId: string, audioUrl: string): Promise<trascriptGenerationData> {
    await this.ensureFfmpegOnPath();

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-fallback-'));
    const audioPath = path.join(workDir, 'audio.mp3');
    let jsonOutputPath: string | undefined;

    try {
      await this.downloadTo(audioUrl, audioPath);

      const modelRootPath = path.resolve(process.cwd(), aiConfig.whisperModelPath);
      await nodewhisper(audioPath, {
        modelName: aiConfig.whisperModel,
        autoDownloadModelName: aiConfig.whisperModel,
        modelRootPath,
        removeWavFileAfterTranscription: true,
        whisperOptions: { outputInJson: true },
        // Route nodejs-whisper's own progress/debug logging to debug level so
        // it doesn't spam production logs at info/log level on every fallback run.
        logger: { ...console, log: console.debug },
      });

      // nodejs-whisper converts the input to <input>.wav then runs whisper-cli
      // on that with -f <wavPath>; whisper.cpp's -oj (no explicit -of) writes
      // <wavPath>.json. The WAV itself is already gone by here
      // (removeWavFileAfterTranscription above), so try that path first and
      // fall back to the un-normalized <input>.json in case of a version
      // difference — this is deliberately not hard-guessed, since our own
      // build-time warm-up never exercised whisperOptions.outputInJson.
      const wavBase = audioPath.replace(/\.[^.]+$/, '');
      const candidates = [`${wavBase}.wav.json`, `${audioPath}.json`];
      jsonOutputPath = candidates.find(p => fs.existsSync(p));
      if (!jsonOutputPath) {
        throw new Error(
          `whisper.cpp JSON output not found at any of: ${candidates.join(', ')}`,
        );
      }
      const chunks = this.parseWhisperJson(jsonOutputPath);

      const fileName = await this.cloudStorageService.uploadTranscript({ chunks }, jobId);
      const fileUrl = `https://storage.googleapis.com/${storageConfig.googleCloud.aiServerBucketName}/${fileName}`;

      return { status: TaskStatus.COMPLETED, fileName, fileUrl };
    } catch (err) {
      return {
        status: TaskStatus.FAILED,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
      if (jsonOutputPath) fs.rmSync(jsonOutputPath, { force: true });
    }
  }

  private async downloadTo(url: string, destPath: string): Promise<void> {
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
    fs.writeFileSync(destPath, Buffer.from(response.data));
  }

  /** whisper.cpp's `-oj` output: `{ transcription: [{ offsets: {from, to} (ms), text }] }`. */
  private parseWhisperJson(jsonPath: string): { timestamp: [number, number]; text: string }[] {
    const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const segments = Array.isArray(raw?.transcription) ? raw.transcription : [];
    return segments
      .map((seg: any) => ({
        timestamp: [
          (seg?.offsets?.from ?? 0) / 1000,
          (seg?.offsets?.to ?? 0) / 1000,
        ] as [number, number],
        text: typeof seg?.text === 'string' ? seg.text.trim() : '',
      }))
      .filter((chunk: { text: string }) => chunk.text.length > 0);
  }

  private async ensureFfmpegOnPath(): Promise<void> {
    if (this.ffmpegPathEnsured) return;
    this.ffmpegPathEnsured = true;

    const onPath = await new Promise<boolean>(resolve => {
      execFile('ffmpeg', ['-version'], err => resolve(!err));
    });
    if (onPath) return;

    // ffmpeg-static's own type declarations don't model its default CJS
    // export correctly for dynamic import() — it's a plain string at runtime.
    const ffmpegStatic = (await import('ffmpeg-static')).default as unknown as string | null;
    if (ffmpegStatic) {
      process.env.PATH = `${path.dirname(ffmpegStatic)}${path.delimiter}${process.env.PATH ?? ''}`;
    }
  }
}
