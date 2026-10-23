"""
Verified identity is locked after approval. Nurses cannot change their name,
licence number, login email or clinical role on their own. Email changes need a
code sent to the new address. Other changes need an admin, who acts on a
correction request.
"""

from datetime import timedelta

from django.contrib.auth.models import User
from django.core import mail
from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from .auth_sessions import issue_session
from .identity import hash_code
from .models import AuthSession, CorrectionRequest, EmailChangeRequest, NurseProfile
from .models import ClinicalRole

PASSWORD = 'pw-test-1234'


def make_nurse(email='ana@hospital.com', first='Ana', last='Cruz', clinical='RN', license_no='LIC-1'):
    user = User.objects.create_user(username=email, email=email, password=PASSWORD,
                                    first_name=first, last_name=last)
    NurseProfile.objects.create(user=user, role='staff_nurse', department='ICU',
                                approval_status='approved', is_active_staff=True,
                                clinical_role=clinical, license_number=license_no)
    return user


def make_admin():
    return User.objects.create_user(username='admin@hospital.com', email='admin@hospital.com',
                                    password='pw-admin-1234', is_staff=True)


@override_settings(SIGNUP_ID_FACE_VERIFICATION=True)
class LockedFieldTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = make_nurse()
        self.client.force_authenticate(self.user)

    def assert_locked(self, payload, field):
        res = self.client.patch('/api/auth/me/', payload, format='json')
        self.assertEqual(res.status_code, 400, res.content)
        self.assertEqual(res.data['code'], 'field_locked')
        self.assertIn(field, res.data['fields'])

    def test_changing_licence_number_is_refused_and_not_saved(self):
        self.assert_locked({'licenseNumber': 'FAKE-999'}, 'licenseNumber')
        self.assertEqual(NurseProfile.objects.get(user=self.user).license_number, 'LIC-1')

    def test_changing_name_is_refused_and_not_saved(self):
        self.assert_locked({'name': 'Head Nurse Admin'}, 'name')
        self.user.refresh_from_db()
        self.assertEqual(self.user.first_name, 'Ana')

    def test_changing_clinical_role_is_refused(self):
        self.assert_locked({'clinicalRole': 'Chief Everything'}, 'clinicalRole')
        self.assertEqual(NurseProfile.objects.get(user=self.user).clinical_role, 'RN')

    def test_changing_login_email_is_refused_without_a_code(self):
        self.assert_locked({'email': 'other@hospital.com'}, 'email')
        self.user.refresh_from_db()
        self.assertEqual(self.user.email, 'ana@hospital.com')
        self.assertEqual(self.user.username, 'ana@hospital.com')

    def test_sending_the_same_values_is_accepted(self):
        res = self.client.patch('/api/auth/me/', {
            'licenseNumber': 'LIC-1', 'clinicalRole': 'RN', 'firstName': 'Ana',
        }, format='json')
        self.assertEqual(res.status_code, 200, res.content)

    def test_allowed_fields_still_work(self):
        res = self.client.patch('/api/auth/me/', {'specialization': 'Cardiac'}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(NurseProfile.objects.get(user=self.user).specialization, 'Cardiac')


@override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend',
                   ALLOW_CONSOLE_OTP=False, EMAIL_HOST='smtp.test', DEFAULT_FROM_EMAIL='no-reply@test')
