# Seeds the fixed list of hospital departments and a starter roster of
# doctors per department, so the "Add New Task" department/doctor pickers
# have real data to show immediately rather than empty lists.

from django.db import migrations

DEPARTMENTS_AND_DOCTORS = {
    'Department of Internal Medicine': [
        ('Dr. Ramon Villareal', 'Internist', 'PRC-100101'),
        ('Dr. Corazon Aquino-Reyes', 'Internist', 'PRC-100102'),
    ],
    'Department of Surgery': [
        ('Dr. Emmanuel Torres', 'General Surgeon', 'PRC-100201'),
        ('Dr. Bianca Fernandez', 'General Surgeon', 'PRC-100202'),
    ],
    'Department of Pediatrics': [
        ('Dr. Michelle Santos', 'Pediatrician', 'PRC-100301'),
        ('Dr. John Bautista', 'Pediatrician', 'PRC-100302'),
    ],
    'Department of Obstetrics and Gynecology (OB-GYN)': [
        ('Dr. Katrina Mendoza', 'OB-GYN', 'PRC-100401'),
        ('Dr. Patricia Lim', 'OB-GYN', 'PRC-100402'),
    ],
    'Department of Family Medicine': [
        ('Dr. Alfredo Garcia', 'Family Physician', 'PRC-100501'),
        ('Dr. Rosario Del Rosario', 'Family Physician', 'PRC-100502'),
    ],
    'Department of Emergency Medicine': [
        ('Dr. Victor Ramos', 'Emergency Physician', 'PRC-100601'),
        ('Dr. Ella Navarro', 'Emergency Physician', 'PRC-100602'),
    ],
    'Department of Anesthesiology': [
        ('Dr. Miguel Castillo', 'Anesthesiologist', 'PRC-100701'),
        ('Dr. Sofia Aguilar', 'Anesthesiologist', 'PRC-100702'),
    ],
    'Department of Radiology': [
        ('Dr. Ricardo Domingo', 'Radiologist', 'PRC-100801'),
        ('Dr. Cristina Pascual', 'Radiologist', 'PRC-100802'),
    ],
    'Department of Pathology': [
        ('Dr. Fernando Cruz', 'Pathologist', 'PRC-100901'),
        ('Dr. Isabel Marquez', 'Pathologist', 'PRC-100902'),
    ],
    'Department of Psychiatry': [
        ('Dr. Antonio Villanueva', 'Psychiatrist', 'PRC-101001'),
        ('Dr. Grace Salazar', 'Psychiatrist', 'PRC-101002'),
    ],
    'Department of Dermatology': [
        ('Dr. Teresa Ocampo', 'Dermatologist', 'PRC-101101'),
        ('Dr. Paolo Ignacio', 'Dermatologist', 'PRC-101102'),
    ],
    'Department of Ophthalmology': [
        ('Dr. Roberto Valdez', 'Ophthalmologist', 'PRC-101201'),
        ('Dr. Ana Beatriz Rivera', 'Ophthalmologist', 'PRC-101202'),
    ],
    'Department of Otorhinolaryngology (ENT)': [
        ('Dr. Julius Manalo', 'ENT Specialist', 'PRC-101301'),
        ('Dr. Camille Uy', 'ENT Specialist', 'PRC-101302'),
    ],
    'Department of Orthopedics': [
        ('Dr. Gerardo Espiritu', 'Orthopedic Surgeon', 'PRC-101401'),
        ('Dr. Vanessa Ty', 'Orthopedic Surgeon', 'PRC-101402'),
    ],
    'Department of Cardiology': [
        ('Dr. Juan Dela Cruz', 'Cardiologist', 'PRC-101501'),
        ('Dr. Maria Santos', 'Cardiologist', 'PRC-101502'),
        ('Dr. Carlos Reyes', 'Cardiologist', 'PRC-101503'),
        ('Dr. Angela Cruz', 'Cardiologist', 'PRC-101504'),
    ],
    'Department of Neurology': [
        ('Dr. Enrique Robles', 'Neurologist', 'PRC-101601'),
        ('Dr. Diana Chua', 'Neurologist', 'PRC-101602'),
    ],
    'Department of Pulmonology': [
        ('Dr. Nathaniel Cordero', 'Pulmonologist', 'PRC-101701'),
        ('Dr. Lourdes Padilla', 'Pulmonologist', 'PRC-101702'),
    ],
    'Department of Nephrology': [
        ('Dr. Simon Vergara', 'Nephrologist', 'PRC-101801'),
        ('Dr. Regina Alonzo', 'Nephrologist', 'PRC-101802'),
    ],
    'Department of Gastroenterology': [
        ('Dr. Oscar Tan', 'Gastroenterologist', 'PRC-101901'),
        ('Dr. Felicity Ramirez', 'Gastroenterologist', 'PRC-101902'),
    ],
    'Department of Oncology': [
        ('Dr. Marcelo Enriquez', 'Oncologist', 'PRC-102001'),
        ('Dr. Yolanda Bermudez', 'Oncologist', 'PRC-102002'),
    ],
}


def seed(apps, schema_editor):
    Department = apps.get_model('api', 'Department')
    Doctor = apps.get_model('api', 'Doctor')
    for dept_name, doctors in DEPARTMENTS_AND_DOCTORS.items():
        department, _ = Department.objects.get_or_create(name=dept_name)
        for full_name, specialization, license_number in doctors:
            Doctor.objects.get_or_create(
                full_name=full_name,
                department=department,
                defaults={
                    'specialization': specialization,
                    'license_number': license_number,
                    'status': 'active',
                },
            )


def unseed(apps, schema_editor):
    Department = apps.get_model('api', 'Department')
    Department.objects.filter(name__in=DEPARTMENTS_AND_DOCTORS.keys()).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0019_department_task_department_doctor_taskdoctor'),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
