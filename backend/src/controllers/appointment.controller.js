const { v4: uuid } = require('uuid');
const db = require('../config/db');
const llmService = require('../services/llm.service');
const { queueEmail } = require('../services/email.service');
const calendarService = require('../services/calendar.service');
const { addMinutes } = require('../utils/slotUtils');

const HOLD_MINUTES = 5;

/**
 * Step 1: HOLD a slot.
 * This is the "slot hold mechanism": the moment a patient picks a slot we
 * insert a row with status='held' and a short expiry. The DB's partial
 * UNIQUE index (doctor_id, slot_date, slot_time WHERE status IN (held,confirmed))
 * guarantees that if two patients race for the same slot, only one INSERT
 * succeeds - the other gets a 409 Conflict instantly, safely, with no locks
 * needed in application code. Expired holds are swept lazily (slotUtils) and
 * by the background job, freeing the slot back up automatically.
 */
function holdSlot(req, res, next) {
  try {
    const { doctorId, date, time } = req.body;
    if (!doctorId || !date || !time) {
      return res.status(400).json({ error: 'doctorId, date, time are required' });
    }

    const profile = db.prepare(`SELECT * FROM doctor_profiles WHERE id = ?`).get(doctorId);
    if (!profile) return res.status(404).json({ error: 'Doctor not found' });

    const onLeave = db
      .prepare(`SELECT 1 FROM doctor_leaves WHERE doctor_id = ? AND leave_date = ?`)
      .get(doctorId, date);
    if (onLeave) return res.status(409).json({ error: 'Doctor is on leave that day' });

    // sweep expired holds first so a genuinely free slot isn't rejected
    db.prepare(
      `UPDATE appointments SET status='cancelled'
       WHERE status='held' AND hold_expires_at < datetime('now')`
    ).run();

    const id = uuid();
    const expiresAt = new Date(Date.now() + HOLD_MINUTES * 60 * 1000).toISOString();

    // This INSERT is the atomic double-booking guard (unique index does the work)
    db.prepare(
      `INSERT INTO appointments (id, patient_id, doctor_id, slot_date, slot_time, status, hold_expires_at)
       VALUES (?, ?, ?, ?, ?, 'held', ?)`
    ).run(id, req.user.id, doctorId, date, time, expiresAt);

    res.status(201).json({ appointmentId: id, holdExpiresAt: expiresAt });
  } catch (err) {
    next(err); // errorHandler converts SQLITE_CONSTRAINT_UNIQUE -> 409
  }
}

/**
 * Step 2: CONFIRM - patient submits symptoms, we generate the AI pre-visit
 * summary, send confirmation emails, and create Google Calendar events for
 * both patient and doctor.
 */
async function confirmAppointment(req, res, next) {
  try {
    const { id } = req.params;
    const { symptoms } = req.body;

    const appt = db.prepare(`SELECT * FROM appointments WHERE id = ?`).get(id);
    if (!appt) return res.status(404).json({ error: 'Appointment not found' });
    if (appt.patient_id !== req.user.id) return res.status(403).json({ error: 'Not your appointment' });
    if (appt.status !== 'held') return res.status(409).json({ error: `Cannot confirm from status=${appt.status}` });
    if (new Date(appt.hold_expires_at) < new Date()) {
      db.prepare(`UPDATE appointments SET status='cancelled' WHERE id=?`).run(id);
      return res.status(410).json({ error: 'Hold expired, please pick the slot again' });
    }

    // LLM call — failures are handled inside llm.service and never throw
    const preVisit = await llmService.generatePreVisitSummary(symptoms || 'No symptoms provided');

    db.prepare(
      `UPDATE appointments SET status='confirmed', symptoms_text=?, pre_visit_summary_json=?, updated_at=datetime('now') WHERE id=?`
    ).run(symptoms || '', JSON.stringify(preVisit), id);

    const doctor = db
      .prepare(
        `SELECT u.id as user_id, u.name, u.email, dp.slot_duration_minutes
         FROM doctor_profiles dp JOIN users u ON u.id = dp.user_id WHERE dp.id = ?`
      )
      .get(appt.doctor_id);
    const patient = db.prepare(`SELECT * FROM users WHERE id = ?`).get(appt.patient_id);

    // Emails
    queueEmail(
      patient.email,
      'Appointment Confirmed',
      `Hi ${patient.name},\n\nYour appointment with Dr. ${doctor.name} is confirmed for ${appt.slot_date} at ${appt.slot_time}.\nUrgency assessed: ${preVisit.urgency}.\n\n- Clinic Manager`
    );
    queueEmail(
      doctor.email,
      'New Appointment Booked',
      `Hi Dr. ${doctor.name},\n\nA new appointment is booked for ${appt.slot_date} at ${appt.slot_time} with ${patient.name}.\nPre-visit AI summary — Urgency: ${preVisit.urgency}, Chief complaint: ${preVisit.chief_complaint}.\n\n- Clinic Manager`
    );

    // Google Calendar (best-effort; skipped gracefully if not connected)
    const startISO = `${appt.slot_date}T${appt.slot_time}:00`;
    const endISO = `${appt.slot_date}T${addMinutes(appt.slot_time, doctor.slot_duration_minutes)}:00`;
    const [patientEvent, doctorEvent] = await Promise.all([
      calendarService.createEvent(patient.id, {
        summary: `Appointment with Dr. ${doctor.name}`,
        description: `Urgency: ${preVisit.urgency}. Chief complaint: ${preVisit.chief_complaint}`,
        startISO,
        endISO,
        attendees: [{ email: doctor.email }],
      }),
      calendarService.createEvent(doctor.user_id, {
        summary: `Appointment with ${patient.name}`,
        description: `Urgency: ${preVisit.urgency}. Chief complaint: ${preVisit.chief_complaint}`,
        startISO,
        endISO,
        attendees: [{ email: patient.email }],
      }),
    ]);

    db.prepare(
      `UPDATE appointments SET google_event_id_patient=?, google_event_id_doctor=? WHERE id=?`
    ).run(patientEvent.eventId || null, doctorEvent.eventId || null, id);

    res.json({ ok: true, preVisitSummary: preVisit });
  } catch (err) {
    next(err);
  }
}

