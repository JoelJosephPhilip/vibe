import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { examStore } from '@/lib/examStore'

export default function MyTestsPage() {
  const [attempts, setAttempts] = useState([])

  const load = () => {
    try {
      const idx = JSON.parse(localStorage.getItem('attempts_index') || '[]')
      const seen = new Set(idx.map((a) => a.attemptId))

      // Backfill: scan localStorage for any result_* entries that aren't in
      // the index yet (older attempts saved before attempts_index existed).
      const backfilled = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (!key || !key.startsWith('result_')) continue
        const attemptId = key.slice('result_'.length)
        if (seen.has(attemptId)) continue
        try {
          const payload = JSON.parse(localStorage.getItem(key) || 'null')
          if (!payload) continue
          const exam = payload.examId ? examStore.get(payload.examId) : null
          backfilled.push({
            attemptId,
            examId: payload.examId || '',
            examTitle: payload.examTitle || exam?.title || 'Previous attempt',
            submittedAt: payload.submittedAt || new Date(0).toISOString(),
            score: payload.score ?? 0,
            totalMarks: payload.totalMarks ?? 0,
            correctCount: payload.correctCount ?? 0,
            total: payload.total ?? (payload.questions?.length || 0),
          })
          seen.add(attemptId)
        } catch {}
      }

      const merged = [...idx, ...backfilled].sort(
        (a, b) => new Date(b.submittedAt) - new Date(a.submittedAt)
      )

      if (backfilled.length > 0) {
        localStorage.setItem('attempts_index', JSON.stringify(merged.slice(0, 200)))
      }
      setAttempts(merged)
    } catch {
      setAttempts([])
    }
  }

  useEffect(() => {
    load()
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    window.addEventListener('storage', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('storage', onFocus)
    }
  }, [])

  const removeAttempt = (attemptId) => {
    if (!confirm('Delete this attempt?')) return
    const next = attempts.filter((a) => a.attemptId !== attemptId)
    localStorage.setItem('attempts_index', JSON.stringify(next))
    localStorage.removeItem(`result_${attemptId}`)
    setAttempts(next)
  }

  const clearAll = () => {
    if (!confirm('Delete all attempts?')) return
    attempts.forEach((a) => localStorage.removeItem(`result_${a.attemptId}`))
    localStorage.removeItem('attempts_index')
    setAttempts([])
  }

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ margin: 0 }}>My Tests</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to="/" style={btn('#6B7280')}>Home</Link>
          {attempts.length > 0 && (
            <button onClick={clearAll} style={btn('#DC2626')}>Clear All</button>
          )}
        </div>
      </div>

      {attempts.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', background: '#F9FAFB', border: '1px dashed #D1D5DB', borderRadius: 8, color: '#6B7280' }}>
          No attempts yet. Complete an exam to see it here.
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ background: '#F3F4F6' }}>
              <tr>
                <Th>Exam</Th>
                <Th>Submitted</Th>
                <Th>Score</Th>
                <Th>Correct</Th>
                <Th>Reveal</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((a) => {
                const exam = examStore.get(a.examId)
                const reveal = !!exam?.revealAnswers
                return (
                  <tr key={a.attemptId} style={{ borderTop: '1px solid #E5E7EB' }}>
                    <Td><strong>{a.examTitle || 'Exam'}</strong></Td>
                    <Td>{new Date(a.submittedAt).toLocaleString()}</Td>
                    <Td>{reveal ? `${a.score} / ${a.totalMarks}` : 'Hidden'}</Td>
                    <Td>{reveal ? `${a.correctCount} / ${a.total}` : `— / ${a.total}`}</Td>
                    <Td>
                      <span style={{
                        padding: '2px 8px', borderRadius: 12, fontSize: 12,
                        background: reveal ? '#DCFCE7' : '#FEE2E2',
                        color: reveal ? '#166534' : '#991B1B',
                      }}>{reveal ? 'ON' : 'OFF'}</span>
                    </Td>
                    <Td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <Link to={`/result/${a.attemptId}`} style={btn('#2563EB')}>View / PDF</Link>
                        <button onClick={() => removeAttempt(a.attemptId)} style={btn('#DC2626')}>Delete</button>
                      </div>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const Th = ({ children }) => (
  <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 13, color: '#374151' }}>{children}</th>
)
const Td = ({ children }) => (
  <td style={{ padding: '10px 12px', fontSize: 14, color: '#111827' }}>{children}</td>
)
const btn = (bg) => ({
  padding: '6px 12px', background: bg, color: '#fff', border: 'none',
  borderRadius: 6, cursor: 'pointer', textDecoration: 'none', fontSize: 13, display: 'inline-block',
})
