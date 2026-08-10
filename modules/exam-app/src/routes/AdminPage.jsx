import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { examStore } from '../lib/examStore.js'

export default function AdminPage() {
  const navigate = useNavigate()
  const [exams, setExams] = useState([])
  const [title, setTitle] = useState('')
  const [duration, setDuration] = useState(30)

  const refresh = () => setExams(examStore.list())
  useEffect(() => {
    refresh()
    window.addEventListener('exam_store_updated', refresh)
    return () => window.removeEventListener('exam_store_updated', refresh)
  }, [])

  const handleCreate = (e) => {
    e.preventDefault()
    if (!title.trim()) return
    const exam = examStore.create({ title: title.trim(), duration })
    setTitle('')
    setDuration(30)
    navigate(`/admin/${exam.id}`)
  }

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Admin Panel</h1>
            <p className="text-sm text-muted-foreground">
              Create, edit, and publish mock tests. Data is stored locally in this browser.
            </p>
          </div>
          <Link to="/" className="text-sm text-primary underline">
            ← Back to home
          </Link>
        </header>

        <section className="rounded-md border border-border bg-card p-4 shadow-sm">
          <h2 className="mb-3 font-semibold text-foreground">Create new mock test</h2>
          <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. GATE CSE Full Length Mock 1"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Duration (min)</label>
              <input
                type="number"
                min={1}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value) || 30)}
                className="w-28 rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Create
            </button>
          </form>
        </section>

        <section>
          <h2 className="mb-3 font-semibold text-foreground">All tests</h2>
          {exams.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tests yet.</p>
          ) : (
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Title</th>
                    <th className="px-3 py-2">Questions</th>
                    <th className="px-3 py-2">Marks</th>
                    <th className="px-3 py-2">Duration</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {exams.map((exam) => (
                    <tr key={exam.id} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">{exam.title}</td>
                      <td className="px-3 py-2">{exam.questions.length}</td>
                      <td className="px-3 py-2">{examStore.totalMarks(exam)}</td>
                      <td className="px-3 py-2">{exam.duration} min</td>
                      <td className="px-3 py-2">
                        <span
                          className={
                            'rounded-full px-2 py-0.5 text-xs font-medium ' +
                            (exam.published
                              ? 'bg-green-100 text-green-800'
                              : 'bg-gray-100 text-gray-700')
                          }
                        >
                          {exam.published ? 'Published' : 'Draft'}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          <Link
                            to={`/admin/${exam.id}`}
                            className="rounded border border-input bg-background px-2 py-1 text-xs hover:bg-accent"
                          >
                            Edit
                          </Link>
                          <button
                            onClick={() => examStore.togglePublish(exam.id)}
                            disabled={!exam.published && exam.questions.length === 0}
                            className="rounded border border-input bg-background px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
                            title={
                              !exam.published && exam.questions.length === 0
                                ? 'Add questions before publishing'
                                : ''
                            }
                          >
                            {exam.published ? 'Unpublish' : 'Publish'}
                          </button>
                          {exam.published && exam.questions.length > 0 && (
                            <Link
                              to={`/exam/${exam.id}`}
                              className="rounded border border-input bg-background px-2 py-1 text-xs hover:bg-accent"
                            >
                              Preview
                            </Link>
                          )}
                          <button
                            onClick={() => {
                              if (confirm(`Delete "${exam.title}"?`)) examStore.remove(exam.id)
                            }}
                            className="rounded border border-red-300 bg-white px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                          >
                            Delete
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
      </div>
    </div>
  )
}
