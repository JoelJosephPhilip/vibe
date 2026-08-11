// Fetch client for the `exams` backend module. Follows the same shape as
// `frontend/src/lib/api/hp-system.ts` (apiFetch<T>() helper, bearer token
// from localStorage, credentials included).
//
// NOTE on ids: Mongo documents come back over the wire with `_id` (string,
// after ObjectId -> JSON), not `id`. The rest of the exam UI (AdminPage,
// EditExamPage, ExamPage, ResultPage, MyTestsPage) was written against the
// old localStorage shape, which used `id` everywhere. Rather than rewrite
// every call site, every exam/attempt returned from this client gets an
// `id` alias added (`id === _id`) so existing UI code keeps working
// unchanged. Nested question ids / time-grant ids are already `id` on the
// backend (see backend/src/modules/exams/classes/transformers/Exam.ts) so
// no aliasing is needed there.

const BASE_URL = `${import.meta.env.VITE_BASE_URL}/exams`;

function getAuthHeaders(): HeadersInit {
    const token = localStorage.getItem('firebase-auth-token');
    return {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
}

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
    const res = await fetch(url, {
        ...options,
        headers: { ...getAuthHeaders(), ...(options?.headers || {}) },
        credentials: 'include',
    });
    if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const err: any = new Error(errData.message || `Request failed (${res.status})`);
        err.response = { json: async () => errData };
        err.data = errData;
        throw err;
    }
    return res.json();
}

// ─── Interfaces ──────────────────────────────────────────────

export type ExamQuestionType = 'MCQ' | 'MSQ' | 'NAT';

export type NegativeMarkingSchemeValue = 'none' | 'one_third' | 'one_fourth' | 'full' | 'custom';

export interface NegativeMarkingScheme {
    MCQ: NegativeMarkingSchemeValue;
    MSQ: NegativeMarkingSchemeValue;
    NAT: NegativeMarkingSchemeValue;
}

export interface ExamQuestionOption {
    id: string;
    text: string;
    image?: string;
}

export interface ExamQuestion {
    id: string;
    type: ExamQuestionType;
    questionText: string;
    questionImage?: string;
    options: ExamQuestionOption[];
    /** For NAT, a single-element array holding the numeric answer as a string. */
    correctOptions: string[];
    marks: number;
    negativeMarks: number;
    useCustomNegative: boolean;
    natAnswerType?: string;
}

export interface TimeGrant {
    id: string;
    code: string;
    minutes: number;
    note: string;
    used: boolean;
    usedAt: number | null;
    createdAt: number;
}

// Same 8 component keys as `ProctoringComponent` in the course-side settings
// (backend/src/shared/database/interfaces/ISettingRepository.ts), reused here
// for naming consistency even though this is a separate, exam-scoped config
// object (not routed through CourseSettingService).
export interface ProctoringDetectorSetting {
    detectorName: string;
    enabled: boolean;
}

export interface ExamProctoringConfig {
    detectors: ProctoringDetectorSetting[];
}

/** A single logged proctoring violation, submitted with the attempt. */
export interface ProctoringEvent {
    type: string;
    at: number;
}

export interface Exam {
    _id: string;
    /** Alias for `_id` — see the note at the top of this file. */
    id: string;
    title: string;
    duration: number;
    passingMarks: number;
    negativeMarking: boolean;
    negativeMarkingScheme: NegativeMarkingScheme;
    instructions: string;
    published: boolean;
    revealAnswers?: boolean;
    /** Teacher-configured camera/mic proctoring detectors for this exam. */
    proctoring?: ExamProctoringConfig;
    createdBy: string;
    createdAt: number;
    updatedAt: number;
    questions: ExamQuestion[];
    timeGrants: TimeGrant[];
}

export interface AttemptResponseItem {
    questionId: string;
    selectedOptionIds?: string[];
    natValue?: string;
    isMarkedForReview?: boolean;
    isAnswered?: boolean;
    visited?: boolean;
}

export interface AttemptAnswerEntry {
    correct: string[] | string;
}

export interface ExamAttempt {
    _id: string;
    /** Alias for `_id` — see the note at the top of this file. */
    id: string;
    examId: string;
    examTitle: string;
    studentId: string;
    responses: AttemptResponseItem[];
    /** Snapshot of `exam.questions` at submit time. */
    questions: ExamQuestion[];
    answers: Record<string, AttemptAnswerEntry>;
    score: number;
    totalMarks: number;
    correctCount: number;
    total: number;
    revealAnswers: boolean;
    tabSwitches?: number;
    startedAt?: number;
    /** Camera/mic proctoring violations logged during this attempt (audit trail, not graded). */
    proctoringEvents?: ProctoringEvent[];
    submittedAt: number;
}

export interface RedeemGrantResponse {
    ok: boolean;
    minutes?: number;
    error?: string;
}

// ─── Request payloads ───────────────────────────────────────

export interface TimeGrantSeedInput {
    minutes: number;
    note?: string;
}

export interface CreateExamInput {
    title: string;
    duration?: number;
    passingMarks?: number;
    negativeMarking?: boolean;
    negativeMarkingScheme?: NegativeMarkingScheme;
    instructions?: string;
    revealAnswers?: boolean;
    proctoring?: ExamProctoringConfig;
    timeGrants?: TimeGrantSeedInput[];
}

