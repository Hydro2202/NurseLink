import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  AlertCircle,
  AlertTriangle,
  Camera,
  CheckCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  FileText,
  IdCard,
  Loader2,
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
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent } from '../components/ui/card';
import { Alert, AlertDescription } from '../components/ui/alert';
import { useAuth } from '../contexts/AuthContext';
import nurseLinkLogo from 'figma:asset/3d9b7c179afc2d98d9124ffe39a7807d2ffa64d9.png';

const STEP_LABELS = ['Hospital ID', 'ID Review', 'Face Check', 'Role', 'PRC License', 'Role Check', 'Credentials'];
const NURSE_POSITIONS = ['nurse', 'registered nurse', 'staff nurse'];
const SUPERVISOR_POSITIONS = ['supervisor', 'head nurse', 'nursing supervisor', 'charge nurse'];

type StepNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;
type SelectedRole = 'nurse' | 'supervisor' | null;

type OcrData = {
  fullName: string;
  employeeId: string;
  hospitalName: string;
  department: string;
  position: string;
};

const roleOptions: Array<{ value: SelectedRole; title: string; detail: string; emoji: string }> = [
  {
    value: 'nurse',
    title: 'Nurse',
    emoji: '👩‍⚕️',
    detail: 'Staff Nurse or Registered Nurse responsible for direct patient care and clinical documentation.',
  },
  {
    value: 'supervisor',
    title: 'Supervisor',
    emoji: '👨‍⚕️',
    detail: 'Head Nurse, Nursing Supervisor, or Charge Nurse overseeing nursing staff and patient care operations.',
  },
];

const STEP_ICONS = [IdCard, FileText, Camera, Users, ShieldCheck, CheckCircle2, Lock];

