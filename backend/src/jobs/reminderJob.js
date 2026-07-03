const cron = require('node-cron');
const { v4: uuid } = require('uuid');
const db = require('../config/db');
const { queueEmail, retryPendingEmails } = require('../services/email.service');

/**
 * Runs on REMINDER_CRON schedule (default every 5 min):
 *  1. Sends due medication reminders (email + in-app notification)
 *  2. Retries any failed/pending emails in the outbox
 *  3. Sweeps expired slot-holds back to 'cancelled' so slots free up
 */
function sendDueMedicationReminders() {
  const due = db
    .prepare(
      `SELECT mr.*, a.patient_id, u.name as patient_name, u.email as patient_email
       FROM medication_reminders mr
       JOIN appointments a ON a.id = mr.appointment_id
       JOIN users u ON u.id = a.patient_id
       WHERE mr.sent = 0 AND mr.scheduled_at <= datetime('now')`
    )
    .all();

  for (const r of due) {
    queueEmail(
      r.patient_email,
      'Medication Reminder',
      `Hi ${r.patient_name}, this is a reminder to take your medicine: ${r.medicine}.`
    );
    db.prepare(
      `INSERT INTO notifications (id, user_id, title, message) VALUES (?,?,?,?)`
    ).run(uuid(), r.patient_id, 'Medication Reminder', `Time to take: ${r.medicine}`);
    db.prepare(`UPDATE medication_reminders SET sent = 1 WHERE id = ?`).run(r.id);
  }
  return due.length;
}

function sweepExpiredHolds() {
  const result = db
    .prepare(
      `UPDATE appointments SET status='cancelled'
       WHERE status='held' AND hold_expires_at < datetime('now')`
    )
    .run();
  return result.changes;
}

function start() {
  const schedule = process.env.REMINDER_CRON || '*/5 * * * *';
  cron.schedule(schedule, async () => {
    try {
      const remindersSent = sendDueMedicationReminders();
      const holdsFreed = sweepExpiredHolds();
      const emailsRetried = await retryPendingEmails();
      if (remindersSent || holdsFreed || emailsRetried) {
        console.log(
          `[job] reminders=${remindersSent} holdsFreed=${holdsFreed} emailsRetried=${emailsRetried}`
        );
      }
    } catch (err) {
      console.error('[job] error:', err.message);
    }
  });
  console.log(`[job] scheduled reminder/retry job with cron "${schedule}"`);
}

module.exports = { start, sendDueMedicationReminders, sweepExpiredHolds };
