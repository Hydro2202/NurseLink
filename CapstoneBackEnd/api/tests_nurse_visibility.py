"""
Who may see a colleague's sensitive nurse fields.

email, overtime hours and burnout risk are HR/wellbeing data. Head nurses and
admins see them; a staff nurse does not see them about anyone, peers included.
The rule lives in api/access.py (SENSITIVE_NURSE_FIELDS, filter_nurse_fields).
"""

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from .models import NurseProfile

# The list and workload use different keys for the same email.
LIST_SENSITIVE = {'email', 'overtimeHours', 'burnoutRisk'}
WORKLOAD_SENSITIVE = {'nurseEmail', 'overtimeHours', 'burnoutRisk'}


def make_user(email, *, role='staff_nurse', staff=False):
    user = User.objects.create_user(username=email, email=email, password='pw-test-1234',
                                    first_name='Test', last_name=email.split('@')[0], is_staff=staff)
    NurseProfile.objects.create(
        user=user, role=role, department='ICU', approval_status='approved', is_active_staff=True,
        overtime_hours=3.5, burnout_risk='high',
    )
    return user


class NurseVisibilityTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.staff = make_user('peer@hospital.com')
        self.colleague = make_user('colleague@hospital.com')
        self.head = make_user('head@hospital.com', role='head_nurse')
        self.admin = make_user('admin@hospital.com', staff=True)

    def nurse_row(self, rows, pk):
        return next(r for r in rows if r['id'] == str(pk))

    # --- /api/nurses/ (list) ---------------------------------------------------

    def test_staff_nurse_list_hides_sensitive_fields(self):
        self.client.force_authenticate(self.staff)
        res = self.client.get('/api/nurses/')
        self.assertEqual(res.status_code, 200, res.content)
        row = self.nurse_row(res.data, self.colleague.pk)
        self.assertFalse(LIST_SENSITIVE & set(row.keys()), row)
        # What the duty roster and task picker need is still there.
        for key in ('id', 'name', 'role', 'shift', 'department'):
            self.assertIn(key, row)

    def test_head_nurse_list_includes_sensitive_fields(self):
        self.client.force_authenticate(self.head)
        res = self.client.get('/api/nurses/')
        row = self.nurse_row(res.data, self.colleague.pk)
        self.assertTrue(LIST_SENSITIVE <= set(row.keys()), row)
        self.assertEqual(row['overtimeHours'], 3.5)
        self.assertEqual(row['burnoutRisk'], 'high')
        self.assertEqual(row['email'], 'colleague@hospital.com')

    def test_admin_list_includes_sensitive_fields(self):
        self.client.force_authenticate(self.admin)
        res = self.client.get('/api/nurses/')
        row = self.nurse_row(res.data, self.colleague.pk)
        self.assertTrue(LIST_SENSITIVE <= set(row.keys()), row)

    # --- /api/nurses/<id>/ (detail) --------------------------------------------

    def test_staff_nurse_detail_hides_email(self):
        self.client.force_authenticate(self.staff)
        res = self.client.get(f'/api/nurses/{self.colleague.pk}/')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertNotIn('email', res.data)
        self.assertIn('name', res.data)

    def test_head_nurse_detail_includes_email(self):
        self.client.force_authenticate(self.head)
        res = self.client.get(f'/api/nurses/{self.colleague.pk}/')
        self.assertEqual(res.data['email'], 'colleague@hospital.com')

    # --- /api/workload/ (analytics) --------------------------------------------

    def test_staff_nurse_workload_hides_sensitive_fields(self):
        self.client.force_authenticate(self.staff)
        res = self.client.get('/api/workload/')
        self.assertEqual(res.status_code, 200, res.content)
        for row in res.data:
            self.assertFalse(WORKLOAD_SENSITIVE & set(row.keys()), row)
            self.assertIn('nurseName', row)

    def test_head_nurse_workload_includes_sensitive_fields(self):
        self.client.force_authenticate(self.head)
        res = self.client.get('/api/workload/')
        self.assertTrue(res.data)
        for row in res.data:
            self.assertTrue(WORKLOAD_SENSITIVE <= set(row.keys()), row)
