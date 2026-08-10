// LocalStorage-backed store for exams and questions.
// No backend required — everything persists in the browser.

import { mockExam, mockQuestions, mockAnswers } from "./mockExam";

export type QuestionType = "MCQ" | "MSQ" | "NAT";

export interface Option {
  id: string;
  text: string;
  image?: string; // dataURL
}

export interface Question {
  id: string;
  type: QuestionType;
  questionText: string;
  questionImage?: string; // dataURL
  options: Option[]; // empty for NAT
  correctOptions: string[]; // option ids for MCQ (1), MSQ (n); for NAT, [numericString]
  marks: number;
  negativeMarks: number;
  natAnswerType?: "integer" | "decimal";
}

export interface Exam {
  id: string;
  title: string;
  duration: number; // minutes
  passingMarks: number;
  negativeMarking: boolean;
  instructions: string;
  published: boolean;
  createdAt: number;
  updatedAt: number;
  questions: Question[];
  // Header customization (per-exam, editable from admin panel)
  headerTitle?: string;
  headerSubtitle?: string;
  leftBadge?: string;
  rightBadge?: string;
  candidateName?: string;
}

const KEY = "exam_store_v1";

function seedDemo(): Exam {
  const questions: Question[] = mockQuestions.map((q) => {
    const key = mockAnswers[q.id];
    const correct = key
      ? Array.isArray(key.correct)
        ? key.correct
        : [key.correct as string]
      : [];
    return {
      id: q.id,
      type: q.type,
      questionText: q.questionText,
      options: (q as any).options ?? [],
      correctOptions: correct,
      marks: q.marks,
      negativeMarks: q.negativeMarks,
      natAnswerType: (q as any).natAnswerType,
    };
  });
  return {
    id: "demo",
    title: mockExam.title,
    duration: mockExam.duration,
    passingMarks: mockExam.passingMarks,
    negativeMarking: mockExam.negativeMarking,
    instructions: mockExam.instructions,
    published: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    questions,
  };
}

function load(): Exam[] {
  if (typeof window === "undefined") return [seedDemo()];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      const seeded = [seedDemo()];
      localStorage.setItem(KEY, JSON.stringify(seeded));
      return seeded;
    }
    const parsed = JSON.parse(raw) as Exam[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      const seeded = [seedDemo()];
      localStorage.setItem(KEY, JSON.stringify(seeded));
      return seeded;
    }
    return parsed;
  } catch {
    return [seedDemo()];
  }
}

function save(exams: Exam[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(exams));
  window.dispatchEvent(new Event("exam_store_updated"));
}

export const examStore = {
  list(): Exam[] {
    return load();
  },
  listPublished(): Exam[] {
    return load().filter((e) => e.published && e.questions.length > 0);
  },
  get(id: string): Exam | undefined {
    return load().find((e) => e.id === id);
  },
  create(input: Partial<Exam> & { title: string }): Exam {
    const exams = load();
    const id = `exam-${Date.now()}`;
    const exam: Exam = {
      id,
      title: input.title,
      duration: input.duration ?? 30,
      passingMarks: input.passingMarks ?? 0,
      negativeMarking: input.negativeMarking ?? true,
      instructions: input.instructions ?? "",
      published: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      questions: [],
      headerTitle: input.headerTitle ?? "Graduate Aptitude Test in Engineering (GATE 2026)",
      headerSubtitle: input.headerSubtitle ?? "Organizing Institute: Indian Institute of Technology Guwahati",
      leftBadge: input.leftBadge ?? "GATE",
      rightBadge: input.rightBadge ?? "IITG",
      candidateName: input.candidateName ?? "DEMO CANDIDATE",
    };
    exams.push(exam);
    save(exams);
    return exam;
  },
  update(id: string, patch: Partial<Exam>): Exam | undefined {
    const exams = load();
    const idx = exams.findIndex((e) => e.id === id);
    if (idx === -1) return undefined;
    exams[idx] = { ...exams[idx], ...patch, id: exams[idx].id, updatedAt: Date.now() };
    save(exams);
    return exams[idx];
  },
  remove(id: string) {
    save(load().filter((e) => e.id !== id));
  },
  togglePublish(id: string): Exam | undefined {
    const exam = examStore.get(id);
    if (!exam) return undefined;
    return examStore.update(id, { published: !exam.published });
  },
  addQuestion(examId: string, question: Omit<Question, "id">): Question | undefined {
    const exams = load();
    const exam = exams.find((e) => e.id === examId);
    if (!exam) return undefined;
    const q: Question = { ...question, id: `q-${Date.now()}` };
    exam.questions.push(q);
    exam.updatedAt = Date.now();
    save(exams);
    return q;
  },
  updateQuestion(examId: string, qid: string, patch: Partial<Question>) {
    const exams = load();
    const exam = exams.find((e) => e.id === examId);
    if (!exam) return;
    const idx = exam.questions.findIndex((q) => q.id === qid);
    if (idx === -1) return;
    exam.questions[idx] = { ...exam.questions[idx], ...patch, id: exam.questions[idx].id };
    exam.updatedAt = Date.now();
    save(exams);
  },
  removeQuestion(examId: string, qid: string) {
    const exams = load();
    const exam = exams.find((e) => e.id === examId);
    if (!exam) return;
    exam.questions = exam.questions.filter((q) => q.id !== qid);
    exam.updatedAt = Date.now();
    save(exams);
  },
  totalMarks(exam: Exam): number {
    return exam.questions.reduce((sum, q) => sum + q.marks, 0);
  },
  answersMap(exam: Exam): Record<string, { correct: string[] | string }> {
    const map: Record<string, { correct: string[] | string }> = {};
    for (const q of exam.questions) {
      if (q.type === "NAT") {
        map[q.id] = { correct: q.correctOptions[0] ?? "" };
      } else {
        map[q.id] = { correct: q.correctOptions };
      }
    }
    return map;
  },
};
