const db = require('../config/db');
const { getAvailableSlots } = require('../utils/slotUtils');

// Public/patient: search doctors, optionally filter by specialisation
function searchDoctors(req, res) {
  const { specialisation } = req.query;
  let rows;
  if (specialisation) {
    rows = db
      .prepare(
        `SELECT dp.id, dp.specialisation, dp.slot_duration_minutes, u.name, u.email
         FROM doctor_profiles dp JOIN users u ON u.id = dp.user_id
         WHERE dp.specialisation LIKE ?`
      )
      .all(`%${specialisation}%`);
  } else {
    rows = db
      .prepare(
        `SELECT dp.id, dp.specialisation, dp.slot_duration_minutes, u.name, u.email
         FROM doctor_profiles dp JOIN users u ON u.id = dp.user_id`
      )
      .all();
  }
  res.json(rows);
}

function getAvailability(req, res) {
  const { id } = req.params; // doctor_profile id
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date query param required (YYYY-MM-DD)' });

  const profile = db.prepare(`SELECT * FROM doctor_profiles WHERE id = ?`).get(id);
  if (!profile) return res.status(404).json({ error: 'Doctor not found' });

  const slots = getAvailableSlots(profile, date);
  res.json({ date, slots });
}

// Doctor's own appointments (their dashboard queue)
function myAppointments(req, res) {
  const profile = db.prepare(`SELECT * FROM doctor_profiles WHERE user_id = ?`).get(req.user.id);
  if (!profile) return res.status(404).json({ error: 'Doctor profile not found' });

  const { status } = req.query;
  let rows;
  if (status) {
    rows = db
      .prepare(
        `SELECT a.*, p.name as patient_name, p.email as patient_email
         FROM appointments a JOIN users p ON p.id = a.patient_id
         WHERE a.doctor_id = ? AND a.status = ?
         ORDER BY a.slot_date, a.slot_time`
      )
      .all(profile.id, status);
  } else {
    rows = db
      .prepare(
        `SELECT a.*, p.name as patient_name, p.email as patient_email
         FROM appointments a JOIN users p ON p.id = a.patient_id
         WHERE a.doctor_id = ? AND a.status IN ('confirmed','completed')
         ORDER BY a.slot_date, a.slot_time`
      )
      .all(profile.id);
  }
  res.json(rows);
}

module.exports = { searchDoctors, getAvailability, myAppointments };
