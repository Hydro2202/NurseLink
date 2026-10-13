"""
Sign-up details reaching the rest of the app, and admin deletes that really
remove an account:

- the phone number and middle name entered at sign-up show on the profile,
  and the middle name is part of the name every screen displays;
- the nurse picker only shows a shift when the nurse is on the Duty Roster;
- deleting in Registrations (any of a person's rows) or in Accounts removes
  the account and its registration rows, so the email can sign up again.
"""

import datetime

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from .duty_status import local_today
from .models import Department, DutyAssignment, NurseProfile, RegistrationSession, Task

PASSWORD = 'Str0ng!Passw0rd'


def make_nurse(email, first, last, middle='', role='staff_nurse', **profile):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234', first_name=first, last_name=last,
    )
    NurseProfile.objects.create(
        user=user, role=role, middle_name=middle, approval_status='approved',
        is_active_staff=True, **profile,
    )
    return user


def make_admin():
    return User.objects.create_user(
        username='admin@admin.com', email='admin@admin.com', password='pw-admin-1234', is_staff=True,
    )


def register(client, email, *, middle='Santos', phone='09171234567'):
    session = RegistrationSession.objects.create(
        email=email, otp_verified=True, verification_method='EMAIL_OTP',
    )
    return client.post('/api/auth/signup-v2/register/', {
        'lastName': 'Dela Cruz',
        'firstName': 'Juan',
        'middleName': middle,
        'role': 'staff_nurse',
        'personalEmail': email,
        'phone': phone,
        'password': PASSWORD,
        'confirmPassword': PASSWORD,
        'registrationSessionId': str(session.session_id),
    }, format='json')


