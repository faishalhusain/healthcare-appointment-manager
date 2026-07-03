import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { UrgencyBadge, StatusBadge } from '../../components/Badges';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function MyAppointments() {
  const [appointments, setAppointments] = useState([]);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [reschedulingId, setReschedulingId] = useState(null);
  const [newDate, setNewDate] = useState(todayStr());
  const [newSlots, setNewSlots] = useState([]);
  const [rescheduling, setRescheduling] = useState(false);

  async function load() {
    try {
      const rows = await api.get('/appointments/me');
      setAppointments(rows);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function cancel(id) {
    if (!confirm('Cancel this appointment?')) return;
    try {
      await api.post(`/appointments/${id}/cancel`);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function openReschedule(appt) {
    setReschedulingId(appt.id);
    setNewDate(todayStr());
    setError('');
    await loadNewSlots(appt.doctor_id, todayStr());
  }

  async function loadNewSlots(doctorId, date) {
    try {
      const res = await api.get(`/doctors/${doctorId}/availability?date=${date}`);
      setNewSlots(res.slots);
    } catch (err) {
      setError(err.message);
      setNewSlots([]);
    }
  }

  async function doReschedule(appt, time) {
    setRescheduling(true);
    setError('');
    try {
      await api.post(`/appointments/${appt.id}/reschedule`, { date: newDate, time });
      setReschedulingId(null);
      load();
    } catch (err) {
      setError(err.message);
      loadNewSlots(appt.doctor_id, newDate); // refresh in case slot was just taken
    } finally {
      setRescheduling(false);
    }
  }

  return (
    <div>
      <h2>My appointments</h2>
      {error && <div className="error-banner">{error}</div>}
      {appointments.length === 0 && <div className="empty-state">No appointments yet. Go book one!</div>}

      {appointments.map((a) => {
        const preVisit = a.pre_visit_summary_json ? JSON.parse(a.pre_visit_summary_json) : null;
        const prescription = a.prescription_json ? JSON.parse(a.prescription_json) : null;
        const isOpen = expanded === a.id;
        const isRescheduling = reschedulingId === a.id;
        return (
          <div className="card" key={a.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong>Dr. {a.doctor_name}</strong> <span className="muted">· {a.specialisation}</span>
                <div className="muted">{a.slot_date} at {a.slot_time}</div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <StatusBadge status={a.status} />
                <button className="btn small secondary" onClick={() => setExpanded(isOpen ? null : a.id)}>
                  {isOpen ? 'Hide details' : 'View details'}
                </button>
                {a.status === 'confirmed' && (
                  <button className="btn small secondary" onClick={() => (isRescheduling ? setReschedulingId(null) : openReschedule(a))}>
                    {isRescheduling ? 'Close' : 'Reschedule'}
                  </button>
                )}
                {(a.status === 'held' || a.status === 'confirmed') && (
                  <button className="btn small danger" onClick={() => cancel(a.id)}>Cancel</button>
                )}
              </div>
            </div>

            {isRescheduling && (
              <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                <div className="section-title">Pick a new date & time</div>
                <label>Date</label>
                <input type="date" value={newDate} min={todayStr()}
                       onChange={(e) => { setNewDate(e.target.value); loadNewSlots(a.doctor_id, e.target.value); }} />
                {newSlots.length === 0 ? (
                  <div className="empty-state">No slots available this day.</div>
                ) : (
                  <div className="slot-grid">
                    {newSlots.map((s) => (
                      <button key={s} type="button" className="slot-btn" disabled={rescheduling}
                              onClick={() => doReschedule(a, s)}>
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {isOpen && (
              <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                {preVisit && (
                  <>
                    <div className="section-title">Pre-visit AI summary</div>
                    <p><UrgencyBadge level={preVisit.urgency} /> &nbsp; {preVisit.chief_complaint}</p>
                  </>
                )}
                {a.post_visit_summary_text && (
                  <>
                    <div className="section-title">Post-visit summary</div>
                    <p style={{ whiteSpace: 'pre-wrap' }}>{a.post_visit_summary_text}</p>
                  </>
                )}
                {prescription && prescription.length > 0 && (
                  <>
                    <div className="section-title">Prescription & reminders</div>
                    <table>
                      <thead><tr><th>Medicine</th><th>Dosage</th><th>Frequency/day</th><th>Duration</th></tr></thead>
                      <tbody>
                        {prescription.map((p, i) => (
                          <tr key={i}>
                            <td>{p.medicine}</td><td>{p.dosage}</td><td>{p.frequency_per_day}</td><td>{p.duration_days} days</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
                {!preVisit && !a.post_visit_summary_text && <div className="muted">No details yet.</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
