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
import { CameraView, useCameraPermissions } from 'expo-camera';
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
  Send,
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
import { CameraPermissionModal, type CameraPurpose } from '../components/CameraPermissionModal';
import { Colors, Radius, Shadows } from '../constants/colors';
import {
  ApiError,
  faceVerificationRequest,
  faceVerificationStatusRequest,
  resendRegistrationOtpRequest,
  resetFaceVerificationRequest,
  saveRegistrationEmailRequest,
  sendRegistrationOtpRequest,
  verifyIdRequest,
  verifyRegistrationOtpRequest,
} from '../services/api';

const FACE_SESSION_KEY = 'nurselink.faceVerificationSession';
const MAX_FACE_ATTEMPTS = 3;

function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const data = err.data as
      | { message?: string; detail?: string; email?: string | string[]; non_field_errors?: string | string[] }
      | string
      | undefined;
    if (typeof data === 'string' && data.trim()) return data;
    if (data && typeof data === 'object') {
      if (data.message) return data.message;
      if (typeof data.detail === 'string') return data.detail;
      const emailErr = data.email;
      if (Array.isArray(emailErr) && emailErr[0]) return String(emailErr[0]);
      if (typeof emailErr === 'string') return emailErr;
      const nonField = data.non_field_errors;
      if (Array.isArray(nonField) && nonField[0]) return String(nonField[0]);
      const firstField = Object.values(data).find((v) => Array.isArray(v) && v[0]) as string[] | undefined;
      if (firstField?.[0]) return String(firstField[0]);
    }
    if (err.message) return err.message;
  }
  return fallback;
}

/**
 * Read the attempt count out of a server response.
 *
 * `fallback` is what to keep when the response carries no counter at all —
 * an error body, a proxy page, anything unparsed. Defaulting to 0 there was
 * a real bug: a failed request silently redisplayed "3 attempts remaining"
 * and handed back tries the server had already spent.
 */
function resolveAttemptsUsed(
  res: { attemptsUsed?: number; attemptsRemaining?: number },
  fallback = 0,
): number {
  if (typeof res.attemptsUsed === 'number') return Math.min(MAX_FACE_ATTEMPTS, Math.max(0, res.attemptsUsed));
  if (typeof res.attemptsRemaining === 'number') {
    return Math.min(MAX_FACE_ATTEMPTS, Math.max(0, MAX_FACE_ATTEMPTS - res.attemptsRemaining));
  }
  return Math.min(MAX_FACE_ATTEMPTS, Math.max(0, fallback));
}

function resolveMaxAttempts(res: { maxAttempts?: number }): number {
  return typeof res.maxAttempts === 'number' && res.maxAttempts > 0 ? res.maxAttempts : MAX_FACE_ATTEMPTS;
}

function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const visible = local.slice(0, Math.min(4, local.length));
  return `${visible}${'*'.repeat(8)}${domain}`;
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

type WizardStep = 1 | 2 | 3 | 4 | 5;
type ProcessStatus = 'idle' | 'processing' | 'success' | 'failed';

const STEP_LABELS = ['PRC ID', 'ID Review', 'Face Check', 'Role', 'Credentials'];

const STEP_TITLES = [
  'PRC Identity Verification',
  'Extracted ID Information',
  'Mandatory Face Verification',
  'Role Selection',
  'Account Credentials',
];