export type UpdateExamInput = Partial<
    Omit<CreateExamInput, 'timeGrants'> & { published: boolean }
>;

export interface AddQuestionInput {
    type: ExamQuestionType;
    questionText: string;
    questionImage?: string;
    options?: ExamQuestionOption[];
    correctOptions: string[];
    marks: number;
    negativeMarks?: number;
    useCustomNegative?: boolean;
    natAnswerType?: string;
}

export type UpdateQuestionInput = Partial<AddQuestionInput>;

export interface AddTimeGrantInput {
    minutes: number;
    note?: string;
}

export interface SubmitAttemptInput {
    responses: AttemptResponseItem[];
    tabSwitches?: number;
    startedAt?: number;
    proctoringEvents?: ProctoringEvent[];
}

// ─── id-aliasing helpers ─────────────────────────────────────

function withId<T extends { _id: string }>(doc: T): T & { id: string } {
    return { ...doc, id: doc._id };
}

function withIds<T extends { _id: string }>(docs: T[]): (T & { id: string })[] {
    return docs.map(withId);
}

// ─── API functions ───────────────────────────────────────────

export const examApi = {
    // ── Exams ────────────────────────────────────────────────

    getMyExams: async (): Promise<Exam[]> => {
        const data = await apiFetch<Exam[]>(`${BASE_URL}`);
        return withIds(data);
    },

    getPublishedExams: async (): Promise<Exam[]> => {
        const data = await apiFetch<Exam[]>(`${BASE_URL}/published`);
        return withIds(data);
    },

    getExam: async (examId: string): Promise<Exam> => {
        const data = await apiFetch<Exam>(`${BASE_URL}/${examId}`);
        return withId(data);
    },

    createExam: async (input: CreateExamInput): Promise<Exam> => {
        const data = await apiFetch<Exam>(`${BASE_URL}`, {
            method: 'POST',
            body: JSON.stringify(input),
        });
        return withId(data);
    },

    updateExam: async (examId: string, patch: UpdateExamInput): Promise<Exam> => {
        const data = await apiFetch<Exam>(`${BASE_URL}/${examId}`, {
            method: 'PATCH',
            body: JSON.stringify(patch),
        });
        return withId(data);
    },

    deleteExam: async (examId: string): Promise<{ success: boolean }> => {
        return apiFetch(`${BASE_URL}/${examId}`, { method: 'DELETE' });
    },

    // ── Questions ────────────────────────────────────────────

    addQuestion: async (examId: string, input: AddQuestionInput): Promise<Exam> => {
        const data = await apiFetch<Exam>(`${BASE_URL}/${examId}/questions`, {
            method: 'POST',
            body: JSON.stringify(input),
        });
        return withId(data);
    },

    updateQuestion: async (
        examId: string,
        questionId: string,
        patch: UpdateQuestionInput,
    ): Promise<Exam> => {
        const data = await apiFetch<Exam>(`${BASE_URL}/${examId}/questions/${questionId}`, {
            method: 'PATCH',
            body: JSON.stringify(patch),
        });
        return withId(data);
    },

    removeQuestion: async (examId: string, questionId: string): Promise<Exam> => {
        const data = await apiFetch<Exam>(`${BASE_URL}/${examId}/questions/${questionId}`, {
            method: 'DELETE',
        });
        return withId(data);
    },

    // ── Time grants ──────────────────────────────────────────

    addTimeGrant: async (examId: string, input: AddTimeGrantInput): Promise<Exam> => {
        const data = await apiFetch<Exam>(`${BASE_URL}/${examId}/time-grants`, {
            method: 'POST',
            body: JSON.stringify(input),
        });
        return withId(data);
    },

    removeTimeGrant: async (examId: string, grantId: string): Promise<Exam> => {
        const data = await apiFetch<Exam>(`${BASE_URL}/${examId}/time-grants/${grantId}`, {
            method: 'DELETE',
        });
        return withId(data);
    },

    redeemTimeGrant: async (examId: string, code: string): Promise<RedeemGrantResponse> => {
        return apiFetch(`${BASE_URL}/${examId}/redeem-grant`, {
            method: 'POST',
            body: JSON.stringify({ code }),
        });
    },

    // ── Attempts ─────────────────────────────────────────────

    submitAttempt: async (examId: string, input: SubmitAttemptInput): Promise<ExamAttempt> => {
        const data = await apiFetch<ExamAttempt>(`${BASE_URL}/${examId}/attempts`, {
            method: 'POST',
            body: JSON.stringify(input),
        });
        return withId(data);
    },

    getMyAttempts: async (): Promise<ExamAttempt[]> => {
        const data = await apiFetch<ExamAttempt[]>(`${BASE_URL}/attempts/mine`);
        return withIds(data);
    },

    getAttempt: async (attemptId: string): Promise<ExamAttempt> => {
        const data = await apiFetch<ExamAttempt>(`${BASE_URL}/attempts/${attemptId}`);
        return withId(data);
    },
};
