"""
Top up the Patient table to exactly TARGET_PATIENT_COUNT (103) fictional
patients, distributed as evenly as possible across active staff nurses.

Idempotent and additive only:
  - Never deletes or edits an existing patient's content.
  - Only backfills `assigned_nurse` on existing patients that have none.
  - Creates exactly max(0, TARGET_PATIENT_COUNT - Patient.objects.count())
    new patients, so a second run with nothing changed creates zero.

Distinct from seed_demo.py, which deliberately wipes to an EMPTY clinical DB
and only seeds the two fixed test accounts — that command's contract must
stay untouched. This one only ever adds.

Reuses the Department/Doctor rows already seeded by
0020_seed_departments_and_doctors.py (physician specialties) and
0027_seed_duty_departments.py (wards/units) rather than inventing new ones.
"""

import heapq
import random
from datetime import date, timedelta

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Count

from api.models import Department, Doctor, NurseProfile, Patient, PatientAssignment, PatientDoctor
from api.serializers import nurse_display_name, open_patient_visit
from api.utils import next_code

TARGET_PATIENT_COUNT = 103

# Same 21 ward/unit names 0027_seed_duty_departments.py seeds into
# Department — a patient's `department` is one of these, not a physician
# specialty. Kept as a local literal copy rather than importing the
# migration module, since migrations are historical snapshots, not a stable
# import surface.
WARD_DEPARTMENTS = [
    'Emergency Department (ER)',
    'Intensive Care Unit (ICU)',
    'Medical-Surgical Ward',
    'Pediatric Ward',
    'Obstetrics and Gynecology (OB-GYN)',
    'Operating Room (OR)',
    'Recovery Room / PACU',
    'Neonatal Intensive Care Unit (NICU)',
    'Outpatient Department (OPD)',
    'Dialysis Unit',
    'Oncology Unit',
    'Cardiology Unit',
    'Orthopedic Ward',
    'Surgical Ward',
    'Medical Ward',
    'Psychiatric Unit',
    'Isolation Ward',
    'Laboratory',
    'Radiology',
    'Maternity Ward',
    'General Ward',
]

# Which physician-specialty Department (from 0020_seed_departments_and_doctors.py)
# a patient on each ward would plausibly have as their attending physician's
# department, so PatientDoctor assignments read sensibly rather than random.
WARD_TO_SPECIALTY = {
    'Emergency Department (ER)': 'Department of Emergency Medicine',
    'Intensive Care Unit (ICU)': 'Department of Internal Medicine',
    'Medical-Surgical Ward': 'Department of Surgery',
    'Pediatric Ward': 'Department of Pediatrics',
    'Obstetrics and Gynecology (OB-GYN)': 'Department of Obstetrics and Gynecology (OB-GYN)',
    'Operating Room (OR)': 'Department of Surgery',
    'Recovery Room / PACU': 'Department of Anesthesiology',
    'Neonatal Intensive Care Unit (NICU)': 'Department of Pediatrics',
    'Outpatient Department (OPD)': 'Department of Family Medicine',
    'Dialysis Unit': 'Department of Nephrology',
    'Oncology Unit': 'Department of Oncology',
    'Cardiology Unit': 'Department of Cardiology',
    'Orthopedic Ward': 'Department of Orthopedics',
    'Surgical Ward': 'Department of Surgery',
    'Medical Ward': 'Department of Internal Medicine',
    'Psychiatric Unit': 'Department of Psychiatry',
    'Isolation Ward': 'Department of Internal Medicine',
    'Laboratory': 'Department of Pathology',
    'Radiology': 'Department of Radiology',
    'Maternity Ward': 'Department of Obstetrics and Gynecology (OB-GYN)',
    'General Ward': 'Department of Family Medicine',
}

