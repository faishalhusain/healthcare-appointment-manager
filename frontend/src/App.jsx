import { Routes, Route, Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Register from './pages/Register';
import BookAppointment from './pages/patient/BookAppointment';
import MyAppointments from './pages/patient/MyAppointments';
import DoctorQueue from './pages/doctor/Dashboard';
import ManageDoctors from './pages/admin/Dashboard';

const HOME_BY_ROLE = { patient: '/patient/book', doctor: '/doctor/queue', admin: '/admin/doctors' };

function Protected({ role, children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) return <Navigate to={HOME_BY_ROLE[user.role]} replace />;
  return <Layout>{children}</Layout>;
}

function CalendarConnected() {
  const [params] = useSearchParams();
  const failed = params.get('error');
  return (
    <div className="card" style={{ maxWidth: 420 }}>
      {failed ? (
        <>
          <h2>Connection failed</h2>
          <p className="muted">We couldn't connect your Google Calendar. Please try again from the sidebar.</p>
        </>
      ) : (
        <>
          <h2>Google Calendar connected ✅</h2>
          <p className="muted">Future appointment confirmations, reschedules, and cancellations will now sync to your calendar automatically.</p>
        </>
      )}
    </div>
  );
}

export default function App() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={HOME_BY_ROLE[user.role]} /> : <Login />} />
      <Route path="/register" element={user ? <Navigate to={HOME_BY_ROLE[user.role]} /> : <Register />} />

      <Route path="/patient/book" element={<Protected role="patient"><BookAppointment /></Protected>} />
      <Route path="/patient/appointments" element={<Protected role="patient"><MyAppointments /></Protected>} />

      <Route path="/doctor/queue" element={<Protected role="doctor"><DoctorQueue /></Protected>} />

      <Route path="/admin/doctors" element={<Protected role="admin"><ManageDoctors /></Protected>} />

      <Route path="/calendar-connected" element={<Protected><CalendarConnected /></Protected>} />

      <Route path="*" element={<Navigate to={user ? HOME_BY_ROLE[user.role] : '/login'} replace />} />
    </Routes>
  );
}