const STEP_DESCRIPTIONS = [
  'Scan your PRC ID to automatically extract your information.',
  'Review your extracted information. These fields are read-only.',
  'Capture a live selfie to confirm your identity.',
  'Select the role you are registering for.',
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


const defaultOcrData = {
  fullName: '',
  lastName: '',
  firstName: '',
  middleName: '',
  registrationNumber: '',
  registrationDate: '',
  validUntil: '',
  // Kept for backward compatibility — email still backs the OTP fallback,
  // position still feeds the Step 6 role cross-check, even though Step 2
  // no longer displays these.
  employeeId: '',
  department: '',
  position: '',
  hospitalName: '',
  email: '',
};

// The backend sends registrationDate/validUntil as ISO (YYYY-MM-DD) — that's
// the right format to store and compare, but "May 21, 2005" reads better on
// Step 2's review screen. Display-only: ocrData itself stays ISO.
function formatDisplayDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [year, month, day] = iso.split('-');
  return `${month}/${day}/${year}`;
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
  const faceVerificationInFlight = useRef(false);
  const otpSendInFlight = useRef(false);
  const otpVerifyInFlight = useRef(false);
  const cameraRef = useRef<CameraView>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  // Which camera feature is waiting on permission, and what to run once it
  // is granted. Held as state rather than called inline so the explainer can
  // be shown *before* the OS prompt, and the original action resumed after.
  const [permissionPrompt, setPermissionPrompt] = useState<CameraPurpose | null>(null);
  const [permissionBlocked, setPermissionBlocked] = useState(false);
  const pendingCameraAction = useRef<null | (() => void | Promise<void>)>(null);

  /**
   * Gate any camera action behind an explained permission request.
   *
   * Runs `action` immediately when access is already granted, so a nurse who
   * has used the camera before is never asked twice.
   */
  const withCameraPermission = (purpose: CameraPurpose, action: () => void | Promise<void>) => {
    if (cameraPermission?.granted) {
      void action();
      return;
    }
    pendingCameraAction.current = action;
    setPermissionBlocked(cameraPermission?.canAskAgain === false);
    setPermissionPrompt(purpose);
  };

  const handleAllowCamera = async () => {
    const result = await requestCameraPermission();
    if (result.granted) {
      setPermissionPrompt(null);
      const action = pendingCameraAction.current;
      pendingCameraAction.current = null;
      void action?.();
      return;
    }
    // Denied. If the OS will no longer prompt, the modal switches to
    // Settings guidance rather than offering a button that does nothing.
    if (!result.canAskAgain) {
      setPermissionBlocked(true);
      return;
    }
    setPermissionPrompt(null);
    pendingCameraAction.current = null;
    setError('Camera access is needed for this step. You can allow it when you are ready.');
  };

  const handleCancelCamera = () => {
    setPermissionPrompt(null);
    setPermissionBlocked(false);
    pendingCameraAction.current = null;
  };

  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [hospitalIdCompleted, setHospitalIdCompleted] = useState(false);
  const [idReviewCompleted, setIdReviewCompleted] = useState(false);
  const [idReviewSaving, setIdReviewSaving] = useState(false);
  const [faceVerificationCompleted, setFaceVerificationCompleted] = useState(false);
  const [roleSelected, setRoleSelected] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState<UserRole | ''>('');
  const [hospitalIdUri, setHospitalIdUri] = useState<string | null>(null);
  const [hospitalIdBase64, setHospitalIdBase64] = useState<string | null>(null);
  const [selfieUri, setSelfieUri] = useState<string | null>(null);
  const [faceStatus, setFaceStatus] = useState<ProcessStatus>('idle');
  const [liveCameraActive, setLiveCameraActive] = useState(false);
  const [ocrData, setOcrData] = useState(defaultOcrData);
  const [ocrStatus, setOcrStatus] = useState<ProcessStatus>('idle');
  // What the backend flagged for human confirmation on Step 2. A low-confidence
  // read is never saved silently — the nurse has to look at it first.
  const [ocrReview, setOcrReview] = useState<{
    needsReview: string[];
    missingRequired: string[];
    overallConfidence: number;
    n8nStatus: string;
    duplicateScan: boolean;
  }>({ needsReview: [], missingRequired: [], overallConfidence: 0, n8nStatus: '', duplicateScan: false });

  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [registrationSessionId, setRegistrationSessionId] = useState<string | null>(null);
  const [faceAttemptsUsed, setFaceAttemptsUsed] = useState(0);
  const [faceMaxAttempts, setFaceMaxAttempts] = useState(MAX_FACE_ATTEMPTS);
  const [faceLocked, setFaceLocked] = useState(false);
  const [faceResetPending, setFaceResetPending] = useState(false);
  const [faceResuming, setFaceResuming] = useState(true);
  const [showOtpPanel, setShowOtpPanel] = useState(false);
  const [otpEmailInput, setOtpEmailInput] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpStatus, setOtpStatus] = useState<'idle' | 'email_entry' | 'sending' | 'awaiting' | 'verifying' | 'verified'>('idle');
  const [otpError, setOtpError] = useState('');
  const [otpExpiresAt, setOtpExpiresAt] = useState<number | null>(null);
  const [otpResendAvailableAt, setOtpResendAvailableAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }).start();
  }, [fadeAnim]);

  // The error banner is shared across the whole wizard (rendered once, above
  // every step) — clear it on every step change so a stale error from a
  // previous step (e.g. a resolved face-verification lockout) doesn't keep
  // showing after the user has moved on.
  useEffect(() => {
    setError('');
  }, [currentStep]);

  const persistFaceSession = (id: string, attempts: number, locked: boolean) =>
    AsyncStorage.setItem(
      FACE_SESSION_KEY,
      JSON.stringify({ id, attempts: Math.min(MAX_FACE_ATTEMPTS, Math.max(0, attempts)), locked })
    );

  // Resets the face-verification UI (attempts shown, selfie, OTP panel) for a
  // fresh cycle without touching registrationSessionId — used when entering
  // Face Verification right after Step 1/2 just established that session, so
  // the ID-verified session is carried forward rather than discarded.
  const resetFaceCycleUI = () => {
    setFaceAttemptsUsed(0);
    setFaceMaxAttempts(MAX_FACE_ATTEMPTS);
    setFaceLocked(false);
    setFaceStatus('idle');
    setError('');
    setSelfieUri(null);
    setLiveCameraActive(false);
    setShowOtpPanel(false);
    setOtpCode('');
    setOtpEmailInput('');
    setOtpError('');
    setOtpStatus('idle');
    setOtpExpiresAt(null);
    setOtpResendAvailableAt(null);
    faceVerificationInFlight.current = false;
  };

  // Full reset used when there is no session worth keeping — a brand new ID
  // scan superseding any prior attempt, or nothing persisted to resume on
  // mount. Also drops registrationSessionId and the persisted session id.
  const clearFaceCycleLocal = async () => {
    await AsyncStorage.removeItem(FACE_SESSION_KEY).catch(() => undefined);
    setRegistrationSessionId(null);
    resetFaceCycleUI();
  };

  // Resume face/OTP verification state from the backend on mount, so closing
  // and reopening the app cannot silently reset the 3-attempt counter or an
  // active lockout — RegistrationSession on the server is the sole source of
  // truth. Only a persisted session id the backend confirms is gone
  // (expired, already used, never existed) falls back to a clean cycle.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const raw = await AsyncStorage.getItem(FACE_SESSION_KEY).catch(() => null);
      let persistedId: string | undefined;
      try {
        persistedId = raw ? (JSON.parse(raw) as { id?: string }).id : undefined;
      } catch {
        persistedId = undefined;
      }
      if (!persistedId) {
        await clearFaceCycleLocal();
        if (!cancelled) setFaceResuming(false);
        return;
      }
      try {
        const res = await faceVerificationStatusRequest({ registrationSessionId: persistedId });
        if (cancelled) return;
        setRegistrationSessionId(res.registrationSessionId ?? persistedId ?? null);
        setFaceMaxAttempts(resolveMaxAttempts(res));
        setFaceAttemptsUsed(resolveAttemptsUsed(res, faceAttemptsUsed));
        setFaceLocked(Boolean(res.locked));
        if (res.faceVerified) {
          setFaceStatus('success');
          setFaceVerificationCompleted(true);
        } else if (res.otpVerified) {
          setOtpStatus('verified');
        }
      } catch {
        await clearFaceCycleLocal();
      } finally {
        if (!cancelled) setFaceResuming(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (currentStep !== 3) {
      setLiveCameraActive(false);
      return;
    }
    if (
      faceResuming ||
      faceLocked ||
      showOtpPanel ||
      faceStatus === 'success' ||
      faceStatus === 'processing' ||
      faceStatus === 'failed' ||
      selfieUri
    ) {
      return;
    }
    setLiveCameraActive(true);
  }, [currentStep, faceResuming, faceLocked, showOtpPanel, faceStatus, selfieUri]);

  const completedThrough: WizardStep = (() => {
    if (roleSelected) return 5;
    if (faceVerificationCompleted || otpStatus === 'verified') return 4;
    if (idReviewCompleted) return 3;
    if (hospitalIdCompleted) return 2;
    return 1;
  })();

  /**
   * Steps 1 & 2 — PRC ID capture and verification.
   *
   * The backend checks the upload actually carries a portrait photo (OpenCV,
   * runs locally) before spending an OCR call, then posts the image to the
   * n8n identity-verify workflow (VerifyIdView, action: 'ocr') and maps its
   * response onto the fields Step 2 displays.
   */
  const runIdVerification = async (base64: string | null) => {
    if (!base64) {
      setOcrStatus('failed');
      setError('Could not read the ID photo. Please retake it.');
      return;
    }

    setOcrStatus('processing');
    setError('');

    try {
      const res = await verifyIdRequest(`data:image/jpeg;base64,${base64}`, {
        registrationSessionId,
        documentType: 'prc_license',
        expectedRole: role,
      });

      setRegistrationSessionId(res.registrationSessionId);
      // Persist immediately — not just after a face attempt — so a remount
      // between finishing ID verification and starting Face Verification
      // (backgrounding the app, a dev reload, navigating back) can still
      // recover this exact session instead of silently starting a new,
      // unverified one keyed by email.
      if (res.registrationSessionId) {
        void persistFaceSession(res.registrationSessionId, 0, false);
      }

      // Every non-'verified' status is a hard block now — the backend's
      // strict field validation (last/first name, registration no., both
      // dates) is what decides this, not just "did something come back".
      // A 'validation_error' means fields WERE extracted but at least one
      // failed structural validation (e.g. a mis-parsed label ended up in a
      // name field) — accuracy matters more than filling every box, so this
      // is never silently accepted for review.
      if (!res.verified) {
        setOcrStatus('failed');
        const detail = res.errors ? Object.values(res.errors)[0] : undefined;
        setError(detail || res.message || 'Unable to extract information from the PRC ID. Please capture a clearer image.');
        return;
      }

      setOcrData({
        fullName: res.fullName,
        lastName: res.lastName,
        firstName: res.firstName,
        middleName: res.middleName,
        registrationNumber: res.registrationNumber,
        registrationDate: res.registrationDate,
        validUntil: res.validUntil,
        employeeId: res.employeeId,
        hospitalName: res.hospitalName,
        department: res.department,
        position: res.position,
        email: res.email,
      });
      setOcrStatus('success');
      setHospitalIdCompleted(true);
    } catch (err) {
      setOcrStatus('failed');
      setError(
        err instanceof ApiError
          ? err.message
          : 'ID verification is unavailable right now. Please try again.'
      );
    }
  };

  const handleIdImage = (uri: string, base64: string | null) => {
    setHospitalIdUri(uri);
    setHospitalIdBase64(base64);
    setIdReviewCompleted(false);
    setFaceVerificationCompleted(false);
    setRoleSelected(false);
    setRole('');
    void clearFaceCycleLocal();
    void runIdVerification(base64);
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

  const handleScanId = () => {
    setError('');
    // Same explained gate as the face step. ImagePicker would otherwise raise
    // its own bare prompt with no context attached.
    withCameraPermission('id', async () => {
      const result = await ImagePicker.launchCameraAsync({
        quality: 0.9,
        allowsEditing: true,
        base64: true,
      });
      if (!result.canceled) handleIdImage(result.assets[0].uri, result.assets[0].base64 ?? null);
    });
  };

  const openLiveCamera = () => {
    setError('');
    // The camera is only mounted after permission is granted — asking first
    // is both an OS requirement and the reason the request is understood.
    withCameraPermission('face', () => {
      setSelfieUri(null);
      setFaceStatus('idle');
      setLiveCameraActive(true);
    });
  };

  const handleFaceVerification = async () => {
    if (faceVerificationInFlight.current) return;
    faceVerificationInFlight.current = true;
    try {
      setError('');
      if (!hospitalIdBase64) {
        setError('Please re-upload your PRC ID photo in Step 1 before continuing.');
        return;
      }
      if (!cameraRef.current) {
        setError('Camera is not ready. Please try again.');
        return;
      }

      let photo;
      try {
        photo = await cameraRef.current.takePictureAsync({
          quality: 0.85,
          base64: true,
          skipProcessing: false,
        });
      } catch {
        setError('Camera capture failed. Please try again.');
        return;
      }

      if (!photo?.base64) {
        setError('Could not read the captured photo. Please try again.');
        return;
      }

      setSelfieUri(photo.uri);
      setLiveCameraActive(false);
      setFaceStatus('processing');

      try {
        const res = await faceVerificationRequest(
          `data:image/jpeg;base64,${photo.base64}`,
          `data:image/jpeg;base64,${hospitalIdBase64}`,
          registrationSessionId,
          ocrData.email
        );
        setRegistrationSessionId(res.registrationSessionId);
        const maxAttempts = resolveMaxAttempts(res);
        setFaceMaxAttempts(maxAttempts);
        const attempts = resolveAttemptsUsed(res, faceAttemptsUsed);
        setFaceAttemptsUsed(attempts);
        void persistFaceSession(res.registrationSessionId, attempts, Boolean(res.locked));
        if (res.matched || res.faceVerified) {
          setFaceStatus('success');
          setFaceVerificationCompleted(true);
          setFaceLocked(false);
          await AsyncStorage.removeItem(FACE_SESSION_KEY);
          return;
        }
        setFaceStatus('failed');
        setError(res.message || 'Face verification failed. Please position your face correctly and try again.');
        // Fallback UI only after backend confirms all attempts are used.
        setFaceLocked(Boolean(res.locked) && attempts >= maxAttempts);
      } catch (err) {
        setFaceStatus('failed');
        if (err instanceof ApiError) {
          const data = err.data as {
            registrationSessionId?: string;
            message?: string;
            attemptsUsed?: number;
            attemptsRemaining?: number;
            maxAttempts?: number;
            locked?: boolean;
          } | undefined;
          if (data?.registrationSessionId) {
            setRegistrationSessionId(data.registrationSessionId);
            const maxAttempts = resolveMaxAttempts(data);
            const attempts = resolveAttemptsUsed(data, faceAttemptsUsed);
            const locked = Boolean(data.locked) && attempts >= maxAttempts;
            setFaceMaxAttempts(maxAttempts);
            setFaceAttemptsUsed(Math.min(maxAttempts, Math.max(0, attempts)));
            setFaceLocked(locked);
            void persistFaceSession(data.registrationSessionId, attempts, locked);
          }
          const maxAttempts = resolveMaxAttempts(data ?? {});
          const attempts = resolveAttemptsUsed(data ?? {});
          const locked = Boolean(data?.locked) && attempts >= maxAttempts;
          setError(locked
            ? data?.message || `You've used all ${maxAttempts} face verification attempts. Choose Retry Face Verification or Verify Using Email OTP.`
            : extractErrorMessage(err, 'Face verification failed. Please try again.'));
        } else {
          // Network/UI errors do not count as face attempts.
          setError(extractErrorMessage(err, 'Face verification failed. Please try again.'));
        }
      }
    } finally {
      faceVerificationInFlight.current = false;
    }
  };

  const removeFailedSelfie = () => {
    // Manual progression only — do not call the API / increment attempts here.
    setSelfieUri(null);
    setFaceStatus('idle');
    setError('');
    void openLiveCamera();
  };

  const resetOtpState = () => {
    setOtpCode('');
    setOtpEmailInput('');
    setOtpError('');
    setOtpStatus('idle');
    setOtpExpiresAt(null);
    setOtpResendAvailableAt(null);
    setShowOtpPanel(false);
  };

  const handleModalRetake = async () => {
    if (faceResetPending) return;
    if (!registrationSessionId) {
      setFaceLocked(false);
      setFaceAttemptsUsed(0);
      setFaceMaxAttempts(MAX_FACE_ATTEMPTS);
      setFaceStatus('idle');
      setError('');
      setSelfieUri(null);
      setFaceVerificationCompleted(false);
      resetOtpState();
      await openLiveCamera();
      return;
    }
    setFaceResetPending(true);
    try {
      const res = await resetFaceVerificationRequest(registrationSessionId);
      await AsyncStorage.removeItem(FACE_SESSION_KEY);
      setFaceLocked(false);
      setFaceAttemptsUsed(0);
      setFaceMaxAttempts(resolveMaxAttempts(res));
      setFaceStatus('idle');
      setError('');
      setSelfieUri(null);
      setFaceVerificationCompleted(false);
      resetOtpState();
      await openLiveCamera();
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not reset verification. Please try again.'));
    } finally {
      setFaceResetPending(false);
    }
  };

  const handleOpenOtp = () => {
    setLiveCameraActive(false);
    setShowOtpPanel(true);
    setOtpStatus('email_entry');
    setOtpError('');
    setOtpCode('');
    // Display-only — pre-filled from the registered email already on file
    // (Step 2). The OTP always goes to the backend's stored session email
    // regardless of this value; it is never editable or sent as the
    // destination.
    setOtpEmailInput(ocrData.email || '');
  };

  // A 429 (cooldown / resend limit) response carries the server's authoritative
  // wait time in `retryAfter` — resync the resend countdown to it instead of
  // leaving the button keyed off a possibly-stale local timestamp.
  const applyOtpRetryAfter = (err: unknown) => {
    if (err instanceof ApiError && err.status === 429) {
      const retryAfter = (err.data as { retryAfter?: number } | undefined)?.retryAfter;
      if (typeof retryAfter === 'number' && retryAfter > 0) {
        setOtpResendAvailableAt(Date.now() + retryAfter * 1000);
      }
    }
  };

  const handleSendOtp = async () => {
    if (otpSendInFlight.current) return;
    if (!registrationSessionId) return;
    otpSendInFlight.current = true;
    setOtpStatus('sending');
    setOtpError('');
    try {
      const res = await sendRegistrationOtpRequest(registrationSessionId);
      setOtpStatus('awaiting');
      setOtpCode('');
      setOtpExpiresAt(Date.now() + (res.expiresIn ?? 300) * 1000);
      setOtpResendAvailableAt(Date.now() + (res.resendCooldown ?? 60) * 1000);
    } catch (err) {
      setOtpStatus('email_entry');
      applyOtpRetryAfter(err);
      setOtpError(extractErrorMessage(err, 'Email Not Found. This email is not associated with your registration.'));
    } finally {
      otpSendInFlight.current = false;
    }
  };

  const handleResendOtp = async () => {
    if (otpSendInFlight.current) return;
    if (!registrationSessionId) return;
    otpSendInFlight.current = true;
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
      applyOtpRetryAfter(err);
      setOtpError(extractErrorMessage(err, 'Failed to resend verification code. Please try again.'));
    } finally {
      otpSendInFlight.current = false;
    }
  };

  const handleVerifyOtp = async () => {
    if (otpVerifyInFlight.current) return;
    if (!registrationSessionId || otpCode.length !== 6) return;
    otpVerifyInFlight.current = true;
    setOtpStatus('verifying');
    setOtpError('');
    try {
      const res = await verifyRegistrationOtpRequest(otpCode, registrationSessionId);
      if (res.verified) {
        setOtpStatus('verified');
        await AsyncStorage.removeItem(FACE_SESSION_KEY);
      } else {
        setOtpStatus('awaiting');
        setOtpError(res.message || 'Invalid or expired verification code.');
      }
    } catch (err) {
      setOtpStatus('awaiting');
      setOtpError(extractErrorMessage(err, 'Invalid or expired verification code.'));
    } finally {
      otpVerifyInFlight.current = false;
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
    if (!identityVerified || !hospitalIdCompleted || !roleSelected) {
      setError('Please complete all verification steps before creating your account.');
      return;
    }
    if (!registrationSessionId) {
      setError('Identity verification session was lost. Please redo Face or Email OTP verification.');
      return;
    }
    try {
      // Prefer the discrete name parts Step 2 now collects directly; fall
      // back to splitting fullName only for a workflow that still returns
      // just a combined name.
      const firstName = ocrData.firstName || ocrData.fullName.split(' ')[0] || '';
      const lastName = ocrData.lastName || ocrData.fullName.split(' ').slice(-1).join(' ') || '';
      const middleName = ocrData.middleName || ocrData.fullName.split(' ').slice(1, -1).join(' ') || '';
      await signup({
        name: ocrData.fullName,
        firstName,
        middleName,
        lastName,
        role: role as UserRole,
        email,
        password,
        department: ocrData.department,
        // Read from the Hospital ID in Step 1; there is no separate PRC step.
        licenseNumber: (ocrData.registrationNumber || '').trim(),
        registrationSessionId,
      });
      // Keep the user on the pending-approval screen; do not leave them logged in.
      logout();
      router.replace({ pathname: '/pending-approval', params: { method: verificationMethod ?? '' } });
    } catch (err) {
      setError(extractErrorMessage(err, 'Unable to create account. Please try again.'));
    }
  };

  const idUploaded = !!hospitalIdUri && hospitalIdCompleted;
  const ocrDone = ocrStatus === 'success';
  const credsDone = email.trim() !== '' && password.length >= 8 && password === confirmPassword;
  const canSubmit =
    identityVerified && ocrDone && idUploaded && roleSelected && credsDone;

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
        return <Lock size={20} color={Colors.white} />;
      default:
        return <Lock size={20} color={Colors.white} />;
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Explains the request before the OS prompt appears, and never mounts
          a camera until access has actually been granted. */}
      <CameraPermissionModal
        visible={permissionPrompt !== null}
        purpose={permissionPrompt ?? 'face'}
        blocked={permissionBlocked}
        onAllow={handleAllowCamera}
        onCancel={handleCancelCamera}
      />
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
                    Step {currentStep} of {STEP_LABELS.length} — {STEP_TITLES[currentStep - 1]}
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
                          <Text style={styles.uploadLabel}>Drag & drop or tap to upload your PRC ID</Text>
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
                        <Text style={styles.infoBlueText}>Scanning and extracting information...</Text>
                      </View>
                    )}

                    {ocrStatus === 'success' && (
                      <View style={styles.successBox}>
                        <CheckCircle2 size={18} color={Colors.green600} />
                        <View style={styles.successBoxText}>
                          <Text style={styles.successBoxTitle}>PRC ID information extracted successfully</Text>
                          <Text style={styles.successBoxDesc}>Review your information on the next step.</Text>
                        </View>
                      </View>
                    )}

                    <NavButtons showBack={false} onContinue={() => setCurrentStep(2)} continueDisabled={ocrStatus !== 'success'} />
                  </View>
                )}

                {currentStep === 2 && (
                  <View style={styles.stepBody}>
                    <View style={styles.extractedHeader}>
                      <Text style={styles.extractedLabel}>Automatically extracted from your PRC ID</Text>
                      <View style={styles.extractedBadge}>
                        <CheckCircle2 size={12} color={Colors.green700} />
                        <Text style={styles.extractedBadgeText}>Information Successfully Extracted</Text>
                      </View>
                    </View>

                    <View style={styles.successBox}>
                      <CheckCircle2 size={16} color={Colors.green600} />
                      <Text style={styles.successBoxDesc}>
                        These details were read directly from your scanned PRC ID and cannot be edited.
                      </Text>
                    </View>

                    {ocrReview.needsReview.length > 0 && (
                      <Alert variant="warning">
                        <AlertDescription>
                          {ocrReview.needsReview.length} field
                          {ocrReview.needsReview.length === 1 ? '' : 's'} could not be read
                          confidently. Check the highlighted field
                          {ocrReview.needsReview.length === 1 ? '' : 's'} below and correct
                          {ocrReview.needsReview.length === 1 ? ' it' : ' them'}, or go back and
                          rescan your ID.
                        </AlertDescription>
                      </Alert>
                    )}

                    {ocrReview.duplicateScan && (
                      <Alert variant="warning">
                        <AlertDescription>
                          This licence number was already scanned recently. Continue only if this
                          is your own ID.
                        </AlertDescription>
                      </Alert>
                    )}

                    {[
                      { label: 'Last Name', value: ocrData.lastName },
                      { label: 'First Name', value: ocrData.firstName },
                      { label: 'Middle Name', value: ocrData.middleName },
                      { label: 'Registration No.', value: ocrData.registrationNumber },
                      { label: 'Registration Date', value: formatDisplayDate(ocrData.registrationDate) },
                      { label: 'Valid Until', value: formatDisplayDate(ocrData.validUntil) },
                    ].map((field) => (
                      <Input key={field.label} label={field.label} value={field.value} editable={false} inputWrapperStyle={styles.readOnlyInput} />
                    ))}
                    <Input
                      label="Registered Email Address"
                      value={ocrData.email}
                      onChangeText={(v) => setOcrData({ ...ocrData, email: v.trim() })}
                      placeholder="Enter the email associated with this registration"
                      autoCapitalize="none"
                      keyboardType="email-address"
                    />
                    <Text style={styles.registeredEmailHint}>
                      This email is stored with your registration and used for Email OTP if face verification fails. Use
                      a real inbox you can access.
                    </Text>

                    <NavButtons
                      onBack={() => setCurrentStep(1)}
                      onContinue={async () => {
                        // Nothing proceeds until every required field actually
                        // has a value — a blank one must never be saved as read.
                        const stillMissing = ocrReview.missingRequired.filter(
                          (key) => !String((ocrData as Record<string, string>)[key] ?? '').trim()
                        );
                        if (stillMissing.length > 0) {
                          setError(
                            `Please fill in the highlighted field${stillMissing.length === 1 ? '' : 's'} before continuing.`
                          );
                          return;
                        }
                        if (!ocrData.email || !ocrData.email.includes('@')) {
                          setError('Please enter the registered email address before continuing.');
                          return;
                        }
                        if (!registrationSessionId) {
                          setError('Identity verification session was lost. Please redo Step 1.');
                          return;
                        }
                        setError('');
                        setIdReviewSaving(true);
                        try {
                          await saveRegistrationEmailRequest(registrationSessionId, ocrData.email);
                        } catch (err) {
                          setIdReviewSaving(false);
                          setError(extractErrorMessage(err, "We couldn't save your registered email. Please try again."));
                          return;
                        }
                        setIdReviewSaving(false);
                        setIdReviewCompleted(true);
                        resetFaceCycleUI();
                        setCurrentStep(3);
                      }}
                      continueDisabled={idReviewSaving}
                    />
                  </View>
                )}

                {currentStep === 3 && (
                  <View style={styles.stepBody}>
                    {!showOtpPanel && (
                      <View style={styles.warningBox}>
                        <AlertTriangle size={18} color={Colors.orange600} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.warningText}>
                            <Text style={styles.warningBold}>Face Verification</Text> is required. Use your device
                            camera for a live face scan — gallery uploads are not permitted.
                          </Text>
                          <Text style={[styles.warningText, { marginTop: 6 }]}>
                            Position your face inside the frame. Make sure your face is clearly visible. Keep your face
                            centered.
                          </Text>
                          <Text style={[styles.warningText, { marginTop: 4 }]}>
                            After 3 failed attempts you can retry face verification or verify using Email OTP.
                          </Text>
                        </View>
                      </View>
                    )}

                    {!showOtpPanel && (
                      <View style={styles.attemptsBar}>
                        <Text style={styles.attemptsBarLabel}>
                          Attempts remaining:{' '}
                          <Text style={styles.attemptsCount}>
                            {Math.max(0, faceMaxAttempts - faceAttemptsUsed)}
                          </Text>
                        </Text>
                        <View style={styles.attemptsDotsRow}>
                          {Array.from({ length: faceMaxAttempts }).map((_, i) => (
                            <View
                              key={i}
                              style={[styles.attemptsDot, i < faceAttemptsUsed && styles.attemptsDotFilled]}
                            />
                          ))}
                        </View>
                      </View>
                    )}

                    {!faceLocked && !showOtpPanel && (
                      <>
                        {faceStatus === 'success' ? (
                          <View style={styles.faceSuccessCard}>
                            <CheckCircle2 size={36} color={Colors.green600} />
                            <Text style={styles.faceSuccessTitle}>Face Verified Successfully</Text>
                            <Text style={styles.faceSuccessDesc}>Your identity has been verified.</Text>
                          </View>
                        ) : selfieUri && !faceLocked ? (
                          <View style={styles.selfieWrap}>
                            <Image source={{ uri: selfieUri }} style={styles.selfieImage} />
                            {faceStatus === 'processing' && (
                              <View style={styles.selfieOverlay}>
                                <ActivityIndicator color={Colors.white} />
                                <Text style={styles.selfieOverlayText}>Verifying your face...</Text>
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
                        ) : liveCameraActive && cameraPermission?.granted ? (
                          <View style={styles.liveCameraWrap}>
                            <View style={styles.liveCameraInner}>
                              <CameraView ref={cameraRef} style={styles.liveCamera} facing="front" />
                              <View style={styles.liveCameraFrame} pointerEvents="none" />
                            </View>
                            <Text style={styles.liveCameraHint}>
                              {faceAttemptsUsed === faceMaxAttempts - 1
                                ? 'This is your final face verification attempt.'
                                : 'Please position your face inside the camera.'}
                            </Text>
                            <Button
                              size="lg"
                              onPress={handleFaceVerification}
                              disabled={faceStatus === 'processing'}
                              style={navStyles.continueFull}
                            >
                              {faceStatus === 'processing' ? (
                                <ActivityIndicator color={Colors.white} />
                              ) : (
                                <Camera size={16} color={Colors.white} />
                              )}
                              <Text style={navStyles.btnText}>
                                {faceStatus === 'processing' ? 'Verifying your face...' : 'Verify Face'}
                              </Text>
                            </Button>
                          </View>
                        ) : (
                          <Pressable style={styles.cameraZone} onPress={openLiveCamera}>
                            <View style={styles.cameraIconCircle}>
                              <Video size={28} color={Colors.blue600} />
                            </View>
                            <Text style={styles.cameraZoneTitle}>Open Live Camera</Text>
                            <Text style={styles.cameraZoneHint}>Live face scan only — image uploads are not allowed</Text>
                          </Pressable>
                        )}

                        {selfieUri && faceStatus === 'failed' && !faceLocked && (
                          <>
                            <View style={styles.faceFailureCard}>
                              <XCircle size={18} color={Colors.red600} />
                              <View style={{ flex: 1 }}>
                                <Text style={styles.faceFailureTitle}>Face Verification Failed</Text>
                                <Text style={styles.faceFailureMessage}>
                                  {error || "We couldn't verify your face."}
                                </Text>
                                <Text style={[styles.faceFailureMessage, { marginTop: 4, fontWeight: '700' }]}>
                                  Attempts remaining: {Math.max(0, faceMaxAttempts - faceAttemptsUsed)}
                                </Text>
                                <Text style={[styles.faceFailureMessage, { marginTop: 4 }]}>
                                  {faceAttemptsUsed === 1
                                    ? 'Please make sure your face is clearly visible and positioned inside the frame.'
                                    : 'Please try again.'}
                                </Text>
                                {error ? (
                                  <Text style={[styles.faceFailureMessage, { marginTop: 4, fontSize: 11 }]}>{error}</Text>
                                ) : null}
                              </View>
                            </View>
                            <View style={styles.faceRetryActions}>
                              <Button variant="outline" size="lg" onPress={removeFailedSelfie} style={{ flex: 1 }}>
                                <RefreshCw size={16} color={Colors.gray700} />
                                <Text style={navStyles.backText}>Try Again</Text>
                              </Button>
                            </View>
                          </>
                        )}
                      </>
                    )}

                    {faceLocked && faceAttemptsUsed >= faceMaxAttempts && !showOtpPanel && (
                      <View style={styles.verificationWarningCard}>
                        <View style={styles.verificationWarningHeader}>
                          <View style={styles.warningIconCircle}>
                            <AlertTriangle size={20} color={Colors.orange600} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.verificationWarningTitle}>Face Verification Failed</Text>
                            <Text style={styles.verificationWarningSubtitle}>
                              {error || `You've used all ${faceMaxAttempts} face verification attempts.`}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.verificationWarningBody}>
                          <Text style={styles.verificationWarningMessage}>Please choose another option.</Text>
                          {otpError ? (
                            <View style={styles.errorBox}>
                              <AlertCircle size={16} color={Colors.red700} />
                              <Text style={styles.errorBoxText}>{otpError}</Text>
                            </View>
                          ) : null}
                          <Button
                            variant="outline"
                            size="lg"
                            onPress={handleModalRetake}
                            disabled={faceResetPending || otpStatus === 'sending'}
                          >
                            {faceResetPending ? (
                              <ActivityIndicator color={Colors.primary} />
                            ) : (
                              <RefreshCw size={16} color={Colors.orange700} />
                            )}
                            <Text style={[navStyles.backText, { color: Colors.orange700 }]}>
                              {faceResetPending ? 'Resetting...' : 'Retry Face Verification'}
                            </Text>
                          </Button>
                          <Text style={styles.otpDividerText}>or</Text>
                          <Button size="lg" onPress={handleOpenOtp} disabled={otpStatus === 'sending' || faceResetPending}>
                            <Mail size={16} color={Colors.white} />
                            <Text style={navStyles.btnText}>Verify Using Email OTP</Text>
                          </Button>
                        </View>
                      </View>
                    )}

                    {showOtpPanel && (
                      <View style={styles.otpPanel}>
                        <View style={styles.otpPanelHeader}>
                          <View style={styles.otpPanelIconCircle}>
                            <Mail size={20} color={Colors.blue600} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.otpPanelTitle}>Email Verification</Text>
                            <Text style={styles.otpPanelDesc}>
                              We'll send a verification code to your registered email address.
                            </Text>
                          </View>
                        </View>

                        {(otpStatus === 'email_entry' || otpStatus === 'sending') && (
                          <View style={{ gap: 12 }}>
                            <Input
                              label="Registered Email"
                              value={otpEmailInput ? maskEmail(otpEmailInput) : ''}
                              placeholder="Registered email on file"
                              editable={false}
                            />
                            {otpError ? (
                              <View style={styles.errorBox}>
                                <AlertCircle size={16} color={Colors.red700} />
                                <Text style={styles.errorBoxText}>{otpError}</Text>
                              </View>
                            ) : null}
                            <Button
                              size="lg"
                              onPress={handleSendOtp}
                              disabled={otpStatus === 'sending'}
                              style={navStyles.continueFull}
                            >
                              {otpStatus === 'sending' ? (
                                <ActivityIndicator color={Colors.white} />
                              ) : (
                                <Send size={16} color={Colors.white} />
                              )}
                              <Text style={navStyles.btnText}>
                                {otpStatus === 'sending' ? 'Sending verification code...' : 'Send Verification Code'}
                              </Text>
                            </Button>
                          </View>
                        )}

                        {(otpStatus === 'awaiting' || otpStatus === 'verifying' || otpStatus === 'verified') && (
                          <>
                            <Text style={styles.otpPanelTitle}>Verify Your Email</Text>
                            <Text style={styles.otpPanelDesc}>
                              We&apos;ve sent a 6-digit verification code to your registered email.
                            </Text>
                            <View style={{ gap: 8 }}>
                              <Text style={styles.otpFieldLabel}>Enter Verification Code</Text>
                              <OtpDigitsInput
                                value={otpCode}
                                onChange={(v) => {
                                  setOtpCode(v);
                                  setOtpError('');
                                }}
                                disabled={otpStatus === 'verifying' || otpStatus === 'verified'}
                              />
                            </View>

                            {otpExpired && otpStatus !== 'verified' ? (
                              <View style={styles.errorBox}>
                                <AlertCircle size={16} color={Colors.red700} />
                                <View style={{ flex: 1, gap: 8 }}>
                                  <Text style={styles.errorBoxText}>Verification Code Expired</Text>
                                  <Text style={styles.errorBoxText}>Your verification code has expired.</Text>
                                  <Button size="lg" onPress={handleResendOtp}>
                                    <Text style={navStyles.btnText}>Send New Code</Text>
                                  </Button>
                                </View>
                              </View>
                            ) : null}

                            {otpError && !otpExpired ? (
                              <View style={styles.errorBox}>
                                <AlertCircle size={16} color={Colors.red700} />
                                <Text style={styles.errorBoxText}>{otpError}</Text>
                              </View>
                            ) : null}

                            {otpStatus === 'verified' ? (
                              <View style={styles.successBox}>
                                <CheckCircle2 size={16} color={Colors.green600} />
                                <View style={{ flex: 1 }}>
                                  <Text style={[styles.successBoxDesc, { fontWeight: '700' }]}>
                                    Email Verified Successfully
                                  </Text>
                                  <Text style={styles.successBoxDesc}>Your identity has been verified.</Text>
                                </View>
                              </View>
                            ) : null}

                            <View style={styles.otpFooterRow}>
                              <Text style={styles.otpResendText}>
                                {otpStatus === 'verified'
                                  ? 'Verification complete'
                                  : otpResendSecondsLeft > 0
                                    ? `Resend available in ${otpResendSecondsLeft}s`
                                    : 'You can resend the code now'}
                              </Text>
                              <Pressable
                                disabled={otpResendSecondsLeft > 0 || otpStatus === 'verified'}
                                onPress={handleResendOtp}
                              >
                                <Text
                                  style={[
                                    styles.otpResendLink,
                                    (otpResendSecondsLeft > 0 || otpStatus === 'verified') && styles.otpResendLinkDisabled,
                                  ]}
                                >
                                  Resend OTP
                                </Text>
                              </Pressable>
                            </View>

                            <Button
                              size="lg"
                              onPress={handleVerifyOtp}
                              disabled={otpCode.length !== 6 || otpStatus === 'verifying' || otpStatus === 'verified' || otpExpired}
                              style={[
                                navStyles.continueFull,
                                (otpCode.length !== 6 || otpStatus === 'verified' || otpExpired) && navStyles.btnDisabled,
                              ]}
                            >
                              {otpStatus === 'verifying' ? (
                                <ActivityIndicator color={Colors.white} />
                              ) : (
                                <Lock size={16} color={Colors.white} />
                              )}
                              <Text style={navStyles.btnText}>{otpStatus === 'verifying' ? 'Verifying code...' : 'Verify OTP'}</Text>
                            </Button>
                          </>
                        )}

                        <View style={styles.otpDivider}>
                          <View style={styles.otpDividerLine} />
                          <Text style={styles.otpDividerText}>or</Text>
                          <View style={styles.otpDividerLine} />
                        </View>

                        <Button
                          variant="outline"
                          size="lg"
                          onPress={handleBackToFaceFromOtp}
                          disabled={otpStatus === 'verified' || faceResetPending}
                        >
                          <RefreshCw size={16} color={Colors.gray700} />
                          <Text style={navStyles.backText}>Retry Face Verification</Text>
                        </Button>
                      </View>
                    )}

                    <NavButtons onBack={() => setCurrentStep(2)} onContinue={() => setCurrentStep(4)} continueDisabled={!identityVerified} />
                  </View>
                )}

                {currentStep === 4 && (
                  <View style={styles.stepBody}>
                    <Text style={styles.bodyText}>
                      Select the role you are registering for. Your selection will be verified against your PRC ID.
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
                        { label: 'PRC ID Uploaded', done: idUploaded },
                        { label: 'OCR Information Extracted', done: ocrDone },
                        {
                          label: verificationMethod === 'EMAIL_OTP' ? 'Email OTP Verified' : 'Face Verification Passed',
                          done: identityVerified,
                        },
                        { label: 'Role Selected', done: roleSelected },
                        { label: 'License Number Captured', done: Boolean(ocrData.registrationNumber) },
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
                      <Button variant="outline" onPress={() => setCurrentStep(4)} size="lg" style={navStyles.backBtn}>
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
  cameraZoneDisabled: {
    opacity: 0.7,
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
  liveCameraWrap: { gap: 12 },
  liveCameraInner: {
    position: 'relative',
    borderRadius: Radius.lg,
    overflow: 'hidden',
    backgroundColor: Colors.gray900,
  },
  liveCamera: {
    width: '100%',
    height: 280,
  },
  liveCameraFrame: {
    position: 'absolute',
    top: 50,
    left: '50%',
    marginLeft: -70,
    width: 140,
    height: 180,
    borderRadius: 28,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.65)',
  },
  liveCameraHint: { fontSize: 13, color: Colors.gray600, textAlign: 'center', lineHeight: 18 },
  faceSuccessCard: {
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.green200,
    backgroundColor: Colors.green50,
    borderRadius: Radius.lg,
    paddingVertical: 28,
    paddingHorizontal: 16,
  },
  faceSuccessTitle: { fontSize: 17, fontWeight: '700', color: Colors.green700 },
  faceSuccessDesc: { fontSize: 13, color: Colors.green700 },
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
  registeredEmailHint: { fontSize: 12, color: Colors.gray500, lineHeight: 17, marginTop: -4 },
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
