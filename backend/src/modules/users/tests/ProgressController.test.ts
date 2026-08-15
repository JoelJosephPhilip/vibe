import request from 'supertest';
import Express from 'express';
import {BadRequestError, useContainer, useExpressServer} from 'routing-controllers';
import {authModuleOptions} from '#auth/index.js';
import {coursesModuleOptions} from '#courses/index.js';
import {usersModuleOptions} from '../index.js';

import { isMongoId } from 'class-validator';
import { ProgressService } from '../services/ProgressService.js';
import { ProgressRepository } from '#shared/database/providers/mongo/repositories/ProgressRepository.js';
import { IUser, IWatchTime } from '#shared/interfaces/models.js';
import {
  CourseData,
  createCourseWithModulesSectionsAndItems,
} from './utils/createCourse.js';
import { createUser } from './utils/createUser.js';
import { createEnrollment } from './utils/createEnrollment.js';
import { startStopAndUpdateProgress } from './utils/startStopAndUpdateProgress.js';
import { verifyProgressInDatabase } from './utils/verifyProgressInDatabase.js';
import { InversifyAdapter } from '#root/inversify-adapter.js';
import { setContainer } from '#root/bootstrap/loadModules.js';
import { Container } from 'inversify';
import { sharedContainerModule } from '#root/container.js';
import { faker } from '@faker-js/faker';
import { authContainerModule } from '#auth/container.js';
import { coursesContainerModule } from '#courses/container.js';
import { usersContainerModule } from '../container.js';
import {
  ResetCourseProgressBody,
  StartItemBody,
  StopItemBody,
} from '../classes/validators/ProgressValidators.js';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { FirebaseAuthService } from '#root/modules/auth/services/FirebaseAuthService.js';
import { quizzesContainerModule } from '#root/modules/quizzes/container.js';
import { notificationsContainerModule } from '#root/modules/notifications/container.js';
import { anomaliesContainerModule } from '#root/modules/anomalies/container.js';
import { settingContainerModule } from '#root/modules/setting/container.js';
import { courseRegistrationContainerModule } from '#root/modules/courseRegistration/container.js';
import { projectsContainerModule } from '#root/modules/projects/container.js';
import { reportsContainerModule } from '#root/modules/reports/container.js';
import { GLOBAL_TYPES } from '#root/types.js';
import { MongoDatabase } from '#root/shared/database/providers/mongo/MongoDatabase.js';
import { hpSystemContainerModule } from '#root/modules/hpSystem/container.js';
import { ejectionPolicyContainerModule } from '#root/modules/ejectionPolicy/container.js';
import { emotionsContainerModule } from '#root/modules/emotions/container.js';
import { genAIContainerModule } from '#root/modules/genAI/container.js';
import { studentQuestionsContainerModule } from '#root/modules/studentQuestions/container.js';
import { announcementsContainerModule } from '#root/modules/announcements/container.js';
import { auditTrailsContainerModule } from '#root/modules/auditTrails/container.js';

