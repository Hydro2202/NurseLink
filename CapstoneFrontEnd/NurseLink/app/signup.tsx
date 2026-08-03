import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ActivityIndicator,
  Modal,
  useWindowDimensions,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import {
  Lock,
  Mail,
  AlertCircle,
  Shield,
  UserPlus,
  CheckCircle,
  Camera,
  Upload,
  FileText,
  CreditCard,
  Eye,
  EyeOff,
  XCircle,
  ShieldCheck,
  BadgeCheck,
  AlertTriangle,
  ChevronRight,
  ChevronLeft,
  X,
  RefreshCw,
  ScanLine,
  Users,
  Clock,
  Video,
} from 'lucide-react-native';
import { useAuth } from '../contexts/AuthContext';
import type { UserRole } from '../types/user';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Colors, Shadows, Radius } from '../constants/colors';

const NURSE_POSITIONS = ['nurse', 'registered nurse', 'staff nurse'];
const SUPERVISOR_POSITIONS = ['supervisor', 'head nurse', 'nursing supervisor', 'charge nurse'];

const STEP_LABELS = [
  'Hospital ID',
  'ID Review',
  'Face Check',
  'Role',
  'PRC License',
  'Role Check',
  'Credentials',
];

type VerifStatus = 'idle' | 'processing' | 'success' | 'error';
type SelectedRole = 'nurse' | 'supervisor' | null;
type RoleMatch = 'idle' | 'matched' | 'mismatch';

interface OcrData {
  fullName: string;
  employeeId: string;
  hospitalName: string;
  department: string;
  position: string;
}

function GreenBadge({ label }: { label: string }) {
  return (
    <View style={styles.greenBadge}>
      <CheckCircle size={14} color={Colors.green700} />
      <Text style={styles.greenBadgeText}>{label}</Text>
    </View>
  );
}

function RedBadge({ label }: { label: string }) {
  return (
    <View style={styles.redBadge}>
      <XCircle size={14} color={Colors.red700} />
      <Text style={styles.redBadgeText}>{label}</Text>
    </View>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <View style={styles.errorBox}>
      <AlertTriangle size={16} color={Colors.red600} style={{ marginTop: 2 }} />
      <Text style={styles.errorBoxText}>{message}</Text>
    </View>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.readOnlyField}>
      <Text style={styles.readOnlyLabel}>{label}</Text>
      <View style={styles.readOnlyValue}>
        <Text style={styles.readOnlyValueText}>{value}</Text>
      </View>
    </View>
  );
}

