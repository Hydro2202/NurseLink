import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { CheckCircle2, ChevronLeft, Eye, EyeOff } from 'lucide-react-native';
import { Input } from '../Input';
import { Button } from '../Button';
import { Alert, AlertDescription } from '../Alert';
import { Colors, Radius } from '../../constants/colors';
import { registerSignupV2Request } from '../../services/api';
import type { UserRole } from '../../types/user';
import { extractErrorMessage } from './errorUtils';

// Same visual approach as components/PasswordChangeModal.tsx's EyeToggle —
// module-scope so it isn't recreated (and remounted) on every render.
const EyeToggle = ({ show, onToggle }: { show: boolean; onToggle: () => void }) => (
  <Pressable onPress={onToggle} hitSlop={8}>
    {show ? <EyeOff size={16} color={Colors.mutedForeground} /> : <Eye size={16} color={Colors.mutedForeground} />}
  </Pressable>
);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Mirrors the server's explicit rule (api/serializers.py
 *  SignupV2RegisterSerializer.validate_password): >=8 chars, upper, lower,
 *  digit, special character. */
function passwordChecks(password: string) {
  return {
    length: password.length >= 8,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    digit: /\d/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  };
}

function passwordStrength(password: string): 'weak' | 'medium' | 'strong' {
  if (!password) return 'weak';
  const checks = passwordChecks(password);
  const metCount = Object.values(checks).filter(Boolean).length;
  if (metCount >= 5 && password.length >= 10) return 'strong';
  if (metCount >= 3) return 'medium';
  return 'weak';
}

const STRENGTH_COLOR: Record<ReturnType<typeof passwordStrength>, string> = {
  weak: Colors.destructive,
  medium: Colors.warning,
  strong: Colors.green600,
};
const STRENGTH_WIDTH: Record<ReturnType<typeof passwordStrength>, `${number}%`> = {
  weak: '33%',
  medium: '66%',
  strong: '100%',
};
const STRENGTH_LABEL: Record<ReturnType<typeof passwordStrength>, string> = {
  weak: 'Weak',
  medium: 'Medium',
  strong: 'Strong',
};

export interface CredentialsData {
  email: string;
  password: string;
  confirmPassword: string;
}

export interface FullWizardData extends CredentialsData {
  lastName: string;
  firstName: string;
  middleName: string;
  role: UserRole | '';
  personalEmail: string;
  phone: string;
  registrationSessionId: string | null;
}

interface Step4CredentialsProps {
  data: FullWizardData;
  onChange: (patch: Partial<CredentialsData>) => void;
  onBack: () => void;
}

