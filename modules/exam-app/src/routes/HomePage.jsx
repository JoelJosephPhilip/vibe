import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { examStore } from '../lib/examStore.js'

export default function HomePage() {
  const [exams, setExams] = useState([])

  useEffect(() => {
    const refresh = () => setExams(examStore.listPublished())
    refresh()
    window.addEventListener('exam_store_updated', refresh)
    return () => window.removeEventListener('exam_store_updated', refresh)
  }, [])

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-4xl space-y-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              ViBe Test Platform
            </h1>
          </div>
          <Link
            to="/admin"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Admin Panel
          </Link>
        </header>

        <section>
          <h2 className="mb-4 text-lg font-semibold text-foreground">Available tests</h2>
          {exams.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No published tests yet.{' '}

              .
            </div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {exams.map((e) => {
                const total = examStore.totalMarks(e)
                return (
                  <li
                    key={e.id}
                    className="rounded-md border border-border bg-card p-4 shadow-sm"
                  >
                    <h3 className="font-semibold text-foreground">{e.title}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {e.questions.length} questions · {e.duration} min · {total} marks
                    </p>
                    <Link
                      to={`/exam/${e.id}`}
                      className="mt-3 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                    >
                      Start Test
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
