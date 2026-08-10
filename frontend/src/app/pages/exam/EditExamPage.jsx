import { useEffect, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { examStore } from '@/lib/examStore'
import { fileToDataUrl } from '@/lib/imageUtils'
import { RichText } from '@/components/exam/RichText'

const emptyQuestion = () => {
  const qId = String(Math.floor(1000 + Math.random() * 9000)); // e.g. 9908
  return {
    id: qId,
    type: 'MCQ',
    questionText: '',
    options: [
      { id: `${qId}_1`, text: '' },
      { id: `${qId}_2`, text: '' },
      { id: `${qId}_3`, text: '' },
      { id: `${qId}_4`, text: '' },
    ],
    correctOptions: [],
    marks: 1,
    negativeMarks: 0,
    customNegativeMarks: false,
    natAnswerType: 'integer',
  }
}

// Default GATE-style ratios: MCQ loses 1/3 per mark, MSQ/NAT have none by default.
const defaultNegativeMarkingRatios = {
  MCQ: { num: 1, den: 3 },
  MSQ: { num: 0, den: 1 },
  NAT: { num: 0, den: 1 },
}

function calcNegativeMarks(marks, type, ratios) {
  const r = (ratios && ratios[type]) || defaultNegativeMarkingRatios[type] || { num: 0, den: 1 }
  const den = r.den || 1
  const value = (Number(marks) || 0) * (r.num / den)
  // Keep a sane number of decimals without introducing float noise like 0.6666666666
  return Math.round(value * 1000) / 1000
}

function ratioLabel(r) {
  if (!r || r.num === 0) return 'No negative marking'
  return `−${r.num}/${r.den} per mark`
}

// Generic modal wrapper: backdrop + centered, internally-scrollable panel.
// Lets us surface the "add question" form from anywhere on the page without
// forcing the admin to scroll to the bottom of a long question list.
function Modal({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 px-4 py-8 sm:items-center">
      <div
        className="absolute inset-0"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative z-10 w-full max-w-3xl rounded-lg border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="font-semibold text-foreground">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            ✕
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  )
}

export default function EditExamPage() {
  const { examId } = useParams()
  const navigate = useNavigate()
  const [exam, setExam] = useState(() => examStore.get(examId))
  const [addQuestionOpen, setAddQuestionOpen] = useState(false)

  useEffect(() => {
    const refresh = () => setExam(examStore.get(examId))
    refresh()
    window.addEventListener('exam_store_updated', refresh)
    return () => window.removeEventListener('exam_store_updated', refresh)
  }, [examId])

  if (!exam) {
    return (
      <div className="min-h-screen bg-background px-4 py-10">
        <div className="mx-auto max-w-5xl">
          <p className="text-sm text-muted-foreground">Test not found.</p>
          <Link to="/admin" className="text-sm text-primary underline">Back to admin</Link>
        </div>
      </div>
    )
  }

  const totalMarks = examStore.totalMarks(exam)
  const negativeMarkingRatios = exam.negativeMarkingRatios ?? defaultNegativeMarkingRatios

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link to="/admin" className="text-xs text-primary underline">← All tests</Link>
            <h1 className="text-2xl font-bold text-foreground">{exam.title}</h1>
            <p className="text-sm text-muted-foreground">
              {exam.questions.length} questions · {totalMarks} marks · {exam.duration} min ·{' '}
              {exam.published ? 'Published' : 'Draft'}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setAddQuestionOpen(true)}
              className="rounded-md border border-primary px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10"
            >
              + Add question
            </button>
            <button
              onClick={() => examStore.togglePublish(exam.id)}
              disabled={!exam.published && exam.questions.length === 0}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {exam.published ? 'Unpublish' : 'Publish'}
            </button>
            {exam.published && (
              <button
                onClick={() => navigate(`/exam/${exam.id}`)}
                className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
              >
                Preview
              </button>
            )}
          </div>
        </header>

        <ExamSettings exam={exam} />
        <RevealAnswersSetting exam={exam} />
        <TimeGrantsSection exam={exam} />
        <ExamHeaderSettings exam={exam} />
        <QuestionsSection exam={exam} negativeMarkingRatios={negativeMarkingRatios} />

        {/* Bottom trigger kept for anyone used to scrolling down — opens the
            same modal as the header button, so there's no more inline form
            to scroll past. */}
        <button
          onClick={() => setAddQuestionOpen(true)}
          className="w-full rounded-md border-2 border-dashed border-border py-3 text-sm font-medium text-muted-foreground hover:border-primary hover:text-primary"
        >
          + Add question
        </button>
      </div>

      {/* Floating action button: always reachable regardless of scroll position
          on long exams, so adding a question never requires scrolling. */}
      <button
        onClick={() => setAddQuestionOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-2xl leading-none text-primary-foreground shadow-lg hover:bg-primary/90"
        aria-label="Add question"
        title="Add question"
      >
        +
      </button>

      <Modal open={addQuestionOpen} onClose={() => setAddQuestionOpen(false)} title="New question">
        <QuestionForm
          initial={emptyQuestion()}
          negativeMarkingEnabled={exam.negativeMarking}
          negativeMarkingRatios={negativeMarkingRatios}
          onCancel={() => setAddQuestionOpen(false)}
          onSubmit={(data) => {
            examStore.addQuestion(exam.id, data)
            setAddQuestionOpen(false)
          }}
        />
      </Modal>
    </div>
  )
}


