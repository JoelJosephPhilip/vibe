import request from 'supertest';
import Express from 'express';
import {useContainer, useExpressServer} from 'routing-controllers';
import {authModuleOptions} from '#auth/index.js';
import {coursesModuleOptions} from '#courses/index.js';
import {usersModuleOptions} from '../index.js';
import {InversifyAdapter} from '#root/inversify-adapter.js';
import {setContainer} from '#root/bootstrap/loadModules.js';
import {Container} from 'inversify';
import {sharedContainerModule} from '#root/container.js';
import {authContainerModule} from '#auth/container.js';
import {coursesContainerModule} from '#courses/container.js';
import {usersContainerModule} from '../container.js';
import {quizzesContainerModule} from '#root/modules/quizzes/container.js';
import {notificationsContainerModule} from '#root/modules/notifications/container.js';
import {anomaliesContainerModule} from '#root/modules/anomalies/container.js';
import {settingContainerModule} from '#root/modules/setting/container.js';
import {courseRegistrationContainerModule} from '#root/modules/courseRegistration/container.js';
import {projectsContainerModule} from '#root/modules/projects/container.js';
import {reportsContainerModule} from '#root/modules/reports/container.js';
import {hpSystemContainerModule} from '#root/modules/hpSystem/container.js';
import {ejectionPolicyContainerModule} from '#root/modules/ejectionPolicy/container.js';
import {emotionsContainerModule} from '#root/modules/emotions/container.js';
import {genAIContainerModule} from '#root/modules/genAI/container.js';
import {studentQuestionsContainerModule} from '#root/modules/studentQuestions/container.js';
import {announcementsContainerModule} from '#root/modules/announcements/container.js';
import {auditTrailsContainerModule} from '#root/modules/auditTrails/container.js';
import {GLOBAL_TYPES} from '#root/types.js';
import {MongoDatabase} from '#root/shared/database/providers/mongo/MongoDatabase.js';
import {USERS_TYPES} from '../types.js';
import {UserRepository} from '#shared/database/providers/mongo/repositories/UserRepository.js';
import {ProgressRepository} from '#shared/database/providers/mongo/repositories/ProgressRepository.js';
import {ProgressService} from '../services/ProgressService.js';
import {IWatchTime, ItemType} from '#shared/interfaces/models.js';
import {CreateItemBody} from '#courses/classes/validators/index.js';
import {Collection, ObjectId} from 'mongodb';
import {faker} from '@faker-js/faker';
import {FirebaseAuthService} from '#root/modules/auth/services/FirebaseAuthService.js';
import {describe, it, expect, beforeAll, vi} from 'vitest';
import {createEnrollment} from './utils/createEnrollment.js';

/**
 * D-07 end-to-end regression: recoverOrphanedWatchTimes must close an
 * abandoned BLOG session even when it never received a single heartbeat
 * (ProgressService.ts ~3058, "BLOG is the one exception to needing a
 * heartbeat at all"). VIDEO must NOT get this treatment -- with no
 * heartbeat at all there's no evidence of watch time to judge a video
 * completion against, so it should stay skipped, exactly like before the
 * fix.
 *
 * Drives real course/item/enrollment creation through the real DI
 * container and real HTTP layer, inserts a genuinely orphaned watchTime
 * document directly (no endTime, no lastSeenAt, old startTime -- the
 * "browser died before the first 15s heartbeat" scenario), then calls the
 * real recoverOrphanedWatchTimes against a real MongoDB transaction.
 */
