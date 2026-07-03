const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const db = require('../config/db');
const { queueEmail } = require('../services/email.service');
const calendarService = require('../services/calendar.service');

// Admin creates a doctor: makes a user (role=doctor) + doctor_profile in one go
async function createDoctor(req, res, next) {
  try {
    const { name, email, password, specialisation, slotDurationMinutes, workingHours } = req.body;
    if (!name || !email || !password || !specialisation || !workingHours) {
      return res.status(400).json({ error: 'Missing required doctor fields' });
    }
    const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email);
    if (existing) return res.status(409).json({ error: 'Email already in use' });

    const userId = uuid();
    const hash = await bcrypt.hash(password, 10);
    db.prepare(
      `INSERT INTO users (id, role, name, email, password_hash) VALUES (?, 'doctor', ?, ?, ?)`
    ).run(userId, name, email, hash);

    const profileId = uuid();
    db.prepare(
      `INSERT INTO doctor_profiles (id, user_id, specialisation, slot_duration_minutes, working_hours_json)
       VALUES (?,?,?,?,?)`
    ).run(profileId, userId, specialisation, slotDurationMinutes || 30, JSON.stringify(workingHours));

    res.status(201).json({ id: profileId, userId, name, email, specialisation });
  } catch (err) {
    next(err);
  }
}

function listDoctors(req, res) {
  const rows = db
    .prepare(
      `SELECT dp.id, dp.specialisation, dp.slot_duration_minutes, dp.working_hours_json,
              u.id as user_id, u.name, u.email
       FROM doctor_profiles dp JOIN users u ON u.id = dp.user_id`
    )
    .all();
  res.json(rows.map((r) => ({ ...r, working_hours: JSON.parse(r.working_hours_json) })));
}

