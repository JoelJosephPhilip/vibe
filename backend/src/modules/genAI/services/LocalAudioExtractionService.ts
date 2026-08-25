import { injectable, inject } from 'inversify';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ANOMALIES_TYPES } from '#root/modules/anomalies/types.js';
import { CloudStorageService } from '#root/modules/anomalies/index.js';
import { storageConfig } from '#root/config/storage.js';
import { aiConfig } from '#root/config/ai.js';
import { TaskStatus, audioData } from '../classes/transformers/GenAI.js';
import { getPythonEnv, getBgutilProviderServerHome } from '../utils/pythonInterpreter.js';
import { extractVideoKey } from '../utils/videoKey.js';

const execFileAsync = promisify(execFile);

/**
 * Local fallback for AUDIO_EXTRACTION, used when the external AI server is
 * unreachable (see GenAIService._callAiServerOrFallback). Downloads and
 * extracts the job's YouTube audio via yt-dlp (installed as a pip package —
 * chosen over a standalone prebuilt binary because those official releases
 * are built against glibc and won't run on this project's Alpine/musl
 * runtime image), then uploads it through the same
 * CloudStorageService.uploadAudio() a real user-uploaded-audio job would use.
 *
 * Before touching yt-dlp at all, tries fetching YouTube's own captions (see
 * scripts/fetch_captions.py) — most videos already have them, and that path
 * needs no audio download, no cookies, no PO-token, none of the bot-check
 * machinery below. When captions exist, this stage uploads the transcript
 * directly and reports itself COMPLETED without ever running yt-dlp;
 * LocalTranscriptionService checks for that pre-uploaded transcript and
 * skips its own download+whisper work in turn. Videos without captions fall
 * through to the yt-dlp path unchanged.
 */
@injectable()
export class LocalAudioExtractionService {
  constructor(
    @inject(ANOMALIES_TYPES.CloudStorageService)
    private readonly cloudStorageService: CloudStorageService,
  ) {}

