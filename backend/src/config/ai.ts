import { env } from '#root/utils/env.js';

export const aiConfig = {
    serverIP: env('AI_SERVER_IP') || 'localhost',
    serverPort: env('AI_SERVER_PORT') || 9017,
    proxyAddress: env('AI_PROXY_ADDRESS') || 'socks5h://localhost:1055',
    ANTHROPIC_CRED: env('ANTHROPIC_CRED') || null,
    ANTHROPIC_MODEL: env('ANTHROPIC_MODEL') || null,

    /**
     * Local fallback for TRANSCRIPT_GENERATION (whisper.cpp), QUESTION_GENERATION
     * (MiniMax), AUDIO_EXTRACTION (yt-dlp), and SEGMENTATION (embeddings + PELT
     * changepoint detection), used when the external AI server (private Tailscale
     * network, see WebhookService) is unreachable. See
     * GenAIService._callAiServerOrFallback.
     */
    localFallbackEnabled: (env('GENAI_LOCAL_FALLBACK_ENABLED') || 'true') !== 'false',
    /** Same model name used by backend/scripts/warmup-whisper.cjs at build time. */
    whisperModel: env('WHISPER_MODEL_NAME') || 'tiny.en',
    /** Relative to cwd — matches the Docker build's baked-in model location. */
    whisperModelPath: env('WHISPER_MODEL_PATH') || 'whisper-models',
    /**
     * Segmentation fallback's changepoint-detection penalty when the job
     * doesn't specify SegmentationParameters.lam. Confirmed live against a
     * real ~62min transcript (617 chunks, windowed -- see segment.py): 2.0
     * (the original, never-validated-against-real-data default) produced a
     * single degenerate segment for the whole video; 1.0 produced 17
     * segments averaging ~3.6min each, a genuinely reasonable course-section
     * granularity.
     */
    segmentationDefaultLambda: Number(env('GENAI_SEGMENTATION_DEFAULT_LAMBDA')) || 1.0,
    /**
     * Optional path to a Netscape-format cookies file for the AUDIO_EXTRACTION
     * fallback's yt-dlp calls (same file format `yt-dlp --cookies-from-browser`
     * exports, or a manually exported one). YouTube can rate-limit / bot-check
     * requests from datacenter IPs like Render's; passing cookies from a real
     * signed-in session is yt-dlp's own documented fix for that — see its
     * "Sign in to confirm you're not a bot" error. Unset by default: yt-dlp
     * runs cookie-less, same as before this option existed.
     */
    ytDlpCookiesFile: env('YT_DLP_COOKIES_FILE') || null,
};
