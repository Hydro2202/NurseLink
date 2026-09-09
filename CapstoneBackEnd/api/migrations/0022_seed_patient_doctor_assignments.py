# Seeds a couple of patient->doctor (Kardex) assignments on top of the
# existing demo patients/doctors, so Add New Task's patient-specific doctor
# lookup has real data to show without requiring manual setup first.

from django.db import migrations

# (patient_code, [(doctor_full_name, department_name), ...])
ASSIGNMENTS = [
    ('P001', [
        ('Dr. Ramon Villareal', 'Department of Internal Medicine'),
        ('Dr. Maria Santos', 'Department of Cardiology'),
        ('Dr. Emmanuel Torres', 'Department of Surgery'),
        ('Dr. Michelle Santos', 'Department of Pediatrics'),
    ]),
    ('P002', [
        ('Dr. Corazon Aquino-Reyes', 'Department of Internal Medicine'),
    ]),
]


def seed(apps, schema_editor):
    Patient = apps.get_model('api', 'Patient')
    Doctor = apps.get_model('api', 'Doctor')
    PatientDoctor = apps.get_model('api', 'PatientDoctor')
    for patient_code, doctors in ASSIGNMENTS:
        patient = Patient.objects.filter(patient_code=patient_code).first()
        if not patient:
            continue
        for doctor_name, department_name in doctors:
            doctor = Doctor.objects.filter(
                full_name=doctor_name, department__name=department_name
            ).first()
            if not doctor:
                continue
            PatientDoctor.objects.get_or_create(
                patient=patient, doctor=doctor, defaults={'status': 'active'},
            )


def unseed(apps, schema_editor):
    PatientDoctor = apps.get_model('api', 'PatientDoctor')
    Patient = apps.get_model('api', 'Patient')
    codes = [code for code, _ in ASSIGNMENTS]
    PatientDoctor.objects.filter(patient__patient_code__in=codes).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0021_patientdoctor'),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
