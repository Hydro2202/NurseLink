"""
KardexViewSet must enforce the same care-scope rule PatientViewSet.update()
already does: a staff nurse may only save a kardex (which writes straight
onto the Patient row's own demographic/vitals fields) for a patient
assigned to them, and only a head nurse may delete a kardex record at all
— matching its sibling KardexLaboratoryViewSet/KardexMedicationViewSet.
Previously KardexViewSet had neither check, letting any approved nurse
overwrite or delete any patient's data through this endpoint.
"""

import datetime

from django.contrib.auth.models import User
from django.core.cache import cache
from rest_framework.test import APITestCase

from .models import KardexRecord, NurseProfile, Patient


def make_user(email, first, last, role):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234',
        first_name=first, last_name=last,
    )
    NurseProfile.objects.create(user=user, role=role, department='Med-Surg')
    return user


class KardexCareScopeTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.owner = make_user('owner@hospital.com', 'Ben', 'Diaz', 'staff_nurse')
        self.other_nurse = make_user('other@hospital.com', 'Cora', 'Reyes', 'staff_nurse')
        self.supervisor = make_user('sup@hospital.com', 'Maria', 'Santos', 'head_nurse')
        self.patient = Patient.objects.create(
            patient_code='P800', name='Juan Dela Cruz', age=61, gender='Male',
            room='204-B', diagnosis='CHF', admission_date=datetime.date(2026, 3, 2),
            risk_level='medium', attending_physician='Dr. Lim', assigned_nurse=self.owner,
        )

    def _payload(self, **overrides):
        payload = {
            'patientId': 'P800', 'lastName': 'Dela Cruz Hacked', 'firstName': 'Juan',
            'room': '204-B',
        }
        payload.update(overrides)
        return payload

    def test_the_assigned_nurse_can_save_a_kardex_for_their_own_patient(self):
        self.client.force_authenticate(user=self.owner)
        response = self.client.post('/api/kardex/', self._payload(), format='json')
        self.assertEqual(response.status_code, 201, response.content)

    def test_a_nurse_not_assigned_to_the_patient_cannot_save_a_kardex_for_it(self):
        self.client.force_authenticate(user=self.other_nurse)
        response = self.client.post('/api/kardex/', self._payload(), format='json')
        self.assertEqual(response.status_code, 403)
        # And the exploit this blocks: the patient's own row is untouched.
        self.patient.refresh_from_db()
        self.assertEqual(self.patient.name, 'Juan Dela Cruz')

    def test_a_head_nurse_can_save_a_kardex_for_any_patient(self):
        self.client.force_authenticate(user=self.supervisor)
        response = self.client.post('/api/kardex/', self._payload(), format='json')
        self.assertEqual(response.status_code, 201, response.content)

    def test_a_staff_nurse_cannot_delete_a_kardex_even_for_their_own_patient(self):
        kardex = KardexRecord.objects.create(
            patient=self.patient, last_name='Dela Cruz', first_name='Juan',
            room='204-B', saved_by=self.owner, saved_by_name='Ben Diaz',
        )
        self.client.force_authenticate(user=self.owner)
        response = self.client.delete(f'/api/kardex/{kardex.pk}/')
        self.assertEqual(response.status_code, 403)
        self.assertTrue(KardexRecord.objects.filter(pk=kardex.pk).exists())

    def test_a_head_nurse_can_delete_a_kardex(self):
        kardex = KardexRecord.objects.create(
            patient=self.patient, last_name='Dela Cruz', first_name='Juan',
            room='204-B', saved_by=self.owner, saved_by_name='Ben Diaz',
        )
        self.client.force_authenticate(user=self.supervisor)
        response = self.client.delete(f'/api/kardex/{kardex.pk}/')
        self.assertEqual(response.status_code, 204)
        self.assertFalse(KardexRecord.objects.filter(pk=kardex.pk).exists())