DIAGNOSES_BY_WARD = {
    'Emergency Department (ER)': ['Acute Trauma', 'Chest Pain, Unspecified', 'Acute Appendicitis', 'Laceration'],
    'Intensive Care Unit (ICU)': ['Septic Shock', 'Acute Respiratory Failure', 'Post-Cardiac Arrest', 'Multi-Organ Dysfunction'],
    'Medical-Surgical Ward': ['Post-Operative Recovery', 'Cholecystitis', 'Bowel Obstruction'],
    'Pediatric Ward': ['Acute Gastroenteritis', 'Community-Acquired Pneumonia', 'Febrile Seizure', 'Dengue Fever'],
    'Obstetrics and Gynecology (OB-GYN)': ['Normal Spontaneous Delivery', 'Pre-Eclampsia', 'Ovarian Cyst'],
    'Operating Room (OR)': ['Elective Appendectomy', 'Cholecystectomy', 'Cesarean Section'],
    'Recovery Room / PACU': ['Post-Anesthesia Monitoring', 'Post-Operative Pain Management'],
    'Neonatal Intensive Care Unit (NICU)': ['Prematurity', 'Neonatal Jaundice', 'Respiratory Distress Syndrome'],
    'Outpatient Department (OPD)': ['Hypertension, Follow-up', 'Type 2 Diabetes Mellitus, Follow-up', 'Upper Respiratory Tract Infection'],
    'Dialysis Unit': ['End-Stage Renal Disease', 'Chronic Kidney Disease Stage 5'],
    'Oncology Unit': ['Breast Carcinoma', 'Colorectal Carcinoma', 'Lymphoma'],
    'Cardiology Unit': ['Acute Myocardial Infarction', 'Congestive Heart Failure', 'Atrial Fibrillation'],
    'Orthopedic Ward': ['Closed Fracture, Femur', 'Hip Replacement Recovery', 'Spinal Stenosis'],
    'Surgical Ward': ['Post-Operative Recovery', 'Hernia Repair Recovery'],
    'Medical Ward': ['Community-Acquired Pneumonia', 'Urinary Tract Infection', 'Type 2 Diabetes Mellitus'],
    'Psychiatric Unit': ['Major Depressive Disorder', 'Acute Psychosis', 'Generalized Anxiety Disorder'],
    'Isolation Ward': ['Pulmonary Tuberculosis', 'COVID-19', 'Chickenpox'],
    'Laboratory': ['Diagnostic Work-up, Unspecified'],
    'Radiology': ['Diagnostic Imaging, Unspecified'],
    'Maternity Ward': ['Postpartum Recovery', 'Normal Spontaneous Delivery'],
    'General Ward': ['Dehydration', 'Cellulitis', 'Community-Acquired Pneumonia'],
}

MALE_FIRST_NAMES = [
    'Juan', 'Jose', 'Antonio', 'Ramon', 'Carlos', 'Miguel', 'Roberto', 'Eduardo', 'Francisco',
    'Ricardo', 'Fernando', 'Alfredo', 'Victor', 'Manuel', 'Oscar', 'Rodrigo', 'Emmanuel',
    'Julius', 'Marcelo', 'Gerardo', 'Enrique', 'Paolo', 'Nathaniel', 'Simon', 'Arnel',
]
FEMALE_FIRST_NAMES = [
    'Maria', 'Ana', 'Rosario', 'Corazon', 'Teresa', 'Isabel', 'Cristina', 'Angela', 'Diana',
    'Grace', 'Sofia', 'Patricia', 'Camille', 'Vanessa', 'Regina', 'Yolanda', 'Bianca',
    'Ella', 'Lourdes', 'Felicity', 'Katrina', 'Michelle', 'Carmela', 'Josefina',
]
MIDDLE_NAMES = [
    'Santos', 'Reyes', 'Cruz', 'Bautista', 'Garcia', 'Mendoza', 'Villanueva', 'Aquino',
    'Torres', 'Fernandez', 'Del Rosario', 'Navarro', 'Castillo', 'Aguilar', 'Domingo',
]
LAST_NAMES = [
    'Santos', 'Reyes', 'Cruz', 'Bautista', 'Garcia', 'Mendoza', 'Villanueva', 'Aquino',
    'Torres', 'Fernandez', 'Ramos', 'Del Rosario', 'Navarro', 'Castillo', 'Aguilar',
    'Domingo', 'Pascual', 'Marquez', 'Salazar', 'Ocampo', 'Ignacio', 'Valdez', 'Rivera',
    'Manalo', 'Uy', 'Espiritu', 'Ty', 'Robles', 'Chua', 'Cordero', 'Padilla', 'Vergara',
]
BARANGAYS = [
    'Barangay San Isidro', 'Barangay Santo Niño', 'Barangay Poblacion', 'Barangay San Antonio',
    'Barangay Bagong Silang', 'Barangay Malaya', 'Barangay San Roque', 'Barangay Santa Cruz',
    'Barangay San Jose', 'Barangay Maligaya',
]
CITIES = [
    'Quezon City', 'Makati City', 'Pasig City', 'Manila', 'Caloocan City', 'Taguig City',
    'Mandaluyong City', 'Marikina City', 'Parañaque City', 'Cebu City', 'Davao City',
]