function updateDoctor(req, res, next) {
  try {
    const { id } = req.params;
    const { specialisation, slotDurationMinutes, workingHours } = req.body;
    const existing = db.prepare(`SELECT * FROM doctor_profiles WHERE id = ?`).get(id);
    if (!existing) return res.status(404).json({ error: 'Doctor not found' });

    db.prepare(
      `UPDATE doctor_profiles SET specialisation = ?, slot_duration_minutes = ?, working_hours_json = ? WHERE id = ?`
    ).run(
      specialisation || existing.specialisation,
      slotDurationMinutes || existing.slot_duration_minutes,
      workingHours ? JSON.stringify(workingHours) : existing.working_hours_json,
      id
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// Mark a doctor on leave for a date. Any existing held/confirmed appointments
// for that date are cancelled and the affected patients are notified
// (in-app notification + email), per the assignment's requirement.
async function markLeave(req, res, next) {
  try {
    const { id } = req.params; // doctor_profile id
    const { date, reason } = req.body;
    if (!date) return res.status(400).json({ error: 'date is required (YYYY-MM-DD)' });

    db.prepare(
      `INSERT INTO doctor_leaves (id, doctor_id, leave_date, reason) VALUES (?,?,?,?)
       ON CONFLICT(doctor_id, leave_date) DO UPDATE SET reason = excluded.reason`
    ).run(uuid(), id, date, reason || null);

    const affected = db
      .prepare(
        `SELECT a.*, p.name as patient_name, p.email as patient_email
         FROM appointments a JOIN users p ON p.id = a.patient_id
         WHERE a.doctor_id = ? AND a.slot_date = ? AND a.status IN ('held','confirmed')`
      )
      .all(id, date);

    const doctor = db
      .prepare(
        `SELECT u.name FROM doctor_profiles dp JOIN users u ON u.id = dp.user_id WHERE dp.id = ?`
      )
      .get(id);

    for (const appt of affected) {
      db.prepare(`UPDATE appointments SET status='leave_cancelled', updated_at=datetime('now') WHERE id=?`).run(
        appt.id
      );

      db.prepare(
        `INSERT INTO notifications (id, user_id, title, message) VALUES (?,?,?,?)`
      ).run(
        uuid(),
        appt.patient_id,
        'Appointment cancelled - Doctor on leave',
        `Your appointment with ${doctor?.name || 'your doctor'} on ${appt.slot_date} at ${appt.slot_time} was cancelled because the doctor is on leave. Please rebook a new slot.`
      );

      queueEmail(
        appt.patient_email,
        'Appointment Cancelled Due to Doctor Leave',
        `Dear ${appt.patient_name},\n\nYour appointment with ${doctor?.name || ''} on ${appt.slot_date} at ${appt.slot_time} has been cancelled because the doctor is unavailable that day.\nPlease log in to book a new slot.\n\n- Clinic Manager`
      );

      if (appt.google_event_id_patient) {
        calendarService.deleteEvent(appt.patient_id, appt.google_event_id_patient).catch(() => {});
      }
    }

    res.json({ ok: true, affectedAppointments: affected.length });
  } catch (err) {
    next(err);
  }
}

// Delete a doctor entirely. Any of their held/confirmed appointments
// (not just on one date - all upcoming ones) are cancelled and the
// affected patients are notified first, using the same pattern as
// markLeave(), before the doctor's user/profile rows are removed.
// Deleting the user row cascades (ON DELETE CASCADE) to doctor_profiles,
// doctor_leaves, and appointments automatically.
async function deleteDoctor(req, res, next) {
  try {
    const { id } = req.params; // doctor_profile id
    const profile = db.prepare(`SELECT * FROM doctor_profiles WHERE id = ?`).get(id);
    if (!profile) return res.status(404).json({ error: 'Doctor not found' });

    const doctor = db
      .prepare(`SELECT u.id as user_id, u.name FROM doctor_profiles dp JOIN users u ON u.id = dp.user_id WHERE dp.id = ?`)
      .get(id);

    const affected = db
      .prepare(
        `SELECT a.*, p.name as patient_name, p.email as patient_email
         FROM appointments a JOIN users p ON p.id = a.patient_id
         WHERE a.doctor_id = ? AND a.status IN ('held','confirmed')`
      )
      .all(id);

    for (const appt of affected) {
      db.prepare(`UPDATE appointments SET status='leave_cancelled', updated_at=datetime('now') WHERE id=?`).run(appt.id);

      db.prepare(
        `INSERT INTO notifications (id, user_id, title, message) VALUES (?,?,?,?)`
      ).run(
        uuid(),
        appt.patient_id,
        'Appointment cancelled - Doctor no longer available',
        `Your appointment with ${doctor?.name || 'your doctor'} on ${appt.slot_date} at ${appt.slot_time} was cancelled because the doctor is no longer available at this clinic. Please rebook with another doctor.`
      );

      queueEmail(
        appt.patient_email,
        'Appointment Cancelled',
        `Dear ${appt.patient_name},\n\nYour appointment with ${doctor?.name || ''} on ${appt.slot_date} at ${appt.slot_time} has been cancelled because the doctor is no longer available at this clinic.\nPlease log in to book with another doctor.\n\n- Clinic Manager`
      );

      if (appt.google_event_id_patient) {
        calendarService.deleteEvent(appt.patient_id, appt.google_event_id_patient).catch(() => {});
      }
    }

    // Removing the user cascades to doctor_profiles -> doctor_leaves/appointments
    db.prepare(`DELETE FROM users WHERE id = ?`).run(profile.user_id);

    res.json({ ok: true, cancelledAppointments: affected.length });
  } catch (err) {
    next(err);
  }
}

function listLeaves(req, res) {
  const { id } = req.params;
  const rows = db.prepare(`SELECT * FROM doctor_leaves WHERE doctor_id = ? ORDER BY leave_date`).all(id);
  res.json(rows);
}

module.exports = { createDoctor, listDoctors, updateDoctor, deleteDoctor, markLeave, listLeaves };
