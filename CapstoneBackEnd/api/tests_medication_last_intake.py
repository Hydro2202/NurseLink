"""
KardexMedication.last_intake — an N+1 fix changed this from
self.intakes.order_by('-scheduled_time').first() to a plain self.intakes.all()
(so it reuses a prefetch_related('intakes') cache instead of silently
bypassing it with a fresh query). MedicationIntake.Meta.ordering is already
'-scheduled_time', so the result must be identical either way — these tests
pin that, both at the model level and through the real API (which prefetches).
"""

import datetime

from django.contrib.auth.models import User
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from .models import KardexMedication, MedicationIntake, NurseProfile, Patient


def make_nurse(email='nurse@hospital.com'):
    user = User.objects.create_user(username=email, email=email, password='pw-test-1234',
                                     first_name='Ana', last_name='Cruz')
    NurseProfile.objects.create(user=user, role='staff_nurse', department='ICU',
                                 approval_status='approved', is_active_staff=True)
    return user


class LastIntakePropertyTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.nurse = make_nurse()
        self.patient = Patient.objects.create(
            patient_code='P980', name='Juan Dela Cruz', age=61, gender='Male',
            room='204-B', diagnosis='CHF', admission_date=datetime.date(2026, 3, 2),
            risk_level='medium', attending_physician='Dr. Lim', assigned_nurse=self.nurse,
        )
        self.medication = KardexMedication.objects.create(
            patient=self.patient, medication_name='Furosemide', dose='40mg',
            start_date=datetime.date(2026, 3, 2), created_by=self.nurse,
        )

    def test_last_intake_is_the_most_recent_without_a_prefetch(self):
        now = timezone.now()
        MedicationIntake.objects.create(
            medication=self.medication, scheduled_time=now - datetime.timedelta(hours=12),
            administered_by=self.nurse,
        )
        newest = MedicationIntake.objects.create(
            medication=self.medication, scheduled_time=now - datetime.timedelta(hours=1),
            administered_by=self.nurse,
        )
        MedicationIntake.objects.create(
            medication=self.medication, scheduled_time=now - datetime.timedelta(hours=6),
            administered_by=self.nurse,
        )
        fresh = KardexMedication.objects.get(pk=self.medication.pk)
        self.assertEqual(fresh.last_intake.pk, newest.pk)

    def test_last_intake_is_the_most_recent_with_a_prefetch(self):
        now = timezone.now()
        MedicationIntake.objects.create(
            medication=self.medication, scheduled_time=now - datetime.timedelta(hours=12),
        )
        newest = MedicationIntake.objects.create(
            medication=self.medication, scheduled_time=now - datetime.timedelta(hours=1),
        )
        prefetched = KardexMedication.objects.prefetch_related('intakes').get(pk=self.medication.pk)
        self.assertEqual(prefetched.last_intake.pk, newest.pk)

    def test_no_intakes_at_all_returns_none(self):
        self.assertIsNone(self.medication.last_intake)
        prefetched = KardexMedication.objects.prefetch_related('intakes').get(pk=self.medication.pk)
        self.assertIsNone(prefetched.last_intake)

    def test_lastGiven_through_the_real_api_reflects_the_most_recent_intake(self):
        now = timezone.now()
        MedicationIntake.objects.create(
            medication=self.medication, scheduled_time=now - datetime.timedelta(hours=12),
            administered_at=now - datetime.timedelta(hours=12),
        )
        newest_time = now - datetime.timedelta(hours=1)
        MedicationIntake.objects.create(
            medication=self.medication, scheduled_time=newest_time, administered_at=newest_time,
        )

        self.client.force_authenticate(self.nurse)
        response = self.client.get(f'/api/kardex-medications/?patientId={self.patient.patient_code}')
        self.assertEqual(response.status_code, 200, response.content)
        row = next(r for r in response.data if r['id'] == self.medication.pk)
        # response.data holds pre-render Python objects (not yet JSON-encoded
        # strings), so this is a real datetime — compare to the second to
        # avoid a microsecond-rounding flake.
        self.assertEqual(row['lastGiven'].replace(microsecond=0), newest_time.replace(microsecond=0))
