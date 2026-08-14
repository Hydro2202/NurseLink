"""
Tests for api/id_field_validation.py — the strict, label-independent
guarantee layer for the six PRC-ID fields Step 2 displays. These are unit
tests against the module directly; the end-to-end version (through
VerifyIdView, proving a garbled n8n response never reaches the database)
lives in tests_n8n_integration.py.
"""

from datetime import date

from django.test import SimpleTestCase

from api.id_field_validation import (
    clean_registration_no,
    is_valid_person_name,
    parse_flexible_date,
    validate_prc_id_fields,
)


class NameValidationTests(SimpleTestCase):
    def test_accepts_real_names(self):
        for name in ('Mangulabnan', 'Dela Cruz', "O'Brien", 'Jose-Maria', 'Núñez'):
            self.assertTrue(is_valid_person_name(name), name)

    def test_rejects_a_date_swallowed_as_a_name(self):
        # This is the exact reported bug: a mis-parsed field-label-plus-date
        # fragment ending up where a surname belongs.
        self.assertFalse(is_valid_person_name('REGISTRATION DATE May 21'))
        self.assertFalse(is_valid_person_name('2005'))
        self.assertFalse(is_valid_person_name('May 21, 2005'))
        self.assertFalse(is_valid_person_name('05/21/2005'))

    def test_rejects_label_text_and_junk(self):
        self.assertFalse(is_valid_person_name('VALID UNTIL'))
        self.assertFalse(is_valid_person_name('REGISTRATION NO. 1234567'))
        self.assertFalse(is_valid_person_name('nurse@example.com'))
        self.assertFalse(is_valid_person_name('https://example.com'))

    def test_middle_name_optional(self):
        self.assertTrue(is_valid_person_name('', required=False))
        self.assertTrue(is_valid_person_name(None, required=False))
        self.assertFalse(is_valid_person_name('', required=True))


class RegistrationNumberValidationTests(SimpleTestCase):
    def test_accepts_plain_digits(self):
        self.assertEqual(clean_registration_no('1234567'), '1234567')

    def test_preserves_leading_zeros_as_a_string(self):
        result = clean_registration_no('0123456')
        self.assertEqual(result, '0123456')
        self.assertIsInstance(result, str)

    def test_strips_label_noise(self):
        self.assertEqual(clean_registration_no('REGISTRATION NO. 1234567'), '1234567')

    def test_requires_exactly_seven_digits(self):
        # Matches the established convention in prc_ocr.py
        # (_extract_registration_number) — a 6 or 8 digit run is a
        # truncated/extended OCR misread, not a plausible alternate length.
        self.assertIsNone(clean_registration_no('123456'))
        self.assertIsNone(clean_registration_no('12345678'))
        self.assertIsNone(clean_registration_no('123'))
        self.assertIsNone(clean_registration_no('1234567890123'))

    def test_a_bare_4_digit_year_is_never_mistaken_for_a_registration_number(self):
        # The exact reported field-mixing failure mode: a year fragment
        # ("2005") landing in registration_no instead of a real 7-digit ID.
        self.assertIsNone(clean_registration_no('2005'))

    def test_rejects_blank(self):
        self.assertIsNone(clean_registration_no(''))
        self.assertIsNone(clean_registration_no(None))


