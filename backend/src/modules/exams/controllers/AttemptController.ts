import 'reflect-metadata';
import {
    JsonController,
    Post,
    Get,
    HttpCode,
    Params,
    Body,
    Authorized,
    CurrentUser,
} from 'routing-controllers';
import { injectable, inject } from 'inversify';
import { OpenAPI } from 'routing-controllers-openapi';
import { EXAMS_TYPES } from '../types.js';
import { AttemptService } from '../services/AttemptService.js';
import { ExamIdParams } from '../classes/validators/ExamValidators.js';
import { AttemptIdParams, SubmitAttemptBody } from '../classes/validators/AttemptValidators.js';
import { IUser } from '#root/shared/interfaces/models.js';

/**
 * Same `/exams` prefix as `ExamController`, since these routes are logically
 * nested under an exam ("submit an attempt for this exam") or under the
 * attempts sub-resource ("my attempts", "one attempt by id").
 *
 * Route-collision check (routing-controllers/Express matches literal path
 * segments before params, in registration order, and never matches across
 * differing segment counts or HTTP methods):
 *   - `GET /exams/attempts/mine` and `GET /exams/attempts/:attemptId` are
 *     both 2 segments after `/exams`, so `mine` WOULD be swallowed by
 *     `:attemptId` if that route were registered first — hence `mine` is
 *     declared before `:attemptId` below.
 *   - `GET /exams/:examId` (ExamController, 1 segment) cannot match
 *     `/exams/attempts/mine` or `/exams/attempts/:attemptId` (2 segments
 *     each) — Express requires an exact segment-count match, so there is no
 *     collision between the two controllers regardless of registration
 *     order. `examsModuleControllers` still lists this controller first, as
 *     a defensive convention (literal/nested routes before single-param
 *     ones), even though it is not load-bearing here.
 *   - `POST /exams/:examId/attempts` differs from every ExamController route
 *     by method and/or literal suffix, so it cannot collide either.
 */
@OpenAPI({
    tags: ['Exams'],
})
@JsonController('/exams', { transformResponse: true })
@injectable()
export class AttemptController {
    constructor(
        @inject(EXAMS_TYPES.AttemptService)
        private readonly attemptService: AttemptService,
    ) {}

    // Submit attempt -> authoritative score, persisted
    @Authorized()
    @Post('/:examId/attempts')
    @HttpCode(201)
    @OpenAPI({
        summary: 'Submit an exam attempt',
        description:
            'Recomputes score/correctCount server-side from the exam\'s stored ' +
            'questions rather than trusting any client-submitted score.',
    })
    async submitAttempt(
        @Params() params: ExamIdParams,
        @Body() body: SubmitAttemptBody,
        @CurrentUser() user: IUser,
    ) {
        return this.attemptService.submitAttempt(
            params.examId,
            user._id!.toString(),
            body.responses,
            {
                tabSwitches: body.tabSwitches,
                startedAt: body.startedAt,
                proctoringEvents: body.proctoringEvents,
            },
        );
    }

    // Current student's attempt history (MyTestsPage) — must be registered
    // before GET /attempts/:attemptId, see class-level note above.
    @Authorized()
    @Get('/attempts/mine')
    @HttpCode(200)
    @OpenAPI({
        summary: "Get the current user's exam attempts",
    })
    async getMyAttempts(@CurrentUser() user: IUser) {
        return this.attemptService.listByStudent(user._id!.toString());
    }

    // Single result (ResultPage; must be own attempt, the exam owner, or admin)
    @Authorized()
    @Get('/attempts/:attemptId')
    @HttpCode(200)
    @OpenAPI({
        summary: 'Get a single exam attempt by id',
        description: 'Must belong to the requester, or the requester must own the exam or be an admin.',
    })
    async getAttempt(@Params() params: AttemptIdParams, @CurrentUser() user: IUser) {
        return this.attemptService.getById(params.attemptId, user);
    }
}