/**
 * Reschedule a confirmed appointment to a new date/time.
 * Reuses the same atomicity guarantee as booking: the partial UNIQUE index
 * on (doctor_id, slot_date, slot_time) is enforced by SQLite on UPDATE just
 * as it is on INSERT, so if two reschedule/booking requests race for the
 * same new slot, only one succeeds - the other gets a 409, no extra locking
 * code required. Google Calendar events (if connected) are patched in place
 * rather than deleted+recreated, and both parties are emailed.
 */
async function rescheduleAppointment(req, res, next) {
  try {
    const { id } = req.params;
    const { date, time } = req.body;
    if (!date || !time) return res.status(400).json({ error: 'date and time are required' });

    const appt = db.prepare(`SELECT * FROM appointments WHERE id = ?`).get(id);
    if (!appt) return res.status(404).json({ error: 'Appointment not found' });
    if (appt.patient_id !== req.user.id) return res.status(403).json({ error: 'Not your appointment' });
    if (appt.status !== 'confirmed') {
      return res.status(409).json({ error: `Only confirmed appointments can be rescheduled (current status=${appt.status})` });
    }
    if (date === appt.slot_date && time === appt.slot_time) {
      return res.status(400).json({ error: 'That is already the current slot' });
    }

    const onLeave = db
      .prepare(`SELECT 1 FROM doctor_leaves WHERE doctor_id = ? AND leave_date = ?`)
      .get(appt.doctor_id, date);
    if (onLeave) return res.status(409).json({ error: 'Doctor is on leave that day' });

    const oldDate = appt.slot_date;
    const oldTime = appt.slot_time;

    // Atomic guard: this UPDATE hits the same partial unique index as the
    // INSERT in holdSlot(), so a conflicting slot is rejected by the DB itself.
    db.prepare(
      `UPDATE appointments SET slot_date = ?, slot_time = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(date, time, id);

    const doctor = db
      .prepare(
        `SELECT u.id as user_id, u.name, u.email, dp.slot_duration_minutes
         FROM doctor_profiles dp JOIN users u ON u.id = dp.user_id WHERE dp.id = ?`
      )
      .get(appt.doctor_id);
    const patient = db.prepare(`SELECT * FROM users WHERE id = ?`).get(appt.patient_id);

    queueEmail(
      patient.email,
      'Appointment Rescheduled',
      `Hi ${patient.name},\n\nYour appointment with Dr. ${doctor.name} has been moved from ${oldDate} ${oldTime} to ${date} ${time}.\n\n- Clinic Manager`
    );
    queueEmail(
      doctor.email,
      'Appointment Rescheduled',
      `Hi Dr. ${doctor.name},\n\nYour appointment with ${patient.name} has been moved from ${oldDate} ${oldTime} to ${date} ${time}.\n\n- Clinic Manager`
    );

    // Calendar: patch existing events in place (best-effort, never blocks the response)
    const startISO = `${date}T${time}:00`;
    const endISO = `${date}T${addMinutes(time, doctor.slot_duration_minutes)}:00`;
    await Promise.all([
      appt.google_event_id_patient
        ? calendarService.updateEvent(patient.id, appt.google_event_id_patient, {
            start: { dateTime: startISO },
            end: { dateTime: endISO },
          })
        : Promise.resolve(),
      appt.google_event_id_doctor
        ? calendarService.updateEvent(doctor.user_id, appt.google_event_id_doctor, {
            start: { dateTime: startISO },
            end: { dateTime: endISO },
          })
        : Promise.resolve(),
    ]);

    res.json({ ok: true, slot_date: date, slot_time: time });
  } catch (err) {
    next(err); // 409 on slot conflict, via errorHandler
  }
}

function cancelAppointment(req, res, next) {
  try {
    const { id } = req.params;
    const appt = db.prepare(`SELECT * FROM appointments WHERE id = ?`).get(id);
    if (!appt) return res.status(404).json({ error: 'Appointment not found' });

    const isOwnerPatient = req.user.role === 'patient' && appt.patient_id === req.user.id;
    const isAdmin = req.user.role === 'admin';
    if (!isOwnerPatient && !isAdmin) return res.status(403).json({ error: 'Not allowed' });

    db.prepare(`UPDATE appointments SET status='cancelled', updated_at=datetime('now') WHERE id=?`).run(id);

    const patient = db.prepare(`SELECT * FROM users WHERE id = ?`).get(appt.patient_id);
    if (patient) {
      queueEmail(
        patient.email,
        'Appointment Cancelled',
        `Hi ${patient.name},\n\nYour appointment on ${appt.slot_date} at ${appt.slot_time} has been cancelled.\n\n- Clinic Manager`
      );
    }
    if (appt.google_event_id_patient) calendarService.deleteEvent(appt.patient_id, appt.google_event_id_patient).catch(() => {});

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

function myPatientAppointments(req, res) {
  const rows = db
    .prepare(
      `SELECT a.*, u.name as doctor_name, dp.specialisation
       FROM appointments a
       JOIN doctor_profiles dp ON dp.id = a.doctor_id
       JOIN users u ON u.id = dp.user_id
       WHERE a.patient_id = ?
       ORDER BY a.slot_date DESC, a.slot_time DESC`
    )
    .all(req.user.id);
  res.json(rows);
}

/**
 * Doctor submits post-visit clinical notes + prescription.
 * Generates the patient-friendly AI summary and schedules medication
 * reminders based on prescription frequency.
 */
async function submitPostVisit(req, res, next) {
  try {
    const { id } = req.params;
    const { notes, prescription } = req.body; // prescription: [{medicine, dosage, frequency_per_day, duration_days}]

    const appt = db.prepare(`SELECT * FROM appointments WHERE id = ?`).get(id);
    if (!appt) return res.status(404).json({ error: 'Appointment not found' });

    const profile = db.prepare(`SELECT * FROM doctor_profiles WHERE user_id = ?`).get(req.user.id);
    if (!profile || profile.id !== appt.doctor_id) return res.status(403).json({ error: 'Not your appointment' });

    const summary = await llmService.generatePostVisitSummary(notes || '');

    db.prepare(
      `UPDATE appointments SET status='completed', doctor_notes=?, prescription_json=?, post_visit_summary_text=?, updated_at=datetime('now') WHERE id=?`
    ).run(notes || '', JSON.stringify(prescription || []), summary.text, id);

    // Schedule medication reminders
    const now = Date.now();
    for (const med of prescription || []) {
      const perDay = Math.max(1, Number(med.frequency_per_day) || 1);
      const days = Math.max(1, Number(med.duration_days) || 1);
      const intervalHours = 24 / perDay;
      for (let d = 0; d < days; d++) {
        for (let dose = 0; dose < perDay; dose++) {
          const scheduledAt = new Date(now + (d * 24 + dose * intervalHours) * 3600 * 1000).toISOString();
          db.prepare(
            `INSERT INTO medication_reminders (id, appointment_id, medicine, scheduled_at) VALUES (?,?,?,?)`
          ).run(uuid(), id, `${med.medicine} (${med.dosage || ''})`, scheduledAt);
        }
      }
    }

    const patient = db.prepare(`SELECT * FROM users WHERE id = ?`).get(appt.patient_id);
    queueEmail(
      patient.email,
      'Your Visit Summary is Ready',
      `Hi ${patient.name},\n\n${summary.text}\n\n- Clinic Manager`
    );

    res.json({ ok: true, postVisitSummary: summary });
  } catch (err) {
    next(err);
  }
}

function getAppointment(req, res) {
  const { id } = req.params;
  const appt = db.prepare(`SELECT * FROM appointments WHERE id = ?`).get(id);
  if (!appt) return res.status(404).json({ error: 'Appointment not found' });
  const allowed =
    req.user.role === 'admin' ||
    appt.patient_id === req.user.id ||
    db.prepare(`SELECT 1 FROM doctor_profiles WHERE id=? AND user_id=?`).get(appt.doctor_id, req.user.id);
  if (!allowed) return res.status(403).json({ error: 'Forbidden' });
  res.json({
    ...appt,
    pre_visit_summary: appt.pre_visit_summary_json ? JSON.parse(appt.pre_visit_summary_json) : null,
    prescription: appt.prescription_json ? JSON.parse(appt.prescription_json) : null,
  });
}

module.exports = {
  holdSlot,
  confirmAppointment,
  rescheduleAppointment,
  cancelAppointment,
  myPatientAppointments,
  submitPostVisit,
  getAppointment,
};
