You are working on NurseLink, my nursing capstone app.
- Backend: Django/DRF in `CapstoneBackEnd/` (app code in `CapstoneBackEnd/api/`), deployed on Render (https://nurselink.onrender.com).
- Frontend: `CapstoneFrontEnd/NurseLink/` (Expo/React Native web) and `CapstoneFrontEnd/NurseLink-web/`, deployed on Vercel (https://nurse-link-three.vercel.app). Check which frontend the live Vercel project builds, and update both if they share the affected screens.

Fix every issue below in both the backend and the frontend. Before you change anything, read the relevant models, serializers, views and screens so you understand how they work now. Don't break existing features.

## 1. Phone number from sign-up must show in the profile
The user enters a phone number during sign-up (there is already a `phone_number` field, migration 0056). Right now it doesn't show in the user's profile.
- Make sure sign-up saves it to the account/NurseProfile.
- Return it from the profile/"me" API.
- Display it on the profile screen and in the profile edit modal (`ProfileEditModal.tsx`).

## 2. Middle name must show everywhere
If a user enters a middle name at sign-up, their full name (First Middle Last) must appear everywhere a name is shown:
- their own profile and dashboard header
- head nurse screens (nurse lists, Team, task/patient assignment pickers, duty roster)
- admin screens (Accounts, Registrations, Overview)
- nurse screens (handovers, referrals, task assignees, etc.)

Make sure the middle name is saved from sign-up to the user/profile. Add a single `full_name` (or similar) field in the serializers and use it consistently on the frontend instead of building `first_name + last_name` by hand.

## 3. Assign Nurse picker: only show a shift if the nurse actually has a duty
In the head nurse "Assign Nurse" dialog (task/patient assignment, e.g. `TaskAssignmentModal.tsx`, `NurseAssignModal.tsx`, `AssignPatientModal.tsx`), every nurse shows "RN • morning shift" even if they have no duty assigned. "Morning" is just a default value.
- All nurses should still appear in the list by name, even with no duty.
- Show the shift (and department) ONLY when the nurse has a real active duty assignment (from the Duty model/roster). If there is no duty, show just "Name — RN" with no shift.
- Remove the "morning" default wherever it gets filled in: backend serializer/model default and frontend fallback.

## 4. Referrals must be visible only to the receiving nurse
At the moment, every nurse account can see a new referral. Change it so that:
- A referral is visible only to the nurse it was sent to (the receiver), plus the nurse who created it (sender view), plus head nurse/admin if they already have oversight.
- Only the receiving nurse can accept or decline it.
- Enforce this in the backend queryset/permissions (not only in UI filtering), including list, detail and accept endpoints, any realtime/websocket broadcasts and notifications. Other nurses must get 403/404.
- Add or update tests in `tests_referral_workflow.py`.

## 5. Admin Registrations: remove PRC/face fields and show only sign-up info
The Registrations detail panel still shows face-verification items: Face verified, Face attempts, Face locked, ID name, ID registration #, ID verification status and the "Face Verification Attempts" section. Remove all of them from the UI and from the API response.
- Show only what the user entered at sign-up: first, middle and last name, email, phone number, role, department (if any), verification method / OTP verified, linked account, and created/updated dates.
- NEVER show the password or its hash.
- Also remove "0 face attempts" from the registration list rows.

## 6. Deleting in Registrations must fully delete the account
When the admin deletes a registration, the linked user account must also be deleted. That includes the User, NurseProfile, sessions/tokens, duty assignments and anything else that would block re-registration.
- Right now, after deleting, signing up again with the same email fails with "email already exists". Fix it so the email can be reused right away.
- Check every place uniqueness is checked: User.email, RegistrationSession, OTP records and `email_validation.py`.
- The deleted account must disappear from Admin → Accounts at once, and deleting from Accounts should also remove the registration.
- Use a transaction. Handle foreign keys carefully: keep clinical records such as charting notes, but null out or reassign references so nothing crashes.

## 7. Overview and Trends must exclude deleted accounts
Admin Overview counts and Trends charts still include deleted/removed accounts. Update the queries so removed accounts are not counted anywhere: totals, per-role counts and time-series trends.

## 8. Team: department follows the head nurse's duty assignment
When the head nurse assigns a nurse's duty and department (`DutyAssignmentModal.tsx`), the Team page must show that department automatically. When the head nurse changes the department, Team must update to match. Make Team read the department from the current duty assignment (single source of truth) or keep the profile in sync when a duty is saved/changed. Realtime updates are a plus.

## Testing and deployment requirements
1. Create and run any new migrations (`python manage.py makemigrations` + `migrate`) and make sure no migration conflicts exist.
2. Run the full backend test suite (`python manage.py test api`) and fix every failure. Add tests for issues 3, 4, 6 and 7.
3. Run frontend typecheck, lint and build for the deployed frontend(s) with no errors.
4. Test each fix end to end, briefly: sign up with a middle name and phone number → check the profile, head nurse and admin screens; send a referral and log in as a different nurse to confirm it's hidden; delete a registration, then re-register with the same email; check Overview/Trends counts; assign and change a duty department and check Team.
5. Commit with clear messages and push to the branch Vercel and Render deploy from, so both deployments rebuild. Confirm the Render deploy runs migrations, then verify the live sites work.
6. Finally, give me a summary listing what changed, which files changed, the test results and anything I need to do manually (e.g. env vars, a Render redeploy).
