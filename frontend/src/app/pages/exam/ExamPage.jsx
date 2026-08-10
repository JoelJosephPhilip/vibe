import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Palette } from '@/components/exam/Palette'
import { QuestionRenderer } from '@/components/exam/QuestionRenderer'
import { Calculator } from '@/components/exam/Calculator'
import { examStore, computeNegativeMarks } from '@/lib/examStore'
import { useExamSecurity } from '@/lib/useExamSecurity'

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

// Black/white is the primary palette. Orange is kept only as a thin accent
// (active-tab underline, links, hover states) rather than large fills —
// wall-to-wall orange badges/bars read as too much of one color.
const INK = '#111827'
const ACCENT = '#F0A93B'

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function CountdownDisplay({ initialSeconds, onExpire }) {
  const [s, setS] = useState(initialSeconds)

  // Keep the latest onExpire without making it an effect dependency (it's a
  // new arrow function on every parent render, which would otherwise force
  // the interval effect below to tear down and restart every render).
  const onExpireRef = useRef(onExpire)
  useEffect(() => { onExpireRef.current = onExpire }, [onExpire])

  // One steady interval that only restarts when crossing the expired
  // boundary (not on every single tick, which the old `[s, onExpire]`
  // dependency caused). Calling setS with a plain updater keeps this free
  // of side effects, so it's safe even if React invokes the updater more
  // than once (e.g. under StrictMode double-invoke checks).
  useEffect(() => {
    if (s <= 0) return
    const id = setInterval(() => setS((prev) => Math.max(0, prev - 1)), 1000)
    return () => clearInterval(id)
  }, [s <= 0])

  // Fire onExpire exactly once, as a real effect, when the countdown
  // reaches zero - not buried inside the setState updater above.
  useEffect(() => {
    if (s === 0) onExpireRef.current?.()
  }, [s])

  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return <span>{String(h).padStart(2, '0')}:{String(m).padStart(2, '0')}:{String(sec).padStart(2, '0')}</span>
}

