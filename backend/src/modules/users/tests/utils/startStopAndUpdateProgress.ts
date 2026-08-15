// utils/testProgressTracking.ts
import request from 'supertest';
import Express from 'express';
import {ProgressService} from '../../services/ProgressService.js';
import {ObjectId} from 'mongodb';
import {vi} from 'vitest';

export async function startStopAndUpdateProgress({
  userId,
  courseId,
  courseVersionId,
  itemId,
  moduleId,
  sectionId,
  app,
}: {
  userId: string | ObjectId;
  courseId: string;
  courseVersionId: string;
  itemId: string;
  moduleId: string;
  sectionId: string;
  app: typeof Express;
}) {
  // /stop validates watch time against real elapsed wall-clock time (see
  // ProgressService.isValidWatchTime) — a near-instant start->stop in a test
  // never accrues enough on its own, so mock it here. There is no separate
  // /update endpoint; /stop handles both validation and progress advancement.
  vi.spyOn(ProgressService.prototype as any, 'isValidWatchTime')
    .mockReset()
    .mockReturnValue(true);

  // Start the item progress
  const startItemBody = {itemId, moduleId, sectionId};
  const startItemResponse = await request(app)
    .post(
      `/users/progress/courses/${courseId}/versions/${courseVersionId}/start`,
    )
    .set('Authorization', 'Bearer default')
    .send(startItemBody)
    .expect(200);

  // Stop the item progress
  const stopItemBody = {
    sectionId,
    moduleId,
    itemId,
    watchItemId: startItemResponse.body.watchItemId,
  };
  const stopItemResponse = await request(app)
    .post(
      `/users/progress/courses/${courseId}/versions/${courseVersionId}/stop`,
    )
    .set('Authorization', 'Bearer default')
    .send(stopItemBody)
    .expect(200);

  return {startItemResponse, stopItemResponse};
}
