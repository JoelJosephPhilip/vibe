import { mockExam, mockQuestions, mockAnswers } from './mockExam.js'

const KEY = 'exam_store_v1'

const DEFAULT_SCHEME = {
  MCQ: 'one_third',   // 'none' | 'one_third' | 'one_fourth' | 'full' | 'custom'
  MSQ: 'none',
  NAT: 'none',
}

export function computeNegativeMarks(exam, question) {
  // Per-question override wins when explicitly enabled
  if (question?.useCustomNegative) return Number(question.negativeMarks) || 0

  const scheme = exam?.negativeMarkingScheme?.[question.type] ?? DEFAULT_SCHEME[question.type] ?? 'none'
  const m = Number(question.marks) || 0
  switch (scheme) {
    case 'one_third':  return +(m / 3).toFixed(4)
    case 'one_fourth': return +(m / 4).toFixed(4)
    case 'full':       return m
    case 'custom':     return Number(question.negativeMarks) || 0
    case 'none':
    default:           return 0
  }
}

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O or 1/I confusion
  let s = ''
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}

export const examStore = {
  list() {
    return load()
  },
  listPublished() {
    return load().filter((e) => e.published && e.questions.length > 0)
  },
  get(id) {
    return load().find((e) => e.id === id)
  },
  create(input) {
    const exams = load()
    const id = `exam-${Date.now()}`
    const exam = {
      id,
      title: input.title,
      duration: input.duration ?? 30,
      passingMarks: input.passingMarks ?? 0,
      negativeMarking: input.negativeMarking ?? true,
      negativeMarkingScheme: input.negativeMarkingScheme ?? { ...DEFAULT_SCHEME },
      instructions: input.instructions ?? '',
      published: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      questions: [],
      timeGrants: input.timeGrants ?? [],
    }
    exams.push(exam)
    save(exams)
    return exam
  },
  update(id, patch) {
    const exams = load()
    const idx = exams.findIndex((e) => e.id === id)
    if (idx === -1) return undefined
    exams[idx] = { ...exams[idx], ...patch, id: exams[idx].id, updatedAt: Date.now() }
    save(exams)
    return exams[idx]
  },
  remove(id) {
    save(load().filter((e) => e.id !== id))
  },
  togglePublish(id) {
    const exam = this.get(id)
    if (!exam) return undefined
    return this.update(id, { published: !exam.published })
  },
  addQuestion(examId, question) {
    const exams = load()
    const exam = exams.find((e) => e.id === examId)
    if (!exam) return undefined
    const q = { ...question, id: `q-${Date.now()}` }
    exam.questions.push(q)
    exam.updatedAt = Date.now()
    save(exams)
    return q
  },
  updateQuestion(examId, qid, patch) {
    const exams = load()
    const exam = exams.find((e) => e.id === examId)
    if (!exam) return
    const idx = exam.questions.findIndex((q) => q.id === qid)
    if (idx === -1) return
    exam.questions[idx] = { ...exam.questions[idx], ...patch, id: exam.questions[idx].id }
    exam.updatedAt = Date.now()
    save(exams)
  },
  removeQuestion(examId, qid) {
    const exams = load()
    const exam = exams.find((e) => e.id === examId)
    if (!exam) return
    exam.questions = exam.questions.filter((q) => q.id !== qid)
    exam.updatedAt = Date.now()
    save(exams)
  },
  totalMarks(exam) {
    return exam.questions.reduce((sum, q) => sum + (Number(q.marks) || 0), 0)
  },
  // Effective negative marks for a question, using scheme + per-question override
  negativeFor(exam, question) {
    return computeNegativeMarks(exam, question)
  },
  answersMap(exam) {
    const map = {}
    for (const q of exam.questions) {
      if (q.type === 'NAT') {
        map[q.id] = { correct: q.correctOptions[0] ?? '' }
      } else {
        map[q.id] = { correct: q.correctOptions }
      }
    }
    return map
  },

  // ---- Extra-time grants (admin-issued codes for technical-issue makeups) ----
  addTimeGrant(examId, { minutes, note } = {}) {
    const exams = load()
    const exam = exams.find((e) => e.id === examId)
    if (!exam) return undefined
    if (!Array.isArray(exam.timeGrants)) exam.timeGrants = []
    const grant = {
      id: `grant-${Date.now()}`,
      code: genCode(),
      minutes: Number(minutes) || 0,
      note: note || '',
      used: false,
      usedAt: null,
      createdAt: Date.now(),
    }
    exam.timeGrants.push(grant)
    exam.updatedAt = Date.now()
    save(exams)
    return grant
  },
  removeTimeGrant(examId, grantId) {
    const exams = load()
    const exam = exams.find((e) => e.id === examId)
    if (!exam) return
    exam.timeGrants = (exam.timeGrants || []).filter((g) => g.id !== grantId)
    exam.updatedAt = Date.now()
    save(exams)
  },
  redeemTimeGrant(examId, rawCode) {
    const exams = load()
    const exam = exams.find((e) => e.id === examId)
    if (!exam) return { ok: false, error: 'Exam not found' }
    const code = (rawCode || '').trim().toUpperCase()
    if (!code) return { ok: false, error: 'Enter a code' }
    const grant = (exam.timeGrants || []).find((g) => g.code === code)
    if (!grant) return { ok: false, error: 'Invalid code' }
    if (grant.used) return { ok: false, error: 'This code has already been used' }
    grant.used = true
    grant.usedAt = Date.now()
    exam.updatedAt = Date.now()
    save(exams)
    return { ok: true, minutes: grant.minutes }
  },
}

function seedDemo() {
  const questions = mockQuestions.map((q) => {
    const key = mockAnswers[q.id]
    const correct = key ? (Array.isArray(key.correct) ? key.correct : [key.correct]) : []
    return {
      id: q.id,
      type: q.type,
      questionText: q.questionText,
      questionImage: undefined,
      options: q.options ?? [],
      correctOptions: correct,
      marks: q.marks,
      negativeMarks: q.negativeMarks,
      useCustomNegative: false,
      natAnswerType: q.natAnswerType,
    }
  })
  return {
    id: 'demo',
    title: mockExam.title,
    duration: mockExam.duration,
    passingMarks: mockExam.passingMarks,
    negativeMarking: mockExam.negativeMarking,
    negativeMarkingScheme: { ...DEFAULT_SCHEME },
    instructions: mockExam.instructions,
    published: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    questions,
    timeGrants: [],
  }
}

function load() {
  if (typeof window === 'undefined') return [seedDemo()]
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) {
      const seeded = [seedDemo()]
      localStorage.setItem(KEY, JSON.stringify(seeded))
      return seeded
    }
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) {
      const seeded = [seedDemo()]
      localStorage.setItem(KEY, JSON.stringify(seeded))
      return seeded
    }
    // Backfill scheme / timeGrants on older exams so UI/scoring always has a value
    let mutated = false
    for (const e of parsed) {
      if (!e.negativeMarkingScheme) {
        e.negativeMarkingScheme = { ...DEFAULT_SCHEME }
        mutated = true
      }
      if (!Array.isArray(e.timeGrants)) {
        e.timeGrants = []
        mutated = true
      }
    }
    if (mutated) localStorage.setItem(KEY, JSON.stringify(parsed))
    return parsed
  } catch {
    return [seedDemo()]
  }
}

function save(exams) {
  if (typeof window === 'undefined') return
  localStorage.setItem(KEY, JSON.stringify(exams))
  window.dispatchEvent(new Event('exam_store_updated'))
}