"""
Panel feedback round: risk flag from new vitals, no past dates for task due
dates / new admissions, idle-based session timeout, "Respond Now" emergency
alerts, and encryption at rest for sensitive patient data.
"""

import datetime
from unittest.mock import patch

from django.contrib.auth.models import User
from django.db import connection
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from .duty_status import local_today
from .encryption import PREFIX, decrypt_str, encrypt_str
from .models import (
    AuthSession, ChartingNote, Department, DutyAssignment, Notification, NurseProfile, Patient,
)


def make_user(email, first, last, role='staff_nurse'):
    user = User.objects.create_user(username=email, email=email, password='Pw-test-1234', first_name=first, last_name=last)
    NurseProfile.objects.create(user=user, role=role, approval_status='approved', is_active_staff=True)
    return user


class Base(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.head = make_user('head@hospital.com', 'Maria', 'Santos', role='head_nurse')
        self.nurse = make_user('nurse@hospital.com', 'Ana', 'Cruz')
        self.dept = Department.objects.create(name='Cardiology Unit T')
        self.patient = Patient.objects.create(
            patient_code='P900', name='Juan Dela Cruz', age=60, gender='Male', room='301',
            diagnosis='CHF', admission_date=local_today(), assigned_nurse=self.nurse,
            department=self.dept, risk_level='low',
        )


class RiskFromNewVitalsTests(Base):
    def record(self, user, **vitals):
        self.client.force_authenticate(user)
        return self.client.post('/api/vital-signs/', {'patientId': 'P900', **vitals}, format='json')

    def test_abnormal_vitals_raise_the_risk_for_a_nurse_and_a_head_nurse(self):
        res = self.record(self.nurse, oxygenSaturation=88, heartRate=80)
        self.assertEqual(res.status_code, 201, res.content)
        self.patient.refresh_from_db()
        self.assertEqual(self.patient.risk_level, 'high')

        res = self.record(self.head, oxygenSaturation=80)
        self.assertEqual(res.status_code, 201, res.content)
        self.patient.refresh_from_db()
        self.assertEqual(self.patient.risk_level, 'critical')

    def test_normal_vitals_do_not_lower_a_deliberate_rating(self):
        Patient.objects.filter(pk=self.patient.pk).update(risk_level='high')
        self.record(self.nurse, heartRate=75, oxygenSaturation=98, temperature=36.8)
        self.patient.refresh_from_db()
        self.assertEqual(self.patient.risk_level, 'high')


class NoPastDatesTests(Base):
    def test_task_due_date_cannot_be_in_the_past(self):
        self.client.force_authenticate(self.head)
        yesterday = (local_today() - datetime.timedelta(days=1)).isoformat()
        res = self.client.post('/api/tasks/', {
            'title': 'Vitals', 'patientId': 'P900', 'dueDate': yesterday, 'dueTime': '10:00',
            'priority': 'medium', 'category': 'care', 'assignedTo': 'Ana Cruz',
        }, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn('dueDate', res.data)

        res = self.client.post('/api/tasks/', {
            'title': 'Vitals', 'patientId': 'P900', 'dueDate': local_today().isoformat(), 'dueTime': '23:59',
            'priority': 'medium', 'category': 'care', 'assignedTo': 'Ana Cruz',
        }, format='json')
        self.assertEqual(res.status_code, 201, res.content)

    def test_new_admission_cannot_be_dated_in_the_past(self):
        self.client.force_authenticate(self.nurse)
        res = self.client.post('/api/kardex/', {
            'lastName': 'Reyes', 'firstName': 'Lito', 'age': 40, 'gender': 'Male', 'room': '305',
            'admissionDate': (local_today() - datetime.timedelta(days=3)).isoformat(),
        }, format='json')
        self.assertEqual(res.status_code, 400, res.content)
        self.assertIn('admissionDate', res.data)


@override_settings(TOKEN_TTL_SECONDS=3600, TOKEN_MAX_AGE_SECONDS=7 * 86400)
class IdleSessionTimeoutTests(TestCase):
    def setUp(self):
        self.user = make_user('nurse@hospital.com', 'Ana', 'Cruz')
        self.session = AuthSession.objects.create(key='k' * 40, user=self.user)
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION='Token ' + 'k' * 40)

    def test_an_active_session_survives_past_the_idle_window_from_login(self):
        old = timezone.now() - datetime.timedelta(hours=5)
        AuthSession.objects.filter(pk=self.session.pk).update(created=old, last_used=timezone.now() - datetime.timedelta(minutes=10))
        self.assertEqual(self.client.get('/api/auth/me/').status_code, 200)

    def test_an_idle_session_expires(self):
        idle = timezone.now() - datetime.timedelta(hours=2)
        AuthSession.objects.filter(pk=self.session.pk).update(created=idle, last_used=idle)
        self.assertEqual(self.client.get('/api/auth/me/').status_code, 401)

    def test_use_refreshes_last_used(self):
        AuthSession.objects.filter(pk=self.session.pk).update(last_used=timezone.now() - datetime.timedelta(minutes=30))
        self.client.get('/api/auth/me/')
        self.session.refresh_from_db()
        self.assertLess((timezone.now() - self.session.last_used).total_seconds(), 60)


class EmergencyResponseTests(Base):
    def test_respond_now_alerts_assigned_on_duty_and_head_nurses(self):
        on_duty = make_user('onduty@hospital.com', 'Ben', 'Diaz')
        other_dept = make_user('elsewhere@hospital.com', 'Cara', 'Lim')
        DutyAssignment.objects.create(
            nurse=on_duty, department=self.dept, duty_date=local_today(), shift='morning',
            start_time=datetime.time(0, 0), end_time=datetime.time(23, 59),
        )
        DutyAssignment.objects.create(
            nurse=other_dept, department=Department.objects.create(name='ER T'), duty_date=local_today(),
            shift='morning', start_time=datetime.time(0, 0), end_time=datetime.time(23, 59),
        )
        second_head = make_user('head2@hospital.com', 'Lea', 'Tan', role='head_nurse')
        self.client.force_authenticate(self.head)
        res = self.client.post('/api/patients/P900/emergency/', {'message': 'SpO2 82%'}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        notified = set(
            Notification.objects.filter(event='emergency_response').values_list('recipient_id', flat=True)
        )
        self.assertEqual(notified, {self.nurse.pk, on_duty.pk, second_head.pk})
        note = Notification.objects.filter(event='emergency_response').first()
        self.assertEqual(note.notification_type, 'critical')
        self.assertEqual(res.data['notified'], 3)

    def test_admin_cannot_raise_an_emergency(self):
        admin = User.objects.create_user('admin@admin.com', 'admin@admin.com', 'x', is_staff=True)
        self.client.force_authenticate(admin)
        self.assertEqual(self.client.post('/api/patients/P900/emergency/').status_code, 403)


class EncryptionAtRestTests(Base):
    def raw(self, table, column, where_col, where_val):
        with connection.cursor() as cursor:
            cursor.execute(f'SELECT {column} FROM {table} WHERE {where_col} = %s', [where_val])
            return cursor.fetchone()[0]

    def test_patient_fields_are_ciphertext_in_the_database_and_plain_in_the_api(self):
        Patient.objects.filter(pk=self.patient.pk).update(address='12 Rizal St', allergies=['Penicillin'])
        self.assertTrue(self.raw('api_patient', 'address', 'patient_code', 'P900').startswith(PREFIX))
        self.assertTrue(self.raw('api_patient', 'diagnosis', 'patient_code', 'P900').startswith(PREFIX))
        self.assertTrue(self.raw('api_patient', 'allergies', 'patient_code', 'P900').startswith(PREFIX))

        self.client.force_authenticate(self.nurse)
        data = self.client.get('/api/patients/P900/').data
        self.assertEqual(data['diagnosis'], 'CHF')
        self.assertEqual(data['allergies'], ['Penicillin'])

    def test_charting_text_is_encrypted(self):
        ChartingNote.objects.create(
            note_code='C900', patient=self.patient, patient_name='Juan', nurse=self.nurse,
            nurse_name='Ana Cruz', timestamp=timezone.now(), content='Patient resting comfortably.',
        )
        self.assertTrue(self.raw('api_chartingnote', 'content', 'note_code', 'C900').startswith(PREFIX))
        self.assertEqual(ChartingNote.objects.get(note_code='C900').content, 'Patient resting comfortably.')

    def test_legacy_plaintext_still_reads(self):
        with connection.cursor() as cursor:
            cursor.execute("UPDATE api_patient SET address = 'Old plain address' WHERE patient_code = 'P900'")
        self.assertEqual(Patient.objects.get(pk=self.patient.pk).address, 'Old plain address')

    def test_roundtrip_and_wrong_key_never_crashes(self):
        token = encrypt_str('secret')
        self.assertNotEqual(token, 'secret')
        self.assertEqual(decrypt_str(token), 'secret')
        with override_settings(FIELD_ENCRYPTION_KEY='', FIELD_ENCRYPTION_FALLBACK_SECRET='different'):
            with patch('api.encryption.logger') as log:
                self.assertEqual(decrypt_str(token), '')
                log.error.assert_called_once()


class PatientFlowAnalyticsTests(Base):
    def test_admissions_discharges_and_status_counts(self):
        from .models import PatientVisit

        today = local_today()
        PatientVisit.objects.create(patient=self.patient, admission_date=today)
        discharged = Patient.objects.create(
            patient_code='P901', name='Ana Reyes', age=30, gender='Female', room='302',
            diagnosis='x', admission_date=today - datetime.timedelta(days=2), status='discharged',
        )
        PatientVisit.objects.create(
            patient=discharged, admission_date=today - datetime.timedelta(days=2),
            discharge_date=timezone.now(),
        )
        self.client.force_authenticate(self.head)
        window = {
            'start_date': (today - datetime.timedelta(days=3)).isoformat(),
            'end_date': (today + datetime.timedelta(days=1)).isoformat(),
        }
        data = self.client.get('/api/analytics/', window).data
        today_row = next(r for r in data['patientFlow'] if r['date'] == today.isoformat())
        self.assertGreaterEqual(today_row['admissions'], 1)
        self.assertEqual(today_row['discharges'], 1)
        statuses = {s['status']: s['value'] for s in data['patientStatus']}
        self.assertEqual(statuses['discharged'], 1)
        self.assertEqual(statuses['admitted'], 1)
        self.assertEqual(data['avgLengthOfStayDays'], 2.0)