function RevealAnswersSetting({ exam }) {
  const [reveal, setReveal] = useState(exam.revealAnswers ?? false)
  useEffect(() => setReveal(exam.revealAnswers ?? false), [exam.id])

  const toggle = (val) => {
    setReveal(val)
    examStore.update(exam.id, { revealAnswers: val })
  }

  return (
    <section className="rounded-md border border-border bg-card p-4 shadow-sm">
      <h2 className="mb-1 font-semibold text-foreground">Answer visibility</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        When ON, candidates see correct answers on the result page and in the downloaded PDF.
        When OFF, only their own responses are shown.
      </p>
      <label className="inline-flex cursor-pointer items-center gap-3">
        <span className="relative inline-block h-6 w-11">
          <input
            type="checkbox"
            checked={reveal}
            onChange={(e) => toggle(e.target.checked)}
            className="peer sr-only"
          />
          <span className="absolute inset-0 rounded-full bg-gray-300 transition peer-checked:bg-primary" />
          <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
        </span>
        <span className="text-sm font-medium text-foreground">
          Reveal correct answers to candidates {reveal ? '(ON)' : '(OFF)'}
        </span>
      </label>
    </section>
  )
}


function TimeGrantsSection({ exam }) {
  const [minutes, setMinutes] = useState(10)
  const [note, setNote] = useState('')
  const [justCreatedId, setJustCreatedId] = useState(null)
  const [copiedId, setCopiedId] = useState(null)

  const grants = [...(exam.timeGrants || [])].sort((a, b) => b.createdAt - a.createdAt)

  const handleGenerate = (e) => {
    e.preventDefault()
    const grant = examStore.addTimeGrant(exam.id, { minutes, note: note.trim() })
    if (grant) {
      setJustCreatedId(grant.id)
      setNote('')
    }
  }

  const handleCopy = (grant) => {
    navigator.clipboard?.writeText(grant.code).then(() => {
      setCopiedId(grant.id)
      setTimeout(() => setCopiedId((id) => (id === grant.id ? null : id)), 1200)
    })
  }

  const handleRevoke = (grant) => {
    if (!grant.used && !confirm(`Revoke unused code ${grant.code}?`)) return
    examStore.removeTimeGrant(exam.id, grant.id)
  }

  return (
    <section className="rounded-md border border-border bg-card p-4 shadow-sm">
      <h2 className="mb-1 font-semibold text-foreground">Extra time</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Generate a one-time code for a candidate who hit a technical issue. They enter it on
        the exam screen to add bonus minutes to their own timer only — it doesn't change the
        exam's duration for anyone else.
      </p>

      <form onSubmit={handleGenerate} className="mb-4 flex flex-wrap items-end gap-3">
        <label className="block text-sm">
          <span className="text-xs font-medium text-muted-foreground">Minutes</span>
          <input
            type="number"
            min={1}
            value={minutes}
            onChange={(e) => setMinutes(Math.max(1, Number(e.target.value) || 1))}
            className="mt-1 w-24 rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="block flex-1 min-w-[200px] text-sm">
          <span className="text-xs font-medium text-muted-foreground">
            Note (candidate name / reason, optional)
          </span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Rahul — laptop restarted"
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Generate code
        </button>
      </form>

      {grants.length === 0 ? (
        <p className="text-sm text-muted-foreground">No codes issued yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                <th className="py-2 pr-4">Code</th>
                <th className="py-2 pr-4">Minutes</th>
                <th className="py-2 pr-4">Note</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {grants.map((g) => (
                <tr
                  key={g.id}
                  className={`border-b border-border/60 ${g.id === justCreatedId ? 'bg-primary/5' : ''}`}
                >
                  <td className="py-2 pr-4 font-mono font-semibold tracking-wide">{g.code}</td>
                  <td className="py-2 pr-4">{g.minutes} min</td>
                  <td className="py-2 pr-4 text-muted-foreground">{g.note || '—'}</td>
                  <td className="py-2 pr-4">
                    {g.used ? (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                        Used
                      </span>
                    ) : (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                        Unused
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    <div className="flex flex-wrap gap-2">
                      {!g.used && (
                        <button
                          onClick={() => handleCopy(g)}
                          className="rounded border border-input bg-background px-2 py-1 text-xs hover:bg-accent"
                        >
                          {copiedId === g.id ? 'Copied!' : 'Copy'}
                        </button>
                      )}
                      <button
                        onClick={() => handleRevoke(g)}
                        className="rounded border border-red-300 bg-white px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                      >
                        {g.used ? 'Remove' : 'Revoke'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}


function ExamSettings({ exam }) {
  const [title, setTitle] = useState(exam.title)
  const [duration, setDuration] = useState(exam.duration)
  const [passingMarks, setPassingMarks] = useState(exam.passingMarks)
  const [negativeMarking, setNegativeMarking] = useState(exam.negativeMarking)
  const [instructions, setInstructions] = useState(exam.instructions)
  const [minSubmitTime, setMinSubmitTime] = useState(exam.minSubmitTime || 0)
  const [ratios, setRatios] = useState(exam.negativeMarkingRatios ?? defaultNegativeMarkingRatios)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setTitle(exam.title)
    setDuration(exam.duration)
    setPassingMarks(exam.passingMarks)
    setNegativeMarking(exam.negativeMarking)
    setInstructions(exam.instructions)
    setMinSubmitTime(exam.minSubmitTime || 0)
    setRatios(exam.negativeMarkingRatios ?? defaultNegativeMarkingRatios)
  }, [exam.id])

  const updateRatio = (type, field, value) => {
    setRatios((prev) => ({
      ...prev,
      [type]: { ...prev[type], [field]: Math.max(0, Number(value) || 0) },
    }))
  }

  const save = () => {
    examStore.update(exam.id, {
      title, duration, passingMarks, negativeMarking, instructions, minSubmitTime,
      negativeMarkingRatios: ratios,
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <section className="rounded-md border border-border bg-card p-4 shadow-sm">
      <h2 className="mb-3 font-semibold text-foreground">Test settings</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm sm:col-span-2">
          Title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-sm">
          Duration (minutes)
          <input
            type="number"
            min={1}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value) || 1)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-sm">
          Min time to submit (minutes)
          <input
            type="number"
            min={0}
            value={minSubmitTime}
            onChange={(e) => setMinSubmitTime(Number(e.target.value) || 0)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-sm sm:col-span-2">
          Passing marks
          <input
            type="number"
            min={0}
            value={passingMarks}
            onChange={(e) => setPassingMarks(Number(e.target.value) || 0)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2 select-none cursor-pointer">
          <input
            type="checkbox"
            checked={negativeMarking}
            onChange={(e) => setNegativeMarking(e.target.checked)}
          />
          Enable negative marking
        </label>

        {negativeMarking && (
          <div className="sm:col-span-2 rounded-md border border-dashed border-border p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Negative marking ratios (applied automatically per question, based on its marks).
              E.g. MCQ 1/3 means a 1-mark question loses 1/3, a 2-mark question loses 2/3.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              {['MCQ', 'MSQ', 'NAT'].map((type) => (
                <div key={type} className="rounded-md border border-border p-2">
                  <p className="mb-1 text-xs font-semibold text-foreground">{type}</p>
                  <div className="flex items-center gap-1 text-sm">
                    <span>−</span>
                    <input
                      type="number"
                      min={0}
                      value={ratios[type]?.num ?? 0}
                      onChange={(e) => updateRatio(type, 'num', e.target.value)}
                      className="w-14 rounded-md border border-input bg-background px-2 py-1 text-sm"
                    />
                    <span>/</span>
                    <input
                      type="number"
                      min={1}
                      value={ratios[type]?.den ?? 1}
                      onChange={(e) => updateRatio(type, 'den', e.target.value)}
                      className="w-14 rounded-md border border-input bg-background px-2 py-1 text-sm"
                    />
                    <span className="text-xs text-muted-foreground">per mark</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    e.g. {calcNegativeMarks(1, type, ratios)} for 1 mark, {calcNegativeMarks(2, type, ratios)} for 2 marks
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        <label className="block text-sm sm:col-span-2">
          Instructions
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={4}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={save}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Save settings
        </button>
        {saved && <span className="text-xs text-green-600">Saved ✓</span>}
      </div>
    </section>
  )
}

function ExamHeaderSettings({ exam }) {
  const [headerTitle, setHeaderTitle] = useState(exam.headerTitle ?? '')
  const [headerSubtitle, setHeaderSubtitle] = useState(exam.headerSubtitle ?? '')
  const [leftBadge, setLeftBadge] = useState(exam.leftBadge ?? '')
  const [rightBadge, setRightBadge] = useState(exam.rightBadge ?? '')
  const [candidateName, setCandidateName] = useState(exam.candidateName ?? '')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setHeaderTitle(exam.headerTitle ?? '')
    setHeaderSubtitle(exam.headerSubtitle ?? '')
    setLeftBadge(exam.leftBadge ?? '')
    setRightBadge(exam.rightBadge ?? '')
    setCandidateName(exam.candidateName ?? '')
  }, [exam.id])

  const save = () => {
    examStore.update(exam.id, {
      headerTitle: headerTitle.trim(),
      headerSubtitle: headerSubtitle.trim(),
      leftBadge: leftBadge.trim(),
      rightBadge: rightBadge.trim(),
      candidateName: candidateName.trim(),
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <section className="rounded-md border border-border bg-card p-4 shadow-sm">
      <h2 className="mb-1 font-semibold text-foreground">Exam header (shown on the test page)</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Customize the top branding bar. e.g. "GATE 2026", "IIT Guwahati", left/right badges.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm sm:col-span-2">
          Header title
          <input
            value={headerTitle}
            onChange={(e) => setHeaderTitle(e.target.value)}
            placeholder="Graduate Aptitude Test in Engineering (GATE 2026)"
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-sm sm:col-span-2">
          Header subtitle
          <input
            value={headerSubtitle}
            onChange={(e) => setHeaderSubtitle(e.target.value)}
            placeholder="Organizing Institute: Indian Institute of Technology Guwahati"
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-sm">
          Left badge
          <input
            value={leftBadge}
            onChange={(e) => setLeftBadge(e.target.value)}
            placeholder="GATE"
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-sm">
          Right badge
          <input
            value={rightBadge}
            onChange={(e) => setRightBadge(e.target.value)}
            placeholder="IITG"
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-sm sm:col-span-2">
          Candidate name (shown in candidate info bar)
          <input
            value={candidateName}
            onChange={(e) => setCandidateName(e.target.value)}
            placeholder="DEMO CANDIDATE"
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={save}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Save header
        </button>
        {saved && <span className="text-xs text-green-600">Saved ✓</span>}
      </div>
    </section>
  )
}

function QuestionsSection({ exam, negativeMarkingRatios }) {
  return (
    <section>
      <h2 className="mb-3 font-semibold text-foreground">Questions ({exam.questions.length})</h2>
      {exam.questions.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No questions yet. Use the "+ Add question" button to add your first one.
        </p>
      ) : (
        <ul className="space-y-3">
          {exam.questions.map((q, i) => (
            <QuestionRow
              key={q.id}
              examId={exam.id}
              question={q}
              index={i}
              negativeMarkingEnabled={exam.negativeMarking}
              negativeMarkingRatios={negativeMarkingRatios}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function QuestionRow({ examId, question, index, negativeMarkingEnabled, negativeMarkingRatios }) {
  const [editing, setEditing] = useState(false)
  return (
    <li className="rounded-md border border-border bg-card p-4 shadow-sm">
      {!editing ? (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded bg-muted px-2 py-0.5 font-mono">Q{index + 1}</span>
              <span className="rounded bg-primary/10 px-2 py-0.5 font-medium text-primary">
                {question.type}
              </span>
              <span>+{question.marks}</span>
              {negativeMarkingEnabled && question.negativeMarks > 0 && (
                <span>−{question.negativeMarks}{question.customNegativeMarks ? ' (custom)' : ''}</span>
              )}
            </div>
            <p className="text-sm text-foreground"><RichText text={question.questionText} /></p>
            {question.questionImage && (
              <img
                src={question.questionImage}
                alt="Question"
                className="mt-2 max-h-48 rounded border border-border object-contain"
              />
            )}
            {question.type !== 'NAT' && (
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
             {/* Replace the previous li implementation for options */}
{question.options.map((o, idx) => (
  <li
    key={o.id}
    className={
      'flex items-center gap-2 ' +
      (question.correctOptions.includes(o.id) ? 'font-semibold text-green-700' : '')
    }
  >
    <span>
      {String.fromCharCode(65 + idx)}. <RichText text={o.text} /> {question.correctOptions.includes(o.id) && '✓'}
    </span>
    {o.image && (
      <img src={o.image} alt="" className="h-10 w-16 rounded border object-contain" />
    )}
  </li>
))}
              </ul>
            )}
            {question.type === 'NAT' && (
              <p className="mt-2 text-xs text-muted-foreground">
                Correct answer: <span className="font-semibold text-green-700">{question.correctOptions[0]}</span>
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <button
              onClick={() => setEditing(true)}
              className="rounded border border-input bg-background px-2 py-1 text-xs hover:bg-accent"
            >
              Edit
            </button>
            <button
              onClick={() => {
                if (confirm('Delete this question?')) examStore.removeQuestion(examId, question.id)
              }}
              className="rounded border border-red-300 bg-white px-2 py-1 text-xs text-red-600 hover:bg-red-50"
            >
              Delete
            </button>
          </div>
        </div>
      ) : (
        <QuestionForm
          initial={question}
          negativeMarkingEnabled={negativeMarkingEnabled}
          negativeMarkingRatios={negativeMarkingRatios}
          onCancel={() => setEditing(false)}
          onSubmit={(patch) => {
            examStore.updateQuestion(examId, question.id, patch)
            setEditing(false)
          }}
        />
      )}
    </li>
  )
}

function QuestionForm({ initial, onSubmit, onCancel, negativeMarkingEnabled, negativeMarkingRatios }) {
  const [type, setType] = useState(initial.type)
  const [questionText, setQuestionText] = useState(initial.questionText)
  const [questionImage, setQuestionImage] = useState(initial.questionImage)
const [options, setOptions] = useState(
    initial.options.length
      ? initial.options
      : [
          { id: `${initial.id || 'new'}_1`, text: '' },
          { id: `${initial.id || 'new'}_2`, text: '' },
          { id: `${initial.id || 'new'}_3`, text: '' },
          { id: `${initial.id || 'new'}_4`, text: '' },
        ]
  )
  const [correct, setCorrect] = useState(initial.correctOptions)
  const [marks, setMarks] = useState(initial.marks)
  const [customNegativeMarks, setCustomNegativeMarks] = useState(initial.customNegativeMarks ?? false)
  const [manualNegativeMarks, setManualNegativeMarks] = useState(initial.negativeMarks ?? 0)
  const [natAnswer, setNatAnswer] = useState(
    initial.type === 'NAT' ? initial.correctOptions[0] ?? '' : ''
  )
  const [natType, setNatType] = useState(initial.natAnswerType ?? 'integer')
  const [uploading, setUploading] = useState(false)

  const computedNegativeMarks = calcNegativeMarks(marks, type, negativeMarkingRatios)
  const effectiveNegativeMarks = customNegativeMarks ? manualNegativeMarks : computedNegativeMarks

  const uploadQuestionImage = async (file) => {
    if (!file) return
    setUploading(true)
    try {
      setQuestionImage(await fileToDataUrl(file, { maxDim: 1400, quality: 0.85 }))
    } catch {
      alert('Failed to load image')
    } finally {
      setUploading(false)
    }
  }

  const uploadOptionImage = async (optId, file) => {
    if (!file) return
    setUploading(true)
    try {
      const dataUrl = await fileToDataUrl(file, { maxDim: 400, quality: 0.85 })
      setOptions((prev) => prev.map((o) => (o.id === optId ? { ...o, image: dataUrl } : o)))
    } catch {
      alert('Failed to load image')
    } finally {
      setUploading(false)
    }
  }

  const toggleCorrect = (id) => {
    if (type === 'MCQ') setCorrect([id])
    else setCorrect((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const submit = () => {
    const hasQText = questionText.trim().length > 0
    if (!hasQText && !questionImage) return alert('Add question text or a question image')

    // Fallback to 0 if negative marking is globally disabled
    const appliedNegativeMarks = negativeMarkingEnabled ? effectiveNegativeMarks : 0
    const appliedCustomFlag = negativeMarkingEnabled ? customNegativeMarks : false

    if (type === 'NAT') {
      if (!natAnswer.trim()) return alert('Correct numeric answer is required')
      onSubmit({
        type,
        questionText: questionText.trim(),
        questionImage,
        options: [],
        correctOptions: [natAnswer.trim()],
        marks,
        negativeMarks: appliedNegativeMarks,
        customNegativeMarks: appliedCustomFlag,
        natAnswerType: natType,
      })
    } else {
      const cleanOptions = options.filter((o) => o.text.trim() || o.image)
      if (cleanOptions.length < 2) return alert('At least 2 options required (text or image)')
      if (correct.length === 0) return alert('Select at least one correct option')
      onSubmit({
        type,
        questionText: questionText.trim(),
        questionImage,
        options: cleanOptions,
        correctOptions: correct.filter((c) => cleanOptions.some((o) => o.id === c)),
        marks,
        negativeMarks: appliedNegativeMarks,
        customNegativeMarks: appliedCustomFlag,
      })
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Type</span>
          <select
            value={type}
            onChange={(e) => {
              const t = e.target.value
              setType(t)
              setCorrect([])
            }}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="MCQ">MCQ (single)</option>
            <option value="MSQ">MSQ (multiple)</option>
            <option value="NAT">NAT (numeric)</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Marks</span>
          <input
            type="number"
            min={0}
            step={0.5}
            value={marks}
            onChange={(e) => setMarks(Number(e.target.value) || 0)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>

        {negativeMarkingEnabled && (
          <div className="block sm:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">Negative marks</span>
            <div className="mt-1 flex items-center gap-2">
              {!customNegativeMarks ? (
                <span className="rounded-md border border-input bg-muted px-3 py-2 text-sm">
                  −{computedNegativeMarks} <span className="text-xs text-muted-foreground">(auto, {ratioLabel(negativeMarkingRatios?.[type])})</span>
                </span>
              ) : (
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={manualNegativeMarks}
                  onChange={(e) => setManualNegativeMarks(Number(e.target.value) || 0)}
                  className="w-32 rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              )}
              <label className="flex items-center gap-1 text-xs text-muted-foreground select-none cursor-pointer">
                <input
                  type="checkbox"
                  checked={customNegativeMarks}
                  onChange={(e) => {
                    setCustomNegativeMarks(e.target.checked)
                    if (e.target.checked) setManualNegativeMarks(computedNegativeMarks)
                  }}
                />
                Override for this question
              </label>
            </div>
          </div>
        )}

        {type === 'NAT' && (
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Answer type</span>
            <select
              value={natType}
              onChange={(e) => setNatType(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="integer">Integer</option>
              <option value="decimal">Decimal</option>
            </select>
          </label>
        )}
      </div>

      <label className="block">
        <span className="text-xs font-medium text-muted-foreground">
          Question text (optional if image provided) — supports $inline$ / $$display$$ LaTeX and `code`
        </span>
        <textarea
          value={questionText}
          onChange={(e) => setQuestionText(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        {questionText.trim() && (
          <div className="mt-1 rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-sm text-foreground">
            <span className="mr-2 text-xs font-medium text-muted-foreground">Preview:</span>
            <RichText text={questionText} />
          </div>
        )}
      </label>

      <div className="rounded-md border border-dashed border-border p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Question image (optional)</span>
          <div className="flex items-center gap-2">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => uploadQuestionImage(e.target.files?.[0] ?? null)}
              className="text-xs"
            />
            {questionImage && (
              <button
                type="button"
                onClick={() => setQuestionImage(undefined)}
                className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50"
              >
                Remove
              </button>
            )}
          </div>
        </div>
        {questionImage && (
          <img
            src={questionImage}
            alt="Question preview"
            className="max-h-64 rounded border border-border object-contain"
          />
        )}
      </div>

      {type !== 'NAT' ? (
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Options ({type === 'MCQ' ? 'select 1 correct' : 'select all correct'})
          </p>
          <div className="space-y-2">
            {options.map((o, i) => (
              <div key={o.id} className="rounded-md border border-border p-2">
                <div className="flex items-center gap-2">
                  <input
                    type={type === 'MCQ' ? 'radio' : 'checkbox'}
                    checked={correct.includes(o.id)}
                    onChange={() => toggleCorrect(o.id)}
                    name="correct-option"
                  />
                  <span className="w-6 text-xs font-bold uppercase">{String.fromCharCode(65 + i)}</span>
                  <input
                    value={o.text}
                    onChange={(e) => {
                      const next = [...options]
                      next[i] = { ...o, text: e.target.value }
                      setOptions(next)
                    }}
                    placeholder={`Option ${String.fromCharCode(65 + i)} text (or leave blank if using image)`}
                    className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                  />
                </div>
                <div className="mt-2 flex items-center gap-2 pl-10">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => uploadOptionImage(o.id, e.target.files?.[0] ?? null)}
                    className="text-xs"
                  />
                  {o.image && (
                    <>
                      <img src={o.image} alt="" className="h-12 w-20 rounded border object-contain" />
                      <button
                        type="button"
                        onClick={() =>
                          setOptions((prev) => prev.map((x) => (x.id === o.id ? { ...x, image: undefined } : x)))
                        }
                        className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50"
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Correct numeric answer</span>
          <input
            value={natAnswer}
            onChange={(e) => setNatAnswer(e.target.value)}
            placeholder="e.g. 42 or 3.14"
            className="mt-1 w-56 rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
      )}

      <div className="flex items-center gap-2 pt-2">
        <button
          onClick={submit}
          disabled={uploading}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {uploading ? 'Uploading…' : 'Save question'}
        </button>
        <button
          onClick={onCancel}
          className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}