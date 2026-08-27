# AI Teacher Automation — Standalone Test System

A separate MERN testing project that reads real teachers from `teacherprofiles` and real listings from `studenttuitiondetails`. It creates compatible automatic records in the main `teacherapplications` collection and updates the existing tuition application counter only after a live application succeeds. All other test-system state is isolated in new collections.

## Architecture

```text
teacherprofiles + teacherAutomationSettings
                    |
studenttuitiondetails (explicitly available only)
                    |
         mode and on-site location gate
                    |
      language rule gate, then Gemini subject/grade match
                    |
           backend-only final policy decision
                    |
  teacherapplications (live) / tuitionAutomationEvaluations (historic/rejected)
```

The React client has three routes:

- `/teachers` — the Auto apply setting and live processing controls.
- `/applications` — persisted live applications plus historic/rejected evaluation records.
- `/tuition-matches` — each available tuition's requirements alongside the newest teacher automation result.

## Database safety

The project reads these pre-existing collections:

- `teacherprofiles`
- `studenttuitiondetails`

It creates only these testing-system collections:

- `teacherAutomationSettings` — one setting document per teacher, with a unique `teacherId` index.
- `tuitionAutomationEvaluations` — rejection, AI-failure, and duplicate-result records. New runs are always live; this collection ensures non-applications are never represented as applications.

No teacher profile is changed. On a live qualifying match, the service creates a compatible record in the existing main-site `teacherapplications` collection. It also increments only the tuition's established numeric `applications` counter in `studenttuitiondetails`, matching the normal application flow so the student-facing main website exposes it. The application record uses the actual main-site field pattern (`jobId`, teacher `userId`, job snapshot, `resume.profileData`, `status: "Submitted"`, `autoApplied: true`, and `matchScore`).

Only explicit statuses `active`, `available`, `open`, `live`, and `published` are eligible. `completed`, `cancelled`, `closed`, `deleted`, `inactive`, and related statuses are rejected. A status not on the explicit available list is not processed.

## Setup

1. Copy `.env.example` to `.env` at the project root.

2. Set `MONGODB_URI` to the supplied cluster URI **with the populated database name in its path**. The inspection run found the specified real collections in `intelliflick`; for example, use a URI whose path is `/intelliflick` rather than leaving the database path empty.

3. Add a server-side `GEMINI_API_KEY`. Never put it in `client/` or `VITE_*` variables.

4. Install dependencies:

```powershell
cd server
npm.cmd install

cd ../client
npm.cmd install
```

On systems where PowerShell blocks `npm.ps1`, use `npm.cmd` as shown.

## Start the application

Terminal 1:

```powershell
cd server
npm.cmd start
```

Terminal 2:

```powershell
cd client
npm.cmd run dev
```

Open the Vite URL (normally `http://localhost:5173`). The API is `http://localhost:5000/api` by default. Set `VITE_API_URL` only if the API uses another address.

## Automation settings

On **Teacher Automation**, each teacher card persists these values to `teacherAutomationSettings`:

```json
{
  "teacherId": "ObjectId",
  "autoApply": true
}
```

`autoApply` is the only teacher control. When it is on, the scheduler can create an application after all backend checks pass. Teachers cannot set the Gemini quality threshold.

## Matching policy

The normalizer safely aliases common forms such as `eng` → `english`, `ONLINE` → `online`, and `maths` → `mathematics`. Gemini uses the teacher's real skill wording and applies the same semantic related-subject reasoning across all marketplace subjects; there is no subject-specific allowlist.

The backend always checks rules first. Online (and both-mode) tuition passes the physical-location rule. For physical/on-site tuition, both country and city must be present and exactly match. If the tuition specifies a preferred language, the teacher must list that same language. Pairs that fail any of these rules never reach Gemini. Gemini receives only the teacher's skills and stated grades plus the tuition subject and class grade; it accepts only direct, teachable subject evidence: the requested subject, a topic within it, or a genuine parent/child curriculum relationship. It rejects indirect academic foundations; for example, Data Science alone does not prove Maths teaching ability, and cloud/infrastructure tools alone do not prove web-development teaching ability. Education, degree/major, experience, availability, timing, price, and other fields are ignored. Gemini must return `match: true`, decision `AUTO_APPLY`, and a score of at least **70/100** before an application is eligible. This threshold is fixed in backend code and has no teacher-facing control.

