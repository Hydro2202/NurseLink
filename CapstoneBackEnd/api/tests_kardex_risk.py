"""
Kardex-derived patient risk level and allergies.

risk_level used to be hardcoded to 'low' for every patient a kardex
registered, regardless of their actual vital signs — assess_risk_level
replaces that with a real (if simple, threshold-based) read of whichever
vitals were actually filled in. These tests pin both the classification
itself and the "only judge what was filled in" rule, plus that allergies
entered on a kardex actually reach the Patient record.
"""

import datetime

from django.contrib.auth.models import User
from django.core.cache import cache
from rest_framework.test import APITestCase

from .models import NurseProfile, Patient
from .serializers import assess_risk_level


def make_nurse(email, first, last):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234',
        first_name=first, last_name=last,
    )
    NurseProfile.objects.create(user=user, role='staff_nurse', department='Med-Surg')
    return user


class AssessRiskLevelTests(APITestCase):
    """Unit-level: the pure classification function, no HTTP involved."""

    def test_all_normal_vitals_are_low_risk(self):
        risk = assess_risk_level(
            temperature='36.8', pulse_rate='75', respiratory_rate='16',
            blood_pressure='118/76', oxygen_saturation='98',
        )
        self.assertEqual(risk, 'low')

    def test_low_oxygen_saturation_is_high_risk(self):
        risk = assess_risk_level(oxygen_saturation='85')
        self.assertEqual(risk, 'high')

    def test_borderline_fever_is_medium_risk(self):
        risk = assess_risk_level(temperature='38.0')
        self.assertEqual(risk, 'medium')

    def test_severe_fever_is_high_risk(self):
        risk = assess_risk_level(temperature='39.2')
        self.assertEqual(risk, 'high')

    def test_extreme_fever_is_critical_risk(self):
        risk = assess_risk_level(temperature='40.1')
        self.assertEqual(risk, 'critical')

    def test_hypotensive_blood_pressure_is_high_risk(self):
        risk = assess_risk_level(blood_pressure='80/50')
        self.assertEqual(risk, 'high')

    def test_severely_hypotensive_blood_pressure_is_critical_risk(self):
        risk = assess_risk_level(blood_pressure='75/45')
        self.assertEqual(risk, 'critical')

    def test_critical_beats_high_when_both_present(self):
        risk = assess_risk_level(temperature='40.1', pulse_rate='75')
        self.assertEqual(risk, 'critical')

    def test_very_low_oxygen_saturation_is_critical_risk(self):
        risk = assess_risk_level(oxygen_saturation='80')
        self.assertEqual(risk, 'critical')

    def test_extreme_tachycardia_is_critical_risk(self):
        risk = assess_risk_level(pulse_rate='160')
        self.assertEqual(risk, 'critical')

    def test_extreme_respiratory_rate_is_critical_risk(self):
        risk = assess_risk_level(respiratory_rate='35')
        self.assertEqual(risk, 'critical')

    def test_blank_vitals_are_never_flagged(self):
        # Nothing filled in at all -> nothing to be concerned about, not a
        # false "everything is fine" reading of vitals that were never taken.
        self.assertEqual(assess_risk_level(), 'low')
        self.assertEqual(assess_risk_level(temperature='', pulse_rate=None), 'low')

    def test_one_abnormal_vital_among_normal_ones_still_flags(self):
        risk = assess_risk_level(
            temperature='36.8', pulse_rate='75', respiratory_rate='16',
            blood_pressure='118/76', oxygen_saturation='88',  # the one bad one
        )
        self.assertEqual(risk, 'high')

    def test_unparseable_values_are_ignored_not_crashed_on(self):
        risk = assess_risk_level(temperature='N/A', pulse_rate='unknown', blood_pressure='n/a')
        self.assertEqual(risk, 'low')


class KardexRiskAndAllergiesIntegrationTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.nurse = make_nurse('nurse@hospital.com', 'Ben', 'Diaz')
        self.client.force_authenticate(user=self.nurse)

    def test_registering_a_patient_with_abnormal_vitals_sets_high_risk(self):
        response = self.client.post('/api/kardex/', {
            'lastName': 'Cruz', 'firstName': 'Ana', 'age': '70', 'gender': 'Female',
            'room': '301-A', 'temperature': '39.5', 'oxygenSaturation': '87',
        })
        self.assertEqual(response.status_code, 201)
        patient = Patient.objects.get(name__icontains='Ana Cruz')
        self.assertEqual(patient.risk_level, 'high')

    def test_registering_a_patient_with_normal_vitals_sets_low_risk(self):
        response = self.client.post('/api/kardex/', {
            'lastName': 'Reyes', 'firstName': 'Ben', 'age': '40', 'gender': 'Male',
            'room': '302-A', 'temperature': '36.9', 'pulseRate': '72',
            'respiratoryRate': '16', 'bloodPressure': '120/80', 'oxygenSaturation': '99',
        })
        self.assertEqual(response.status_code, 201)
        patient = Patient.objects.get(name__icontains='Ben Reyes')
        self.assertEqual(patient.risk_level, 'low')

    def test_allergies_reach_the_patient_record(self):
        response = self.client.post('/api/kardex/', {
            'lastName': 'Santos', 'firstName': 'Cora', 'age': '55', 'gender': 'Female',
            'room': '303-A', 'allergies': ['Penicillin', 'Shellfish'],
        })
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['allergies'], ['Penicillin', 'Shellfish'])
        patient = Patient.objects.get(name__icontains='Cora Santos')
        self.assertEqual(patient.allergies, ['Penicillin', 'Shellfish'])

    def test_updating_an_existing_patient_recomputes_risk(self):
        patient = Patient.objects.create(
            patient_code='P950', name='Dee Uy', age=61, gender='Female',
            room='204-B', diagnosis='CHF', admission_date=datetime.date(2026, 3, 2),
            risk_level='low', attending_physician='Dr. Lim', assigned_nurse=self.nurse,
        )
        response = self.client.post('/api/kardex/', {
            'lastName': 'Uy', 'firstName': 'Dee', 'age': '61', 'gender': 'Female',
            'room': '204-B', 'patientId': 'P950', 'pulseRate': '145',
        })
        self.assertEqual(response.status_code, 201)
        patient.refresh_from_db()
        self.assertEqual(patient.risk_level, 'high')


class KardexBloodPressureValidationTests(APITestCase):
    """See api/serializers.py's validate_blood_pressure_format, shared by
    KardexRecordSerializer, VitalSignsSerializer and PatientSerializer —
    the two-input Systolic/Diastolic UI on every frontend always combines
    into exactly this "120/80" shape before sending."""

    def setUp(self):
        cache.clear()
        self.nurse = make_nurse('bp@hospital.com', 'Ben', 'Diaz')
        self.client.force_authenticate(user=self.nurse)

    def _create(self, blood_pressure):
        return self.client.post('/api/kardex/', {
            'lastName': 'Cruz', 'firstName': 'Ana', 'age': '40', 'gender': 'Female',
            'room': '301-A', 'bloodPressure': blood_pressure,
        })

    def test_valid_blood_pressure_is_accepted(self):
        response = self._create('120/80')
        self.assertEqual(response.status_code, 201, response.data)

    def test_blank_blood_pressure_is_fine(self):
        response = self._create('')
        self.assertEqual(response.status_code, 201, response.data)

    def test_systolic_not_higher_than_diastolic_is_rejected(self):
        response = self._create('80/120')
        self.assertEqual(response.status_code, 400)
        self.assertIn('bloodPressure', response.data)

    def test_systolic_out_of_range_is_rejected(self):
        response = self._create('400/80')
        self.assertEqual(response.status_code, 400)
        self.assertIn('bloodPressure', response.data)

    def test_diastolic_out_of_range_is_rejected(self):
        response = self._create('120/250')
        self.assertEqual(response.status_code, 400)
        self.assertIn('bloodPressure', response.data)

    def test_unparseable_text_is_rejected(self):
        response = self._create('normal')
        self.assertEqual(response.status_code, 400)
        self.assertIn('bloodPressure', response.data)
