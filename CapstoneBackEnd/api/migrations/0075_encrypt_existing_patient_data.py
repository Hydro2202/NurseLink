"""
Encrypt the sensitive patient data already in the database (see
api/encryption.py). The fields read legacy plaintext transparently, so this
just re-saves every row with a value, which writes it back encrypted.
Reversing decrypts again.
"""

from django.db import migrations

ENCRYPTED_FIELDS = {
    'Patient': [
        'contact_number', 'address', 'emergency_contact_name', 'emergency_contact_number',
        'diagnosis', 'allergies', 'medications',
    ],
    'ChartingNote': ['content', 'focus', 'data', 'action', 'response'],
    'KardexRecord': [
        'chief_complaint', 'admitting_diagnosis', 'final_diagnosis', 'allergies',
        'special_endorsements',
    ],
    'HandoverNote': ['situation', 'background', 'assessment', 'recommendation'],
}


def encrypt_existing(apps, schema_editor):
    for model_name, fields in ENCRYPTED_FIELDS.items():
        Model = apps.get_model('api', model_name)
        for row in Model.objects.only('pk', *fields).iterator(chunk_size=200):
            # Re-saving through the encrypted fields writes ciphertext.
            Model.objects.filter(pk=row.pk).update(**{f: getattr(row, f) for f in fields})


def decrypt_existing(apps, schema_editor):
    from api.encryption import decrypt_str

    for model_name, fields in ENCRYPTED_FIELDS.items():
        Model = apps.get_model('api', model_name)
        table = Model._meta.db_table
        columns = [Model._meta.get_field(f).column for f in fields]
        with schema_editor.connection.cursor() as cursor:
            cursor.execute(f'SELECT id, {", ".join(columns)} FROM {table}')
            for row in cursor.fetchall():
                values = [decrypt_str(v) if isinstance(v, str) else v for v in row[1:]]
                sets = ', '.join(f'{c} = %s' for c in columns)
                cursor.execute(f'UPDATE {table} SET {sets} WHERE id = %s', [*values, row[0]])


class Migration(migrations.Migration):
    dependencies = [
        ('api', '0074_encrypt_patient_fields'),
    ]

    operations = [
        migrations.RunPython(encrypt_existing, decrypt_existing),
    ]
