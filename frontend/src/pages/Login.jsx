import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const HOME_BY_ROLE = { patient: '/patient/book', doctor: '/doctor/queue', admin: '/admin/doctors' };

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(email, password);
      navigate(HOME_BY_ROLE[user.role] || '/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Welcome back</h1>
        <p className="subtitle">Sign in to Clinic Manager</p>
        {error && <div className="error-banner">{error}</div>}
        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <button className="btn" type="submit" disabled={loading} style={{ width: '100%', justifyContent: 'center' }}>
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
        <div className="auth-switch">
          New patient? <Link to="/register">Create an account</Link>
        </div>
        <div className="auth-switch" style={{ marginTop: 4 }}>
          Demo admin: admin@clinic.com / Admin@123 &nbsp;·&nbsp; Demo doctor: dr.sharma@clinic.com / Doctor@123
        </div>
      </form>
    </div>
  );
}
