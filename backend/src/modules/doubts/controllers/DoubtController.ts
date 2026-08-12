import {inject, injectable} from 'inversify';
import {subject} from '@casl/ability';
import {
  Authorized,
  Body,
  Delete,
  ForbiddenError,
  Get,
  HttpCode,
  JsonController,
  Params,
  Patch,
  Post,
  QueryParams,
} from 'routing-controllers';
import {OpenAPI, ResponseSchema} from 'routing-controllers-openapi';
import {Ability} from '#root/shared/functions/AbilityDecorator.js';
import {IDoubt, IUser} from '#root/shared/interfaces/models.js';
import {DOUBT_TYPES} from '../types.js';
import {DoubtService} from '../services/DoubtService.js';
import {DoubtActions, getDoubtAbility} from '../abilities/doubtAbilities.js';
import {
  CreateDoubtBody,
  CreateDoubtReplyBody,
  DoubtCourseListQuery,
  DoubtCoursePathParams,
  DoubtIdPathParams,
  DoubtItemPathParams,
  DoubtListQuery,
  DoubtListResponse,
  DoubtResponse,
  UpdateDoubtHiddenBody,
  UpdateDoubtStatusBody,
} from '../classes/validators/DoubtValidator.js';

function displayName(user: IUser): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return name || 'Unknown User';
}

function toResponse(doubt: IDoubt): DoubtResponse {
  return {
    _id: doubt._id?.toString() || '',
    itemId: doubt.itemId.toString(),
    courseId: doubt.courseId.toString(),
    courseVersionId: doubt.courseVersionId.toString(),
    userId: doubt.userId.toString(),
    userName: doubt.userName,
    videoTimestamp: doubt.videoTimestamp,
    content: doubt.content,
    status: doubt.status,
    isHidden: doubt.isHidden,
    createdAt: doubt.createdAt.toISOString(),
    replies: (doubt.replies || [])
      .filter(r => !r.isDeleted)
      .map(r => ({
        _id: r._id?.toString() || '',
        userId: r.userId.toString(),
        userName: r.userName,
        role: r.role,
        content: r.content,
        isHidden: r.isHidden,
        createdAt: r.createdAt.toISOString(),
      })),
  };
}

@OpenAPI({tags: ['Doubts']})
@JsonController('/doubts')
@injectable()
export class DoubtController {
  constructor(
    @inject(DOUBT_TYPES.DoubtService)
    private readonly service: DoubtService,
  ) {}

  private assertCan(
    ability: any,
    action: DoubtActions,
    courseId: string,
    versionId: string,
    message: string,
  ) {
    const resource = subject('Doubt', {courseId, versionId});
    if (!ability.can(action, resource)) {
      throw new ForbiddenError(message);
    }
  }

  @Authorized()
  @Get('/items/:itemId')
  @HttpCode(200)
  @ResponseSchema(DoubtListResponse)
  @OpenAPI({summary: 'List doubts for a video item'})
  async listByItem(
    @Params() params: DoubtItemPathParams,
    @QueryParams() query: DoubtListQuery,
    @Ability(getDoubtAbility) {ability}: any,
  ): Promise<DoubtListResponse> {
    this.assertCan(
      ability,
      DoubtActions.View,
      query.courseId,
      query.courseVersionId,
      'You do not have access to doubts for this course.',
    );

    // Moderators see hidden doubts; everyone else does not.
    const includeHidden = ability.can(
      DoubtActions.Moderate,
      subject('Doubt', {
        courseId: query.courseId,
        versionId: query.courseVersionId,
      }),
    );

    const doubts = await this.service.listForItem(params.itemId, {
      includeHidden,
      limit: query.limit ?? 100,
    });
    return {items: doubts.map(toResponse)};
  }

  @Authorized()
  @Post('/items/:itemId')
  @HttpCode(201)
  @ResponseSchema(DoubtResponse)
  @OpenAPI({summary: 'Ask a doubt on a video item'})
  async create(
    @Params() params: DoubtItemPathParams,
    @Body() body: CreateDoubtBody,
    @Ability(getDoubtAbility) {ability, user}: any,
  ): Promise<DoubtResponse> {
    this.assertCan(
      ability,
      DoubtActions.Create,
      body.courseId,
      body.courseVersionId,
      'You must be enrolled in this course to ask a doubt.',
    );

    const doubt = await this.service.createDoubt({
      itemId: params.itemId,
      courseId: body.courseId,
      courseVersionId: body.courseVersionId,
      cohortId: body.cohortId,
      moduleId: body.moduleId,
      sectionId: body.sectionId,
      userId: user._id.toString(),
      userName: displayName(user),
      videoTimestamp: body.videoTimestamp,
      content: body.content,
    });
    return toResponse(doubt);
  }

