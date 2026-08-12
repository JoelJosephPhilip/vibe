import 'reflect-metadata';
import {Collection, ObjectId} from 'mongodb';
import {injectable, inject} from 'inversify';
import {MongoDatabase} from '#shared/database/providers/mongo/MongoDatabase.js';
import {GLOBAL_TYPES} from '#root/types.js';
import {
  IDoubt,
  IDoubtReply,
  DoubtStatus,
} from '#root/shared/interfaces/models.js';

/**
 * Ids in this database exist in both string and ObjectId form depending on which
 * code path wrote them, so every lookup matches on both (same approach as
 * AnnouncementRepository).
 */
function idVariants(id: string): (string | ObjectId)[] {
  const variants: (string | ObjectId)[] = [id];
  if (ObjectId.isValid(id)) variants.push(new ObjectId(id));
  return variants;
}

@injectable()
export class DoubtRepository {
  private collection!: Collection<IDoubt>;
  private initialized = false;

  constructor(@inject(GLOBAL_TYPES.Database) private db: MongoDatabase) {}

  private async init() {
    if (this.initialized) return;
    this.collection = await this.db.getCollection<IDoubt>('doubts');
    this.initialized = true;

    try {
      await this.collection.createIndex(
        {itemId: 1, createdAt: -1},
        {background: true},
      );
      await this.collection.createIndex(
        {itemId: 1, videoTimestamp: 1},
        {background: true},
      );
      await this.collection.createIndex(
        {courseId: 1, courseVersionId: 1, status: 1, createdAt: -1},
        {background: true},
      );
      await this.collection.createIndex(
        {userId: 1, createdAt: -1},
        {background: true},
      );
    } catch {
      // Index creation is best-effort; a race between instances is harmless.
    }
  }

  async create(doubt: IDoubt): Promise<IDoubt> {
    await this.init();
    const result = await this.collection.insertOne(doubt as any);
    return {...doubt, _id: result.insertedId};
  }

  async findById(doubtId: string): Promise<IDoubt | null> {
    await this.init();
    return this.collection.findOne({
      _id: {$in: idVariants(doubtId)},
      isDeleted: {$ne: true},
    } as any);
  }

  /**
   * Doubts for one video item. Hidden doubts are only returned to moderators.
   */
  async findByItem(
    itemId: string,
    opts: {includeHidden: boolean; limit: number},
  ): Promise<IDoubt[]> {
    await this.init();
    const query: Record<string, unknown> = {
      itemId: {$in: idVariants(itemId)},
      isDeleted: {$ne: true},
    };
    if (!opts.includeHidden) query.isHidden = false;

    return this.collection
      .find(query as any)
      .sort({videoTimestamp: 1, createdAt: 1})
      .limit(opts.limit)
      .toArray();
  }

  /** All doubts in a course version — powers the instructor review page. */
  async findByCourseVersion(
    courseId: string,
    courseVersionId: string,
    opts: {status?: DoubtStatus; limit: number},
  ): Promise<IDoubt[]> {
    await this.init();
    const query: Record<string, unknown> = {
      courseId: {$in: idVariants(courseId)},
      courseVersionId: {$in: idVariants(courseVersionId)},
      isDeleted: {$ne: true},
    };
    if (opts.status) query.status = opts.status;

    return this.collection
      .find(query as any)
      .sort({createdAt: -1})
      .limit(opts.limit)
      .toArray();
  }

  async addReply(doubtId: string, reply: IDoubtReply): Promise<boolean> {
    await this.init();
    const result = await this.collection.updateOne(
      {_id: {$in: idVariants(doubtId)}, isDeleted: {$ne: true}} as any,
      {
        $push: {replies: reply},
        $set: {updatedAt: new Date()},
      } as any,
    );
    return result.matchedCount > 0;
  }

  async updateStatus(doubtId: string, status: DoubtStatus): Promise<boolean> {
    await this.init();
    const result = await this.collection.updateOne(
      {_id: {$in: idVariants(doubtId)}, isDeleted: {$ne: true}} as any,
      {$set: {status, updatedAt: new Date()}},
    );
    return result.matchedCount > 0;
  }

  async updateHidden(doubtId: string, isHidden: boolean): Promise<boolean> {
    await this.init();
    const result = await this.collection.updateOne(
      {_id: {$in: idVariants(doubtId)}, isDeleted: {$ne: true}} as any,
      {$set: {isHidden, updatedAt: new Date()}},
    );
    return result.matchedCount > 0;
  }

  async softDelete(doubtId: string): Promise<boolean> {
    await this.init();
    const now = new Date();
    const result = await this.collection.updateOne(
      {_id: {$in: idVariants(doubtId)}} as any,
      {$set: {isDeleted: true, deletedAt: now, updatedAt: now}},
    );
    return result.matchedCount > 0;
  }
}
