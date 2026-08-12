import {Container, ContainerModule} from 'inversify';
import {RoutingControllersOptions, useContainer} from 'routing-controllers';
import {sharedContainerModule} from '#root/container.js';
import {InversifyAdapter} from '#root/inversify-adapter.js';
import {authContainerModule} from '../auth/container.js';
import {doubtsContainerModule} from './container.js';
import {DoubtController} from './controllers/DoubtController.js';
import {
  CreateDoubtBody,
  CreateDoubtReplyBody,
  DoubtCourseListQuery,
  DoubtCoursePathParams,
  DoubtIdPathParams,
  DoubtItemPathParams,
  DoubtListQuery,
  DoubtListResponse,
  DoubtReplyResponse,
  DoubtResponse,
  UpdateDoubtHiddenBody,
  UpdateDoubtStatusBody,
} from './classes/validators/DoubtValidator.js';

export const doubtsContainerModules: ContainerModule[] = [
  doubtsContainerModule,
  sharedContainerModule,
  authContainerModule,
];

export const doubtsModuleControllers: Function[] = [DoubtController];

export async function setupDoubtsContainer(): Promise<void> {
  const container = new Container();
  await container.load(...doubtsContainerModules);
  const inversifyAdapter = new InversifyAdapter(container);
  useContainer(inversifyAdapter);
}

export const doubtsModuleOptions: RoutingControllersOptions = {
  controllers: doubtsModuleControllers,
  middlewares: [],
  defaultErrorHandler: true,
  authorizationChecker: async function () {
    return true;
  },
  validation: true,
};

export const doubtsModuleValidators: Function[] = [
  CreateDoubtBody,
  CreateDoubtReplyBody,
  DoubtCourseListQuery,
  DoubtCoursePathParams,
  DoubtIdPathParams,
  DoubtItemPathParams,
  DoubtListQuery,
  DoubtListResponse,
  DoubtReplyResponse,
  DoubtResponse,
  UpdateDoubtHiddenBody,
  UpdateDoubtStatusBody,
];

export * from './classes/index.js';
export * from './controllers/index.js';
export * from './services/index.js';
export * from './repositories/index.js';
export * from './abilities/index.js';
export * from './types.js';
export * from './container.js';
