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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  FileText,
  Lock,
  Mail,
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
  const [selfieUri, setSelfieUri] = useState<string | null>(null);
  const [faceStatus, setFaceStatus] = useState<ProcessStatus>('idle');
  const [prcStatus, setPrcStatus] = useState<ProcessStatus>('idle');
  const [prcData, setPrcData] = useState<{ profession: string; expiration: string } | null>(null);
  const [ocrData, setOcrData] = useState(defaultOcrData);
  const [ocrStatus, setOcrStatus] = useState<ProcessStatus>('idle');

  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }).start();
  }, [fadeAnim]);

  const completedThrough: WizardStep = (() => {
    if (roleVerified) return 7;
    if (prcVerified) return 6;
    if (roleSelected) return 5;
    if (faceVerificationCompleted) return 4;
    if (idReviewCompleted) return 3;
    if (hospitalIdCompleted) return 2;
    return 1;
  })();

  const simulateOcr = () => {
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
      setHospitalIdCompleted(true);
    }, 900);
  };

  const handleIdImage = (uri: string) => {
    setHospitalIdUri(uri);
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
    });
    if (!result.canceled) handleIdImage(result.assets[0].uri);
  };

  const handleScanId = async () => {
    setError('');
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError('Camera access is required to scan the hospital ID.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.9, allowsEditing: true });
    if (!result.canceled) handleIdImage(result.assets[0].uri);
  };

  const handleFaceVerification = async () => {
    setError('');
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError('Camera access is required for face verification.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.9,
      allowsEditing: false,
      cameraType: ImagePicker.CameraType.front,
    });
    if (result.canceled) {
      setFaceStatus('failed');
      return;
    }
    setSelfieUri(result.assets[0].uri);
    setFaceStatus('processing');
    setTimeout(() => {
      setFaceStatus('success');
      setFaceVerificationCompleted(true);
    }, 900);
  };

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
    if (!roleVerified || !prcVerified || !faceVerificationCompleted || !hospitalIdCompleted || !roleSelected) {
      setError('Please complete all verification steps before creating your account.');
      return;
    }
    try {
      await signup({
        id: '',
        name: ocrData.fullName,
        firstName: ocrData.fullName.split(' ')[0] ?? '',
        middleName: ocrData.fullName.split(' ').slice(1, -1).join(' ') ?? '',
        lastName: ocrData.fullName.split(' ').slice(-1).join(' ') ?? '',
        role: role as UserRole,
        email,
        password,
        department: ocrData.department,
        licenseNumber: licenseNumber.trim(),
      });
    } catch (err) {
      console.error(err);
    } finally {
      // Keep the user on the pending-approval screen; do not leave them logged in.
      logout();
      router.replace('/pending-approval');
    }
  };

  const roleMatch = getRoleMatch(ocrData.position, role);
  const idUploaded = !!hospitalIdUri && hospitalIdCompleted;
  const ocrDone = ocrStatus === 'success';
  const faceDone = faceStatus === 'success';
  const credsDone = email.trim() !== '' && password.length >= 8 && password === confirmPassword;
  const canSubmit =
    roleVerified && prcVerified && faceDone && ocrDone && idUploaded && roleSelected && credsDone;

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
                    <View style={styles.warningBox}>
                      <AlertTriangle size={18} color={Colors.orange600} />
                      <Text style={styles.warningText}>
                        This step is <Text style={styles.warningBold}>required</Text>. To verify your identity, you must capture a live selfie using your device&apos;s camera. Uploading images from your gallery is not permitted.
                      </Text>
                    </View>

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

                    {selfieUri && faceStatus !== 'processing' && (
                      <Button variant="outline" size="lg" onPress={() => { setSelfieUri(null); setFaceStatus('idle'); setFaceVerificationCompleted(false); }}>
                        <Text style={navStyles.backText}>Retake Photo</Text>
                      </Button>
                    )}

                    <NavButtons onBack={() => setCurrentStep(2)} onContinue={() => setCurrentStep(4)} continueDisabled={faceStatus !== 'success'} />
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
                        { label: 'Face Verification Passed', done: faceDone },
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
  selfieOverlayText: { color: Colors.white, fontSize: 14 },
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