describe('ProgressService.recoverOrphanedWatchTimes — BLOG heartbeat exception (D-07)', {timeout: 90000}, () => {
  const appInstance = Express();
  let app;
  let userRepo: UserRepository;
  let progressService: ProgressService;
  let progressRepo: ProgressRepository;
  let watchTimeCollection: Collection<IWatchTime>;
  const testTokenUserId = faker.database.mongodbObjectId();

  beforeAll(async () => {
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
      auditTrailsContainerModule,
    );
    const inversifyAdapter = new InversifyAdapter(container);
    useContainer(inversifyAdapter);
    setContainer(container);
    const db = container.get<MongoDatabase>(GLOBAL_TYPES.Database);
    await db.connect();

    userRepo = container.get<UserRepository>(GLOBAL_TYPES.UserRepo);
    progressService = container.get<ProgressService>(
      USERS_TYPES.ProgressService,
    );
    progressRepo = container.get<ProgressRepository>(USERS_TYPES.ProgressRepo);
    watchTimeCollection = await db.getCollection<IWatchTime>('watchTime');

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

  });

  // 'test-token' resolves to testTokenUserId directly (no DB user needed --
  // matches ProgressController.test.ts's pattern), used for course/module/
  // section/item authoring. Each student's own identity is mocked per-orphan
  // below, since a fresh student is created per test.
  async function setupAuthMocks(studentUserId: string) {
    vi.spyOn(
      FirebaseAuthService.prototype,
      'getUserIdFromReq',
    ).mockImplementation(async () => studentUserId);
    vi.spyOn(
      FirebaseAuthService.prototype,
      'getCurrentUserFromToken',
    ).mockImplementation(async (token: string): Promise<any> => {
      if (token === 'test-token') {
        return {_id: testTokenUserId, roles: 'admin'};
      }
      return {_id: studentUserId, roles: 'user'};
    });
  }

  /**
   * Builds a 1-module/1-section/1-item course of the given type, enrolls a
   * fresh student with currentItem pointed at it, and inserts a genuinely
   * orphaned watchTime row for that item: started an hour ago, never
   * received a heartbeat, never stopped.
   */
  async function setupOrphan(itemType: 'VIDEO' | 'BLOG') {
    const studentUserId = await userRepo.create({
      firebaseUID: faker.string.uuid(),
      email: faker.internet.email(),
      firstName: faker.person.firstName(),
      lastName: faker.person.lastName(),
      roles: 'user',
    });
    await setupAuthMocks(studentUserId);

    const courseRes = await request(app)
      .post('/courses')
      .send({
        name: faker.commerce.productName(),
        description: faker.commerce.productDescription(),
        versionName: 'Version 1',
        versionDescription: 'Initial version',
      })
      .set('Authorization', 'Bearer test-token')
      .expect(201);
    const courseId = courseRes.body._id;

    const versionRes = await request(app)
      .post(`/courses/${courseId}/versions`)
      .send({version: '1.0', description: 'Initial version'})
      .set('Authorization', 'Bearer test-token')
      .expect(201);
    const versionId = versionRes.body._id;

    const moduleRes = await request(app)
      .post(`/courses/versions/${versionId}/modules`)
      .send({name: faker.commerce.productName(), description: 'module'})
      .set('Authorization', 'Bearer test-token')
      .expect(201);
    const moduleId = moduleRes.body.version.modules[0].moduleId;

    const sectionRes = await request(app)
      .post(
        `/courses/versions/${versionId}/modules/${moduleId}/sections`,
      )
      .send({name: faker.commerce.productName(), description: 'section'})
      .set('Authorization', 'Bearer test-token')
      .expect(201);
    const sectionId = sectionRes.body.version.modules[0].sections[0].sectionId;

    const itemPayload: CreateItemBody =
      itemType === 'BLOG'
        ? ({
            name: faker.commerce.productName(),
            description: faker.commerce.productDescription(),
            type: ItemType.BLOG,
            blogDetails: {
              content: 'Sample blog content for D-07 recovery test.',
              estimatedReadTimeInMinutes: 2,
              // BlogDetailsPayloadValidator.tags is @IsEmpty() -- despite the
              // name, that requires the value be undefined/null/'', not `[]`
              // (a non-empty-type array still fails it). Must be omitted.
              tags: undefined as unknown as string[],
              // .points is @IsDecimal(), unlike video's @IsNumber() -- a raw
              // number fails validation here.
              points: '10.00' as unknown as number,
            },
          } as CreateItemBody)
        : ({
            name: faker.commerce.productName(),
            description: faker.commerce.productDescription(),
            type: ItemType.VIDEO,
            videoDetails: {
              URL: faker.internet.url(),
              startTime: '00:00:00',
              endTime: '00:10:00',
              points: 10,
            },
          } as CreateItemBody);

    const itemRes = await request(app)
      .post(
        `/courses/versions/${versionId}/modules/${moduleId}/sections/${sectionId}/items`,
      )
      .send(itemPayload)
      .set('Authorization', 'Bearer test-token')
      .expect(201);
    const itemId = itemRes.body.itemsGroup.items[0]._id;

    await createEnrollment(
      app,
      studentUserId,
      courseId,
      versionId,
      moduleId,
      sectionId,
      itemId,
    );

    // The orphan: started an hour ago, no lastSeenAt (never got a single
    // heartbeat), never stopped. Directly inserted rather than driven
    // through /start + waiting a real hour.
    const watchTimeDoc: IWatchTime = {
      userId: new ObjectId(studentUserId),
      courseId: new ObjectId(courseId),
      courseVersionId: new ObjectId(versionId),
      itemId: new ObjectId(itemId),
      startTime: new Date(Date.now() - 60 * 60 * 1000),
    } as IWatchTime;
    const insertResult = await watchTimeCollection.insertOne(watchTimeDoc);

    return {
      studentUserId,
      courseId,
      versionId,
      itemId,
      watchTimeId: insertResult.insertedId,
    };
  }

  it('BLOG: closes an orphaned session with zero heartbeats and completes the course', async () => {
    const {studentUserId, courseId, versionId, itemId, watchTimeId} =
      await setupOrphan('BLOG');

    const result = await progressService.recoverOrphanedWatchTimes(0, 500);
    expect(result.scanned).toBeGreaterThanOrEqual(1);

    const record = await watchTimeCollection.findOne({_id: watchTimeId});
    expect(record?.endTime).toBeDefined();

    const progress = await progressRepo.findProgress(
      studentUserId,
      courseId,
      versionId,
    );
    expect(progress?.completed).toBe(true);
  });

  it('VIDEO: leaves an orphaned session with zero heartbeats untouched', async () => {
    const {studentUserId, courseId, versionId, watchTimeId} =
      await setupOrphan('VIDEO');

    const result = await progressService.recoverOrphanedWatchTimes(0, 500);
    expect(result.scanned).toBeGreaterThanOrEqual(1);

    // No heartbeat means no evidence of watch time -- must stay open,
    // exactly like before the D-07 fix (this path is unchanged by it).
    const record = await watchTimeCollection.findOne({_id: watchTimeId});
    expect(record?.endTime).toBeUndefined();

    const progress = await progressRepo.findProgress(
      studentUserId,
      courseId,
      versionId,
    );
    expect(progress?.completed).toBe(false);
  });
});
