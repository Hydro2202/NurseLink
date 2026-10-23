"""
Signup PRC ID / face verification is retired: with
SIGNUP_ID_FACE_VERIFICATION at its default (False) every endpoint of the old
flow answers 410 Gone and never reaches n8n. Signup runs on signup-v2.
"""
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

RETIRED_ENDPOINTS = [
    ('post', '/api/auth/signup/'),
    ('post', '/api/auth/verify-id/'),
    ('post', '/api/auth/verify-prc/'),
    ('post', '/api/auth/face-verification/'),
    ('post', '/api/auth/face-verification/status/'),
    ('post', '/api/auth/registration-email/'),
    ('post', '/api/auth/send-registration-otp/'),
    ('post', '/api/auth/verify-registration-otp/'),
    ('post', '/api/auth/resend-registration-otp/'),
]


class RetiredSignupFlowTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_every_old_flow_endpoint_is_gone_without_calling_n8n(self):
        with patch('api.views.call_workflow') as workflow, patch('api.views.call_workflow_multipart') as multipart:
            for method, url in RETIRED_ENDPOINTS:
                with self.subTest(url=url):
                    response = getattr(self.client, method)(url, {}, format='json')
                    self.assertEqual(response.status_code, 410)
                    self.assertIn('no longer part of signup', response.json()['detail'])
        workflow.assert_not_called()
        multipart.assert_not_called()

    def test_signup_v2_is_still_served(self):
        # The replacement flow must stay reachable: a bad body is a 400, not 410.
        response = self.client.post('/api/auth/signup-v2/start/', {}, format='json')
        self.assertEqual(response.status_code, 400)