@override_settings(SIGNUP_ID_FACE_VERIFICATION=True)
class EmailChangeTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = make_nurse()
        self.key = issue_session(self.user).key
        self.other_device = issue_session(self.user).key
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.key}')

    def start(self, **extra):
        payload = {'newEmail': 'new@hospital.com', 'password': PASSWORD, **extra}
        return self.client.post('/api/auth/email-change/', payload, format='json')

    def code_from_mail(self):
        body = next(m.body for m in mail.outbox if m.to == ['new@hospital.com'])
        return [w for w in body.split() if w.isdigit() and len(w) == 6][0]

    def test_nothing_changes_until_the_code_is_confirmed(self):
        res = self.start()
        self.assertEqual(res.status_code, 202, res.content)
        self.user.refresh_from_db()
        self.assertEqual(self.user.email, 'ana@hospital.com')

    def test_code_goes_to_new_address_and_notice_to_old(self):
        self.start()
        recipients = [m.to[0] for m in mail.outbox]
        self.assertIn('new@hospital.com', recipients)
        self.assertIn('ana@hospital.com', recipients)

    def test_wrong_password_is_rejected(self):
        res = self.start(password='nope')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['code'], 'wrong_password')

    def test_email_already_in_use_is_rejected(self):
        make_nurse('taken@hospital.com')
        res = self.start(newEmail='taken@hospital.com')
        self.assertEqual(res.data['code'], 'email_in_use')

    def test_wrong_code_is_rejected(self):
        self.start()
        res = self.client.post('/api/auth/email-change/confirm/', {'code': '000000'}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['code'], 'invalid_code')
        self.user.refresh_from_db()
        self.assertEqual(self.user.email, 'ana@hospital.com')

    def test_expired_code_is_rejected(self):
        self.start()
        EmailChangeRequest.objects.update(expires_at=timezone.now() - timedelta(minutes=1))
        code = self.code_from_mail()
        res = self.client.post('/api/auth/email-change/confirm/', {'code': code}, format='json')
        self.assertEqual(res.data['code'], 'code_expired')

    def test_code_is_single_use(self):
        self.start()
        code = self.code_from_mail()
        self.assertEqual(self.client.post('/api/auth/email-change/confirm/', {'code': code},
                                          format='json').status_code, 200)
        self.assertEqual(self.client.post('/api/auth/email-change/confirm/', {'code': code},
                                          format='json').data['code'], 'no_pending_change')

    def test_correct_code_changes_email_and_revokes_other_sessions_only(self):
        self.start()
        code = self.code_from_mail()
        res = self.client.post('/api/auth/email-change/confirm/', {'code': code}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        self.user.refresh_from_db()
        self.assertEqual(self.user.email, 'new@hospital.com')
        self.assertEqual(self.user.username, 'new@hospital.com')
        # The device making the change stays signed in; the other one is out.
        self.assertTrue(AuthSession.objects.filter(key=self.key).exists())
        self.assertFalse(AuthSession.objects.filter(key=self.other_device).exists())

    def test_too_many_wrong_codes_locks_the_request(self):
        self.start()
        for _ in range(5):
            self.client.post('/api/auth/email-change/confirm/', {'code': '000000'}, format='json')
        res = self.client.post('/api/auth/email-change/confirm/', {'code': self.code_from_mail()},
                               format='json')
        self.assertEqual(res.data['code'], 'too_many_attempts')


@override_settings(SIGNUP_ID_FACE_VERIFICATION=True)
class CorrectionRequestTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = make_nurse()
        self.admin = make_admin()
        self.reason = 'Registered under my married name at the PRC.'

    def submit(self, **fields):
        self.client.force_authenticate(self.user)
        return self.client.post('/api/auth/corrections/',
                                {'reason': self.reason, **fields}, format='json')

    def test_submitting_a_correction_changes_nothing(self):
        res = self.submit(licenseNumber='LIC-NEW')
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(NurseProfile.objects.get(user=self.user).license_number, 'LIC-1')

    def test_a_non_admin_cannot_approve(self):
        correction = CorrectionRequest.objects.create(user=self.user, requested={'licenseNumber': 'LIC-NEW'},
                                                      reason=self.reason)
        self.client.force_authenticate(self.user)
        res = self.client.post(f'/api/admin/corrections/{correction.pk}/approve/')
        self.assertEqual(res.status_code, 403)
        self.assertEqual(NurseProfile.objects.get(user=self.user).license_number, 'LIC-1')

    def test_admin_approval_applies_the_change_and_records_who_and_when(self):
        correction = CorrectionRequest.objects.create(user=self.user, requested={'licenseNumber': 'LIC-NEW'},
                                                      reason=self.reason)
        self.client.force_authenticate(self.admin)
        res = self.client.post(f'/api/admin/corrections/{correction.pk}/approve/')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(NurseProfile.objects.get(user=self.user).license_number, 'LIC-NEW')
        correction.refresh_from_db()
        self.assertEqual(correction.status, 'approved')
        self.assertEqual(correction.reviewed_by, self.admin)
        self.assertIsNotNone(correction.reviewed_at)

    def test_admin_rejection_changes_nothing(self):
        correction = CorrectionRequest.objects.create(user=self.user, requested={'licenseNumber': 'LIC-NEW'},
                                                      reason=self.reason)
        self.client.force_authenticate(self.admin)
        res = self.client.post(f'/api/admin/corrections/{correction.pk}/reject/', {'reason': 'Not supported'},
                               format='json')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(NurseProfile.objects.get(user=self.user).license_number, 'LIC-1')

    def test_a_clinical_role_outside_the_four_is_rejected(self):
        res = self.submit(clinicalRole='Chief Everything')
        self.assertEqual(res.status_code, 400)
        self.assertIn('clinicalRole', res.data)

    def test_a_blocked_name_in_a_correction_is_rejected(self):
        res = self.submit(firstName='Head Nurse Admin', lastName='Cruz')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['code'], 'name_blocked')

    def test_one_pending_correction_at_a_time(self):
        self.submit(licenseNumber='LIC-NEW')
        res = self.submit(licenseNumber='LIC-NEWER')
        self.assertEqual(res.data['code'], 'correction_already_pending')

    def test_valid_clinical_roles_are_the_four_defined_values(self):
        self.assertEqual(set(ClinicalRole.values),
                         {'RN', 'LPN', 'Charge Nurse', 'Clinical Nurse Specialist'})


@override_settings(SIGNUP_ID_FACE_VERIFICATION=True)
class SignupNameTests(APITestCase):
    def test_signup_with_a_blocked_word_in_the_verified_name_is_rejected(self):
        import datetime
        import uuid

        from .models import RegistrationSession

        session = RegistrationSession.objects.create(
            session_id=uuid.uuid4(), face_verified=True, id_verification_status='verified', id_portrait='data:image/jpeg;base64,PORTRAIT',
            verification_method='face', id_last_name='ADMIN', id_first_name='HEAD NURSE',
            id_middle_name='', id_registration_no='1234567',
            id_registration_date=datetime.date(2025, 1, 1), id_valid_until=datetime.date(2029, 1, 1),
        )
        res = self.client.post('/api/auth/signup/', {
            'email': 'imposter@hospital.com', 'password': 'Str0ng-Pass-9012',
            'registrationSessionId': str(session.session_id),
        }, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['code'], 'name_blocked')