function StepIndicator({ current, compact }: { current: number; compact?: boolean }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.stepIndicator}
    >
      {STEP_LABELS.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;
        return (
          <View key={n} style={styles.stepItemRow}>
            <View style={styles.stepItem}>
              <View
                style={[
                  styles.stepCircle,
                  done && styles.stepCircleDone,
                  active && styles.stepCircleActive,
                  !done && !active && styles.stepCircleIdle,
                ]}
              >
                {done ? (
                  <CheckCircle size={14} color={Colors.white} />
                ) : (
                  <Text
                    style={[
                      styles.stepNumber,
                      (done || active) && styles.stepNumberActive,
                    ]}
                  >
                    {n}
                  </Text>
                )}
              </View>
              <Text
                style={[
                  styles.stepLabel,
                  compact && styles.stepLabelCompact,
                  active && styles.stepLabelActive,
                  done && styles.stepLabelDone,
                ]}
                numberOfLines={1}
              >
                {label}
              </Text>
            </View>
            {i < STEP_LABELS.length - 1 ? (
              <View style={[styles.stepConnector, done && styles.stepConnectorDone]} />
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

function ProgressPanel({
  idUploaded,
  ocrDone,
  faceDone,
  roleSelected,
  prcDone,
  roleMatched,
  credsDone,
}: {
  idUploaded: boolean;
  ocrDone: boolean;
  faceDone: boolean;
  roleSelected: boolean;
  prcDone: boolean;
  roleMatched: boolean;
  credsDone: boolean;
}) {
  const steps = [
    { done: idUploaded, label: 'Hospital ID Uploaded' },
    { done: ocrDone, label: 'OCR Information Extracted' },
    { done: faceDone, label: 'Face Verification Passed' },
    { done: roleSelected, label: 'Role Selected' },
    { done: prcDone, label: 'PRC License Verified' },
    { done: roleMatched, label: 'Role Verified & Matched' },
    { done: credsDone, label: 'Account Information Completed' },
  ];
  const allDone = steps.every((s) => s.done);

  return (
    <View style={[styles.progressPanel, allDone ? styles.progressPanelDone : styles.progressPanelActive]}>
      <View style={styles.progressHeader}>
        <View style={styles.progressTitleRow}>
          <ShieldCheck size={16} color={allDone ? Colors.green600 : Colors.blue600} />
          <Text style={styles.progressTitle}>Identity Verification</Text>
        </View>
        {allDone ? (
          <View style={styles.completeBadge}>
            <CheckCircle size={14} color={Colors.white} />
            <Text style={styles.completeBadgeText}>Complete</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.progressList}>
        {steps.map(({ done, label }) => (
          <View key={label} style={styles.progressRow}>
            <View style={[styles.progressDot, done ? styles.progressDotDone : styles.progressDotIdle]}>
              {done ? (
                <CheckCircle size={12} color={Colors.white} />
              ) : (
                <View style={styles.progressDotInner} />
              )}
            </View>
            <Text style={[styles.progressLabel, done && styles.progressLabelDone]}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function RoleCard({
  value,
  selected,
  emoji,
  title,
  description,
  onSelect,
}: {
  value: SelectedRole;
  selected: SelectedRole;
  emoji: string;
  title: string;
  description: string;
  onSelect: (v: SelectedRole) => void;
}) {
  const isSelected = selected === value;
  return (
    <Pressable
      onPress={() => onSelect(value)}
      style={[styles.roleCard, isSelected && styles.roleCardSelected]}
    >
      <View style={[styles.radioOuter, isSelected && styles.radioOuterSelected]}>
        {isSelected ? <View style={styles.radioInner} /> : null}
      </View>
      <View style={styles.roleCardBody}>
        <Text style={styles.roleEmoji}>{emoji}</Text>
        <View style={styles.roleTextWrap}>
          <Text style={[styles.roleTitle, isSelected && styles.roleTitleSelected]}>{title}</Text>
          <Text style={styles.roleDesc}>{description}</Text>
        </View>
      </View>
    </Pressable>
  );
}

export default function SignUpPage() {
  const router = useRouter();
  const { signup } = useAuth();
  const { width } = useWindowDimensions();
  const isWide = width >= 640;

  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [globalError, setGlobalError] = useState('');

  const [hospitalIdPreview, setHospitalIdPreview] = useState<string | null>(null);
  const [hospitalIdIsPdf, setHospitalIdIsPdf] = useState(false);
  const [hospitalIdError, setHospitalIdError] = useState('');
  const [ocrStatus, setOcrStatus] = useState<VerifStatus>('idle');
  const [ocrData, setOcrData] = useState<OcrData | null>(null);

  const [selfiePreview, setSelfiePreview] = useState<string | null>(null);
  const [faceStatus, setFaceStatus] = useState<VerifStatus>('idle');
  const [faceError, setFaceError] = useState('');
  const [cameraRequesting, setCameraRequesting] = useState(false);

  const [selectedRole, setSelectedRole] = useState<SelectedRole>(null);
  const [roleSelectError, setRoleSelectError] = useState('');

  const [licenseNumber, setLicenseNumber] = useState('');
  const [prcStatus, setPrcStatus] = useState<VerifStatus>('idle');
  const [prcData, setPrcData] = useState<{ profession: string; expiration: string } | null>(null);
  const [prcError, setPrcError] = useState('');

  const [roleMatch, setRoleMatch] = useState<RoleMatch>('idle');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [credErrors, setCredErrors] = useState<Record<string, string>>({});

  const idUploaded = !!hospitalIdPreview && !hospitalIdError;
  const ocrDone = ocrStatus === 'success';
  const faceDone = faceStatus === 'success';
  const roleSelected = !!selectedRole;
  const prcDone = prcStatus === 'success';
  const roleMatched = roleMatch === 'matched';
  const validateEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  const credsDone = !!(
    email &&
    validateEmail(email) &&
    password.length >= 8 &&
    password === confirmPassword
  );
  const allDone =
    idUploaded && ocrDone && faceDone && roleSelected && prcDone && roleMatched && credsDone;

  const simulateOcr = useCallback(() => {
    setOcrStatus('processing');
    setTimeout(() => {
      setOcrData({
        fullName: 'Maria Santos Dela Cruz',
        employeeId: `EMP-${Math.floor(10000 + Math.random() * 90000)}`,
        hospitalName: "St. Luke's Medical Center",
        department: 'Intensive Care Unit',
        position: 'Registered Nurse',
      });
      setOcrStatus('success');
    }, 2400);
  }, []);

  const applyHospitalIdAsset = useCallback(
    (uri: string, mimeType?: string | null, size?: number | null) => {
      setHospitalIdError('');
      setOcrStatus('idle');
      setOcrData(null);
      setRoleMatch('idle');

      const type = (mimeType || '').toLowerCase();
      const isPdf = type.includes('pdf') || uri.toLowerCase().endsWith('.pdf');
      const isImage =
        type.includes('jpeg') ||
        type.includes('jpg') ||
        type.includes('png') ||
        /\.(jpe?g|png)$/i.test(uri);

      if (!isPdf && !isImage && type) {
        setHospitalIdError('Unsupported file format. Please upload a JPG, PNG, or PDF.');
        return;
      }
      if (size && size > 5 * 1024 * 1024) {
        setHospitalIdError('File too large. Maximum size is 5 MB.');
        return;
      }

      setHospitalIdIsPdf(isPdf);
      setHospitalIdPreview(uri);
      simulateOcr();
    },
    [simulateOcr]
  );

  const clearId = () => {
    setHospitalIdPreview(null);
    setHospitalIdIsPdf(false);
    setHospitalIdError('');
    setOcrStatus('idle');
    setOcrData(null);
    setRoleMatch('idle');
  };

  const pickHospitalIdFromCamera = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setHospitalIdError('Camera access was denied. Please allow camera access and try again.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.85,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      applyHospitalIdAsset(asset.uri, asset.mimeType, asset.fileSize);
    }
  };

  const pickHospitalIdFromLibrary = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setHospitalIdError('Photo library access was denied. Please allow access and try again.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      applyHospitalIdAsset(asset.uri, asset.mimeType, asset.fileSize);
    }
  };

  const pickHospitalIdDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/jpeg', 'image/png', 'application/pdf'],
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        applyHospitalIdAsset(asset.uri, asset.mimeType, asset.size);
      }
    } catch {
      setHospitalIdError('Could not open the file picker. Please try again.');
    }
  };

  const captureSelfie = async () => {
    setFaceError('');
    setCameraRequesting(true);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setFaceError(
          'Camera access was denied. Please allow camera access in your device settings and try again.'
        );
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        cameraType: ImagePicker.CameraType.front,
        quality: 0.9,
        allowsEditing: true,
        aspect: [3, 4],
      });
      if (result.canceled || !result.assets[0]) return;

      setSelfiePreview(result.assets[0].uri);
      setFaceStatus('processing');
      setTimeout(() => setFaceStatus('success'), 2600);
    } catch {
      setFaceError('Could not access camera. Please check your device and try again.');
    } finally {
      setCameraRequesting(false);
    }
  };

  const retakeSelfie = () => {
    setSelfiePreview(null);
    setFaceStatus('idle');
    setFaceError('');
  };

  const handlePrcVerify = () => {
    if (!licenseNumber.trim()) {
      setPrcError('Please enter your PRC License Number.');
      return;
    }
    setPrcError('');
    setPrcStatus('processing');
    setTimeout(() => {
      if (licenseNumber.trim().length >= 5) {
        setPrcData({ profession: 'Registered Nurse', expiration: '2026-06-30' });
        setPrcStatus('success');
      } else {
        setPrcStatus('error');
        setPrcError('License Not Found — the number entered does not match any active PRC record.');
      }
    }, 2000);
  };

  const computeRoleMatch = useCallback((role: SelectedRole, ocr: OcrData | null) => {
    if (!role || !ocr) {
      setRoleMatch('mismatch');
      return;
    }
    const pos = ocr.position.toLowerCase();
    const matchesNurse = NURSE_POSITIONS.some((r) => pos.includes(r));
    const matchesSupervisor = SUPERVISOR_POSITIONS.some((r) => pos.includes(r));

    if (role === 'nurse' && matchesNurse) setRoleMatch('matched');
    else if (role === 'supervisor' && matchesSupervisor) setRoleMatch('matched');
    else setRoleMatch('mismatch');
  }, []);

  useEffect(() => {
    if (step === 6) {
      computeRoleMatch(selectedRole, ocrData);
    }
  }, [step, selectedRole, ocrData, computeRoleMatch]);

  const goNext = () => {
    if (step === 4) {
      if (!selectedRole) {
        setRoleSelectError('Please select your role before continuing.');
        return;
      }
      setRoleSelectError('');
    }
    if (step === 5 && prcDone) {
      computeRoleMatch(selectedRole, ocrData);
    }
    setStep((s) => Math.min(s + 1, 7));
  };

  const goBack = () => setStep((s) => Math.max(s - 1, 1));

  const validateCreds = () => {
    const errs: Record<string, string> = {};
    if (!email) errs.email = 'Email is required';
    else if (!validateEmail(email)) errs.email = 'Please enter a valid email address';
    if (!password) errs.password = 'Password is required';
    else if (password.length < 8) errs.password = 'Password must be at least 8 characters';
    if (!confirmPassword) errs.confirmPassword = 'Please confirm your password';
    else if (password !== confirmPassword) errs.confirmPassword = 'Passwords do not match';
    setCredErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleCreateAccount = async () => {
    if (!validateCreds()) return;
    if (!allDone) {
      Alert.alert('Incomplete', 'Complete all verification steps to continue.');
      return;
    }

    setIsSubmitting(true);
    setGlobalError('');
    try {
      const fullName = ocrData?.fullName ?? '';
      const parts = fullName.split(' ').filter(Boolean);
      const mappedRole: UserRole =
        selectedRole === 'supervisor' ? 'supervisor' : 'staff_nurse';

      const result = await signup({
        name: fullName,
        firstName: parts[0] ?? '',
        middleName: parts.length > 2 ? parts.slice(1, -1).join(' ') : '',
        lastName: parts.length > 1 ? parts[parts.length - 1] : '',
        email,
        password,
        role: mappedRole,
        department: ocrData?.department ?? '',
        licenseNumber,
        employeeId: ocrData?.employeeId ?? '',
        hospitalName: ocrData?.hospitalName ?? '',
        ocrPosition: ocrData?.position ?? '',
        registrationDetails: {
          licenseNumber,
          selectedRole: selectedRole ?? '',
          ocrPosition: ocrData?.position ?? '',
          hospitalName: ocrData?.hospitalName ?? '',
          department: ocrData?.department ?? '',
          employeeId: ocrData?.employeeId ?? '',
        },
      });

      if (result.ok) {
        setSuccess(true);
      } else {
        setGlobalError(result.message || 'Registration failed. Please try again.');
      }
    } catch {
      setGlobalError('An unexpected error occurred. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const stepMeta = useMemo(
    () => [
      {
        icon: <CreditCard size={20} color={Colors.white} />,
        title: 'Hospital Identity Verification',
        desc: 'Upload or scan your official Hospital ID to begin.',
      },
      {
        icon: <FileText size={20} color={Colors.white} />,
        title: 'Extracted ID Information',
        desc: 'Review your extracted information. These fields are read-only.',
      },
      {
        icon: <Camera size={20} color={Colors.white} />,
        title: 'Mandatory Face Verification',
        desc: 'Capture a live selfie to confirm your identity.',
      },
      {
        icon: <Users size={20} color={Colors.white} />,
        title: 'Role Selection',
        desc: 'Select the role you are registering for. It must match your verified employment information.',
      },
      {
        icon: <Shield size={20} color={Colors.white} />,
        title: 'PRC License Verification',
        desc: 'Enter and verify your PRC Professional License number.',
      },
      {
        icon: <BadgeCheck size={20} color={Colors.white} />,
        title: 'Role Verification',
        desc: 'Confirming your selected role matches your Hospital ID and PRC records.',
      },
      {
        icon: <Lock size={20} color={Colors.white} />,
        title: 'Account Credentials',
        desc: 'Set your login credentials to complete registration.',
      },
    ],
    []
  );

  const meta = stepMeta[step - 1];

  if (success) {
    return (
      <SafeAreaView style={styles.successSafe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.successScroll} showsVerticalScrollIndicator={false}>
          <Image
            source={require('../assets/images/NurseLinkLogo.png')}
            style={styles.successLogo}
            resizeMode="contain"
            accessibilityLabel="NurseLink"
          />

          <View style={styles.successCard}>
            <LinearGradient colors={[Colors.amber500, Colors.orange500]} style={styles.successBanner}>
              <View style={styles.successIconRing}>
                <View style={styles.successIconInner}>
                  <ShieldCheck size={40} color={Colors.white} />
                  <View style={styles.clockBadge}>
                    <Clock size={12} color={Colors.white} />
                  </View>
                </View>
              </View>
              <Text style={styles.successBannerTitle}>Registration Submitted</Text>
              <Text style={styles.successBannerDesc}>
                Your registration has been received and is awaiting administrator verification.
              </Text>
            </LinearGradient>

            <View style={styles.successBody}>
              <View style={styles.pendingStatusBadge}>
                <Clock size={16} color={Colors.amber800} />
                <Text style={styles.pendingStatusText}>Status: Pending Administrator Approval</Text>
              </View>

              {[
                { label: 'Identity Verification Completed', done: true },
                { label: 'Hospital ID Successfully Verified', done: true },
                { label: 'Face Verification Completed', done: true },
                { label: 'Registration Information Submitted', done: true },
                { label: 'PRC License Verification Pending', done: false },
                { label: 'Account Approval Pending', done: false },
              ].map(({ label, done }) => (
                <View
                  key={label}
                  style={[styles.statusRow, done ? styles.statusRowDone : styles.statusRowPending]}
                >
                  <View style={[styles.statusIcon, done ? styles.statusIconDone : styles.statusIconPending]}>
                    {done ? (
                      <CheckCircle size={14} color={Colors.white} />
                    ) : (
                      <Clock size={12} color={Colors.white} />
                    )}
                  </View>
                  <Text style={[styles.statusLabel, !done && styles.statusLabelPending]}>{label}</Text>
                  {!done ? (
                    <View style={styles.pendingPill}>
                      <Text style={styles.pendingPillText}>Pending</Text>
                    </View>
                  ) : null}
                </View>
              ))}

              <View style={styles.infoCard}>
                <View style={styles.infoTitleRow}>
                  <ShieldCheck size={16} color={Colors.blue600} />
                  <Text style={styles.infoTitle}>Your account is currently under review.</Text>
                </View>
                <Text style={styles.infoText}>
                  An administrator will verify your PRC License Number and confirm your employment
                  details before activating your account.
                </Text>
                <Text style={styles.infoText}>
                  You will receive a notification once your account has been approved or rejected.
                </Text>
                <View style={styles.infoFooter}>
                  <Clock size={14} color={Colors.blue500} />
                  <Text style={styles.infoFooterText}>
                    Estimated verification time: Within 24–48 hours
                  </Text>
                </View>
              </View>

              <Button
                onPress={() => router.replace('/login')}
                size="lg"
                style={styles.primaryBtn}
              >
                <View style={styles.btnInner}>
                  <ChevronLeft size={16} color={Colors.white} />
                  <Text style={styles.primaryBtnText}>Return to Login</Text>
                </View>
              </Button>

              <Button
                variant="outline"
                onPress={() => router.replace('/login')}
                size="lg"
                style={styles.outlineAmberBtn}
                textStyle={styles.outlineAmberText}
              >
                <View style={styles.btnInner}>
                  <Eye size={16} color={Colors.amber700} />
                  <Text style={styles.outlineAmberText}>View Registration Status</Text>
                </View>
              </Button>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.inner, isWide && styles.innerWide]}>
            <View style={styles.header}>
              <Image
                source={require('../assets/images/NurseLinkLogo.png')}
                style={styles.logo}
                resizeMode="contain"
                accessibilityLabel="NurseLink Logo"
              />
              <Text style={styles.subtitle}>Secure healthcare professional registration</Text>
            </View>

            <StepIndicator current={step} compact={!isWide} />

            <View style={styles.card}>
              <LinearGradient colors={[Colors.blue600, Colors.blue700]} style={styles.cardHeader}>
                <View style={styles.cardHeaderIcon}>{meta.icon}</View>
                <View style={styles.cardHeaderText}>
                  <Text style={styles.cardHeaderTitle}>
                    Step {step} of 7 — {meta.title}
                  </Text>
                  <Text style={styles.cardHeaderDesc}>{meta.desc}</Text>
                </View>
              </LinearGradient>

              <View style={styles.cardBody}>
                {/* Step 1 */}
                {step === 1 && (
                  <View style={styles.section}>
                    <Pressable
                      onPress={!hospitalIdPreview ? pickHospitalIdFromLibrary : undefined}
                      style={[
                        styles.uploadZone,
                        hospitalIdPreview
                          ? styles.uploadZoneSuccess
                          : hospitalIdError
                            ? styles.uploadZoneError
                            : styles.uploadZoneIdle,
                      ]}
                    >
                      {hospitalIdPreview ? (
                        <View style={styles.uploadPreviewWrap}>
                          {hospitalIdIsPdf ? (
                            <View style={styles.pdfPreview}>
                              <FileText size={48} color={Colors.green600} />
                              <Text style={styles.pdfPreviewText}>PDF Uploaded</Text>
                            </View>
                          ) : (
                            <Image
                              source={{ uri: hospitalIdPreview }}
                              style={styles.idPreview}
                              resizeMode="contain"
                            />
                          )}
                          <Pressable onPress={clearId} style={styles.clearIdBtn} hitSlop={8}>
                            <X size={14} color={Colors.gray500} />
                          </Pressable>
                        </View>
                      ) : (
                        <View style={styles.uploadEmpty}>
                          <View style={styles.uploadIconWrap}>
                            <CreditCard size={32} color={Colors.blue600} />
                          </View>
                          <Text style={styles.uploadTitle}>
                            Tap to upload your Hospital ID
                          </Text>
                          <Text style={styles.uploadHint}>
                            Accepted formats: JPG, PNG, PDF · Max 5 MB
                          </Text>
                        </View>
                      )}
                    </Pressable>

                    <View style={styles.rowGap}>
                      <Pressable style={[styles.secondaryAction, styles.flex1]} onPress={pickHospitalIdFromCamera}>
                        <Camera size={16} color={Colors.blue700} />
                        <Text style={styles.secondaryActionBlue}>Camera Scan</Text>
                      </Pressable>
                      <Pressable style={[styles.secondaryActionGray, styles.flex1]} onPress={pickHospitalIdDocument}>
                        <Upload size={16} color={Colors.gray700} />
                        <Text style={styles.secondaryActionGrayText}>Upload File</Text>
                      </Pressable>
                    </View>

                    {hospitalIdError ? <ErrorBox message={hospitalIdError} /> : null}

                    {ocrStatus === 'processing' ? (
                      <View style={styles.infoBlueBox}>
                        <View style={styles.scanSpinnerWrap}>
                          <ActivityIndicator size="large" color={Colors.blue600} />
                          <ScanLine size={16} color={Colors.blue800} style={styles.scanOverlay} />
                        </View>
                        <View style={styles.flex1}>
                          <Text style={styles.infoBlueTitle}>Scanning Hospital ID...</Text>
                          <Text style={styles.infoBlueSub}>Extracting employee information via OCR</Text>
                        </View>
                      </View>
                    ) : null}

                    {ocrStatus === 'success' ? (
                      <View style={styles.infoGreenBox}>
                        <CheckCircle size={24} color={Colors.green600} />
                        <View style={styles.flex1}>
                          <Text style={styles.infoGreenTitle}>Hospital ID scanned successfully</Text>
                          <Text style={styles.infoGreenSub}>
                            Employee information extracted. Proceed to review.
                          </Text>
                        </View>
                      </View>
                    ) : null}

                    <Button
                      onPress={goNext}
                      disabled={!ocrDone}
                      size="lg"
                      style={[styles.primaryBtn, !ocrDone && styles.disabledBtn]}
                    >
                      <View style={styles.btnInner}>
                        <Text style={[styles.primaryBtnText, !ocrDone && styles.disabledBtnText]}>
                          Continue
                        </Text>
                        <ChevronRight size={16} color={ocrDone ? Colors.white : Colors.gray500} />
                      </View>
                    </Button>
                  </View>
                )}

                {/* Step 2 */}
                {step === 2 && ocrData ? (
                  <View style={styles.section}>
                    <View style={styles.reviewHeader}>
                      <Text style={styles.mutedText}>Automatically extracted from your Hospital ID.</Text>
                      <GreenBadge label="Information Successfully Extracted" />
                    </View>

                    <View style={styles.infoGreenBox}>
                      <ShieldCheck size={16} color={Colors.green600} style={{ marginTop: 2 }} />
                      <Text style={styles.infoGreenSub}>
                        These details were read directly from your scanned Hospital ID and cannot be
                        edited. If information appears incorrect, go back and re-upload a clearer image.
                      </Text>
                    </View>

                    <View style={[styles.fieldGrid, isWide && styles.fieldGridWide]}>
                      <View style={[styles.fieldCol, isWide && styles.fieldColHalf]}>
                        <ReadOnlyField label="Full Name" value={ocrData.fullName} />
                      </View>
                      <View style={[styles.fieldCol, isWide && styles.fieldColHalf]}>
                        <ReadOnlyField label="Employee ID" value={ocrData.employeeId} />
                      </View>
                      <View style={[styles.fieldCol, isWide && styles.fieldColHalf]}>
                        <ReadOnlyField label="Hospital Name" value={ocrData.hospitalName} />
                      </View>
                      <View style={[styles.fieldCol, isWide && styles.fieldColHalf]}>
                        <ReadOnlyField label="Department" value={ocrData.department} />
                      </View>
                      <View style={styles.fieldCol}>
                        <ReadOnlyField label="Position" value={ocrData.position} />
                      </View>
                    </View>

                    <View style={styles.navRow}>
                      <Button variant="outline" onPress={goBack} size="lg" style={styles.flex1}>
                        <View style={styles.btnInner}>
                          <ChevronLeft size={16} color={Colors.foreground} />
                          <Text style={styles.outlineBtnText}>Back</Text>
                        </View>
                      </Button>
                      <Button onPress={goNext} size="lg" style={[styles.primaryBtn, styles.flex1]}>
                        <View style={styles.btnInner}>
                          <Text style={styles.primaryBtnText}>Continue</Text>
                          <ChevronRight size={16} color={Colors.white} />
                        </View>
                      </Button>
                    </View>
                  </View>
                ) : null}

                {/* Step 3 */}
                {step === 3 && (
                  <View style={styles.section}>
                    <View style={styles.amberBox}>
                      <AlertTriangle size={16} color={Colors.amber600} style={{ marginTop: 2 }} />
                      <Text style={styles.amberText}>
                        This step is required. To verify your identity, you must capture a live selfie
                        using your device&apos;s camera. Uploading images from your gallery is not
                        permitted.
                      </Text>
                    </View>

                    {selfiePreview ? (
                      <View style={styles.section}>
                        <View style={styles.selfieFrame}>
                          <Image source={{ uri: selfiePreview }} style={styles.selfieImage} />
                          {faceStatus === 'processing' ? (
                            <View style={styles.selfieOverlay}>
                              <ActivityIndicator size="large" color={Colors.blue300} />
                              <Text style={styles.selfieOverlayTitle}>Analyzing face…</Text>
                              <Text style={styles.selfieOverlaySub}>Comparing with Hospital ID photo</Text>
                            </View>
                          ) : null}
                          {faceStatus === 'success' ? (
                            <View style={[styles.selfieOverlay, styles.selfieOverlaySuccess]}>
                              <View style={styles.successCircle}>
                                <CheckCircle size={48} color={Colors.green600} />
                              </View>
                            </View>
                          ) : null}
                          {faceStatus === 'error' ? (
                            <View style={[styles.selfieOverlay, styles.selfieOverlayError]}>
                              <View style={styles.successCircle}>
                                <XCircle size={48} color={Colors.red600} />
                              </View>
                            </View>
                          ) : null}
                        </View>

                        {faceStatus === 'success' ? (
                          <View style={styles.infoGreenBoxCol}>
                            <View style={styles.rowCenter}>
                              <CheckCircle size={16} color={Colors.green600} />
                              <Text style={styles.infoGreenTitle}>Face Match Successful</Text>
                            </View>
                            <Text style={styles.faceMeta}>Match Confidence: 98%</Text>
                            <Text style={styles.faceMeta}>Identity Confirmed</Text>
                          </View>
                        ) : null}

                        {faceStatus === 'error' ? (
                          <View style={styles.infoRedBoxCol}>
                            <View style={styles.rowCenter}>
                              <XCircle size={16} color={Colors.red600} />
                              <Text style={styles.infoRedTitle}>Face Verification Failed</Text>
                            </View>
                            <Text style={styles.infoRedText}>
                              The captured selfie does not match the Hospital ID. Registration cannot
                              continue.
                            </Text>
                          </View>
                        ) : null}

                        {faceError ? <ErrorBox message={faceError} /> : null}

                        {faceStatus !== 'processing' ? (
                          <Pressable style={styles.secondaryActionGray} onPress={retakeSelfie}>
                            <RefreshCw size={16} color={Colors.gray600} />
                            <Text style={styles.secondaryActionGrayText}>Retake Photo</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    ) : (
                      <View style={styles.section}>
                        {cameraRequesting ? (
                          <View style={styles.cameraIdleBox}>
                            <ActivityIndicator size="large" color={Colors.blue500} />
                            <Text style={styles.infoBlueTitle}>Requesting camera access…</Text>
                          </View>
                        ) : (
                          <Pressable style={styles.cameraIdleBox} onPress={captureSelfie}>
                            <View style={styles.videoIconWrap}>
                              <Video size={32} color={Colors.blue600} />
                            </View>
                            <Text style={styles.infoBlueTitle}>Open Camera</Text>
                            <Text style={styles.uploadHint}>
                              Live selfie only — gallery uploads are not allowed
                            </Text>
                          </Pressable>
                        )}
                        {faceError ? <ErrorBox message={faceError} /> : null}
                      </View>
                    )}

                    <View style={styles.navRow}>
                      <Button variant="outline" onPress={goBack} size="lg" style={styles.flex1}>
                        <View style={styles.btnInner}>
                          <ChevronLeft size={16} color={Colors.foreground} />
                          <Text style={styles.outlineBtnText}>Back</Text>
                        </View>
                      </Button>
                      <Button
                        onPress={goNext}
                        disabled={!faceDone}
                        size="lg"
                        style={[styles.primaryBtn, styles.flex1, !faceDone && styles.disabledBtn]}
                      >
                        <View style={styles.btnInner}>
                          <Text style={[styles.primaryBtnText, !faceDone && styles.disabledBtnText]}>
                            Continue
                          </Text>
                          <ChevronRight size={16} color={faceDone ? Colors.white : Colors.gray500} />
                        </View>
                      </Button>
                    </View>
                  </View>
                )}

                {/* Step 4 */}
                {step === 4 && (
                  <View style={styles.section}>
                    <Text style={styles.bodyText}>
                      Select the role you are registering for. Your selection will be verified against
                      your Hospital ID and PRC license. Registration will only continue if the selected
                      role matches your verified employment information.
                    </Text>

                    <RoleCard
                      value="nurse"
                      selected={selectedRole}
                      emoji="👩‍⚕️"
                      title="Nurse"
                      description="Staff Nurse or Registered Nurse responsible for direct patient care and clinical documentation."
                      onSelect={(v) => {
                        setSelectedRole(v);
                        setRoleSelectError('');
                      }}
                    />
                    <RoleCard
                      value="supervisor"
                      selected={selectedRole}
                      emoji="👨‍⚕️"
                      title="Supervisor"
                      description="Head Nurse, Nursing Supervisor, or Charge Nurse overseeing nursing staff and patient care operations."
                      onSelect={(v) => {
                        setSelectedRole(v);
                        setRoleSelectError('');
                      }}
                    />

                    {roleSelectError ? <ErrorBox message={roleSelectError} /> : null}

                    {selectedRole ? (
                      <View style={styles.infoBlueBox}>
                        <CheckCircle size={16} color={Colors.blue600} />
                        <Text style={styles.infoBlueSub}>
                          Selected:{' '}
                          <Text style={styles.bold}>
                            {selectedRole === 'nurse' ? '👩‍⚕️ Nurse' : '👨‍⚕️ Supervisor'}
                          </Text>{' '}
                          — This will be verified against your Hospital ID and PRC records.
                        </Text>
                      </View>
                    ) : null}

                    <View style={styles.navRow}>
                      <Button variant="outline" onPress={goBack} size="lg" style={styles.flex1}>
                        <View style={styles.btnInner}>
                          <ChevronLeft size={16} color={Colors.foreground} />
                          <Text style={styles.outlineBtnText}>Back</Text>
                        </View>
                      </Button>
                      <Button onPress={goNext} size="lg" style={[styles.primaryBtn, styles.flex1]}>
                        <View style={styles.btnInner}>
                          <Text style={styles.primaryBtnText}>Continue</Text>
                          <ChevronRight size={16} color={Colors.white} />
                        </View>
                      </Button>
                    </View>
                  </View>
                )}

                {/* Step 5 */}
                {step === 5 && (
                  <View style={styles.section}>
                    <View style={styles.labelRow}>
                      <Shield size={16} color={Colors.gray500} />
                      <Text style={styles.fieldLabel}>
                        PRC License Number <Text style={styles.required}>*</Text>
                      </Text>
                    </View>
                    <View style={styles.prcRow}>
                      <View style={styles.flex1}>
                        <Input
                          placeholder="e.g., 1234567"
                          value={licenseNumber}
                          onChangeText={(v) => {
                            setLicenseNumber(v);
                            setPrcStatus('idle');
                            setPrcData(null);
                            setPrcError('');
                          }}
                          editable={prcStatus !== 'success'}
                          autoCapitalize="none"
                        />
                      </View>
                      <Pressable
                        onPress={handlePrcVerify}
                        disabled={prcStatus === 'processing' || prcStatus === 'success'}
                        style={[
                          styles.verifyBtn,
                          prcStatus === 'success' && styles.verifyBtnSuccess,
                          prcStatus === 'processing' && styles.verifyBtnProcessing,
                        ]}
                      >
                        {prcStatus === 'processing' ? (
                          <>
                            <ActivityIndicator size="small" color={Colors.blue500} />
                            <Text style={styles.verifyBtnProcessingText}>Verifying…</Text>
                          </>
                        ) : prcStatus === 'success' ? (
                          <>
                            <CheckCircle size={16} color={Colors.green700} />
                            <Text style={styles.verifyBtnSuccessText}>Verified</Text>
                          </>
                        ) : (
                          <>
                            <ShieldCheck size={16} color={Colors.white} />
                            <Text style={styles.verifyBtnText}>Verify</Text>
                          </>
                        )}
                      </Pressable>
                    </View>

                    {prcStatus === 'processing' ? (
                      <View style={styles.infoBlueBox}>
                        <ActivityIndicator color={Colors.blue600} />
                        <Text style={styles.infoBlueTitle}>Checking PRC database…</Text>
                      </View>
                    ) : null}

                    {prcStatus === 'success' && prcData ? (
                      <View style={styles.infoGreenBoxCol}>
                        <View style={styles.rowCenter}>
                          <CheckCircle size={16} color={Colors.green600} />
                          <Text style={styles.infoGreenTitle}>Active PRC License</Text>
                        </View>
                        <View style={[styles.prcMetaGrid, isWide && styles.prcMetaGridWide]}>
                          <View style={styles.flex1}>
                            <Text style={styles.readOnlyLabel}>License Status</Text>
                            <Text style={styles.readOnlyValueText}>Active</Text>
                          </View>
                          <View style={styles.flex1}>
                            <Text style={styles.readOnlyLabel}>Profession</Text>
                            <Text style={styles.readOnlyValueText}>{prcData.profession}</Text>
                          </View>
                          <View style={styles.flex1}>
                            <Text style={styles.readOnlyLabel}>Expiration Date</Text>
                            <Text style={styles.readOnlyValueText}>{prcData.expiration}</Text>
                          </View>
                        </View>
                      </View>
                    ) : null}

                    {prcError || prcStatus === 'error' ? (
                      <ErrorBox message={prcError || 'PRC verification failed.'} />
                    ) : null}

                    <View style={styles.navRow}>
                      <Button variant="outline" onPress={goBack} size="lg" style={styles.flex1}>
                        <View style={styles.btnInner}>
                          <ChevronLeft size={16} color={Colors.foreground} />
                          <Text style={styles.outlineBtnText}>Back</Text>
                        </View>
                      </Button>
                      <Button
                        onPress={goNext}
                        disabled={!prcDone}
                        size="lg"
                        style={[styles.primaryBtn, styles.flex1, !prcDone && styles.disabledBtn]}
                      >
                        <View style={styles.btnInner}>
                          <Text style={[styles.primaryBtnText, !prcDone && styles.disabledBtnText]}>
                            Continue
                          </Text>
                          <ChevronRight size={16} color={prcDone ? Colors.white : Colors.gray500} />
                        </View>
                      </Button>
                    </View>
                  </View>
                )}

                {/* Step 6 */}
                {step === 6 && ocrData ? (
                  <View style={styles.section}>
                    <View style={styles.summaryGrid}>
                      <View style={styles.summaryCard}>
                        <Text style={styles.readOnlyLabel}>Selected Role</Text>
                        <Text style={styles.readOnlyValueText}>
                          {selectedRole === 'nurse' ? '👩‍⚕️ Nurse' : '👨‍⚕️ Supervisor'}
                        </Text>
                      </View>
                      <View style={styles.summaryCard}>
                        <Text style={styles.readOnlyLabel}>OCR Detected Position</Text>
                        <Text style={styles.readOnlyValueText}>{ocrData.position}</Text>
                      </View>
                    </View>

                    {roleMatch === 'matched' ? (
                      <View style={styles.matchBox}>
                        <View style={styles.matchHeader}>
                          <View style={styles.rowCenter}>
                            <BadgeCheck size={20} color={Colors.green600} />
                            <Text style={styles.matchTitle}>Role Verified</Text>
                          </View>
                          <GreenBadge label="Role Match" />
                        </View>
                        <View style={styles.matchInner}>
                          <View style={styles.rowCenter}>
                            <CheckCircle size={16} color={Colors.green600} />
                            <Text style={styles.bodyText}>
                              Selected:{' '}
                              <Text style={styles.bold}>
                                {selectedRole === 'nurse' ? 'Nurse' : 'Supervisor'}
                              </Text>
                            </Text>
                          </View>
                          <View style={styles.rowCenter}>
                            <CheckCircle size={16} color={Colors.green600} />
                            <Text style={styles.bodyText}>
                              OCR Detected: <Text style={styles.bold}>{ocrData.position}</Text>
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.matchSuccessText}>
                          ✔ You are authorized to register as a{' '}
                          <Text style={styles.bold}>
                            {selectedRole === 'nurse' ? 'Nurse' : 'Supervisor'}
                          </Text>
                          .
                        </Text>
                      </View>
                    ) : null}

                    {roleMatch === 'mismatch' ? (
                      <View style={styles.mismatchBox}>
                        <View style={styles.matchHeader}>
                          <View style={styles.rowCenter}>
                            <XCircle size={20} color={Colors.red600} />
                            <Text style={styles.mismatchTitle}>Role Mismatch</Text>
                          </View>
                          <RedBadge label="Mismatch Detected" />
                        </View>
                        <View style={styles.mismatchInner}>
                          <View style={styles.rowCenter}>
                            <XCircle size={16} color={Colors.red600} />
                            <Text style={styles.bodyText}>
                              Selected:{' '}
                              <Text style={styles.bold}>
                                {selectedRole === 'nurse' ? 'Nurse' : 'Supervisor'}
                              </Text>
                            </Text>
                          </View>
                          <View style={styles.rowCenter}>
                            <AlertTriangle size={16} color={Colors.amber500} />
                            <Text style={styles.bodyText}>
                              OCR Detected: <Text style={styles.bold}>{ocrData.position}</Text>
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.mismatchText}>
                          ❌ The selected role does not match your verified employment information.
                          Registration cannot continue.
                        </Text>
                        <Pressable style={styles.changeRoleBtn} onPress={() => setStep(4)}>
                          <ChevronLeft size={16} color={Colors.red700} />
                          <Text style={styles.changeRoleText}>Go back and change role selection</Text>
                        </Pressable>
                      </View>
                    ) : null}

                    <View style={styles.navRow}>
                      <Button variant="outline" onPress={goBack} size="lg" style={styles.flex1}>
                        <View style={styles.btnInner}>
                          <ChevronLeft size={16} color={Colors.foreground} />
                          <Text style={styles.outlineBtnText}>Back</Text>
                        </View>
                      </Button>
                      <Button
                        onPress={goNext}
                        disabled={!roleMatched}
                        size="lg"
                        style={[styles.primaryBtn, styles.flex1, !roleMatched && styles.disabledBtn]}
                      >
                        <View style={styles.btnInner}>
                          <Text style={[styles.primaryBtnText, !roleMatched && styles.disabledBtnText]}>
                            Continue
                          </Text>
                          <ChevronRight
                            size={16}
                            color={roleMatched ? Colors.white : Colors.gray500}
                          />
                        </View>
                      </Button>
                    </View>
                  </View>
                ) : null}

                {/* Step 7 */}
                {step === 7 && (
                  <View style={styles.section}>
                    {globalError ? <ErrorBox message={globalError} /> : null}

                    <View style={styles.infoBlueBox}>
                      <ShieldCheck size={16} color={Colors.blue600} style={{ marginTop: 2 }} />
                      <Text style={styles.infoBlueSub}>
                        All identity verifications have passed. Set your login credentials below to
                        complete registration.
                      </Text>
                    </View>

                    <View>
                      <View style={styles.labelRow}>
                        <Mail size={16} color={Colors.gray500} />
                        <Text style={styles.fieldLabel}>
                          Email Address <Text style={styles.required}>*</Text>
                        </Text>
                      </View>
                      <Input
                        placeholder="your.email@hospital.com"
                        value={email}
                        onChangeText={setEmail}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                        error={credErrors.email}
                      />
                    </View>

                    <View style={[styles.passwordGrid, isWide && styles.passwordGridWide]}>
                      <View style={[styles.flex1, !isWide && styles.fullWidth]}>
                        <View style={styles.labelRow}>
                          <Lock size={16} color={Colors.gray500} />
                          <Text style={styles.fieldLabel}>
                            Password <Text style={styles.required}>*</Text>
                          </Text>
                        </View>
                        <Input
                          placeholder="At least 8 characters"
                          value={password}
                          onChangeText={setPassword}
                          secureTextEntry={!showPassword}
                          autoCapitalize="none"
                          error={credErrors.password}
                          rightIcon={
                            <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={8}>
                              {showPassword ? (
                                <EyeOff size={18} color={Colors.gray500} />
                              ) : (
                                <Eye size={18} color={Colors.gray500} />
                              )}
                            </Pressable>
                          }
                        />
                      </View>
                      <View style={[styles.flex1, !isWide && styles.fullWidth]}>
                        <View style={styles.labelRow}>
                          <Lock size={16} color={Colors.gray500} />
                          <Text style={styles.fieldLabel}>
                            Confirm Password <Text style={styles.required}>*</Text>
                          </Text>
                        </View>
                        <Input
                          placeholder="Re-enter password"
                          value={confirmPassword}
                          onChangeText={setConfirmPassword}
                          secureTextEntry={!showConfirmPassword}
                          autoCapitalize="none"
                          error={credErrors.confirmPassword}
                          rightIcon={
                            <Pressable
                              onPress={() => setShowConfirmPassword((v) => !v)}
                              hitSlop={8}
                            >
                              {showConfirmPassword ? (
                                <EyeOff size={18} color={Colors.gray500} />
                              ) : (
                                <Eye size={18} color={Colors.gray500} />
                              )}
                            </Pressable>
                          }
                        />
                      </View>
                    </View>

                    <ProgressPanel
                      idUploaded={idUploaded}
                      ocrDone={ocrDone}
                      faceDone={faceDone}
                      roleSelected={roleSelected}
                      prcDone={prcDone}
                      roleMatched={roleMatched}
                      credsDone={credsDone}
                    />

                    <View style={styles.navRow}>
                      <Button variant="outline" onPress={goBack} size="lg" style={styles.backOnly}>
                        <View style={styles.btnInner}>
                          <ChevronLeft size={16} color={Colors.foreground} />
                          <Text style={styles.outlineBtnText}>Back</Text>
                        </View>
                      </Button>
                      <Button
                        onPress={handleCreateAccount}
                        disabled={!allDone || isSubmitting}
                        loading={isSubmitting}
                        size="lg"
                        style={[
                          styles.primaryBtn,
                          styles.flex1,
                          (!allDone || isSubmitting) && styles.disabledBtn,
                        ]}
                      >
                        <View style={styles.btnInner}>
                          <UserPlus size={20} color={allDone ? Colors.white : Colors.gray500} />
                          <Text
                            style={[
                              styles.primaryBtnText,
                              (!allDone || isSubmitting) && styles.disabledBtnText,
                            ]}
                          >
                            Create Account
                          </Text>
                        </View>
                      </Button>
                    </View>
                    {!allDone ? (
                      <Text style={styles.tooltipHint}>
                        Complete all verification steps to continue.
                      </Text>
                    ) : null}
                  </View>
                )}
              </View>
            </View>

            <View style={styles.footer}>
              <Text style={styles.footerText}>
                Already have an account?{' '}
                <Link href="/login" style={styles.link}>
                  Log In
                </Link>
              </Text>
              <Text style={styles.terms}>
                By creating an account, you agree to our Terms of Service and Privacy Policy
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={isSubmitting} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalIcon}>
              <ActivityIndicator size="large" color={Colors.blue600} />
            </View>
            <Text style={styles.modalTitle}>Creating your account...</Text>
            <Text style={styles.modalSub}>Please wait while we verify your information.</Text>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.blue50 },
  successSafe: { flex: 1, backgroundColor: Colors.amber50 },
  flex: { flex: 1 },
  flex1: { flex: 1 },
  fullWidth: { width: '100%' },
  scroll: {
    flexGrow: 1,
    padding: 16,
    paddingVertical: 24,
  },
  successScroll: {
    flexGrow: 1,
    padding: 16,
    paddingVertical: 24,
    alignItems: 'center',
  },
  inner: {
    width: '100%',
    maxWidth: 672,
    alignSelf: 'center',
  },
  innerWide: {
    maxWidth: 672,
  },
  header: {
    alignItems: 'center',
    marginBottom: 20,
  },
  logo: {
    width: 224,
    height: 100,
    marginBottom: 4,
  },
  successLogo: {
    width: 192,
    height: 88,
    marginBottom: 20,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.gray500,
    textAlign: 'center',
  },

  stepIndicator: {
    alignItems: 'center',
    paddingBottom: 8,
    paddingHorizontal: 4,
    marginBottom: 16,
    gap: 0,
  },
  stepItemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  stepItem: {
    alignItems: 'center',
    width: 64,
  },
  stepCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepCircleDone: {
    backgroundColor: Colors.green600,
  },
  stepCircleActive: {
    backgroundColor: Colors.blue600,
    ...Shadows.md,
  },
  stepCircleIdle: {
    backgroundColor: Colors.gray200,
  },
  stepNumber: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.gray500,
  },
  stepNumberActive: {
    color: Colors.white,
  },
  stepLabel: {
    marginTop: 4,
    fontSize: 10,
    fontWeight: '500',
    color: Colors.gray500,
    textAlign: 'center',
  },
  stepLabelCompact: {
    fontSize: 9,
  },
  stepLabelActive: {
    color: Colors.blue600,
  },
  stepLabelDone: {
    color: Colors.green600,
  },
  stepConnector: {
    width: 16,
    height: 2,
    backgroundColor: Colors.gray200,
    marginTop: 13,
    borderRadius: 1,
  },
  stepConnectorDone: {
    backgroundColor: Colors.green600,
  },

  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius['2xl'],
    borderWidth: 2,
    borderColor: Colors.gray200,
    overflow: 'hidden',
    ...Shadows.xl,
  },
  cardHeader: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardHeaderIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.lg,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardHeaderText: { flex: 1 },
  cardHeaderTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.white,
  },
  cardHeaderDesc: {
    fontSize: 12,
    color: Colors.blue100,
    marginTop: 2,
  },
  cardBody: {
    padding: 20,
  },
  section: {
    gap: 16,
  },
  navRow: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 8,
  },
  rowGap: {
    flexDirection: 'row',
    gap: 8,
  },
  rowCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.gray700,
  },
  required: { color: Colors.red600 },
  mutedText: {
    fontSize: 14,
    color: Colors.gray500,
    flex: 1,
  },
  bodyText: {
    fontSize: 14,
    color: Colors.gray600,
    lineHeight: 20,
  },
  bold: { fontWeight: '700' },

  uploadZone: {
    minHeight: 160,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  uploadZoneIdle: {
    borderColor: Colors.blue200,
    backgroundColor: Colors.blue50,
  },
  uploadZoneSuccess: {
    borderColor: Colors.green200,
    backgroundColor: Colors.green50,
  },
  uploadZoneError: {
    borderColor: Colors.red200,
    backgroundColor: Colors.red50,
  },
  uploadEmpty: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 32,
    paddingHorizontal: 24,
  },
  uploadIconWrap: {
    width: 64,
    height: 64,
    borderRadius: Radius['2xl'],
    backgroundColor: Colors.blue100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.blue700,
    textAlign: 'center',
  },
  uploadHint: {
    fontSize: 12,
    color: Colors.gray500,
    textAlign: 'center',
    marginTop: 4,
  },
  uploadPreviewWrap: {
    width: '100%',
    padding: 12,
    position: 'relative',
  },
  idPreview: {
    width: '100%',
    height: 180,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.green200,
  },
  pdfPreview: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    gap: 8,
  },
  pdfPreviewText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.green700,
  },
  clearIdBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.gray200,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.sm,
  },

  secondaryAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderColor: Colors.blue200,
    backgroundColor: Colors.blue50,
  },
  secondaryActionBlue: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.blue700,
  },
  secondaryActionGray: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderColor: Colors.gray200,
    backgroundColor: Colors.gray50,
  },
  secondaryActionGrayText: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.gray700,
  },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: Radius.lg,
    backgroundColor: Colors.red50,
    borderWidth: 1,
    borderColor: Colors.red200,
  },
  errorBoxText: {
    flex: 1,
    fontSize: 14,
    color: Colors.red700,
  },

  infoBlueBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
    borderRadius: Radius.lg,
    backgroundColor: Colors.blue50,
    borderWidth: 1,
    borderColor: Colors.blue200,
  },
  infoBlueTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.blue800,
  },
  infoBlueSub: {
    flex: 1,
    fontSize: 12,
    color: Colors.blue700,
    lineHeight: 18,
  },
  infoGreenBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
    borderRadius: Radius.lg,
    backgroundColor: Colors.green50,
    borderWidth: 1,
    borderColor: Colors.green200,
  },
  infoGreenBoxCol: {
    gap: 8,
    padding: 16,
    borderRadius: Radius.lg,
    backgroundColor: Colors.green50,
    borderWidth: 1,
    borderColor: Colors.green200,
  },
  infoGreenTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.green700,
  },
  infoGreenSub: {
    flex: 1,
    fontSize: 12,
    color: Colors.green700,
    lineHeight: 18,
  },
  infoRedBoxCol: {
    gap: 8,
    padding: 16,
    borderRadius: Radius.lg,
    backgroundColor: Colors.red50,
    borderWidth: 1,
    borderColor: Colors.red200,
  },
  infoRedTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.red700,
  },
  infoRedText: {
    fontSize: 14,
    color: Colors.red600,
    paddingLeft: 24,
  },
  scanSpinnerWrap: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanOverlay: {
    position: 'absolute',
  },

  greenBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.green100,
    borderWidth: 1,
    borderColor: Colors.green200,
  },
  greenBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.green700,
  },
  redBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.red100,
    borderWidth: 1,
    borderColor: Colors.red200,
  },
  redBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.red700,
  },

  reviewHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    justifyContent: 'space-between',
  },
  readOnlyField: { gap: 4 },
  readOnlyLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.gray500,
  },
  readOnlyValue: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: Radius.md,
    backgroundColor: Colors.gray50,
    borderWidth: 1,
    borderColor: Colors.gray200,
  },
  readOnlyValueText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.gray900,
  },
  fieldGrid: { gap: 12 },
  fieldGridWide: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  fieldCol: { width: '100%' },
  fieldColHalf: { width: '48%' },

  amberBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: Radius.lg,
    backgroundColor: Colors.amber50,
    borderWidth: 1,
    borderColor: Colors.amber200,
  },
  amberText: {
    flex: 1,
    fontSize: 12,
    color: Colors.amber800,
    fontWeight: '500',
    lineHeight: 18,
  },
  cameraIdleBox: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 48,
    paddingHorizontal: 16,
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: Colors.blue200,
    backgroundColor: Colors.blue50,
  },
  videoIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.blue100,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.blue200,
  },
  selfieFrame: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: Colors.blue200,
    backgroundColor: Colors.black,
    minHeight: 280,
  },
  selfieImage: {
    width: '100%',
    height: 280,
  },
  selfieOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  selfieOverlaySuccess: {
    backgroundColor: 'rgba(34,197,94,0.2)',
  },
  selfieOverlayError: {
    backgroundColor: 'rgba(239,68,68,0.2)',
  },
  selfieOverlayTitle: {
    color: Colors.white,
    fontSize: 14,
    fontWeight: '700',
  },
  selfieOverlaySub: {
    color: Colors.blue200,
    fontSize: 12,
  },
  successCircle: {
    backgroundColor: Colors.white,
    borderRadius: 999,
    padding: 16,
    ...Shadows.xl,
  },
  faceMeta: {
    fontSize: 14,
    color: Colors.gray700,
    paddingLeft: 24,
  },

  roleCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
    padding: 16,
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderColor: Colors.gray200,
    backgroundColor: Colors.white,
  },
  roleCardSelected: {
    borderColor: Colors.blue500,
    backgroundColor: Colors.blue50,
    ...Shadows.md,
  },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.gray200,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  radioOuterSelected: {
    borderColor: Colors.blue600,
    backgroundColor: Colors.blue600,
  },
  radioInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.white,
  },
  roleCardBody: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    flex: 1,
  },
  roleEmoji: { fontSize: 24 },
  roleTextWrap: { flex: 1 },
  roleTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.gray900,
  },
  roleTitleSelected: { color: Colors.blue700 },
  roleDesc: {
    fontSize: 12,
    color: Colors.gray500,
    marginTop: 2,
    lineHeight: 18,
  },

  prcRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  verifyBtn: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: Radius.lg,
    backgroundColor: Colors.blue600,
    borderWidth: 2,
    borderColor: Colors.blue300,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  verifyBtnSuccess: {
    backgroundColor: Colors.green50,
    borderColor: Colors.green200,
  },
  verifyBtnProcessing: {
    backgroundColor: Colors.blue50,
    borderColor: Colors.blue200,
  },
  verifyBtnText: {
    color: Colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
  verifyBtnSuccessText: {
    color: Colors.green700,
    fontSize: 14,
    fontWeight: '600',
  },
  verifyBtnProcessingText: {
    color: Colors.blue500,
    fontSize: 14,
    fontWeight: '600',
  },
  prcMetaGrid: { gap: 12, marginTop: 8 },
  prcMetaGridWide: { flexDirection: 'row' },

  summaryGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  summaryCard: {
    flex: 1,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.gray200,
    backgroundColor: Colors.gray50,
    padding: 12,
    gap: 4,
  },
  matchBox: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.green200,
    backgroundColor: Colors.green50,
    padding: 20,
    gap: 12,
  },
  mismatchBox: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.red200,
    backgroundColor: Colors.red50,
    padding: 20,
    gap: 12,
  },
  matchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  matchTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.green700,
  },
  mismatchTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.red700,
  },
  matchInner: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.green200,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  mismatchInner: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.red200,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  matchSuccessText: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.green700,
  },
  mismatchText: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.red700,
  },
  changeRoleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderColor: Colors.red200,
    backgroundColor: Colors.white,
  },
  changeRoleText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.red700,
  },

  passwordGrid: { gap: 16 },
  passwordGridWide: { flexDirection: 'row' },
  progressPanel: {
    borderRadius: Radius['2xl'],
    borderWidth: 1,
    padding: 16,
  },
  progressPanelActive: {
    borderColor: Colors.blue100,
    backgroundColor: Colors.blue50,
  },
  progressPanelDone: {
    borderColor: Colors.green200,
    backgroundColor: Colors.green50,
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  progressTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  progressTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.gray900,
  },
  completeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.green600,
  },
  completeBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.white,
  },
  progressList: { gap: 8 },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  progressDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressDotDone: { backgroundColor: Colors.green600 },
  progressDotIdle: { backgroundColor: Colors.gray200 },
  progressDotInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.gray500,
  },
  progressLabel: {
    fontSize: 12,
    color: Colors.gray500,
  },
  progressLabelDone: {
    color: Colors.green700,
    fontWeight: '500',
  },
  tooltipHint: {
    textAlign: 'center',
    fontSize: 12,
    color: Colors.gray500,
  },

  primaryBtn: {
    backgroundColor: Colors.blue600,
    ...Shadows.md,
  },
  primaryBtnText: {
    color: Colors.white,
    fontSize: 15,
    fontWeight: '600',
  },
  outlineBtnText: {
    color: Colors.foreground,
    fontSize: 15,
    fontWeight: '600',
  },
  disabledBtn: {
    backgroundColor: Colors.gray200,
    shadowOpacity: 0,
    elevation: 0,
  },
  disabledBtnText: {
    color: Colors.gray500,
  },
  btnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  backOnly: {
    paddingHorizontal: 20,
  },
  outlineAmberBtn: {
    borderColor: Colors.amber300,
    borderWidth: 1,
  },
  outlineAmberText: {
    color: Colors.amber700,
    fontSize: 15,
    fontWeight: '600',
  },

  footer: {
    marginTop: 16,
    alignItems: 'center',
    gap: 4,
  },
  footerText: {
    fontSize: 12,
    color: Colors.gray500,
  },
  link: {
    color: Colors.blue600,
    fontWeight: '700',
  },
  terms: {
    fontSize: 12,
    color: Colors.gray500,
    textAlign: 'center',
  },

  successCard: {
    width: '100%',
    maxWidth: 512,
    backgroundColor: Colors.white,
    borderRadius: Radius['2xl'],
    borderWidth: 2,
    borderColor: Colors.amber200,
    overflow: 'hidden',
    ...Shadows.xl,
  },
  successBanner: {
    paddingHorizontal: 24,
    paddingVertical: 40,
    alignItems: 'center',
  },
  successIconRing: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  successIconInner: {
    position: 'relative',
  },
  clockBadge: {
    position: 'absolute',
    bottom: -4,
    right: -8,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.amber400,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.white,
  },
  successBannerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.white,
    marginBottom: 4,
    textAlign: 'center',
  },
  successBannerDesc: {
    fontSize: 14,
    color: Colors.amber100,
    textAlign: 'center',
  },
  successBody: {
    padding: 24,
    gap: 12,
  },
  pendingStatusBadge: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: Radius.full,
    backgroundColor: Colors.amber100,
    borderWidth: 2,
    borderColor: Colors.amber300,
  },
  pendingStatusText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.amber800,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: Radius.lg,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
  },
  statusRowDone: {
    backgroundColor: Colors.green50,
    borderColor: Colors.green100,
  },
  statusRowPending: {
    backgroundColor: Colors.amber50,
    borderColor: Colors.amber200,
  },
  statusIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusIconDone: { backgroundColor: Colors.green600 },
  statusIconPending: { backgroundColor: Colors.amber400 },
  statusLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: Colors.gray900,
  },
  statusLabelPending: { color: Colors.amber800 },
  pendingPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.full,
    backgroundColor: Colors.amber100,
    borderWidth: 1,
    borderColor: Colors.amber300,
  },
  pendingPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.amber600,
  },
  infoCard: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.blue200,
    backgroundColor: Colors.blue50,
    padding: 16,
    gap: 8,
  },
  infoTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: Colors.blue800,
  },
  infoText: {
    fontSize: 12,
    color: Colors.blue700,
    lineHeight: 18,
  },
  infoFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 8,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: Colors.blue200,
  },
  infoFooterText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: Colors.blue700,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: Colors.white,
    borderRadius: Radius['2xl'],
    padding: 32,
    alignItems: 'center',
    gap: 12,
    ...Shadows.xl,
  },
  modalIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.blue100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.gray900,
    textAlign: 'center',
  },
  modalSub: {
    fontSize: 14,
    color: Colors.gray500,
    textAlign: 'center',
  },
});
