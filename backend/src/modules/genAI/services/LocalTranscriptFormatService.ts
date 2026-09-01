import { injectable } from 'inversify';
import { MinimaxScreeningLlm } from '#root/modules/studentQuestions/services/screening/MinimaxScreeningLlm.js';

export interface FormattedChunk {
  timestamp: number[];
  text: string;
}

export interface ConvertToChunksResult {
  chunks: FormattedChunk[];
}

// Confirmed live: a window this size regularly took MiniMax past the 9s
// screening timeout on every one of its 3 attempts (~30s total before the
// whole conversion failed). Response time is governed by output size, not
// input size, and a dense window can need to echo back a lot of chunks --
// smaller windows means less to generate per call, not just less to read.
const WINDOW_CHARS = 1200;

const CONVERT_PROMPT = (windowText: string) => `The text below is one portion of a longer transcript. Each spoken block is preceded by its own timestamp line, in mm:ss or h:mm:ss format (e.g. "12:34" or "1:02:15"). Convert it into chunks, one per timestamped block, giving each chunk's start and end time in seconds as a two-element array. If a block's end time isn't clear from the next timestamp, estimate it reasonably. Reply ONLY with one JSON object, no prose, no markdown fences.

Transcript portion:
"""
${windowText}
"""

Reply with exactly this shape:
{"chunks": [{"timestamp": [start, end], "text": "..."}, ...]}`;

const TIMESTAMP_LINE = /^\d{1,2}:\d{2}(?::\d{2})?\s*$/;

// One entry per timestamped block (from one timestamp line up to, but not
// including, the next). The required format has no blank lines between
// blocks -- just a single newline -- so splitting on blank lines (as an
// earlier version of this function did) essentially never found one and
// fell through to a hard character cut, handing MiniMax windows truncated
// mid-sentence. Splitting on the timestamp lines actually present in the
// format is what genuinely guarantees a block is never divided.
function splitIntoBlocks(rawText: string): string[] {
  const lines = rawText.split('\n');
  const starts: number[] = [];
  lines.forEach((line, i) => {
    if (TIMESTAMP_LINE.test(line.trim())) starts.push(i);
  });
  if (starts.length === 0) return [rawText];
  return starts.map((from, i) => {
    const to = i + 1 < starts.length ? starts[i + 1] : lines.length;
    return lines.slice(from, to).join('\n');
  });
}

