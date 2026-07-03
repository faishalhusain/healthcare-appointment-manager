require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const db = require('../config/db');

async function seed() {
  const adminEmail = 'admin@clinic.com';
  if (!db.prepare(`SELECT id FROM users WHERE email = ?`).get(adminEmail)) {
    const hash = await bcrypt.hash('Admin@123', 10);
    db.prepare(
      `INSERT INTO users (id, role, name, email, password_hash) VALUES (?, 'admin', 'Clinic Admin', ?, ?)`
    ).run(uuid(), adminEmail, hash);
    console.log(`Created admin: ${adminEmail} / Admin@123`);
  }

  const doctorEmail = 'dr.sharma@clinic.com';
  let doctorUser = db.prepare(`SELECT * FROM users WHERE email = ?`).get(doctorEmail);
  if (!doctorUser) {
    const hash = await bcrypt.hash('Doctor@123', 10);
    const id = uuid();
    db.prepare(
      `INSERT INTO users (id, role, name, email, password_hash) VALUES (?, 'doctor', 'Dr. Anjali Sharma', ?, ?)`
    ).run(id, doctorEmail, hash);
    doctorUser = { id };
    console.log(`Created doctor: ${doctorEmail} / Doctor@123`);
  }

  if (!db.prepare(`SELECT id FROM doctor_profiles WHERE user_id = ?`).get(doctorUser.id)) {
    db.prepare(
      `INSERT INTO doctor_profiles (id, user_id, specialisation, slot_duration_minutes, working_hours_json)
       VALUES (?, ?, 'General Physician', 30, ?)`
    ).run(
      uuid(),
      doctorUser.id,
      JSON.stringify({ mon: ['09:00', '13:00'], tue: ['09:00', '13:00'], wed: ['09:00', '13:00'], thu: ['09:00', '13:00'], fri: ['09:00', '13:00'] })
    );
    console.log('Created doctor profile: General Physician, Mon-Fri 09:00-13:00, 30 min slots');
  }

  console.log('Seed complete.');
}

seed().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
