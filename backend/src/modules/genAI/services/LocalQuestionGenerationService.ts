import { injectable, inject } from 'inversify';
import { MinimaxScreeningLlm } from '#root/modules/studentQuestions/services/screening/MinimaxScreeningLlm.js';
import { ANOMALIES_TYPES } from '#root/modules/anomalies/types.js';
import { CloudStorageService } from '#root/modules/anomalies/index.js';
import { storageConfig } from '#root/config/storage.js';
import { QuestionGenerationParameters, questionGenerationData, TaskStatus } from '../classes/transformers/GenAI.js';

interface TranscriptChunk {
  timestamp: [number, number | null];
  text: string;
}

/**
 * segmentMap entries are each segment's END time in seconds (see
 * GenAIService.ts's uploadContent loop — `currentSegmentEndTime =
 * currentSegmentId`), in ascending order. A chunk belongs to the first
 * segment whose end time is after the chunk's start time.
 *
 * Exported (not just used by question generation) so LocalCoursePlanService
 * can group the same transcript by the same segment boundaries when
 * generating per-section titles/descriptions.
 */
export function groupChunksBySegment(
  chunks: TranscriptChunk[],
  segmentMap: number[],
): { segmentId: string; text: string }[] {
  return segmentMap.map((endTime, i) => {
    const startTime = i === 0 ? 0 : segmentMap[i - 1];
    const text = chunks
      .filter(c => c.timestamp[0] >= startTime && c.timestamp[0] < endTime)
      .map(c => c.text)
      .join(' ')
      .trim();
    return { segmentId: String(endTime), text };
  });
}

/**
 * Matches the exact `{segmentId, question, solution}` shape
 * GenAIService.uploadContent already expects from the real AI server's
 * question-generation output (feeds straight into
 * QuestionFactory.createQuestion, no conversion needed on that side).
 */
interface GeneratedQuestionItem {
  segmentId: string;
  question: {
    text: string;
    type: 'SELECT_ONE_IN_LOT';
    isParameterized: false;
    timeLimitSeconds: number;
    priority: 'LOW';
    points: number;
    source: 'AI_GENERATED';
  };
  solution: {
    correctLotItem: { text: string; explaination: string };
    incorrectLotItems: { text: string; explaination: string }[];
  };
}

const QUESTION_PROMPT = (segmentText: string) => `You are writing a single multiple-choice quiz question testing understanding of the lesson segment below. Reply ONLY with one JSON object, no prose, no markdown fences.

Lesson segment:
"""
${segmentText}
"""

Requirements:
- The question must be answerable from the segment content alone.
- Exactly 4 options, plausible, only one correct.
- Options must be distinct from each other and from the question text.

Reply with exactly this shape:
{"question": "<question text>", "options": ["<a>", "<b>", "<c>", "<d>"], "correctIndex": <0-3>}`;

/**
 * Local fallback for QUESTION_GENERATION, used when the external AI server
 * is unreachable (see GenAIService._callAiServerOrFallback) — directly
 * analogous to the crowd-question screening pipeline
 * (studentQuestions/services/screening/), reusing the same MinimaxScreeningLlm
 * provider and MINIMAX_API_KEY.
 *
 * Scope: single-answer MCQs (SELECT_ONE_IN_LOT / `SOL`) only. The external AI
 * server also supports SML/NAT/DES/BIN question types and a Bloom-level
 * distribution — reproducing all of that via prompting was out of scope here;
 * a job requesting those other counts still only gets SOL questions back
 * (logged once per generate() call so it's visible, not silently dropped).
 */
@injectable()
export class LocalQuestionGenerationService {
  private readonly llm = new MinimaxScreeningLlm();

  constructor(
    @inject(ANOMALIES_TYPES.CloudStorageService)
    private readonly cloudStorageService: CloudStorageService,
  ) {}

  async generate(
    jobId: string,
    transcriptChunks: TranscriptChunk[],
    segmentMap: number[],
    params: QuestionGenerationParameters,
  ): Promise<questionGenerationData> {
    try {
      const items = await this.generateItems(transcriptChunks, segmentMap, params);
      const fileName = await this.cloudStorageService.uploadQuestions(items, jobId);
      const fileUrl = `https://storage.googleapis.com/${storageConfig.googleCloud.aiServerBucketName}/${fileName}`;
      return { status: TaskStatus.COMPLETED, fileName, fileUrl, segmentMapUsed: segmentMap };
    } catch (err) {
      return {
        status: TaskStatus.FAILED,
        error: err instanceof Error ? err.message : String(err),
        segmentMapUsed: segmentMap,
      };
    }
  }

  private async generateItems(
    transcriptChunks: TranscriptChunk[],
    segmentMap: number[],
    params: QuestionGenerationParameters,
  ): Promise<GeneratedQuestionItem[]> {
    const requestedCount = params.SOL ?? segmentMap.length;
    if (params.SML || params.NAT || params.DES || params.BIN) {
      console.warn(
        '[LocalQuestionGenerationService] SML/NAT/DES/BIN requested but the local fallback only generates SOL (single-answer MCQ) questions.',
      );
    }

    const segments = groupChunksBySegment(transcriptChunks, segmentMap);
    const withText = segments.filter(s => s.text.trim().length > 0);
    if (withText.length === 0 || requestedCount <= 0) return [];

    const perSegment = Math.max(1, Math.ceil(requestedCount / withText.length));
    const results: GeneratedQuestionItem[] = [];

    for (const segment of withText) {
      if (results.length >= requestedCount) break;
      const toGenerate = Math.min(perSegment, requestedCount - results.length);
      for (let i = 0; i < toGenerate; i++) {
        try {
          results.push(await this.generateOneQuestion(segment.text, segment.segmentId));
        } catch (err) {
          // Best-effort: one bad segment/LLM response shouldn't abort the whole job.
          console.warn(
            `[LocalQuestionGenerationService] Failed to generate a question for segment ${segment.segmentId}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    }
    return results;
  }

  private async generateOneQuestion(
    segmentText: string,
    segmentId: string,
  ): Promise<GeneratedQuestionItem> {
    const verdict = await this.llm.askJson(QUESTION_PROMPT(segmentText));
    const text = typeof verdict.question === 'string' ? verdict.question.trim() : '';
    const options = Array.isArray(verdict.options) ? verdict.options.map(String) : [];
    const correctIndex = Number(verdict.correctIndex);

    if (!text || options.length < 2 || !Number.isInteger(correctIndex) ||
        correctIndex < 0 || correctIndex >= options.length) {
      throw new Error('LLM returned an invalid question shape');
    }

    return {
      segmentId,
      question: {
        text,
        type: 'SELECT_ONE_IN_LOT',
        isParameterized: false,
        timeLimitSeconds: 60,
        priority: 'LOW',
        points: 10,
        source: 'AI_GENERATED',
      },
      solution: {
        correctLotItem: { text: options[correctIndex], explaination: '' },
        incorrectLotItems: options
          .filter((_, i) => i !== correctIndex)
          .map(optionText => ({ text: optionText, explaination: '' })),
      },
    };
  }
}
