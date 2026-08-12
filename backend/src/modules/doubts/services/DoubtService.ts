import 'reflect-metadata';
import {ObjectId} from 'mongodb';
import {inject, injectable} from 'inversify';
import {NotFoundError} from 'routing-controllers';
import {
  DoubtStatus,
  IDoubt,
  IDoubtReply,
} from '#root/shared/interfaces/models.js';
import {DOUBT_TYPES} from '../types.js';
import {DoubtRepository} from '../repositories/providers/mongodb/DoubtRepository.js';

export interface CreateDoubtInput {
  itemId: string;
  courseId: string;
  courseVersionId: string;
  cohortId?: string;
  moduleId?: string;
  sectionId?: string;
  userId: string;
  userName: string;
  videoTimestamp: number;
  content: string;
}

export interface AddReplyInput {
  doubtId: string;
  userId: string;
  userName: string;
  role: 'STUDENT' | 'INSTRUCTOR';
  content: string;
}

@injectable()
export class DoubtService {
  constructor(
    @inject(DOUBT_TYPES.DoubtRepo)
    private readonly doubtRepo: DoubtRepository,
  ) {}

  async createDoubt(input: CreateDoubtInput): Promise<IDoubt> {
    const now = new Date();
    const doubt: IDoubt = {
      itemId: input.itemId,
      courseId: input.courseId,
      courseVersionId: input.courseVersionId,
      cohortId: input.cohortId,
      moduleId: input.moduleId,
      sectionId: input.sectionId,
      userId: input.userId,
      userName: input.userName,
      videoTimestamp: input.videoTimestamp,
      content: input.content.trim(),
      status: 'OPEN',
      replies: [],
      isHidden: false,
      isDeleted: false,
      createdAt: now,
      updatedAt: now,
    };
    return this.doubtRepo.create(doubt);
  }

  async listForItem(
    itemId: string,
    opts: {includeHidden: boolean; limit: number},
  ): Promise<IDoubt[]> {
    return this.doubtRepo.findByItem(itemId, opts);
  }

  async listForCourseVersion(
    courseId: string,
    courseVersionId: string,
    opts: {status?: DoubtStatus; limit: number},
  ): Promise<IDoubt[]> {
    return this.doubtRepo.findByCourseVersion(courseId, courseVersionId, opts);
  }

  async getById(doubtId: string): Promise<IDoubt> {
    const doubt = await this.doubtRepo.findById(doubtId);
    if (!doubt) throw new NotFoundError('Doubt not found');
    return doubt;
  }

  async addReply(input: AddReplyInput): Promise<IDoubtReply> {
    const reply: IDoubtReply = {
      _id: new ObjectId(),
      userId: input.userId,
      userName: input.userName,
      role: input.role,
      content: input.content.trim(),
      isHidden: false,
      isDeleted: false,
      createdAt: new Date(),
    };
    const ok = await this.doubtRepo.addReply(input.doubtId, reply);
    if (!ok) throw new NotFoundError('Doubt not found');
    return reply;
  }

  async setStatus(doubtId: string, status: DoubtStatus): Promise<void> {
    const ok = await this.doubtRepo.updateStatus(doubtId, status);
    if (!ok) throw new NotFoundError('Doubt not found');
  }

  async setHidden(doubtId: string, isHidden: boolean): Promise<void> {
    const ok = await this.doubtRepo.updateHidden(doubtId, isHidden);
    if (!ok) throw new NotFoundError('Doubt not found');
  }

  async softDelete(doubtId: string): Promise<void> {
    const ok = await this.doubtRepo.softDelete(doubtId);
    if (!ok) throw new NotFoundError('Doubt not found');
  }
}