// A real transcript's timestamps mark where the speaker pauses, not a fixed
// cadence -- a host talking for minutes straight before the next mark
// produces one block far bigger than windowChars on its own. The packer
// below only ever combines whole blocks, so an oversized block used to ride
// through as its own giant window every single retry, failing the exact
// same way each time (confirmed live: a request that retried this window 9
// times over 344s still ended in the same 500). Splitting the block itself
// at word boundaries -- each piece re-prefixed with its original timestamp
// line so it still matches the "timestamp line, then text" shape the prompt
// expects -- is what actually bounds every window's size regardless of how
// the source transcript happens to be punctuated with timestamps.
function splitOversizedBlock(block: string, windowChars: number): string[] {
  const newlineIdx = block.indexOf('\n');
  const timestampLine = newlineIdx === -1 ? '' : block.slice(0, newlineIdx);
  const body = newlineIdx === -1 ? block : block.slice(newlineIdx + 1);
  const bodyBudget = Math.max(windowChars - timestampLine.length - 1, 200);

  const words = body.split(/\s+/).filter(Boolean);
  const pieces: string[] = [];
  let current = '';
  for (const word of words) {
    if (current && current.length + 1 + word.length > bodyBudget) {
      pieces.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) pieces.push(current);

  return pieces.map(piece => (timestampLine ? `${timestampLine}\n${piece}` : piece));
}

function splitIntoWindows(rawText: string, windowChars: number): string[] {
  const blocks = splitIntoBlocks(rawText).flatMap(block =>
    block.length > windowChars ? splitOversizedBlock(block, windowChars) : [block],
  );
  const windows: string[] = [];
  let current: string[] = [];
  let currentLen = 0;
  for (const block of blocks) {
    if (current.length > 0 && currentLen + block.length > windowChars) {
      windows.push(current.join('\n').trim());
      current = [];
      currentLen = 0;
    }
    current.push(block);
    currentLen += block.length;
  }
  if (current.length > 0) windows.push(current.join('\n').trim());
  return windows.filter(w => w.length > 0);
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// A long real transcript needs many sequential windows, and each window
// already gets 3 attempts of its own inside MinimaxScreeningLlm (~30s worth
// of internal retries). Confirmed live: even with small windows, a run of
// 20+ windows occasionally has ONE window exhaust all 3 of those internal
// attempts anyway (transient provider slowness, not a sizing problem) --
// which used to abort the entire conversion and throw away every window
// that had already succeeded. A few more outer attempts, spaced further
// apart than the internal backoff ever gets, absorbs that without touching
// MinimaxScreeningLlm's shared retry/timeout config (used by other features
// too).
const OUTER_ATTEMPTS = 3;
const OUTER_RETRY_DELAY_MS = 5000;

// Second-chance pass for windows that are still failed after the main pass's
// own retries. Deliberately more patient (more attempts, longer spacing)
// than the main pass, and run at low concurrency afterward rather than
// competing with WINDOW_CONCURRENCY other in-flight calls for the same
// window's own retry slots -- a window that failed once, in a burst of
// hundreds of other simultaneous requests, gets dedicated attention here
// instead of the same crowded conditions that likely contributed to the
// first failure.
const RECOVERY_ATTEMPTS = 4;
const RECOVERY_RETRY_DELAY_MS = 8000;
const RECOVERY_CONCURRENCY = 2;

// Confirmed live: a 62-minute transcript needed ~586 chunks across hundreds
// of windows and took 39 minutes run strictly one-at-a-time -- a 3+ hour
// course transcript would scale past that linearly. Windows are independent
// (each is a self-contained portion of the prompt, no shared state --
// MinimaxScreeningLlm.askJson carries no mutable instance state either, so
// concurrent calls on the same instance are safe), so there's no correctness
// reason to serialize them.
//
// Confirmed live at 8: a run that failed only 3/67 windows the first time
// failed 13+/67 the next, scattered essentially at random across the whole
// transcript rather than clustered in one bad spot -- the signature of
// self-inflicted throttling, not a content problem. Since a persistently
// stuck window now aborts the whole conversion (see convertToChunks) rather
// than being silently skipped, a higher failure rate is no longer just a
// quality tradeoff, it's a reliability one. Dropped to 3: still faster than
// fully sequential, far less likely to overwhelm the provider than 8 was.
const WINDOW_CONCURRENCY = 3;

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) {
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
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

  private async askJsonWithRetry(
    prompt: string,
    attempts: number = OUTER_ATTEMPTS,
    delayMs: number = OUTER_RETRY_DELAY_MS,
  ): Promise<Record<string, unknown>> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.llm.askJson(prompt);
      } catch (err) {
        if (attempt >= attempts) throw err;
        await sleep(delayMs);
      }
    }
  }

  private async convertWindow(
    windowText: string,
    windowNumber: number,
    totalWindows: number,
    attempts: number,
    delayMs: number,
  ): Promise<FormattedChunk[]> {
    const verdict = await this.askJsonWithRetry(CONVERT_PROMPT(windowText), attempts, delayMs);
    const rawChunks = verdict.chunks;
    if (!Array.isArray(rawChunks)) {
      throw new Error(`MiniMax did not return a chunks array for transcript window ${windowNumber}/${totalWindows}`);
    }
    const chunks: FormattedChunk[] = [];
    for (const c of rawChunks) {
      const timestamp = (c as any)?.timestamp;
      const text = (c as any)?.text;
      if (
        !Array.isArray(timestamp) ||
        typeof timestamp[0] !== 'number' ||
        typeof text !== 'string' ||
        !text.trim()
      ) {
        throw new Error(`MiniMax returned a malformed chunk in transcript window ${windowNumber}/${totalWindows}`);
      }
      chunks.push({ timestamp, text: text.trim() });
    }
    return chunks;
  }

  async convertToChunks(rawText: string): Promise<ConvertToChunksResult> {
    const windows = splitIntoWindows(rawText, WINDOW_CHARS);

    // Main pass: every window gets its own retry budget, WINDOW_CONCURRENCY
    // at a time. A window that's still failed after this either recovers in
    // the dedicated second pass below, or the whole conversion fails loudly
    // -- no content is ever silently dropped.
    const firstPass = await mapWithConcurrency(windows, WINDOW_CONCURRENCY, async (windowText, i) => {
      try {
        return { chunks: await this.convertWindow(windowText, i + 1, windows.length, OUTER_ATTEMPTS, OUTER_RETRY_DELAY_MS) };
      } catch (err) {
        console.error(
          `[LocalTranscriptFormatService] window ${i + 1}/${windows.length} failed on the main pass, will retry:`,
          err,
        );
        return { failed: true as const };
      }
    });

    const failedIndices = firstPass
      .map((outcome, i) => ('failed' in outcome ? i : -1))
      .filter(i => i !== -1);

    const recovered = new Map<number, FormattedChunk[]>();
    if (failedIndices.length > 0) {
      const recoveryResults = await mapWithConcurrency(failedIndices, RECOVERY_CONCURRENCY, async i => {
        try {
          return await this.convertWindow(windows[i], i + 1, windows.length, RECOVERY_ATTEMPTS, RECOVERY_RETRY_DELAY_MS);
        } catch (err) {
          const timestampLine = windows[i].split('\n')[0]?.trim();
          throw new Error(
            `Could not convert the transcript portion starting at ${timestampLine || `window ${i + 1}/${windows.length}`} ` +
              `after extensive retries. Try converting again, or check that part of the transcript for unusual formatting: ` +
              `${err instanceof Error ? err.message : String(err)}`,
          );
        }
      });
      failedIndices.forEach((i, idx) => recovered.set(i, recoveryResults[idx]));
    }

    const allChunks = firstPass.flatMap((outcome, i) => ('failed' in outcome ? recovered.get(i)! : outcome.chunks));

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
