import { ContainerModule } from 'inversify';
import { EXAMS_TYPES } from './types.js';
import { ExamRepository } from './repositories/providers/mongodb/ExamRepository.js';
import { AttemptRepository } from './repositories/providers/mongodb/AttemptRepository.js';
import { ExamService } from './services/ExamService.js';
import { AttemptService } from './services/AttemptService.js';
import { ExamController } from './controllers/ExamController.js';
import { AttemptController } from './controllers/AttemptController.js';

export const examsContainerModule = new ContainerModule(options => {
    // Repositories
    options.bind(EXAMS_TYPES.ExamRepo).to(ExamRepository).inSingletonScope();
    options.bind(EXAMS_TYPES.AttemptRepo).to(AttemptRepository).inSingletonScope();

    // Services
    options.bind(EXAMS_TYPES.ExamService).to(ExamService).inSingletonScope();
    options.bind(EXAMS_TYPES.AttemptService).to(AttemptService).inSingletonScope();

    // Controllers
    options.bind(ExamController).toSelf().inSingletonScope();
    options.bind(AttemptController).toSelf().inSingletonScope();
});
