import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { injectable, inject } from 'inversify';
import { NotFoundError } from 'routing-controllers';
import { EXAMS_TYPES } from '../types.js';
import { ExamRepository } from '../repositories/providers/mongodb/ExamRepository.js';
import {
    IExam,
    IExamQuestion,
    INegativeMarkingScheme,
    ITimeGrant,
} from '../classes/transformers/Exam.js';
import {
    AddQuestionBody,
    AddTimeGrantBody,
    CreateExamBody,
    UpdateExamBody,
    UpdateQuestionBody,
} from '../classes/validators/ExamValidators.js';

const DEFAULT_NEGATIVE_MARKING_SCHEME: INegativeMarkingScheme = {
    MCQ: 'one_third',
    MSQ: 'none',
    NAT: 'none',
};

/** No 0/O or 1/I, to avoid ambiguity when a student reads a code aloud/types it. */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateGrantCode(): string {
    let s = '';
    for (let i = 0; i < 6; i++) {
        s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    return s;
}

@injectable()
export class ExamService {
    constructor(
        @inject(EXAMS_TYPES.ExamRepo)
        private readonly examRepo: ExamRepository,
    ) {}

    async createExam(body: CreateExamBody, createdBy: string): Promise<IExam> {
        const now = Date.now();
        const timeGrants: ITimeGrant[] = (body.timeGrants ?? []).map(seed => ({
            id: `grant-${randomUUID()}`,
            code: generateGrantCode(),
            minutes: Number(seed.minutes) || 0,
            note: seed.note || '',
            used: false,
            usedAt: null,
            createdAt: now,
        }));

        const exam: IExam = {
            title: body.title,
            duration: body.duration ?? 30,
            passingMarks: body.passingMarks ?? 0,
            negativeMarking: body.negativeMarking ?? true,
            negativeMarkingScheme: (body.negativeMarkingScheme as INegativeMarkingScheme) ?? {
                ...DEFAULT_NEGATIVE_MARKING_SCHEME,
            },
            instructions: body.instructions ?? '',
            published: false,
            revealAnswers: body.revealAnswers ?? false,
            proctoring: body.proctoring,
            createdBy,
            createdAt: now,
            updatedAt: now,
            questions: [],
            timeGrants,
        };

        return this.examRepo.create(exam);
    }

    async getExamById(examId: string): Promise<IExam> {
        const exam = await this.examRepo.findById(examId);
        if (!exam) {
            throw new NotFoundError('Exam not found');
        }
        return exam;
    }

    async findByCreator(uid: string): Promise<IExam[]> {
        return this.examRepo.findByCreator(uid);
    }

    async findPublished(): Promise<IExam[]> {
        return this.examRepo.findPublished();
    }

    async updateExam(examId: string, patch: UpdateExamBody): Promise<IExam> {
        await this.getExamById(examId);
        const updated = await this.examRepo.update(examId, patch as Partial<IExam>);
        if (!updated) {
            throw new NotFoundError('Exam not found');
        }
        return updated;
    }

    async deleteExam(examId: string): Promise<void> {
        await this.getExamById(examId);
        await this.examRepo.delete(examId);
    }

    async addQuestion(examId: string, body: AddQuestionBody): Promise<IExam> {
        await this.getExamById(examId);
        const question: IExamQuestion = {
            id: `q-${randomUUID()}`,
            type: body.type,
            questionText: body.questionText,
            questionImage: body.questionImage,
            options: (body.options ?? []).map(o => ({
                id: o.id,
                text: o.text ?? '',
                image: o.image,
            })),
            correctOptions: body.correctOptions,
            marks: body.marks,
            negativeMarks: body.negativeMarks ?? 0,
            useCustomNegative: body.useCustomNegative ?? false,
            natAnswerType: body.natAnswerType,
        };

        const updated = await this.examRepo.addQuestion(examId, question);
        if (!updated) {
            throw new NotFoundError('Exam not found');
        }
        return updated;
    }

    async updateQuestion(
        examId: string,
        questionId: string,
        patch: UpdateQuestionBody,
    ): Promise<IExam> {
        const exam = await this.getExamById(examId);
        if (!exam.questions.some(q => q.id === questionId)) {
            throw new NotFoundError('Question not found');
        }

        const updated = await this.examRepo.updateQuestion(examId, questionId, patch as Partial<IExamQuestion>);
        if (!updated) {
            throw new NotFoundError('Question not found');
        }
        return updated;
    }

    async removeQuestion(examId: string, questionId: string): Promise<IExam> {
        const exam = await this.getExamById(examId);
        if (!exam.questions.some(q => q.id === questionId)) {
            throw new NotFoundError('Question not found');
        }

        const updated = await this.examRepo.removeQuestion(examId, questionId);
        if (!updated) {
            throw new NotFoundError('Exam not found');
        }
        return updated;
    }

    async addTimeGrant(examId: string, body: AddTimeGrantBody): Promise<IExam> {
        await this.getExamById(examId);
        const grant: ITimeGrant = {
            id: `grant-${randomUUID()}`,
            code: generateGrantCode(),
            minutes: Number(body.minutes) || 0,
            note: body.note || '',
            used: false,
            usedAt: null,
            createdAt: Date.now(),
        };

        const updated = await this.examRepo.addTimeGrant(examId, grant);
        if (!updated) {
            throw new NotFoundError('Exam not found');
        }
        return updated;
    }

    async removeTimeGrant(examId: string, grantId: string): Promise<IExam> {
        const exam = await this.getExamById(examId);
        if (!(exam.timeGrants ?? []).some(g => g.id === grantId)) {
            throw new NotFoundError('Time grant not found');
        }

        const updated = await this.examRepo.removeTimeGrant(examId, grantId);
        if (!updated) {
            throw new NotFoundError('Exam not found');
        }
        return updated;
    }

    /**
     * Mirrors `examStore.redeemTimeGrant` from the legacy localStorage store:
     * any authenticated user (not just the exam owner) can redeem a code, and
     * failures are returned as a result object rather than thrown, since an
     * invalid/used code is an expected user-facing outcome, not a server error.
     */
    async redeemTimeGrant(
        examId: string,
        rawCode: string,
    ): Promise<{ ok: boolean; minutes?: number; error?: string }> {
        const exam = await this.getExamById(examId);
        const code = (rawCode || '').trim().toUpperCase();
        if (!code) {
            return { ok: false, error: 'Enter a code' };
        }

        const grant = (exam.timeGrants ?? []).find(g => g.code === code);
        if (!grant) {
            return { ok: false, error: 'Invalid code' };
        }
        if (grant.used) {
            return { ok: false, error: 'This code has already been used' };
        }

        const redeemed = await this.examRepo.markTimeGrantUsed(examId, grant.id);
        if (!redeemed) {
            // Lost a race with another redemption of the same code between the
            // read above and this write.
            return { ok: false, error: 'This code has already been used' };
        }

        return { ok: true, minutes: grant.minutes };
    }
}
