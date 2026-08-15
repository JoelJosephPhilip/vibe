import { coursesContainerModules, coursesModuleOptions, setupCoursesContainer } from '../index.js';
import { useExpressServer, useContainer, RoutingControllersOptions } from 'routing-controllers';
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
import Express from 'express';
import request from 'supertest';
import {
  createCourse,
  createModule,
  createSection,
  createVersion,
} from './utils/creationFunctions.js';
import { faker } from '@faker-js/faker';
import { ItemType } from '#shared/interfaces/models.js';
import { CreateItemBody } from '../classes/validators/ItemValidators.js';
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from 'vitest';
import { SignUpBody } from '#root/modules/auth/classes/validators/AuthValidators.js';
import * as CurrentUser from '#root/shared/functions/currentUserChecker.js'
import { InversifyAdapter } from '#root/inversify-adapter.js';
import { Container } from 'inversify';
import { CourseController } from '../controllers/CourseController.js';
import { CourseVersionController } from '../controllers/CourseVersionController.js';
import { ItemController } from '../controllers/ItemController.js';
import { ModuleController } from '../controllers/ModuleController.js';
import { SectionController } from '../controllers/SectionController.js';
import { AuthController } from '#root/modules/auth/controllers/AuthController.js';
import { EnrollmentController } from '#root/modules/users/controllers/EnrollmentController.js';
import { FirebaseAuthService } from '#root/modules/auth/services/FirebaseAuthService.js';
import { afterEach } from 'node:test';

const controllers: Function[] = [
  CourseController,
  CourseVersionController,
  ModuleController,
  SectionController,
  ItemController,
  AuthController,
  EnrollmentController
];