describe('Progress Controller Integration Tests', { timeout: 90000 }, () => {
  const appInstance = Express();
  let app;
  let userIdUser: string;
  let userIdAdmin: string;
  let courseData: CourseData;
  // Stable identity for 'test-token' (used by createCourse.ts's course/module/
  // section/item setup calls) — must stay the same across calls so the
  // creator's auto-instructor-enrollment carries over between requests.
  const testTokenUserId = faker.database.mongodbObjectId();

  beforeAll(async () => {
    //Set env variables
    process.env.NODE_ENV = 'test';

    const container = new Container();
    await container.load(
      sharedContainerModule,
      authContainerModule,
      usersContainerModule,
      coursesContainerModule,
      quizzesContainerModule,
      notificationsContainerModule,
      anomaliesContainerModule,
      settingContainerModule,
      courseRegistrationContainerModule,
      projectsContainerModule,
      reportsContainerModule,
      hpSystemContainerModule,
      ejectionPolicyContainerModule,
      emotionsContainerModule,
      genAIContainerModule,
      studentQuestionsContainerModule,
      announcementsContainerModule,
      auditTrailsContainerModule
    );
    const inversifyAdapter = new InversifyAdapter(container);
    useContainer(inversifyAdapter);
    // ProgressService resolves some collaborators (e.g. CourseSettingService)
    // via the service-locator getContainer() — register this container as
    // the global one so those lookups don't throw "Container not initialized".
    setContainer(container);
    const db = container.get<MongoDatabase>(GLOBAL_TYPES.Database);
    await db.connect();
    app = useExpressServer(appInstance, {
      controllers: [
        ...(usersModuleOptions.controllers as Function[]),
        ...(authModuleOptions.controllers as Function[]),
        ...(coursesModuleOptions.controllers as Function[]),
      ],
      authorizationChecker: async () => true,
      defaultErrorHandler: true,
      validation: true,
    });

    // Create a user
    userIdUser = await createUser(app, 'user');
    userIdAdmin = await createUser(app, 'admin');

    vi.spyOn(FirebaseAuthService.prototype, 'getUserIdFromReq').mockImplementation(
    async (req: Express.Request): Promise<string> => {
      if (req.headers.authorization === 'no') {
        throw new BadRequestError('Invalid request');
      }
      if (req.headers.authorization === 'fake') {
        return faker.database.mongodbObjectId();
      }
      if (req.headers.authorization === 'userAdmin') {
        return userIdAdmin;
      }
      return userIdUser;
    });

    // The real @Ability() decorator (unlike getUserIdFromReq above) verifies
    // the bearer token itself via getCurrentUserFromToken — mock it too,
    // keyed the same way so every 'Bearer <token>' header used below resolves.
    vi.spyOn(
      FirebaseAuthService.prototype,
      'getCurrentUserFromToken',
    ).mockImplementation(async (token: string): Promise<any> => {
      if (token === 'no') {
        throw new BadRequestError('Invalid request');
      }
      if (token === 'fake') {
        return {_id: faker.database.mongodbObjectId(), roles: 'user'};
      }
      if (token === 'userAdmin') {
        return {_id: userIdAdmin, roles: 'admin'};
      }
      if (token === 'test-token') {
        return {_id: testTokenUserId, roles: 'admin'};
      }
      return {_id: userIdUser, roles: 'user'};
    });

    courseData = await createCourseWithModulesSectionsAndItems(2, 2, 3, app);

    // Create enrollment
    await createEnrollment(
      app,
      userIdUser,
      courseData.courseId,
      courseData.courseVersionId,
      courseData.modules[0].moduleId,
      courseData.modules[0].sections[0].sectionId,
      courseData.modules[0].sections[0].items[0].itemId,
    );
  });

  // ------Tests for Create <ModuleName>------
  describe('Fetch Progress Data', () => {
    it('should fetch the progress', async () => {
      await verifyProgressInDatabase({
        userId: userIdUser as string,
        courseId: courseData.courseId,
        courseVersionId: courseData.courseVersionId,
        expectedModuleId: courseData.modules[0].moduleId,
        expectedSectionId: courseData.modules[0].sections[0].sectionId,
        expectedItemId: courseData.modules[0].sections[0].items[0].itemId,
        expectedCompleted: false,
        app,
      });
    });

    it('Should fetch the Watch Time', async () => {
      // isValidWatchTime checks real elapsed wall-clock time — an
      // instant start->stop in a test never accrues enough on its own.
      vi.spyOn(ProgressService.prototype as any, 'isValidWatchTime')
        .mockReset()
        .mockReturnValue(true);

      // Uses a freshly created course (still the shared userIdUser identity,
      // since that's what 'Bearer default' resolves to) rather than the
      // describe-level courseData — starting+stopping the shared item there
      // would advance userIdUser's progress position out from under the
      // sibling "Start Item"/"Stop Item" tests, which assume it's untouched.
      const localCourseData = await createCourseWithModulesSectionsAndItems(
        1,
        1,
        1,
        app,
      );
      await createEnrollment(
        app,
        userIdUser,
        localCourseData.courseId,
        localCourseData.courseVersionId,
        localCourseData.modules[0].moduleId,
        localCourseData.modules[0].sections[0].sectionId,
        localCourseData.modules[0].sections[0].items[0].itemId,
      );

      const startItemBody: StartItemBody = {
        itemId: localCourseData.modules[0].sections[0].items[0].itemId,
        moduleId: localCourseData.modules[0].moduleId,
        sectionId: localCourseData.modules[0].sections[0].sectionId,
      };
      // Start the item progress
      const startItemResponse = await request(app)
        .post(
          `/users/progress/courses/${localCourseData.courseId}/versions/${localCourseData.courseVersionId}/start`,
        )
        .set('Authorization', 'Bearer default')
        .send(startItemBody)
        .expect(200);

      const stopItemBody: StopItemBody = {
        sectionId: localCourseData.modules[0].sections[0].sectionId,
        moduleId: localCourseData.modules[0].moduleId,
        itemId: localCourseData.modules[0].sections[0].items[0].itemId,
        watchItemId: startItemResponse.body.watchItemId,
      };

      const stopItemResponse = await request(app)
        .post(
          `/users/progress/courses/${localCourseData.courseId}/versions/${localCourseData.courseVersionId}/stop`,
        )
        .set('Authorization', 'Bearer default')
        .send(stopItemBody)
        .expect(200);

      const watchTimeResponse = await request(app)
        .get(
          `/users/${userIdUser}/watchTime/course/${localCourseData.courseId}/version/${localCourseData.courseVersionId}/item/${localCourseData.modules[0].sections[0].items[0].itemId}/type/VIDEO`,
        )
        .set('Authorization', 'Bearer default')
        .expect(200);
    });

    it('should return 400 if userId is invalid', async () => {
      const invalidUserId = 'invalidUserId';
      const courseId = courseData.courseId;
      const courseVersionId = courseData.courseVersionId;

      const response = await request(app)
        .get(
          `/users/progress/courses/${courseId}/versions/${courseVersionId}`,
        )
        .set('Authorization', 'Bearer no')
        .expect(400);
    });

    it('should return 400 if courseId is invalid', async () => {
      const invalidCourseId = 'invalidCourseId';
      const courseVersionId = courseData.courseVersionId;

      const response = await request(app)
        .get(
          `/users/progress/courses/${invalidCourseId}/versions/${courseVersionId}`,
        )
        .set('Authorization', 'Bearer default')
        .expect(400);

      //expect body.errors to be truthy
      expect(response.body).toHaveProperty('errors');
      expect(response.body.errors).toBeTruthy();
      expect(response.body.errors[0].constraints).toHaveProperty('isMongoId');
    });

    it('should return 400 if courseVersionId is invalid', async () => {
      const courseId = courseData.courseId;

      const invalidCourseVersionId = 'invalidCourseVersionId';

      const response = await request(app)
        .get(
          `/users/progress/courses/${courseId}/versions/${invalidCourseVersionId}`,
        )
        .set('Authorization', 'Bearer default')
        .expect(400);
      //expect body.errors to be truthy
      expect(response.body).toHaveProperty('errors');
      expect(response.body.errors).toBeTruthy();
      expect(response.body.errors[0].constraints).toHaveProperty('isMongoId');
    });

    it('should return 403 when courseId and courseVersionId are fake (user has no enrollment there)', async () => {
      const courseId = faker.database.mongodbObjectId();
      const courseVersionId = faker.database.mongodbObjectId();

      // Progress-view is enrollment-scoped (see progressAbilities.ts): the
      // ability check for a course/version the user isn't enrolled in fails
      // before the "not found" data lookup is ever reached.
      const response = await request(app)
        .get(
          `/users/progress/courses/${courseId}/versions/${courseVersionId}`,
        )
        .set('Authorization', 'Bearer default')
        .expect(403);
      expect(response.body).toHaveProperty('name');
      expect(response.body.name).toBe('ForbiddenError');
      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toBe(
        'You do not have permission to view this progress',
      );
    });

    it('should return 403 when userId is fake (no enrollments anywhere)', async () => {
      const courseId = courseData.courseId;
      const courseVersionId = courseData.courseVersionId;

      const response = await request(app)
        .get(
          `/users/progress/courses/${courseId}/versions/${courseVersionId}`,
        )
        .set('Authorization', 'Bearer fake')
        .expect(403);

      expect(response.body).toHaveProperty('name');
      expect(response.body.name).toBe('ForbiddenError');
      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toBe(
        'You do not have permission to view this progress',
      );
    });

    it('should return 403 when all params are fake', async () => {
      const courseId = faker.database.mongodbObjectId();
      const courseVersionId = faker.database.mongodbObjectId();

      const response = await request(app)
        .get(
          `/users/progress/courses/${courseId}/versions/${courseVersionId}`,
        )
        .set('Authorization', 'Bearer fake')
        .expect(403);

      expect(response.body).toHaveProperty('name');
      expect(response.body.name).toBe('ForbiddenError');
      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toBe(
        'You do not have permission to view this progress',
      );
    });
  });

  describe('Start Item', () => {
    it('should start the item tracking for recording progress', async () => {
      const startItemBody: StartItemBody = {
        itemId: courseData.modules[0].sections[0].items[0].itemId,
        moduleId: courseData.modules[0].moduleId,
        sectionId: courseData.modules[0].sections[0].sectionId,
      };
      // Start the item progress
      const startItemResponse = await request(app)
        .post(
          `/users/progress/courses/${courseData.courseId}/versions/${courseData.courseVersionId}/start`,
        )
        .set('Authorization', 'Bearer default')
        .send(startItemBody)
        .expect(200);

      // Expect the response to contain the watchItemId
      expect(startItemResponse.body).toHaveProperty('watchItemId');
      expect(startItemResponse.body.watchItemId).toBeTruthy();
      expect(isMongoId(startItemResponse.body.watchItemId)).toBe(true);
    });
  });

  describe('Stop Item', () => {
    it('should stop the item tracking for recording progress', async () => {
      vi.spyOn(ProgressService.prototype as any, 'isValidWatchTime')
        .mockReset()
        .mockReturnValue(true);

      const startItemBody: StartItemBody = {
        itemId: courseData.modules[0].sections[0].items[0].itemId,
        moduleId: courseData.modules[0].moduleId,
        sectionId: courseData.modules[0].sections[0].sectionId,
      };
      // Start the item progress
      const startItemResponse = await request(app)
        .post(
          `/users/progress/courses/${courseData.courseId}/versions/${courseData.courseVersionId}/start`,
        )
        .set('Authorization', 'Bearer default')
        .send(startItemBody)
        .expect(200);

      // Stop the item progress
      const stopItemBody: StopItemBody = {
        sectionId: courseData.modules[0].sections[0].sectionId,
        moduleId: courseData.modules[0].moduleId,
        itemId: courseData.modules[0].sections[0].items[0].itemId,
        watchItemId: startItemResponse.body.watchItemId,
      };

      const stopItemResponse = await request(app)
        .post(
          `/users/progress/courses/${courseData.courseId}/versions/${courseData.courseVersionId}/stop`,
        )
        .set('Authorization', 'Bearer default')
        .send(stopItemBody)
        .expect(200);
    });
  });

  describe('Update Progress', () => {
    beforeEach(async () => {
      courseData = await createCourseWithModulesSectionsAndItems(2, 2, 3, app);

      // Create a user
      userIdUser = await createUser(app);

      // Create enrollment
      await createEnrollment(
        app,
        userIdUser,
        courseData.courseId,
        courseData.courseVersionId,
        courseData.modules[0].moduleId,
        courseData.modules[0].sections[0].sectionId,
        courseData.modules[0].sections[0].items[0].itemId,
      );
    });

    it('should update the progress, if isValidWatchTime is true', async () => {
      // Start the item progress
      const startItemBody: StartItemBody = {
        itemId: courseData.modules[0].sections[0].items[0].itemId,
        moduleId: courseData.modules[0].moduleId,
        sectionId: courseData.modules[0].sections[0].sectionId,
      };
      const startItemResponse = await request(app)
        .post(
          `/users/progress/courses/${courseData.courseId}/versions/${courseData.courseVersionId}/start`,
        )
        .set('Authorization', 'Bearer default')
        .send(startItemBody)
        .expect(200);

      // Stop the item progress
      vi.spyOn(ProgressService.prototype as any, 'isValidWatchTime')
        .mockReset()
        .mockReturnValue(true);

      const stopItemBody: StopItemBody = {
        sectionId: courseData.modules[0].sections[0].sectionId,
        moduleId: courseData.modules[0].moduleId,
        itemId: courseData.modules[0].sections[0].items[0].itemId,
        watchItemId: startItemResponse.body.watchItemId,
      };
      // Watch-time validation (and the resulting progress advancement) is
      // handled entirely within /stop now — there is no separate /update
      // endpoint (ProgressController has no PATCH .../update route).
      const stopItemResponse = await request(app)
        .post(
          `/users/progress/courses/${courseData.courseId}/versions/${courseData.courseVersionId}/stop`,
        )
        .set('Authorization', 'Bearer default')
        .send(stopItemBody)
        .expect(200);
    });
    it('should not update the progress, if isValidWatchTime is false', async () => {
      // Start the item progress
      const startItemBody: StartItemBody = {
        itemId: courseData.modules[0].sections[0].items[0].itemId,
        moduleId: courseData.modules[0].moduleId,
        sectionId: courseData.modules[0].sections[0].sectionId,
      };
      const startItemResponse = await request(app)
        .post(
          `/users/progress/courses/${courseData.courseId}/versions/${courseData.courseVersionId}/start`,
        )
        .set('Authorization', 'Bearer default')
        .send(startItemBody);

      // Watch-time validation happens inside /stop itself (there is no
      // separate /update endpoint) — mock it false so /stop rejects.
      vi.spyOn(ProgressService.prototype as any, 'isValidWatchTime')
        .mockReset()
        .mockReturnValueOnce(false);

      const stopItemBody: StopItemBody = {
        sectionId: courseData.modules[0].sections[0].sectionId,
        moduleId: courseData.modules[0].moduleId,
        itemId: courseData.modules[0].sections[0].items[0].itemId,
        watchItemId: startItemResponse.body.watchItemId,
      };

      const stopItemResponse = await request(app)
        .post(
          `/users/progress/courses/${courseData.courseId}/versions/${courseData.courseVersionId}/stop`,
        )
        .set('Authorization', 'Bearer default')
        .send(stopItemBody);

      expect(stopItemResponse.status).toBe(400);
      expect(stopItemResponse.body).toHaveProperty('name');
      expect(stopItemResponse.body.name).toBe('BadRequestError');
      expect(stopItemResponse.body).toHaveProperty('message');
      expect(stopItemResponse.body.message).toBe('Invalid watch time');
    });

    it('should update the progress, if watch time is actually greater than or equal to 0.5 times video length', async () => {
      // Start the item progress
      const startItemBody: StartItemBody = {
        itemId: courseData.modules[0].sections[0].items[0].itemId,
        moduleId: courseData.modules[0].moduleId,
        sectionId: courseData.modules[0].sections[0].sectionId,
      };
      const startItemResponse = await request(app)
        .post(
          `/users/progress/courses/${courseData.courseId}/versions/${courseData.courseVersionId}/start`,
        )
        .set('Authorization', 'Bearer default')
        .send(startItemBody)
        .expect(200);
      // Watch-time validation runs inside /stop itself, using whatever
      // record stopItemTracking() returns — not a separate /update call
      // (ProgressController has no PATCH .../update route). isValidWatchTime
      // is left unmocked here so its real >= 0.15*duration-or-30s threshold
      // actually runs; mock the repository call it reads from instead, so
      // the reported duration is long enough to satisfy that threshold
      // (a real instant start->stop in a test never accrues enough on its
      // own).
      const originalStop = ProgressRepository.prototype.stopItemTracking;
      vi.spyOn(
        ProgressRepository.prototype,
        'stopItemTracking',
      ).mockImplementation(async function (
        watchTimeId: string,
        session?: unknown,
      ) {
        const watchTime: IWatchTime = await originalStop.call(
          this,
          watchTimeId,
          session as never,
        );
        if (watchTime) {
          watchTime.startTime = new Date(
            watchTime.endTime.getTime() - 45 * 1000,
          );
        }
        return watchTime;
      });

      const stopItemBody: StopItemBody = {
        sectionId: courseData.modules[0].sections[0].sectionId,
        moduleId: courseData.modules[0].moduleId,
        itemId: courseData.modules[0].sections[0].items[0].itemId,
        watchItemId: startItemResponse.body.watchItemId,
      };

      const stopItemResponse = await request(app)
        .post(
          `/users/progress/courses/${courseData.courseId}/versions/${courseData.courseVersionId}/stop`,
        )
        .set('Authorization', 'Bearer default')
        .send(stopItemBody);
      expect(stopItemResponse.status).toBe(200);

      // fetch the progress of the user
      const progressResponse = await request(app)
        .get(
          `/users/progress/courses/${courseData.courseId}/versions/${courseData.courseVersionId}`,
        )
        .set('Authorization', 'Bearer default')
        .expect(200);

      // Expect the response to contain the progress data
      expect(progressResponse.body).toHaveProperty('userId');
      expect(progressResponse.body.userId).toBe(userIdUser);
      expect(progressResponse.body).toHaveProperty('courseId');
      expect(progressResponse.body.courseId).toBe(courseData.courseId);
      expect(progressResponse.body).toHaveProperty('courseVersionId');
      expect(progressResponse.body.courseVersionId).toBe(
        courseData.courseVersionId,
      );
      expect(progressResponse.body).toHaveProperty('currentModule');
      //expect currentItem to not be equal to itemId
      expect(progressResponse.body.currentModule).not.toBe(
        courseData.modules[0].sections[0].items[0].itemId,
      );
    });
  });

  describe('Reset Progress', () => {
    beforeAll(async () => {
      // Create a course with modules, sections, and items
      courseData = await createCourseWithModulesSectionsAndItems(3, 3, 4, app);

      // Create a user
      userIdUser = await createUser(app);

      // Create enrollment
      await createEnrollment(
        app,
        userIdUser as string,
        courseData.courseId,
        courseData.courseVersionId,
        courseData.modules[0].moduleId,
        courseData.modules[0].sections[0].sectionId,
        courseData.modules[0].sections[0].items[0].itemId,
      );
    });

    describe('Reset Entire Course Progress', () => {
      describe('Success Scenario', () => {
        it('should reset progress correctly for a user in a course', async () => {
          // Start and stop progress tracking (/stop also validates watch
          // time and advances progress — there is no separate /update call)
          const { startItemResponse, stopItemResponse } =
            await startStopAndUpdateProgress({
              userId: userIdUser as string,
              courseId: courseData.courseId,
              courseVersionId: courseData.courseVersionId,
              itemId: courseData.modules[0].sections[0].items[0].itemId,
              moduleId: courseData.modules[0].moduleId,
              sectionId: courseData.modules[0].sections[0].sectionId,
              app,
            });

          await verifyProgressInDatabase({
            userId: userIdUser as string,
            courseId: courseData.courseId,
            courseVersionId: courseData.courseVersionId,
            expectedModuleId: courseData.modules[0].moduleId,
            expectedSectionId: courseData.modules[0].sections[0].sectionId,
            expectedItemId: courseData.modules[0].sections[0].items[1].itemId,
            expectedCompleted: false,
            app,
          });

          // Reset the progress
          const resetResponse = await request(app)
            .patch(
              `/users/${userIdUser}/progress/courses/${courseData.courseId}/versions/${courseData.courseVersionId}/reset`,
            )
            .set('Authorization', 'Bearer default');

          expect(resetResponse.status).toBe(200);
          expect(resetResponse.body).toBe('');

          await verifyProgressInDatabase({
            userId: userIdUser as string,
            courseId: courseData.courseId,
            courseVersionId: courseData.courseVersionId,
            expectedModuleId: courseData.modules[0].moduleId,
            expectedSectionId: courseData.modules[0].sections[0].sectionId,
            expectedItemId: courseData.modules[0].sections[0].items[0].itemId,
            expectedCompleted: false,
            app,
          });
        });
      });
    });

    describe('Reset Progress to Module', () => {
      describe('Success Scenario', () => {
        it('should reset progress to module for a user in a course', async () => {
          const resetBody: ResetCourseProgressBody = {
            moduleId: courseData.modules[1].moduleId,
          };

          // Reset the progress
          const resetResponse = await request(app)
            .patch(
              `/users/${userIdUser}/progress/courses/${courseData.courseId}/versions/${courseData.courseVersionId}/reset`,
            )
            .set('Authorization', 'Bearer default')
            .send(resetBody);

          expect(resetResponse.status).toBe(200);
          expect(resetResponse.body).toBe('');

          await verifyProgressInDatabase({
            userId: userIdUser as string,
            courseId: courseData.courseId,
            courseVersionId: courseData.courseVersionId,
            expectedModuleId: courseData.modules[1].moduleId,
            expectedSectionId: courseData.modules[1].sections[0].sectionId,
            expectedItemId: courseData.modules[1].sections[0].items[0].itemId,
            expectedCompleted: false,
            app,
          });
        });
      });

      describe('Failure Scenarios', () => {
        it('should throw error message if moduleId is not in course', async () => {
          // Reset to module
          const resetBody: ResetCourseProgressBody = {
            moduleId: faker.database.mongodbObjectId(),
          };

          // Reset the progress
          const resetResponse = await request(app)
            .patch(
              `/users/${userIdUser}/progress/courses/${courseData.courseId}/versions/${courseData.courseVersionId}/reset`,
            )
            .set('Authorization', 'Bearer default')
            .send(resetBody)
            .expect(404);

          // ProgressService.resetCourseProgressToModule looks up the module via
          // the private findModule() helper, which throws this exact message
          // before initializeProgressToModule's own (unreachable) check runs.
          const expectedResponse = {
            name: 'NotFoundError',
            message: `Module not found: ${resetBody.moduleId}`,
          };

          expect(resetResponse.body).toMatchObject(expectedResponse);
        });
      });
    });

    describe('Reset Progress to Section', () => {
      describe('Success Scenario', () => {
        it('should reset progress to section correctly for a user in a course', async () => {
          const resetBody: ResetCourseProgressBody = {
            moduleId: courseData.modules[1].moduleId,
            sectionId: courseData.modules[1].sections[1].sectionId,
          };

          // Reset the progress
          const resetResponse = await request(app)
            .patch(
              `/users/${userIdUser}/progress/courses/${courseData.courseId}/versions/${courseData.courseVersionId}/reset`,
            )
            .set('Authorization', 'Bearer default')
            .send(resetBody);

          expect(resetResponse.status).toBe(200);
          expect(resetResponse.body).toBe('');

          await verifyProgressInDatabase({
            userId: userIdUser as string,
            courseId: courseData.courseId,
            courseVersionId: courseData.courseVersionId,
            expectedModuleId: courseData.modules[1].moduleId,
            expectedSectionId: courseData.modules[1].sections[1].sectionId,
            expectedItemId: courseData.modules[1].sections[1].items[0].itemId,
            expectedCompleted: false,
            app,
          });
        });
      });

      describe('Failure Scenarios', () => {
        it('should throw error message if both moduleId and sectionId are invalid', async () => {
          // Reset to module
          const resetBody: ResetCourseProgressBody = {
            moduleId: faker.database.mongodbObjectId(),
            sectionId: faker.database.mongodbObjectId(),
          };

          // Reset the progress
          const resetResponse = await request(app)
            .patch(
              `/users/${userIdUser}/progress/courses/${courseData.courseId}/versions/${courseData.courseVersionId}/reset`,
            )
            .set('Authorization', 'Bearer default')
            .send(resetBody)
            .expect(404);

          // findModule() runs before findSection(), so the invalid moduleId
          // is what actually surfaces here.
          const expectedResponse = {
            name: 'NotFoundError',
            message: `Module not found: ${resetBody.moduleId}`,
          };

          expect(resetResponse.body).toMatchObject(expectedResponse);
        });

        it('should throw error message if sectionId is not in module', async () => {
          // Reset to module
          const resetBody: ResetCourseProgressBody = {
            moduleId: courseData.modules[1].moduleId,
            sectionId: faker.database.mongodbObjectId(),
          };

          // Reset the progress
          const resetResponse = await request(app)
            .patch(
              `/users/${userIdUser}/progress/courses/${courseData.courseId}/versions/${courseData.courseVersionId}/reset`,
            )
            .set('Authorization', 'Bearer default')
            .send(resetBody)
            .expect(404);

          const expectedResponse = {
            name: 'NotFoundError',
            message: `Section not found: ${resetBody.sectionId}`,
          };

          expect(resetResponse.body).toMatchObject(expectedResponse);
        });
      });
    });

    describe('Reset Progress to Item', () => {
      describe('Success Scenario', () => {
        it('should reset progress to item correctly for a user in a course', async () => {
          const resetBody: ResetCourseProgressBody = {
            moduleId: courseData.modules[1].moduleId,
            sectionId: courseData.modules[1].sections[1].sectionId,
            itemId: courseData.modules[1].sections[1].items[2].itemId,
          };

          // Reset the progress
          const resetResponse = await request(app)
            .patch(
              `/users/${userIdUser}/progress/courses/${courseData.courseId}/versions/${courseData.courseVersionId}/reset`,
            )
            .set('Authorization', 'Bearer default')
            .send(resetBody);

          expect(resetResponse.status).toBe(200);
          expect(resetResponse.body).toBe('');

          await verifyProgressInDatabase({
            userId: userIdUser as string,
            courseId: courseData.courseId,
            courseVersionId: courseData.courseVersionId,
            expectedModuleId: courseData.modules[1].moduleId,
            expectedSectionId: courseData.modules[1].sections[1].sectionId,
            expectedItemId: courseData.modules[1].sections[1].items[2].itemId,
            expectedCompleted: false,
            app,
          });
        });
      });

      describe('Failure Scenarios', () => {
        it('should throw error message if moduleId, sectionId and itemId are invalid', async () => {
          // Reset to module
          const resetBody: ResetCourseProgressBody = {
            moduleId: faker.database.mongodbObjectId(),
            sectionId: faker.database.mongodbObjectId(),
            itemId: faker.database.mongodbObjectId(),
          };

          // Reset the progress
          const resetResponse = await request(app)
            .patch(
              `/users/${userIdUser}/progress/courses/${courseData.courseId}/versions/${courseData.courseVersionId}/reset`,
            )
            .set('Authorization', 'Bearer default')
            .send(resetBody)
            .expect(404);

          const expectedResponse = {
            name: 'NotFoundError',
            message: `Module not found: ${resetBody.moduleId}`,
          };

          expect(resetResponse.body).toMatchObject(expectedResponse);
        });

        it('should throw error message if sectionId is invalid/not in course', async () => {
          // Reset to module
          const resetBody: ResetCourseProgressBody = {
            moduleId: courseData.modules[1].moduleId,
            sectionId: faker.database.mongodbObjectId(),
            itemId: faker.database.mongodbObjectId(),
          };

          // Reset the progress
          const resetResponse = await request(app)
            .patch(
              `/users/${userIdUser}/progress/courses/${courseData.courseId}/versions/${courseData.courseVersionId}/reset`,
            )
            .set('Authorization', 'Bearer default')
            .send(resetBody)
            .expect(404);

          const expectedResponse = {
            name: 'NotFoundError',
            message: `Section not found: ${resetBody.sectionId}`,
          };

          expect(resetResponse.body).toMatchObject(expectedResponse);
        });

        it('should throw error message if itemId is invalid/not in section', async () => {
          // Reset to module
          const resetBody: ResetCourseProgressBody = {
            moduleId: courseData.modules[1].moduleId,
            sectionId: courseData.modules[1].sections[1].sectionId,
            itemId: faker.database.mongodbObjectId(),
          };

          // Reset the progress
          const resetResponse = await request(app)
            .patch(
              `/users/${userIdUser}/progress/courses/${courseData.courseId}/versions/${courseData.courseVersionId}/reset`,
            )
            .set('Authorization', 'Bearer default')
            .send(resetBody)
            .expect(404);

          const expectedResponse = {
            name: 'NotFoundError',
            message: 'Item not found in the specified section.',
          };

          expect(resetResponse.body).toMatchObject(expectedResponse);
        });
      });
    });
  });

  describe('Student Progress Simulation', () => {
    it('should simulate student completing the course item by item, section by section, and module by module', async () => {
      // Create a course with modules, sections, and items
      courseData = await createCourseWithModulesSectionsAndItems(3, 2, 3, app);

      // Create a user
      userIdUser = await createUser(app);

      // Create enrollment
      await createEnrollment(
        app,
        userIdUser as string,
        courseData.courseId,
        courseData.courseVersionId,
        courseData.modules[0].moduleId,
        courseData.modules[0].sections[0].sectionId,
        courseData.modules[0].sections[0].items[0].itemId,
      );

      // Start, Stop and Update Progress for each item in the course, section by section, module by module
      for (
        let moduleIndex = 0;
        moduleIndex < courseData.modules.length;
        moduleIndex++
      ) {
        const module = courseData.modules[moduleIndex];

        for (
          let sectionIndex = 0;
          sectionIndex < module.sections.length;
          sectionIndex++
        ) {
          const section = module.sections[sectionIndex];

          for (
            let itemIndex = 0;
            itemIndex < section.items.length;
            itemIndex++
          ) {
            const item = section.items[itemIndex];
            await startStopAndUpdateProgress({
              userId: userIdUser as string,
              courseId: courseData.courseId,
              courseVersionId: courseData.courseVersionId,
              itemId: item.itemId,
              moduleId: module.moduleId,
              sectionId: section.sectionId,
              app,
            });
          }
        }
      }

      // After completing all items in the course, verify the course completion
      await verifyProgressInDatabase({
        userId: userIdUser as string,
        courseId: courseData.courseId,
        courseVersionId: courseData.courseVersionId,
        // ProgressService.recalculateStudentProgress deliberately resets
        // currentModule/Section/Item back to the course's first item once
        // the course is fully completed (see its "currentItem reset to the
        // start" comment) — completed alone tracks finish status.
        expectedModuleId: courseData.modules[0].moduleId,
        expectedSectionId: courseData.modules[0].sections[0].sectionId,
        expectedItemId: courseData.modules[0].sections[0].items[0].itemId,
        expectedCompleted: true, // Course is completed after all modules are done
        app,
      });
    }); // Increased timeout for this test
  }, 600000);
});
