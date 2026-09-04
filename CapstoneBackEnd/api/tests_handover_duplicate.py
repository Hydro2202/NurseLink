"""
A patient can only be mid-handover to one nurse at a time — a second,
conflicting handover to a different nurse while the first is still
unacknowledged is exactly the kind of mixup this blocks. Once the first is
acknowledged, responsibility has genuinely moved, so a later handover
(next shift, say) is legitimate again.
"""

import datetime

from django.contrib.auth.models import User
from django.core.cache import cache
from rest_framework.test import APITestCase

from .models import HandoverNote, NurseProfile, Patient


def make_nurse(email, first, last):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234',
        first_name=first, last_name=last,
    )
    NurseProfile.objects.create(user=user, role='staff_nurse', department='Med-Surg')
    return user


class HandoverDuplicateTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.sender = make_nurse('ana@hospital.com', 'Ana', 'Cruz')
        self.receiver = make_nurse('ben@hospital.com', 'Ben', 'Diaz')
        self.third = make_nurse('cora@hospital.com', 'Cora', 'Reyes')
        self.patient = Patient.objects.create(
            patient_code='P970', name='Juan Dela Cruz', age=61, gender='Male',
            room='204-B', diagnosis='CHF', admission_date=datetime.date(2026, 3, 2),
            risk_level='medium', attending_physician='Dr. Lim',
        )
        self.client.force_authenticate(user=self.sender)

    def create_handover(self, nurse_to='Ben Diaz'):
        return self.client.post('/api/handovers/', {
            'patientId': 'P970', 'shift': 'morning', 'date': '2026-09-04',
            'nurseFrom': 'Ana Cruz', 'nurseTo': nurse_to,
            'sbar': {'situation': 'Stable', 'background': '', 'assessment': '', 'recommendation': ''},
        }, format='json')

    def test_second_pending_handover_for_the_same_patient_is_blocked(self):
        first = self.create_handover('Ben Diaz')
        self.assertEqual(first.status_code, 201)

        second = self.create_handover('Cora Reyes')
        self.assertEqual(second.status_code, 400)
        self.assertIn('Ben Diaz', str(second.data))

    def test_handover_for_a_different_patient_is_unaffected(self):
        other_patient = Patient.objects.create(
            patient_code='P971', name='Maria Santos', age=45, gender='Female',
            room='205-A', diagnosis='Pneumonia', admission_date=datetime.date(2026, 3, 2),
            risk_level='low', attending_physician='Dr. Lim',
        )
        self.create_handover('Ben Diaz')
        response = self.client.post('/api/handovers/', {
            'patientId': 'P971', 'shift': 'morning', 'date': '2026-09-04',
            'nurseFrom': 'Ana Cruz', 'nurseTo': 'Cora Reyes',
            'sbar': {'situation': 'Stable', 'background': '', 'assessment': '', 'recommendation': ''},
        }, format='json')
        self.assertEqual(response.status_code, 201)

    def test_a_new_handover_is_allowed_once_the_first_is_acknowledged(self):
        first = self.create_handover('Ben Diaz')
        code = first.data['id']

        self.client.force_authenticate(user=self.receiver)
        ack = self.client.post(f'/api/handovers/{code}/acknowledge/')
        self.assertEqual(ack.status_code, 200)

        self.client.force_authenticate(user=self.receiver)
        second = self.create_handover('Cora Reyes')
        self.assertEqual(second.status_code, 201)

    def test_handover_with_no_patient_link_is_never_blocked(self):
        # Free-text/legacy handovers with no patientId have nothing to
        # collide on — never blocked by this check.
        first = self.client.post('/api/handovers/', {
            'shift': 'morning', 'date': '2026-09-04',
            'nurseFrom': 'Ana Cruz', 'nurseTo': 'Ben Diaz',
            'patientName': 'Walk-in, not yet in the system',
            'sbar': {'situation': 'Stable', 'background': '', 'assessment': '', 'recommendation': ''},
        }, format='json')
        self.assertEqual(first.status_code, 201)
        second = self.client.post('/api/handovers/', {
            'shift': 'morning', 'date': '2026-09-04',
            'nurseFrom': 'Ana Cruz', 'nurseTo': 'Cora Reyes',
            'patientName': 'Walk-in, not yet in the system',
            'sbar': {'situation': 'Stable', 'background': '', 'assessment': '', 'recommendation': ''},
        }, format='json')
        self.assertEqual(second.status_code, 201)
