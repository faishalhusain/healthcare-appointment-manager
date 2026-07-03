/**
 * Email Service
 * -------------
 * Uses an "outbox" pattern: every email is first written to the
 * email_outbox table (status=pending), then an immediate send is attempted.
 * If sending fails (or SMTP isn't configured), it stays 'pending' and the
 * background scheduler (jobs/reminderJob.js) retries it periodically.
 * This means a transient email provider outage never loses a notification.
 */
const nodemailer = require('nodemailer');
const { v4: uuid } = require('uuid');
const db = require('../config/db');

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporter;
}

function queueEmail(toEmail, subject, body) {
  const id = uuid();
  db.prepare(
    `INSERT INTO email_outbox (id, to_email, subject, body, status) VALUES (?,?,?,?,'pending')`
  ).run(id, toEmail, subject, body);
  // fire-and-forget immediate attempt; failures are picked up by the retry job
  attemptSend(id).catch(() => {});
  return id;
}

async function attemptSend(id) {
  const row = db.prepare(`SELECT * FROM email_outbox WHERE id = ?`).get(id);
  if (!row || row.status === 'sent') return;

  const t = getTransporter();
  if (!t) {
    // Dev-safe fallback: no SMTP configured, just log so the app never breaks
    console.log(`[EMAIL:MOCK] To=${row.to_email} Subject="${row.subject}"`);
    db.prepare(`UPDATE email_outbox SET status='sent' WHERE id=?`).run(id);
    return;
  }

  try {
    await t.sendMail({
      from: process.env.EMAIL_FROM,
      to: row.to_email,
      subject: row.subject,
      text: row.body,
    });
    db.prepare(`UPDATE email_outbox SET status='sent' WHERE id=?`).run(id);
  } catch (err) {
    db.prepare(
      `UPDATE email_outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?`
    ).run(err.message, id);
    throw err;
  }
}

/** Called periodically by the background job to retry failed/pending emails. */
async function retryPendingEmails(maxAttempts = 5) {
  const pending = db
    .prepare(`SELECT id FROM email_outbox WHERE status='pending' AND attempts < ?`)
    .all(maxAttempts);
  for (const row of pending) {
    await attemptSend(row.id).catch(() => {});
  }
  return pending.length;
}

module.exports = { queueEmail, retryPendingEmails };