class SignupDetailsOnProfileTests(APITestCase):
    def test_phone_and_middle_name_from_signup_show_on_profile(self):
        response = register(self.client, 'juan@hospital.com')
        self.assertEqual(response.status_code, 201, response.content)
        user = User.objects.get(email='juan@hospital.com')
        NurseProfile.objects.filter(user=user).update(approval_status='approved')
        user.refresh_from_db()

        self.client.force_authenticate(user)
        me = self.client.get('/api/auth/me/')
        self.assertEqual(me.status_code, 200, me.content)
        self.assertEqual(me.data['phoneNumber'], '09171234567')
        self.assertEqual(me.data['middleName'], 'Santos')
        self.assertEqual(me.data['name'], 'Juan Santos Dela Cruz')
        self.assertNotIn('password', me.data)

    def test_echoing_the_displayed_name_back_is_not_an_edit(self):
        nurse = make_nurse('ana@hospital.com', 'Ana', 'Reyes', middle='Lopez')
        self.client.force_authenticate(nurse)
        response = self.client.patch('/api/auth/me/', {'name': 'Ana Lopez Reyes'}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        nurse.refresh_from_db()
        # Not re-split into first="Ana", last="Lopez Reyes".
        self.assertEqual(nurse.last_name, 'Reyes')
        self.assertEqual(response.data['name'], 'Ana Lopez Reyes')


class MiddleNameEverywhereTests(APITestCase):
    def setUp(self):
        self.head = make_nurse('head@hospital.com', 'Maria', 'Santos', role='head_nurse')
        self.nurse = make_nurse('ben@hospital.com', 'Ben', 'Diaz', middle='Cruz')

    def test_nurse_list_workload_and_admin_accounts_show_middle_name(self):
        self.client.force_authenticate(self.head)
        nurses = self.client.get('/api/nurses/')
        self.assertIn('Ben Cruz Diaz', [n['name'] for n in nurses.data])
        workload = self.client.get('/api/workload/')
        self.assertIn('Ben Cruz Diaz', [n['nurseName'] for n in workload.data])
        # Searching by middle name finds the nurse too.
        found = self.client.get('/api/nurses/', {'search': 'Cruz'})
        self.assertEqual([n['name'] for n in found.data], ['Ben Cruz Diaz'])

        self.client.force_authenticate(make_admin())
        accounts = self.client.get('/api/admin/users/')
        self.assertIn('Ben Cruz Diaz', [a['name'] for a in accounts.data])

    def test_task_assigned_by_full_name_still_belongs_to_the_nurse(self):
        Task.objects.create(task_code='T900', title='Old style', assigned_to='Ben Diaz')
        Task.objects.create(task_code='T901', title='New style', assigned_to='Ben Cruz Diaz')
        self.client.force_authenticate(self.nurse)
        response = self.client.get('/api/tasks/')
        rows = response.data.get('results', response.data) if isinstance(response.data, dict) else response.data
        titles = {t['title'] for t in rows}
        self.assertTrue({'Old style', 'New style'} <= titles, titles)


class NursePickerShiftTests(APITestCase):
    def setUp(self):
        self.head = make_nurse('head@hospital.com', 'Maria', 'Santos', role='head_nurse')
        # Profile still carries the old 'morning' default -- must not show.
        self.idle = make_nurse('idle@hospital.com', 'Ida', 'Le', shift='morning')
        self.rostered = make_nurse('duty@hospital.com', 'Dan', 'Uty', shift='')
        icu = Department.objects.create(name='ICU')
        DutyAssignment.objects.create(
            nurse=self.rostered, department=icu, duty_date=local_today(), shift='night',
            start_time=datetime.time(23, 0), end_time=datetime.time(7, 0),
        )
        self.client.force_authenticate(self.head)

    def test_shift_shown_only_for_nurses_with_a_duty(self):
        rows = {n['email']: n for n in self.client.get('/api/nurses/').data}
        # Every nurse is still listed by name.
        self.assertIn('idle@hospital.com', rows)
        self.assertEqual(rows['idle@hospital.com']['shift'], '')
        self.assertFalse(rows['idle@hospital.com']['hasDuty'])
        self.assertEqual(rows['duty@hospital.com']['shift'], 'night')
        self.assertEqual(rows['duty@hospital.com']['department'], 'ICU')
        self.assertTrue(rows['duty@hospital.com']['hasDuty'])

    def test_cancelled_duty_does_not_count(self):
        DutyAssignment.objects.filter(nurse=self.rostered).update(status='cancelled')
        rows = {n['email']: n for n in self.client.get('/api/nurses/').data}
        self.assertEqual(rows['duty@hospital.com']['shift'], '')

    def test_own_profile_shift_follows_the_roster(self):
        self.client.force_authenticate(self.idle)
        self.assertEqual(self.client.get('/api/auth/me/').data['shift'], '')
        self.client.force_authenticate(self.rostered)
        self.assertEqual(self.client.get('/api/auth/me/').data['shift'], 'night')


class AdminDeleteRemovesAccountTests(APITestCase):
    def setUp(self):
        self.admin = make_admin()

    def _signed_up(self, email):
        response = register(self.client, email)
        self.assertEqual(response.status_code, 201, response.content)
        return User.objects.get(email=email)

    def test_deleting_an_unlinked_registration_row_still_removes_the_account(self):
        # First attempt abandoned (row never linked to an account), second
        # attempt completed -- the admin deletes the first row.
        abandoned = RegistrationSession.objects.create(email='juan@hospital.com')
        user = self._signed_up('juan@hospital.com')

        self.client.force_authenticate(self.admin)
        response = self.client.delete(f'/api/admin/registration-sessions/{abandoned.pk}/')
        self.assertEqual(response.status_code, 204, response.content)
        self.assertFalse(User.objects.filter(pk=user.pk).exists())
        self.assertFalse(RegistrationSession.objects.filter(email='juan@hospital.com').exists())
        accounts = self.client.get('/api/admin/users/')
        self.assertNotIn('juan@hospital.com', [a['email'] for a in accounts.data])

        # The same email can sign up again straight away.
        self.client.force_authenticate(None)
        again = register(self.client, 'juan@hospital.com')
        self.assertEqual(again.status_code, 201, again.content)

    def test_deleting_in_accounts_also_clears_registrations(self):
        user = self._signed_up('juan@hospital.com')
        self.client.force_authenticate(self.admin)
        response = self.client.delete(f'/api/admin/users/{user.pk}/')
        self.assertEqual(response.status_code, 204, response.content)
        self.assertFalse(User.objects.filter(pk=user.pk).exists())
        self.assertFalse(RegistrationSession.objects.filter(email='juan@hospital.com').exists())

    def test_admin_accounts_are_never_deleted_by_email_match(self):
        session = RegistrationSession.objects.create(email='admin@admin.com')
        self.client.force_authenticate(self.admin)
        response = self.client.delete(f'/api/admin/registration-sessions/{session.pk}/')
        self.assertEqual(response.status_code, 204)
        self.assertTrue(User.objects.filter(pk=self.admin.pk).exists())

    def test_registration_detail_has_signup_info_only(self):
        self._signed_up('juan@hospital.com')
        self.client.force_authenticate(self.admin)
        rows = self.client.get('/api/admin/registration-sessions/').data
        rows = rows.get('results', rows) if isinstance(rows, dict) else rows
        row = rows[0]
        self.assertEqual(row['phone'], '09171234567')
        self.assertEqual(row['fullName'], 'Juan Santos Dela Cruz')
        for hidden in ('faceAttempts', 'faceVerified', 'faceLocked', 'idFirstName',
                       'idRegistrationNo', 'idVerificationStatus', 'prcFullName', 'password'):
            self.assertNotIn(hidden, row)
