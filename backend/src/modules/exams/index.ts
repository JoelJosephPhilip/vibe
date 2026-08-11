import { Container, ContainerModule } from 'inversify';
import { sharedContainerModule } from '#root/container.js';
import { InversifyAdapter } from '#root/inversify-adapter.js';
import {
    RoutingControllersOptions,
    useContainer,
} from 'routing-controllers';
import { ExamController } from './controllers/ExamController.js';
import { AttemptController } from './controllers/AttemptController.js';
import { examsContainerModule } from './container.js';
import {
    ExamIdParams,
    QuestionIdParams,
    TimeGrantIdParams,
    CreateExamBody,
    UpdateExamBody,
    AddQuestionBody,
    UpdateQuestionBody,
    AddTimeGrantBody,
    RedeemGrantBody,
    AttemptIdParams,
    SubmitAttemptBody,
} from './classes/validators/index.js';

// AttemptController listed first: its two-segment `/attempts/mine` and
// `/attempts/:attemptId` routes are already disambiguated from
// ExamController's single-segment `/:examId` by Express's exact
// segment-count matching (see the comment atop AttemptController.ts), so
// order here doesn't change behavior — kept for readability only.
export const examsModuleControllers: Function[] = [
    AttemptController,
    ExamController,
];

export const examsContainerModules: ContainerModule[] = [
    examsContainerModule,
    sharedContainerModule,
];

export async function setupExamsContainer(): Promise<void> {
    const container = new Container();
    await container.load(...examsContainerModules);
    const inversifyAdapter = new InversifyAdapter(container);
    useContainer(inversifyAdapter);
}

export const examsModuleOptions: RoutingControllersOptions = {
    controllers: examsModuleControllers,
    middlewares: [],
    defaultErrorHandler: true,
    authorizationChecker: async function () {
        return true;
    },
    validation: true,
};

export const examsModuleValidators: Function[] = [
    ExamIdParams,
    QuestionIdParams,
    TimeGrantIdParams,
    CreateExamBody,
    UpdateExamBody,
    AddQuestionBody,
    UpdateQuestionBody,
    AddTimeGrantBody,
    RedeemGrantBody,
    AttemptIdParams,
    SubmitAttemptBody,
];

export * from './classes/index.js';
export * from './controllers/index.js';
export * from './services/index.js';
export * from './container.js';
