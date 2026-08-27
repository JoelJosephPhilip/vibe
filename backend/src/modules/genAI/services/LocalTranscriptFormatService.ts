import { injectable } from 'inversify';
import { MinimaxScreeningLlm } from '#root/modules/studentQuestions/services/screening/MinimaxScreeningLlm.js';

export interface FormattedChunk {
  timestamp: number[];
  text: string;
}

// Kept well under screeningConfig.timeoutMs (9s default) per call, rather
// than raising that shared timeout for every other screening use in the app
// -- mirrors LocalCoursePlanService's one-call-per-segment approach instead
// of one huge call for the whole transcript.
const WINDOW_CHARS = 3500;

const CONVERT_PROMPT = (windowText: string) => `The text below is one portion of a longer transcript. Each spoken block is preceded by its own timestamp line, in mm:ss or h:mm:ss format (e.g. "12:34" or "1:02:15"). Convert it into chunks, one per timestamped block, giving each chunk's start and end time in seconds as a two-element array. If a block's end time isn't clear from the next timestamp, estimate it reasonably. Reply ONLY with one JSON object, no prose, no markdown fences.

Transcript portion:
"""
${windowText}
"""

Reply with exactly this shape:
{"chunks": [{"timestamp": [start, end], "text": "..."}, ...]}`;

// Splits on the blank line nearest the target window size, rather than a
// hard character cut, so a timestamped block is never split across two
// windows and handed to the LLM half-formed.
function splitIntoWindows(rawText: string, windowChars: number): string[] {
  const windows: string[] = [];
  let start = 0;
  while (start < rawText.length) {
    let end = Math.min(start + windowChars, rawText.length);
    if (end < rawText.length) {
      const blankLine = rawText.lastIndexOf('\n\n', end);
      if (blankLine > start) end = blankLine;
    }
    windows.push(rawText.slice(start, end).trim());
    start = end;
  }
  return windows.filter(w => w.length > 0);
}

/**
 * Converts a raw, mm:ss/h:mm:ss-timestamped plain-text transcript (the
 * format a teacher would paste from a YouTube transcript export or similar)
 * into the pipeline's required {chunks: [{timestamp, text}]} shape, via the
 * same MinimaxScreeningLlm provider LocalCoursePlanService/
 * LocalQuestionGenerationService already use.
 */
@injectable()
export class LocalTranscriptFormatService {
  private readonly llm = new MinimaxScreeningLlm();

  async convertToChunks(rawText: string): Promise<{ chunks: FormattedChunk[] }> {
    const windows = splitIntoWindows(rawText, WINDOW_CHARS);
    const allChunks: FormattedChunk[] = [];

    for (let i = 0; i < windows.length; i++) {
      const verdict = await this.llm.askJson(CONVERT_PROMPT(windows[i]));
      const rawChunks = verdict.chunks;
      if (!Array.isArray(rawChunks)) {
        throw new Error(
          `MiniMax did not return a chunks array for transcript window ${i + 1}/${windows.length}`,
        );
      }
      for (const c of rawChunks) {
        const timestamp = (c as any)?.timestamp;
        const text = (c as any)?.text;
        if (
          !Array.isArray(timestamp) ||
          typeof timestamp[0] !== 'number' ||
          typeof text !== 'string' ||
          !text.trim()
        ) {
          throw new Error(
            `MiniMax returned a malformed chunk in transcript window ${i + 1}/${windows.length}`,
          );
        }
        allChunks.push({ timestamp, text: text.trim() });
      }
    }

    allChunks.sort((a, b) => a.timestamp[0] - b.timestamp[0]);

    // Chunk.timestamp's validator rejects `null` outright -- only the true
    // last chunk (of the whole transcript, not each window) may be
    // open-ended, and it signals that by omitting the second element
    // entirely rather than setting it to null. A chunk missing a usable end
    // (rare -- the prompt asks MiniMax to estimate one) falls back to the
    // next chunk's start, the same "runs until the next one begins"
    // inference a human would make.
    return {
      chunks: allChunks.map((c, i) => {
        const isLast = i === allChunks.length - 1;
        const hasEnd = typeof c.timestamp[1] === 'number' && c.timestamp[1] > c.timestamp[0];
        if (hasEnd) return { timestamp: [c.timestamp[0], c.timestamp[1]], text: c.text };
        if (isLast) return { timestamp: [c.timestamp[0]], text: c.text };
        return { timestamp: [c.timestamp[0], allChunks[i + 1].timestamp[0]], text: c.text };
      }),
    };
  }
}
