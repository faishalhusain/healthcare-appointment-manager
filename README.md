# Healthcare Appointment & Follow-up Manager

## 🔗 Live Demo

**Link:** https://healthcare-appointment-manager-frontend.onrender.com

> **Note:** Hosted on Render's free tier — the backend may take 30–60
> seconds to spin up on the first request after a period of inactivity.
> If the page looks stuck on load, give it a moment and refresh.

**Try it with the seeded accounts:**
- Admin: `admin@clinic.com` / `Admin@123`
- Doctor: `dr.sharma@clinic.com` / `Doctor@123`
- Or register a new patient account from the login page.

> Some features (LLM summaries, email, Google Calendar) depend on API keys
> configured in the deployed environment. If any of these aren't set up on
> the live instance, the app degrades gracefully as described below — see
> "Failure handling."

A clinic platform with separate **patient**, **doctor**, and **admin** portals.
Patients book appointments and share symptoms in advance; an LLM generates an
urgency-flagged pre-visit summary for the doctor and a plain-language
post-visit summary for the patient; both sides get email + Google Calendar
notifications; medication reminders fire automatically based on the
prescription.

Built to match the assignment brief exactly — see `SYSTEM_DESIGN.md` for the
800-word design write-up covering double-booking prevention, leave conflict
handling, the slot-hold mechanism, and notification failure handling.

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Backend | Node.js + Express | Simple, minimal-dependency REST API |
| Database | **`node:sqlite`** (Node's built-in SQLite module) | Zero native/npm dependency, file-based, no DB server to install — matches the assignment's "minimal & native dependencies" guideline |
| Auth | JWT + bcrypt, role-based (`patient` / `doctor` / `admin`) | Stateless, simple to review |
| LLM | Any OpenAI-compatible endpoint | Pre-visit & post-visit summaries, with a deterministic offline fallback if the API is unreachable |
| Email | Nodemailer (SMTP) with a DB-backed outbox + retry job | Never loses a notification, even if the provider is briefly down |
| Calendar | Google Calendar API (OAuth 2.0) | Auto-create/update/delete events on booking, reschedule, cancel |
| Frontend | React + Vite (no UI framework, hand-rolled CSS) | Fast, minimal dependencies |
| Background jobs | `node-cron` | Medication reminders + email retries + expired-hold cleanup |

**Requires Node.js ≥ 22.5** (for the built-in `node:sqlite` module).

## Project structure

```
healthcare-appointment-manager/
├── backend/
│   ├── src/
│   │   ├── server.js              # Express app entrypoint
│   │   ├── config/db.js           # SQLite schema + connection
│   │   ├── middleware/            # auth (JWT), error handler
│   │   ├── routes/                # auth, doctors, appointments, admin, calendar, notifications
│   │   ├── controllers/           # request handlers per resource
│   │   ├── services/              # llm.service, email.service, calendar.service
│   │   ├── jobs/reminderJob.js    # cron: medication reminders + email retry
│   │   └── utils/                 # slot generation, seed script
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── pages/patient/         # BookAppointment, MyAppointments
│   │   ├── pages/doctor/          # Dashboard (queue + consult + post-visit)
│   │   ├── pages/admin/           # Dashboard (manage doctors + leave)
│   │   ├── context/AuthContext.jsx
│   │   ├── api/client.js
│   │   └── components/
│   ├── package.json
│   └── .env.example
├── SYSTEM_DESIGN.md
└── README.md   (this file)
```

## Setup guide

### 1. Backend

```bash
cd backend
cp .env.example .env      # then fill in real values (see below)
npm install
npm run seed               # creates an admin + a sample doctor for first login
npm start                   # http://localhost:5000
```

Seeded accounts:
- Admin: `admin@clinic.com` / `Admin@123`
- Doctor: `dr.sharma@clinic.com` / `Doctor@123` (General Physician, Mon–Fri 09:00–13:00)

`.env` values to fill in for full functionality (the app degrades gracefully
without any of these — see "Failure handling" below):

- `JWT_SECRET` — any long random string
- `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` — an OpenAI-compatible endpoint
- `SMTP_HOST/PORT/USER/PASS`, `EMAIL_FROM` — any SMTP provider (Gmail app
  password, SendGrid, Mailtrap for testing, etc.)
- `GOOGLE_CLIENT_ID/SECRET`, `GOOGLE_REDIRECT_URI` — see Calendar setup below

### 2. Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev                 # http://localhost:5173
```

The Vite dev server proxies `/api` to `http://localhost:5000` automatically
(`vite.config.js`), so no CORS configuration is needed locally.

### 3. Try it

1. Open `http://localhost:5173`, log in as the seeded doctor and admin, or
   register a new patient account.
2. As **admin**: add a doctor (or use the seeded one), set working hours,
   optionally mark a leave day.
3. As **patient**: search by specialisation, pick a date/slot, describe
   symptoms, confirm — you'll see the AI-generated urgency + summary.
4. As **doctor**: open the queue, see the pre-visit summary, write clinical
   notes + a prescription, complete the visit — the patient gets a
   plain-language AI summary and medication reminders are scheduled.

## API reference

All authenticated routes expect `Authorization: Bearer <token>`.

| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/api/auth/register` | public | Patient self-registration |
| POST | `/api/auth/login` | public | Login (all roles) |
| GET | `/api/auth/me` | any | Current user |
| POST | `/api/admin/doctors` | admin | Create doctor profile (specialisation, hours, slot length) |
| GET | `/api/admin/doctors` | admin | List all doctors |
| PUT | `/api/admin/doctors/:id` | admin | Update doctor profile |
| DELETE | `/api/admin/doctors/:id` | admin | Remove a doctor — cancels & notifies patients on any active appointments first, then revokes login |
| POST | `/api/admin/doctors/:id/leave` | admin | Mark a leave day — cancels conflicting bookings & notifies patients |
| GET | `/api/doctors` | any | Search/list doctors (`?specialisation=`) |
| GET | `/api/doctors/:id/availability?date=` | any | Available slots for a date |
| GET | `/api/doctors/me/appointments?status=` | doctor | Doctor's own appointment queue |
| POST | `/api/appointments/hold` | patient | Hold a slot (5-min hold, atomic double-booking guard) |
| POST | `/api/appointments/:id/confirm` | patient | Submit symptoms → AI pre-visit summary → email + calendar |
| POST | `/api/appointments/:id/reschedule` | patient | Move a confirmed appointment to a new date/time — atomically slot-conflict-checked, patches calendar events, emails both sides |
| POST | `/api/appointments/:id/cancel` | patient/admin | Cancel |
| POST | `/api/appointments/:id/post-visit` | doctor | Notes + prescription → AI post-visit summary → medication reminders |
| GET | `/api/appointments/me` | patient | Patient's own appointments |
| GET | `/api/appointments/:id` | owner | Appointment detail |
| GET | `/api/calendar/oauth/url` | any | Get Google consent URL |
| GET | `/api/calendar/oauth/callback` | public | OAuth redirect target |
| GET | `/api/notifications` | any | In-app notifications |

## Database schema

SQLite via `node:sqlite`, file at `backend/data/app.db` (auto-created).

```
users(id, role[patient|doctor|admin], name, email UNIQUE, password_hash, phone, created_at)
doctor_profiles(id, user_id -> users, specialisation, slot_duration_minutes, working_hours_json, created_at)
doctor_leaves(id, doctor_id -> doctor_profiles, leave_date, reason, UNIQUE(doctor_id, leave_date))
appointments(
  id, patient_id -> users, doctor_id -> doctor_profiles,
  slot_date, slot_time, status[held|confirmed|cancelled|completed|leave_cancelled],
  hold_expires_at, symptoms_text, pre_visit_summary_json,
  doctor_notes, prescription_json, post_visit_summary_text,
  google_event_id_patient, google_event_id_doctor, created_at, updated_at
)
-- Double-booking guard: partial UNIQUE index
CREATE UNIQUE INDEX idx_no_double_booking ON appointments(doctor_id, slot_date, slot_time)
  WHERE status IN ('held','confirmed');

medication_reminders(id, appointment_id -> appointments, medicine, scheduled_at, sent, attempts)
email_outbox(id, to_email, subject, body, status[pending|sent|failed], attempts, last_error)
notifications(id, user_id -> users, title, message, read, created_at)
google_tokens(user_id -> users, tokens_json)
```

Full reasoning for the double-booking guard, leave-conflict handling, and
slot-hold mechanism is in `SYSTEM_DESIGN.md`.

## LLM prompts used

**Pre-visit summary** (`backend/src/services/llm.service.js`):
```
Analyse these symptoms and return: urgency level (Low / Medium / High),
chief complaint, and three suggested questions for the doctor.
Symptoms: <symptoms>
```
Requested as strict JSON: `{"urgency","chief_complaint","questions":[...]}`.

**Post-visit summary**:
```
Convert these clinical notes into a patient-friendly summary with
medication schedule and follow-up steps: <notes>
```

**LLM failure handling:** every call has a 15s timeout; on timeout, non-2xx
response, or malformed JSON, the service falls back to a deterministic
summary (keyword-based urgency triage for pre-visit; the raw notes
reformatted for post-visit) so a downed LLM provider never blocks a booking
or a completed visit. The response includes `source: "ai" | "fallback"` so
the frontend can be transparent about it.

## Google Calendar setup (OAuth 2.0)

1. In [Google Cloud Console](https://console.cloud.google.com/), create a
   project → enable the **Google Calendar API**.
2. Create an **OAuth 2.0 Client ID** (Web application). Add an authorized
   redirect URI matching `GOOGLE_REDIRECT_URI` in `.env`
   (e.g. `http://localhost:5000/api/calendar/oauth/callback`).
3. Copy the Client ID/Secret into `backend/.env`.
4. Each user (patient/doctor) connects their calendar once via the
   **"Connect Google Calendar"** button in the app sidebar, which calls
   `GET /api/calendar/oauth/url` and redirects to Google's consent screen;
   tokens are stored per-user in the `google_tokens` table after the
   `/oauth/callback` redirect completes.
5. Once connected, `confirmAppointment` creates events for both patient and
   doctor; `rescheduleAppointment` patches the existing events to the new
   time (rather than delete+recreate); cancellations and leave conflicts
   delete them. If a user hasn't connected Google Calendar, the relevant
   call is skipped gracefully (`{skipped: true, reason: 'GOOGLE_NOT_CONNECTED'}`)
   — it never breaks the booking flow.

**Note on testing this live:** while the Google Cloud project's OAuth consent
screen is in **Testing** publishing status (the default, and normal for a
project like this), only Google accounts explicitly added under **Audience →
Test users** can complete the "Connect Google Calendar" flow — up to 100
users, each seeing an "unverified app" warning they have to click through.
This is a Google-enforced constraint, not a bug in this app. To let someone
else test the live connection, add their email as a test user; going
further (removing the warning screen entirely) requires Google's full app
verification process, which needs a hosted privacy policy and domain
verification and isn't necessary for this assignment. The integration
itself is fully implemented and tested — see `SYSTEM_DESIGN.md` and the
graceful-fallback behavior above.

## Notification & failure handling summary

- **Email**: outbox pattern (`email_outbox` table). Every email is written
  to the DB first, an immediate send is attempted, and the background job
  (`reminderJob.js`, every `REMINDER_CRON` — default 5 min) retries anything
  still `pending` up to 5 attempts. If SMTP isn't configured at all, emails
  are logged instead of sent (dev-safe, still marked `sent` so it doesn't
  loop forever).
- **LLM**: see above — always has a safe fallback.
- **Google Calendar**: best-effort, skipped gracefully if not connected or
  if the API call fails.
- **Double-booking**: enforced at the database layer with a partial unique
  index — not just application logic — so it's safe under concurrent
  requests.
- **Slot hold**: a slot is provisionally reserved (`status='held'`) for 5
  minutes while the patient fills in symptoms; expired holds are swept both
  lazily (on next availability check) and by the background job, freeing
  the slot automatically.

## Submission checklist (per `Assignment_Submission_Usage_Guidelines.pdf`)

- [x] No `node_modules/`, `.env`, build artifacts, or editor folders committed (`.gitignore`)
- [x] Minimal, only-required dependencies (native `node:sqlite` used instead
      of an external DB dependency)
- [x] App builds and runs without errors locally and on Render
- [x] Branch `main`, public repo / Drive link, within size limits
