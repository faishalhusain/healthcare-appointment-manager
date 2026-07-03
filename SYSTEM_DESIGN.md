# System Design Write-Up

## Double-booking prevention

The naive approach — "check availability, then insert" — has a race
condition: two patients can both pass the availability check before either
insert commits. Rather than solving this with application-level locks
(mutexes, Redis locks, `SELECT ... FOR UPDATE`), I pushed the invariant down
to the database itself, where it can be enforced atomically regardless of
how many requests arrive at the same instant.

The `appointments` table has a **partial unique index**:

```sql
CREATE UNIQUE INDEX idx_no_double_booking
  ON appointments(doctor_id, slot_date, slot_time)
  WHERE status IN ('held','confirmed');
```

Only one row per `(doctor, date, time)` can be `held` or `confirmed` at a
time; cancelled/completed rows are excluded so the slot can be reused later.
When a booking request comes in, the server simply attempts an `INSERT`. If
two requests race for the same slot, SQLite guarantees only one `INSERT`
succeeds — the loser gets a constraint violation, which the error middleware
translates into a `409 Conflict`. No explicit locking code is needed, and
correctness holds under true concurrency, not just under "should rarely
happen in practice."

## Slot-hold mechanism

Booking is two steps, not one: `POST /appointments/hold` creates a row with
`status='held'` and a `hold_expires_at` five minutes in the future — this is
what actually claims the slot via the unique index above. The patient then
fills in their symptom form and calls `POST /appointments/:id/confirm`,
which flips the row to `confirmed`, runs the AI pre-visit summary, and
sends notifications. If the patient abandons the flow, the hold expires and
the slot becomes available again without ever having sent a false
confirmation.

Expiry is enforced two ways: **lazily**, every time availability is queried
for a doctor/date, expired holds in that scope are flipped to `cancelled`
before slots are computed, so a stale hold never falsely blocks a real
patient; and **actively**, the background cron job sweeps *all* expired
holds every few minutes, so the index stays clean even for slots nobody is
currently looking at. This two-tier sweep avoids needing a separate
distributed job for the common case while still guaranteeing cleanup
globally.

## Doctor leave conflict handling

When an admin marks a doctor on leave for a date (`POST
/admin/doctors/:id/leave`), the leave is recorded, and the handler
immediately queries for any `held`/`confirmed` appointments that doctor
already has on that date. Each one is transitioned to a distinct status,
`leave_cancelled` (kept separate from a plain `cancelled` so the patient's
history clearly shows *why* it happened, not just that it happened), and
for each affected patient the system:

1. writes an in-app `notifications` row,
2. queues a cancellation email explaining the reason and inviting a
   rebooking, and
3. deletes the patient's Google Calendar event if one exists.

Because the leave day itself is also consulted by `getAvailableSlots`, no
new bookings can be made for that date going forward — the fix is applied
at both ends: existing conflicts are resolved and future ones are
prevented, in the same request.

## Notification failure handling

Two categories of "notification" exist in this system — AI summaries and
outbound emails — and both are built so a downstream failure degrades
gracefully instead of breaking the booking or consultation flow.

**LLM calls** (pre-visit and post-visit summaries) are wrapped with a 15s
timeout and a try/catch. On any failure — timeout, non-2xx response, or a
response that isn't valid JSON in the expected shape — the service falls
back to a deterministic, still-useful result: a keyword-based urgency
classifier for pre-visit summaries, and the doctor's raw notes reformatted
with a standard footer for post-visit summaries. Every result carries a
`source: "ai" | "fallback"` field so the UI can be transparent about which
one the user is seeing, rather than silently pretending a fallback is an AI
result.

**Emails** use an *outbox pattern*: `queueEmail()` first writes the message
to an `email_outbox` table with `status='pending'`, then attempts an
immediate send. If SMTP isn't configured, it's logged instead of sent
(useful in development, and prevents an infinite retry loop from
misconfiguration). If SMTP *is* configured but the send throws (provider
outage, network blip), the row simply stays `pending` with an incremented
`attempts` counter and the error message recorded. The cron job
(`reminderJob.js`) retries all `pending` rows under a max-attempt cap on
every run. This means a transient email outage never silently drops a
booking confirmation or a medication reminder — it's retried automatically
until it succeeds or the attempt cap is reached, at which point it's still
visible in the outbox table for manual inspection.

Google Calendar sync follows the same philosophy: every call site treats a
missing OAuth connection or an API error as a soft failure
(`{skipped: true, reason}`) rather than throwing, so a patient who hasn't
connected their calendar can still book, confirm, and be treated normally.

*(≈780 words)*