class DateParsingTests(SimpleTestCase):
    def test_parses_month_name_dates(self):
        self.assertEqual(parse_flexible_date('May 21, 2005'), date(2005, 5, 21))
        self.assertEqual(parse_flexible_date('May 21 2005'), date(2005, 5, 21))

    def test_parses_numeric_mm_dd_yyyy(self):
        self.assertEqual(parse_flexible_date('05/21/2005'), date(2005, 5, 21))

    def test_parses_iso(self):
        self.assertEqual(parse_flexible_date('2005-05-21'), date(2005, 5, 21))

    def test_two_digit_year_pivots_to_the_plausible_century(self):
        # A PRC nurse could easily have registered decades ago — "85" must
        # read as 1985, not 2085.
        self.assertEqual(parse_flexible_date('06/15/85'), date(1985, 6, 15))
        self.assertEqual(parse_flexible_date('06/15/05'), date(2005, 6, 15))

    def test_leap_year_handled_correctly(self):
        self.assertEqual(parse_flexible_date('Feb 29, 2020'), date(2020, 2, 29))
        self.assertIsNone(parse_flexible_date('Feb 29, 2021'))  # 2021 is not a leap year

    def test_parses_abbreviated_and_ordinal_month_names(self):
        self.assertEqual(parse_flexible_date('Sept 5, 2015'), date(2015, 9, 5))
        self.assertEqual(parse_flexible_date('March 3rd, 2010'), date(2010, 3, 3))
        self.assertEqual(parse_flexible_date('November 22nd 2018'), date(2018, 11, 22))

    def test_returns_none_for_unparseable_or_impossible_dates(self):
        self.assertIsNone(parse_flexible_date('not a date'))
        self.assertIsNone(parse_flexible_date(''))
        self.assertIsNone(parse_flexible_date(None))
        self.assertIsNone(parse_flexible_date('13/45/2005'))  # no month 13, no day 45


class ValidatePrcIdFieldsTests(SimpleTestCase):
    def test_the_reported_bug_is_rejected_not_silently_stored(self):
        """
        The exact garbled extraction from the bug report: a stray
        "REGISTRATION DATE May 21" fragment in last_name, a bare "2005" in
        first_name, registration_date never separately extracted.
        """
        result = validate_prc_id_fields(
            last_name='REGISTRATION DATE May 21',
            first_name='2005',
            middle_name='',
            registration_no='1234567',
            registration_date=None,
            valid_until='May 21, 2005',
        )
        self.assertFalse(result.valid)
        self.assertEqual(result.status, 'validation_error')
        self.assertIn('last_name', result.errors)
        self.assertIn('first_name', result.errors)
        self.assertIn('registration_date', result.errors)

    def test_the_correct_extraction_is_accepted_and_normalized(self):
        result = validate_prc_id_fields(
            last_name='Mangulabnan',
            first_name='Lawrence',
            middle_name='Yanggao',
            registration_no='1234567',
            registration_date='May 21, 2005',
            valid_until='May 21, 2010',
        )
        self.assertTrue(result.valid)
        self.assertEqual(result.status, 'verified')
        self.assertEqual(
            result.cleaned,
            {
                'last_name': 'Mangulabnan',
                'first_name': 'Lawrence',
                'middle_name': 'Yanggao',
                'registration_no': '1234567',
                'registration_date': '2005-05-21',
                'valid_until': '2010-05-21',
            },
        )

    def test_missing_middle_name_is_fine(self):
        result = validate_prc_id_fields(
            last_name='Mangulabnan',
            first_name='Lawrence',
            middle_name=None,
            registration_no='1234567',
            registration_date='05/21/2005',
            valid_until='05/21/2010',
        )
        self.assertTrue(result.valid)
        self.assertEqual(result.cleaned['middle_name'], '')

    def test_registration_date_after_valid_until_is_a_sanity_error(self):
        result = validate_prc_id_fields(
            last_name='Mangulabnan',
            first_name='Lawrence',
            middle_name='Yanggao',
            registration_no='1234567',
            registration_date='05/21/2010',  # later than...
            valid_until='05/21/2005',        # ...this
        )
        self.assertFalse(result.valid)
        self.assertEqual(result.status, 'validation_error')
        self.assertIn('registration_date', result.errors)
        self.assertIn('valid_until', result.errors)

    def test_swapped_registration_date_and_valid_until_labels(self):
        """A workflow that mixed up which label maps to which value produces
        a sanity-check failure, not a silently-accepted swap."""
        result = validate_prc_id_fields(
            last_name='Mangulabnan',
            first_name='Lawrence',
            middle_name='Yanggao',
            registration_no='1234567',
            registration_date='May 21, 2010',
            valid_until='May 21, 2005',
        )
        self.assertFalse(result.valid)
