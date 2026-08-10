import { mockExam, mockQuestions, mockAnswers } from './mockExam.js'

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
      instructions: input.instructions ?? '',
      published: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      questions: [],
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
    return exam.questions.reduce((sum, q) => sum + q.marks, 0)
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
}

const KEY = 'exam_store_v1'

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
      natAnswerType: q.natAnswerType,
    }
  })
  return {
    id: 'demo',
    title: mockExam.title,
    duration: mockExam.duration,
    passingMarks: mockExam.passingMarks,
    negativeMarking: mockExam.negativeMarking,
    instructions: mockExam.instructions,
    published: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    questions,
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
