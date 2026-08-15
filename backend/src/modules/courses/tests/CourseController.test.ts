import request from 'supertest';
import Express from 'express';
import {Action, RoutingControllersOptions, useContainer, useExpressServer} from 'routing-controllers';
import {faker} from '@faker-js/faker';
import {CourseBody} from '../classes/validators/CourseValidators.js';
import {describe, it, beforeEach, beforeAll, expect, vi, afterEach, afterAll} from 'vitest';
import {coursesContainerModules, coursesModuleOptions, setupCoursesContainer} from '../index.js';
import { InversifyAdapter } from '#root/inversify-adapter.js';
import { Container } from 'inversify';
import * as Current from '#root/shared/functions/currentUserChecker.js';
import { FirebaseAuthService } from '#root/modules/auth/services/FirebaseAuthService.js';
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

describe('Course Controller Integration Tests', () => {
  const App = Express();
  let app;
  let currentUserCheckerSpy;

  const user1 = {
    _id: faker.database.mongodbObjectId(),
    firebaseUID: faker.string.uuid(),
    email: faker.internet.email(),
    firstName: faker.person.firstName(),
    lastName: faker.person.lastName(),
    roles: 'admin',
  };
  const user2 = {
    _id: faker.database.mongodbObjectId(),
    firebaseUID: faker.string.uuid(),
    email: faker.internet.email(),
    firstName: faker.person.firstName(),
    lastName: faker.person.lastName(),
    roles: 'user',
  };

  beforeAll(async () => {
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

    // Create the spy BEFORE using it in options
    currentUserCheckerSpy = vi.spyOn(Current, 'currentUserChecker').mockImplementation(
      async (action: Action) => {
        if (action.request.headers.authorization) {
          const token = action.request.headers.authorization.split(' ')[1];
          if (token === 'user1') {
            return user1;
          } else if (token === 'user2') {
            return user2;
          }
        }
        return user2;
      }
    );

    // The real authorizationChecker and @Ability() (unlike currentUserChecker
    // above) verify the bearer token via getCurrentUserFromToken — mock it
    // too, keyed the same way, so 'Bearer user1'/'Bearer user2' resolve.
    vi.spyOn(
      FirebaseAuthService.prototype,
      'getCurrentUserFromToken',
    ).mockImplementation(async (token: string) => {
      if (token === 'user1') return user1 as any;
      if (token === 'user2') return user2 as any;
      return user2 as any;
    });

    const options: RoutingControllersOptions = {
      controllers: coursesModuleOptions.controllers,
      middlewares: coursesModuleOptions.middlewares,
      defaultErrorHandler: coursesModuleOptions.defaultErrorHandler,
      authorizationChecker: coursesModuleOptions.authorizationChecker,
      currentUserChecker: Current.currentUserChecker, // Use the spied function
      validation: coursesModuleOptions.validation,
    }

    app = useExpressServer(App, options);
  });

  afterEach(() => {
    // Don't restore all mocks, just clear the call history
    currentUserCheckerSpy.mockClear();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  })

  describe('COURSE CREATION', () => {
    describe('Success Scenario', () => {
      it('should create a course', async () => {
        const coursePayload: CourseBody = {
          name: 'New Course',
          description: 'Course description',
          versionName: 'Version 1',
          versionDescription: 'Initial version',
        };

        const response = await request(app)
          .post('/courses/')
          .set('Authorization', 'Bearer user1')
          .send(coursePayload)
          .expect(201);

        expect(response.body.name).toBe('New Course');
        expect(response.body.description).toBe('Course description');
        expect(response.body._id).toBeDefined();
      }, 60000);
    });

    describe('Errors Scenarios', () => {
      it('returns 403 for a non admin user', async () => {
        const coursePayload: CourseBody = {
          name: 'New Course',
          description: 'Course description',
          versionName: 'Version 1',
          versionDescription: 'Initial version',
        };

        const response = await request(app)
          .post('/courses/')
          .set('Authorization', 'Bearer user2') // Non-admin user
          .send(coursePayload)
          .expect(403);

        expect(response.body.message).toContain(
          'You do not have permission to create courses',
        );
      })
      it('should return 400 for invalid course data', async () => {
        const invalidPayload = {name: ''};

        const response = await request(app)
          .post('/courses/')
          .set('Authorization', 'Bearer user1') // Add authorization header
          .send(invalidPayload)
          .expect(400);
        expect(response.body.message).toContain(
          "Invalid body, check 'errors' property for more info.",
        );
      }, 60000);
    });
  });

  // Add authorization headers to all your other tests
  describe('COURSE RETRIEVAL', () => {
    describe('Success Scenario', () => {
      it('should read a course by ID', async () => {
        const coursePayload = {
          name: 'Existing Course',
          description: 'Course description',
          versionName: 'Version 1',
          versionDescription: 'Initial version',
        };

        const createdCourseResponse = await request(app)
          .post('/courses/')
          .set('Authorization', 'Bearer user1')
          .send(coursePayload)
          .expect(201);

        const courseId = createdCourseResponse.body._id;

        const response = await request(app)
          .get(`/courses/${courseId}`)
          .set('Authorization', 'Bearer user1')
          .expect(200);

        expect(response.body.name).toBe('Existing Course');
        expect(response.body.description).toBe('Course description');
        expect(response.body._id).toBe(courseId);
      }, 60000);
    });

    describe('Error Scenarios', () => {
      it('should return 404 for a non-existing course', async () => {
        const response = await request(app)
          .get(`/courses/${faker.database.mongodbObjectId()}`)
          .set('Authorization', 'Bearer user1')
          .expect(404);
        expect(response.body.message).toContain(
          'No course found with the specified ID. Please verify the ID and try again.',
        );
      }, 60000);
    });
  });

  describe('COURSE UPDATION', () => {
    describe('Success Scenario', () => {
      it('should update a course by ID', async () => {
        const coursePayload = {
          name: 'Existing Course',
          description: 'Course description',
          versionName: 'Version 1',
          versionDescription: 'Initial version',
        };

        const createdCourseResponse = await request(app)
          .post('/courses/')
          .set('Authorization', 'Bearer user1')
          .send(coursePayload)
          .expect(201);

        const courseId = createdCourseResponse.body._id;

        const updatedCoursePayload = {
          name: 'Updated Course',
          description: 'Updated course description',
        };

        const response = await request(app)
          .patch(`/courses/${courseId}`)
          .set('Authorization', 'Bearer user1')
          .send(updatedCoursePayload)
          .expect(200);

        expect(response.body.name).toBe('Updated Course');
        expect(response.body.description).toBe('Updated course description');
        expect(response.body._id).toBe(courseId);

        const readResponse = await request(app)
          .get(`/courses/${courseId}`)
          .set('Authorization'  , 'Bearer user1')
          .expect(200);

        expect(readResponse.body.name).toBe('Updated Course');
        expect(readResponse.body.description).toBe(
          'Updated course description',
        );
      }, 60000);
    });
    describe('Error Scenarios', () => {
      it('should return 404 for a non-existing course', async () => {
        const response = await request(app)
          .put('/courses/67dd98f025dd87ebf639851c')
          .set('Authorization', 'Bearer user1')
          .send({
            name: 'Updated Course',
            description: 'Updated course description',
          })
          .expect(404);
      }, 60000);

      it('should return 400 for invalid course data', async () => {
        const coursePayload = {
          name: 'Existing Course',
          description: 'Course description',
          versionName: 'Version 1',
          versionDescription: 'Initial version',
        };

        const createdCourseResponse = await request(app)
          .post('/courses/')
          .set('Authorization', 'Bearer user1')
          .send(coursePayload)
          .expect(201);

        const courseId = createdCourseResponse.body._id;

        const invalidPayload = {name: ''};

        const response = await request(app)
          .patch(`/courses/${courseId}`)
          .set('Authorization', 'Bearer user1')
          .send(invalidPayload)
          .expect(400);

        expect(response.body.message).toContain(
          "Invalid body, check 'errors' property for more info.",
        );

        const invalidPayload2 = {description: ''};

        const response2 = await request(app)
          .patch(`/courses/${courseId}`)
          .set('Authorization', 'Bearer user1')
          .send(invalidPayload2)
          .expect(400);

        expect(response2.body.message).toContain(
          "Invalid body, check 'errors' property for more info.",
        );

        const invalidPayload3 = {};

        const response3 = await request(app)
          .patch(`/courses/${courseId}`)
          .set('Authorization', 'Bearer user1')
          .send(invalidPayload3)
          .expect(400);

        expect(response3.body.message).toContain(
          "Invalid body, check 'errors' property for more info.",
        );
      }, 60000);
    });
  });

  describe('COURSE DELETION', () => {
    describe('Success Scenario', () => {
      it('should delete a course by ID', async () => {
        const coursePayload = {
          name: 'Course To Be Deleted',
          description: 'This course will be deleted',
          versionName: 'Version 1',
          versionDescription: 'Initial version',
        };

        const createdCourseResponse = await request(app)
          .post('/courses/')
          .set('Authorization', 'Bearer user1')
          .send(coursePayload)
          .expect(201);

        const courseId = createdCourseResponse.body._id;

        const res = await request(app).delete(`/courses/${courseId}`).set('Authorization', 'Bearer user1');

        await request(app).get(`/courses/${courseId}`).set('Authorization', 'Bearer user1').expect(404);
      }, 60000);
    });

    describe('Error Scenarios', () => {
      it('should return 404 for a non-existing course', async () => {
        const fakeId = faker.database.mongodbObjectId();

        await request(app).delete(`/courses/${fakeId}`).set('Authorization', 'Bearer user1').expect(404);
      }, 60000);
    });
  });
});
