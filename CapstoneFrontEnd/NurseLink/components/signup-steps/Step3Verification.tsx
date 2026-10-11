import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, ActivityIndicator } from 'react-native';
import { ChevronLeft, Mail, ShieldCheck } from 'lucide-react-native';
import { Input } from '../Input';
import { Button } from '../Button';
import { Alert, AlertDescription } from '../Alert';
import { Colors, Radius } from '../../constants/colors';
import {
  ApiError,
  resendSignupV2OtpRequest,
  sendSignupV2OtpRequest,
  startSignupV2Request,
  verifySignupV2OtpRequest,
} from '../../services/api';
import { extractErrorMessage } from './errorUtils';

/** Philippine mobile number: 09XXXXXXXXX or +639XXXXXXXXX — matches the
 *  server (api/serializers.py PH_PHONE_REGEX). */
const PH_PHONE_REGEX = /^(?:0\d{10}|\+63\d{10})$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidPhone(value: string): boolean {
  return PH_PHONE_REGEX.test(value.trim());
}

export interface VerificationData {
  personalEmail: string;
  phone: string;
  registrationSessionId: string | null;
  otpVerified: boolean;
}

interface Step3VerificationProps {
  data: VerificationData;
  onChange: (patch: Partial<VerificationData>) => void;
  onVerified: () => void;
  onBack: () => void;
}

function OtpDigitsInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const refs = useRef<(TextInput | null)[]>([]);
  const digits = value.split('');

  return (
    <View style={otpStyles.row}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <TextInput
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={digits[i] ?? ''}
          onChangeText={(text) => {
            const clean = text.replace(/[^0-9]/g, '').slice(-1);
            const next = value.split('');
            next[i] = clean;
            const joined = next.join('').slice(0, 6);
            onChange(joined);
            if (clean && i < 5) refs.current[i + 1]?.focus();
          }}
          onKeyPress={({ nativeEvent }) => {
            if (nativeEvent.key === 'Backspace' && !digits[i] && i > 0) {
              refs.current[i - 1]?.focus();
            }
          }}
          keyboardType="number-pad"
          maxLength={1}
          editable={!disabled}
          style={[otpStyles.box, disabled && otpStyles.boxDisabled]}
        />
      ))}
    </View>
  );
}

type OtpPhase = 'form' | 'sending' | 'awaiting' | 'verifying' | 'verified';