Sensitive fields are not normalized, sent to Gemini, or scored: religion, gender, date of birth, and other personal data are excluded.

Gemini receives only a minimized teacher/tuition object and is instructed to return JSON like:

```json
{
  "match": true,
  "score": 92,
  "confidence": 0.94,
  "decision": "AUTO_APPLY",
  "matchedRequirements": ["Relevant subject skills", "Grade 9 compatibility"],
  "missingRequirements": [],
  "concerns": [],
  "reason": "The teacher's stated skills are relevant to the requested subject and grade."
}
```

The backend validates every field, retries malformed/failed calls, and records `AI_FAILED` without applying if Gemini is unavailable or invalid. Gemini has no database-write capability. The backend requires auto-apply permission, available tuition, passing mode/location/language rules, a valid `match: true` Gemini response with decision `AUTO_APPLY` and a score of at least 70, and no existing application before inserting an application.

## Live processing

The UI has no dry-run control. All processing actions are live.

- Set **Auto apply** on the teachers who may receive applications.
- Use **Process selected tuition** or **Process all eligible tuitions** to run live automation now.

CLI equivalents:

```powershell
cd server

# One teacher versus one tuition (live)
npm.cmd run process-automation -- --teacher=TEACHER_ID --tuition=TUITION_ID

# One tuition versus every auto-apply teacher (live)
npm.cmd run process-automation -- --tuition=TUITION_ID

```

Use the safe schema/status inspection command before a first run:

```powershell
cd server
npm.cmd run inspect-db
```

It prints counts, field names, and status counts—not document contents. Set `MONGODB_URI` first.

If automatic applications were made before the counter update was added, repair only their affected tuition counters once:

```powershell
cd server
npm.cmd run sync-automation-application-counts
```

### Live applications

Ensure the teacher has `autoApply: true`, then use **Process selected tuition**, **Process all eligible tuitions**, or let the scheduler run. A successful live application resembles:

```json
{
  "teacherId": "ObjectId",
  "tuitionId": "ObjectId",
  "applicationType": "AUTO",
  "status": "APPLIED",
  "match": {
    "ruleScore": 82,
    "geminiScore": 92,
    "confidence": 0.94,
    "decision": "AUTO_APPLY",
    "matchedRequirements": ["Relevant subject knowledge"],
    "missingRequirements": [],
    "concerns": [],
    "reason": "Strong documented qualification match."
  },
  "appliedAt": "Date"
}
```

The unique compound index on `{ teacherId, tuitionId }` prevents a second record even if two processes race. A duplicate is returned and recorded as `ALREADY_APPLIED`.

## Scheduler

The standalone scheduler is intentionally disabled by default. Enable it only after manual testing:

```env
AUTO_APPLY_SCHEDULER_ENABLED=true
AUTO_APPLY_INTERVAL_MINUTES=1
```

It runs at the configured minute interval, selects only explicit available statuses, and prevents overlapping runs. It continues after individual teacher/tuition failures and creates live applications for qualifying matches.

Each teacher-tuition pair is cached. If a matching main-site `teacherapplications` record already exists, it is skipped permanently. Otherwise, a completed live evaluation is reused until the teacher profile, tuition, or auto-apply setting changes. Gemini requests are paced below the free-tier limit; when Gemini returns a rate limit (429), the current match waits until the supplied reset time and retries before the scheduler moves to the next pair.

## Verification

Run backend tests:

```powershell
cd server
npm.cmd test
```

Build the client:

```powershell
cd client
npm.cmd run build
```

The included tests cover alias normalization, defensible related-subject handling, physical-mode rejection, unavailable-status rejection, and Gemini response validation.

## Later integration

The reusable backend pieces are `services/teacherAutomationService.js`, `services/geminiMatcher.js`, `utils/normalizeMatchingData.js`, `utils/matchingScoring.js`, and the four automation API actions. When moving this into the main site, replace this test project's unauthenticated routes with the existing authentication/authorization middleware and merge the services with the real manual-application and notification flows. Keep the separate settings collection or migrate settings intentionally; do not blindly copy routes or client files.
