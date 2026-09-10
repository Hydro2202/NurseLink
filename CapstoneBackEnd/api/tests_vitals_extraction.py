"""
api/vitals_extraction.py — deterministic numeric extraction of vitals from a
nurse's free-text assessment. This is the primary source ChartingViewSet.
structure uses for a note's vitalSigns (see api/views.py), because the n8n
structure-chart workflow's own LLM node does not reliably return one —
confirmed by calling it live with unambiguous vitals language and getting
back prose with no vitalSigns key at all.
"""

from django.test import SimpleTestCase

from .vitals_extraction import extract_vitals_from_text


class VitalsExtractionTests(SimpleTestCase):
    def test_extracts_heart_rate(self):
        self.assertEqual(
            extract_vitals_from_text('Heart rate 110 bpm, irregular.'), {'heartRate': 110}
        )

    def test_extracts_heart_rate_via_hr_abbreviation(self):
        self.assertEqual(extract_vitals_from_text('HR: 88, regular rhythm.'), {'heartRate': 88})

    def test_extracts_heart_rate_via_pulse(self):
        self.assertEqual(extract_vitals_from_text('Pulse 72, strong.'), {'heartRate': 72})

    def test_extracts_temperature_celsius(self):
        self.assertEqual(
            extract_vitals_from_text('Temperature 38.6C, febrile.'), {'temperature': 38.6}
        )

    def test_extracts_temperature_fahrenheit_and_converts_to_celsius(self):
        result = extract_vitals_from_text('Temp 101.3F, patient warm to touch.')
        self.assertAlmostEqual(result['temperature'], 38.5, places=1)

    def test_extracts_oxygen_saturation(self):
        self.assertEqual(
            extract_vitals_from_text('SpO2 92% on room air, mildly desaturated.'),
            {'oxygenSaturation': 92},
        )

    def test_extracts_oxygen_saturation_via_o2_sat(self):
        self.assertEqual(
            extract_vitals_from_text('O2 sat is 97%.'), {'oxygenSaturation': 97}
        )

    def test_extracts_respiratory_rate(self):
        self.assertEqual(
            extract_vitals_from_text('Respiratory rate 24, mildly tachypneic.'),
            {'respiratoryRate': 24},
        )

    def test_extracts_respiratory_rate_via_rr(self):
        self.assertEqual(extract_vitals_from_text('RR 18.'), {'respiratoryRate': 18})

    def test_extracts_blood_pressure(self):
        self.assertEqual(
            extract_vitals_from_text('BP 160/100, elevated from baseline.'),
            {'bloodPressure': '160/100'},
        )

    def test_extracts_blood_pressure_via_full_label(self):
        self.assertEqual(
            extract_vitals_from_text('Blood pressure: 130/85.'), {'bloodPressure': '130/85'}
        )

    def test_extracts_pain_scale(self):
        self.assertEqual(extract_vitals_from_text('Pain scale 7/10.'), {'painScale': 7})

    def test_extracts_multiple_vitals_in_one_note(self):
        text = (
            'Patient alert and oriented x3. Heart rate 110 bpm, irregular. '
            'Temperature 38.6C, febrile. SpO2 92% on room air. '
            'Respiratory rate 24. BP 160/100, elevated from baseline.'
        )
        result = extract_vitals_from_text(text)
        self.assertEqual(
            result,
            {
                'heartRate': 110, 'temperature': 38.6, 'oxygenSaturation': 92,
                'respiratoryRate': 24, 'bloodPressure': '160/100',
            },
        )

    def test_vitals_not_mentioned_are_absent_not_zero(self):
        result = extract_vitals_from_text('Heart rate 88. Patient resting comfortably.')
        self.assertEqual(result, {'heartRate': 88})
        self.assertNotIn('bloodPressure', result)
        self.assertNotIn('temperature', result)

    def test_no_vitals_mentioned_returns_empty_dict(self):
        self.assertEqual(
            extract_vitals_from_text('Patient ambulated to chair, tolerated well.'), {}
        )

    def test_empty_text_returns_empty_dict(self):
        self.assertEqual(extract_vitals_from_text(''), {})
        self.assertEqual(extract_vitals_from_text(None), {})

    def test_unrelated_numbers_are_not_mistaken_for_vitals(self):
        # "Room 204", "day 3 post-op" — numbers with no vital-sign label
        # nearby must never be picked up.
        result = extract_vitals_from_text('Room 204, day 3 post-op, ambulated 2 laps.')
        self.assertEqual(result, {})
