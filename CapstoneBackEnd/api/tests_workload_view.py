"""
GET /api/workload/ — the supervisor's Assign action on this page is the only
UI path to NurseViewSet.assign (department/shift reassignment). Several
nurses on this ward share a display name, so nurseEmail has to be in the
response — without it a supervisor reassigning "Raiden Villapando" here has
no way to tell which of several accounts they just picked.
"""

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from .models import NurseProfile


def make_nurse(email, first, last, *, department='ICU', shift='morning'):
    user = User.objects.create_user(
        username=email, email=email, password='pw-test-1234',
        first_name=first, last_name=last,
    )
    NurseProfile.objects.create(
        user=user, role='staff_nurse', department=department, shift=shift,
        approval_status='approved', is_active_staff=True,
    )
    return user


class WorkloadViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.supervisor = User.objects.create_user(
            username='sup@hospital.com', email='sup@hospital.com',
            password='pw-test-1234', first_name='Ana', last_name='Cruz',
        )
        NurseProfile.objects.create(
            user=self.supervisor, role='supervisor', approval_status='approved', is_active_staff=True,
        )
        self.client.force_authenticate(self.supervisor)

    def test_each_nurse_row_includes_their_email(self):
        make_nurse('raiden41@hospital.com', 'Raiden', 'Villapando')
        response = self.client.get('/api/workload/')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data[0]['nurseEmail'], 'raiden41@hospital.com')

    def test_same_named_nurses_are_distinguishable_by_email(self):
        # The exact bug report this guards against: several accounts share a
        # display name, so the email is the only thing that tells them apart
        # in the Assign list.
        make_nurse('raiden41@hospital.com', 'Raiden', 'Villapando', department='ICU')
        make_nurse('raiden42@hospital.com', 'Raiden', 'Villapando', department='ER')

        response = self.client.get('/api/workload/')
        rows = [row for row in response.data if row['nurseName'] == 'Raiden Villapando']
        self.assertEqual(len(rows), 2)
        emails = {row['nurseEmail'] for row in rows}
        self.assertEqual(emails, {'raiden41@hospital.com', 'raiden42@hospital.com'})