RISK_LEVELS = ['low', 'medium', 'high', 'critical']
RISK_WEIGHTS = [45, 30, 18, 7]

STATUSES = ['admitted', 'observation', 'discharged']
STATUS_WEIGHTS = [70, 25, 5]

VITAL_RANGES = {
    'low': dict(hr=(60, 90), sys=(100, 129), dia=(60, 84), temp=(36.1, 37.2), spo2=(96, 100), rr=(12, 18)),
    'medium': dict(hr=(85, 105), sys=(130, 149), dia=(85, 94), temp=(37.3, 38.3), spo2=(93, 96), rr=(18, 22)),
    'high': dict(hr=(100, 125), sys=(150, 179), dia=(95, 109), temp=(38.0, 39.5), spo2=(90, 94), rr=(22, 28)),
    'critical': dict(hr=(125, 160), sys=(90, 220), dia=(50, 130), temp=(38.8, 41.0), spo2=(85, 90), rr=(26, 34)),
}


def _ph_mobile_number(rng: random.Random) -> str:
    return '09' + ''.join(str(rng.randint(0, 9)) for _ in range(9))


def _random_dob(age: int, rng: random.Random) -> date:
    today = date.today()
    try:
        birth_year = today.year - age
        return date(birth_year, rng.randint(1, 12), rng.randint(1, 28))
    except ValueError:
        return date(today.year - age, 1, 1)


def _generate_patient_fields(rng: random.Random) -> dict:
    is_male = rng.random() < 0.5
    first = rng.choice(MALE_FIRST_NAMES if is_male else FEMALE_FIRST_NAMES)
    middle = rng.choice(MIDDLE_NAMES) if rng.random() > 0.2 else ''
    last = rng.choice(LAST_NAMES)
    age = rng.choices(range(18, 91), weights=[3 if 40 <= a <= 75 else 1 for a in range(18, 91)])[0]

    ward = rng.choice(WARD_DEPARTMENTS)
    risk = rng.choices(RISK_LEVELS, weights=RISK_WEIGHTS)[0]
    v = VITAL_RANGES[risk]
    status = rng.choices(STATUSES, weights=STATUS_WEIGHTS)[0]
    admission_date = date.today() - timedelta(days=rng.randint(0, 60))

    emergency_first = rng.choice(MALE_FIRST_NAMES if not is_male else FEMALE_FIRST_NAMES)
    emergency_last = rng.choice(LAST_NAMES)

    return {
        'first_name': first,
        'middle_name': middle,
        'last_name': last,
        'name': f'{first} {last}',
        'age': age,
        'gender': 'Male' if is_male else 'Female',
        'date_of_birth': _random_dob(age, rng),
        'contact_number': _ph_mobile_number(rng),
        'address': f'{rng.randint(1, 999)} {rng.choice(["Rizal", "Mabini", "Bonifacio", "Del Pilar", "Luna"])} St., '
                   f'{rng.choice(BARANGAYS)}, {rng.choice(CITIES)}',
        'emergency_contact_name': f'{emergency_first} {emergency_last}',
        'emergency_contact_number': _ph_mobile_number(rng),
        'room': f'{ward[:3].upper().strip()}-{rng.randint(100, 499)}',
        'bed_number': rng.choice(['A', 'B', 'C', '1', '2']),
        'ward': ward,
        'diagnosis': rng.choice(DIAGNOSES_BY_WARD.get(ward, ['General Illness'])),
        'admission_date': admission_date,
        'risk_level': risk,
        'status': status,
        'heart_rate': rng.randint(*v['hr']),
        'blood_pressure': f'{rng.randint(*v["sys"])}/{rng.randint(*v["dia"])}',
        'temperature': round(rng.uniform(*v['temp']), 1),
        'oxygen_saturation': rng.randint(*v['spo2']),
        'respiratory_rate': rng.randint(*v['rr']),
    }


