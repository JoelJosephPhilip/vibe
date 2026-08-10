import { Routes, Route } from 'react-router-dom'
import HomePage from './routes/HomePage.jsx'
import AdminPage from './routes/AdminPage.jsx'
import EditExamPage from './routes/EditExamPage.jsx'
import ExamPage from './routes/ExamPage.jsx'
import ResultPage from './routes/ResultPage.jsx'

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/admin/:examId" element={<EditExamPage />} />
      <Route path="/exam/:examId" element={<ExamPage />} />
      <Route path="/result/:attemptId" element={<ResultPage />} />
    </Routes>
  )
}

export default App
