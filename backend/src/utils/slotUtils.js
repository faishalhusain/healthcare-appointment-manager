const db = require('../config/db');

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function addMinutes(hhmm, minutes) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
}

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Returns available slot times (HH:MM[]) for a doctor on a given date,
 * accounting for working hours, slot duration, leave days, and slots
 * already held/confirmed by another patient.
 */
function getAvailableSlots(doctorProfile, dateStr) {
  const dow = DAY_KEYS[new Date(`${dateStr}T00:00:00`).getDay()];
  const workingHours = JSON.parse(doctorProfile.working_hours_json);
  const range = workingHours[dow];
  if (!range) return []; // doctor doesn't work this day

  const onLeave = db
    .prepare(`SELECT 1 FROM doctor_leaves WHERE doctor_id = ? AND leave_date = ?`)
    .get(doctorProfile.id, dateStr);
  if (onLeave) return [];

  const [start, end] = range;
  const duration = doctorProfile.slot_duration_minutes;
  const slots = [];
  let cursor = start;
  while (timeToMinutes(cursor) + duration <= timeToMinutes(end)) {
    slots.push(cursor);
    cursor = addMinutes(cursor, duration);
  }

  const taken = new Set(
    db
      .prepare(
        `SELECT slot_time FROM appointments
         WHERE doctor_id = ? AND slot_date = ? AND status IN ('held','confirmed')`
      )
      .all(doctorProfile.id, dateStr)
      .map((r) => r.slot_time)
  );

  // Also clear stale expired holds so they don't show as unavailable forever
  db.prepare(
    `UPDATE appointments SET status='cancelled'
     WHERE status='held' AND hold_expires_at IS NOT NULL AND hold_expires_at < datetime('now')`
  ).run();

  return slots.filter((s) => !taken.has(s));
}

module.exports = { getAvailableSlots, addMinutes, timeToMinutes };
