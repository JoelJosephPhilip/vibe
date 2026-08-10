import { MemoryRouter, Routes, Route } from 'react-router-dom'
import HomePage     from './HomePage'
import ExamPage     from './ExamPage'
import ResultPage   from './ResultPage'
import AdminPage    from './AdminPage'
import EditExamPage from './EditExamPage'
import MyTestsPage  from './MyTestsPage'

export default function ExamAppShell() {
  const fullPath = window.location.pathname + window.location.search
  const innerPath = fullPath.replace(/^\/(teacher\/)?exam-app/, '') || '/'

  return (
    <MemoryRouter initialEntries={[innerPath]}>
      <Routes>
        <Route path="/my-tests"               element={<MyTestsPage />} />
        <Route path="/"                       element={<HomePage />} />
        <Route path="/exam/:examId"           element={<ExamPage />} />
        <Route path="/result/:attemptId"      element={<ResultPage />} />
        <Route path="/admin"                  element={<AdminPage />} />
        <Route path="/admin/:examId"          element={<EditExamPage />} />
      </Routes>
    </MemoryRouter>
  )
}