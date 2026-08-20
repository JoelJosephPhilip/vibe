import { env } from '#root/utils/env.js';

export const aiConfig = {
    serverIP: env('AI_SERVER_IP') || 'localhost',
    serverPort: env('AI_SERVER_PORT') || 9017,
    proxyAddress: env('AI_PROXY_ADDRESS') || 'socks5h://localhost:1055',
    ANTHROPIC_CRED: env('ANTHROPIC_CRED') || null,
    ANTHROPIC_MODEL: env('ANTHROPIC_MODEL') || null,

    /**
     * Local fallback for TRANSCRIPT_GENERATION (whisper.cpp) and
     * QUESTION_GENERATION (MiniMax), used when the external AI server
     * (private Tailscale network, see WebhookService) is unreachable.
     * AUDIO_EXTRACTION and SEGMENTATION have no local fallback — see
     * GenAIService._callAiServerOrFallback.
     */
    localFallbackEnabled: (env('GENAI_LOCAL_FALLBACK_ENABLED') || 'true') !== 'false',
    /** Same model name used by backend/scripts/warmup-whisper.cjs at build time. */
    whisperModel: env('WHISPER_MODEL_NAME') || 'tiny.en',
    /** Relative to cwd — matches the Docker build's baked-in model location. */
    whisperModelPath: env('WHISPER_MODEL_PATH') || 'whisper-models',
};
