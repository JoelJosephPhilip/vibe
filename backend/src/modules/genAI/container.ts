import { ContainerModule } from 'inversify';
import { GENAI_TYPES } from './types.js';
import { GenAIService } from './services/GenAIService.js';
import { WebhookService } from './services/WebhookService.js';
import { GenAIController } from './controllers/GenAIController.js';
import { WebhookController } from './controllers/WebhookController.js';
import { GenAIRepository } from './repositories/providers/mongodb/GenAIRepository.js';
import { SseService } from './services/sseService.js';
import { LocalTranscriptionService } from './services/LocalTranscriptionService.js';
import { LocalQuestionGenerationService } from './services/LocalQuestionGenerationService.js';
import { LocalAudioExtractionService } from './services/LocalAudioExtractionService.js';
import { LocalSegmentationService } from './services/LocalSegmentationService.js';

export const genAIContainerModule = new ContainerModule(options => {
  // Repositories
  options.bind(GENAI_TYPES.GenAIRepository).to(GenAIRepository);
  // Services
  options.bind(GENAI_TYPES.GenAIService).to(GenAIService).inSingletonScope();
  options.bind(GENAI_TYPES.WebhookService).to(WebhookService).inSingletonScope();
  options.bind(GENAI_TYPES.SseService).to(SseService).inSingletonScope();
  options.bind(GENAI_TYPES.LocalTranscriptionService).to(LocalTranscriptionService).inSingletonScope();
  options.bind(GENAI_TYPES.LocalQuestionGenerationService).to(LocalQuestionGenerationService).inSingletonScope();
  options.bind(GENAI_TYPES.LocalAudioExtractionService).to(LocalAudioExtractionService).inSingletonScope();
  options.bind(GENAI_TYPES.LocalSegmentationService).to(LocalSegmentationService).inSingletonScope();
  // Controllers
  options.bind(GenAIController).toSelf().inSingletonScope();
  options.bind(WebhookController).toSelf().inSingletonScope();
});
