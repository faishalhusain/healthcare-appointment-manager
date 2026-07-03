/**
 * Google Calendar Service
 * ------------------------
 * Uses OAuth 2.0 (googleapis). Each user (patient/doctor) connects their
 * own Google account once via /api/calendar/oauth/url -> consent -> callback.
 * Tokens are stored per-user (see users table extension `google_tokens_json`
 * added via migration in db.js for brevity we store in a side table below).
 */
const { google } = require('googleapis');
const db = require('../config/db');

db.exec(`
CREATE TABLE IF NOT EXISTS google_tokens (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tokens_json TEXT NOT NULL
);
`);

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function getAuthUrl(state) {
  const client = getOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar.events'],
    state,
  });
}

async function handleOAuthCallback(code, userId) {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);
  db.prepare(
    `INSERT INTO google_tokens (user_id, tokens_json) VALUES (?,?)
     ON CONFLICT(user_id) DO UPDATE SET tokens_json = excluded.tokens_json`
  ).run(userId, JSON.stringify(tokens));
  return true;
}

function getClientForUser(userId) {
  const row = db.prepare(`SELECT tokens_json FROM google_tokens WHERE user_id = ?`).get(userId);
  if (!row) return null;
  const client = getOAuthClient();
  client.setCredentials(JSON.parse(row.tokens_json));
  return client;
}

async function createEvent(userId, { summary, description, startISO, endISO, attendees }) {
  const client = getClientForUser(userId);
  if (!client) return { skipped: true, reason: 'GOOGLE_NOT_CONNECTED' };

  const calendar = google.calendar({ version: 'v3', auth: client });
  try {
    const res = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary,
        description,
        start: { dateTime: startISO },
        end: { dateTime: endISO },
        attendees,
      },
    });
    return { eventId: res.data.id };
  } catch (err) {
    return { skipped: true, reason: err.message };
  }
}

async function updateEvent(userId, eventId, patch) {
  const client = getClientForUser(userId);
  if (!client || !eventId) return { skipped: true };
  const calendar = google.calendar({ version: 'v3', auth: client });
  try {
    await calendar.events.patch({ calendarId: 'primary', eventId, requestBody: patch });
    return { ok: true };
  } catch (err) {
    return { skipped: true, reason: err.message };
  }
}

async function deleteEvent(userId, eventId) {
  const client = getClientForUser(userId);
  if (!client || !eventId) return { skipped: true };
  const calendar = google.calendar({ version: 'v3', auth: client });
  try {
    await calendar.events.delete({ calendarId: 'primary', eventId });
    return { ok: true };
  } catch (err) {
    return { skipped: true, reason: err.message };
  }
}

module.exports = { getAuthUrl, handleOAuthCallback, createEvent, updateEvent, deleteEvent };
