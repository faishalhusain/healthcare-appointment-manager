// Uses Node's built-in node:sqlite module (Node 22.5+) - zero native/npm
// dependency for the database layer, per the assignment's "keep dependencies
// minimal and native whenever possible" guideline.
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const dbPath = process.env.DB_PATH || './data/app.db';
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');   // safe concurrent readers/writers
db.exec('PRAGMA foreign_keys = ON');

// ---------------------------------------------------------------------------
// SCHEMA
// ---------------------------------------------------------------------------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK(role IN ('patient','doctor','admin')),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  phone TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS doctor_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  specialisation TEXT NOT NULL,
  slot_duration_minutes INTEGER NOT NULL DEFAULT 30,
  working_hours_json TEXT NOT NULL, -- {"mon":["09:00","17:00"], ...}
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS doctor_leaves (
  id TEXT PRIMARY KEY,
  doctor_id TEXT NOT NULL REFERENCES doctor_profiles(id) ON DELETE CASCADE,
  leave_date TEXT NOT NULL, -- YYYY-MM-DD
  reason TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(doctor_id, leave_date)
);

-- The UNIQUE constraint below is the core double-booking safeguard:
-- SQLite enforces it atomically at the DB layer, so even simultaneous
-- requests cannot both succeed for the same doctor+slot.
CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doctor_id TEXT NOT NULL REFERENCES doctor_profiles(id) ON DELETE CASCADE,
  slot_date TEXT NOT NULL,   -- YYYY-MM-DD
  slot_time TEXT NOT NULL,   -- HH:MM (24h)
  status TEXT NOT NULL DEFAULT 'held'
    CHECK(status IN ('held','confirmed','cancelled','completed','leave_cancelled')),
  hold_expires_at TEXT,      -- used while status='held' (slot-hold mechanism)
  symptoms_text TEXT,
  pre_visit_summary_json TEXT,   -- {urgency, chief_complaint, questions[]}
  doctor_notes TEXT,
  prescription_json TEXT,        -- [{medicine, dosage, frequency_per_day, duration_days}]
  post_visit_summary_text TEXT,
  google_event_id_patient TEXT,
  google_event_id_doctor TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(doctor_id, slot_date, slot_time, status) -- see partial-uniqueness note below
);

-- SQLite doesn't support partial UNIQUE natively pre-3.8, but this build does
-- (WHERE clause on the index). This guarantees only ONE active (held/confirmed)
-- appointment can exist per doctor/date/time, while cancelled ones don't block reuse.
DROP INDEX IF EXISTS idx_no_double_booking;
CREATE UNIQUE INDEX idx_no_double_booking
  ON appointments(doctor_id, slot_date, slot_time)
  WHERE status IN ('held','confirmed');

CREATE TABLE IF NOT EXISTS medication_reminders (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  medicine TEXT NOT NULL,
  scheduled_at TEXT NOT NULL, -- ISO datetime
  sent INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS email_outbox (
  id TEXT PRIMARY KEY,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

module.exports = db;