class Command(BaseCommand):
    help = (
        f'Top up the Patient table to exactly {TARGET_PATIENT_COUNT} fictional patients, '
        'distributed evenly across active staff nurses. Idempotent: re-running creates '
        'nothing once the target is reached. Never deletes or edits existing patients.'
    )

    def handle(self, *args, **options):
        rng = random.Random()

        with transaction.atomic():
            nurses = list(
                User.objects.filter(
                    nurse_profile__role='staff_nurse', nurse_profile__is_active_staff=True
                ).select_related('nurse_profile')
            )
            if not nurses:
                raise CommandError(
                    'No active staff nurses found — cannot assign patients to anyone. '
                    'Create/approve at least one staff_nurse account first.'
                )

            counts = {n.id: 0 for n in nurses}
            for row in (
                Patient.objects.filter(assigned_nurse__isnull=False)
                .values('assigned_nurse')
                .annotate(c=Count('id'))
            ):
                if row['assigned_nurse'] in counts:
                    counts[row['assigned_nurse']] = row['c']

            heap = [(count, nurse.id) for nurse in nurses for count in [counts[nurse.id]]]
            heapq.heapify(heap)
            nurses_by_id = {n.id: n for n in nurses}

            # Ensure every ward Department referenced above actually exists —
            # it already does via 0027_seed_duty_departments.py in the normal
            # case; get_or_create is a no-op then. Never touches specialty
            # departments/doctors, which 0020 already seeded.
            departments_by_name = {}
            for ward in WARD_DEPARTMENTS:
                dept, _ = Department.objects.get_or_create(name=ward)
                departments_by_name[ward] = dept

            doctors_by_specialty = {}
            for specialty in set(WARD_TO_SPECIALTY.values()):
                doctors_by_specialty[specialty] = list(
                    Doctor.objects.filter(department__name=specialty, status='active')
                )

            # --- Phase 1: backfill pre-existing patients with no nurse ---
            # Excludes discharged patients — a null assigned_nurse there is
            # the correct, intentional post-discharge state (see
            # PatientViewSet.discharge), not a gap to fill.
            backfilled = 0
            for patient in Patient.objects.filter(assigned_nurse__isnull=True).exclude(status='discharged'):
                count, nurse_id = heapq.heappop(heap)
                nurse = nurses_by_id[nurse_id]
                PatientAssignment.objects.create(
                    patient=patient,
                    assigned_nurse=nurse,
                    assigned_nurse_name=nurse_display_name(nurse),
                    status='active',
                )
                heapq.heappush(heap, (count + 1, nurse_id))
                backfilled += 1

            # --- Phase 2: create new patients up to the target ---
            existing_total = Patient.objects.count()
            to_create = max(0, TARGET_PATIENT_COUNT - existing_total)

            created = 0
            for _ in range(to_create):
                count, nurse_id = heapq.heappop(heap)
                nurse = nurses_by_id[nurse_id]

                fields = _generate_patient_fields(rng)
                ward = fields.pop('ward')
                department = departments_by_name[ward]
                specialty = WARD_TO_SPECIALTY[ward]
                pool = doctors_by_specialty.get(specialty) or []
                doctor = rng.choice(pool) if pool else None

                patient = Patient.objects.create(
                    patient_code=next_code(Patient, 'patient_code', 'P'),
                    medical_record_number=next_code(Patient, 'medical_record_number', 'MRN', width=6),
                    department=department,
                    assigned_nurse=nurse,
                    attending_physician=doctor.full_name if doctor else '',
                    **fields,
                )
                open_patient_visit(patient)
                if doctor:
                    PatientDoctor.objects.create(patient=patient, doctor=doctor, status='active')

                heapq.heappush(heap, (count + 1, nurse_id))
                created += 1

            final_total = Patient.objects.count()

        self.stdout.write(self.style.SUCCESS(
            f'Backfilled {backfilled} unassigned patient(s); created {created} new patient(s). '
            f'Total patients: {final_total}.'
        ))
        self.stdout.write('Per-nurse patient counts:')
        final_counts = {
            row['assigned_nurse']: row['c']
            for row in Patient.objects.filter(assigned_nurse__isnull=False)
            .values('assigned_nurse')
            .annotate(c=Count('id'))
        }
        for nurse in nurses:
            self.stdout.write(
                f'  {nurse_display_name(nurse)}: {final_counts.get(nurse.id, 0)}'
            )
