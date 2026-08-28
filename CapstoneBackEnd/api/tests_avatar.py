"""
Profile photo upload.

A nurse picks a photo in Settings; the client sends it as a data: URI on
PATCH /auth/me/. Everything that makes that safe to store happens server side,
so these tests pin the normalisation rather than the transport: whatever comes
in, what lands in the database is a small square JPEG with no metadata.
"""

import base64
import io
import re

from django.contrib.auth.models import User
from django.core.cache import cache
from PIL import Image
from rest_framework.test import APITestCase

from .avatar import AVATAR_SIZE, AvatarError, normalize_avatar
from .models import NurseProfile


def data_uri(image: Image.Image, fmt='PNG') -> str:
    buffer = io.BytesIO()
    image.save(buffer, format=fmt)
    encoded = base64.b64encode(buffer.getvalue()).decode('ascii')
    return f'data:image/{fmt.lower()};base64,{encoded}'


def decode(uri: str) -> Image.Image:
    payload = uri.split(',', 1)[1]
    return Image.open(io.BytesIO(base64.b64decode(payload)))


class AvatarNormalizationTests(APITestCase):
    def test_wide_photo_is_cropped_to_a_square_jpeg(self):
        result = normalize_avatar(data_uri(Image.new('RGB', (1600, 600), (10, 120, 200))))

        self.assertTrue(result.startswith('data:image/jpeg;base64,'))
        image = decode(result)
        self.assertEqual(image.size, (AVATAR_SIZE, AVATAR_SIZE))
        self.assertEqual(image.format, 'JPEG')

    def test_transparency_is_flattened_onto_white_not_black(self):
        # A fully transparent PNG: JPEG has no alpha, so the pixels have to go
        # somewhere. Black squares are the classic wrong answer here.
        result = normalize_avatar(data_uri(Image.new('RGBA', (400, 400), (0, 0, 0, 0))))

        pixel = decode(result).convert('RGB').getpixel((128, 128))
        self.assertTrue(all(channel > 240 for channel in pixel), pixel)

    def test_exif_metadata_does_not_survive(self):
        source = Image.new('RGB', (500, 500), (200, 30, 30))
        buffer = io.BytesIO()
        exif = source.getexif()
        exif[0x9286] = 'taken at home'  # UserComment
        source.save(buffer, format='JPEG', exif=exif)
        uri = 'data:image/jpeg;base64,' + base64.b64encode(buffer.getvalue()).decode()

        stored = decode(normalize_avatar(uri))
        self.assertEqual(dict(stored.getexif()), {})

    def test_blank_clears_the_photo_and_urls_pass_through(self):
        self.assertEqual(normalize_avatar(''), '')
        self.assertEqual(
            normalize_avatar('https://cdn.example.com/a.png'),
            'https://cdn.example.com/a.png',
        )

    def test_non_image_payloads_are_rejected_with_a_readable_message(self):
        junk = base64.b64encode(b'this is not an image at all').decode()
        with self.assertRaises(AvatarError) as ctx:
            normalize_avatar(f'data:image/png;base64,{junk}')
        self.assertIn('image', str(ctx.exception).lower())

        with self.assertRaises(AvatarError):
            normalize_avatar('javascript:alert(1)')


class AvatarEndpointTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            username='nurse@hospital.com', email='nurse@hospital.com',
            password='pw-test-1234', first_name='Ana', last_name='Cruz',
        )
        NurseProfile.objects.create(user=self.user, role='staff_nurse')
        self.client.force_authenticate(user=self.user)

    def test_patch_me_stores_a_normalized_photo_and_returns_it(self):
        uri = data_uri(Image.new('RGB', (1200, 1200), (5, 90, 60)))
        response = self.client.patch('/api/auth/me/', {'avatar': uri}, format='json')

        self.assertEqual(response.status_code, 200)
        returned = response.json()['avatar']
        self.assertTrue(returned.startswith('data:image/jpeg;base64,'))
        self.assertEqual(decode(returned).size, (AVATAR_SIZE, AVATAR_SIZE))

        self.user.nurse_profile.refresh_from_db()
        self.assertEqual(self.user.nurse_profile.avatar, returned)

        # The whole point of re-encoding: the stored copy is small enough to
        # ride along in the user payload on every request.
        self.assertLess(len(returned), 60_000, 'stored avatar is too heavy')

    def test_patch_me_can_clear_the_photo(self):
        self.user.nurse_profile.avatar = 'data:image/jpeg;base64,abc'
        self.user.nurse_profile.save()

        response = self.client.patch('/api/auth/me/', {'avatar': ''}, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['avatar'], '')
        self.user.nurse_profile.refresh_from_db()
        self.assertEqual(self.user.nurse_profile.avatar, '')

    def test_a_bad_photo_is_a_400_not_a_500(self):
        junk = base64.b64encode(b'nope').decode()
        response = self.client.patch(
            '/api/auth/me/', {'avatar': f'data:image/png;base64,{junk}'}, format='json'
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('avatar', response.json())

    def test_editing_the_photo_leaves_other_profile_fields_alone(self):
        self.user.nurse_profile.department = 'ICU'
        self.user.nurse_profile.save()

        uri = data_uri(Image.new('RGB', (300, 300), (1, 2, 3)))
        self.client.patch('/api/auth/me/', {'avatar': uri}, format='json')

        self.user.nurse_profile.refresh_from_db()
        self.assertEqual(self.user.nurse_profile.department, 'ICU')
        self.assertEqual(self.user.first_name, 'Ana')
