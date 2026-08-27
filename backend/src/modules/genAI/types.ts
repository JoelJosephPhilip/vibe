const TYPES = {
  GenAIRepository: Symbol.for('GenAIRepository'),
  GenAIService: Symbol.for('GenAIService'),
  WebhookService: Symbol.for('WebhookService'),
  SseService: Symbol.for('SseService'),
  LocalTranscriptionService: Symbol.for('LocalTranscriptionService'),
  LocalQuestionGenerationService: Symbol.for('LocalQuestionGenerationService'),
  LocalAudioExtractionService: Symbol.for('LocalAudioExtractionService'),
  LocalSegmentationService: Symbol.for('LocalSegmentationService'),
  LocalCoursePlanService: Symbol.for('LocalCoursePlanService'),
  LocalTranscriptFormatService: Symbol.for('LocalTranscriptFormatService'),
};

export { TYPES as GENAI_TYPES };