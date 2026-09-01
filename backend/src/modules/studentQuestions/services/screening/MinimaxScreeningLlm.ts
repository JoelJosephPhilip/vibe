import {screeningConfig} from '#root/config/screening.js';
import {ScreeningLlm, ScreeningLlmError, parseJsonObject} from './ScreeningLlm.js';

/**
 * MiniMax implementation (OpenAI-compatible chat completions).
 *
 * No documented `response_format: json_object` for MiniMax-M3, so this relies
 * on the prompts' "reply ONLY with JSON" instruction plus the shared defensive
 * `parseJsonObject` parser (same as the Anthropic implementation).
 * - Hard per-call timeout via AbortController (a hung provider must not hang a submission).
 * - Retries transient / 429 errors with linear backoff; gives up cleanly (caller fails-closed).
 */
export class MinimaxScreeningLlm implements ScreeningLlm {
  readonly provider = 'minimax';
  readonly model = screeningConfig.minimax.model;

  // Per-instance overrides for callers whose workload doesn't fit the shared
  // screening defaults -- e.g. a call whose expected output is a JSON array
  // that grows with input size, rather than the small fixed-shape object
  // every other caller of this class asks for. Defaults to the shared
  // screeningConfig values (below) so every existing zero-arg call site is
  // unaffected.
  constructor(private readonly overrides?: {timeoutMs?: number; maxRetries?: number}) {}

  async askJson(prompt: string): Promise<Record<string, unknown>> {
    const {apiKey, url, model} = screeningConfig.minimax;
    if (!apiKey) throw new ScreeningLlmError('MINIMAX_API_KEY not set');
    const timeoutMs = this.overrides?.timeoutMs ?? screeningConfig.timeoutMs;
    const maxRetries = this.overrides?.maxRetries ?? screeningConfig.maxRetries;

    const body = JSON.stringify({
      model,
      messages: [{role: 'user', content: prompt}],
      temperature: 0,
    });

    let lastErr: unknown;
    let backoff = 800;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json'},
          body,
          signal: controller.signal,
        });

        if (res.status === 429 || res.status >= 500) {
          throw new ScreeningLlmError(`minimax transient ${res.status}`);
        }
        if (!res.ok) {
          throw new ScreeningLlmError(`minimax error ${res.status}: ${(await res.text()).slice(0, 200)}`);
        }

        const json = (await res.json()) as any;
        const content: string = json?.choices?.[0]?.message?.content ?? '';
        return parseJsonObject(content);
      } catch (err) {
        lastErr = err;
        const isAbort = (err as Error)?.name === 'AbortError';
        const retriable = isAbort || err instanceof ScreeningLlmError;
        if (attempt === maxRetries || !retriable) break;
        await new Promise(r => setTimeout(r, backoff));
        backoff = Math.min(backoff + 800, 4000);
      } finally {
        clearTimeout(timer);
      }
    }
    throw new ScreeningLlmError(`minimax call failed after ${maxRetries + 1} attempt(s)`, lastErr);
  }
}