export default function ExamPage() {
  const navigate = useNavigate()
  const { examId } = useParams()
  const examData = examStore.get(examId)
  // NOTE: this used to `return` the "not available" screen right here,
  // above every hook below. That's a Rules-of-Hooks violation — if this
  // component ever re-renders with a different examId in place (route
  // param change without a full remount) while switching between an
  // empty/broken exam and a valid one, the number of hooks called would
  // differ between renders and React would throw or corrupt state. Instead
  // we compute a flag, use safe fallbacks so every hook below always runs,
  // and only branch to the "not available" screen in the final render,
  // after all hooks have been called.
  const hasExam = !!(examData && examData.questions && examData.questions.length > 0)

  const exam = hasExam
    ? { ...examData, totalMarks: examStore.totalMarks(examData) }
    : { questions: [], duration: 0, title: '' }

  // Persist the in-progress attempt (question order, responses, elapsed
  // time, etc.) so a refresh/crash rehydrates the SAME attempt instead of
  // starting a new one. sessionStorage (not localStorage) is used on
  // purpose: it survives a refresh of this tab/window, but is cleared once
  // the exam window is closed or submitted, so it can't be used to resume a
  // finished/abandoned attempt later.
  const sessionKey = `exam_session_${examId}`
  const savedSession = (() => {
    if (!hasExam) return null
    try {
      const raw = sessionStorage.getItem(sessionKey)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') return null

      // A session belonging to an attempt that was already submitted (or whose
      // timer has already run out) must NOT be resumed - otherwise starting the
      // test again instantly rehydrates the finished attempt and auto-submits,
      // which is what made a retake show "finished" straight away.
      const durationSec = (examData.duration || 0) * 60 + (parsed.extraSeconds || 0)
      const elapsed = Math.floor((Date.now() - (parsed.startedAt || 0)) / 1000)
      if (parsed.submitted || !parsed.startedAt || elapsed >= durationSec) {
        sessionStorage.removeItem(sessionKey)
        return null
      }
      return parsed
    } catch {
      try { sessionStorage.removeItem(sessionKey) } catch {}
      return null
    }
  })()

  // Shuffle questions + options and REMAP option ids to A, B, C... by new
  // position. We keep an old->new id map per question so we can translate the
  // original correctOptions into the new letter ids for scoring.
  const [{ questions, answers }] = useState(() => {
    if (!hasExam) return { questions: [], answers: {} }
    if (savedSession?.questions?.length && savedSession?.answers) {
      // Resuming after a refresh — reuse the exact same shuffled order and
      // answer key so numbering, options, and scoring stay consistent.
      return { questions: savedSession.questions, answers: savedSession.answers }
    }
    const shuffledQuestions = shuffle(examData.questions).map((q) => {
      if ((q.type === 'MCQ' || q.type === 'MSQ') && Array.isArray(q.options) && q.options.length) {
        const idMap = {} // originalId -> newLetterId
        const newOptions = shuffle(q.options).map((opt, i) => {
          const newId = LETTERS[i]
          idMap[opt.id] = newId
          return { ...opt, id: newId, label: newId }
        })
        return { ...q, options: newOptions, __idMap: idMap }
      }
      return q
    })

    const answerMap = {}
    for (const q of shuffledQuestions) {
      const orig = examData.questions.find((o) => o.id === q.id)
      if (q.type === 'NAT') {
        answerMap[q.id] = { correct: orig.correctOptions[0] ?? '' }
      } else {
        // translate original option ids -> new letter ids
        const remapped = (orig.correctOptions || []).map((oid) => q.__idMap?.[oid] ?? oid)
        answerMap[q.id] = { correct: remapped }
      }
    }

    // strip helper before handing questions to renderer
    const cleaned = shuffledQuestions.map(({ __idMap, ...rest }) => rest)
    return { questions: cleaned, answers: answerMap }
  })

  const subjectName = examData?.title || ''
  const candidateName = examData?.candidateName || 'DEMO CANDIDATE'
  const candidateRegId = ''
  const headerTitle = examData?.headerTitle || 'Graduate Aptitude Test in Engineering (GATE 2026)'
  const headerSubtitle = examData?.headerSubtitle || 'Organizing Institute: Indian Institute of Technology Guwahati'
  const leftBadge = examData?.leftBadge || 'GATE'
  const rightBadge = examData?.rightBadge || 'IITG'
  const leftLogo = examData?.leftLogo
  const rightLogo = examData?.rightLogo

  const [currentIndex, setCurrentIndex] = useState(savedSession?.currentIndex ?? 0)
  const [showCalc, setShowCalc] = useState(false)
  const [responses, setResponses] = useState(
    savedSession?.responses?.length
      ? savedSession.responses
      : questions.map((q) => ({
          question: q.id,
          selectedOptions: [],
          natAnswer: '',
          isMarkedForReview: false,
          isAnswered: false,
          visited: false,
          timeSpent: 0,
        }))
  )

  const [tabSwitches, setTabSwitches] = useState(savedSession?.tabSwitches ?? 0)
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false)
  const [showTabWarning, setShowTabWarning] = useState(false)
  // The clock the countdown is measured from. On first load this is "now";
  // on a refresh mid-attempt it's restored from the saved session so the
  // remaining time keeps counting down from where it actually was, instead
  // of resetting to the full duration.
  const startedAtRef = useRef(savedSession?.startedAt ?? Date.now())

  // Extra-time code redemption (admin can issue a one-time code per exam for
  // students who hit a technical issue; entering it adds bonus minutes here)
  const [extraSeconds, setExtraSeconds] = useState(savedSession?.extraSeconds ?? 0)
  const [showCodeInput, setShowCodeInput] = useState(false)
  const [codeInput, setCodeInput] = useState('')
  const [codeMsg, setCodeMsg] = useState('')

  const handleRedeemCode = () => {
    const result = examStore.redeemTimeGrant(examData.id, codeInput)
    if (result.ok) {
      setExtraSeconds((s) => s + result.minutes * 60)
      setCodeMsg(`+${result.minutes} min added.`)
      setCodeInput('')
      setTimeout(() => setShowCodeInput(false), 1500)
    } else {
      setCodeMsg(result.error)
    }
  }

  // Keep the saved session in sync with live state so a refresh (or crash)
  // resumes exactly where the candidate left off — same start time, same
  // question order, same answers — rather than granting a fresh timer.
  // Set once the attempt is submitted so nothing re-writes the session key
  // afterwards (a late state update used to resurrect a finished attempt).
  const submittedRef = useRef(false)

  useEffect(() => {
    if (submittedRef.current) return
    try {
      sessionStorage.setItem(
        sessionKey,
        JSON.stringify({
          questions,
          answers,
          responses,
          currentIndex,
          tabSwitches,
          extraSeconds,
          startedAt: startedAtRef.current,
        })
      )
    } catch {}
  }, [questions, answers, responses, currentIndex, tabSwitches, extraSeconds])

  // Fullscreen enforcement + right-click / devtools / copy-paste blocking
  const { isFullscreen, requestFullscreen } = useExamSecurity(true)

  useEffect(() => {
    setResponses((prev) => {
      const next = [...prev]
      if (!next[currentIndex]?.visited) {
        next[currentIndex] = { ...next[currentIndex], visited: true }
      }
      return next
    })
  }, [currentIndex])

  useEffect(() => {
    const onBlur = () => {
      setTabSwitches((prev) => prev + 1)
      setShowTabWarning(true)
    }
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [])

  const updateResponse = (update) => {
    setResponses((prev) => {
      const next = [...prev]
      const merged = { ...next[currentIndex], ...update, visited: true }
      merged.isAnswered =
        (merged.selectedOptions && merged.selectedOptions.length > 0) ||
        (merged.natAnswer && merged.natAnswer.length > 0)
      next[currentIndex] = merged
      return next
    })
  }

  const goNext = () => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))
  const goPrev = () => setCurrentIndex((i) => Math.max(0, i - 1))

  const handleSaveAndNext = () => goNext()
  const handleMarkReviewNext = () => {
    updateResponse({ isMarkedForReview: true })
    goNext()
  }
  const handleClearResponse = () => {
    updateResponse({ selectedOptions: [], natAnswer: '', isAnswered: false })
  }

  const handleSubmit = () => {
    if (submittedRef.current) return // guard against double submit (e.g. timer + click)
    submittedRef.current = true
    try {
      let score = 0
      let correctCount = 0
      responses.forEach((r, i) => {
        const q = questions[i]
        const key = answers[q.id]
        if (!key) return
        // Use the same computeNegativeMarks(exam, q) helper ResultPage.jsx
        // recomputes scores with, instead of reading q.negativeMarks
        // directly - keeps the score saved at submit time consistent with
        // the "live" score shown on the result page, and stops MSQ wrong
        // answers from silently skipping negative marking.
        const neg = computeNegativeMarks(exam, q)
        if (q.type === 'NAT') {
          if ((r.natAnswer || '').trim() === key.correct) { score += q.marks; correctCount++ }
        } else if (q.type === 'MCQ') {
          const sel = (r.selectedOptions || [])[0]
          const correct = Array.isArray(key.correct) ? key.correct[0] : key.correct
          if (sel === correct) { score += q.marks; correctCount++ }
          else if (sel) { score -= neg }
        } else if (q.type === 'MSQ') {
          const sel = [...(r.selectedOptions || [])].sort().join(',')
          const correct = [].concat(key.correct).sort().join(',')
          if (sel.length > 0 && sel === correct) { score += q.marks; correctCount++ }
          else if (sel.length > 0) { score -= neg }
        }
      })

      const attemptId = `local-${Date.now()}`
      const payload = {
        score: Math.max(0, Number(score.toFixed(2))),
        totalMarks: exam.totalMarks,
        correctCount,
        total: questions.length,
        responses,
        questions,
        answers,
        examTitle: exam.title,
        revealAnswers: examData.revealAnswers ?? false,
        examId: examData.id,
      }

      // Base64 question/option images can blow past the ~5MB localStorage
      // quota. If the full payload does not fit, retry without images.
      // ResultPage.jsx re-hydrates missing images by matching question id
      // (and option text, since option ids get shuffled per-attempt)
      // against the live exam in examStore, so they still show up there as
      // long as the exam itself isn't later deleted.
      const key = `result_${attemptId}`
      const stripImages = (p) => ({
        ...p,
        questions: p.questions.map((q) => ({
          ...q,
          questionImage: undefined,
          options: (q.options || []).map((o) => ({ ...o, image: undefined })),
        })),
      })
      let saved = false
      try {
        localStorage.setItem(key, JSON.stringify(payload))
        saved = true
      } catch (e) {
        try {
          localStorage.setItem(key, JSON.stringify(stripImages(payload)))
          saved = true
        } catch (e2) {
          // Last resort: keep the attempt for this tab only so the result
          // page still renders instead of showing "No result found".
          try {
            sessionStorage.setItem(key, JSON.stringify(stripImages(payload)))
            saved = true
          } catch {}
        }
      }
      if (!saved) console.error('Could not persist result payload')

      try { sessionStorage.removeItem(sessionKey) } catch {}

      try {
        const idx = JSON.parse(localStorage.getItem('attempts_index') || '[]')
        idx.unshift({
          attemptId,
          examId: examData.id,
          examTitle: exam.title,
          score: payload.score,
          totalMarks: payload.totalMarks,
          correctCount,
          total: questions.length,
          submittedAt: new Date().toISOString(),
        })
        localStorage.setItem('attempts_index', JSON.stringify(idx.slice(0, 200)))
      } catch {}

      // Leave fullscreen/secure mode before routing so the result page is usable.
      try { if (document.fullscreenElement) document.exitFullscreen() } catch {}

      navigate(`/result/${attemptId}`)
    } catch (err) {
      submittedRef.current = false
      console.error('Submit failed', err)
      alert('Could not submit: ' + (err?.message || err))
    }
  }

  const currentQuestion = questions[currentIndex]
  const remainingSeconds = Math.max(
    0,
    exam.duration * 60 + extraSeconds - Math.floor((Date.now() - startedAtRef.current) / 1000)
  )

  const counts = responses.reduce(
    (acc, r) => {
      if (r.isAnswered && r.isMarkedForReview) acc.answeredMarked++
      else if (r.isAnswered) acc.answered++
      else if (r.isMarkedForReview) acc.marked++
      else if (r.visited) acc.notAnswered++
      else acc.notVisited++
      return acc
    },
    { answered: 0, marked: 0, notAnswered: 0, notVisited: 0, answeredMarked: 0 }
  )

  const watermarkSvg = `data:image/svg+xml,%3Csvg width='350' height='200' xmlns='http://www.w3.org/2000/svg'%3E%3Ctext x='50%25' y='50%25' font-size='24' fill='rgba(0,0,0,0.05)' font-family='Arial' font-weight='bold' text-anchor='middle' transform='rotate(-35, 175, 100)'%3E${encodeURIComponent(subjectName + ' ' + candidateRegId)}%3C/text%3E%3C/svg%3E`

  // All hooks above have run unconditionally on every render, so it's now
  // safe to branch on exam availability.
  if (!hasExam) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 text-center">
        <div className="max-w-md space-y-3">
          <h1 className="text-2xl font-bold">Test not available</h1>
          <p className="text-sm text-muted-foreground">
            This test does not exist or has no questions yet.
          </p>
          <button
            onClick={() => navigate('/')}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Back to home
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-white" style={{ fontFamily: 'Inter, sans-serif' }}>
      {/* Top brand bar */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-1">
        <div className="flex items-center">
          {leftLogo ? (
            <img
              src={leftLogo}
              alt={leftBadge || 'Logo'}
              className="h-12 w-12 rounded object-contain"
            />
          ) : (
            <div
              className="grid h-12 w-12 place-items-center rounded px-1 text-center text-[10px] font-bold leading-tight text-white"
              style={{ backgroundColor: INK }}
            >
              {leftBadge}
            </div>
          )}
        </div>
        <div className="text-center">
          <h1 className="text-lg font-bold uppercase tracking-tight sm:text-xl" style={{ color: INK }}>
            {headerTitle}
          </h1>
          <p className="-mt-1 text-[10px] font-bold uppercase tracking-widest text-gray-500">
            {headerSubtitle}
          </p>
        </div>
        <div className="flex items-center">
          {rightLogo ? (
            <img
              src={rightLogo}
              alt={rightBadge || 'Logo'}
              className="h-10 w-10 rounded-full object-contain"
            />
          ) : (
            <div
              className="grid h-10 w-10 place-items-center rounded-full px-1 text-center text-[9px] font-bold leading-tight text-white"
              style={{ backgroundColor: INK }}
            >
              {rightBadge}
            </div>
          )}
        </div>
      </div>

      {/* Subject bar */}
      <div
        className="flex items-center justify-between border-b-2 bg-white px-4 py-1 text-sm font-semibold"
        style={{ borderColor: ACCENT, color: INK }}
      >
        <span>{subjectName} Mock</span>
        <button
          onClick={() => setShowCalc((s) => !s)}
          className="flex items-center gap-1 text-gray-700 transition-colors hover:text-black"
        >
          <span className="text-xs">🖩 Scientific Calculator</span>
        </button>
      </div>

      {/* Sections + timer + candidate */}
      <div className="flex flex-none items-stretch border-b border-gray-300 bg-[#F7F7F7]" style={{ minHeight: 86 }}>
        <div className="flex flex-grow flex-col justify-end">
          <div className="px-4 py-1 text-[10px] font-bold uppercase text-gray-600">Sections</div>
          <div className="flex items-center gap-1 px-4">
            <div
              className="rounded-t-md border-t-2 border-x border-gray-300 px-4 py-2 text-sm font-bold text-white"
              style={{ borderTopColor: ACCENT, backgroundColor: INK }}
            >
              {subjectName}
            </div>
          </div>
        </div>

        <div className="flex items-center border-l border-gray-300 bg-white">
          <div className="flex h-full min-w-[170px] flex-col justify-center border-r border-gray-300 px-6 text-right">
            <span className="mb-1 text-[10px] font-bold uppercase text-gray-500">Time Left:</span>
            <div
              className="text-[22px] font-extrabold leading-none tracking-tighter"
              style={{ fontFamily: 'monospace', color: INK }}
            >
              <CountdownDisplay key={extraSeconds} initialSeconds={remainingSeconds} onExpire={() => handleSubmit()} />
            </div>
            {!showCodeInput ? (
              <button
                onClick={() => setShowCodeInput(true)}
                className="mt-1 text-[10px] font-medium underline hover:brightness-90"
                style={{ color: ACCENT }}
              >
                Have an extra-time code?
              </button>
            ) : (
              <div className="mt-1 flex flex-col items-end gap-1">
                <div className="flex gap-1">
                  <input
  value={codeInput}
  onChange={(e) => setCodeInput(e.target.value)}
  placeholder="CODE"
  className="w-20 rounded px-1 py-0.5 text-[11px] uppercase focus:outline-none"
  style={{
    backgroundColor: '#ffffff',
    color: '#111827',
    border: '1px solid #9ca3af',
    caretColor: '#111827',
  }}
/>

                  <button
                    onClick={handleRedeemCode}
                    className="rounded px-2 py-0.5 text-[11px] font-bold text-white hover:brightness-90"
                    style={{ backgroundColor: INK }}
                  >
                    Apply
                  </button>
                </div>
                {codeMsg && <span className="text-[10px] text-gray-600">{codeMsg}</span>}
              </div>
            )}
          </div>

          <div className="flex h-full items-center gap-3 bg-white px-4">
            <div className="flex flex-col justify-center">
              <span className="mb-1 text-[10px] font-bold uppercase leading-none text-gray-500">
                Candidate Name:
              </span>
              <span className="text-[15px] font-bold uppercase leading-tight" style={{ color: INK }}>
                {candidateName}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main grid */}
      <main className="w-full min-h-0 flex-1 overflow-hidden p-4">
        <div className="mx-auto grid h-full min-h-0 max-w-7xl grid-cols-1 gap-4 lg:grid-cols-4">
          <div className="flex min-h-0 flex-col gap-2 lg:col-span-3">
            {/* Question type strip */}
            <div className="flex flex-wrap items-center justify-between gap-2 border border-gray-300 bg-white px-4 py-2 text-[13px] shadow-sm">
              <div className="font-bold text-black">
                Question Type: <span className="font-normal">{currentQuestion?.type}</span>
              </div>
              <div className="flex items-center text-gray-700">
                Marks for correct answer:&nbsp;
                <span className="font-bold text-green-700">{currentQuestion?.marks}</span>
                <span className="mx-2 text-gray-400">|</span>
                Negative Marks:&nbsp;
                <span className="font-bold text-red-700">{currentQuestion?.negativeMarks}</span>
              </div>
            </div>

            {/* Question card */}
            <div className="flex min-h-0 flex-1 flex-col border border-gray-300 bg-white shadow-sm">
              <div className="border-b border-gray-200 px-4 py-2">
                <h2 className="text-[15px] font-bold text-black">
                  Question No. <span>{currentIndex + 1}</span>
                </h2>
              </div>
              <div
                className="relative min-h-0 flex-1 overflow-y-auto p-6"
                style={{
                  backgroundImage: `url("${watermarkSvg}")`,
                  backgroundRepeat: 'repeat',
                }}
              >
                <div className="relative z-10">
                  {currentQuestion && (
                    <QuestionRenderer
                      question={currentQuestion}
                      response={responses[currentIndex] || {}}
                      onChange={updateResponse}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Palette — fixed in place; scrolls internally only if it has too many questions */}
          <div className="flex min-h-0 flex-col lg:col-span-1">
            <div className="min-h-0 flex-1 overflow-y-auto">
              <Palette
                total={questions.length}
                current={currentIndex}
                responses={responses}
                onSelect={(i) => setCurrentIndex(i)}
              />
            </div>
          </div>
        </div>
      </main>

      {/* Footer bar */}
      <footer className="sticky bottom-0 z-10 flex-none border-t border-gray-300 bg-gray-100 p-3 shadow-lg">
        <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-4 lg:grid-cols-4">
          <div className="flex justify-between gap-2 lg:col-span-3 lg:border-r lg:border-gray-300 lg:pr-4">
            <div className="flex flex-wrap gap-2">
              <button onClick={handleMarkReviewNext} className="rounded-sm border border-gray-300 bg-white px-4 py-2 text-[13px] font-bold text-gray-700 hover:bg-gray-100">
                Mark for Review &amp; Next
              </button>
              <button onClick={handleClearResponse} className="rounded-sm border border-gray-300 bg-white px-4 py-2 text-[13px] font-bold text-gray-700 hover:bg-gray-100">
                Clear Response
              </button>
              <button onClick={goPrev} disabled={currentIndex === 0} className="rounded-sm border border-gray-300 bg-white px-4 py-2 text-[13px] font-bold text-gray-700 hover:bg-gray-100 disabled:opacity-50">
                &lt;&lt; Previous
              </button>
            </div>
            <div>
              <button
                onClick={handleSaveAndNext}
                className="rounded-sm border px-4 py-2 text-[13px] font-bold text-white hover:brightness-125"
                style={{ borderColor: INK, backgroundColor: INK }}
              >
                Save &amp; Next
              </button>
            </div>
          </div>
          <div className="flex justify-center lg:pl-2">
            <button
              onClick={() => setShowSubmitConfirm(true)}
              className="w-[90%] rounded border py-1.5 text-sm font-bold text-white shadow-sm hover:brightness-125"
              style={{ borderColor: INK, backgroundColor: INK }}
            >
              Submit
            </button>
          </div>
        </div>
      </footer>

      {/* Floating calculator */}
      {showCalc && (
        <div className="fixed left-8 top-24 z-50 w-[380px] rounded-md border border-gray-400 bg-[#dadada] shadow-2xl">
          <div
            className="flex items-center justify-between px-3 py-1.5 text-white"
            style={{ backgroundColor: INK }}
          >
            <span className="text-sm font-semibold">Scientific Calculator</span>
            <button onClick={() => setShowCalc(false)} className="text-lg">×</button>
          </div>
          <div className="p-2">
            <Calculator />
          </div>
        </div>
      )}

      {/* Submit modal — rounded-tile design, matching the Palette look */}
      {showSubmitConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-[560px] overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="px-6 pb-2 pt-6">
              <h2 className="text-xl font-bold" style={{ color: INK }}>Submit quiz?</h2>
              <p className="mt-1 text-sm text-gray-500">
                Review your progress below before you finish the test.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 px-6 py-5">
              <SummaryTile color="#22C55E" count={counts.answered} label="Answered" />
              <SummaryTile color="#EF4444" count={counts.notAnswered} label="Not Answered" />
              <SummaryTile color="#D1D5DB" textDark count={counts.notVisited} label="Not Visited" />
              <SummaryTile color={INK} count={counts.marked} label="Marked for Review" />
              <SummaryTile
                color={INK}
                accentDot="#22C55E"
                count={counts.answeredMarked}
                label="Answered & Marked (evaluated)"
                span2
              />
            </div>

            <div className="flex justify-end gap-3 bg-gray-50 px-6 py-4">
              <button
                onClick={() => setShowSubmitConfirm(false)}
                className="rounded-full border border-gray-300 bg-white px-5 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-100"
              >
                Keep Reviewing
              </button>
              <button
                onClick={() => handleSubmit()}
                className="rounded-full px-6 py-2 text-sm font-semibold text-white shadow-sm hover:brightness-110"
                style={{ backgroundColor: ACCENT, color: INK }}
              >
                Submit Test
              </button>
            </div>
          </div>
        </div>
      )}

      {!isFullscreen && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-black/90 px-6 text-center text-white">
          <h2 className="text-2xl font-bold">Fullscreen required</h2>
          <p className="max-w-md text-sm text-gray-300">
            This test must be taken in fullscreen mode. Exiting fullscreen is recorded.
            Click below to continue your test.
          </p>
          <button
            onClick={requestFullscreen}
            className="rounded px-6 py-2 text-sm font-bold text-black hover:brightness-90"
            style={{ backgroundColor: ACCENT }}
          >
            Enter Fullscreen
          </button>
        </div>
      )}

      {showTabWarning && (
        <div className="fixed bottom-4 right-4 z-50 rounded-md bg-red-600 px-4 py-3 text-sm text-white shadow-lg">
          <p className="font-semibold">Warning: Tab switching detected ({tabSwitches})</p>
          <p className="text-xs">Repeated switching may be reported to the admin.</p>
          <button onClick={() => setShowTabWarning(false)} className="mt-2 text-xs underline">
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}

function SummaryTile({ color, count, label, textDark = false, accentDot, span2 = false }) {
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-3 ${span2 ? 'col-span-2' : ''}`}
    >
      <div
        className="relative grid h-10 w-10 flex-none place-items-center rounded-lg text-base font-bold"
        style={{ backgroundColor: color, color: textDark ? '#111827' : '#fff' }}
      >
        {count}
        {accentDot && (
          <span
            className="absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full border-2 border-white"
            style={{ backgroundColor: accentDot }}
          />
        )}
      </div>
      <span className="text-sm font-medium leading-tight text-gray-700">{label}</span>
    </div>
  )
}