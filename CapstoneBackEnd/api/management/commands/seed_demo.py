from datetime import date

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from rest_framework.authtoken.models import Token

from api.models import NurseProfile, Patient

DEMO_USERS = [
    {
        'email': 'nurse@hospital.com',
        'password': 'password123',
        'first_name': 'Anna',
        'last_name': 'Reyes',
        'role': 'staff_nurse',
        'department': 'Medical-Surgical Unit',
        'license_number': 'RN-10001',
    },
    {
        'email': 'head@hospital.com',
        'password': 'password123',
        'first_name': 'Maria',
        'last_name': 'Santos',
        'role': 'supervisor',
        'department': 'Nursing Administration',
        'license_number': 'RN-20001',
    },
]

DEMO_PATIENTS = [
    {
        'patient_code': 'P001',
        'name': 'John Smith',
        'age': 68,
        'gender': 'Male',
        'room': 'ICU-201',
        'diagnosis': 'Post-operative cardiac surgery',
        'admission_date': date(2026, 3, 20),
        'risk_level': 'high',
        'heart_rate': 92,
        'blood_pressure': '145/88',
        'temperature': 37.8,
        'oxygen_saturation': 94,
        'respiratory_rate': 18,
        'allergies': ['Penicillin', 'Latex'],
        'medications': ['Aspirin 100mg', 'Metoprolol 50mg', 'Atorvastatin 40mg'],
        'alerts': ['Post-op monitoring required', 'Fall risk - high'],
    },
    {
        'patient_code': 'P002',
        'name': 'Maria Garcia',
        'age': 54,
        'gender': 'Female',
        'room': 'ICU-202',
        'diagnosis': 'Septic shock',
        'admission_date': date(2026, 3, 24),
        'risk_level': 'high',
        'heart_rate': 118,
        'blood_pressure': '98/62',
        'temperature': 38.9,
        'oxygen_saturation': 91,
        'respiratory_rate': 24,
        'allergies': ['Sulfa drugs'],
        'medications': ['Broad-spectrum antibiotics', 'Vasopressors', 'IV fluids'],
        'alerts': ['Critical - unstable vital signs', 'Hourly monitoring required'],
    },
    {
        'patient_code': 'P003',
        'name': 'Robert Chen',
        'age': 45,
        'gender': 'Male',
        'room': 'ICU-203',
        'diagnosis': 'Pneumonia with respiratory distress',
        'admission_date': date(2026, 3, 23),
        'risk_level': 'medium',
        'heart_rate': 88,
        'blood_pressure': '128/78',
        'temperature': 37.2,
        'oxygen_saturation': 96,
        'respiratory_rate': 16,
        'allergies': ['None known'],
        'medications': ['Ceftriaxone', 'Albuterol nebulizer'],
        'alerts': ['Improving condition', 'May transfer to ward tomorrow'],
    },
    {
        'patient_code': 'P004',
        'name': 'Sarah Williams',
        'age': 72,
        'gender': 'Female',
        'room': 'Ward-301',
        'diagnosis': 'Diabetes mellitus with hyperglycemia',
        'admission_date': date(2026, 3, 25),
        'risk_level': 'medium',
        'heart_rate': 76,
        'blood_pressure': '138/82',
        'temperature': 36.8,
        'oxygen_saturation': 98,
        'respiratory_rate': 14,
        'allergies': ['None known'],
        'medications': ['Insulin sliding scale', 'Metformin 1000mg'],
        'alerts': ['Monitor blood glucose q4h'],
    },
    {
        'patient_code': 'P005',
        'name': 'David Thompson',
        'age': 59,
        'gender': 'Male',
        'room': 'Ward-302',
        'diagnosis': 'Acute kidney injury',
        'admission_date': date(2026, 3, 26),
        'risk_level': 'high',
        'heart_rate': 84,
        'blood_pressure': '152/94',
        'temperature': 37.1,
        'oxygen_saturation': 97,
        'respiratory_rate': 15,
        'allergies': ['NSAIDs'],
        'medications': ['Furosemide 40mg', 'Calcium acetate'],
        'alerts': ['Strict I&O monitoring', 'Dialysis planned'],
    },
    {
        'patient_code': 'P006',
        'name': 'Linda Martinez',
        'age': 41,
        'gender': 'Female',
        'room': 'Ward-303',
        'diagnosis': 'Postpartum hemorrhage',
        'admission_date': date(2026, 3, 27),
        'risk_level': 'medium',
        'heart_rate': 102,
        'blood_pressure': '108/68',
        'temperature': 37.4,
        'oxygen_saturation': 96,
        'respiratory_rate': 18,
        'allergies': ['Codeine'],
        'medications': ['Oxytocin IV', 'Iron supplements', 'Ibuprofen 600mg'],
        'alerts': ['Monitor for signs of infection', 'Breastfeeding support needed'],
    },
    {
        'patient_code': 'P007',
        'name': 'James Anderson',
        'age': 81,
        'gender': 'Male',
        'room': 'ICU-204',
        'diagnosis': 'Stroke (CVA) with left-sided weakness',
        'admission_date': date(2026, 3, 21),
        'risk_level': 'high',
        'heart_rate': 68,
        'blood_pressure': '162/96',
        'temperature': 36.9,
        'oxygen_saturation': 95,
        'respiratory_rate': 16,
        'allergies': ['Aspirin'],
        'medications': ['Clopidogrel', 'Atorvastatin', 'Amlodipine'],
        'alerts': ['Aspiration risk - thickened liquids only', 'Fall risk - high'],
    },
    {
        'patient_code': 'P008',
        'name': 'Patricia Lee',
        'age': 63,
        'gender': 'Female',
        'room': 'Ward-304',
        'diagnosis': 'Community-acquired pneumonia',
        'admission_date': date(2026, 3, 28),
        'risk_level': 'low',
        'heart_rate': 74,
        'blood_pressure': '124/76',
        'temperature': 36.7,
        'oxygen_saturation': 98,
        'respiratory_rate': 14,
        'allergies': ['None known'],
        'medications': ['Azithromycin', 'Acetaminophen'],
        'alerts': ['Stable - prepare for discharge'],
    },
]