  @Authorized()
  @Post('/:doubtId/replies')
  @HttpCode(201)
  @OpenAPI({summary: 'Reply to a doubt'})
  async reply(
    @Params() params: DoubtIdPathParams,
    @Body() body: CreateDoubtReplyBody,
    @Ability(getDoubtAbility) {ability, user}: any,
  ) {
    const doubt = await this.service.getById(params.doubtId);
    const courseId = doubt.courseId.toString();
    const versionId = doubt.courseVersionId.toString();

    this.assertCan(
      ability,
      DoubtActions.Reply,
      courseId,
      versionId,
      'You do not have permission to reply to this doubt.',
    );

    const isModerator = ability.can(
      DoubtActions.Moderate,
      subject('Doubt', {courseId, versionId}),
    );

    const reply = await this.service.addReply({
      doubtId: params.doubtId,
      userId: user._id.toString(),
      userName: displayName(user),
      role: isModerator ? 'INSTRUCTOR' : 'STUDENT',
      content: body.content,
    });

    return {
      _id: reply._id?.toString() || '',
      userId: reply.userId.toString(),
      userName: reply.userName,
      role: reply.role,
      content: reply.content,
      isHidden: reply.isHidden,
      createdAt: reply.createdAt.toISOString(),
    };
  }

  @Authorized()
  @Patch('/:doubtId/status')
  @HttpCode(200)
  @OpenAPI({summary: 'Mark a doubt resolved or reopen it'})
  async setStatus(
    @Params() params: DoubtIdPathParams,
    @Body() body: UpdateDoubtStatusBody,
    @Ability(getDoubtAbility) {ability}: any,
  ) {
    const doubt = await this.service.getById(params.doubtId);
    this.assertCan(
      ability,
      DoubtActions.Moderate,
      doubt.courseId.toString(),
      doubt.courseVersionId.toString(),
      'Only instructors can change the status of a doubt.',
    );
    await this.service.setStatus(params.doubtId, body.status);
    return {success: true};
  }

  @Authorized()
  @Patch('/:doubtId/hide')
  @HttpCode(200)
  @OpenAPI({summary: 'Hide or unhide a doubt'})
  async setHidden(
    @Params() params: DoubtIdPathParams,
    @Body() body: UpdateDoubtHiddenBody,
    @Ability(getDoubtAbility) {ability}: any,
  ) {
    const doubt = await this.service.getById(params.doubtId);
    this.assertCan(
      ability,
      DoubtActions.Moderate,
      doubt.courseId.toString(),
      doubt.courseVersionId.toString(),
      'Only instructors can hide a doubt.',
    );
    await this.service.setHidden(params.doubtId, body.isHidden);
    return {success: true};
  }

  @Authorized()
  @Delete('/:doubtId')
  @HttpCode(200)
  @OpenAPI({summary: 'Delete a doubt (author or instructor)'})
  async remove(
    @Params() params: DoubtIdPathParams,
    @Ability(getDoubtAbility) {ability, user}: any,
  ) {
    const doubt = await this.service.getById(params.doubtId);
    const isAuthor = doubt.userId.toString() === user._id.toString();

    if (!isAuthor) {
      this.assertCan(
        ability,
        DoubtActions.Delete,
        doubt.courseId.toString(),
        doubt.courseVersionId.toString(),
        'You can only delete your own doubts.',
      );
    }

    await this.service.softDelete(params.doubtId);
    return {success: true};
  }

  @Authorized()
  @Get('/courses/:courseId/versions/:courseVersionId')
  @HttpCode(200)
  @ResponseSchema(DoubtListResponse)
  @OpenAPI({summary: 'List all doubts in a course version (instructor review)'})
  async listByCourseVersion(
    @Params() params: DoubtCoursePathParams,
    @QueryParams() query: DoubtCourseListQuery,
    @Ability(getDoubtAbility) {ability}: any,
  ): Promise<DoubtListResponse> {
    this.assertCan(
      ability,
      DoubtActions.Moderate,
      params.courseId,
      params.courseVersionId,
      'Only instructors can review doubts for this course.',
    );

    const status =
      query.status && query.status !== 'ALL' ? query.status : undefined;

    const doubts = await this.service.listForCourseVersion(
      params.courseId,
      params.courseVersionId,
      {status, limit: query.limit ?? 200},
    );
    return {items: doubts.map(toResponse)};
  }
}