  async extract(jobId: string, videoUrl: string): Promise<audioData> {
    const captionsResult = await this.tryFetchCaptions(jobId, videoUrl);
    if (captionsResult) {
      return captionsResult;
    }

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-fallback-'));
    const outputTemplate = path.join(workDir, 'audio.%(ext)s');

    try {
      // `python3 -m yt_dlp` rather than the bare `yt-dlp` console script:
      // that script's location (~/.local/bin, from pip's user install) isn't
      // reliably on PATH — confirmed live on Render (spawn yt-dlp ENOENT).
      // Invoking the module directly sidesteps PATH entirely for the script
      // itself. getPythonEnv() handles a second, separate issue confirmed
      // live on Render: pip's default install location depends on $HOME,
      // which differs between build and runtime there, so the package is
      // otherwise invisible to python3 even though it's the same interpreter.
      const args = [
        '-m', 'yt_dlp',
        '-x',
        '--audio-format', 'mp3',
        '--no-playlist',
        // Confirmed live on Render: having Deno on PATH (see
        // pythonInterpreter.ts) isn't enough on its own -- yt-dlp also
        // gates the actual JS-challenge-solver script it needs (a separate
        // "remote component", not the runtime itself) behind this explicit
        // opt-in, and skips it by default. Without it: "n challenge solving
        // failed" -> "the page needs to be reloaded".
        '--remote-components', 'ejs:github',
        // Space out our own requests -- this session's own rapid manual
        // retries during testing plausibly contributed to escalating
        // detection on top of the datacenter-IP problem itself.
        '--sleep-requests', '1',
        '-o', outputTemplate,
      ];
      // The web client's bot-check treats any cookie session used from a
      // datacenter IP as suspicious and rotates/kills it within minutes
      // (confirmed live: repeatedly, regardless of how fresh the cookies
      // were) -- cookies alone are not a durable fix at scale on Render.
      // The android/tv clients use a different, token-based auth flow that
      // doesn't hit that same check, so they work without cookies. BUT:
      // confirmed live -- yt-dlp itself skips the android client outright
      // whenever cookies are present ("Skipping client android since it
      // does not support cookies"), leaving only tv, which then failed with
      // "the page needs to be reloaded" even with remote-components and the
      // PO-token provider both active. So: only spoof the client when there
      // are no cookies to conflict with it; when cookies are configured,
      // let yt-dlp use its default client alongside them instead.
      if (!aiConfig.ytDlpCookiesFile) {
        args.push('--extractor-args', 'youtube:player_client=android,tv');
      }
      // Confirmed live: neither cookies nor client spoofing above reliably
      // avoid YouTube's bot-check on Render's datacenter IP -- a PO
      // (proof-of-origin) token is the remaining non-paid-proxy mitigation.
      // install-bgutil-provider.cjs installs yt-dlp's own recommended
      // provider in "script mode" (yt-dlp spawns this Node script itself
      // per call); pointing it at the fixed install dir instead of the
      // provider's own ~/bgutil-ytdlp-pot-provider default, same $HOME
      // reason as everywhere else in this file.
      const bgutilServerHome = getBgutilProviderServerHome();
      if (bgutilServerHome) {
        args.push('--extractor-args', `youtubepot-bgutilscript:server_home=${bgutilServerHome}`);
      }
      // Optional: see aiConfig.ytDlpCookiesFile for why (YouTube bot-check
      // on datacenter IPs). Left off by default — most deployments won't
      // set this, and yt-dlp works fine cookie-less until rate-limited.
      if (aiConfig.ytDlpCookiesFile) {
        // yt-dlp rewrites the cookies file in place after each run (to
        // persist any session cookies YouTube rotated). Render mounts
        // Secret Files read-only, so passing that path directly fails with
        // "OSError: [Errno 30] Read-only file system" -- confirmed live.
        // Copying it into the already-writable workDir sidesteps that.
        const cookiesCopy = path.join(workDir, 'cookies.txt');
        fs.copyFileSync(aiConfig.ytDlpCookiesFile, cookiesCopy);
        args.push('--cookies', cookiesCopy);
      }
      args.push(videoUrl);

      await execFileAsync(
        'python3',
        args,
        { timeout: 120000, env: getPythonEnv() },
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

  /**
   * Returns a COMPLETED audioData (with the transcript already uploaded) if
   * this video has captions, null if not (or on any failure — callers fall
   * through to the yt-dlp path unchanged). fileUrl/fileName below point at
   * the transcript, not an audio file — there is no audio file in this path,
   * and none of the pipeline's real output needs one (the final course video
   * item embeds the original YouTube URL directly, not a re-uploaded copy;
   * see GenAIService.ts's UPLOAD_CONTENT handling). They only need to be
   * truthy: getJobState()'s state-machine validation requires the completed
   * AUDIO_EXTRACTION record to carry a file URL before TRANSCRIPT_GENERATION
   * becomes reachable at all.
   */
  private async tryFetchCaptions(jobId: string, videoUrl: string): Promise<audioData | null> {
    const videoKey = extractVideoKey(videoUrl);
    if (!videoKey?.startsWith('yt:')) return null;
    const videoId = videoKey.slice(3);

    try {
      const { stdout } = await this.runFetchCaptionsScript(videoId);
      const result = JSON.parse(stdout);
      if (result.error || !Array.isArray(result.chunks) || result.chunks.length === 0) {
        return null;
      }

      const fileName = await this.cloudStorageService.uploadTranscript({ chunks: result.chunks }, jobId);
      const fileUrl = `https://storage.googleapis.com/${storageConfig.googleCloud.aiServerBucketName}/${fileName}`;
      return { status: TaskStatus.COMPLETED, fileName, fileUrl };
    } catch {
      return null;
    }
  }

  private runFetchCaptionsScript(videoId: string): Promise<{ stdout: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn('python3', ['scripts/fetch_captions.py'], {
        timeout: 30000,
        env: getPythonEnv(),
      });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });

      child.on('error', reject);
      child.on('close', code => {
        if (code !== 0) {
          reject(new Error(`fetch_captions.py exited with code ${code}: ${stderr.slice(0, 500)}`));
          return;
        }
        resolve({ stdout });
      });

      child.stdin.write(JSON.stringify({ videoId }));
      child.stdin.end();
    });
  }
}