class Command(BaseCommand):
    help = 'Seed demo nurses and patients for NurseLink'

    def handle(self, *args, **options):
        nurse_user = None

        for data in DEMO_USERS:
            user, created = User.objects.get_or_create(
                username=data['email'],
                defaults={
                    'email': data['email'],
                    'first_name': data['first_name'],
                    'last_name': data['last_name'],
                },
            )
            if created:
                user.set_password(data['password'])
                user.save()
                self.stdout.write(self.style.SUCCESS(f'Created user {data["email"]}'))
            else:
                user.email = data['email']
                user.first_name = data['first_name']
                user.last_name = data['last_name']
                user.set_password(data['password'])
                user.save()
                self.stdout.write(f'Updated user {data["email"]}')

            NurseProfile.objects.update_or_create(
                user=user,
                defaults={
                    'role': data['role'],
                    'department': data['department'],
                    'license_number': data['license_number'],
                },
            )
            Token.objects.get_or_create(user=user)

            if data['role'] == 'staff_nurse':
                nurse_user = user

        for pdata in DEMO_PATIENTS:
            patient, created = Patient.objects.update_or_create(
                patient_code=pdata['patient_code'],
                defaults={
                    **{k: v for k, v in pdata.items() if k != 'patient_code'},
                    'assigned_nurse': nurse_user,
                },
            )
            action = 'Created' if created else 'Updated'
            self.stdout.write(f'{action} patient {patient.patient_code}')

        self.stdout.write(self.style.SUCCESS('Seed complete.'))
        self.stdout.write('Demo logins:')
        self.stdout.write('  nurse@hospital.com / password123  (staff_nurse)')
        self.stdout.write('  head@hospital.com / password123   (supervisor)')