export function Step3Verification({ data, onChange, onVerified, onBack }: Step3VerificationProps) {
  const [phase, setPhase] = useState<OtpPhase>(data.otpVerified ? 'verified' : 'form');
  const [otpCode, setOtpCode] = useState('');
  const [error, setError] = useState('');
  const [otpExpiresAt, setOtpExpiresAt] = useState<number | null>(null);
  const [resendAvailableAt, setResendAvailableAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const sendInFlight = useRef(false);
  const verifyInFlight = useRef(false);

  useEffect(() => {
    if (phase !== 'awaiting') return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [phase]);

  const emailValid = EMAIL_REGEX.test(data.personalEmail.trim());
  const phoneValid = isValidPhone(data.phone);
  const canSend = emailValid && phoneValid;

  const resendSecondsLeft = resendAvailableAt ? Math.max(0, Math.ceil((resendAvailableAt - nowTick) / 1000)) : 0;
  const otpExpired = otpExpiresAt ? nowTick > otpExpiresAt : false;

  const applyRetryAfter = (err: unknown) => {
    if (err instanceof ApiError && err.status === 429) {
      const retryAfter = (err.data as { retryAfter?: number } | undefined)?.retryAfter;
      if (typeof retryAfter === 'number' && retryAfter > 0) {
        setResendAvailableAt(Date.now() + retryAfter * 1000);
      }
    }
  };

  const handleSendOtp = async () => {
    if (sendInFlight.current || !canSend) return;
    sendInFlight.current = true;
    setPhase('sending');
    setError('');
    try {
      const started = await startSignupV2Request(data.personalEmail.trim().toLowerCase(), data.phone.trim());
      onChange({ registrationSessionId: started.registrationSessionId });
      const res = await sendSignupV2OtpRequest(started.registrationSessionId);
      setPhase('awaiting');
      setOtpCode('');
      setOtpExpiresAt(Date.now() + (res.expiresIn ?? 300) * 1000);
      setResendAvailableAt(Date.now() + (res.resendCooldown ?? 60) * 1000);
    } catch (err) {
      setPhase('form');
      applyRetryAfter(err);
      setError(extractErrorMessage(err, 'Could not send the verification code. Please try again.'));
    } finally {
      sendInFlight.current = false;
    }
  };

  const handleResendOtp = async () => {
    if (sendInFlight.current || !data.registrationSessionId || resendSecondsLeft > 0) return;
    sendInFlight.current = true;
    setPhase('sending');
    setError('');
    try {
      const res = await resendSignupV2OtpRequest(data.registrationSessionId);
      setPhase('awaiting');
      setOtpCode('');
      setOtpExpiresAt(Date.now() + (res.expiresIn ?? 300) * 1000);
      setResendAvailableAt(Date.now() + (res.resendCooldown ?? 60) * 1000);
    } catch (err) {
      setPhase('awaiting');
      applyRetryAfter(err);
      setError(extractErrorMessage(err, 'Failed to resend verification code. Please try again.'));
    } finally {
      sendInFlight.current = false;
    }
  };

  const handleVerifyOtp = async () => {
    if (verifyInFlight.current || !data.registrationSessionId || otpCode.length !== 6) return;
    verifyInFlight.current = true;
    setPhase('verifying');
    setError('');
    try {
      const res = await verifySignupV2OtpRequest(otpCode, data.registrationSessionId);
      if (res.verified) {
        setPhase('verified');
        onChange({ otpVerified: true });
        onVerified();
      } else {
        setPhase('awaiting');
        // The server returns the specific NOT_FOUND/EXPIRED/MAX_ATTEMPTS/INVALID
        // message verbatim (see api/otp_service.verify_otp) — shown as-is.
        setError(res.message || 'Invalid or expired verification code.');
      }
    } catch (err) {
      setPhase('awaiting');
      setError(extractErrorMessage(err, 'Invalid or expired verification code.'));
    } finally {
      verifyInFlight.current = false;
    }
  };

  if (phase === 'verified') {
    return (
      <View style={styles.stepBody}>
        <View style={styles.verifiedBox}>
          <ShieldCheck size={22} color={Colors.green600} />
          <Text style={styles.verifiedText}>Email verified. You&apos;re all set for the last step.</Text>
        </View>
        <View style={styles.navRow}>
          <Button variant="outline" onPress={onBack} size="lg" style={styles.backBtn}>
            <ChevronLeft size={18} color={Colors.gray700} />
            <Text style={styles.backText} numberOfLines={1}>Back</Text>
          </Button>
          <Button onPress={onVerified} size="lg" style={styles.continueBtn}>
            <Text style={styles.btnText} numberOfLines={1}>Continue</Text>
          </Button>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.stepBody}>
      <View style={styles.introRow}>
        <View style={styles.iconCircle}>
          <Mail size={20} color={Colors.blue600} />
        </View>
        <Text style={styles.introText}>
          We&apos;ll email a 6-digit code to verify your personal email address.
        </Text>
      </View>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Input
        label="Personal Email *"
        placeholder="juan.delacruz@gmail.com"
        value={data.personalEmail}
        onChangeText={(v) => onChange({ personalEmail: v })}
        editable={phase === 'form'}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <Input
        label="Phone Number *"
        placeholder="09123456789"
        value={data.phone}
        onChangeText={(v) => onChange({ phone: v })}
        editable={phase === 'form'}
        keyboardType="phone-pad"
      />

      {phase === 'form' && (
        <Button onPress={handleSendOtp} disabled={!canSend} size="lg" style={styles.continueBtnFull}>
          Send OTP
        </Button>
      )}

      {phase === 'sending' && (
        <View style={styles.sendingRow}>
          <ActivityIndicator size="small" color={Colors.blue600} />
          <Text style={styles.sendingText}>Sending verification code...</Text>
        </View>
      )}

      {(phase === 'awaiting' || phase === 'verifying') && (
        <View style={styles.otpSection}>
          <Text style={styles.otpLabel}>
            Enter the 6-digit code sent to {data.personalEmail.trim()}
            {otpExpired ? ' (expired — request a new one)' : ''}
          </Text>
          <OtpDigitsInput value={otpCode} onChange={setOtpCode} disabled={phase === 'verifying'} />
          <Button
            onPress={handleVerifyOtp}
            disabled={otpCode.length !== 6 || phase === 'verifying'}
            loading={phase === 'verifying'}
            size="lg"
            style={styles.continueBtnFull}
          >
            Verify
          </Button>
          <Button
            variant="outline"
            onPress={handleResendOtp}
            disabled={resendSecondsLeft > 0}
            size="lg"
            style={styles.resendBtn}
          >
            {resendSecondsLeft > 0 ? `Resend OTP (${resendSecondsLeft}s)` : 'Resend OTP'}
          </Button>
        </View>
      )}

      <View style={styles.navRow}>
        <Button variant="outline" onPress={onBack} size="lg" style={styles.backBtn}>
          <ChevronLeft size={18} color={Colors.gray700} />
          <Text style={styles.backText} numberOfLines={1}>Back</Text>
        </Button>
      </View>
    </View>
  );
}

const otpStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, width: '100%' },
  box: {
    flex: 1,
    maxWidth: 44,
    height: 48,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '700',
    color: Colors.gray900,
  },
  boxDisabled: { backgroundColor: Colors.gray100, color: Colors.gray500 },
});

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
  continueBtnFull: { backgroundColor: Colors.blue600, borderRadius: 9999, minHeight: 48 },
  sendingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  sendingText: { fontSize: 13, color: Colors.blue600, flexShrink: 1 },
  otpSection: { gap: 12 },
  otpLabel: { fontSize: 13, color: Colors.gray600 },
  resendBtn: { borderRadius: 9999, minHeight: 44 },
  verifiedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
    padding: 14,
    borderRadius: Radius.lg,
    backgroundColor: Colors.green50,
    borderWidth: 1,
    borderColor: Colors.green200,
  },
  verifiedText: { flex: 1, flexShrink: 1, minWidth: 0, fontSize: 13, color: Colors.green700, fontWeight: '600' },
  navRow: { flexDirection: 'row', gap: 12, marginTop: 4, minWidth: 0 },
  // paddingHorizontal explicitly overrides Button's size="lg" default of 32
  // — at half (or 1/2.5) of a 360px-wide row that default alone leaves too
  // little room for "Back"/"Continue" and the chevron, which is what was
  // forcing the label to wrap mid-word.
  backBtn: { flex: 1, borderRadius: Radius.full, minHeight: 52, minWidth: 0, paddingHorizontal: 12 },
  continueBtn: {
    flex: 1.6,
    backgroundColor: Colors.blue600,
    borderRadius: Radius.full,
    minHeight: 52,
    minWidth: 0,
    paddingHorizontal: 12,
  },
  btnText: { color: Colors.white, fontWeight: '600', fontSize: 15, flexShrink: 1 },
  backText: { color: Colors.gray700, fontWeight: '600', fontSize: 15, flexShrink: 1 },
});
