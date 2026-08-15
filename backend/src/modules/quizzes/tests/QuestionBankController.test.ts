import {sharedContainerModule} from '#root/container.js';
import Express from 'express';
import {
  RoutingControllersOptions,
  useContainer,
  useExpressServer,
} from 'routing-controllers';
import {quizzesContainerModule} from '../container.js';
import {coursesContainerModule} from '#root/modules/courses/container.js';
import {authContainerModule} from '#root/modules/auth/container.js';
import {usersContainerModule} from '#root/modules/users/container.js';
import {notificationsContainerModule} from '#root/modules/notifications/container.js';
import {anomaliesContainerModule} from '#root/modules/anomalies/container.js';
import {settingContainerModule} from '#root/modules/setting/container.js';
import {courseRegistrationContainerModule} from '#root/modules/courseRegistration/container.js';
import {projectsContainerModule} from '#root/modules/projects/container.js';
import {reportsContainerModule} from '#root/modules/reports/container.js';
import {GLOBAL_TYPES} from '#root/types.js';
import {MongoDatabase} from '#root/shared/database/providers/mongo/MongoDatabase.js';
import {hpSystemContainerModule} from '#root/modules/hpSystem/container.js';
import {ejectionPolicyContainerModule} from '#root/modules/ejectionPolicy/container.js';
import {emotionsContainerModule} from '#root/modules/emotions/container.js';
import {genAIContainerModule} from '#root/modules/genAI/container.js';
import {studentQuestionsContainerModule} from '#root/modules/studentQuestions/container.js';
import {announcementsContainerModule} from '#root/modules/announcements/container.js';
import {auditTrailsContainerModule} from '#root/modules/auditTrails/container.js';
import {Container} from 'inversify';
import {InversifyAdapter} from '#root/inversify-adapter.js';
import {quizzesModuleOptions} from '../index.js';
import {coursesModuleOptions} from '#root/modules/courses/index.js';
import request from 'supertest';
import {beforeAll, beforeEach, describe, it, expect, vi} from 'vitest';
import {faker} from '@faker-js/faker';
import {FirebaseAuthService} from '#root/modules/auth/services/FirebaseAuthService.js';

