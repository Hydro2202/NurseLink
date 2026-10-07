# Overnight Sweep — Morning Report

Branch: `fix/overnight-sweep` (created from `main`, never merged/pushed — see Part 0 of the task). All work is in commits on this branch; `main` is untouched.

## 1. Summary — most important first

**Needs your decision before anything else:**
- **CORS/CSRF not configured for production.** `CORS_ALLOW_ALL_ORIGINS = DEBUG` correctly turns off in production, but no `CORS_ALLOWED_ORIGINS` / `CSRF_TRUSTED_ORIGINS` replaces it — once `DJANGO_DEBUG=False`, the web app would be unable to call the API **at all** (fails closed, not a leak, but it's a "the site doesn't work" bug waiting to happen). I didn't guess your production domain names, so this isn't fixed. See §7.
- **Pillow has multiple CVEs** (11.3.0 → fix in 12.1.1+), used directly by `api/avatar.py` and by `pytesseract`. Not auto-upgraded — it's a major version bump (11→12). See §7.
- **Mobile has 23 remaining npm audit findings** (1 critical, were more before I fixed 5 safely) that all require `--force` and a breaking/major version change — one of them even wants to *downgrade* `expo` to 44.0.6, which is almost certainly npm's resolver doing something you don't want. Not applied. See §7.

**Fixed tonight, most important first:**
1. **Two real IDOR vulnerabilities**, both confirmed exploitable before I fixed them:
   - Any approved nurse could overwrite or delete **any patient's** core data (name, age, room, diagnosis, risk level, vitals) via `POST /api/kardex/` / `DELETE /api/kardex/{id}/`, completely bypassing the assigned-nurse restriction `PatientViewSet` already enforces on the same fields through the normal patient-edit endpoint.
   - Any approved nurse could complete **another nurse's task** via `POST /api/tasks/{code}/complete/?assignedTo=<their name>` — a query-param scoping bug let that parameter remove the requesting nurse's own-tasks restriction regardless of role.
2. **A task-checklist integrity gap**: a nurse could `PATCH` a task's 6-step safety checklist down to one fabricated `{"text": "x", "done": true}` item, then complete the task — the completion gate only checked "is anything unfinished," never "is this actually the real checklist."
3. **Issue 15** (anonymous upload hardening) — mostly already built from an earlier session; closed the remaining gaps (pixel-dimension limit, consistent 5MB-everywhere, lowered the 30MB global ceiling to 15MB with the reasoning spelled out, mobile-side photo compression, a cleanup command for abandoned uploads, new tests, a new smoke-test script).
4. Two N+1 query bugs in the Task list endpoint (missing `select_related`/`prefetch_related`, one of them silently defeated by a `.select_related()` call on a related manager that bypasses Django's prefetch cache).
5. Two stray tracked-but-gitignored directories untracked (`__pycache__`, a parent-level `.expo/`), 5 safe mobile dependency patches applied.

**Still broken / not fixed** — see §7 for the full list with recommended fixes: `WorkloadView`'s N+1 (3 queries × active-nurse-count per call — fix needs careful handling of a legacy free-text name-matching fallback, didn't want to rush it), a handful of smaller N+1s (`TaskSerializer.departmentName`-style patterns elsewhere), `KardexMedication.last_intake` property defeating its own prefetch the same way `get_assignedDoctors` did (same root cause, different call site — not yet fixed), the CORS/Pillow/npm-audit items above.

---

## 2. Before/after — every check, every project

| Project | Check | Before | After |
|---|---|---|---|
| Backend | `python manage.py check` | clean | clean |
| Backend | `python manage.py check --deploy` | 2 warnings (weak temp SECRET_KEY used for the check itself, HSTS_PRELOAD not set) | unchanged — both pre-existing, neither touched tonight |
| Backend | `python manage.py makemigrations --check --dry-run` | no changes detected | no changes detected (none of tonight's fixes needed a migration) |
| Backend | `python manage.py test api` (full suite) | exit 0 | re-run after every fix tonight, exit 0 each time *(the one full-suite confirmation launched after the IDOR/checklist fixes was still running as this report was written — see the note at the very end of §6; every individual affected test file was re-run directly and passed)* |
| Backend | `bandit -r api CapstoneBackEnd` | 3 findings (2 medium-confidence `urllib.urlopen` on hardcoded trusted URLs, already `# noqa`'d; 1 low-confidence SQL-injection false positive on an f-string building a human error message, not SQL) | unchanged — none were real, none touched |
| Backend | `pip-audit` | ~40 findings, but this machine's Python has **no project-specific virtualenv** (it's the global Windows Python install) — most flagged packages (`pyjwt`, `werkzeug`, `python-socketio`, `mako`, `marshmallow`, `pip`/`setuptools`/`wheel`) belong to **other, unrelated projects** installed on this machine (confirmed via `pip show --Required-by`: `werkzeug`→Flask, `mako`→alembic, etc. — zero imports of any of these anywhere in this repo). The one real, relevant finding is Pillow (see §7). | unchanged — no global packages touched (see §7 for why) |
| Web | `npx tsc --noEmit` | clean | clean |
| Web | `npm run build` (`vite build`) | succeeds, code-split | unchanged, succeeds |
| Web | `npm audit --omit=dev` | 0 vulnerabilities | 0 vulnerabilities |
| Mobile | `npx expo lint` | clean | clean |
| Mobile | `npx tsc --noEmit` | clean | clean |
| Mobile | `npx expo export --platform web` | succeeds | succeeds |
| Mobile | `npm audit --omit=dev` | 28 vulnerabilities (1 critical, 23 high, 4 moderate) | 23 (1 critical, 20 high, 3 moderate, 5 safely patched) — rest need `--force`/major bumps, reported not applied |
| End-to-end | `scripts/smoke_test.py` | *(didn't exist)* | 25 passed, 0 failed, 2 honestly-skipped, run twice (before and after the security fixes) |

No test framework exists for either frontend (`npm test` isn't a thing in either `package.json`) — unchanged from before tonight, not something I added since neither project asked for one.

---

## 3. Issue 15 — what changed, the new limits, how to adjust them

Found most of this already built from an earlier session: per-file size checks, real `cv2.imdecode`-based content verification (not just trusting `Content-Type`), and a per-IP `ScopedRateThrottle` already on all three identity-verification endpoints (`/auth/verify-id/`, `/auth/face-verification/`, `/auth/verify-prc/`), configurable via `THROTTLE_FACE_VERIFICATION` (default `30/hour`). I left that rate alone — it's already anonymous-safe (DRF's `ScopedRateThrottle` keys on client IP when there's no user) and lowering it risks breaking the legitimate multi-step signup flow (ID scan retakes + 3-attempt face verification share one bucket).

**What I added:**
- **Pixel-dimension ceiling**: `MAX_IMAGE_DIMENSION = 6000` in both `api/face_match.py` and `api/prc_ocr.py` — rejects an image that's small on disk but enormous once decoded (decompression-bomb shape), checked right after `cv2.imdecode` succeeds, before any face/OCR processing touches it.
- **Consistent 5MB-per-image everywhere**: the base64 JSON path previously allowed 10MB per image while the multipart path (`VerifyIdView`) only allowed 5MB for the *same endpoint* — now both are 5MB.
- **`DATA_UPLOAD_MAX_MEMORY_SIZE`: 30MB → 15MB**, not 10MB as literally suggested. Reason, spelled out in the settings.py comment: face-verification and PRC-licence-verification both send **two** 5MB-capped images in one JSON body (selfie + ID), which needs ~13.4MB once base64-encoded. 15MB leaves headroom for that plus JSON structure overhead while still halving the old ceiling. **To adjust**: change `CapstoneBackEnd/CapstoneBackEnd/settings.py` line with `DATA_UPLOAD_MAX_MEMORY_SIZE`, and keep it ≥ (2 × per-file limit × 1.34) if you ever raise the per-file limit.
- **Mobile photo compression**: every ID/selfie photo is resized to a 1600px long side at 0.75 JPEG quality before upload (`services/imageCompression.ts`), using `expo-image-manipulator` (new dependency). A normal sign-up's upload now sits at a few hundred KB. **To adjust**: change `MAX_DIMENSION`/`JPEG_QUALITY` constants in that file.
- **Friendlier 429 messages** on the mobile sign-up screens for ID-verification and face-verification (previously fell through to the generic backend-message passthrough, which is readable but shows DRF's raw "Expected available in 3600 seconds" phrasing).
- **New management command** `cleanup_abandoned_registrations` (`--dry-run`, `--days N`, default 7 or `ABANDONED_REGISTRATION_DAYS` env var): age-based deletion of unverified, unlinked `RegistrationSession` rows — and the one image this whole identity pipeline actually persists, `id_portrait`. The existing admin API action (`clear-abandoned`) only deletes sessions with *zero* extracted data; someone who scanned their ID and never came back keeps their portrait stored forever under that rule. This new command catches that case by age instead.
- **`scripts/smoke_test.py`**: requires `pip install websockets` (not added to `requirements.txt` — it's smoke-test tooling, not something the Django app imports). Confirms the hardening live against a running server, not just unit tests.

---

## 4. Scan findings

| # | Severity | Category | File:Line | Description | Status |
|---|---|---|---|---|---|
| 1 | **High** | Security — IDOR | `api/views.py` `KardexViewSet` | Any approved nurse could overwrite/delete any patient's core data via `/api/kardex/`, bypassing `PatientViewSet`'s assigned-nurse restriction on the same fields | **Fixed**, commit `2a8604dc5` |
| 2 | **High** | Security — IDOR | `api/views.py` `TaskViewSet.get_queryset`/`complete` | `?assignedTo=<name>` let a staff nurse act on (incl. complete) another nurse's task | **Fixed**, commit `2a8604dc5` |
| 3 | **High** | Correctness/integrity | `api/serializers.py` `TaskSerializer.validate_checklist` | A fabricated single-item checklist could substitute for the real 6-step one, defeating the completion gate | **Fixed**, commit `2a8604dc5` |
| 4 | Medium | Config/deployment | `CapstoneBackEnd/settings.py` | No `CORS_ALLOWED_ORIGINS`/`CSRF_TRUSTED_ORIGINS` for production | **Not fixed** — needs your production domain(s), see §7 |
| 5 | Medium | Dependency | Pillow 11.3.0 | Multiple CVEs, fix is a major version bump, used directly (`api/avatar.py`) and via `pytesseract` | **Not fixed**, see §7 |
| 6 | Medium-High | Performance (N+1) | `api/views.py` `WorkloadView.get` | 3 queries × active-nurse-count per call, plus 2 wholly unused `prefetch_related` calls | **Not fixed**, see §7 |
| 7 | High (perf) | Performance (N+1) | `api/views.py` `TaskViewSet.get_queryset`, `api/serializers.py` `TaskSerializer.get_assignedDoctors` | Missing `select_related('department')`/`prefetch_related('task_doctors__doctor')`; the serializer method also silently defeated prefetch by calling `.select_related()` on the related manager | **Fixed**, commit `2a8604dc5` |
| 8 | High (perf) | Performance (N+1) | `api/models.py` `KardexMedication.last_intake` (property) | Same "fresh queryset on a related manager defeats prefetch" bug as #7, different call site — `get_lastGiven`/`get_isOverdue` each pay for it independently | **Not fixed**, see §7 |
| 9 | Low-Medium | Performance (N+1) | `api/views.py` `AdminUserViewSet` / `_admin_user_payload` | `profile.role_granted_by.get_full_name()` without `select_related('role_granted_by')` | **Not fixed**, see §7 |
| 10 | Medium | Performance (N+1) | `api/serializers.py` `PatientVisitSerializer.get_vitals`/`get_notes` | Fresh query per visit, no prefetch set up by `PatientViewSet.visits` | **Not fixed**, see §7 |
| 11 | Low | Code health | tracked `__pycache__/*.pyc` (22 files) | Gitignored but tracked from before the rule existed | **Fixed**, commit `d539f942e` |
| 12 | Low | Code health | tracked `CapstoneFrontEnd/.expo/*` (3 files) | Same — a stray parent-level Expo cache dir outside the app's own gitignored one | **Fixed**, commit `7827e3eea` |
| 13 | Low | Security review | `api/views.py` `IsSupervisorOrReadOnly` (permission class) | Defined but unused by anything registered in `urls.py`; its write branch skips the approval/active check `IsSupervisor` (the one actually used) performs | **Not fixed** — unreachable today, noted for awareness |
| 14 | Low | Security review | `api/views.py` `RegistrationSessionViewSet` | Full `ModelViewSet` with `POST` enabled even though the docstring says sessions are only ever created by the signup flow — reachable by an admin, `IsAdmin`-gated | **Not fixed** — low risk (admin-only), noted for awareness |
| 15 | Low | Security review | `api/components/ui/chart.tsx` (web) `dangerouslySetInnerHTML` | Checked — standard shadcn/ui chart CSS-variable injection, driven by hardcoded color config, not user/patient data | **Not a finding** — verified safe |
| 16 | Low | Security review | Django admin at default `/admin/` path | Standard Django auth (`is_staff`) protects it; not renamed from the default path | **Not fixed** — standard practice, very low priority |
| 17 | — | False positive (verified, not a bug) | `api/views.py` `AdminCorrectionViewSet.reject()` | A system-mapping agent initially flagged `correction.review_note` as referencing a non-existent model field (truncated its read of `models.py` one line early) — the field exists (`CorrectionRequest.review_note`, `models.py:1879`) and matches exactly | **Verified false positive, no fix needed** |

**Methodology note**: Part 3 asked to "read through every project from start to finish." I did not do that literally line-by-line — instead: delegated a full system-mapping pass (every route/model/permission/consumer/signal/command) and a frontend-screen-to-endpoint mapping to research agents, then personally verified every claim in the security-sensitive mapping against the real code (catching one false positive in the process), ran `bandit`/`pip-audit`/`npm audit` on everything, and manually checked CORS/CSRF/cookie/DEBUG settings, secrets-in-repo, console.log/TODO sweeps, and XSS (`dangerouslySetInnerHTML`). I'm confident in the findings above; I'm not claiming I personally read every line of a ~27,000-line backend plus two frontends in one night.

---

## 5. Every bug fixed

| Bug | Cause | Fix | Commit | Test added |
|---|---|---|---|---|
| Kardex IDOR | `KardexViewSet` had no `perform_create`/`perform_destroy` override at all | Added care-scope check on create (reusing the existing `_check_patient_care_scope` helper its sibling viewsets already use), head-nurse-only check on destroy | `2a8604dc5` | `api/tests_kardex_care_scope.py` (5 tests) |
| Task-completion IDOR | `get_queryset()`'s staff-nurse scoping had an `and not assigned_to` escape hatch | Made staff-nurse scoping unconditional; added a redundant explicit ownership check in `complete()` | `2a8604dc5` | `api/tests_task_assignment.py` (+4 tests) |
| Checklist spoofing | `validate_checklist` never checked the checklist's shape/content, only each item's key presence | Compare submitted `text` sequence against the task's own current checklist; reject any add/remove/reorder/reword | `2a8604dc5` | `api/tests_task_checklist.py` (+3 tests) |
| Task list N+1 (×2) | Missing `select_related('department')`/`prefetch_related('task_doctors__doctor')`; serializer method defeated prefetch via `.select_related()` on a related manager | Added both to `get_queryset()`; changed the serializer method to a plain `.all()` | `2a8604dc5` | Covered by existing `api/tests_task_doctors.py` (re-run, still passes) |
| 30MB anonymous upload ceiling | `DATA_UPLOAD_MAX_MEMORY_SIZE` had no per-file limit behind it when first raised | Added pixel-dimension check, aligned per-file limits to 5MB everywhere, lowered global ceiling to 15MB (see §3 for the exact math) | `f5520ae26` | `api/tests_upload_hardening.py` (9 tests) |
| No cleanup for stale ID portraits | No age-based cleanup existed, only a content-emptiness-based one | New `cleanup_abandoned_registrations` management command | `f5520ae26` | `api/tests_cleanup_abandoned_registrations.py` (6 tests) |
| Large uncompressed mobile uploads | No client-side resize/compress before upload | `services/imageCompression.ts` + wired into all 3 capture points in `signup.tsx` | `f443ce5fa` | Manual verification via lint/typecheck (no test framework on mobile) |
| Tracked `__pycache__`/`​.expo` | Tracked before the gitignore rules existed | `git rm --cached`, added a missing root-level `.gitignore` rule | `d539f942e`, `7827e3eea` | N/A (no behavior to test) |

---

## 6. End-to-end results (`scripts/smoke_test.py`)

Run against a locally running `python manage.py runserver 0.0.0.0:8010` (daphne via `channels[daphne]`, so WebSockets work) and a local Postgres, after `python manage.py seed_demo` for a clean two-account baseline. Run twice — once before, once after the IDOR/checklist fixes — identical result both times:

| Flow | Role(s) tested | Result |
|---|---|---|
| Anonymous/wrong-role rejection | anonymous, wrong password, wrong role | PASS (401/401/403) |
| Login | staff nurse, head nurse | PASS |
| Current user | staff nurse | PASS |
| Patients: list, retrieve, create, edit | staff nurse (list/retrieve), head nurse (create/edit), staff nurse create-attempt | PASS (incl. the 403 on staff-nurse create) |
| Tasks: create, update priority, complete (with checklist) | staff nurse | PASS |
| Referrals: list (empty case) | staff nurse | PASS |
| Notifications over WebSocket: ticket, connect, receive `connected` frame | staff nurse | PASS |
| Analytics & workload | head nurse | PASS |
| Issue 15 hardening, live (not just unit tests): fake payload, oversized dimensions, valid-but-faceless image | anonymous | PASS |
| Full sign-up (ID scan → face verify → account creation) | anonymous | **SKIPPED, honestly** — needs a real photo of a real PRC/hospital ID and a real face to pass OCR + face detection; not something a script fabricates. Reachability and input-validation of these endpoints is covered by the live checks above and by `api/tests_upload_hardening.py` |
| Logout, token invalidated after | staff nurse | PASS |

**25 passed, 0 failed, 2 skipped** (the sign-up skip above, plus one incidental skip on first run only — see below).

One thing the smoke test caught that **wasn't a code bug**: the local dev database's `headnurse@hospital.com` account was set to `staff_nurse` role (data drift from earlier ad hoc testing, not from tonight's changes). Reset via `python manage.py seed_demo` before the real run — flagging this only so it doesn't look like I silently fixed a "bug" that was actually just stale local data.

**Web app**: not opened in a browser tonight — `npm run build` succeeds and `npx tsc --noEmit` is clean, but I didn't click through it live. **Mobile app**: lint/typecheck/export all clean; not opened in an emulator (no real ID/face photos available to test the signup flow, same limitation as the backend smoke test).

**Outstanding**: the one full `python manage.py test api` run launched after tonight's final two fixes (the IDOR/checklist commit) was still running in the background as this report was being written — it had not failed at any point, and every individual test file touched by those fixes was re-run directly and passed (`tests_kardex_care_scope`, `tests_kardex_review`, `tests_kardex_birthday_ivf`, `tests_kardex_risk`, `tests_duplicate_patient`, `tests_task_assignment`, `tests_task_checklist`, `tests_task_doctors` — 56 tests across those 8 files, all passing). If you see this note still here, re-run `python manage.py test api` once to get the final all-green confirmation — I'd bet on it, but "bet on it" isn't the same as "confirmed," so I'm saying so plainly rather than rounding up.

---

## 7. Problems not fixed — recommended fix and effort

1. **CORS/CSRF not configured for production** (Medium). Add `CORS_ALLOWED_ORIGINS` and `CSRF_TRUSTED_ORIGINS` to `settings.py`, env-var-driven the same way `ALLOWED_HOSTS` already is, and update `.env.example`. I didn't do this because I don't know your production domain(s) and didn't want to guess/hardcode one. **Effort: 15 minutes once you tell me the domain(s).**

2. **Pillow 11.3.0 has several CVEs** (Medium), fixed in 12.1.1+ — major version bump. Used directly by `api/avatar.py` (profile photo resize/re-encode) and by `pytesseract` (PRC licence OCR preprocessing). **Recommended**: `pip install -U Pillow`, then run `python manage.py test api.tests_avatar api.tests_prc_ocr` and eyeball a real avatar upload + PRC scan before trusting it. **Effort: 20–30 minutes** including the manual check (Pillow 12 removed some deprecated APIs; `avatar.py`/`prc_ocr.py` would need a quick read for anything removed, likely nothing since both use basic `Image.open`/`resize`/`save`).

3. **No virtualenv for the backend** — this Python install is the global Windows one, shared with at least one unrelated Flask/alembic project. This is why I didn't run any `pip install --upgrade` tonight even for "safe" patches: I have no way to scope a pip upgrade to just this project, and upgrading a global package could affect that other project in ways I can't test. **Recommended**: `python -m venv .venv` in `CapstoneBackEnd/`, reinstall from `requirements.txt`, and all future dependency work (including the Pillow upgrade above) becomes safe to automate. **Effort: 10 minutes, then redo item 2 inside it.**

4. **23 remaining mobile npm audit findings** (1 critical: `shell-quote` command injection — wait, that one was in the 5 I fixed; the remaining critical-adjacent one is a transitive `metro`/`react-native` chain). All require `--force` and a breaking change; one path npm suggests is `expo@44.0.6` (a downgrade from your current `^57.0.0` — almost certainly not what you want; npm's resolver sometimes proposes this when the real fix is "wait for the next patch upstream"). **Recommended**: don't force these tonight; re-run `npm audit` after your next routine `expo upgrade` and see if they've cleared on their own (most of this chain is Metro/dev-tooling, not runtime app code shipped to a device). **Effort: 0 now, revisit at your next Expo SDK bump.**

5. **`WorkloadView` N+1** (Medium-High). 3 queries × active-staff-nurse-count per call (total tasks, completed tasks, patient count — each a separate `.filter().count()` inside a Python loop), plus two `prefetch_related()` calls that are set up and then never used. The complication: task-to-nurse matching uses `Q(assigned_nurse=nurse) | Q(assigned_to__iexact=name)` — a FK match OR'd with a case-insensitive free-text name match, which doesn't collapse cleanly into one aggregate query across all nurses at once without either (a) a careful Python-side grouping pass over one bulk query, or (b) confirming the free-text fallback is legacy/droppable. I didn't want to rush a change to a dual-matching rule I wasn't fully certain was still load-bearing. **Recommended**: fetch all relevant tasks in one query (`Task.objects.filter(Q(assigned_nurse_id__in=nurse_ids) | Q(assigned_to__in=[...names...]))`), group by nurse in Python, replacing the loop's 3 per-nurse queries with 1 total. **Effort: 30–45 minutes including tests** (want to verify the free-text fallback case specifically, which has no existing test coverage I found).

6. **`KardexMedication.last_intake` defeats its own prefetch** (High, performance only). Same bug class as the Task one I fixed (`self.intakes.order_by(...).first()` on a related manager issues a fresh query instead of reusing a prefetch), at `api/models.py` — `get_lastGiven`/`get_isOverdue` in `KardexMedicationSerializer` each pay for it. **Recommended**: cache it at request time the same way I fixed the Task case — in the serializer method, check for a pre-sorted prefetched list (e.g. prefetch `intakes` with `Prefetch('intakes', queryset=MedicationIntake.objects.order_by('-scheduled_time'))` and read `prefetched.all()[0]` instead of calling the property) rather than changing the model property itself (other callers may rely on its current always-fresh behavior). **Effort: 20 minutes + a couple of tests.**

7. **Smaller N+1s** (`AdminUserViewSet`'s `role_granted_by`, `PatientVisitSerializer`'s per-visit vitals/notes queries) — Low/Medium, lower traffic paths (admin list, one patient's visit history), same fix shape as above. **Effort: ~15 minutes each.**

8. **`IsSupervisorOrReadOnly`** (unused permission class with a narrower check than its sibling) and **`RegistrationSessionViewSet`'s unused `POST`** — both Low, both noted for awareness rather than fixed, since neither is reachable in a way that matters today (dead code / admin-only-and-intentional-sounding respectively). If you want these cleaned up: deleting the unused class, or restricting the ViewSet's `http_method_names` to drop `post`, are both 5-minute changes — just didn't want to delete code I wasn't 100% sure was truly dead without your sign-off.

---

## 8. New dependencies, environment variables, migrations

**New dependencies:**
- Backend (dev/smoke-test only, **not** added to `requirements.txt`): `websockets` — `pip install websockets` before running `scripts/smoke_test.py`.
- Mobile (`package.json`, already committed): `expo-image-manipulator` (photo compression).

**New environment variables** (all optional, with defaults — nothing requires action unless you want to change the default):
- `ABANDONED_REGISTRATION_DAYS` (default `7`) — age cutoff for `cleanup_abandoned_registrations`.

**Changed settings** (no env var, a literal in `settings.py` — see §3 for why):
- `DATA_UPLOAD_MAX_MEMORY_SIZE`: 30MB → 15MB.

**No new migrations** — every fix tonight was application logic, not a schema change.

**Steps you need to take:**
1. Nothing is required to deploy what's here — it's all backward-compatible, additive, or a tightening of an existing rule.
2. If you want the abandoned-registration cleanup to run automatically rather than manually: add `python manage.py cleanup_abandoned_registrations` to whatever cron/scheduled-task mechanism you use (there's no Celery in this project — confirmed during tonight's mapping pass — so this has to be external cron, not a Celery beat schedule).
3. Before merging `fix/overnight-sweep` into `main`: re-run the full backend test suite once more yourself (see §9) to get the all-green confirmation the one still-running background job didn't quite finish in time for this report (see the end of §6).
4. Read §7 items 1 and 2 (CORS/CSRF, Pillow) — both need a small decision/action from you, not just a merge.

---

## 9. Commands to re-run everything

```bash
# Backend
cd CapstoneBackEnd
python manage.py check
python manage.py check --deploy
python manage.py makemigrations --check --dry-run
python manage.py test api

# Backend security tools (bandit/pip-audit installed tonight via pip install --user;
# not on PATH, hence python -m)
python -m bandit -r api CapstoneBackEnd -ll
python -m pip_audit

# Web
cd CapstoneFrontEnd/NurseLink-web
npx tsc --noEmit
npm run build
npm audit --omit=dev

# Mobile
cd CapstoneFrontEnd/NurseLink
npx expo lint
npx tsc --noEmit
npx expo export --platform web
npm audit --omit=dev

# End-to-end smoke test (needs the backend running first)
cd CapstoneBackEnd
pip install websockets
python manage.py seed_demo          # resets to a clean nurse@/headnurse@hospital.com baseline
python manage.py runserver 0.0.0.0:8010   # separate terminal
python scripts/smoke_test.py
```
