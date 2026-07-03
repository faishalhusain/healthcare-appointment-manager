import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { UrgencyBadge, StatusBadge } from '../../components/Badges';

const emptyMed = { medicine: '', dosage: '', frequency_per_day: 1, duration_days: 3 };

export default function DoctorQueue() {
  const [appointments, setAppointments] = useState([]);
  const [error, setError] = useState('');
  const [activeId, setActiveId] = useState(null);
  const [notes, setNotes] = useState('');
  const [meds, setMeds] = useState([{ ...emptyMed }]);
  const [submitting, setSubmitting] = useState(false);
  const [lastSummary, setLastSummary] = useState(null);

  async function load() {
    try {
      const rows = await api.get('/doctors/me/appointments?status=confirmed');
      setAppointments(rows);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  function openConsult(appt) {
    setActiveId(appt.id);
    setNotes('');
    setMeds([{ ...emptyMed }]);
    setLastSummary(null);
  }

  function updateMed(i, field, value) {
    setMeds((m) => m.map((med, idx) => (idx === i ? { ...med, [field]: value } : med)));
  }

  async function submitPostVisit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const prescription = meds.filter((m) => m.medicine.trim());
      const res = await api.post(`/appointments/${activeId}/post-visit`, { notes, prescription });
      setLastSummary(res.postVisitSummary);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const active = appointments.find((a) => a.id === activeId);

  return (
    <div>
      <h2>Appointment queue</h2>
      <p className="muted">Confirmed appointments with AI-generated pre-visit summaries.</p>
      {error && <div className="error-banner">{error}</div>}

      <div className="grid cols-2">
        <div>
          {appointments.length === 0 && <div className="empty-state">No confirmed appointments right now.</div>}
          {appointments.map((a) => {
            const preVisit = a.pre_visit_summary_json ? JSON.parse(a.pre_visit_summary_json) : null;
            return (
              <div key={a.id} className="card" style={{ cursor: 'pointer', borderColor: activeId === a.id ? 'var(--primary)' : undefined }}
                   onClick={() => openConsult(a)}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong>{a.patient_name}</strong>
                  {preVisit && <UrgencyBadge level={preVisit.urgency} />}
                </div>
                <div className="muted">{a.slot_date} at {a.slot_time}</div>
                {preVisit && <p style={{ marginBottom: 0 }}>{preVisit.chief_complaint}</p>}
              </div>
            );
          })}
        </div>

        <div>
          {active && (
            <div className="card">
              <div className="section-title">Consultation — {active.patient_name}</div>
              {(() => {
                const preVisit = active.pre_visit_summary_json ? JSON.parse(active.pre_visit_summary_json) : null;
                return preVisit ? (
                  <div style={{ background: 'var(--primary-soft)', padding: 12, borderRadius: 8, marginBottom: 12 }}>
                    <UrgencyBadge level={preVisit.urgency} />
                    <p style={{ margin: '8px 0' }}><strong>Chief complaint:</strong> {preVisit.chief_complaint}</p>
                    <p style={{ margin: 0, fontSize: 13 }}><strong>Symptoms (raw):</strong> {active.symptoms_text}</p>
                    <div className="muted" style={{ marginTop: 8 }}>Suggested questions:</div>
                    <ul style={{ marginTop: 4 }}>{preVisit.questions?.map((q, i) => <li key={i}>{q}</li>)}</ul>
                  </div>
                ) : null;
              })()}

              {lastSummary ? (
                <div className="success-banner">
                  Visit completed. Patient-friendly summary sent by email:
                  <p style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>{lastSummary.text}</p>
                </div>
              ) : (
                <form onSubmit={submitPostVisit}>
                  <label>Clinical notes</label>
                  <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} required
                            placeholder="Diagnosis, observations, advice..." />

                  <div className="section-title">Prescription</div>
                  {meds.map((m, i) => (
                    <div className="rx-row" key={i}>
                      <div>
                        <label>Medicine</label>
                        <input value={m.medicine} onChange={(e) => updateMed(i, 'medicine', e.target.value)} placeholder="Paracetamol 500mg" />
                      </div>
                      <div>
                        <label>Dosage</label>
                        <input value={m.dosage} onChange={(e) => updateMed(i, 'dosage', e.target.value)} placeholder="1 tablet" />
                      </div>
                      <div>
                        <label>Times/day</label>
                        <input type="number" min={1} max={6} value={m.frequency_per_day} onChange={(e) => updateMed(i, 'frequency_per_day', e.target.value)} />
                      </div>
                      <div>
                        <label>Days</label>
                        <input type="number" min={1} max={30} value={m.duration_days} onChange={(e) => updateMed(i, 'duration_days', e.target.value)} />
                      </div>
                    </div>
                  ))}
                  <button type="button" className="btn secondary small" style={{ marginTop: 10 }}
                          onClick={() => setMeds((m) => [...m, { ...emptyMed }])}>+ Add medicine</button>

                  <div>
                    <button className="btn" type="submit" disabled={submitting}>
                      {submitting ? 'Generating summary...' : 'Complete visit & generate AI summary'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