describe('QuestionBankController', {timeout: 30000}, () => {
  const appInstance = Express();
  let app: any;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const container = new Container();
    await container.load(
      sharedContainerModule,
      quizzesContainerModule,
      coursesContainerModule,
      authContainerModule,
      usersContainerModule,
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
    const db = container.get<MongoDatabase>(GLOBAL_TYPES.Database);
    await db.connect();
    const options: RoutingControllersOptions = {
      controllers: [
        ...(quizzesModuleOptions.controllers as Function[]),
        ...(coursesModuleOptions.controllers as Function[]),
      ],
      authorizationChecker: async () => true,
      defaultErrorHandler: true,
      validation: true,
    };
    app = useExpressServer(appInstance, options);
  }, 900000);

  beforeEach(() => {
    // The real @Ability() decorator verifies the bearer token itself via
    // getCurrentUserFromToken — mock it so 'Bearer test-token' resolves.
    vi.spyOn(
      FirebaseAuthService.prototype,
      'getCurrentUserFromToken',
    ).mockResolvedValue({
      _id: faker.database.mongodbObjectId(),
      roles: 'admin',
    } as any);
  });

  describe('POST /quizzes/question-bank', () => {
    it('success: creates a question bank', async () => {
      const courseRes = await request(app).post('/courses').set('Authorization', 'Bearer test-token').send({
        name: 'Course for Bank A',
        description: 'Course for POST success',
        versionName: 'Version 1',
        versionDescription: 'Initial version',
      });
      expect(courseRes.status).toBe(201);
      const courseId = courseRes.body._id;

      const versionRes = await request(app)
        .post(`/courses/${courseId}/versions`)
        .set('Authorization', 'Bearer test-token')
        .send({
          version: 'v1.0',
          description: 'Version for POST success',
        });
      expect(versionRes.status).toBe(201);
      const courseVersionId = versionRes.body._id;

      const res = await request(app).post('/quizzes/question-bank').set('Authorization', 'Bearer test-token').send({
        courseId,
        courseVersionId,
        questions: [],
        title: 'Bank A',
        description: 'Bank for POST success',
      });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('questionBankId');
    });

    it('failure: missing required fields', async () => {
      const res = await request(app).post('/quizzes/question-bank').set('Authorization', 'Bearer test-token').send({});
      expect(res.status).toBe(400);
    });
  });

  describe('GET /quizzes/question-bank/:questionBankId', () => {
    it('success: gets a question bank by id', async () => {
      const courseRes = await request(app).post('/courses/').set('Authorization', 'Bearer test-token').send({
        name: 'Course for Bank B',
        description: 'Course for GET success',
        versionName: 'Version 1',
        versionDescription: 'Initial version',
      });
      expect(courseRes.status).toBe(201);
      const courseId = courseRes.body._id;

      const versionRes = await request(app)
        .post(`/courses/${courseId}/versions`)
        .set('Authorization', 'Bearer test-token')
        .send({
          version: 'v1.0',
          description: 'Version for GET success',
        });
      expect(versionRes.status).toBe(201);
      const courseVersionId = versionRes.body._id;

      const createRes = await request(app).post('/quizzes/question-bank').set('Authorization', 'Bearer test-token').send({
        courseId,
        courseVersionId,
        questions: [],
        title: 'Bank B',
        description: 'Bank for GET success',
      });
      const bankId = createRes.body.questionBankId;
      const res = await request(app).get(`/quizzes/question-bank/${bankId}`).set('Authorization', 'Bearer test-token');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('title', 'Bank B');
    });

    it('failure: invalid id', async () => {
      const res = await request(app).get('/quizzes/question-bank/invalidid').set('Authorization', 'Bearer test-token');
      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /quizzes/question-bank/:questionBankId/questions/:questionId/add', () => {
    it('success: adds a question to the bank', async () => {
      const courseRes = await request(app).post('/courses/').set('Authorization', 'Bearer test-token').send({
        name: 'Course for Bank C',
        description: 'Course for ADD success',
        versionName: 'Version 1',
        versionDescription: 'Initial version',
      });
      expect(courseRes.status).toBe(201);
      const courseId = courseRes.body._id;

      const versionRes = await request(app)
        .post(`/courses/${courseId}/versions`)
        .set('Authorization', 'Bearer test-token')
        .send({
          version: 'v1.0',
          description: 'Version for ADD success',
        });
      expect(versionRes.status).toBe(201);
      const courseVersionId = versionRes.body._id;

      const bankRes = await request(app).post('/quizzes/question-bank').set('Authorization', 'Bearer test-token').send({
        courseId,
        courseVersionId,
        questions: [],
        title: 'Bank C',
        description: 'Bank for ADD success',
      });

      const questionRes = await request(app)
        .post('/quizzes/questions')
        .set('Authorization', 'Bearer test-token')
        .send({
          question: {
            text: 'Question C',
            type: 'SELECT_ONE_IN_LOT',
            points: 5,
            timeLimitSeconds: 30,
            isParameterized: false,
            parameters: [],
            hint: 'Hint C',
          priority: 'LOW',
          },
          solution: {
            correctLotItem: {text: 'Correct', explaination: 'Correct'},
            incorrectLotItems: [],
          },
        });
      const bankId = bankRes.body.questionBankId;
      const questionId = questionRes.body.questionId;
      const res = await request(app).patch(
        `/quizzes/question-bank/${bankId}/questions/${questionId}/add`,
      ).set('Authorization', 'Bearer test-token');
      expect(res.status).toBe(200);
      expect(res.body.questions).toContain(questionId);
    });

    it('failure: invalid ids', async () => {
      const res = await request(app).patch(
        '/quizzes/question-bank/invalidbank/questions/invalidquestion/add',
      ).set('Authorization', 'Bearer test-token');
      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /quizzes/question-bank/:questionBankId/questions/:questionId/remove', () => {
    it('success: removes a question from the bank', async () => {
      const courseRes = await request(app).post('/courses/').set('Authorization', 'Bearer test-token').send({
        name: 'Course for Bank D',
        description: 'Course for REMOVE success',
        versionName: 'Version 1',
        versionDescription: 'Initial version',
      });
      expect(courseRes.status).toBe(201);
      const courseId = courseRes.body._id;

      const versionRes = await request(app)
        .post(`/courses/${courseId}/versions`)
        .set('Authorization', 'Bearer test-token')
        .send({
          version: 'v1.0',
          description: 'Version for REMOVE success',
        });
      expect(versionRes.status).toBe(201);
      const courseVersionId = versionRes.body._id;

      const bankRes = await request(app).post('/quizzes/question-bank').set('Authorization', 'Bearer test-token').send({
        courseId,
        courseVersionId,
        questions: [],
        title: 'Bank D',
        description: 'Bank for REMOVE success',
      });

      const questionRes = await request(app)
        .post('/quizzes/questions')
        .set('Authorization', 'Bearer test-token')
        .send({
          question: {
            text: 'Question D',
            type: 'SELECT_ONE_IN_LOT',
            points: 5,
            timeLimitSeconds: 30,
            isParameterized: false,
            parameters: [],
            hint: 'Hint D',
          priority: 'LOW',
          },
          solution: {
            correctLotItem: {text: 'Correct', explaination: 'Correct'},
            incorrectLotItems: [],
          },
        });
      const bankId = bankRes.body.questionBankId;
      const questionId = questionRes.body.questionId;
      // Add first
      await request(app).patch(
        `/quizzes/question-bank/${bankId}/questions/${questionId}/add`,
      ).set('Authorization', 'Bearer test-token');
      // Remove — this soft-deletes the question itself (QuestionRepository
      // marks it isDeleted) but deliberately keeps its ID in the bank's
      // questions array, so a bank's history still reflects what it once
      // contained. See the comment in QuestionBankService.removeQuestion.
      const res = await request(app).patch(
        `/quizzes/question-bank/${bankId}/questions/${questionId}/remove`,
      ).set('Authorization', 'Bearer test-token');
      expect(res.status).toBe(200);
      expect(res.body.questions).toContain(questionId);

      const getRes = await request(app)
        .get(`/quizzes/questions/${questionId}`)
        .set('Authorization', 'Bearer test-token');
      expect(getRes.status).toBe(404);
    });

    it('failure: invalid ids', async () => {
      const res = await request(app).patch(
        '/quizzes/question-bank/invalidbank/questions/invalidquestion/remove',
      ).set('Authorization', 'Bearer test-token');
      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /quizzes/question-bank/:questionBankId/questions/:questionId/replace-duplicate', () => {
    it('success: replaces a question with its duplicate', async () => {
      const courseRes = await request(app).post('/courses/').set('Authorization', 'Bearer test-token').send({
        name: 'Course for Bank E',
        description: 'Course for REPLACE success',
        versionName: 'Version 1',
        versionDescription: 'Initial version',
      });
      expect(courseRes.status).toBe(201);
      const courseId = courseRes.body._id;

      const versionRes = await request(app)
        .post(`/courses/${courseId}/versions`)
        .set('Authorization', 'Bearer test-token')
        .send({
          version: 'v1.0',
          description: 'Version for REPLACE success',
        });
      expect(versionRes.status).toBe(201);
      const courseVersionId = versionRes.body._id;

      const bankRes = await request(app).post('/quizzes/question-bank').set('Authorization', 'Bearer test-token').send({
        courseId,
        courseVersionId,
        questions: [],
        title: 'Bank E',
        description: 'Bank for REPLACE success',
      });

      const questionRes = await request(app)
        .post('/quizzes/questions')
        .set('Authorization', 'Bearer test-token')
        .send({
          question: {
            text: 'Question E',
            type: 'SELECT_ONE_IN_LOT',
            points: 5,
            timeLimitSeconds: 30,
            isParameterized: false,
            parameters: [],
            hint: 'Hint E',
          priority: 'LOW',
          },
          solution: {
            correctLotItem: {text: 'Correct', explaination: 'Correct'},
            incorrectLotItems: [],
          },
        });
      const bankId = bankRes.body.questionBankId;
      const questionId = questionRes.body.questionId;
      // Add first
      await request(app).patch(
        `/quizzes/question-bank/${bankId}/questions/${questionId}/add`,
      ).set('Authorization', 'Bearer test-token');
      // Replace
      const res = await request(app).patch(
        `/quizzes/question-bank/${bankId}/questions/${questionId}/replace-duplicate`,
      ).set('Authorization', 'Bearer test-token');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('newQuestionId');
      expect(res.body.newQuestionId).not.toBe(questionId);
    });

    it('failure: invalid ids', async () => {
      const res = await request(app).patch(
        '/quizzes/question-bank/invalidbank/questions/invalidquestion/replace-duplicate',
      ).set('Authorization', 'Bearer test-token');
      expect(res.status).toBe(400);
    });
  });
});
