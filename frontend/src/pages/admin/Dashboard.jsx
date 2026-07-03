import { useState, useEffect } from 'react';
import { api } from '../../api/client';

const DAYS = [
  ['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun'],
];

const emptyForm = {
  name: '', email: '', password: '', specialisation: '', slotDurationMinutes: 30,
  workDays: { mon: true, tue: true, wed: true, thu: true, fri: true, sat: false, sun: false },
  startTime: '09:00', endTime: '17:00',
};

export default function ManageDoctors() {
  const [doctors, setDoctors] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [leaveDate, setLeaveDate] = useState({});

  async function load() {
    try {
      const rows = await api.get('/admin/doctors');
      setDoctors(rows);
    } catch (err) {
      setError(err.message);
    }
  }
  useEffect(() => { load(); }, []);

  function toggleDay(day) {
    setForm((f) => ({ ...f, workDays: { ...f.workDays, [day]: !f.workDays[day] } }));
  }

  async function createDoctor(e) {
    e.preventDefault();
    setError(''); setSuccess('');
    try {
      const workingHours = {};
      Object.entries(form.workDays).forEach(([day, on]) => {
        if (on) workingHours[day] = [form.startTime, form.endTime];
      });
      await api.post('/admin/doctors', {
        name: form.name, email: form.email, password: form.password,
        specialisation: form.specialisation, slotDurationMinutes: Number(form.slotDurationMinutes),
        workingHours,
      });
      setSuccess(`Doctor ${form.name} created.`);
      setForm(emptyForm);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function markLeave(doctorId) {
    const date = leaveDate[doctorId];
    if (!date) return;
    setError(''); setSuccess('');
    try {
      const res = await api.post(`/admin/doctors/${doctorId}/leave`, { date, reason: 'Marked by admin' });
      setSuccess(`Leave marked for ${date}. ${res.affectedAppointments} patient(s) notified & rebooked slots freed.`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteDoctor(doctor) {
    if (!confirm(`Delete Dr. ${doctor.name}? Any of their upcoming appointments will be cancelled and patients notified. This cannot be undone.`)) return;
    setError(''); setSuccess('');
    try {
      const res = await api.del(`/admin/doctors/${doctor.id}`);
      setSuccess(`Dr. ${doctor.name} removed. ${res.cancelledAppointments} upcoming appointment(s) cancelled and patients notified.`);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <h2>Manage doctors</h2>
      {error && <div className="error-banner">{error}</div>}
      {success && <div className="success-banner">{success}</div>}

      <div className="card">
        <div className="section-title">Add a new doctor</div>
        <form onSubmit={createDoctor}>
          <div className="grid cols-2">
            <div>
              <label>Full name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <label>Specialisation</label>
              <input value={form.specialisation} onChange={(e) => setForm({ ...form, specialisation: e.target.value })} required />
            </div>
            <div>
              <label>Email</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </div>
            <div>
              <label>Temporary password</label>
              <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} />
            </div>
            <div>
              <label>Slot duration (minutes)</label>
              <input type="number" min={10} max={120} value={form.slotDurationMinutes} onChange={(e) => setForm({ ...form, slotDurationMinutes: e.target.value })} />
            </div>
          </div>

          <label>Working days</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {DAYS.map(([key, label]) => (
              <button type="button" key={key}
                      className={`slot-btn ${form.workDays[key] ? 'selected' : ''}`}
                      onClick={() => toggleDay(key)}>{label}</button>
            ))}
          </div>

          <div className="grid cols-2">
            <div>
              <label>Start time</label>
              <input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
            </div>
            <div>
              <label>End time</label>
              <input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
            </div>
          </div>

          <button className="btn" type="submit">Create doctor profile</button>
        </form>
      </div>

      <div className="section-title">Existing doctors</div>
      {doctors.map((d) => (
        <div className="card" key={d.id}>
          <strong>{d.name}</strong> <span className="muted">· {d.specialisation} · {d.slot_duration_minutes} min slots</span>
          <div className="muted">{d.email}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'end' }}>
            <div style={{ flex: 1 }}>
              <label>Mark on leave for date</label>
              <input type="date" value={leaveDate[d.id] || ''} onChange={(e) => setLeaveDate({ ...leaveDate, [d.id]: e.target.value })} />
            </div>
            <button className="btn small" style={{ marginBottom: 1 }} onClick={() => markLeave(d.id)}>Mark leave</button>
            <button className="btn small danger" style={{ marginBottom: 1 }} onClick={() => deleteDoctor(d)}>Delete doctor</button>
          </div>
        </div>
      ))}
    </div>
  );
}
