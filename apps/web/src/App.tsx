import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { ChangesPage } from './pages/ChangesPage';
import { DashboardPage } from './pages/DashboardPage';
import { MessagesPage } from './pages/MessagesPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ReviewPage } from './pages/ReviewPage';
import { TimetablePage } from './pages/TimetablePage';

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="timetable" element={<TimetablePage />} />
        <Route path="review" element={<ReviewPage />} />
        <Route path="messages" element={<MessagesPage />} />
        <Route path="changes" element={<ChangesPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
