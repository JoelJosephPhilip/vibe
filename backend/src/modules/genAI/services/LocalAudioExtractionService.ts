import { injectable, inject } from 'inversify';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ANOMALIES_TYPES } from '#root/modules/anomalies/types.js';
import { CloudStorageService } from '#root/modules/anomalies/index.js';
import { storageConfig } from '#root/config/storage.js';
import { TaskStatus, audioData } from '../classes/transformers/GenAI.js';
import { getPythonInterpreter } from '../utils/pythonInterpreter.js';

const execFileAsync = promisify(execFile);

/**
 * Local fallback for AUDIO_EXTRACTION, used when the external AI server is
 * unreachable (see GenAIService._callAiServerOrFallback). Downloads and
 * extracts the job's YouTube audio via yt-dlp (installed as a pip package —
 * chosen over a standalone prebuilt binary because those official releases
 * are built against glibc and won't run on this project's Alpine/musl
 * runtime image), then uploads it through the same
 * CloudStorageService.uploadAudio() a real user-uploaded-audio job would use.
 */
@injectable()
export class LocalAudioExtractionService {
  constructor(
    @inject(ANOMALIES_TYPES.CloudStorageService)
    private readonly cloudStorageService: CloudStorageService,
  ) {}

  async extract(jobId: string, videoUrl: string): Promise<audioData> {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-fallback-'));
    const outputTemplate = path.join(workDir, 'audio.%(ext)s');

    try {
      // `python3 -m yt_dlp` rather than the bare `yt-dlp` console script:
      // pip install --break-system-packages (no venv, not root) puts that
      // script under ~/.local/bin, which pip itself warns isn't on PATH —
      // confirmed live on Render (spawn yt-dlp ENOENT). Invoking the module
      // directly sidesteps PATH entirely for the script itself. getPythonInterpreter()
      // additionally handles a second, separate issue confirmed live on
      // Render: a bare 'python3' at runtime resolves to a *different*
      // interpreter than the one pip actually installed packages into.
      await execFileAsync(
        getPythonInterpreter(),
        [
          '-m', 'yt_dlp',
          '-x',
          '--audio-format', 'mp3',
          '--no-playlist',
          '-o', outputTemplate,
          videoUrl,
        ],
        { timeout: 120000 },
      );

      const audioPath = path.join(workDir, 'audio.mp3');
      if (!fs.existsSync(audioPath)) {
        throw new Error(`yt-dlp did not produce the expected output at ${audioPath}`);
      }
      const buffer = fs.readFileSync(audioPath);

      // uploadAudio only reads .buffer/.mimetype off its Multer.File
      // parameter — constructing just those two fields avoids adding a
      // second upload method for a shape Multer already covers.
      const fileName = await this.cloudStorageService.uploadAudio(
        { buffer, mimetype: 'audio/mp3' } as Express.Multer.File,
        jobId,
      );
      const fileUrl = `https://storage.googleapis.com/${storageConfig.googleCloud.aiServerBucketName}/${fileName}`;

      return { status: TaskStatus.COMPLETED, fileName, fileUrl };
    } catch (err) {
      return {
        status: TaskStatus.FAILED,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }
}
