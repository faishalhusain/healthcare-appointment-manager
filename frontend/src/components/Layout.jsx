import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';

const NAV_BY_ROLE = {
  patient: [
    { to: '/patient/book', label: 'Book Appointment' },
    { to: '/patient/appointments', label: 'My Appointments' },
  ],
  doctor: [
    { to: '/doctor/queue', label: 'Appointment Queue' },
  ],
  admin: [
    { to: '/admin/doctors', label: 'Manage Doctors' },
  ],
};

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const nav = NAV_BY_ROLE[user?.role] || [];

  async function connectCalendar() {
    try {
      const res = await api.get('/calendar/oauth/url');
      window.location.href = res.url;
    } catch (err) {
      alert(`Could not start Google Calendar connection: ${err.message}`);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="dot" /> Clinic Manager</div>
        {nav.map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'active' : '')}>
            {item.label}
          </NavLink>
        ))}
        {(user?.role === 'patient' || user?.role === 'doctor') && (
          <button className="nav-item" style={{ background: 'none', border: 'none', textAlign: 'left' }} onClick={connectCalendar}>
            📅 Connect Google Calendar
          </button>
        )}
        <div className="footer-user">
          <div>{user?.name}</div>
          <div className="muted" style={{ color: '#a9c4bd' }}>{user?.role}</div>
          <button className="logout-btn" onClick={logout}>Log out</button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
