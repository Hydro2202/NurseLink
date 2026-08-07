// I change this by rai
import React, { useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Mail, ShieldCheck } from 'lucide-react-native';
import { Colors, Radius } from '../../constants/colors';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { requestEmailOtp, verifyEmailOtp, ApiError } from '../../services/api';

type Props = {
  initialEmail?: string;
  onVerified: (otpVerificationId: number, email: string) => void;
};

type Phase = 'email' | 'code';

export function OtpVerification({ initialEmail, onVerified }: Props) {
  const [phase, setPhase] = useState<Phase>('email');
  const [email, setEmail] = useState(initialEmail ?? '');
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const sendCode = async () => {
    if (!emailValid) {
      setError('Enter a valid email address.');
      return;
    }
    setError('');
    setInfo('');
    setSending(true);
    try {
      await requestEmailOtp(email.trim());
      setPhase('code');
      setInfo(`A 6-digit code was sent to ${email.trim()}.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not send a verification code. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const verifyCode = async () => {
    if (code.trim().length !== 6) {
      setError('Enter the 6-digit code from your email.');
      return;
    }
    setError('');
    setVerifying(true);
    try {
      const result = await verifyEmailOtp(email.trim(), code.trim());
      onVerified(result.otpVerificationId, email.trim());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Verification failed. Please try again.');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.iconCircle}>
        <Mail size={22} color={Colors.blue600} />
      </View>
      <Text style={styles.title}>Verify by email instead</Text>
      <Text style={styles.desc}>
        We couldn&apos;t confirm your face after several attempts. Enter your email and we&apos;ll send a one-time
        code so you can continue registering.
      </Text>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {info && !error ? <Text style={styles.infoText}>{info}</Text> : null}

      {phase === 'email' ? (
        <>
          <Input
            label="Email Address"
            placeholder="you@example.com"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            leftIcon={<Mail size={16} color={Colors.gray500} />}
          />
          <Button onPress={sendCode} disabled={sending} size="lg" style={styles.actionBtn}>
            {sending ? <ActivityIndicator color={Colors.white} /> : <Text style={styles.actionBtnText}>Send code</Text>}
          </Button>
        </>
      ) : (
        <>
          <Input
            label="6-digit code"
            placeholder="123456"
            value={code}
            onChangeText={(v) => setCode(v.replace(/[^0-9]/g, '').slice(0, 6))}
            keyboardType="number-pad"
            maxLength={6}
            leftIcon={<ShieldCheck size={16} color={Colors.gray500} />}
          />
          <Button onPress={verifyCode} disabled={verifying} size="lg" style={styles.actionBtn}>
            {verifying ? <ActivityIndicator color={Colors.white} /> : <Text style={styles.actionBtnText}>Verify code</Text>}
          </Button>
          <Button
            variant="outline"
            onPress={() => {
              setPhase('email');
              setCode('');
              setError('');
              setInfo('');
            }}
            size="lg"
            style={styles.secondaryBtn}
          >
            <Text style={styles.secondaryBtnText}>Use a different email</Text>
          </Button>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.blue200,
    backgroundColor: Colors.blue50,
    padding: 18,
    gap: 12,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.blue100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 16, fontWeight: '700', color: Colors.gray900 },
  desc: { fontSize: 13, color: Colors.gray600, lineHeight: 18 },
  errorText: { fontSize: 13, color: Colors.destructive, fontWeight: '600' },
  infoText: { fontSize: 13, color: Colors.blue700, fontWeight: '600' },
  actionBtn: { backgroundColor: Colors.blue600, borderRadius: Radius.full, minHeight: 48 },
  actionBtnText: { color: Colors.white, fontWeight: '700', fontSize: 15 },
  secondaryBtn: { borderRadius: Radius.full, minHeight: 44 },
  secondaryBtnText: { color: Colors.gray700, fontWeight: '600', fontSize: 14 },
});
