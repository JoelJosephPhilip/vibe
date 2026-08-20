const TYPES = {
  GenAIRepository: Symbol.for('GenAIRepository'),
  GenAIService: Symbol.for('GenAIService'),
  WebhookService: Symbol.for('WebhookService'),
  SseService: Symbol.for('SseService'),
  LocalTranscriptionService: Symbol.for('LocalTranscriptionService'),
  LocalQuestionGenerationService: Symbol.for('LocalQuestionGenerationService'),
};

export { TYPES as GENAI_TYPES };