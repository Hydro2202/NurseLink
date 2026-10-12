import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Link } from 'expo-router';
import { User2 } from 'lucide-react-native';
import { Input } from '../Input';
import { Button } from '../Button';
import { Alert, AlertDescription } from '../Alert';
import { Colors } from '../../constants/colors';
import { checkSignupV2NameRequest } from '../../services/api';
import { extractErrorMessage } from './errorUtils';

/** Letters, spaces, hyphens, apostrophes and full stops — matches the server
 *  (api/serializers.py SignupV2RegisterSerializer._validate_name_part). */
const NAME_REGEX = /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ '\-.]{0,99}$/;

export function isValidNamePart(value: string, required: boolean): boolean {
  const trimmed = value.trim();
  if (!trimmed) return !required;
  return NAME_REGEX.test(trimmed);
}

export interface PersonalInfoData {
  lastName: string;
  firstName: string;
  middleName: string;
}

interface Step1PersonalInfoProps {
  data: PersonalInfoData;
  onChange: (patch: Partial<PersonalInfoData>) => void;
  onNext: () => void;
}

export function Step1PersonalInfo({ data, onChange, onNext }: Step1PersonalInfoProps) {
  const [touched, setTouched] = React.useState<Record<string, boolean>>({});
  const [checking, setChecking] = React.useState(false);
  const [nameError, setNameError] = React.useState('');

  const lastNameValid = isValidNamePart(data.lastName, true);
  const firstNameValid = isValidNamePart(data.firstName, true);
  const middleNameValid = isValidNamePart(data.middleName, false);
  const canContinue = lastNameValid && firstNameValid && middleNameValid && !checking;

  const handleContinue = async () => {
    setTouched({ lastName: true, firstName: true, middleName: true });
    if (!lastNameValid || !firstNameValid || !middleNameValid) return;
    setNameError('');
    setChecking(true);
    try {
      const result = await checkSignupV2NameRequest(
        data.lastName.trim(),
        data.firstName.trim(),
        data.middleName.trim()
      );
      if (!result.available) {
        setNameError(result.message || 'An account with this name already exists. Contact an administrator.');
        return;
      }
      onNext();
    } catch (err) {
      setNameError(extractErrorMessage(err, 'Could not check this name right now. Please try again.'));
    } finally {
      setChecking(false);
    }
  };

  const errorFor = (field: 'lastName' | 'firstName' | 'middleName', valid: boolean, label: string) => {
    if (!touched[field] || valid) return undefined;
    const value = data[field].trim();
    if (!value) return `${label} is required`;
    return `${label} may only contain letters, spaces, hyphens, periods, and apostrophes`;
  };

  return (
    <View style={styles.stepBody}>
      <View style={styles.introRow}>
        <View style={styles.iconCircle}>
          <User2 size={20} color={Colors.blue600} />
        </View>
        <Text style={styles.introText}>Let&apos;s start with your name, exactly as it appears on your ID.</Text>
      </View>

      <Input
        label="Last Name *"
        placeholder="Dela Cruz"
        value={data.lastName}
        onChangeText={(v) => {
          onChange({ lastName: v });
          setNameError('');
        }}
        onBlur={() => setTouched((t) => ({ ...t, lastName: true }))}
        error={errorFor('lastName', lastNameValid, 'Last name')}
        autoCapitalize="words"
      />
      <Input
        label="First Name *"
        placeholder="Juan"
        value={data.firstName}
        onChangeText={(v) => {
          onChange({ firstName: v });
          setNameError('');
        }}
        onBlur={() => setTouched((t) => ({ ...t, firstName: true }))}
        error={errorFor('firstName', firstNameValid, 'First name')}
        autoCapitalize="words"
      />
      <Input
        label="Middle Name"
        placeholder="Optional"
        value={data.middleName}
        onChangeText={(v) => {
          onChange({ middleName: v });
          setNameError('');
        }}
        onBlur={() => setTouched((t) => ({ ...t, middleName: true }))}
        error={errorFor('middleName', middleNameValid, 'Middle name')}
        autoCapitalize="words"
      />

      {nameError ? (
        <Alert variant="destructive">
          <AlertDescription>{nameError}</AlertDescription>
        </Alert>
      ) : null}

      <Button
        onPress={handleContinue}
        disabled={!canContinue}
        loading={checking}
        size="lg"
        style={styles.continueBtn}
      >
        Continue
      </Button>

      <Text style={styles.footerText}>
        Already have an account?{' '}
        <Link href="/login" style={styles.footerLink}>
          Log in
        </Link>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stepBody: { gap: 16 },
  introRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0 },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.blue100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  introText: { flex: 1, flexShrink: 1, minWidth: 0, fontSize: 13, color: Colors.gray600, lineHeight: 18 },
  continueBtn: { backgroundColor: Colors.blue600, borderRadius: 9999, minHeight: 48, marginTop: 4 },
  footerText: { textAlign: 'center', fontSize: 13, color: Colors.gray500 },
  footerLink: { color: Colors.blue600, fontWeight: '600' },
});
