import Express from 'express';
import request from 'supertest';
import {
  useExpressServer,
  useContainer,
  RoutingControllersOptions,
} from 'routing-controllers';
import {Container} from 'inversify';
import {faker} from '@faker-js/faker';
import {InversifyAdapter} from '#root/inversify-adapter.js';
import {sharedContainerModule} from '#root/container.js';
import {quizzesContainerModule} from '../container.js';
import {coursesContainerModule} from '#root/modules/courses/container.js';
import {usersContainerModule} from '#root/modules/users/container.js';
import {quizzesModuleOptions} from '../index.js';
import {coursesModuleOptions} from '#root/modules/courses/index.js';
import {authContainerModule} from '#root/modules/auth/container.js';
import {authModuleOptions} from '#root/modules/auth/index.js';
import {usersModuleOptions} from '#root/modules/users/index.js';
import {beforeAll, describe, it, expect, beforeEach, vi} from 'vitest';
import {ItemType} from '#root/shared/interfaces/models.js';
import {FirebaseAuthService} from '#root/modules/auth/services/FirebaseAuthService.js';
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

describe('QuizController', {timeout: 30000}, () => {
  const appInstance = Express();
  let app: any;
  let userId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const container = new Container();
    await container.load(
      sharedContainerModule,
      quizzesContainerModule,
      coursesContainerModule,
      usersContainerModule,
      authContainerModule,
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
        ...(authModuleOptions.controllers as Function[]),
        ...(usersModuleOptions.controllers as Function[]),
      ],
      authorizationChecker: async () => true,
      defaultErrorHandler: true,
      validation: true,
      currentUserChecker: async () => {
        return userId
          ? {
              _id: userId,
              email: 'quiz_test_user@example.com',
              name: 'Quiz Test User',
            }
          : null;
      },
    };
    app = useExpressServer(appInstance, options);

    // Sign up a user and store the userId
    const signUpBody = {
      email: faker.internet.email(),
      password: 'TestPassword123!',
      firstName: faker.person.firstName().replace(/[^a-zA-Z]/g, ''),
      lastName: faker.person.lastName().replace(/[^a-zA-Z]/g, ''),
    };
    const signupRes = await request(app).post('/auth/signup').set('Authorization', 'Bearer test-token').send(signUpBody);
    expect(signupRes.status).toBe(201);
    userId = signupRes.body.userId;
    expect(userId).toBeTruthy();
    vi.spyOn(
      FirebaseAuthService.prototype,
      'getUserIdFromReq',
    ).mockResolvedValue(userId);
    // @Ability() (unlike currentUserChecker above) verifies the bearer token
    // itself via getCurrentUserFromToken — mock it so 'Bearer test-token'
    // resolves to this same signed-up user.
    vi.spyOn(
      FirebaseAuthService.prototype,
      'getCurrentUserFromToken',
    ).mockResolvedValue({_id: userId, roles: 'admin'} as any);
  }, 900000);

  beforeEach(() => {
    // Some tests below may swap this mock to act as a different user — this
    // re-establishes the original identity before every test.
    vi.spyOn(
      FirebaseAuthService.prototype,
      'getCurrentUserFromToken',
    ).mockResolvedValue({_id: userId, roles: 'admin'} as any);
  });

  // Helper: create a quiz and question bank, return their IDs
  async function setupQuizWithBank() {
    // 1. Create course
    const courseRes = await request(app).post('/courses').set('Authorization', 'Bearer test-token').send({
      name: 'Course for QuizController',
      description: 'Course for quiz controller test',
      versionName: 'Version 1',
      versionDescription: 'Initial version',
    });
    expect(courseRes.status).toBe(201);
    const courseId = courseRes.body._id;

    // 2. Create course version
    const versionRes = await request(app)
      .post(`/courses/${courseId}/versions`)
      .set('Authorization', 'Bearer test-token')
      .send({
        version: 'v1.0',
        description: 'Version for quiz controller test',
      });
    expect(versionRes.status).toBe(201);
    const versionId = versionRes.body._id;

    // 3. Create module
    const moduleRes = await request(app)
      .post(`/courses/versions/${versionId}/modules`)
      .set('Authorization', 'Bearer test-token')
      .send({
        name: 'Module for QuizController',
        description: 'Module for quiz controller test',
      });
    expect(moduleRes.status).toBe(201);
    const moduleId = moduleRes.body.version.modules[0].moduleId;

    // 4. Create section
    const sectionRes = await request(app)
      .post(`/courses/versions/${versionId}/modules/${moduleId}/sections`)
      .set('Authorization', 'Bearer test-token')
      .send({
        name: 'Section for QuizController',
        description: 'Section for quiz controller test',
      });
    expect(sectionRes.status).toBe(201);
    const sectionId = sectionRes.body.version.modules[0].sections[0].sectionId;

    // 5. Create a real question
    const questionData = {
      text: 'What is 2 + 2?',
      type: 'NUMERIC_ANSWER_TYPE',
      points: 5,
      timeLimitSeconds: 30,
      isParameterized: false,
      parameters: [],
      hint: 'Simple math.',
      priority: 'LOW',
    };
    const solution = {
      decimalPrecision: 0,
      upperLimit: 10,
      lowerLimit: 0,
      value: 4,
    };
    const questionRes = await request(app).post('/quizzes/questions').set('Authorization', 'Bearer test-token').send({
      question: questionData,
      solution,
    });
    expect(questionRes.status).toBe(201);
    const questionId = questionRes.body.questionId;

    // 6. Create question bank with the question
    const bankRes = await request(app)
      .post('/quizzes/question-bank')
      .set('Authorization', 'Bearer test-token')
      .send({
        courseId,
        courseVersionId: versionId,
        questions: [questionId],
        title: 'Bank for QuizController',
        description: 'Bank for quiz controller test',
      });
    expect(bankRes.status).toBe(200);
    const questionBankId = bankRes.body.questionBankId;

    // 7. Create quiz item referencing the question bank
    const itemPayload = {
      name: 'Quiz Item for QuizController',
      description: 'Quiz item description',
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

    const itemRes = await request(app)
      .post(
        `/courses/versions/${versionId}/modules/${moduleId}/sections/${sectionId}/items`,
      )
      .set('Authorization', 'Bearer test-token')
      .send(itemPayload);
    expect(itemRes.status).toBe(201);
    const quizId = itemRes.body.createdItem._id;

    // Add question bank to quiz item
    const updateQuizRes = await request(app)
      .post(`/quizzes/quiz/${quizId}/bank`)
      .set('Authorization', 'Bearer test-token')
      .send({
        bankId: questionBankId,
        count: 1,
      });
    expect(updateQuizRes.status).toBe(200);

    // handleQuizeProgressAfterSubmission (run after a quiz submission)
    // requires an initialized Progress record, which only gets created for
    // STUDENT enrollments — the course-creator user (used for all setup
    // above) is auto-enrolled as INSTRUCTOR and has none. Sign up and enroll
    // a separate student so tests that attempt/submit the quiz can use them.
    const studentSignUpRes = await request(app)
      .post('/auth/signup')
      .set('Authorization', 'Bearer test-token')
      .send({
        email: faker.internet.email(),
        password: 'TestPassword123!',
        firstName: faker.person.firstName().replace(/[^a-zA-Z]/g, ''),
        lastName: faker.person.lastName().replace(/[^a-zA-Z]/g, ''),
      });
    expect(studentSignUpRes.status).toBe(201);
    const studentId = studentSignUpRes.body.userId;
    const studentEnrollRes = await request(app)
      .post(`/users/${studentId}/enrollments/courses/${courseId}/versions/${versionId}`)
      .set('Authorization', 'Bearer test-token')
      .send({role: 'STUDENT'});
    expect(studentEnrollRes.status).toBe(200);

    return {quizId, questionBankId, questionId, courseId, versionId, studentId};
  }

  // Switches getCurrentUserFromToken to resolve as the given student so
  // subsequent requests (e.g. creating/submitting an attempt) act as them.
  function actAsStudent(studentId: string) {
    vi.spyOn(
      FirebaseAuthService.prototype,
      'getCurrentUserFromToken',
    ).mockResolvedValue({_id: studentId, roles: 'user'} as any);
  }

  // Switches back to the course-creator/instructor identity — call after
  // actAsStudent() once the attempt/submit steps are done, since viewing
  // another user's metrics/analytics/submissions requires instructor rights.
  function actAsInstructor() {
    vi.spyOn(
      FirebaseAuthService.prototype,
      'getCurrentUserFromToken',
    ).mockResolvedValue({_id: userId, roles: 'admin'} as any);
  }

  describe('POST /quizzes/quiz/:quizId/bank', () => {
    it('should give 500 as already added', async () => {
      const {quizId, questionBankId} = await setupQuizWithBank();
      const res = await request(app)
        .post(`/quizzes/quiz/${quizId}/bank`)
        .set('Authorization', 'Bearer test-token')
        .send({bankId: questionBankId, count: 1});
      expect(res.status).toBe(500);
      expect(res.body.message).toMatch(
        'Question bank is already added to the quiz',
      );
    });
  });

  describe('DELETE /quizzes/quiz/:quizId/bank/:questionBankId', () => {
    it('should remove a question bank from a quiz', async () => {
      const {quizId, questionBankId} = await setupQuizWithBank();
      await request(app)
        .post(`/quizzes/quiz/${quizId}/bank`)
        .set('Authorization', 'Bearer test-token')
        .send({bankId: questionBankId, count: 1});
      const res = await request(app).delete(
        `/quizzes/quiz/${quizId}/bank/${questionBankId}`,
      ).set('Authorization', 'Bearer test-token');
      expect(res.status).toBe(200);
    });
  });

  describe('PATCH /quizzes/quiz/:quizId/bank (edit)', () => {
    it('should edit a question bank configuration', async () => {
      const {quizId, questionBankId} = await setupQuizWithBank();
      const res = await request(app)
        .patch(`/quizzes/quiz/${quizId}/bank`)
        .set('Authorization', 'Bearer test-token')
        .send({bankId: questionBankId, count: 2});
      expect(res.status).toBe(200);
    });
  });

  describe('GET /quizzes/quiz/:quizId/bank', () => {
    it('should get all question banks for a quiz', async () => {
      const {quizId, questionBankId} = await setupQuizWithBank();
      const res = await request(app).get(`/quizzes/quiz/${quizId}/bank`).set('Authorization', 'Bearer test-token');
      expect(res.status).toBe(200);
      expect(res.body[0].bankId).toBe(questionBankId);
    });
  });

  describe('GET /quizzes/quiz/:quizId/user/:userId', () => {
    it('should get user metrics for a quiz', async () => {
      const {quizId, questionId, courseId, versionId, studentId} = await setupQuizWithBank();
      actAsStudent(studentId);
      const attemptRes = await request(app).post(`/quizzes/${quizId}/attempt`).set('Authorization', 'Bearer test-token');
      const attemptId = attemptRes.body.attemptId;
      // Attempt the question
      const submitRes = await request(app)
        .post(`/quizzes/${quizId}/attempt/${attemptId}/submit`)
        .set('Authorization', 'Bearer test-token')
        .send({
          answers: [
            {
              questionId: questionId,
              questionType: 'NUMERIC_ANSWER_TYPE',
              answer: {value: 9},
            },
          ],
          courseId,
          courseVersionId: versionId,
        });
      expect(submitRes.status).toBe(200);
      actAsInstructor();
      const res = await request(app).get(
        `/quizzes/quiz/${quizId}/user/${studentId}`,
      ).set('Authorization', 'Bearer test-token');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('quizId');
      expect(res.body).toHaveProperty('userId');
    });
  });

  describe('GET /quizzes/quiz/attempts/:attemptId', () => {
    it('should get quiz attempt details', async () => {
      const {quizId, questionId, courseId, versionId, studentId} = await setupQuizWithBank();
      // Create attempt
      actAsStudent(studentId);
      const attemptRes = await request(app).post(`/quizzes/${quizId}/attempt`).set('Authorization', 'Bearer test-token');
      expect(attemptRes.status).toBe(200);
      const attemptId = attemptRes.body.attemptId;
      // Save answers (optional, but makes attempt more realistic)
      await request(app)
        .post(`/quizzes/${quizId}/attempt/${attemptId}/save`)
        .set('Authorization', 'Bearer test-token')
        .send({
          answers: [
            {
              questionId,
              questionType: 'NUMERIC_ANSWER_TYPE',
              answer: {value: 4},
            },
          ],
        });

      actAsInstructor();
      const res = await request(app).get(`/quizzes/quiz/${quizId}/attempts/${attemptId}`).set('Authorization', 'Bearer test-token');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('quizId');
    });
  });

  describe('GET /quizzes/quiz/submissions/:submissionId', () => {
    it('should get quiz submission details', async () => {
      const {quizId, questionId, courseId, versionId, studentId} = await setupQuizWithBank();
      // Create attempt
      actAsStudent(studentId);
      const attemptRes = await request(app).post(`/quizzes/${quizId}/attempt`).set('Authorization', 'Bearer test-token');
      expect(attemptRes.status).toBe(200);
      const attemptId = attemptRes.body.attemptId;
      // Submit answers
      const submitRes = await request(app)
        .post(`/quizzes/${quizId}/attempt/${attemptId}/submit`)
        .set('Authorization', 'Bearer test-token')
        .send({
          answers: [
            {
              questionId,
              questionType: 'NUMERIC_ANSWER_TYPE',
              answer: {value: 4},
            },
          ],
          courseId,
          courseVersionId: versionId,
        });
      expect(submitRes.status).toBe(200);
      actAsInstructor();
      // get submissions for quiz
      const quizSubmissionRes = await request(app).get(
        `/quizzes/quiz/${quizId}/submissions`,
      ).set('Authorization', 'Bearer test-token');
      expect(quizSubmissionRes.status).toBe(200);
      expect(Array.isArray(quizSubmissionRes.body.data)).toBe(true);
      const submissionId =
        quizSubmissionRes.body.data[0]._id;
      const res = await request(app).get(
        `/quizzes/quiz/${quizId}/submissions/${submissionId}`,
      ).set('Authorization', 'Bearer test-token');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('quizId');
    });
  });

  describe('GET /quizzes/quiz/:quizId/details', () => {
    it('should get quiz details', async () => {
      const {quizId} = await setupQuizWithBank();
      const res = await request(app).get(`/quizzes/quiz/${quizId}/details`).set('Authorization', 'Bearer test-token');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('name');
    });
  });

  describe('GET /quizzes/quiz/:quizId/analytics', () => {
    it('should get quiz analytics', async () => {
      const {quizId, questionId, courseId, versionId, studentId} = await setupQuizWithBank();
      actAsStudent(studentId);
      const attemptRes = await request(app).post(`/quizzes/${quizId}/attempt`).set('Authorization', 'Bearer test-token');
      const attemptId = attemptRes.body.attemptId;
      // Attempt the question
      const submitRes = await request(app)
        .post(`/quizzes/${quizId}/attempt/${attemptId}/submit`)
        .set('Authorization', 'Bearer test-token')
        .send({
          answers: [
            {
              questionId: questionId,
              questionType: 'NUMERIC_ANSWER_TYPE',
              answer: {value: 9},
            },
          ],
          courseId,
          courseVersionId: versionId,
        });
      expect(submitRes.status).toBe(200);
      actAsInstructor();
      const res = await request(app).get(`/quizzes/quiz/${quizId}/analytics`).set('Authorization', 'Bearer test-token');
      console.dir(res.body, {depth: null});
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('totalAttempts');
    });
  });

  describe('GET /quizzes/quiz/:quizId/performance', () => {
    it('should get quiz performance stats', async () => {
      const {quizId, questionId, courseId, versionId, studentId} = await setupQuizWithBank();
      actAsStudent(studentId);
      const attemptRes = await request(app).post(`/quizzes/${quizId}/attempt`).set('Authorization', 'Bearer test-token');
      const attemptId = attemptRes.body.attemptId;
      // Attempt the question
      const submitRes = await request(app)
        .post(`/quizzes/${quizId}/attempt/${attemptId}/submit`)
        .set('Authorization', 'Bearer test-token')
        .send({
          answers: [
            {
              questionId: questionId,
              questionType: 'NUMERIC_ANSWER_TYPE',
              answer: {value: 9},
            },
          ],
          courseId,
          courseVersionId: versionId,
        });
      expect(submitRes.status).toBe(200);
      actAsInstructor();
      const res = await request(app).get(`/quizzes/quiz/${quizId}/performance`).set('Authorization', 'Bearer test-token');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /quizzes/quiz/:quizId/results', () => {
    it('should get quiz results', async () => {
      const {quizId, questionId, courseId, versionId, studentId} = await setupQuizWithBank();
      actAsStudent(studentId);
      const attemptRes = await request(app).post(`/quizzes/${quizId}/attempt`).set('Authorization', 'Bearer test-token');
      const attemptId = attemptRes.body.attemptId;
      // Attempt the question
      const submitRes = await request(app)
        .post(`/quizzes/${quizId}/attempt/${attemptId}/submit`)
        .set('Authorization', 'Bearer test-token')
        .send({
          answers: [
            {
              questionId: questionId,
              questionType: 'NUMERIC_ANSWER_TYPE',
              answer: {value: 9},
            },
          ],
          courseId,
          courseVersionId: versionId,
        });
      expect(submitRes.status).toBe(200);
      actAsInstructor();
      const res = await request(app).get(`/quizzes/quiz/${quizId}/results`).set('Authorization', 'Bearer test-token');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /quizzes/quiz/:quizId/flagged', () => {
    it('should get flagged questions for a quiz', async () => {
      // const { quizId } = await setupQuizWithBank();
      // const res = await request(app).get(`/quizzes/quiz/${quizId}/flagged`).set('Authorization', 'Bearer test-token');
      // expect(res.status).toBe(201);
      // No further assertion as flagged questions may not exist
    });
  });

  describe('POST /quizzes/quiz/submission/:submissionId/score/:score', () => {
    it('should update quiz submission score', async () => {
      const {quizId, questionId, courseId, versionId, studentId} = await setupQuizWithBank();
      // Create attempt
      actAsStudent(studentId);
      const attemptRes = await request(app).post(`/quizzes/${quizId}/attempt`).set('Authorization', 'Bearer test-token');
      expect(attemptRes.status).toBe(200);
      const attemptId = attemptRes.body.attemptId;

      // Submit answers
      const submitRes = await request(app)
        .post(`/quizzes/${quizId}/attempt/${attemptId}/submit`)
        .set('Authorization', 'Bearer test-token')
        .send({
          answers: [
            {
              questionId,
              questionType: 'NUMERIC_ANSWER_TYPE',
              answer: {value: 4},
            },
          ],
          courseId,
          courseVersionId: versionId,
        });
      expect(submitRes.status).toBe(200);
      actAsInstructor();
      // Get submission ID
      const quizSubmissionRes = await request(app).get(
        `/quizzes/quiz/${quizId}/submissions`,
      ).set('Authorization', 'Bearer test-token');
      expect(quizSubmissionRes.status).toBe(200);
      expect(Array.isArray(quizSubmissionRes.body.data)).toBe(true);
      const submissionId = quizSubmissionRes.body.data[0]._id;

      // Update score
      const res = await request(app).post(
        `/quizzes/quiz/${quizId}/submission/${submissionId}/score/5`,
      ).set('Authorization', 'Bearer test-token');
      expect(res.status).toBe(200);
    });
  });

  describe('POST /quizzes/quiz/submission/:submissionId/regrade', () => {
    it('should regrade a quiz submission', async () => {
      const {quizId, questionId, courseId, versionId, studentId} = await setupQuizWithBank();
      // Create attempt
      actAsStudent(studentId);
      const attemptRes = await request(app)
        .post(`/quizzes/${quizId}/attempt`)
        .set('Authorization', 'Bearer test-token')
        .send();
      expect(attemptRes.status).toBe(200);
      const attemptId = attemptRes.body.attemptId;

      // Submit answers
      const submitRes = await request(app)
        .post(`/quizzes/${quizId}/attempt/${attemptId}/submit`)
        .set('Authorization', 'Bearer test-token')
        .send({
          answers: [
            {
              questionId,
              questionType: 'NUMERIC_ANSWER_TYPE',
              answer: {value: 4},
            },
          ],
          courseId,
          courseVersionId: versionId,
        });
      expect(submitRes.status).toBe(200);
      actAsInstructor();
      // Get submission ID
      const quizSubmissionRes = await request(app).get(
        `/quizzes/quiz/${quizId}/submissions`,
      ).set('Authorization', 'Bearer test-token');
      expect(quizSubmissionRes.status).toBe(200);
      expect(Array.isArray(quizSubmissionRes.body.data)).toBe(true);
      const submissionId = quizSubmissionRes.body.data[0]._id;
      // Regrade
      const res = await request(app)
        .post(`/quizzes/quiz/${quizId}/submission/${submissionId}/regrade`)
        .set('Authorization', 'Bearer test-token')
        .send({gradingStatus: 'FAILED'});
      expect(res.status).toBe(200);
      // get grading result
      const gradingRes = await request(app).get(
        `/quizzes/quiz/${quizId}/submissions/${submissionId}`,
      ).set('Authorization', 'Bearer test-token');
      expect(gradingRes.status).toBe(200);
      expect(gradingRes.body.gradingResult).toBeDefined();
      expect(gradingRes.body.gradingResult.gradingStatus).toBe('FAILED');
    });
  });

  describe('POST /quizzes/quiz/submission/:submissionId/question/:questionId/feedback', () => {
    it('should add feedback to a question in a submission', async () => {
      const {quizId, questionId, courseId, versionId, studentId} = await setupQuizWithBank();
      // Create attempt
      actAsStudent(studentId);
      const attemptRes = await request(app)
        .post(`/quizzes/${quizId}/attempt`)
        .set('Authorization', 'Bearer test-token')
        .send();
      expect(attemptRes.status).toBe(200);
      const attemptId = attemptRes.body.attemptId;

      // Submit answers
      const submitRes = await request(app)
        .post(`/quizzes/${quizId}/attempt/${attemptId}/submit`)
        .set('Authorization', 'Bearer test-token')
        .send({
          answers: [
            {
              questionId,
              questionType: 'NUMERIC_ANSWER_TYPE',
              answer: {value: 4},
            },
          ],
          courseId,
          courseVersionId: versionId,
        });
      expect(submitRes.status).toBe(200);
      actAsInstructor();
      // Get submission ID
      const quizSubmissionRes = await request(app).get(
        `/quizzes/quiz/${quizId}/submissions`,
      ).set('Authorization', 'Bearer test-token');
      expect(quizSubmissionRes.status).toBe(200);
      expect(Array.isArray(quizSubmissionRes.body.data)).toBe(true);
      const submissionId = quizSubmissionRes.body.data[0]._id;
      // Add feedback
      const res = await request(app)
        .post(
          `/quizzes/quiz/${quizId}/submission/${submissionId}/question/${questionId}/feedback`,
        )
        .set('Authorization', 'Bearer test-token')
        .send({feedback: 'Good job!'});
      expect(res.status).toBe(200);

      // get submission to verify feedback
      const submissionRes = await request(app).get(
        `/quizzes/quiz/${quizId}/submissions/${submissionId}`,
      ).set('Authorization', 'Bearer test-token');
      expect(submissionRes.status).toBe(200);
      expect(
        submissionRes.body.gradingResult.overallFeedback[0].answerFeedback,
      ).toBe('Good job!');
    });
  });
});