describe('Item Controller Integration Tests', () => {
  const App = Express();
  let app;
  let course;
  let version;
  let module;
  let section;
  let courseId: string;
  let versionId: string;
  let moduleId: string;
  let sectionId: string;


  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const container = new Container();
    await container.load(
      // coursesContainerModules already includes sharedContainerModule,
      // authContainerModule, usersContainerModule, quizzesContainerModule,
      // and notificationsContainerModule — re-adding them causes
      // "Ambiguous bindings" errors from inversify.
      ...coursesContainerModules,
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
    const db = container.get<MongoDatabase>(GLOBAL_TYPES.Database);
    await db.connect();
    const options: RoutingControllersOptions = {
      controllers: controllers,
      middlewares: coursesModuleOptions.middlewares,
      defaultErrorHandler: coursesModuleOptions.defaultErrorHandler,
      authorizationChecker: coursesModuleOptions.authorizationChecker,
      validation: coursesModuleOptions.validation,
    }
    app = useExpressServer(App, options);
  });

  beforeEach(async () => {
    // create a user and enroll him in a course as a teacher
    const email = faker.internet.email();
    const password = faker.internet.password();
    const firstName = faker.person.firstName().replace(/[^a-zA-Z]/g, '');
    const lastName = faker.person.lastName().replace(/[^a-zA-Z]/g, '');
    const signUpBody: SignUpBody = { email, password, firstName, lastName, recaptchaToken: 'mock-token' };

    const signUpResponse = await request(app)
      .post('/auth/signup')
      .send(signUpBody)
      .expect(201);

    const userId = signUpResponse.body.userId;
    vi.spyOn(CurrentUser, 'currentUserChecker').mockResolvedValue({
      _id: userId,
      firebaseUID: faker.string.uuid(),
      email,
      firstName,
      lastName,
      roles: 'admin',
    });
    // authorizationChecker (real, unmocked here) and @Ability() both verify
    // the bearer token via getCurrentUserFromToken — mock it too, so the
    // 'Bearer test-token' the helpers send resolves to an admin user.
    vi.spyOn(
      FirebaseAuthService.prototype,
      'getCurrentUserFromToken',
    ).mockResolvedValue({
      _id: userId,
      roles: 'admin',
    } as any);

    course = await createCourse(app);
    courseId = course._id.toString();
    version = await createVersion(app, courseId);
    versionId = version._id.toString();
    module = await createModule(app, versionId);
    moduleId = module.version.modules[0].moduleId.toString();
    section = await createSection(
      app,
      versionId,
      moduleId,
    );
    sectionId = section.version.modules[0].sections[0].sectionId.toString();

    // createCourse() already auto-enrolls its creator (userId) as
    // INSTRUCTOR — see CourseController.create / CourseService.createCourse —
    // so no separate enrollment call is needed here.
    vi.resetAllMocks();
    vi.spyOn(CurrentUser, 'currentUserChecker').mockResolvedValue({
      _id: userId,
      firebaseUID: faker.string.uuid(),
      email,
      firstName,
      lastName,
      roles: 'user',
    });
    // resetAllMocks above wipes the getCurrentUserFromToken spy — the real
    // authorizationChecker and @Ability() both need it re-established for
    // the test bodies that run after this beforeEach.
    vi.spyOn(
      FirebaseAuthService.prototype,
      'getCurrentUserFromToken',
    ).mockResolvedValue({
      _id: userId,
      roles: 'admin',
    } as any);
  });

  describe('ITEM CREATION', () => {
    describe('Success Scenario', () => {
      describe('Create Quiz Item', () => {
        it('should create a quiz item', async () => {
          const itemPayload: CreateItemBody = {
            name: faker.commerce.productName(),
            description: faker.commerce.productDescription(),
            type: ItemType.QUIZ,
            quizDetails: {
              questionVisibility: 3,
              allowPartialGrading: true,
              allowSkip: true,
              deadline: faker.date.future(),
              allowHint: true,
              maxAttempts: 5,
              releaseTime: faker.date.future(),
              quizType: 'DEADLINE',
              showCorrectAnswersAfterSubmission: true,
              showExplanationAfterSubmission: true,
              showScoreAfterSubmission: true,
              approximateTimeToComplete: '00:30:00',
              passThreshold: 0.7,
            },
          };

          const itemResponse = await request(app)
            .post(
              `/courses/versions/${versionId}/modules/${moduleId}/sections/${sectionId}/items`,
            )
            .set('Authorization', 'Bearer test-token')
            .send(itemPayload);
          expect(itemResponse.status).toBe(201);
          expect(itemResponse.body.itemsGroup.items.length).toBe(1);
        }, 90000);
      });
      describe('Create Video Item', () => {
        it('should create a video item', async () => {
          const itemPayload: CreateItemBody = {
            name: faker.commerce.productName(),
            description: faker.commerce.productDescription(),
            type: ItemType.VIDEO,
            videoDetails: {
              URL: 'http://url.com',
              startTime: '00:00:00',
              endTime: '00:00:40',
              points: 10.5,
            },
          };

          const itemsGroupResponse = await request(app)
            .post(
              `/courses/versions/${versionId}/modules/${moduleId}/sections/${sectionId}/items`,
            )
            .set('Authorization', 'Bearer test-token')
            .send(itemPayload);
          expect(itemsGroupResponse.status === 201);

          expect(itemsGroupResponse.body.itemsGroup.items.length).toBe(1);
        }, 90000);
      });
    });

    describe('Failure Scenario', () => {
      it('forbids creation of item if done by a student', async () => {
        const email = faker.internet.email();
        const password = faker.internet.password();
        const firstName = faker.person.firstName().replace(/[^a-zA-Z]/g, '');
        const lastName = faker.person.lastName().replace(/[^a-zA-Z]/g, '');
        const signUpBody: SignUpBody = { email, password, firstName, lastName, recaptchaToken: 'mock-token' };

        const signUpResponse = await request(app)
          .post('/auth/signup')
          .send(signUpBody)
          .expect(201);

        const newUserId = signUpResponse.body.userId;
        vi.spyOn(CurrentUser, 'currentUserChecker').mockResolvedValue({
          _id: newUserId,
          firebaseUID: faker.string.uuid(),
          email,
          firstName,
          lastName,
          roles: 'admin',
        });
        const enrollmentResponse = await request(app)
          .post(
            `/users/${newUserId}/enrollments/courses/${courseId}/versions/${versionId}`,
          )
          .set('Authorization', 'Bearer test-token')
          .send({
            role: 'STUDENT',
          });
        expect(enrollmentResponse.status).toBe(200);
        vi.resetAllMocks();
        vi.spyOn(CurrentUser, 'currentUserChecker').mockResolvedValue({
          _id: newUserId,
          firebaseUID: faker.string.uuid(),
          email,
          firstName,
          lastName,
          roles: 'user',
        });
        vi.spyOn(
          FirebaseAuthService.prototype,
          'getCurrentUserFromToken',
        ).mockResolvedValue({
          _id: newUserId,
          roles: 'user',
        } as any);
        // try to create an item as a student
        const itemPayload: CreateItemBody = {
          name: faker.commerce.productName(),
          description: faker.commerce.productDescription(),
          type: ItemType.QUIZ,
          quizDetails: {
            questionVisibility: 3,
            allowPartialGrading: true,
            allowSkip: true,
            deadline: faker.date.future(),
            allowHint: true,
            maxAttempts: 5,
            releaseTime: faker.date.future(),
            quizType: 'DEADLINE',
            showCorrectAnswersAfterSubmission: true,
            showExplanationAfterSubmission: true,
            showScoreAfterSubmission: true,
            approximateTimeToComplete: '00:30:00',
            passThreshold: 0.7,
          },
        };
        const itemResponse = await request(app)
          .post(
            `/courses/versions/${versionId}/modules/${moduleId}/sections/${sectionId}/items`,
          )
          .set('Authorization', 'Bearer test-token')
          .send(itemPayload)
          .expect(403);
      });
    });
  });

  describe('ITEM READALL', () => {
    const itemPayload1 = {
      name: 'ReadAll Item 1',
      description: faker.commerce.productDescription(),
      type: ItemType.QUIZ,
      quizDetails: {
        questionVisibility: 3,
        allowPartialGrading: true,
        allowSkip: true,
        deadline: faker.date.future(),
        allowHint: true,
        maxAttempts: 5,
        releaseTime: faker.date.future(),
        quizType: 'DEADLINE',
        showCorrectAnswersAfterSubmission: true,
        showExplanationAfterSubmission: true,
        showScoreAfterSubmission: true,
        approximateTimeToComplete: '00:30:00',
        passThreshold: 0.7,
      },
    };
    const itemPayload2 = {
      name: 'ReadAll Item 2',
      description: faker.commerce.productDescription(),
      type: ItemType.QUIZ,
      quizDetails: {
        questionVisibility: 3,
        allowPartialGrading: true,
        allowSkip: true,
        deadline: faker.date.future(),
        allowHint: true,
        maxAttempts: 5,
        releaseTime: faker.date.future(),
        quizType: 'DEADLINE',
        showCorrectAnswersAfterSubmission: true,
        showExplanationAfterSubmission: true,
        showScoreAfterSubmission: true,
        approximateTimeToComplete: '00:30:00',
        passThreshold: 0.7,
      },
    };

    it('should read all items in a section', async () => {
      // Add two items
      const item1 = await request(app)
        .post(
          `/courses/versions/${versionId}/modules/${moduleId}/sections/${sectionId}/items`,
        )
        .set('Authorization', 'Bearer test-token')
        .send(itemPayload1)
        .expect(201);

      const item2 = await request(app)
        .post(
          `/courses/versions/${versionId}/modules/${moduleId}/sections/${sectionId}/items`,
        )
        .set('Authorization', 'Bearer test-token')
        .send(itemPayload2)
        .expect(201);

      // Read all items
      const readAllResponse = await request(app)
        .get(
          `/courses/versions/${versionId}/modules/${moduleId}/sections/${sectionId}/items`,
        )
        .set('Authorization', 'Bearer test-token')
        .expect(200);
      expect(readAllResponse.body.length).toBeGreaterThanOrEqual(2);
      const ids = readAllResponse.body.map(i => i._id);
      expect(ids).toContain(item1.body.itemsGroup.items[0]._id);
      expect(ids).toContain(item2.body.itemsGroup.items[0]._id);
    }, 90000);
  });

  describe('ITEM UPDATION', () => {
    const itemPayload: CreateItemBody = {
      name: faker.commerce.productName(),
      description: faker.commerce.productDescription(),
      type: ItemType.QUIZ,
      quizDetails: {
        questionVisibility: 3,
        allowPartialGrading: true,
        deadline: faker.date.future(),
        allowSkip: true,
        allowHint: true,
        maxAttempts: 5,
        releaseTime: faker.date.future(),
        quizType: 'DEADLINE',
        showCorrectAnswersAfterSubmission: true,
        showExplanationAfterSubmission: true,
        showScoreAfterSubmission: true,
        approximateTimeToComplete: '00:30:00',
        passThreshold: 0.7,
      },
    };

    it('should update an item in a section', async () => {
      // Add item
      const itemResponse = await request(app)
        .post(
          `/courses/versions/${versionId}/modules/${moduleId}/sections/${sectionId}/items`,
        )
        .set('Authorization', 'Bearer test-token')
        .send(itemPayload)
        .expect(201);

      const itemId = itemResponse.body.itemsGroup.items[0]._id;

      // Update item
      // UpdateItemBody (unlike CreateItemBody) nests type-specific details
      // under `details`, not `quizDetails`/`videoDetails`/etc.
      const updatePayload = {
        name: 'Updated Item Name',
        description: 'Updated Item Description',
        type: ItemType.QUIZ,
        details: {
          questionVisibility: 3,
          allowPartialGrading: true,
          allowSkip: true,
          deadline: faker.date.future(),
          allowHint: true,
          maxAttempts: 5,
          releaseTime: faker.date.future(),
          quizType: 'DEADLINE',
          showCorrectAnswersAfterSubmission: true,
          showExplanationAfterSubmission: true,
          showScoreAfterSubmission: true,
          approximateTimeToComplete: '00:30:00',
          passThreshold: 0.7,
        },
      };

      const updateResponse = await request(app)
        .put(`/courses/${courseId}/versions/${versionId}/items/${itemId}`)
        .set('Authorization', 'Bearer test-token')
        .send(updatePayload)
        .expect(200);

      // updateItem returns the updated item directly (not wrapped in an
      // itemsGroup, unlike create/readAll).
      expect(updateResponse.body.name).toBe(updatePayload.name);
      expect(updateResponse.body.description).toBe(
        updatePayload.description,
      );
    }, 90000);
  });

  describe('ITEM DELETION', () => {
    describe('Success Scenario', () => {
      const coursePayload = {
        name: 'New Course',
        description: 'Course description',
      };

      const courseVersionPayload = {
        version: 'New Course Version',
        description: 'Course version description',
      };

      const modulePayload = {
        name: 'New Module',
        description: 'Module description',
      };

      const sectionPayload = {
        name: 'New Section',
        description: 'Section description',
      };

      const itemPayload: CreateItemBody = {
        name: faker.commerce.productName(),
        description: faker.commerce.productDescription(),
        type: ItemType.QUIZ,
        quizDetails: {
          questionVisibility: 3,
          allowPartialGrading: true,
          allowSkip: true,
          deadline: faker.date.future(),
          allowHint: true,
          maxAttempts: 5,
          releaseTime: faker.date.future(),
          quizType: 'DEADLINE',
          showCorrectAnswersAfterSubmission: true,
          showExplanationAfterSubmission: true,
          showScoreAfterSubmission: true,
          approximateTimeToComplete: '00:30:00',
          passThreshold: 0.7,
        },
      };

      it('should delete an item', async () => {
        vi.spyOn(CurrentUser, 'currentUserChecker').mockResolvedValue({
          _id: faker.database.mongodbObjectId(),
          firebaseUID: faker.string.uuid(),
          email: faker.internet.email(),
          firstName: faker.person.firstName(),
          lastName: faker.person.lastName(),
          roles: 'admin',
        });
        const itemsGroupId =
          section.version.modules[0].sections[0].itemsGroupId.toString();

        const itemsGroupResponse = await request(app)
          .post(
            `/courses/versions/${versionId}/modules/${moduleId}/sections/${sectionId}/items`,
          )
          .set('Authorization', 'Bearer test-token')
          .send(itemPayload)
          .expect(201);

        const itemsResponse = await request(app)
          .delete(
            `/courses/${courseId}/itemGroups/${itemsGroupId}/items/${itemsGroupResponse.body.itemsGroup.items[0]._id}`,
          )
          .set('Authorization', 'Bearer test-token')
          .expect(200);

        expect(itemsResponse.body.deletedItemId).toBe(
          itemsGroupResponse.body.itemsGroup.items[0]._id,
        );
      }, 90000);
    });

    describe('Failiure Scenario', () => {
      it('should fail to delete an item', async () => {
        vi.spyOn(CurrentUser, 'currentUserChecker').mockResolvedValue({
          _id: faker.database.mongodbObjectId(),
          firebaseUID: faker.string.uuid(),
          email: faker.internet.email(),
          firstName: faker.person.firstName(),
          lastName: faker.person.lastName(),
          roles: 'admin',
        });
        // Testing for Invalid params

        const itemsResponse = await request(app)
          .delete(`/courses/${courseId}/itemGroups/123/items/123`)
          .set('Authorization', 'Bearer test-token')
          .expect(400);
      }, 90000);

      it('should fail to delete an item', async () => {
        vi.spyOn(CurrentUser, 'currentUserChecker').mockResolvedValue({
          _id: faker.database.mongodbObjectId(),
          firebaseUID: faker.string.uuid(),
          email: faker.internet.email(),
          firstName: faker.person.firstName(),
          lastName: faker.person.lastName(),
          roles: 'admin',
        });
        // Testing for Not found Case
        const itemsResponse = await request(app)
          .delete(
            '/courses/itemGroups/62341aeb5be816967d8fc2db/items/62341aeb5be816967d8fc2db',
          )
          .set('Authorization', 'Bearer test-token')
          .expect(404);
      }, 90000);
    });
  });

  describe('ITEM MOVE', () => {
    describe('Success Scenario', () => {
      const itemPayload1 = {
        name: 'Item 1',
        description: faker.commerce.productDescription(),
        type: ItemType.QUIZ,
        quizDetails: {
          questionVisibility: 3,
          allowPartialGrading: true,
          allowSkip: true,
          deadline: faker.date.future(),
          allowHint: true,
          maxAttempts: 5,
          releaseTime: faker.date.future(),
          quizType: 'DEADLINE',
          showCorrectAnswersAfterSubmission: true,
          showExplanationAfterSubmission: true,
          showScoreAfterSubmission: true,
          approximateTimeToComplete: '00:30:00',
          passThreshold: 0.7,
        },
      };
      const itemPayload2 = {
        name: 'Item 2',
        description: faker.commerce.productDescription(),
        type: ItemType.QUIZ,
        quizDetails: {
          questionVisibility: 3,
          allowPartialGrading: true,
          deadline: faker.date.future(),
          allowHint: true,
          maxAttempts: 5,
          allowSkip: true,
          releaseTime: faker.date.future(),
          quizType: 'DEADLINE',
          showCorrectAnswersAfterSubmission: true,
          showExplanationAfterSubmission: true,
          showScoreAfterSubmission: true,
          approximateTimeToComplete: '00:30:00',
          passThreshold: 0.7,
        },
      };

      it('should move an item after another item', async () => {
        // Add two items
        const item1Response = await request(app)
          .post(
            `/courses/versions/${versionId}/modules/${moduleId}/sections/${sectionId}/items`,
          )
          .set('Authorization', 'Bearer test-token')
          .send(itemPayload1)
          .expect(201);
        const item1Id = item1Response.body.itemsGroup.items[0]._id;

        const item2Response = await request(app)
          .post(
            `/courses/versions/${versionId}/modules/${moduleId}/sections/${sectionId}/items`,
          )
          .set('Authorization', 'Bearer test-token')
          .send(itemPayload2)
          .expect(201);
        const item2Id = item2Response.body.itemsGroup.items[1]._id;

        // Move item2 before item1
        const moveResponse = await request(app)
          .put(
            `/courses/versions/${versionId}/modules/${moduleId}/sections/${sectionId}/items/${item2Id}/move`,
          )
          .set('Authorization', 'Bearer test-token')
          .send({ beforeItemId: item1Id })
          .expect(200);

        const items = moveResponse.body.itemsGroup.items;
        expect(items.length).toBe(2);

        const idx1 = items.findIndex(i => i._id === item1Id);
        const idx2 = items.findIndex(i => i._id === item2Id);

        // item2 should now be before item1
        expect(idx2).toBeLessThan(idx1);
      }, 90000);

      it('should move the third item before the first item in a list of three', async () => {
        // Add three items
        const item1Response = await request(app)
          .post(
            `/courses/versions/${versionId}/modules/${moduleId}/sections/${sectionId}/items`,
          )
          .set('Authorization', 'Bearer test-token')
          .send(itemPayload1)
          .expect(201);
        const item1Id = item1Response.body.itemsGroup.items[0]._id;

        const item2Response = await request(app)
          .post(
            `/courses/versions/${versionId}/modules/${moduleId}/sections/${sectionId}/items`,
          )
          .set('Authorization', 'Bearer test-token')
          .send(itemPayload2)
          .expect(201);
        const item2Id = item2Response.body.itemsGroup.items[1]._id;

        const itemPayload3: CreateItemBody = {
          name: 'Item3',
          description: faker.commerce.productDescription(),
          type: ItemType.QUIZ,
          quizDetails: {
            questionVisibility: 3,
            allowPartialGrading: true,
            deadline: faker.date.future(),
            allowHint: true,
            allowSkip: true,
            maxAttempts: 5,
            releaseTime: faker.date.future(),
            quizType: 'DEADLINE',
            showCorrectAnswersAfterSubmission: true,
            showExplanationAfterSubmission: true,
            showScoreAfterSubmission: true,
            approximateTimeToComplete: '00:30:00',
            passThreshold: 0.7,
          },
        };

        const item3Response = await request(app)
          .post(
            `/courses/versions/${versionId}/modules/${moduleId}/sections/${sectionId}/items`,
          )
          .set('Authorization', 'Bearer test-token')
          .send(itemPayload3)
          .expect(201);
        const item3Id = item3Response.body.itemsGroup.items[2]._id;

        // Move item3 before item1
        const moveResponse = await request(app)
          .put(
            `/courses/versions/${versionId}/modules/${moduleId}/sections/${sectionId}/items/${item3Id}/move`,
          )
          .set('Authorization', 'Bearer test-token')
          .send({ beforeItemId: item1Id })
          .expect(200);

        const items = moveResponse.body.itemsGroup.items;
        expect(items.length).toBe(3);

        const idx1 = items.findIndex(i => i._id === item1Id);
        const idx2 = items.findIndex(i => i._id === item2Id);
        const idx3 = items.findIndex(i => i._id === item3Id);

        // item3 should now be before item1
        expect(idx3).toBeLessThan(idx1);
      }, 90000);
    });
  });
  describe('ITEM SERVICE ERROR PATHS', () => {
    // Mock the authorization checker to always return true
    vi.resetAllMocks();
    let itemsGroupId: string;
    const itemPayload: CreateItemBody = {
      name: faker.commerce.productName(),
      description: faker.commerce.productDescription(),
      type: ItemType.QUIZ,
      quizDetails: {
        questionVisibility: 3,
        allowPartialGrading: true,
        allowSkip: true,
        deadline: faker.date.future(),
        allowHint: true,
        maxAttempts: 5,
        releaseTime: faker.date.future(),
        quizType: 'DEADLINE',
        showCorrectAnswersAfterSubmission: true,
        showExplanationAfterSubmission: true,
        showScoreAfterSubmission: true,
        approximateTimeToComplete: '00:30:00',
        passThreshold: 0.7,
      },
    };
    beforeEach(async () => {
      const errorPathUserId = faker.database.mongodbObjectId();
      vi.spyOn(CurrentUser, 'currentUserChecker').mockResolvedValue({
        _id: errorPathUserId,
        firebaseUID: faker.string.uuid(),
        email: faker.internet.email(),
        firstName: faker.person.firstName(),
        lastName: faker.person.lastName(),
        roles: 'admin',
      });
      vi.spyOn(
        FirebaseAuthService.prototype,
        'getCurrentUserFromToken',
      ).mockResolvedValue({
        _id: errorPathUserId,
        roles: 'admin',
      } as any);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    })

    it('should return 404 if version does not exist on createItem', async () => {
      await request(app)
        .post(
          `/courses/versions/62341aeb5be816967d8fc2db/modules/${moduleId}/sections/${sectionId}/items`,
        )
        .set('Authorization', 'Bearer test-token')
        .send(itemPayload)
        .expect(404);
    }, 90000);

    it('should return 404 if section does not exist on createItem', async () => {
      await request(app)
        .post(
          `/courses/versions/${versionId}/modules/${moduleId}/sections/62341aeb5be816967d8fc2db/items`,
        )
        .set('Authorization', 'Bearer test-token')
        .send(itemPayload)
        .expect(404);
    }, 90000);

    it('should return 400 if invalid item payload on createItem', async () => {
      await request(app)
        .post(
          `/courses/versions/${versionId}/modules/${moduleId}/sections/${sectionId}/items`,
        )
        .set('Authorization', 'Bearer test-token')
        .send({}) // missing required fields
        .expect(400);
    }, 90000);

    it('should return 400 if version does not exist on updateItem', async () => {
      await request(app)
        .put(`/courses/${courseId}/versions/fakeVersionId/items/fakeItemId`)
        .set('Authorization', 'Bearer test-token')
        .send({ name: 'x' })
        .expect(400);
    }, 90000);

    it('should return 400 if item does not exist on updateItem', async () => {
      await request(app)
        .put(`/courses/${courseId}/versions/${versionId}/items/fakeItemId`)
        .set('Authorization', 'Bearer test-token')
        .send({ name: 'x' })
        .expect(400);
    }, 90000);

    it('should return 400 if invalid payload on updateItem', async () => {
      await request(app)
        .put(`/courses/${courseId}/versions/${versionId}/items/fakeItemId`)
        .set('Authorization', 'Bearer test-token')
        .send({}) // missing required fields
        .expect(400);
    }, 90000);

    it('should return 400 if invalid itemGroupId or itemId on deleteItem', async () => {
      await request(app)
        .delete(`/courses/${courseId}/itemGroups/123/items/123`)
        .set('Authorization', 'Bearer test-token')
        .expect(400);
    }, 90000);

    it('should return 400 if item not found on deleteItem', async () => {
      await request(app)
        .delete(`/courses/${courseId}/itemGroups/${itemsGroupId}/items/fakeItemId`)
        .set('Authorization', 'Bearer test-token')
        .expect(400);
    }, 90000);

    it('should return 400 if neither afterItemId nor beforeItemId is provided in moveItem', async () => {
      await request(app)
        .put(
          `/courses/versions/${versionId}/modules/${moduleId}/sections/${sectionId}/items/fakeItemId/move`,
        )
        .set('Authorization', 'Bearer test-token')
        .send({})
        .expect(400);
    }, 90000);

    it('should return 400 if item isnt in that version or module', async () => {
      await request(app)
        .put(
          `/courses/versions/${versionId}/modules/${moduleId}/sections/${sectionId}/items/fakeItemId/move`,
        )
        .set('Authorization', 'Bearer test-token')
        .send({ beforeItemId: '62341aeb5be816967d8fc2db' })
        .expect(400);
    }, 90000);
  });
});
