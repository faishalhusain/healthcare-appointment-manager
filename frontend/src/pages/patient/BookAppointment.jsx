import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { UrgencyBadge } from '../../components/Badges';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function BookAppointment() {
  const [specialisation, setSpecialisation] = useState('');
  const [doctors, setDoctors] = useState([]);
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  const [date, setDate] = useState(todayStr());
  const [slots, setSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [holdInfo, setHoldInfo] = useState(null); // { appointmentId, holdExpiresAt }
  const [symptoms, setSymptoms] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirmResult, setConfirmResult] = useState(null);

  async function searchDoctors(e) {
    e?.preventDefault();
    setError('');
    try {
      const results = await api.get(`/doctors${specialisation ? `?specialisation=${encodeURIComponent(specialisation)}` : ''}`);
      setDoctors(results);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { searchDoctors(); }, []);

  async function loadSlots(doctor, d) {
    setSelectedDoctor(doctor);
    setSelectedSlot(null);
    setHoldInfo(null);
    setError('');
    try {
      const res = await api.get(`/doctors/${doctor.id}/availability?date=${d}`);
      setSlots(res.slots);
    } catch (err) {
      setError(err.message);
      setSlots([]);
    }
  }

  async function pickSlot(time) {
    setError('');
    setSelectedSlot(time);
    setLoading(true);
    try {
      const res = await api.post('/appointments/hold', { doctorId: selectedDoctor.id, date, time });
      setHoldInfo(res);
    } catch (err) {
      setError(err.message);
      setSelectedSlot(null);
      // refresh slots since this one may now be taken
      loadSlots(selectedDoctor, date);
    } finally {
      setLoading(false);
    }
  }

  async function confirm(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post(`/appointments/${holdInfo.appointmentId}/confirm`, { symptoms });
      setConfirmResult(res.preVisitSummary);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function startOver() {
    setSelectedDoctor(null);
    setSelectedSlot(null);
    setHoldInfo(null);
    setSymptoms('');
    setConfirmResult(null);
  }

  if (confirmResult) {
    return (
      <div>
        <h2>Appointment confirmed 🎉</h2>
        <div className="card">
          <div className="success-banner">
            Your appointment with {selectedDoctor.name} on {date} at {selectedSlot} is confirmed.
            A confirmation email and calendar invite have been sent.
          </div>
          <div className="section-title">AI Pre-Visit Summary (shared with your doctor)</div>
          <p><UrgencyBadge level={confirmResult.urgency} /> &nbsp; <strong>{confirmResult.chief_complaint}</strong></p>
          <div className="muted">Suggested questions for your doctor:</div>
          <ul>
            {confirmResult.questions?.map((q, i) => <li key={i}>{q}</li>)}
          </ul>
          {confirmResult.source === 'fallback' && (
            <p className="muted">Note: AI summary service was unavailable; a safe fallback summary was generated instead.</p>
          )}
          <button className="btn secondary" onClick={startOver}>Book another appointment</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2>Book an appointment</h2>
      <p className="muted">Search for a doctor by specialisation, pick a slot, and share your symptoms in advance.</p>

      <div className="card">
        <form onSubmit={searchDoctors} style={{ display: 'flex', gap: 10, alignItems: 'end' }}>
          <div style={{ flex: 1 }}>
            <label>Specialisation</label>
            <input placeholder="e.g. General Physician, Cardiology" value={specialisation} onChange={(e) => setSpecialisation(e.target.value)} />
          </div>
          <button className="btn" type="submit" style={{ marginTop: 12 }}>Search</button>
        </form>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="grid cols-2">
        <div>
          <div className="section-title">Doctors</div>
          {doctors.length === 0 && <div className="empty-state">No doctors found.</div>}
          {doctors.map((doc) => (
            <div key={doc.id} className="card" style={{ cursor: 'pointer', borderColor: selectedDoctor?.id === doc.id ? 'var(--primary)' : undefined }}
                 onClick={() => loadSlots(doc, date)}>
              <strong>{doc.name}</strong>
              <div className="muted">{doc.specialisation} · {doc.slot_duration_minutes} min slots</div>
            </div>
          ))}
        </div>

        <div>
          {selectedDoctor && (
            <div className="card">
              <div className="section-title">Pick a date & time</div>
              <label>Date</label>
              <input type="date" value={date} min={todayStr()} onChange={(e) => { setDate(e.target.value); loadSlots(selectedDoctor, e.target.value); }} />

              {slots.length === 0 ? (
                <div className="empty-state">No slots available this day.</div>
              ) : (
                <div className="slot-grid">
                  {slots.map((s) => (
                    <button key={s} type="button" className={`slot-btn ${selectedSlot === s ? 'selected' : ''}`}
                            onClick={() => pickSlot(s)} disabled={loading && selectedSlot !== s}>
                      {s}
                    </button>
                  ))}
                </div>
              )}

              {holdInfo && (
                <form onSubmit={confirm}>
                  <div className="success-banner">
                    Slot held for 5 minutes — please confirm with your symptoms below.
                  </div>
                  <label>Describe your symptoms</label>
                  <textarea rows={4} value={symptoms} onChange={(e) => setSymptoms(e.target.value)}
                            placeholder="E.g. Fever since yesterday, mild headache, sore throat..." required />
                  <button className="btn" type="submit" disabled={loading}>
                    {loading ? 'Confirming...' : 'Confirm appointment'}
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
