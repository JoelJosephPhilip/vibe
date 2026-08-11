import 'reflect-metadata';
import { ObjectId } from 'mongodb';
import { Expose } from 'class-transformer';
import { IsString } from 'class-validator';

export type ExamQuestionType = 'MCQ' | 'MSQ' | 'NAT';

export type NegativeMarkingSchemeValue =
    | 'none'
    | 'one_third'
    | 'one_fourth'
    | 'full'
    | 'custom';

export interface IExamQuestionOption {
    id: string;
    text: string;
    image?: string;
}

export interface IExamQuestion {
    id: string;
    type: ExamQuestionType;
    questionText: string;
    questionImage?: string;
    options: IExamQuestionOption[];
    /** For NAT, a single-element array holding the numeric answer as a string. */
    correctOptions: string[];
    marks: number;
    negativeMarks: number;
    useCustomNegative: boolean;
    natAnswerType?: string;
}

export interface ITimeGrant {
    id: string;
    code: string;
    minutes: number;
    note: string;
    used: boolean;
    usedAt: number | null;
    createdAt: number;
}

export interface INegativeMarkingScheme {
    MCQ: NegativeMarkingSchemeValue;
    MSQ: NegativeMarkingSchemeValue;
    NAT: NegativeMarkingSchemeValue;
}

export interface IExamProctoringDetector {
    detectorName: string;
    enabled: boolean;
}

/**
 * Per-exam proctoring configuration. Deliberately separate from (not coupled
 * to) the `ProctoringComponent` enum used for course lessons
 * (`shared/database/interfaces/ISettingRepository.ts`) — `detectorName` is
 * just a free string on our side, so the exam module has no import
 * dependency on the setting module. In practice the frontend is expected to
 * send the same detector names as that enum (`cameraMic`, `blurDetection`,
 * `faceCountDetection`, `handGestureDetection`, `voiceDetection`,
 * `virtualBackgroundDetection`, `rightClickDisabled`, `faceRecognition`), but
 * nothing here enforces that.
 */
export interface IExamProctoringConfig {
    detectors: IExamProctoringDetector[];
}

/**
 * Mongo document shape for the `exams` collection. Mirrors the localStorage
 * exam shape from `frontend/src/lib/examStore.js` so the frontend migration
 * off `localStorage` is mostly a plumbing change — questions and time-grants
 * stay embedded arrays rather than becoming separate collections.
 */
export interface IExam {
    _id?: ObjectId;
    title: string;
    duration: number;
    passingMarks: number;
    negativeMarking: boolean;
    negativeMarkingScheme: INegativeMarkingScheme;
    instructions: string;
    published: boolean;
    /**
     * Whether students are shown correct answers on their result page. A real
     * per-exam setting (`EditExamPage.jsx` toggles it via
     * `examStore.update(exam.id, { revealAnswers })`), not part of the
     * original spec's IExam shape — added here so that toggle has somewhere
     * to persist. Defaults to false, matching the existing frontend default.
     */
    revealAnswers?: boolean;
    /**
     * Per-exam proctoring configuration (which detectors are enabled for
     * this exam). Optional/absent means proctoring is not configured for
     * this exam — not the same as an empty `detectors` array.
     */
    proctoring?: IExamProctoringConfig;
    /** Firebase uid / `user._id.toString()` of the creator — see AttemptController. */
    createdBy: string;
    createdAt: number;
    updatedAt: number;
    questions: IExamQuestion[];
    timeGrants: ITimeGrant[];
}

@Expose()
export class ExamMessageResponse {
    @IsString()
    @Expose()
    message: string;

    constructor(message: string) {
        this.message = message;
    }
}

@Expose()
export class RedeemGrantResponse {
    @Expose()
    ok: boolean;

    @Expose()
    minutes?: number;

    @Expose()
    error?: string;

    constructor(input: { ok: boolean; minutes?: number; error?: string }) {
        this.ok = input.ok;
        this.minutes = input.minutes;
        this.error = input.error;
    }
}
