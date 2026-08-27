import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import TeacherAutomationPage from './pages/TeacherAutomationPage.jsx';
import ApplicationsPage from './pages/ApplicationsPage.jsx';
import TuitionAutomationOverviewPage from './pages/TuitionAutomationOverviewPage.jsx';

export default function App() {
  return (
    <main className="app-shell">
      <header className="site-header">
        <div>
          <p className="eyebrow">Standalone testing system</p>
          <h1>AI Teacher Automation</h1>
        </div>
        <nav aria-label="Primary navigation">
          <NavLink to="/teachers">Teacher Automation</NavLink>
          <NavLink to="/applications">Automation History</NavLink>
          <NavLink to="/tuition-matches">Tuition Requirements</NavLink>
        </nav>
      </header>
      <Routes>
        <Route path="/teachers" element={<TeacherAutomationPage />} />
        <Route path="/applications" element={<ApplicationsPage />} />
        <Route path="/tuition-matches" element={<TuitionAutomationOverviewPage />} />
        <Route path="*" element={<Navigate to="/teachers" replace />} />
      </Routes>
    </main>
  );
}
