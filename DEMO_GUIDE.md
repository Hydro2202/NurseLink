# NurseLink — Demo Guide

**Live URL:** https://nurse-link-three.vercel.app
**Backend:** https://nurselink.onrender.com (Render free tier — first request after idle can take 30-50s to wake up; open the site a minute before the defense starts to warm it up)

## Test Accounts

| Role | Email | Password | Name |
|---|---|---|---|
| Nurse (Staff Nurse) | `nurse@hospital.com` | `password123` | Sarah Johnson — ICU |
| Head Nurse | `headnurse@hospital.com` | `password123` | Maria Santos — Nursing Administration |
| Admin | `raiden@admin.com` | _TBD_ | Raiden |

Sample data already on the production database: 103 seeded patients spread across active nurses, plus whatever tasks/kardex/charting/handover records exist from testing.

## Demo Flow — Nurse (`nurse@hospital.com`)

1. **Login** — select "Nurse", sign in. Lands on Dashboard.
2. **Dashboard** — point out the live stat cards (Urgent/Completed/Patients/High Risk) and Quick Actions.
3. **My Duty** — show clock-in/out and the current shift.
4. **Tasks** — open a task, show the vitals-recording gate (needs 2 readings before a task can be marked done), complete one.
5. **Kardex** — open a patient's kardex, show meds/labs, add a note.
6. **Charting** — start a new note, use the AI "Structure Chart" action on free-text input, show the FDAR-formatted result, confirm/save it.
7. **Referral (Handover)** — show the SBAR handover form and the history timeline for a patient.
8. **Notifications** — open the bell, show a live notification.
9. **Settings** — show preferences (font size, compact view) actually changing the UI live.

## Demo Flow — Head Nurse (`headnurse@hospital.com`)

1. **Login** — select "Head Nurse".
2. **Dashboard** — department-wide stats.
3. **Duty Roster** — create/edit a shift assignment, show the Team tab grouped by department.
4. **All Patients** — show status tabs (Admitted/Observation/Discharged), filter, open a patient, show Discharge/Readmit flow.
5. **Workload Monitor** — show per-nurse workload and the nurse search box.
6. **Analytics** — show the KPI tiles and the Task Types donut chart.
7. **Referral (read-only oversight)** — show the same handover screen in oversight mode.

## Demo Flow — Admin (`raiden@admin.com`)

1. **Login** — select the Admin role path (no role picker — admin is detected from the account).
2. **Dashboard** — stat cards: accounts, pending approval, total patients.
3. **Accounts** — approve/reject/deactivate a test account, reset a password.
4. **Registrations** — show identity-verification history for a signup.
5. **Hospital Records** — open Patients, Tasks, Doctors, Departments sections from the generic records browser.

## Rollback

If anything breaks right before the defense:

- **Frontend/backend code:** `git reset --hard backup/pre-demo-polish-20261011` on `main`, then push to both `origin` and the `YuanandOnlyy/NurseLink` fork Vercel/Render watch — this instantly reverts every change made this session.
- **Database:** see the production DB backup (pending — not yet taken as of this guide; check `db-backups/` in the repo root once available, or Render's own point-in-time Recovery tab on the `nurselink-db` service).
- **Vercel:** the Deployments list (vercel.com → nurse-link → Deployments) has every prior production build — use "Promote to Production" on an older one, or "Instant Rollback" from the "..." menu on the currently-live row.
