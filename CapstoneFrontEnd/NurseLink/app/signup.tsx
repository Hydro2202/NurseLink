import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Pressable,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AlertCircle,
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  FileText,
  Lock,
  Mail,
  RefreshCw,
  ShieldCheck,
  Upload,
  UserPlus,
  Users,
  Video,
  X,
  XCircle,
} from 'lucide-react-native';
import type { UserRole } from '../contexts/AuthContext';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Card, CardContent } from '../components/Card';
import { Alert, AlertDescription } from '../components/Alert';
import { Colors, Radius, Shadows } from '../constants/colors';
import {
  ApiError,
  faceVerificationRequest,
  resendRegistrationOtpRequest,
  resetFaceVerificationRequest,
  sendRegistrationOtpRequest,
  verifyRegistrationOtpRequest,
} from '../services/api';

function buildDirectoryEmail(fullName: string, hospitalName: string): string {
  const parts = fullName.toLowerCase().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? 'employee';
  const last = parts[parts.length - 1] ?? '';
  const domain = hospitalName.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24) || 'hospital';
  return `${first}${last ? `.${last}` : ''}@${domain}.com`;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return email;
  return `${local[0]}${'*'.repeat(Math.max(3, local.length - 1))}@${domain}`;
}

function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const data = err.data as { message?: string; detail?: string } | undefined;
    return data?.message || data?.detail || fallback;
  }
  return fallback;
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
  const refs = useRef<Array<TextInput | null>>([]);
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

const otpStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  box: {
    width: 44,
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

type WizardStep = 1 | 2 | 3 | 4 | 5 | 6 | 7;
type ProcessStatus = 'idle' | 'processing' | 'success' | 'failed';

const STEP_LABELS = ['Hospital ID', 'ID Review', 'Face Check', 'Role', 'PRC License', 'Role Check', 'Credentials'];

const STEP_TITLES = [
  'Hospital Identity Verification',
  'Extracted ID Information',
  'Mandatory Face Verification',
  'Role Selection',
  'PRC License Verification',
  'Role Verification',
  'Account Credentials',
];

const STEP_DESCRIPTIONS = [
  'Upload or scan your official Hospital ID to begin.',
  'Review your extracted information. These fields are read-only.',
  'Capture a live selfie to confirm your identity.',
  'Select the role you are registering for. It must match your verified employment information.',
  'Enter and verify your PRC Professional License number.',
  'Confirming your selected role matches your Hospital ID and PRC records.',
  'Set your login credentials to complete registration.',
];

const ROLE_OPTIONS: Array<{ label: string; value: UserRole; emoji: string; detail: string }> = [
  {
    label: 'Nurse',
    value: 'staff_nurse',
    emoji: '👩‍⚕️',
    detail: 'Staff Nurse or Registered Nurse responsible for direct patient care and clinical documentation.',
  },
  {
    label: 'Supervisor',
    value: 'supervisor',
    emoji: '👨‍💼',
    detail: 'Head Nurse, Nursing Supervisor, or Charge Nurse overseeing nursing staff and patient care operations.',
  },
];

const NURSE_KEYWORDS = ['nurse', 'registered nurse', 'staff nurse'];
const SUPERVISOR_KEYWORDS = ['supervisor', 'head nurse', 'nursing supervisor', 'charge nurse'];

const defaultOcrData = {
  fullName: '',
  employeeId: '',
  department: '',
  position: '',
  hospitalName: '',
  email: '',
};

function getRoleMatch(position: string, selectedRole: UserRole | '') {
  if (!selectedRole || !position) return false;
  const normalized = position.toLowerCase();
  const matchesNurse = NURSE_KEYWORDS.some((k) => normalized.includes(k));
  const matchesSupervisor = SUPERVISOR_KEYWORDS.some((k) => normalized.includes(k));
  if (selectedRole === 'staff_nurse') return matchesNurse;
  return matchesSupervisor;
}

function StepStepper({ current, completedThrough }: { current: WizardStep; completedThrough: WizardStep }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={stepperStyles.row}>
      {STEP_LABELS.map((label, index) => {
        const step = (index + 1) as WizardStep;
        const active = step === current;
        const complete = step < current || step <= completedThrough;
        const isLast = index === STEP_LABELS.length - 1;

        return (
          <View key={label} style={stepperStyles.segment}>
            <View style={stepperStyles.stepCol}>
              <View
                style={[
                  stepperStyles.dot,
                  complete && !active ? stepperStyles.dotComplete : null,
                  active ? stepperStyles.dotActive : null,
                  !complete && !active ? stepperStyles.dotFuture : null,
                ]}
              >
                {complete && !active ? (
                  <CheckCircle2 size={14} color={Colors.white} />
                ) : (
                  <Text style={[stepperStyles.dotText, active || complete ? stepperStyles.dotTextLight : stepperStyles.dotTextMuted]}>
                    {step}
                  </Text>
                )}
              </View>
              <Text
                style={[
                  stepperStyles.label,
                  complete && !active ? stepperStyles.labelComplete : null,
                  active ? stepperStyles.labelActive : null,
                ]}
                numberOfLines={2}
              >
                {label}
              </Text>
            </View>
            {!isLast && (
              <View style={[stepperStyles.connector, complete ? stepperStyles.connectorComplete : stepperStyles.connectorFuture]} />
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

function NavButtons({
  onBack,
  onContinue,
  continueDisabled,
  continueLabel = 'Continue',
  showBack = true,
}: {
  onBack?: () => void;
  onContinue?: () => void;
  continueDisabled?: boolean;
  continueLabel?: string;
  showBack?: boolean;
}) {
  if (!showBack) {
    return (
      <Button
        onPress={onContinue}
        disabled={continueDisabled}
        size="lg"
        style={[navStyles.continueFull, continueDisabled && navStyles.btnDisabled]}
      >
        <Text style={[navStyles.btnText, continueDisabled && navStyles.btnTextDisabled]}>{continueLabel}</Text>
        <ChevronRight size={18} color={continueDisabled ? Colors.gray500 : Colors.white} />
      </Button>
    );
  }

  return (
    <View style={navStyles.row}>
      <Button variant="outline" onPress={onBack} size="lg" style={navStyles.backBtn}>
        <ChevronLeft size={18} color={Colors.gray700} />
        <Text style={navStyles.backText}>Back</Text>
      </Button>
      <Button
        onPress={onContinue}
        disabled={continueDisabled}
        size="lg"
        style={[navStyles.continueBtn, continueDisabled && navStyles.btnDisabled]}
      >
        <Text style={[navStyles.btnText, continueDisabled && navStyles.btnTextDisabled]}>{continueLabel}</Text>
        <ChevronRight size={18} color={continueDisabled ? Colors.gray500 : Colors.white} />
      </Button>
    </View>
  );
}

export default function SignUpPage() {
  const router = useRouter();
  const { signup, logout } = useAuth();
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [hospitalIdCompleted, setHospitalIdCompleted] = useState(false);
  const [idReviewCompleted, setIdReviewCompleted] = useState(false);
  const [faceVerificationCompleted, setFaceVerificationCompleted] = useState(false);
  const [roleSelected, setRoleSelected] = useState(false);
  const [prcVerified, setPrcVerified] = useState(false);
  const [roleVerified, setRoleVerified] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState<UserRole | ''>('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [hospitalIdUri, setHospitalIdUri] = useState<string | null>(null);
  const [hospitalIdBase64, setHospitalIdBase64] = useState<string | null>(null);
  const [selfieUri, setSelfieUri] = useState<string | null>(null);
  const [faceStatus, setFaceStatus] = useState<ProcessStatus>('idle');
  const [prcStatus, setPrcStatus] = useState<ProcessStatus>('idle');
  const [prcData, setPrcData] = useState<{ profession: string; expiration: string } | null>(null);
  const [ocrData, setOcrData] = useState(defaultOcrData);
  const [ocrStatus, setOcrStatus] = useState<ProcessStatus>('idle');

  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [registrationSessionId, setRegistrationSessionId] = useState<string | null>(null);
  const [faceAttemptsUsed, setFaceAttemptsUsed] = useState(0);
  const [faceLocked, setFaceLocked] = useState(false);
  const [faceResetPending, setFaceResetPending] = useState(false);
  const [showOtpPanel, setShowOtpPanel] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpStatus, setOtpStatus] = useState<'idle' | 'sending' | 'awaiting' | 'verifying' | 'verified'>('idle');
  const [otpError, setOtpError] = useState('');
  const [otpExpiresAt, setOtpExpiresAt] = useState<number | null>(null);
  const [otpResendAvailableAt, setOtpResendAvailableAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }).start();
  }, [fadeAnim]);

  useEffect(() => {
    AsyncStorage.getItem('nurselink.faceVerificationSession').then((serialized) => {
      if (!serialized) return;
      const persisted = JSON.parse(serialized) as { id?: string; attempts?: number; locked?: boolean };
      if (persisted.id) {
        setRegistrationSessionId(persisted.id);
        setFaceAttemptsUsed(Math.min(3, Math.max(0, persisted.attempts ?? 0)));
        setFaceLocked(Boolean(persisted.locked));
      }
    }).catch(() => undefined);
  }, []);

  const persistFaceSession = (id: string, attempts: number, locked: boolean) =>
    AsyncStorage.setItem(
      'nurselink.faceVerificationSession',
      JSON.stringify({ id, attempts: Math.min(3, Math.max(0, attempts)), locked })
    );

  const completedThrough: WizardStep = (() => {
    if (roleVerified) return 7;
    if (prcVerified) return 6;
    if (roleSelected) return 5;
    if (faceVerificationCompleted || otpStatus === 'verified') return 4;
    if (idReviewCompleted) return 3;
    if (hospitalIdCompleted) return 2;
    return 1;
  })();

  const simulateOcr = () => {
    setOcrStatus('processing');
    setTimeout(() => {
      const fullName = 'Maria Santos Dela Cruz';
      const hospitalName = "St. Luke's Medical Center";
      setOcrData({
        fullName,
        employeeId: `EMP-${Math.floor(10000 + Math.random() * 90000)}`,
        hospitalName,
        department: 'Intensive Care Unit',
        position: 'Registered Nurse',
        email: buildDirectoryEmail(fullName, hospitalName),
      });
      setOcrStatus('success');
      setHospitalIdCompleted(true);
    }, 900);
  };

  const handleIdImage = (uri: string, base64: string | null) => {
    setHospitalIdUri(uri);
    setHospitalIdBase64(base64);
    setIdReviewCompleted(false);
    setFaceVerificationCompleted(false);
    setRoleSelected(false);
    setRole('');
    setPrcVerified(false);
    setRoleVerified(false);
    simulateOcr();
  };

  const handleIdUpload = async () => {
    setError('');
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Camera roll access is required to upload your hospital ID.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
      allowsEditing: true,
      base64: true,
    });
    if (!result.canceled) handleIdImage(result.assets[0].uri, result.assets[0].base64 ?? null);
  };

  const handleScanId = async () => {
    setError('');
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError('Camera access is required to scan the hospital ID.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.9, allowsEditing: true, base64: true });
    if (!result.canceled) handleIdImage(result.assets[0].uri, result.assets[0].base64 ?? null);
  };

  const handleFaceVerification = async () => {
    setError('');
    if (!hospitalIdBase64) {
      setError('Please re-upload your Hospital ID photo in Step 1 before continuing.');
      return;
    }
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError('Camera access is required for face verification.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.9,
      allowsEditing: false,
      cameraType: ImagePicker.CameraType.front,
      base64: true,
    });
    if (result.canceled) {
      setFaceStatus('idle');
      return;
    }
    const asset = result.assets[0];
    setSelfieUri(asset.uri);
    setFaceStatus('processing');

    if (!asset.base64) {
      setFaceStatus('failed');
      setError('Could not read the captured photo. Please try again.');
      return;
    }

    try {
      const res = await faceVerificationRequest(
        `data:image/jpeg;base64,${asset.base64}`,
        `data:image/jpeg;base64,${hospitalIdBase64}`,
        registrationSessionId,
        ocrData.email
      );
      setRegistrationSessionId(res.registrationSessionId);
      setFaceAttemptsUsed(Math.max(0, 3 - res.attemptsRemaining));
      void persistFaceSession(res.registrationSessionId, Math.max(0, 3 - res.attemptsRemaining), res.locked);
      if (res.matched) {
        setFaceStatus('success');
        setFaceVerificationCompleted(true);
        await AsyncStorage.removeItem('nurselink.faceVerificationSession');
        setCurrentStep(4);
        return;
      }
      setFaceStatus('failed');
      setError('The photo did not match the required live face verification. Please try again.');
      if (res.locked) {
        setFaceLocked(true);
      }
    } catch (err) {
      setFaceStatus('failed');
      if (err instanceof ApiError && err.status === 403) {
        const data = err.data as { registrationSessionId?: string } | undefined;
        if (data?.registrationSessionId) {
          setRegistrationSessionId(data.registrationSessionId);
          void persistFaceSession(data.registrationSessionId, 3, true);
        }
        setFaceAttemptsUsed(3);
        setFaceLocked(true);
      } else {
        setError(extractErrorMessage(err, 'Face verification failed. Please try again.'));
      }
    }
  };

  const removeFailedSelfie = () => {
    setSelfieUri(null);
    setFaceStatus('idle');
    setError('');
  };

  const tryFaceVerificationAgain = async () => {
    removeFailedSelfie();
    await handleFaceVerification();
  };

  const handleModalRetake = async () => {
    if (!registrationSessionId) {
      setFaceLocked(false);
      setFaceAttemptsUsed(0);
      setFaceStatus('idle');
      setError('');
      setSelfieUri(null);
      setFaceVerificationCompleted(false);
      await handleFaceVerification();
      return;
    }
    setFaceResetPending(true);
    try {
      await resetFaceVerificationRequest(registrationSessionId);
      await AsyncStorage.removeItem('nurselink.faceVerificationSession');
      setFaceLocked(false);
      setFaceAttemptsUsed(0);
      setFaceStatus('idle');
      setError('');
      setSelfieUri(null);
      setFaceVerificationCompleted(false);
      await handleFaceVerification();
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not reset verification. Please try again.'));
    } finally {
      setFaceResetPending(false);
    }
  };

  const handleOpenOtp = async () => {
    if (!registrationSessionId || !ocrData.email) return;
    setOtpStatus('sending');
    setOtpError('');
    try {
      const res = await sendRegistrationOtpRequest(registrationSessionId);
      setShowOtpPanel(true);
      setOtpStatus('awaiting');
      setOtpCode('');
      setOtpExpiresAt(Date.now() + (res.expiresIn ?? 300) * 1000);
      setOtpResendAvailableAt(Date.now() + (res.resendCooldown ?? 60) * 1000);
    } catch (err) {
      // Keep the failure modal open so the error is visible and retry is easy.
      setOtpStatus('idle');
      setOtpError(extractErrorMessage(err, 'Failed to send verification code. Please try again.'));
    }
  };

  const handleResendOtp = async () => {
    if (!registrationSessionId || !ocrData.email) return;
    setOtpStatus('sending');
    setOtpError('');
    try {
      const res = await resendRegistrationOtpRequest(registrationSessionId);
      setOtpStatus('awaiting');
      setOtpCode('');
      setOtpExpiresAt(Date.now() + (res.expiresIn ?? 300) * 1000);
      setOtpResendAvailableAt(Date.now() + (res.resendCooldown ?? 60) * 1000);
    } catch (err) {
      setOtpStatus('awaiting');
      setOtpError(extractErrorMessage(err, 'Failed to resend verification code. Please try again.'));
    }
  };

  const handleVerifyOtp = async () => {
    if (!registrationSessionId || !ocrData.email || otpCode.length !== 6) return;
    setOtpStatus('verifying');
    setOtpError('');
    try {
      const res = await verifyRegistrationOtpRequest(otpCode, registrationSessionId);
      if (res.verified) {
        setOtpStatus('verified');
        await AsyncStorage.removeItem('nurselink.faceVerificationSession');
        setCurrentStep(4);
      } else {
        setOtpStatus('awaiting');
        setOtpError(res.message || 'Invalid OTP.');
      }
    } catch (err) {
      setOtpStatus('awaiting');
      setOtpError(extractErrorMessage(err, 'Verification failed. Please try again.'));
    }
  };

  const handleBackToFaceFromOtp = async () => {
    setShowOtpPanel(false);
    await handleModalRetake();
  };

  useEffect(() => {
    if (!showOtpPanel) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [showOtpPanel]);

  const otpResendSecondsLeft = otpResendAvailableAt
    ? Math.max(0, Math.ceil((otpResendAvailableAt - nowTick) / 1000))
    : 0;
  const otpExpired = otpExpiresAt ? nowTick > otpExpiresAt && otpStatus !== 'verified' : false;
  const identityVerified = faceVerificationCompleted || otpStatus === 'verified';
  const verificationMethod: 'FACE' | 'EMAIL_OTP' | null = faceVerificationCompleted
    ? 'FACE'
    : otpStatus === 'verified'
      ? 'EMAIL_OTP'
      : null;

  const verifyPrc = () => {
    if (licenseNumber.trim().length < 5) {
      setPrcStatus('failed');
      setPrcVerified(false);
      setPrcData(null);
      return;
    }
    setPrcStatus('processing');
    setTimeout(() => {
      setPrcData({ profession: 'Registered Nurse', expiration: '2026-06-30' });
      setPrcStatus('success');
      setPrcVerified(true);
    }, 900);
  };

  useEffect(() => {
    if (currentStep === 5 && licenseNumber.trim().length >= 5 && prcStatus === 'idle') {
      const timer = setTimeout(verifyPrc, 600);
      return () => clearTimeout(timer);
    }
  }, [licenseNumber, currentStep, prcStatus]);

  const validateCredentials = () => {
    const errors: Record<string, string> = {};
    if (!email.trim()) errors.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Enter a valid email address';
    if (!password) errors.password = 'Password is required';
    else if (password.length < 8) errors.password = 'Password must be at least 8 characters';
    if (!confirmPassword) errors.confirmPassword = 'Please confirm your password';
    else if (password !== confirmPassword) errors.confirmPassword = 'Passwords do not match';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreateAccount = async () => {
    setError('');
    if (!validateCredentials()) return;
    if (!roleVerified || !prcVerified || !identityVerified || !hospitalIdCompleted || !roleSelected) {
      setError('Please complete all verification steps before creating your account.');
      return;
    }
    if (!registrationSessionId) {
      setError('Identity verification session was lost. Please redo Face or Email OTP verification.');
      return;
    }
    try {
      await signup({
        name: ocrData.fullName,
        firstName: ocrData.fullName.split(' ')[0] ?? '',
        middleName: ocrData.fullName.split(' ').slice(1, -1).join(' ') ?? '',
        lastName: ocrData.fullName.split(' ').slice(-1).join(' ') ?? '',
        role: role as UserRole,
        email,
        password,
        department: ocrData.department,
        licenseNumber: licenseNumber.trim(),
        registrationSessionId,
      });
    } catch (err) {
      console.error(err);
    } finally {
      // Keep the user on the pending-approval screen; do not leave them logged in.
      logout();
      router.replace({ pathname: '/pending-approval', params: { method: verificationMethod ?? '' } });
    }
  };

  const roleMatch = getRoleMatch(ocrData.position, role);
  const idUploaded = !!hospitalIdUri && hospitalIdCompleted;
  const ocrDone = ocrStatus === 'success';
  const credsDone = email.trim() !== '' && password.length >= 8 && password === confirmPassword;
  const canSubmit =
    roleVerified && prcVerified && identityVerified && ocrDone && idUploaded && roleSelected && credsDone;

  const stepIcon = () => {
    switch (currentStep) {
      case 1:
        return <CreditCard size={20} color={Colors.white} />;
      case 2:
        return <FileText size={20} color={Colors.white} />;
      case 3:
        return <Camera size={20} color={Colors.white} />;
      case 4:
        return <Users size={20} color={Colors.white} />;
      case 5:
        return <ShieldCheck size={20} color={Colors.white} />;
      case 6:
        return <CheckCircle2 size={20} color={Colors.white} />;
      default:
        return <Lock size={20} color={Colors.white} />;
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Animated.View style={[styles.inner, { opacity: fadeAnim }]}>
            <View style={styles.header}>
              <Image
                source={require('../assets/images/NurseLinkLogo.png')}
                style={styles.logo}
                resizeMode="contain"
                accessibilityLabel="NurseLink Logo"
              />
              <Text style={styles.subtitle}>Secure healthcare professional registration</Text>
            </View>

            <StepStepper current={currentStep} completedThrough={completedThrough} />

            <Card style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.headerIcon}>{stepIcon()}</View>
                <View style={styles.headerText}>
                  <Text style={styles.headerTitle}>
                    Step {currentStep} of 7 — {STEP_TITLES[currentStep - 1]}
                  </Text>
                  <Text style={styles.headerDesc}>{STEP_DESCRIPTIONS[currentStep - 1]}</Text>
                </View>
              </View>

              <CardContent style={styles.cardContent}>
                {error ? (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}

                {currentStep === 1 && (
                  <View style={styles.stepBody}>
                    <View style={[styles.uploadBox, hospitalIdUri && ocrDone ? styles.uploadBoxSuccess : null]}>
                      {hospitalIdUri ? (
                        <View style={styles.previewWrap}>
                          <Image source={{ uri: hospitalIdUri }} style={styles.previewImage} />
                          <Pressable
                            style={styles.removeBtn}
                            onPress={() => {
                              setHospitalIdUri(null);
                              setHospitalIdBase64(null);
                              setOcrStatus('idle');
                              setOcrData(defaultOcrData);
                              setHospitalIdCompleted(false);
                            }}
                          >
                            <X size={16} color={Colors.gray600} />
                          </Pressable>
                        </View>
                      ) : (
                        <>
                          <View style={styles.uploadIconCircle}>
                            <CreditCard size={28} color={Colors.blue600} />
                          </View>
                          <Text style={styles.uploadLabel}>Drag & drop or tap to upload your Hospital ID</Text>
                          <Text style={styles.uploadHint}>Accepted formats: JPG, PNG, PDF · Max 5 MB</Text>
                        </>
                      )}
                    </View>

                    <View style={styles.actionRow}>
                      <Button variant="outline" size="lg" onPress={handleScanId} style={styles.scanBtn}>
                        <Camera size={18} color={Colors.blue600} />
                        <Text style={styles.scanBtnText}>Camera Scan</Text>
                      </Button>
                      <Button variant="outline" size="lg" onPress={handleIdUpload} style={styles.uploadBtn}>
                        <Upload size={18} color={Colors.gray600} />
                        <Text style={styles.uploadBtnText}>Upload File</Text>
                      </Button>
                    </View>

                    {ocrStatus === 'processing' && (
                      <View style={styles.infoBlue}>
                        <ActivityIndicator size="small" color={Colors.blue600} />
                        <Text style={styles.infoBlueText}>Scanning Hospital ID and extracting data...</Text>
                      </View>
                    )}

                    {ocrStatus === 'success' && (
                      <View style={styles.successBox}>
                        <CheckCircle2 size={18} color={Colors.green600} />
                        <View style={styles.successBoxText}>
                          <Text style={styles.successBoxTitle}>Hospital ID scanned successfully</Text>
                          <Text style={styles.successBoxDesc}>Employee information extracted. Proceed to review.</Text>
                        </View>
                      </View>
                    )}

                    <NavButtons showBack={false} onContinue={() => setCurrentStep(2)} continueDisabled={ocrStatus !== 'success'} />
                  </View>
                )}

                {currentStep === 2 && (
                  <View style={styles.stepBody}>
                    <View style={styles.extractedHeader}>
                      <Text style={styles.extractedLabel}>Automatically extracted from your Hospital ID</Text>
                      <View style={styles.extractedBadge}>
                        <CheckCircle2 size={12} color={Colors.green700} />
                        <Text style={styles.extractedBadgeText}>Information Successfully Extracted</Text>
                      </View>
                    </View>

                    <View style={styles.successBox}>
                      <CheckCircle2 size={16} color={Colors.green600} />
                      <Text style={styles.successBoxDesc}>
                        These details were read directly from your scanned Hospital ID and cannot be edited.
                      </Text>
                    </View>

                    {[
                      { label: 'Full Name', value: ocrData.fullName },
                      { label: 'Employee ID', value: ocrData.employeeId },
                      { label: 'Hospital Name', value: ocrData.hospitalName },
                      { label: 'Department', value: ocrData.department },
                    ].map((field) => (
                      <Input key={field.label} label={field.label} value={field.value} editable={false} inputWrapperStyle={styles.readOnlyInput} />
                    ))}
                    <Input label="Position" value={ocrData.position} editable={false} inputWrapperStyle={styles.readOnlyInput} />

                    <NavButtons
                      onBack={() => setCurrentStep(1)}
                      onContinue={() => {
                        setIdReviewCompleted(true);
                        setCurrentStep(3);
                      }}
                    />
                  </View>
                )}

                {currentStep === 3 && (
                  <View style={styles.stepBody}>
                    {!showOtpPanel && <View style={styles.warningBox}>
                      <AlertTriangle size={18} color={Colors.orange600} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.warningText}>
                          This step is <Text style={styles.warningBold}>required</Text>. To verify your identity, you must capture a live selfie using your device&apos;s camera. Uploading images from your gallery is not permitted.
                        </Text>
                        <Text style={[styles.warningText, { marginTop: 4 }]}>
                          If face verification cannot be completed after 3 attempts, an alternative Email OTP option
                          will be offered.
                        </Text>
                      </View>
                    </View>}

                    {!showOtpPanel && (
                      <View style={styles.attemptsBar}>
                        <Text style={styles.attemptsBarLabel}>Face verification attempts</Text>
                        <View style={styles.attemptsBarRight}>
                          <View style={styles.attemptsDotsRow}>
                            {[0, 1, 2].map((i) => (
                              <View
                                key={i}
                                style={[styles.attemptsDot, i < faceAttemptsUsed && styles.attemptsDotFilled]}
                              />
                            ))}
                          </View>
                          <Text style={styles.attemptsCount}>{faceAttemptsUsed} / 3</Text>
                        </View>
                      </View>
                    )}

                    {!faceLocked && !showOtpPanel && (
                      <>
                        {selfieUri ? (
                          <View style={styles.selfieWrap}>
                            <Image source={{ uri: selfieUri }} style={styles.selfieImage} />
                            {faceStatus === 'processing' && (
                              <View style={styles.selfieOverlay}>
                                <ActivityIndicator color={Colors.white} />
                                <Text style={styles.selfieOverlayText}>Analyzing face...</Text>
                              </View>
                            )}
                            {faceStatus === 'success' && (
                              <View style={[styles.selfieOverlay, styles.selfieOverlaySuccess]}>
                                <CheckCircle2 size={32} color={Colors.green600} />
                              </View>
                            )}
                            {faceStatus === 'failed' && (
                              <View style={[styles.selfieOverlay, styles.selfieOverlayError]}>
                                <View style={styles.selfieFailureIcon}>
                                  <XCircle size={38} color={Colors.red600} />
                                </View>
                              </View>
                            )}
                          </View>
                        ) : (
                          <Pressable style={styles.cameraZone} onPress={handleFaceVerification}>
                            <View style={styles.cameraIconCircle}>
                              <Video size={28} color={Colors.blue600} />
                            </View>
                            <Text style={styles.cameraZoneTitle}>Open Camera</Text>
                            <Text style={styles.cameraZoneHint}>Live selfie only — gallery uploads are not allowed</Text>
                          </Pressable>
                        )}

                        {selfieUri && faceStatus === 'failed' && (
                          <>
                            <View style={styles.faceFailureCard}>
                              <XCircle size={18} color={Colors.red600} />
                              <View style={{ flex: 1 }}>
                                <Text style={styles.faceFailureTitle}>Face Verification Failed</Text>
                                <Text style={styles.faceFailureMessage}>
                                  The photo did not match the required live face verification. Please try again.
                                </Text>
                              </View>
                            </View>
                            <View style={styles.faceRetryActions}>
                              <Button variant="outline" size="lg" onPress={removeFailedSelfie} style={{ flex: 1 }}>
                                <X size={16} color={Colors.gray700} />
                                <Text style={navStyles.backText}>Remove</Text>
                              </Button>
                              <Button size="lg" onPress={tryFaceVerificationAgain} style={{ flex: 1 }}>
                                <RefreshCw size={16} color={Colors.white} />
                                <Text style={navStyles.btnText}>Try Again</Text>
                              </Button>
                            </View>
                          </>
                        )}
                      </>
                    )}

                    {faceLocked && !showOtpPanel && (
                      <>
                        {selfieUri && (
                          <View style={styles.selfieWrap}>
                            <Image source={{ uri: selfieUri }} style={styles.selfieImage} />
                            <View style={[styles.selfieOverlay, styles.selfieOverlayError]}>
                              <View style={styles.selfieFailureIcon}>
                                <XCircle size={38} color={Colors.red600} />
                              </View>
                            </View>
                          </View>
                        )}
                        <View style={styles.verificationWarningCard}>
                          <View style={styles.verificationWarningHeader}>
                            <View style={styles.warningIconCircle}>
                              <AlertTriangle size={20} color={Colors.orange600} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.verificationWarningTitle}>Face Verification Unsuccessful</Text>
                              <Text style={styles.verificationWarningSubtitle}>3 consecutive attempts failed</Text>
                            </View>
                          </View>
                          <View style={styles.verificationWarningBody}>
                            <Text style={styles.verificationWarningMessage}>
                              We couldn&apos;t verify your identity after multiple attempts. You may try Face
                              Verification again or choose an alternative verification method.
                            </Text>
                            {otpError && (
                              <View style={styles.errorBox}>
                                <AlertCircle size={16} color={Colors.red700} />
                                <Text style={styles.errorBoxText}>{otpError}</Text>
                              </View>
                            )}
                            <Button variant="outline" size="lg" onPress={handleModalRetake} disabled={faceResetPending || otpStatus === 'sending'}>
                              {faceResetPending ? <ActivityIndicator color={Colors.primary} /> : <RefreshCw size={16} color={Colors.orange700} />}
                              <Text style={[navStyles.backText, { color: Colors.orange700 }]}>
                                {faceResetPending ? 'Resetting...' : 'Try Face Verification Again'}
                              </Text>
                            </Button>
                            <Button size="lg" onPress={handleOpenOtp} disabled={otpStatus === 'sending' || faceResetPending}>
                              {otpStatus === 'sending' ? <ActivityIndicator color={Colors.white} /> : <Mail size={16} color={Colors.white} />}
                              <Text style={navStyles.btnText}>{otpStatus === 'sending' ? 'Sending code...' : 'Verify Using Email OTP (Optional)'}</Text>
                            </Button>
                          </View>
                        </View>
                      </>
                    )}

                    {showOtpPanel && (
                      <View style={styles.otpPanel}>
                        <View style={styles.otpPanelHeader}>
                          <View style={styles.otpPanelIconCircle}>
                            <Mail size={20} color={Colors.blue600} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.otpPanelTitle}>Alternative Identity Verification</Text>
                            <Text style={styles.otpPanelDesc}>
                              Receive a one-time verification code in your registered email address.
                            </Text>
                          </View>
                        </View>

                        <View style={styles.otpNoticeBox}>
                          <ShieldCheck size={14} color={Colors.orange600} />
                          <Text style={styles.otpNoticeText}>
                            Alternative verification method — used only when Face Verification cannot be completed
                          </Text>
                        </View>

                        <View style={styles.otpEmailRow}>
                          <Mail size={17} color={Colors.gray400} />
                          <Text style={styles.otpEmailText}>{maskEmail(ocrData.email)}</Text>
                          <View style={styles.readOnlyBadge}>
                            <Text style={styles.readOnlyBadgeText}>Read-only</Text>
                          </View>
                        </View>

                        <View style={{ gap: 8 }}>
                          <Text style={styles.otpFieldLabel}>Enter 6-Digit Verification Code</Text>
                          <OtpDigitsInput
                            value={otpCode}
                            onChange={(v) => {
                              setOtpCode(v);
                              setOtpError('');
                            }}
                            disabled={otpStatus === 'verifying' || otpStatus === 'verified'}
                          />
                        </View>

                        {otpExpired && otpStatus !== 'verified' && (
                          <View style={styles.errorBox}>
                            <AlertCircle size={16} color={Colors.red700} />
                            <Text style={styles.errorBoxText}>OTP expired. Please request a new code.</Text>
                          </View>
                        )}

                        {otpError && !otpExpired && (
                          <View style={styles.errorBox}>
                            <AlertCircle size={16} color={Colors.red700} />
                            <Text style={styles.errorBoxText}>{otpError}</Text>
                          </View>
                        )}

                        {otpStatus === 'verified' && (
                          <View style={styles.successBox}>
                            <CheckCircle2 size={16} color={Colors.green600} />
                            <Text style={styles.successBoxDesc}>Identity Successfully Verified</Text>
                          </View>
                        )}

                        <View style={styles.otpFooterRow}>
                          <Text style={styles.otpResendText}>
                            {otpStatus === 'verified'
                              ? 'Verification complete'
                              : otpResendSecondsLeft > 0
                                ? `Resend available in ${otpResendSecondsLeft}s`
                                : 'You can resend the code now'}
                          </Text>
                          <Pressable
                            disabled={otpResendSecondsLeft > 0 || otpStatus === 'sending' || otpStatus === 'verified'}
                            onPress={handleResendOtp}
                          >
                            <Text
                              style={[
                                styles.otpResendLink,
                                (otpResendSecondsLeft > 0 || otpStatus === 'sending' || otpStatus === 'verified') &&
                                  styles.otpResendLinkDisabled,
                              ]}
                            >
                              Resend Code
                            </Text>
                          </Pressable>
                        </View>

                        <Button
                          size="lg"
                          onPress={handleVerifyOtp}
                          disabled={otpCode.length !== 6 || otpStatus === 'verifying' || otpStatus === 'verified' || otpExpired}
                          style={[navStyles.continueFull, (otpCode.length !== 6 || otpStatus === 'verified' || otpExpired) && navStyles.btnDisabled]}
                        >
                          {otpStatus === 'verifying' ? (
                            <ActivityIndicator color={Colors.white} />
                          ) : (
                            <Lock size={16} color={Colors.white} />
                          )}
                          <Text style={navStyles.btnText}>{otpStatus === 'verifying' ? 'Verifying...' : 'Verify Code'}</Text>
                        </Button>

                        <View style={styles.otpDivider}>
                          <View style={styles.otpDividerLine} />
                          <Text style={styles.otpDividerText}>or</Text>
                          <View style={styles.otpDividerLine} />
                        </View>

                        <Button
                          variant="outline"
                          size="lg"
                          onPress={handleBackToFaceFromOtp}
                          disabled={otpStatus === 'verified'}
                        >
                          <RefreshCw size={16} color={Colors.gray700} />
                          <Text style={navStyles.backText}>Try Face Verification Again</Text>
                        </Button>
                      </View>
                    )}

                    <NavButtons onBack={() => setCurrentStep(2)} onContinue={() => setCurrentStep(4)} continueDisabled={!identityVerified} />
                  </View>
                )}

                {currentStep === 4 && (
                  <View style={styles.stepBody}>
                    <Text style={styles.bodyText}>
                      Select the role you are registering for. Your selection will be verified against your Hospital ID and PRC license.
                    </Text>
                    {ROLE_OPTIONS.map((option) => {
                      const selected = role === option.value;
                      return (
                        <Pressable
                          key={option.value}
                          style={[styles.roleCard, selected && styles.roleCardSelected]}
                          onPress={() => {
                            setRole(option.value);
                            setRoleSelected(true);
                            setRoleVerified(false);
                            setFieldErrors((prev) => ({ ...prev, role: '' }));
                          }}
                        >
                          <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>
                            {selected ? <View style={styles.radioInner} /> : null}
                          </View>
                          <Text style={styles.roleEmoji}>{option.emoji}</Text>
                          <View style={styles.roleText}>
                            <Text style={styles.roleTitle}>{option.label}</Text>
                            <Text style={styles.roleDetail}>{option.detail}</Text>
                          </View>
                        </Pressable>
                      );
                    })}
                    {fieldErrors.role ? <Text style={styles.fieldError}>{fieldErrors.role}</Text> : null}
                    <NavButtons
                      onBack={() => setCurrentStep(3)}
                      onContinue={() => {
                        if (!role) setFieldErrors({ role: 'Please select a role before continuing.' });
                        else setCurrentStep(5);
                      }}
                    />
                  </View>
                )}

                {currentStep === 5 && (
                  <View style={styles.stepBody}>
                    <Input
                      label="PRC License Number *"
                      placeholder="1234567"
                      value={licenseNumber}
                      onChangeText={(value) => {
                        setLicenseNumber(value);
                        setPrcStatus('idle');
                        setPrcVerified(false);
                        setPrcData(null);
                      }}
                      error={fieldErrors.licenseNumber}
                      rightIcon={
                        prcStatus === 'processing' ? (
                          <ActivityIndicator size="small" color={Colors.blue600} />
                        ) : prcStatus === 'success' ? (
                          <View style={styles.verifiedBadge}>
                            <CheckCircle2 size={12} color={Colors.green700} />
                            <Text style={styles.verifiedText}>Verified</Text>
                          </View>
                        ) : null
                      }
                    />

                    {prcStatus === 'success' && prcData && (
                      <View style={styles.prcBox}>
                        <View style={styles.prcBoxHeader}>
                          <CheckCircle2 size={16} color={Colors.green700} />
                          <Text style={styles.prcBoxTitle}>Active PRC License</Text>
                        </View>
                        <View style={styles.prcGrid}>
                          <View style={styles.prcItem}>
                            <Text style={styles.prcLabel}>License Status</Text>
                            <Text style={styles.prcValue}>Active</Text>
                          </View>
                          <View style={styles.prcItem}>
                            <Text style={styles.prcLabel}>Profession</Text>
                            <Text style={styles.prcValue}>{prcData.profession}</Text>
                          </View>
                          <View style={styles.prcItem}>
                            <Text style={styles.prcLabel}>Expiration Date</Text>
                            <Text style={styles.prcValue}>{prcData.expiration}</Text>
                          </View>
                        </View>
                      </View>
                    )}

                    <NavButtons onBack={() => setCurrentStep(4)} onContinue={() => setCurrentStep(6)} continueDisabled={prcStatus !== 'success'} />
                  </View>
                )}

                {currentStep === 6 && (
                  <View style={styles.stepBody}>
                    <View style={styles.compareRow}>
                      <View style={styles.compareBox}>
                        <Text style={styles.compareLabel}>Selected Role</Text>
                        <Text style={styles.compareValue}>
                          {role === 'supervisor' ? '👨‍💼 Supervisor' : role ? '👩‍⚕️ Nurse' : '—'}
                        </Text>
                      </View>
                      <View style={styles.compareBox}>
                        <Text style={styles.compareLabel}>OCR Detected Position</Text>
                        <Text style={styles.compareValue}>{ocrData.position || '—'}</Text>
                      </View>
                    </View>

                    {roleMatch ? (
                      <View style={styles.roleVerifiedBox}>
                        <View style={styles.roleVerifiedHeader}>
                          <View style={styles.roleVerifiedTitleRow}>
                            <CheckCircle2 size={16} color={Colors.green700} />
                            <Text style={styles.roleVerifiedTitle}>Role Verified</Text>
                          </View>
                          <View style={styles.roleMatchBadge}>
                            <CheckCircle2 size={10} color={Colors.green700} />
                            <Text style={styles.roleMatchBadgeText}>Role Match</Text>
                          </View>
                        </View>
                        <View style={styles.roleVerifiedInner}>
                          <Text style={styles.roleVerifiedItem}>✓ Selected: {role === 'supervisor' ? 'Supervisor' : 'Nurse'}</Text>
                          <Text style={styles.roleVerifiedItem}>✓ OCR Detected: {ocrData.position}</Text>
                        </View>
                        <Text style={styles.roleAuthorized}>
                          ✓ You are authorized to register as a {role === 'supervisor' ? 'Supervisor' : 'Nurse'}.
                        </Text>
                      </View>
                    ) : (
                      <View style={styles.roleMismatchBox}>
                        <View style={styles.roleVerifiedHeader}>
                          <Text style={styles.roleMismatchTitle}>Role Mismatch</Text>
                          <View style={styles.mismatchBadge}>
                            <Text style={styles.mismatchBadgeText}>Mismatch Detected</Text>
                          </View>
                        </View>
                        <Text style={styles.roleMismatchDesc}>The selected role does not match your verified employment information.</Text>
                        <Button variant="outline" onPress={() => setCurrentStep(4)} style={styles.changeRoleBtn}>
                          <ChevronLeft size={16} color={Colors.red700} />
                          <Text style={styles.changeRoleText}>Change Role Selection</Text>
                        </Button>
                      </View>
                    )}

                    <NavButtons
                      onBack={() => setCurrentStep(5)}
                      onContinue={() => {
                        if (roleMatch) {
                          setRoleVerified(true);
                          setCurrentStep(7);
                        }
                      }}
                      continueDisabled={!roleMatch}
                    />
                  </View>
                )}

                {currentStep === 7 && (
                  <View style={styles.stepBody}>
                    <View style={styles.infoBlue}>
                      <ShieldCheck size={16} color={Colors.blue600} />
                      <Text style={styles.infoBlueText}>
                        All identity verifications have passed. Set your login credentials below to complete registration.
                      </Text>
                    </View>

                    <Input
                      label="Email Address *"
                      placeholder="you@example.com"
                      value={email}
                      onChangeText={setEmail}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      error={fieldErrors.email}
                      leftIcon={<Mail size={16} color={Colors.gray500} />}
                    />
                    <Input
                      label="Password *"
                      placeholder="At least 8 characters"
                      value={password}
                      onChangeText={setPassword}
                      secureTextEntry
                      autoCapitalize="none"
                      error={fieldErrors.password}
                      leftIcon={<Lock size={16} color={Colors.gray500} />}
                    />
                    <Input
                      label="Confirm Password *"
                      placeholder="Re-enter password"
                      value={confirmPassword}
                      onChangeText={setConfirmPassword}
                      secureTextEntry
                      autoCapitalize="none"
                      error={fieldErrors.confirmPassword}
                      leftIcon={<Lock size={16} color={Colors.gray500} />}
                    />

                    <View style={styles.identityBox}>
                      <View style={styles.identityHeader}>
                        <View style={styles.identityTitleRow}>
                          <ShieldCheck size={16} color={Colors.green700} />
                          <Text style={styles.identityTitle}>Identity Verification</Text>
                        </View>
                        <View style={styles.completeBadge}>
                          <CheckCircle2 size={10} color={Colors.white} />
                          <Text style={styles.completeBadgeText}>Complete</Text>
                        </View>
                      </View>
                      {[
                        { label: 'Hospital ID Uploaded', done: idUploaded },
                        { label: 'OCR Information Extracted', done: ocrDone },
                        {
                          label: verificationMethod === 'EMAIL_OTP' ? 'Email OTP Verified' : 'Face Verification Passed',
                          done: identityVerified,
                        },
                        { label: 'Role Selected', done: roleSelected },
                        { label: 'PRC License Verified', done: prcVerified },
                        { label: 'Role Verified & Matched', done: roleVerified },
                        { label: 'Account Information Completed', done: credsDone },
                      ].map((item) => (
                        <View key={item.label} style={styles.checkItem}>
                          <View style={[styles.checkDot, item.done && styles.checkDotDone]}>
                            {item.done ? <CheckCircle2 size={12} color={Colors.white} /> : null}
                          </View>
                          <Text style={[styles.checkLabel, !item.done && styles.checkLabelPending]}>{item.label}</Text>
                        </View>
                      ))}
                    </View>

                    <View style={navStyles.row}>
                      <Button variant="outline" onPress={() => setCurrentStep(6)} size="lg" style={navStyles.backBtn}>
                        <ChevronLeft size={18} color={Colors.gray700} />
                        <Text style={navStyles.backText}>Back</Text>
                      </Button>
                      <Button onPress={handleCreateAccount} disabled={!canSubmit} size="lg" style={[navStyles.continueBtn, !canSubmit && navStyles.btnDisabled]}>
                        <UserPlus size={18} color={canSubmit ? Colors.white : Colors.gray500} />
                        <Text style={[navStyles.btnText, !canSubmit && navStyles.btnTextDisabled]}>Create Account</Text>
                      </Button>
                    </View>
                  </View>
                )}
              </CardContent>
            </Card>

            <Text style={styles.footerLogin}>
              Already have an account?{' '}
              <Link href="/login" style={styles.footerLink}>
                Log In
              </Link>
            </Text>
            <Text style={styles.terms}>By creating an account, you agree to our Terms of Service and Privacy Policy</Text>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const stepperStyles = StyleSheet.create({
  row: { paddingHorizontal: 4, paddingBottom: 16, gap: 0 },
  segment: { flexDirection: 'row', alignItems: 'flex-start' },
  stepCol: { alignItems: 'center', width: 68 },
  dot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.gray200,
    backgroundColor: Colors.white,
  },
  dotActive: { backgroundColor: Colors.blue600, borderColor: Colors.blue600 },
  dotComplete: { backgroundColor: Colors.green600, borderColor: Colors.green600 },
  dotFuture: { backgroundColor: Colors.white, borderColor: Colors.gray200 },
  dotText: { fontSize: 13, fontWeight: '700' },
  dotTextLight: { color: Colors.white },
  dotTextMuted: { color: Colors.gray400 },
  label: { marginTop: 6, fontSize: 10, textAlign: 'center', color: Colors.gray400, maxWidth: 64 },
  labelActive: { color: Colors.blue600, fontWeight: '600' },
  labelComplete: { color: Colors.green600, fontWeight: '600' },
  connector: { width: 20, height: 2, marginTop: 15 },
  connectorComplete: { backgroundColor: Colors.green400 },
  connectorFuture: { backgroundColor: Colors.gray200 },
});

const navStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12 },
  backBtn: { flex: 1, borderRadius: Radius.full, minHeight: 48 },
  continueBtn: { flex: 1.5, backgroundColor: Colors.blue600, borderRadius: Radius.full, minHeight: 48 },
  continueFull: { width: '100%', backgroundColor: Colors.blue600, borderRadius: Radius.full, minHeight: 48 },
  btnDisabled: { backgroundColor: Colors.gray200 },
  btnText: { color: Colors.white, fontWeight: '600', fontSize: 15 },
  btnTextDisabled: { color: Colors.gray500 },
  backText: { color: Colors.gray700, fontWeight: '600', fontSize: 15 },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.gray50 },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, padding: 16, paddingVertical: 24 },
  inner: { width: '100%', maxWidth: 720, alignSelf: 'center' },
  header: { alignItems: 'center', marginBottom: 16 },
  logo: { width: 220, height: 90, marginBottom: 4 },
  subtitle: { fontSize: 13, color: Colors.gray500, textAlign: 'center' },
  card: { borderWidth: 0, overflow: 'hidden', ...Shadows.lg },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: Colors.blue600,
    paddingHorizontal: 20,
    paddingVertical: 18,
  },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.white, lineHeight: 22 },
  headerDesc: { marginTop: 4, fontSize: 13, color: Colors.blue100, lineHeight: 18 },
  cardContent: { padding: 20, gap: 0 },
  stepBody: { gap: 16 },
  uploadBox: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: Colors.blue200,
    borderRadius: Radius.lg,
    backgroundColor: Colors.blue50,
    paddingVertical: 28,
    paddingHorizontal: 16,
    alignItems: 'center',
    minHeight: 160,
    justifyContent: 'center',
  },
  uploadBoxSuccess: { borderColor: Colors.green200, backgroundColor: Colors.green50 },
  uploadIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: Colors.blue100,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  uploadLabel: { fontSize: 14, fontWeight: '600', color: Colors.blue700, textAlign: 'center' },
  uploadHint: { fontSize: 12, color: Colors.gray500, textAlign: 'center', marginTop: 4 },
  previewWrap: { width: '100%', position: 'relative' },
  previewImage: { width: '100%', height: 180, borderRadius: Radius.md, backgroundColor: Colors.gray100 },
  removeBtn: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.sm,
  },
  actionRow: { flexDirection: 'row', gap: 12 },
  scanBtn: { flex: 1, borderRadius: Radius.full, borderColor: Colors.blue200, minHeight: 48 },
  scanBtnText: { color: Colors.blue700, fontWeight: '600', fontSize: 14 },
  uploadBtn: { flex: 1, borderRadius: Radius.full, minHeight: 48 },
  uploadBtnText: { color: Colors.gray600, fontWeight: '600', fontSize: 14 },
  successBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.green200,
    backgroundColor: Colors.green50,
    padding: 14,
  },
  successBoxText: { flex: 1, gap: 2 },
  successBoxTitle: { fontSize: 14, fontWeight: '700', color: Colors.green800 },
  successBoxDesc: { fontSize: 13, color: Colors.green700, flex: 1, lineHeight: 18 },
  infoBlue: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.blue200,
    backgroundColor: Colors.blue50,
    padding: 14,
  },
  infoBlueText: { flex: 1, fontSize: 13, color: Colors.blue800, lineHeight: 18 },
  extractedHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  extractedLabel: { fontSize: 13, color: Colors.gray500 },
  extractedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.green100,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  extractedBadgeText: { fontSize: 11, fontWeight: '600', color: Colors.green700 },
  readOnlyInput: { backgroundColor: Colors.gray100 },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: Colors.yellow50,
    padding: 14,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.yellow200,
  },
  warningText: { flex: 1, fontSize: 13, color: Colors.gray800, lineHeight: 18 },
  warningBold: { fontWeight: '700', color: Colors.orange700 },
  cameraZone: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: Colors.blue200,
    borderRadius: Radius.lg,
    backgroundColor: Colors.blue50,
    minHeight: 176,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 16,
  },
  cameraIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.blue100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraZoneTitle: { fontSize: 14, fontWeight: '700', color: Colors.blue700 },
  cameraZoneHint: { fontSize: 12, color: Colors.gray500, textAlign: 'center' },
  selfieWrap: { borderRadius: Radius.lg, overflow: 'hidden', position: 'relative' },
  selfieImage: { width: '100%', height: 220, backgroundColor: Colors.gray900 },
  selfieOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  selfieOverlaySuccess: { backgroundColor: 'rgba(16,185,129,0.2)' },
  selfieOverlayError: { backgroundColor: 'rgba(220,38,38,0.38)' },
  selfieFailureIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
  },
  selfieOverlayText: { color: Colors.white, fontSize: 14 },
  attemptsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.gray50,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  attemptsBarLabel: { fontSize: 13, fontWeight: '600', color: Colors.gray600 },
  attemptsBarRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  attemptsDotsRow: { flexDirection: 'row', gap: 4 },
  attemptsDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.gray400 },
  attemptsDotFilled: { backgroundColor: Colors.red600, borderColor: Colors.red600 },
  attemptsCount: { fontSize: 13, fontWeight: '700', color: Colors.red700 },
  faceFailureCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.red200,
    backgroundColor: Colors.red50,
    borderRadius: Radius.lg,
    padding: 14,
  },
  faceFailureTitle: { fontSize: 14, fontWeight: '700', color: Colors.red700 },
  faceFailureMessage: { marginTop: 3, fontSize: 13, lineHeight: 18, color: Colors.red700 },
  faceRetryActions: { flexDirection: 'row', gap: 12 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.red200,
    backgroundColor: Colors.red50,
    padding: 14,
  },
  errorBoxText: { flex: 1, fontSize: 13, color: Colors.red700, lineHeight: 18 },
  verificationWarningCard: {
    borderWidth: 1.5,
    borderColor: Colors.yellow200,
    borderRadius: Radius.xl,
    overflow: 'hidden',
    backgroundColor: Colors.white,
  },
  verificationWarningHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    backgroundColor: Colors.yellow100,
    borderBottomWidth: 1,
    borderBottomColor: Colors.yellow200,
  },
  warningIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF3C4',
  },
  verificationWarningTitle: { fontSize: 16, fontWeight: '700', color: Colors.orange700 },
  verificationWarningSubtitle: { marginTop: 2, fontSize: 13, fontWeight: '600', color: Colors.orange700 },
  verificationWarningBody: { gap: 10, padding: 16 },
  verificationWarningMessage: { fontSize: 13, lineHeight: 19, color: Colors.orange700 },
  otpPanel: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.blue200,
    backgroundColor: Colors.white,
    padding: 16,
    gap: 14,
  },
  otpPanelHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  otpPanelIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.blue100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  otpPanelTitle: { fontSize: 15, fontWeight: '700', color: Colors.blue900 },
  otpPanelDesc: { fontSize: 13, color: Colors.blue700, marginTop: 2, lineHeight: 18 },
  otpNoticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.yellow200,
    backgroundColor: Colors.yellow50,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  otpNoticeText: { flex: 1, fontSize: 11, fontWeight: '600', color: Colors.orange700 },
  otpEmailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.lg,
    backgroundColor: Colors.gray50,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  otpEmailText: { flex: 1, fontSize: 13, fontWeight: '600', color: Colors.gray600 },
  readOnlyBadge: { borderRadius: Radius.full, backgroundColor: Colors.gray100, paddingHorizontal: 9, paddingVertical: 3 },
  readOnlyBadgeText: { fontSize: 11, fontWeight: '600', color: Colors.gray400 },
  otpFieldLabel: { fontSize: 12, color: Colors.gray500, fontWeight: '600' },
  otpFooterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  otpResendText: { fontSize: 13, color: Colors.gray500 },
  otpResendLink: { fontSize: 13, fontWeight: '700', color: Colors.blue600 },
  otpResendLinkDisabled: { color: Colors.gray400 },
  otpDivider: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  otpDividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  otpDividerText: { fontSize: 11, color: Colors.gray400 },
  bodyText: { fontSize: 13, color: Colors.gray600, lineHeight: 18 },
  roleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.lg,
    padding: 14,
    backgroundColor: Colors.white,
  },
  roleCardSelected: { borderColor: Colors.blue500, backgroundColor: Colors.blue50 },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.gray300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterSelected: { borderColor: Colors.blue600 },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.blue600 },
  roleEmoji: { fontSize: 24 },
  roleText: { flex: 1, gap: 2 },
  roleTitle: { fontSize: 15, fontWeight: '700', color: Colors.gray900 },
  roleDetail: { fontSize: 12, color: Colors.gray500, lineHeight: 16 },
  fieldError: { color: Colors.destructive, fontSize: 12 },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.green200,
    backgroundColor: Colors.green50,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.full,
  },
  verifiedText: { fontSize: 11, fontWeight: '600', color: Colors.green700 },
  prcBox: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.green200,
    backgroundColor: Colors.green50,
    padding: 14,
    gap: 12,
  },
  prcBoxHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  prcBoxTitle: { fontSize: 14, fontWeight: '700', color: Colors.green700 },
  prcGrid: { gap: 12 },
  prcItem: { gap: 2 },
  prcLabel: { fontSize: 11, color: Colors.gray500 },
  prcValue: { fontSize: 14, fontWeight: '600', color: Colors.gray900 },
  compareRow: { flexDirection: 'row', gap: 12 },
  compareBox: {
    flex: 1,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.gray50,
    padding: 12,
    gap: 4,
  },
  compareLabel: { fontSize: 11, color: Colors.gray500 },
  compareValue: { fontSize: 14, fontWeight: '600', color: Colors.gray900 },
  roleVerifiedBox: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.green200,
    backgroundColor: Colors.green50,
    padding: 14,
    gap: 10,
  },
  roleVerifiedHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  roleVerifiedTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  roleVerifiedTitle: { fontSize: 14, fontWeight: '700', color: Colors.green700 },
  roleMatchBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.green100,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  roleMatchBadgeText: { fontSize: 11, fontWeight: '600', color: Colors.green700 },
  roleVerifiedInner: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.green100,
    padding: 12,
    gap: 6,
  },
  roleVerifiedItem: { fontSize: 13, color: Colors.gray700 },
  roleAuthorized: { fontSize: 13, fontWeight: '600', color: Colors.green700 },
  roleMismatchBox: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.red200,
    backgroundColor: Colors.red50,
    padding: 14,
    gap: 10,
  },
  roleMismatchTitle: { fontSize: 14, fontWeight: '700', color: Colors.red700 },
  mismatchBadge: {
    backgroundColor: Colors.red100,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.red200,
  },
  mismatchBadgeText: { fontSize: 11, fontWeight: '600', color: Colors.red700 },
  roleMismatchDesc: { fontSize: 13, color: Colors.red700 },
  changeRoleBtn: { borderColor: Colors.red300, minHeight: 44 },
  changeRoleText: { color: Colors.red700, fontWeight: '600' },
  identityBox: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.green200,
    backgroundColor: Colors.green50,
    padding: 14,
    gap: 10,
  },
  identityHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  identityTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  identityTitle: { fontSize: 14, fontWeight: '700', color: Colors.green700 },
  completeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.green600,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  completeBadgeText: { fontSize: 11, fontWeight: '600', color: Colors.white },
  checkItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.green200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkDotDone: { backgroundColor: Colors.green600 },
  checkLabel: { fontSize: 13, color: Colors.gray800 },
  checkLabelPending: { color: Colors.gray500 },
  footerLogin: { marginTop: 20, textAlign: 'center', fontSize: 14, color: Colors.gray500 },
  footerLink: { color: Colors.blue600, fontWeight: '600' },
  terms: { marginTop: 8, textAlign: 'center', fontSize: 12, color: Colors.gray400 },
});
