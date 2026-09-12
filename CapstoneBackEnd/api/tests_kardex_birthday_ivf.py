"""
Kardex: Birthday and IVF fields.

Both are free text, same convention as every other Kardex demographic/
clinical field (admission_date, diet, etc.) — a manually-filled paper-form
field, not something the app parses or computes from.
"""

from django.contrib.auth.models import User
from django.core.cache import cache
from rest_framework.test import APITestCase

from .models import KardexRecord, NurseProfile


def make_nurse(email, first, last):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234',
        first_name=first, last_name=last,
    )
    NurseProfile.objects.create(user=user, role='staff_nurse', department='Med-Surg')
    return user


class KardexBirthdayAndIvfTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.nurse = make_nurse('nurse@hospital.com', 'Ben', 'Diaz')
        self.client.force_authenticate(user=self.nurse)

    def test_birthday_and_ivf_save_and_round_trip(self):
        response = self.client.post('/api/kardex/', {
            'lastName': 'Cruz', 'firstName': 'Ana', 'age': '70', 'gender': 'Female',
            'room': '301-A', 'birthday': '1955-06-12', 'ivf': 'D5LR 1L @ 80cc/hr',
        })
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.data['birthday'], '1955-06-12')
        self.assertEqual(response.data['ivf'], 'D5LR 1L @ 80cc/hr')

        record = KardexRecord.objects.get(pk=response.data['id'])
        self.assertEqual(record.birthday, '1955-06-12')
        self.assertEqual(record.ivf, 'D5LR 1L @ 80cc/hr')

    def test_both_fields_default_to_blank_when_omitted(self):
        response = self.client.post('/api/kardex/', {
            'lastName': 'Reyes', 'firstName': 'Ben', 'age': '40', 'gender': 'Male',
            'room': '302-A',
        })
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.data['birthday'], '')
        self.assertEqual(response.data['ivf'], '')

    def test_both_fields_appear_when_listing_history(self):
        self.client.post('/api/kardex/', {
            'lastName': 'Santos', 'firstName': 'Cora', 'age': '55', 'gender': 'Female',
            'room': '303-A', 'birthday': '1970-01-01', 'ivf': 'PNSS 1L KVO',
        })
        response = self.client.get('/api/kardex/')
        self.assertEqual(response.status_code, 200)
        entry = next(row for row in response.data if row['firstName'] == 'Cora')
        self.assertEqual(entry['birthday'], '1970-01-01')
        self.assertEqual(entry['ivf'], 'PNSS 1L KVO')
