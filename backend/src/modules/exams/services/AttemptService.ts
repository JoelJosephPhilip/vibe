import 'reflect-metadata';
import { injectable, inject } from 'inversify';
import { ForbiddenError, NotFoundError } from 'routing-controllers';
import { EXAMS_TYPES } from '../types.js';
import { ExamRepository } from '../repositories/providers/mongodb/ExamRepository.js';
import { AttemptRepository } from '../repositories/providers/mongodb/AttemptRepository.js';
import { IExamQuestion } from '../classes/transformers/Exam.js';
import {
    IAttemptAnswerEntry,
    IAttemptProctoringEvent,
    IExamAttempt,
} from '../classes/transformers/Attempt.js';
import { ResponseItemBody } from '../classes/validators/AttemptValidators.js';
import { computeNegativeMarks } from '../utils/computeNegativeMarks.js';
import { IUser } from '#root/shared/interfaces/models.js';

@injectable()
export class AttemptService {
    constructor(
        @inject(EXAMS_TYPES.ExamRepo)
        private readonly examRepo: ExamRepository,
        @inject(EXAMS_TYPES.AttemptRepo)
        private readonly attemptRepo: AttemptRepository,
    ) {}

    /**
     * Loads the exam, independently regrades the submission against the
     * exam's own stored questions/correctOptions (never trusting a
     * client-submitted score), and persists the attempt. Mirrors the scoring
     * logic in `frontend/src/app/pages/exam/ExamPage.jsx`'s `handleSubmit`
     * (via `computeNegativeMarks`, ported in `utils/computeNegativeMarks.ts`)
     * so the persisted score matches what the exam-taking UI showed live.
     */
    async submitAttempt(
        examId: string,
        studentId: string,
        responses: ResponseItemBody[],
        meta: {
            tabSwitches?: number;
            startedAt?: number;
            proctoringEvents?: IAttemptProctoringEvent[];
        },
    ): Promise<IExamAttempt> {
        const exam = await this.examRepo.findById(examId);
        if (!exam) {
            throw new NotFoundError('Exam not found');
        }

        const responseByQuestionId = new Map<string, ResponseItemBody>();
        for (const response of responses ?? []) {
            responseByQuestionId.set(response.questionId, response);
        }

        const answers: Record<string, IAttemptAnswerEntry> = {};
        let score = 0;
        let correctCount = 0;
        let totalMarks = 0;

        for (const question of exam.questions) {
            totalMarks += Number(question.marks) || 0;
            answers[question.id] = buildAnswerEntry(question);

            const response = responseByQuestionId.get(question.id);
            if (!response) continue;

            const neg = computeNegativeMarks(exam, question);

            if (question.type === 'NAT') {
                const natValue = (response.natValue || '').trim();
                const correct = question.correctOptions[0] ?? '';
                if (natValue === correct) {
                    score += Number(question.marks) || 0;
                    correctCount++;
                }
            } else if (question.type === 'MCQ') {
                const sel = (response.selectedOptionIds || [])[0];
                const correct = question.correctOptions[0];
                if (sel === correct) {
                    score += Number(question.marks) || 0;
                    correctCount++;
                } else if (sel) {
                    score -= neg;
                }
            } else if (question.type === 'MSQ') {
                const sel = [...(response.selectedOptionIds || [])].sort().join(',');
                const correct = [...question.correctOptions].sort().join(',');
                if (sel.length > 0 && sel === correct) {
                    score += Number(question.marks) || 0;
                    correctCount++;
                } else if (sel.length > 0) {
                    score -= neg;
                }
            }
        }

        score = Math.max(0, Number(score.toFixed(2)));

        const attempt: IExamAttempt = {
            examId,
            examTitle: exam.title,
            studentId,
            responses: responses ?? [],
            questions: exam.questions,
            answers,
            score,
            totalMarks,
            correctCount,
            total: exam.questions.length,
            revealAnswers: exam.revealAnswers ?? false,
            tabSwitches: meta.tabSwitches,
            startedAt: meta.startedAt,
            // Audit trail only — passed through as-is, never consulted above
            // when computing score/correctCount.
            proctoringEvents: meta.proctoringEvents,
            submittedAt: Date.now(),
        };

        return this.attemptRepo.create(attempt);
    }

    async listByStudent(studentId: string): Promise<IExamAttempt[]> {
        return this.attemptRepo.findByStudent(studentId);
    }

    async getById(attemptId: string, user: IUser): Promise<IExamAttempt> {
        const attempt = await this.attemptRepo.findById(attemptId);
        if (!attempt) {
            throw new NotFoundError('Attempt not found');
        }

        const userId = user._id?.toString();
        const isOwnAttempt = attempt.studentId === userId;
        const isAdmin = user.roles === 'admin';

        if (!isOwnAttempt && !isAdmin) {
            const exam = await this.examRepo.findById(attempt.examId);
            const isExamOwner = exam?.createdBy === userId;
            if (!isExamOwner) {
                throw new ForbiddenError('You do not have access to this attempt');
            }
        }

        return attempt;
    }
}

function buildAnswerEntry(question: IExamQuestion): IAttemptAnswerEntry {
    if (question.type === 'NAT') {
        return { correct: question.correctOptions[0] ?? '' };
    }
    return { correct: question.correctOptions };
}
