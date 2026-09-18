import {describe, it, expect, vi} from 'vitest';
import {ObjectId} from 'mongodb';
import {NotFoundError} from 'routing-controllers';
import {ProgressService} from '#users/services/ProgressService.js';

/**
 * #1383 moved the item lookup (readItemById) ahead of the heartbeat check so
 * BLOG orphans with no heartbeat can be judged by item type before being
 * rejected. Before that reordering, a no-heartbeat orphan was rejected
 * immediately and never called readItemById at all.
 *
 * readItemById throws NotFoundError (not a null return) when the item is
 * permanently deleted or missing (ItemRepository.ts: `if (!item) throw new
 * NotFoundError(...)`). recoverOrphanedWatchTimes' catch block deliberately
 * does NOT add a thrown-error record's id to rejectedIds/markRecoveryAttempted,
 * so the next sweep re-examines it -- a design meant for transient DB errors
 * ("a transient database error gets another attempt next sweep").
 *
 * A permanently deleted item is not transient: it will throw NotFoundError
 * on every future sweep too. This test checks whether that distinction is
 * made, using exactly the no-heartbeat population #1383 newly exposes to
 * this code path.
 */

const USER_ID = new ObjectId().toString();
const COURSE_ID = new ObjectId().toString();
const VERSION_ID = new ObjectId().toString();
const ITEM_ID = new ObjectId().toString();

const START = new Date('2026-08-19T10:00:00Z');

function orphan(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    userId: new ObjectId(USER_ID),
    courseId: new ObjectId(COURSE_ID),
    courseVersionId: new ObjectId(VERSION_ID),
    itemId: new ObjectId(ITEM_ID),
    startTime: START,
    lastSeenAt: undefined, // the exact BLOG-no-heartbeat case #1383 targets
    ...overrides,
  };
}

function makeService(opts: {orphans: any[]}) {
  const service: any = Object.create(ProgressService.prototype);

  const calls = {
    markedAttempted: [] as string[],
    closed: [] as any[],
  };

  service.progressRepository = {
    findOrphanedWatchTimes: async () => opts.orphans,
    closeOrphanedWatchTime: async (id: any, endTime: Date) => {
      calls.closed.push({id: id.toString(), endTime});
      return {_id: id, endTime};
    },
    markRecoveryAttempted: async (ids: any[]) => {
      calls.markedAttempted.push(...ids.map(i => i.toString()));
    },
    findProgress: async () => null,
    getHiddenOrDeletedItems: async () => [],
    getCompletedItems: async () => [],
    updateProgress: async () => undefined,
  };

  // Mirrors ItemRepository.readItemById's real behavior for a permanently
  // deleted/missing item: throws NotFoundError, does not return null.
  service.itemRepo = {
    readItemById: async () => {
      throw new NotFoundError(`Item ${ITEM_ID} not found`);
    },
  };
  service.courseRepo = {readVersion: async () => ({_id: VERSION_ID, modules: []})};
  service.enrollmentRepo = {updateProgressPercentById: async () => undefined};
  service._withTransaction = async (fn: any) => fn({} as any);
  service.resolveEnrollment = async () => ({_id: new ObjectId()});
  service.getAllItemIds = async () => [ITEM_ID];
  service.getNextItemInSequence = async () => null;

  return {service: service as ProgressService, calls};
}

describe('ProgressService.recoverOrphanedWatchTimes -- permanently deleted item', () => {
  it('a no-heartbeat orphan whose item was permanently deleted is rejected once, not retried forever', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const record = orphan();
    const {service, calls} = makeService({orphans: [record]});

    const summary = await service.recoverOrphanedWatchTimes();

    console.log(
      `[deleted-item repro] skipped=${summary.skipped} rejected=${summary.rejected} ` +
        `markedAttempted=${JSON.stringify(calls.markedAttempted)}`,
    );

    // NotFoundError from readItemById means the item is permanently gone --
    // it will never "become found" on a later sweep, so this must be
    // rejected (and therefore marked attempted) like any other
    // permanently-unrecoverable record, not left to retry forever the way
    // a genuinely transient error should be.
    expect(summary.rejected).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(calls.markedAttempted).toEqual([record._id.toString()]);
    expect(calls.closed).toHaveLength(0);
  });

  it('mutation check: a generic (potentially transient) error is still left unmarked for retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const record = orphan();
    const {service, calls} = makeService({orphans: [record]});
    (service as any).itemRepo = {
      readItemById: async () => {
        throw new Error('connection reset');
      },
    };

    const summary = await service.recoverOrphanedWatchTimes();

    expect(summary.skipped).toBe(1);
    expect(summary.rejected).toBe(0);
    expect(calls.markedAttempted).toEqual([]);
  });
});
