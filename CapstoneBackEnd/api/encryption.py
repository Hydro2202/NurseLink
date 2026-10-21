"""
Encryption at rest for sensitive patient data.

Clinical details (diagnosis, allergies, medications, nursing/charting notes,
SBAR referral text, Kardex narrative) and patient contact details (address,
phone numbers, emergency contact) are stored encrypted with Fernet
(AES-128-CBC + HMAC-SHA256) through the model fields below. The app reads and
writes them exactly as before; only the database holds ciphertext.

Key: settings.FIELD_ENCRYPTION_KEY (a Fernet key) when set -- set it on
Render and keep a copy somewhere safe: losing it means losing that data.
When unset it is derived from DJANGO_SECRET_KEY (settings
FIELD_ENCRYPTION_FALLBACK_SECRET), so rotating that secret then makes the data
unreadable. Generate one with:

    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

Stored values carry an "enc1:" prefix. Anything without it is legacy
plaintext (from before encryption) and is returned unchanged, then encrypted
the next time the row is saved -- migration 0074 encrypts every existing row.

Encrypted columns can't be searched or sorted by the database; nothing in the
app does that except patient search, which no longer matches diagnosis.
"""

import base64
import hashlib
import json
import logging
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from django.conf import settings
from django.db import models

logger = logging.getLogger(__name__)

PREFIX = 'enc1:'


def _derived_key(secret: str) -> bytes:
    digest = hashlib.sha256(('nurselink-field-encryption:' + secret).encode()).digest()
    return base64.urlsafe_b64encode(digest)


@lru_cache(maxsize=4)
def _fernet(configured_key: str, fallback_secret: str) -> MultiFernet:
    keys = []
    if configured_key:
        keys.append(Fernet(configured_key.encode()))
    # The derived key always stays readable, so data written before
    # FIELD_ENCRYPTION_KEY was set still decrypts after setting it.
    keys.append(Fernet(_derived_key(fallback_secret)))
    return MultiFernet(keys)


def _cipher() -> MultiFernet:
    return _fernet(
        getattr(settings, 'FIELD_ENCRYPTION_KEY', '') or '',
        getattr(settings, 'FIELD_ENCRYPTION_FALLBACK_SECRET', '') or settings.SECRET_KEY,
    )


def encrypt_str(value: str) -> str:
    if not value or value.startswith(PREFIX):
        return value
    return PREFIX + _cipher().encrypt(value.encode('utf-8')).decode('ascii')


def decrypt_str(value: str) -> str:
    if not value or not isinstance(value, str) or not value.startswith(PREFIX):
        return value  # empty, or legacy plaintext
    try:
        return _cipher().decrypt(value[len(PREFIX):].encode('ascii')).decode('utf-8')
    except (InvalidToken, ValueError):
        # Wrong/rotated key. Never crash a whole page over one field, and
        # never show ciphertext to a nurse.
        logger.error('Could not decrypt a stored field: check FIELD_ENCRYPTION_KEY / SECRET_KEY.')
        return ''


class EncryptedTextField(models.TextField):
    """A TextField whose value is encrypted in the database."""

    def from_db_value(self, value, expression, connection):
        return decrypt_str(value) if value is not None else value

    def to_python(self, value):
        value = super().to_python(value)
        return decrypt_str(value) if isinstance(value, str) else value

    def get_prep_value(self, value):
        value = super().get_prep_value(value)
        if value is None:
            return value
        return encrypt_str(str(value))


class EncryptedJSONField(models.JSONField):
    """
    A JSONField (lists such as allergies/medications) stored as encrypted
    text. Stays a JSONField for serializers and Python code; only the column
    type and what's written to it change.
    """

    def db_type(self, connection):
        return 'text'

    def db_check(self, connection):
        # JSONField adds a JSON_VALID check on SQLite; ciphertext isn't JSON.
        return None

    def from_db_value(self, value, expression, connection):
        if value is None:
            return value
        if not isinstance(value, str):
            return value  # already decoded by the driver (legacy jsonb)
        text = decrypt_str(value)
        if text == '':
            return self.get_default()
        try:
            return json.loads(text)
        except ValueError:
            return text

    def get_db_prep_value(self, value, connection, prepared=False):
        if value is None:
            return None
        return encrypt_str(json.dumps(value, cls=self.encoder))

    def get_db_prep_save(self, value, connection):
        return self.get_db_prep_value(value, connection)
