import { injectable } from 'inversify';
import { spawn } from 'child_process';
import { aiConfig } from '#root/config/ai.js';
import { SegmentationParameters, TaskStatus, segmentationData } from '../classes/transformers/GenAI.js';

interface TranscriptChunk {
  start: number;
  end: number | null;
  text: string;
}

/**
 * Local fallback for SEGMENTATION, used when the external AI server is
 * unreachable (see GenAIService._callAiServerOrFallback). Shells out to
 * backend/scripts/segment.py (TF-IDF vectors + PELT changepoint detection —
 * see that file for why TF-IDF rather than a BERT-family embedding model) —
 * kept in Python since the mature, well-established changepoint-detection
 * tooling (ruptures) is Python-only; there's no equivalent maturity in the
 * Node ecosystem worth trusting for this.
 */
@injectable()
export class LocalSegmentationService {
  async segment(
    transcriptChunks: TranscriptChunk[],
    params: SegmentationParameters,
  ): Promise<segmentationData> {
    const payload = JSON.stringify({
      chunks: transcriptChunks,
      lam: params.lam ?? aiConfig.segmentationDefaultLambda,
      runs: params.runs,
      noiseId: params.noiseId,
    });

    try {
      const {stdout} = await this.runScript(payload);
      const result = JSON.parse(stdout);
      if (result.error) {
        return {status: TaskStatus.FAILED, error: result.error, segmentationMap: []};
      }
      return {
        status: TaskStatus.COMPLETED,
        segmentationMap: Array.isArray(result.segmentationMap) ? result.segmentationMap : [],
      };
    } catch (err) {
      return {
        status: TaskStatus.FAILED,
        error: err instanceof Error ? err.message : String(err),
        segmentationMap: [],
      };
    }
  }

  private runScript(stdinPayload: string): Promise<{stdout: string}> {
    return new Promise((resolve, reject) => {
      const child = spawn('python3', ['scripts/segment.py'], {
        timeout: 120000,
      });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });

      child.on('error', reject);
      child.on('close', code => {
        if (code !== 0) {
          reject(new Error(`segment.py exited with code ${code}: ${stderr.slice(0, 500)}`));
          return;
        }
        resolve({stdout});
      });

      child.stdin.write(stdinPayload);
      child.stdin.end();
    });
  }
}