export function Step4Credentials({ data, onChange, onBack }: Step4CredentialsProps) {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const emailValid = EMAIL_REGEX.test(data.email.trim());
  const checks = passwordChecks(data.password);
  const passwordValid = Object.values(checks).every(Boolean);
  const confirmValid = data.confirmPassword.length > 0 && data.confirmPassword === data.password;
  const canSubmit = emailValid && passwordValid && confirmValid && !submitting;
  const strength = passwordStrength(data.password);

  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => router.replace('/login'), 4000);
    return () => clearTimeout(timer);
  }, [success, router]);

  const handleSubmit = async () => {
    if (!canSubmit || !data.registrationSessionId || !data.role) return;
    setSubmitting(true);
    setError('');
    try {
      await registerSignupV2Request({
        lastName: data.lastName,
        firstName: data.firstName,
        middleName: data.middleName,
        role: data.role,
        personalEmail: data.personalEmail.trim().toLowerCase(),
        phone: data.phone.trim(),
        email: data.email.trim().toLowerCase(),
        password: data.password,
        confirmPassword: data.confirmPassword,
        registrationSessionId: data.registrationSessionId,
      });
      setSuccess(true);
    } catch (err) {
      setError(extractErrorMessage(err, 'Unable to create account. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <View style={styles.successBody}>
        <View style={styles.successIconCircle}>
          <CheckCircle2 size={32} color={Colors.green600} />
        </View>
        <Text style={styles.successTitle}>Registration submitted!</Text>
        <Text style={styles.successText}>
          Your account is pending admin approval. You&apos;ll be able to log in once approved.
        </Text>
        <Button onPress={() => router.replace('/login')} size="lg" style={styles.continueBtnFull}>
          Go to Login
        </Button>
      </View>
    );
  }

  return (
    <View style={styles.stepBody}>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Input
        label="Email (used to log in) *"
        placeholder="juan.delacruz@nurselink.com"
        value={data.email}
        onChangeText={(v) => onChange({ email: v })}
        keyboardType="email-address"
        autoCapitalize="none"
      />

      <View style={{ gap: 8 }}>
        <Input
          label="Password *"
          placeholder="Enter a password"
          value={data.password}
          onChangeText={(v) => onChange({ password: v })}
          secureTextEntry={!showPassword}
          rightIcon={<EyeToggle show={showPassword} onToggle={() => setShowPassword((s) => !s)} />}
        />
        {data.password ? (
          <View style={styles.strengthBox}>
            <View style={styles.strengthHeader}>
              <Text style={styles.strengthLabel}>Password Strength</Text>
              <Text style={[styles.strengthValue, { color: STRENGTH_COLOR[strength] }]}>
                {STRENGTH_LABEL[strength]}
              </Text>
            </View>
            <View style={styles.strengthTrack}>
              <View
                style={[
                  styles.strengthFill,
                  { width: STRENGTH_WIDTH[strength], backgroundColor: STRENGTH_COLOR[strength] },
                ]}
              />
            </View>
          </View>
        ) : null}
      </View>

      <Input
        label="Confirm Password *"
        placeholder="Re-enter your password"
        value={data.confirmPassword}
        onChangeText={(v) => onChange({ confirmPassword: v })}
        secureTextEntry={!showConfirm}
        rightIcon={<EyeToggle show={showConfirm} onToggle={() => setShowConfirm((s) => !s)} />}
        error={data.confirmPassword && !confirmValid ? 'Passwords do not match' : undefined}
      />

      <View style={styles.requirements}>
        <Text style={styles.requirementsTitle}>Password Requirements</Text>
        {[
          ['At least 8 characters', checks.length],
          ['One uppercase letter', checks.upper],
          ['One lowercase letter', checks.lower],
          ['One digit', checks.digit],
          ['One special character', checks.special],
        ].map(([label, met]) => (
          <View key={label as string} style={styles.reqRow}>
            <View style={[styles.reqDot, met ? styles.reqDotMet : null]} />
            <Text style={[styles.reqText, met ? styles.reqTextMet : null]}>{label as string}</Text>
          </View>
        ))}
      </View>

      <View style={styles.navRow}>
        <Button variant="outline" onPress={onBack} size="lg" style={styles.backBtn}>
          <ChevronLeft size={18} color={Colors.gray700} />
          <Text style={styles.backText} numberOfLines={1}>Back</Text>
        </Button>
        <Button
          onPress={handleSubmit}
          disabled={!canSubmit}
          loading={submitting}
          size="lg"
          style={[styles.continueBtn, !canSubmit && styles.btnDisabled]}
        >
          <Text style={[styles.btnText, !canSubmit && styles.btnTextDisabled]} numberOfLines={1}>
            Create Account
          </Text>
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stepBody: { gap: 16 },
  continueBtnFull: { backgroundColor: Colors.blue600, borderRadius: 9999, minHeight: 48, marginTop: 8 },
  strengthBox: { gap: 6 },
  strengthHeader: { flexDirection: 'row', justifyContent: 'space-between', minWidth: 0 },
  strengthLabel: { fontSize: 12, color: Colors.gray500, flexShrink: 1 },
  strengthValue: { fontSize: 12, fontWeight: '700', flexShrink: 1 },
  strengthTrack: { height: 6, borderRadius: 3, backgroundColor: Colors.gray200, overflow: 'hidden' },
  strengthFill: { height: 6, borderRadius: 3 },
  requirements: { gap: 6, padding: 12, borderRadius: Radius.md, backgroundColor: Colors.gray50 },
  requirementsTitle: { fontSize: 12, fontWeight: '600', color: Colors.gray600, marginBottom: 2 },
  reqRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  reqDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.gray300 },
  reqDotMet: { backgroundColor: Colors.green600 },
  reqText: { fontSize: 12, color: Colors.gray500, flexShrink: 1 },
  reqTextMet: { color: Colors.green700 },
  navRow: { flexDirection: 'row', gap: 12, marginTop: 4, minWidth: 0 },
  // paddingHorizontal explicitly overrides Button's size="lg" default of 32
  // — at half (or 1/2.5) of a 360px-wide row that default alone leaves too
  // little room for "Back"/"Create Account", which is what was forcing the
  // label to wrap mid-word.
  backBtn: { flex: 1, borderRadius: Radius.full, minHeight: 52, minWidth: 0, paddingHorizontal: 12 },
  continueBtn: {
    flex: 1.6,
    backgroundColor: Colors.blue600,
    borderRadius: Radius.full,
    minHeight: 52,
    minWidth: 0,
    paddingHorizontal: 12,
  },
  btnDisabled: { backgroundColor: Colors.gray200 },
  btnText: { color: Colors.white, fontWeight: '600', fontSize: 15, flexShrink: 1 },
  btnTextDisabled: { color: Colors.gray500 },
  backText: { color: Colors.gray700, fontWeight: '600', fontSize: 15, flexShrink: 1 },
  successBody: { alignItems: 'center', gap: 10, paddingVertical: 12 },
  successIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.green50,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  successTitle: { fontSize: 18, fontWeight: '700', color: Colors.foreground, textAlign: 'center' },
  successText: { fontSize: 13, color: Colors.gray600, textAlign: 'center', lineHeight: 18, paddingHorizontal: 8 },
});
