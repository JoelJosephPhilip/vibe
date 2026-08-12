import {ContainerModule} from 'inversify';
import {DOUBT_TYPES} from './types.js';
import {DoubtRepository} from './repositories/providers/mongodb/DoubtRepository.js';
import {DoubtService} from './services/DoubtService.js';
import {DoubtController} from './controllers/DoubtController.js';

export const doubtsContainerModule = new ContainerModule(options => {
  // Repository
  options.bind(DoubtRepository).toSelf().inSingletonScope();
  options.bind(DOUBT_TYPES.DoubtRepo).to(DoubtRepository);

  // Service
  options.bind(DoubtService).toSelf().inSingletonScope();
  options.bind(DOUBT_TYPES.DoubtService).to(DoubtService);

  // Controller
  options.bind(DoubtController).toSelf().inSingletonScope();
});