function StepStepper({ current }: { current: StepNumber }) {
  return (
    <div className="w-full overflow-x-auto pb-2">
      <div className="mx-auto flex min-w-[640px] max-w-[900px] items-start justify-between px-2">
        {STEP_LABELS.map((label, index) => {
          const step = (index + 1) as StepNumber;
          const active = step === current;
          const complete = step < current;
          const isLast = index === STEP_LABELS.length - 1;

          return (
            <div key={label} className="flex flex-1 items-start">
              <div className="flex flex-col items-center">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-all duration-300 ${
                    complete
                      ? 'bg-[#16A34A] text-white shadow-md shadow-green-200'
                      : active
                        ? 'scale-110 bg-[#2563EB] text-white shadow-lg shadow-blue-200 ring-4 ring-blue-100'
                        : 'border-2 border-gray-200 bg-white text-gray-400'
                  }`}
                  aria-current={active ? 'step' : undefined}
                >
                  {complete ? <CheckCircle className="h-5 w-5" aria-hidden /> : step}
                </div>
                <span
                  className={`mt-2 max-w-[76px] text-center text-[11px] font-semibold leading-tight transition-colors ${
                    complete ? 'text-[#16A34A]' : active ? 'text-[#2563EB]' : 'text-gray-400'
                  }`}
                >
                  {label}
                </span>
              </div>
              {!isLast && (
                <div
                  className={`mx-1.5 mt-[19px] h-1 flex-1 overflow-hidden rounded-full transition-colors duration-500 ${
                    complete ? 'bg-[#16A34A]' : active ? 'bg-blue-300' : 'bg-gray-200'
                  }`}
                  aria-hidden
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StepCardHeader({
  step,
  title,
  description,
}: {
  step: StepNumber;
  title: string;
  description: string;
}) {
  const Icon = STEP_ICONS[step - 1];
  return (
    <div className="bg-gradient-to-r from-[#2563EB] to-blue-600 px-6 py-5 text-white">
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/20">
          <Icon className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h2 className="text-lg font-bold leading-snug sm:text-xl">
            Step {step} of 7 — {title}
          </h2>
          <p className="mt-1 text-sm text-blue-100">{description}</p>
        </div>
      </div>
    </div>
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
  const primaryClass =
    'h-12 rounded-xl bg-gradient-to-r from-[#2563EB] to-blue-600 text-white shadow-md shadow-blue-200 transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-blue-300 disabled:translate-y-0 disabled:cursor-not-allowed disabled:bg-none disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none';

  if (!showBack) {
    return (
      <Button type="button" onClick={onContinue} disabled={continueDisabled} className={`w-full ${primaryClass}`}>
        {continueLabel} <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
      </Button>
    );
  }

  return (
    <div className="flex gap-3">
      <Button
        type="button"
        variant="outline"
        onClick={onBack}
        className="h-12 flex-1 rounded-xl border-gray-200 bg-white text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
      >
        <ChevronLeft className="mr-1 h-4 w-4" aria-hidden /> Back
      </Button>
      <Button type="button" onClick={onContinue} disabled={continueDisabled} className={`flex-[1.5] ${primaryClass}`}>
        {continueLabel} <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
      </Button>
    </div>
  );
}

function RegistrationSubmitted({ onLogin }: { onLogin: () => void }) {
  const completedSteps = [
    'Identity Verification Completed',
    'Hospital ID Successfully Verified',
    'Face Verification Completed',
    'Registration Information Submitted',
  ];
  const pendingSteps = ['PRC License Verification Pending', 'Account Approval Pending'];

  return (
    <Card className="overflow-hidden rounded-2xl border border-amber-200/80 bg-white shadow-xl shadow-amber-100/40">
      <div className="bg-gradient-to-br from-amber-500 via-orange-500 to-amber-600 px-6 py-10 text-center text-white">
        <div className="relative mx-auto mb-5 flex h-20 w-20 items-center justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/20 ring-4 ring-white/25 backdrop-blur-sm">
            <ShieldCheck className="h-9 w-9" aria-hidden />
          </div>
          <div className="absolute -bottom-0.5 -right-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-amber-200 shadow-md ring-2 ring-white/40">
            <Clock className="h-4 w-4 text-amber-800" aria-hidden />
          </div>
        </div>
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Registration Submitted</h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-amber-50 sm:text-base">
          Your registration has been received and is awaiting administrator verification.
        </p>
      </div>

      <CardContent className="space-y-5 p-6 sm:p-8">
        <div className="flex justify-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-5 py-2.5 text-sm font-semibold text-amber-800 shadow-sm">
            <Clock className="h-4 w-4 text-amber-600" aria-hidden />
            Status: Pending Administrator Approval
          </span>
        </div>

        <ul className="space-y-2.5" aria-label="Verification progress">
          {completedSteps.map((label) => (
            <li
              key={label}
              className="flex items-center gap-3 rounded-full border border-green-200 bg-green-50 px-4 py-3.5"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#16A34A] text-white shadow-sm">
                <CheckCircle className="h-4 w-4" aria-hidden />
              </span>
              <span className="text-sm font-semibold text-green-800">{label}</span>
            </li>
          ))}
          {pendingSteps.map((label) => (
            <li
              key={label}
              className="flex items-center justify-between gap-3 rounded-full border border-amber-200 bg-amber-50 px-4 py-3.5"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#F59E0B] text-white shadow-sm">
                  <Clock className="h-4 w-4" aria-hidden />
                </span>
                <span className="truncate text-sm font-semibold text-amber-900">{label}</span>
              </div>
              <span className="shrink-0 rounded-full bg-amber-200/80 px-3 py-1 text-xs font-bold text-amber-800">
                Pending
              </span>
            </li>
          ))}
        </ul>

        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm text-blue-800">
          <div className="flex items-start gap-2.5 font-bold text-blue-900">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#2563EB]" aria-hidden />
            Your account is currently under review.
          </div>
          <p className="mt-3 leading-relaxed text-blue-700">
            An administrator will verify your PRC License Number and confirm your employment details before
            activating your account. You will receive a notification once your account has been{' '}
            <strong className="text-blue-900">approved</strong> or{' '}
            <strong className="text-blue-900">rejected</strong>.
          </p>
          <div className="mt-4 flex items-center gap-2 border-t border-blue-200 pt-3.5 text-blue-800">
            <Clock className="h-4 w-4 shrink-0 text-[#2563EB]" aria-hidden />
            <span>
              Estimated verification time: <strong className="text-blue-900">Within 24–48 hours</strong>
            </span>
          </div>
        </div>

        <div className="space-y-3 pt-1">
          <Button
            type="button"
            onClick={onLogin}
            className="h-12 w-full rounded-xl bg-gradient-to-r from-[#2563EB] to-blue-600 text-white shadow-md shadow-blue-200 transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-blue-300"
          >
            <ChevronLeft className="mr-1 h-4 w-4" aria-hidden /> Return to Login
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onLogin}
            className="h-12 w-full rounded-xl border-2 border-amber-300 bg-white text-amber-800 transition hover:border-amber-400 hover:bg-amber-50"
          >
            <Eye className="mr-2 h-4 w-4" aria-hidden /> View Registration Status
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SignUpPage() {
  const navigate = useNavigate();
  const { signup, logout } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<StepNumber>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [globalError, setGlobalError] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const [hospitalIdPreview, setHospitalIdPreview] = useState<string | null>(null);
  const [hospitalIdError, setHospitalIdError] = useState('');
  const [ocrStatus, setOcrStatus] = useState<'idle' | 'processing' | 'success'>('idle');
  const [ocrData, setOcrData] = useState<OcrData | null>(null);

  const [cameraState, setCameraState] = useState<'idle' | 'requesting' | 'active' | 'denied' | 'not-supported'>('idle');
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [selfiePreview, setSelfiePreview] = useState<string | null>(null);
  const [faceStatus, setFaceStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle');
  const [faceError, setFaceError] = useState('');

  const [selectedRole, setSelectedRole] = useState<SelectedRole>(null);
  const [roleMatch, setRoleMatch] = useState<'idle' | 'matched' | 'mismatch'>('idle');
  const [roleSelectError, setRoleSelectError] = useState('');

  const [licenseNumber, setLicenseNumber] = useState('');
  const [prcStatus, setPrcStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle');
  const [prcData, setPrcData] = useState<{ profession: string; expiration: string } | null>(null);
  const [prcError, setPrcError] = useState('');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [credErrors, setCredErrors] = useState<Record<string, string>>({});

  const stepTitles = [
    'Hospital Identity Verification',
    'Extracted ID Information',
    'Mandatory Face Verification',
    'Role Selection',
    'PRC License Verification',
    'Role Verification',
    'Account Credentials',
  ];

  const stepDescriptions = [
    'Upload or scan your official Hospital ID to begin.',
    'Review your extracted information. These fields are read-only.',
    'Capture a live selfie to confirm your identity.',
    'Select the role you are registering for. It must match your verified employment information.',
    'Enter and verify your PRC Professional License number.',
    'Confirming your selected role matches your Hospital ID and PRC records.',
    'Set your login credentials to complete registration.',
  ];

  const acceptedFormats = ['image/jpeg', 'image/png', 'application/pdf'];

  const clearMedia = useCallback(() => {
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      setMediaStream(null);
    }
    setCameraState('idle');
  }, [mediaStream]);

  useEffect(() => {
    return () => {
      clearMedia();
    };
  }, [clearMedia]);

  useEffect(() => {
    if (step !== 3) {
      clearMedia();
    }
  }, [step, clearMedia]);

  const simulateOcr = useCallback(() => {
    setOcrStatus('processing');
    window.setTimeout(() => {
      setOcrData({
        fullName: 'Maria Santos Dela Cruz',
        employeeId: `EMP-${Math.floor(10000 + Math.random() * 90000)}`,
        hospitalName: "St. Luke's Medical Center",
        department: 'Intensive Care Unit',
        position: 'Registered Nurse',
      });
      setOcrStatus('success');
    }, 1600);
  }, []);

  const handleHospitalFile = (file: File) => {
    setHospitalIdError('');
    setOcrStatus('idle');
    setOcrData(null);
    setRoleMatch('idle');

    if (!acceptedFormats.includes(file.type)) {
      setHospitalIdError('Unsupported file format. Please upload JPG, PNG, or PDF.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setHospitalIdError('File too large. Maximum size is 5 MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      setHospitalIdPreview(event.target?.result as string);
      simulateOcr();
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) handleHospitalFile(file);
  };

  const openCamera = async () => {
    setFaceError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState('not-supported');
      return;
    }

    setCameraState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      });
      setMediaStream(stream);
      setCameraState('active');
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (error) {
      const message = error instanceof DOMException ? error.name : 'Camera access failed.';
      if (message === 'NotAllowedError' || message === 'PermissionDeniedError') {
        setCameraState('denied');
        setFaceError('Camera access denied. Please allow camera permission and try again.');
      } else {
        setCameraState('idle');
        setFaceError('Unable to access the camera. Please try again or use a different device.');
      }
    }
  };

  const captureSelfie = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL('image/jpeg', 0.9);
    setSelfiePreview(image);
    clearMedia();
    setFaceStatus('processing');
    window.setTimeout(() => setFaceStatus('success'), 1500);
  };

  const handlePrcVerify = useCallback(() => {
    if (!licenseNumber.trim()) {
      setPrcError('Please enter your PRC License Number.');
      return;
    }
    setPrcError('');
    setPrcStatus('processing');
    window.setTimeout(() => {
      if (licenseNumber.trim().length >= 5) {
        setPrcData({ profession: 'Registered Nurse', expiration: '2026-06-30' });
        setPrcStatus('success');
      } else {
        setPrcStatus('error');
        setPrcError('License number not found in active PRC records.');
      }
    }, 1400);
  }, [licenseNumber]);

  useEffect(() => {
    if (step === 5 && licenseNumber.trim().length >= 5 && prcStatus === 'idle') {
      const timer = window.setTimeout(handlePrcVerify, 600);
      return () => window.clearTimeout(timer);
    }
  }, [licenseNumber, step, prcStatus, handlePrcVerify]);

  const computeRoleMatch = useCallback(() => {
    if (!selectedRole || !ocrData) {
      setRoleMatch('mismatch');
      return;
    }
    const position = ocrData.position.toLowerCase();
    const matchesNurse = NURSE_POSITIONS.some((entry) => position.includes(entry));
    const matchesSupervisor = SUPERVISOR_POSITIONS.some((entry) => position.includes(entry));
    if (selectedRole === 'nurse' && matchesNurse) setRoleMatch('matched');
    else if (selectedRole === 'supervisor' && matchesSupervisor) setRoleMatch('matched');
    else setRoleMatch('mismatch');
  }, [ocrData, selectedRole]);

  useEffect(() => {
    if (step === 6) {
      computeRoleMatch();
    }
  }, [step, computeRoleMatch]);

  const validateCredentials = () => {
    const errors: Record<string, string> = {};
    if (!email.trim()) errors.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Enter a valid email address';
    if (!password) errors.password = 'Password is required';
    else if (password.length < 8) errors.password = 'Password must be at least 8 characters';
    if (!confirmPassword) errors.confirmPassword = 'Please confirm your password';
    else if (password !== confirmPassword) errors.confirmPassword = 'Passwords do not match';
    setCredErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreateAccount = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validateCredentials()) return;

    setIsSubmitting(true);
    setGlobalError('');

    try {
      const fullName = ocrData?.fullName ?? `${email.split('@')[0]}`;
      const ok = await signup({
        name: fullName,
        firstName: ocrData?.fullName.split(' ')[0] ?? '',
        middleName: ocrData?.fullName.split(' ').slice(1, -1).join(' ') ?? '',
        lastName: ocrData?.fullName.split(' ').slice(-1).join(' ') ?? '',
        email,
        password,
        role: selectedRole === 'supervisor' ? 'supervisor' : 'staff_nurse',
        department: ocrData?.department ?? '',
        licenseNumber,
        createdAt: new Date().toISOString(),
      });
      if (ok) {
        // Keep the user on the pending-approval screen; do not leave them logged in.
        logout();
        setSubmitted(true);
      } else {
        setGlobalError('Unable to create account. Please try again.');
      }
    } catch {
      setGlobalError('An unexpected error occurred. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const idUploaded = !!hospitalIdPreview && !hospitalIdError;
  const ocrDone = ocrStatus === 'success';
  const faceDone = faceStatus === 'success';
  const roleSelected = !!selectedRole;
  const prcDone = prcStatus === 'success';
  const roleVerified = roleMatch === 'matched';
  const credsDone = email.trim() !== '' && password.length >= 8 && password === confirmPassword;
  const canSubmitCredentials = roleVerified && prcDone && faceDone && ocrDone && idUploaded && roleSelected;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <img src={nurseLinkLogo} alt="NurseLink" className="h-24 w-auto object-contain" />
          {!submitted && (
            <p className="text-sm text-gray-500">Secure healthcare professional registration</p>
          )}
        </div>

        {submitted ? (
          <RegistrationSubmitted onLogin={() => navigate('/login')} />
        ) : (
          <>
            <StepStepper current={step} />

            <Card className="overflow-hidden rounded-2xl border border-gray-200 shadow-lg shadow-gray-200/60">
              <StepCardHeader step={step} title={stepTitles[step - 1]} description={stepDescriptions[step - 1]} />
              <CardContent className="space-y-5 p-6 sm:p-8">
                {step === 1 && (
                  <div className="space-y-5">
                    <div
                      role="button"
                      tabIndex={0}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOver(true);
                      }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={handleDrop}
                      onClick={() => !hospitalIdPreview && fileInputRef.current?.click()}
                      onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
                      className={`rounded-2xl border-2 border-dashed px-4 py-8 text-center transition ${
                        hospitalIdPreview && ocrStatus === 'success'
                          ? 'border-green-300 bg-green-50/30'
                          : dragOver
                            ? 'border-blue-400 bg-blue-100'
                            : 'border-blue-200 bg-blue-50/50 hover:border-blue-300 hover:bg-blue-50'
                      }`}
                    >
                      {hospitalIdPreview ? (
                        <div className="relative mx-auto max-w-lg">
                          {hospitalIdPreview.startsWith('data:image') ? (
                            <img
                              src={hospitalIdPreview}
                              alt="Hospital ID"
                              className="mx-auto max-h-52 w-full rounded-xl object-contain"
                            />
                          ) : (
                            <div className="mx-auto flex h-48 w-full items-center justify-center rounded-xl bg-white text-blue-700 shadow-sm">
                              <FileText className="h-16 w-16" />
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setHospitalIdPreview(null);
                              setOcrStatus('idle');
                              setOcrData(null);
                              setHospitalIdError('');
                            }}
                            className="absolute -right-2 -top-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-slate-600 shadow-md hover:bg-slate-100"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-4">
                          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-100 text-blue-600">
                            <IdCard className="h-8 w-8" />
                          </div>
                          <p className="text-sm font-semibold text-blue-700">
                            Drag & drop or click to upload your Hospital ID
                          </p>
                          <p className="text-xs text-slate-500">Accepted formats: JPG, PNG, PDF · Max 5 MB</p>
                        </div>
                      )}
                    </div>

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,application/pdf"
                      className="sr-only"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) handleHospitalFile(file);
                      }}
                    />
                    <input
                      ref={cameraInputRef}
                      type="file"
                      accept="image/jpeg,image/png"
                      capture="environment"
                      className="sr-only"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) handleHospitalFile(file);
                      }}
                    />

                    <div className="grid gap-3 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => cameraInputRef.current?.click()}
                        className="flex h-12 items-center justify-center gap-2 rounded-full border-2 border-blue-200 bg-white text-sm font-semibold text-blue-700 transition hover:border-blue-300 hover:bg-blue-50"
                      >
                        <Camera className="h-5 w-5" /> Camera Scan
                      </button>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex h-12 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                      >
                        <Upload className="h-5 w-5" /> Upload File
                      </button>
                    </div>

                    {hospitalIdError && (
                      <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        {hospitalIdError}
                      </div>
                    )}

                    {ocrStatus === 'processing' && (
                      <div className="flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Scanning Hospital ID and extracting data...
                      </div>
                    )}

                    {ocrStatus === 'success' && (
                      <div className="flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
                        <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
                        <div>
                          <p className="text-sm font-semibold text-green-800">Hospital ID scanned successfully</p>
                          <p className="text-sm text-green-700">Employee information extracted. Proceed to review.</p>
                        </div>
                      </div>
                    )}

                    <NavButtons
                      showBack={false}
                      onContinue={() => setStep(2)}
                      continueDisabled={ocrStatus !== 'success'}
                    />
                  </div>
                )}

                {step === 2 && ocrData && (
                  <div className="space-y-5">
                    <div className="flex items-center gap-3 rounded-2xl border border-green-200 bg-green-50 px-4 py-3.5 text-sm font-semibold text-green-800">
                      <CheckCircle className="h-5 w-5 shrink-0 text-[#16A34A]" aria-hidden />
                      ✓ Information extracted successfully
                    </div>

                    <p className="text-sm text-gray-500">
                      These details were read directly from your scanned Hospital ID and cannot be edited. If
                      information appears incorrect, go back and re-upload a clearer image.
                    </p>

                    <div className="grid gap-4 sm:grid-cols-2">
                      {[
                        { label: 'Full Name', value: ocrData.fullName },
                        { label: 'Employee ID', value: ocrData.employeeId },
                        { label: 'Hospital', value: ocrData.hospitalName },
                        { label: 'Department', value: ocrData.department },
                      ].map((field) => (
                        <div key={field.label} className="space-y-1.5">
                          <Label className="text-xs font-medium text-gray-500">{field.label}</Label>
                          <div className="relative">
                            <Input
                              readOnly
                              value={field.value}
                              aria-label={field.label}
                              className="h-12 cursor-not-allowed rounded-xl border-gray-200 bg-gray-100 pr-10 font-medium text-gray-900"
                            />
                            <Lock
                              className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                              aria-hidden
                            />
                          </div>
                        </div>
                      ))}
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label className="text-xs font-medium text-gray-500">Position</Label>
                        <div className="relative">
                          <Input
                            readOnly
                            value={ocrData.position}
                            aria-label="Position"
                            className="h-12 cursor-not-allowed rounded-xl border-gray-200 bg-gray-100 pr-10 font-medium text-gray-900"
                          />
                          <Lock
                            className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                            aria-hidden
                          />
                        </div>
                      </div>
                    </div>

                    <NavButtons onBack={() => setStep(1)} onContinue={() => setStep(3)} />
                  </div>
                )}

                {step === 3 && (
                  <div className="space-y-5">
                    <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                      <p>
                        This step is <strong className="text-amber-700">required</strong>. To verify your identity,
                        you must capture a live selfie using your device&apos;s camera. Uploading images from your
                        gallery is not permitted.
                      </p>
                    </div>

                    <canvas ref={canvasRef} className="hidden" />

                    {selfiePreview ? (
                      <div className="space-y-4">
                        <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-950">
                          <img src={selfiePreview} alt="Captured selfie" className="h-72 w-full object-cover" />
                          {faceStatus === 'processing' && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white">
                              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Analyzing face...
                            </div>
                          )}
                          {faceStatus === 'success' && (
                            <div className="absolute inset-0 flex items-center justify-center bg-green-500/20">
                              <div className="rounded-full bg-white p-4 shadow-lg">
                                <CheckCircle className="h-8 w-8 text-green-600" />
                              </div>
                            </div>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setSelfiePreview(null);
                            setFaceStatus('idle');
                            setFaceError('');
                            setCameraState('idle');
                          }}
                          className="h-11 w-full rounded-full"
                        >
                          <RefreshCw className="mr-2 h-4 w-4" /> Retake Photo
                        </Button>
                      </div>
                    ) : cameraState === 'active' ? (
                      <div className="space-y-4">
                        <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-black">
                          <video ref={videoRef} className="h-72 w-full object-cover" playsInline muted autoPlay />
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="h-40 w-32 rounded-3xl border-4 border-white/60" />
                          </div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Button
                            type="button"
                            onClick={captureSelfie}
                            className="h-12 rounded-full bg-blue-600 text-white hover:bg-blue-700"
                          >
                            <Camera className="mr-2 h-4 w-4" /> Capture Photo
                          </Button>
                          <Button type="button" variant="outline" onClick={clearMedia} className="h-12 rounded-full">
                            <X className="mr-2 h-4 w-4" /> Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <button
                          type="button"
                          onClick={openCamera}
                          className="flex h-44 w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-blue-200 bg-blue-50/50 transition hover:border-blue-300 hover:bg-blue-50"
                        >
                          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-100">
                            <Video className="h-7 w-7 text-blue-600" />
                          </div>
                          <span className="text-sm font-semibold text-blue-700">Open Camera</span>
                          <span className="text-xs text-slate-500">
                            Live selfie only — gallery uploads are not allowed
                          </span>
                        </button>
                        {faceError && (
                          <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                            <AlertCircle className="h-4 w-4" />
                            {faceError}
                          </div>
                        )}
                      </div>
                    )}

                    <NavButtons
                      onBack={() => setStep(2)}
                      onContinue={() => setStep(4)}
                      continueDisabled={faceStatus !== 'success'}
                    />
                  </div>
                )}

                {step === 4 && (
                  <div className="space-y-5">
                    <p className="text-sm text-gray-600">
                      Select the role you are registering for. Your selection will be verified against your Hospital
                      ID and PRC license. Registration will only continue if the selected role matches your verified
                      employment information.
                    </p>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {roleOptions.map((option) => {
                        const selected = selectedRole === option.value;
                        return (
                          <button
                            type="button"
                            key={option.value}
                            role="radio"
                            aria-checked={selected}
                            onClick={() => {
                              setSelectedRole(option.value);
                              setRoleSelectError('');
                            }}
                            className={`group flex w-full flex-col items-center gap-3 rounded-2xl border-2 p-6 text-center transition hover:-translate-y-0.5 hover:shadow-md ${
                              selected
                                ? 'border-[#2563EB] bg-blue-50 shadow-md shadow-blue-100 ring-2 ring-blue-100'
                                : 'border-gray-200 bg-white hover:border-blue-200'
                            }`}
                          >
                            <span className="text-5xl transition group-hover:scale-105" aria-hidden>
                              {option.emoji}
                            </span>
                            <div>
                              <p className="text-lg font-bold text-gray-900">{option.title}</p>
                              <p className="mt-1 text-xs leading-relaxed text-gray-500">{option.detail}</p>
                            </div>
                            <div
                              className={`mt-1 flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                                selected ? 'border-[#2563EB]' : 'border-gray-300'
                              }`}
                              aria-hidden
                            >
                              {selected && <div className="h-2.5 w-2.5 rounded-full bg-[#2563EB]" />}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    {roleSelectError && (
                      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {roleSelectError}
                      </div>
                    )}
                    <NavButtons
                      onBack={() => setStep(3)}
                      onContinue={() => {
                        if (!selectedRole) setRoleSelectError('Please select a role before continuing.');
                        else setStep(5);
                      }}
                    />
                  </div>
                )}

                {step === 5 && (
                  <div className="space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="licenseNumber" className="flex items-center gap-2 text-sm font-medium text-slate-700">
                        <ShieldCheck className="h-4 w-4 text-slate-400" />
                        PRC License Number <span className="text-red-500">*</span>
                      </Label>
                      <div className="relative">
                        <Input
                          id="licenseNumber"
                          type="text"
                          placeholder="1234567"
                          value={licenseNumber}
                          onChange={(e) => {
                            setLicenseNumber(e.target.value);
                            setPrcStatus('idle');
                            setPrcData(null);
                            setPrcError('');
                          }}
                          className="h-11 rounded-xl pr-28"
                        />
                        {prcStatus === 'processing' && (
                          <span className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1 text-xs text-blue-600">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Verifying...
                          </span>
                        )}
                        {prcStatus === 'success' && (
                          <span className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-full border border-green-300 bg-green-50 px-2.5 py-0.5 text-xs font-semibold text-green-700">
                            <CheckCircle className="h-3.5 w-3.5" /> Verified
                          </span>
                        )}
                      </div>
                      {prcError && <p className="text-sm text-red-600">{prcError}</p>}
                    </div>

                    {prcStatus === 'success' && prcData && (
                      <div className="rounded-xl border border-green-200 bg-green-50 p-4">
                        <div className="mb-3 flex items-center gap-2 font-semibold text-green-700">
                          <CheckCircle className="h-4 w-4" />
                          Active PRC License
                        </div>
                        <div className="grid gap-4 sm:grid-cols-3">
                          <div>
                            <p className="text-xs text-slate-500">License Status</p>
                            <p className="font-semibold text-slate-900">Active</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-500">Profession</p>
                            <p className="font-semibold text-slate-900">{prcData.profession}</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-500">Expiration Date</p>
                            <p className="font-semibold text-slate-900">{prcData.expiration}</p>
                          </div>
                        </div>
                      </div>
                    )}

                    <NavButtons
                      onBack={() => setStep(4)}
                      onContinue={() => setStep(6)}
                      continueDisabled={prcStatus !== 'success'}
                    />
                  </div>
                )}

                {step === 6 && (
                  <div className="space-y-5">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <p className="text-xs text-slate-500">Selected Role</p>
                        <p className="mt-1 flex items-center gap-2 text-sm font-semibold text-slate-900">
                          {selectedRole === 'supervisor' ? '👨‍⚕️' : '👩‍⚕️'}{' '}
                          {selectedRole === 'supervisor' ? 'Supervisor' : 'Nurse'}
                        </p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <p className="text-xs text-slate-500">OCR Detected Position</p>
                        <p className="mt-1 text-sm font-semibold text-slate-900">{ocrData?.position ?? 'Pending'}</p>
                      </div>
                    </div>

                    {roleMatch === 'matched' && (
                      <div className="rounded-xl border border-green-200 bg-green-50 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 font-semibold text-green-700">
                            <CheckCircle className="h-4 w-4" />
                            Role Verified
                          </div>
                          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-700">
                            <CheckCircle className="h-3 w-3" /> Role Match
                          </span>
                        </div>
                        <div className="mt-3 space-y-2 rounded-xl border border-green-100 bg-white p-4 text-sm text-slate-700">
                          <div className="flex items-center gap-2">
                            <CheckCircle className="h-4 w-4 text-green-600" />
                            Selected: <strong>{selectedRole === 'supervisor' ? 'Supervisor' : 'Nurse'}</strong>
                          </div>
                          <div className="flex items-center gap-2">
                            <CheckCircle className="h-4 w-4 text-green-600" />
                            OCR Detected: <strong>{ocrData?.position}</strong>
                          </div>
                        </div>
                        <p className="mt-3 flex items-center gap-2 text-sm font-medium text-green-700">
                          <CheckCircle className="h-4 w-4" />
                          You are authorized to register as a{' '}
                          {selectedRole === 'supervisor' ? 'Supervisor' : 'Nurse'}.
                        </p>
                      </div>
                    )}

                    {roleMatch === 'mismatch' && (
                      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-semibold text-red-700">Role Mismatch</div>
                          <span className="rounded-full border border-red-200 bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700">
                            Mismatch Detected
                          </span>
                        </div>
                        <div className="mt-3 space-y-2 rounded-xl border border-red-100 bg-white p-4 text-sm text-slate-700">
                          <div className="flex items-center gap-2">
                            <XCircle className="h-4 w-4 text-red-600" />
                            Selected: <strong>{selectedRole === 'supervisor' ? 'Supervisor' : 'Nurse'}</strong>
                          </div>
                          <div className="flex items-center gap-2">
                            <AlertCircle className="h-4 w-4 text-amber-500" />
                            OCR Detected: <strong>{ocrData?.position}</strong>
                          </div>
                        </div>
                        <p className="mt-3 text-sm font-medium text-red-700">
                          The selected role does not match your verified employment information.
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setStep(4)}
                          className="mt-3 h-11 w-full rounded-full border-red-300 text-red-700"
                        >
                          <ChevronLeft className="mr-2 h-4 w-4" /> Change Role Selection
                        </Button>
                      </div>
                    )}

                    <NavButtons
                      onBack={() => setStep(5)}
                      onContinue={() => setStep(7)}
                      continueDisabled={roleMatch !== 'matched'}
                    />
                  </div>
                )}

                {step === 7 && (
                  <form onSubmit={handleCreateAccount} className="space-y-5">
                    {globalError && (
                      <Alert variant="destructive">
                        <AlertDescription>{globalError}</AlertDescription>
                      </Alert>
                    )}

                    <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                      <p>
                        All identity verifications have passed. Set your login credentials below to complete
                        registration.
                      </p>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="email" className="mb-1.5 flex items-center gap-2 text-sm font-medium text-slate-700">
                          <Mail className="h-4 w-4 text-slate-400" />
                          Email Address <span className="text-red-500">*</span>
                        </Label>
                        <Input
                          id="email"
                          type="email"
                          placeholder="you@example.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className={`h-11 rounded-xl ${credErrors.email ? 'border-red-500' : ''}`}
                        />
                        {credErrors.email && <p className="mt-1.5 text-sm text-red-600">{credErrors.email}</p>}
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <Label
                            htmlFor="password"
                            className="mb-1.5 flex items-center gap-2 text-sm font-medium text-slate-700"
                          >
                            <Lock className="h-4 w-4 text-slate-400" />
                            Password <span className="text-red-500">*</span>
                          </Label>
                          <Input
                            id="password"
                            type="password"
                            placeholder="At least 8 characters"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className={`h-11 rounded-xl ${credErrors.password ? 'border-red-500' : ''}`}
                          />
                          {credErrors.password && <p className="mt-1.5 text-sm text-red-600">{credErrors.password}</p>}
                        </div>
                        <div>
                          <Label
                            htmlFor="confirmPassword"
                            className="mb-1.5 flex items-center gap-2 text-sm font-medium text-slate-700"
                          >
                            <Lock className="h-4 w-4 text-slate-400" />
                            Confirm Password <span className="text-red-500">*</span>
                          </Label>
                          <Input
                            id="confirmPassword"
                            type="password"
                            placeholder="Re-enter password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className={`h-11 rounded-xl ${credErrors.confirmPassword ? 'border-red-500' : ''}`}
                          />
                          {credErrors.confirmPassword && (
                            <p className="mt-1.5 text-sm text-red-600">{credErrors.confirmPassword}</p>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-green-200 bg-green-50 p-5">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 font-semibold text-green-800">
                          <ShieldCheck className="h-5 w-5 text-[#16A34A]" aria-hidden />
                          Identity Verification Complete
                        </div>
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#16A34A] px-3 py-1 text-xs font-semibold text-white">
                          <CheckCircle className="h-3 w-3" aria-hidden /> Complete
                        </span>
                      </div>
                      <div className="space-y-2">
                        {[
                          { label: 'Hospital ID Uploaded', done: idUploaded },
                          { label: 'OCR Completed', done: ocrDone },
                          { label: 'Face Verified', done: faceDone },
                          { label: 'Role Selected', done: roleSelected },
                          { label: 'PRC Verified', done: prcDone },
                          { label: 'Role Matched', done: roleVerified },
                          { label: 'Credentials Completed', done: credsDone },
                        ].map((item) => (
                          <div
                            key={item.label}
                            className={`flex items-center gap-3 rounded-full px-3 py-2 text-sm ${
                              item.done ? 'bg-white/80 text-green-800' : 'text-gray-500'
                            }`}
                          >
                            <span
                              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                                item.done ? 'bg-[#16A34A] text-white' : 'bg-green-200 text-green-600'
                              }`}
                            >
                              {item.done ? <CheckCircle className="h-3.5 w-3.5" aria-hidden /> : '·'}
                            </span>
                            <span className={item.done ? 'font-medium' : ''}>{item.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setStep(6)}
                        className="h-12 flex-1 rounded-xl border-gray-200"
                      >
                        <ChevronLeft className="mr-1 h-4 w-4" aria-hidden /> Back
                      </Button>
                      <Button
                        type="submit"
                        disabled={!canSubmitCredentials || isSubmitting}
                        className="h-12 flex-[1.5] rounded-xl bg-gradient-to-r from-[#2563EB] to-blue-600 text-white shadow-md shadow-blue-200 transition hover:-translate-y-0.5 hover:shadow-lg disabled:translate-y-0 disabled:cursor-not-allowed disabled:bg-none disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none"
                      >
                        {isSubmitting ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Creating Account...
                          </>
                        ) : (
                          <>
                            <UserPlus className="mr-2 h-4 w-4" aria-hidden /> Create Account
                          </>
                        )}
                      </Button>
                    </div>
                  </form>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {!submitted && (
          <div className="space-y-2 text-center">
            <p className="text-sm text-slate-500">
              Already have an account?{' '}
              <Link to="/login" className="font-semibold text-blue-600 hover:underline">
                Log In
              </Link>
            </p>
            <p className="text-xs text-slate-400">
              By creating an account, you agree to our Terms of Service and Privacy Policy
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
