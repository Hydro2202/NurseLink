import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  CheckCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  User2,
  Users,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent } from '../components/ui/card';
import { Alert, AlertDescription } from '../components/ui/alert';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '../components/ui/input-otp';
import { useAuth } from '../contexts/AuthContext';
import type { UserRole } from '../contexts/AuthContext';
import { ApiError } from '../api/client';
import {
  checkSignupV2NameRequest,
  registerSignupV2Request,
  resendSignupV2OtpRequest,
  sendSignupV2OtpRequest,
  startSignupV2Request,
  verifySignupV2OtpRequest,
} from '../api/nurselink';
import nurseLinkLogo from 'figma:asset/3d9b7c179afc2d98d9124ffe39a7807d2ffa64d9.png';

/**
 * 4-step signup wizard (Personal Info -> Role -> Email+Phone OTP ->
 * Credentials) on the signup-v2 endpoints — the same flow as the mobile
 * app's app/signup.tsx. PRC ID scanning and face verification are retired
 * (settings.SIGNUP_ID_FACE_VERIFICATION), so nothing here needs a camera or
 * an ID upload. All fields live in one state object so Back never loses
 * what was already typed.
 */

type StepNumber = 1 | 2 | 3 | 4;

type WizardData = {
  lastName: string;
  firstName: string;
  middleName: string;
  role: UserRole | '';
  personalEmail: string;
  phone: string;
  registrationSessionId: string | null;
  otpVerified: boolean;
  password: string;
  confirmPassword: string;
};

const INITIAL_DATA: WizardData = {
  lastName: '',
  firstName: '',
  middleName: '',
  role: '',
  personalEmail: '',
  phone: '',
  registrationSessionId: null,
  otpVerified: false,
  password: '',
  confirmPassword: '',
};

const STEP_LABELS = ['Personal Info', 'Role', 'Verify Email', 'Credentials'];
const STEP_ICONS = [User2, Users, Mail, Lock];
const STEP_TITLES = ['Personal Information', 'Requested Role', 'Verify Your Email', 'Account Credentials'];
const STEP_DESCRIPTIONS = [
  'Tell us your name, exactly as it appears on your ID.',
  'Choose the role you are requesting. You start as a staff nurse; a head nurse request needs admin approval.',
  'Verify your personal email and phone number with a one-time code.',
  'Set your password to finish creating your account.',
];

const ROLE_OPTIONS: Array<{ value: UserRole; title: string; detail: string; emoji: string }> = [
  {
    value: 'staff_nurse',
    title: 'Nurse',
    emoji: '👩‍⚕️',
    detail: 'Staff Nurse or Registered Nurse responsible for direct patient care and clinical documentation.',
  },
  {
    value: 'head_nurse',
    title: 'Head Nurse (requested, needs admin approval)',
    emoji: '👨‍💼',
    detail: 'Requested only. Head nurse access is granted by an administrator after review, never at signup.',
  },
];

/** Letters, spaces, hyphens, apostrophes and full stops — matches the server
 *  (api/serializers.py SignupV2RegisterSerializer._validate_name_part). */
const NAME_REGEX = /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ '\-.]{0,99}$/;
/** 09XXXXXXXXX or +639XXXXXXXXX — matches the server's PH_PHONE_REGEX. */
const PH_PHONE_REGEX = /^(?:0\d{10}|\+63\d{10})$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidNamePart(value: string, required: boolean): boolean {
  const trimmed = value.trim();
  if (!trimmed) return !required;
  return NAME_REGEX.test(trimmed);
}

/** Mirrors SignupV2RegisterSerializer.validate_password. */
function passwordChecks(password: string) {
  return {
    length: password.length >= 8,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    digit: /\d/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  };
}

const PASSWORD_RULES: Array<[keyof ReturnType<typeof passwordChecks>, string]> = [
  ['length', 'At least 8 characters'],
  ['upper', 'An uppercase letter'],
  ['lower', 'A lowercase letter'],
  ['digit', 'A number'],
  ['special', 'A special character'],
];

function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const data = err.data as
      | { message?: string; detail?: string; non_field_errors?: string | string[]; [key: string]: unknown }
      | string
      | undefined;
    if (typeof data === 'string' && data.trim()) return data;
    if (data && typeof data === 'object') {
      if (typeof data.message === 'string' && data.message) return data.message;
      if (typeof data.detail === 'string' && data.detail) return data.detail;
      const nonField = data.non_field_errors;
      if (Array.isArray(nonField) && nonField[0]) return String(nonField[0]);
      const firstField = Object.values(data).find((v) => Array.isArray(v) && v[0]) as string[] | undefined;
      if (firstField?.[0]) return String(firstField[0]);
    }
    if (err.message) return err.message;
  }
  if (err instanceof TypeError) {
    return 'Network error. Please check your connection and try again.';
  }
  return fallback;
}

const PRIMARY_BTN =
  'h-12 rounded-xl bg-gradient-to-r from-[#2563EB] to-blue-600 text-white shadow-md shadow-blue-200 transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-blue-300 disabled:translate-y-0 disabled:cursor-not-allowed disabled:bg-none disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none';
const BACK_BTN =
  'h-12 flex-1 rounded-xl border-gray-200 bg-white text-gray-700 transition hover:border-gray-300 hover:bg-gray-50';

function StepStepper({ current }: { current: StepNumber }) {
  return (
    <div className="mx-auto flex w-full max-w-[560px] items-start justify-between px-2">
      {STEP_LABELS.map((label, index) => {
        const step = (index + 1) as StepNumber;
        const active = step === current;
        const complete = step < current;
        const isLast = index === STEP_LABELS.length - 1;
        return (
          <div key={label} className={`flex items-start ${isLast ? '' : 'flex-1'}`}>
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
                className={`mt-2 max-w-[76px] text-center text-[11px] font-semibold leading-tight ${
                  complete ? 'text-[#16A34A]' : active ? 'text-[#2563EB]' : 'text-gray-400'
                }`}
              >
                {label}
              </span>
            </div>
            {!isLast && (
              <div
                className={`mx-1.5 mt-[19px] h-1 flex-1 rounded-full transition-colors duration-500 ${
                  complete ? 'bg-[#16A34A]' : active ? 'bg-blue-300' : 'bg-gray-200'
                }`}
                aria-hidden
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-xs text-red-600">{message}</p> : null;
}

function ErrorAlert({ message }: { message: string }) {
  return message ? (
    <Alert variant="destructive">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  ) : null;
}

type StepProps = {
  data: WizardData;
  onChange: (patch: Partial<WizardData>) => void;
};

function PersonalInfoStep({ data, onChange, onNext }: StepProps & { onNext: () => void }) {
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [checking, setChecking] = useState(false);
  const [nameError, setNameError] = useState('');

  const valid = {
    lastName: isValidNamePart(data.lastName, true),
    firstName: isValidNamePart(data.firstName, true),
    middleName: isValidNamePart(data.middleName, false),
  };
  const allValid = valid.lastName && valid.firstName && valid.middleName;

  const errorFor = (field: 'lastName' | 'firstName' | 'middleName', label: string) => {
    if (!touched[field] || valid[field]) return undefined;
    if (!data[field].trim()) return `${label} is required`;
    return `${label} may only contain letters, spaces, hyphens, periods, and apostrophes`;
  };

  const handleContinue = async () => {
    setTouched({ lastName: true, firstName: true, middleName: true });
    if (!allValid) return;
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

  const field = (key: 'lastName' | 'firstName' | 'middleName', label: string, placeholder: string, required: boolean) => (
    <div className="space-y-1.5">
      <Label htmlFor={key}>
        {label}
        {required ? ' *' : ''}
      </Label>
      <Input
        id={key}
        placeholder={placeholder}
        value={data[key]}
        autoCapitalize="words"
        onChange={(e) => {
          onChange({ [key]: e.target.value });
          setNameError('');
        }}
        onBlur={() => setTouched((t) => ({ ...t, [key]: true }))}
        aria-invalid={Boolean(errorFor(key, label))}
      />
      <FieldError message={errorFor(key, label)} />
    </div>
  );

  return (
    <div className="space-y-5">
      {field('lastName', 'Last Name', 'Dela Cruz', true)}
      {field('firstName', 'First Name', 'Juan', true)}
      {field('middleName', 'Middle Name', 'Optional', false)}
      <ErrorAlert message={nameError} />
      <Button
        type="button"
        onClick={handleContinue}
        disabled={!allValid || checking}
        className={`w-full ${PRIMARY_BTN}`}
      >
        {checking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
        Continue <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
      </Button>
      <p className="text-center text-sm text-gray-500">
        Already have an account?{' '}
        <Link to="/login" className="font-semibold text-[#2563EB] hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}

function RoleStep({ data, onChange, onNext, onBack }: StepProps & { onNext: () => void; onBack: () => void }) {
  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="Requested role" className="space-y-3">
        {ROLE_OPTIONS.map((opt) => {
          const selected = data.role === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange({ role: opt.value })}
              className={`flex w-full items-center gap-4 rounded-xl border-2 p-4 text-left transition ${
                selected ? 'border-[#2563EB] bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <span className="text-2xl" aria-hidden>
                {opt.emoji}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-sm font-semibold ${selected ? 'text-[#2563EB]' : 'text-gray-900'}`}>
                  {opt.title}
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-gray-500">{opt.detail}</span>
              </span>
              {selected ? <CheckCircle2 className="h-5 w-5 shrink-0 text-[#2563EB]" aria-hidden /> : null}
            </button>
          );
        })}
      </div>
      <div className="flex gap-3">
        <Button type="button" variant="outline" onClick={onBack} className={BACK_BTN}>
          <ChevronLeft className="mr-1 h-4 w-4" aria-hidden /> Back
        </Button>
        <Button type="button" onClick={onNext} disabled={!data.role} className={`flex-[1.5] ${PRIMARY_BTN}`}>
          Continue <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

type OtpPhase = 'form' | 'sending' | 'awaiting' | 'verifying' | 'verified';

function VerificationStep({
  data,
  onChange,
  onVerified,
  onBack,
}: StepProps & { onVerified: () => void; onBack: () => void }) {
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
  const phoneValid = PH_PHONE_REGEX.test(data.phone.trim());
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

  const startTimers = (res: { expiresIn?: number; resendCooldown?: number }) => {
    setPhase('awaiting');
    setOtpCode('');
    setOtpExpiresAt(Date.now() + (res.expiresIn ?? 300) * 1000);
    setResendAvailableAt(Date.now() + (res.resendCooldown ?? 60) * 1000);
  };

  const handleSendOtp = async () => {
    if (sendInFlight.current || !emailValid || !phoneValid) return;
    sendInFlight.current = true;
    setPhase('sending');
    setError('');
    try {
      const started = await startSignupV2Request(data.personalEmail.trim().toLowerCase(), data.phone.trim());
      onChange({ registrationSessionId: started.registrationSessionId });
      startTimers(await sendSignupV2OtpRequest(started.registrationSessionId));
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
      startTimers(await resendSignupV2OtpRequest(data.registrationSessionId));
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
      <div className="space-y-5">
        <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          <ShieldCheck className="h-5 w-5 shrink-0 text-green-600" aria-hidden />
          Email verified. You&apos;re all set for the last step.
        </div>
        <div className="flex gap-3">
          <Button type="button" variant="outline" onClick={onBack} className={BACK_BTN}>
            <ChevronLeft className="mr-1 h-4 w-4" aria-hidden /> Back
          </Button>
          <Button type="button" onClick={onVerified} className={`flex-[1.5] ${PRIMARY_BTN}`}>
            Continue <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>
    );
  }

  const locked = phase !== 'form';
  return (
    <div className="space-y-5">
      <ErrorAlert message={error} />
      <div className="space-y-1.5">
        <Label htmlFor="personalEmail">Personal Email *</Label>
        <Input
          id="personalEmail"
          type="email"
          placeholder="you@example.com"
          value={data.personalEmail}
          onChange={(e) => onChange({ personalEmail: e.target.value })}
          disabled={locked}
          autoComplete="email"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="phone">Phone Number *</Label>
        <Input
          id="phone"
          type="tel"
          placeholder="09123456789"
          value={data.phone}
          onChange={(e) => onChange({ phone: e.target.value })}
          disabled={locked}
          autoComplete="tel"
        />
        <FieldError
          message={data.phone.trim() && !phoneValid ? 'Use 09XXXXXXXXX or +639XXXXXXXXX' : undefined}
        />
      </div>

      {phase === 'form' && (
        <Button
          type="button"
          onClick={handleSendOtp}
          disabled={!emailValid || !phoneValid}
          className={`w-full ${PRIMARY_BTN}`}
        >
          Send OTP
        </Button>
      )}

      {phase === 'sending' && (
        <div className="flex items-center justify-center gap-2 text-sm text-gray-600">
          <Loader2 className="h-4 w-4 animate-spin text-[#2563EB]" aria-hidden /> Sending verification code...
        </div>
      )}

      {(phase === 'awaiting' || phase === 'verifying') && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Enter the 6-digit code sent to <span className="font-medium">{data.personalEmail.trim()}</span>
            {otpExpired ? ' (expired — request a new one)' : ''}
          </p>
          <InputOTP maxLength={6} value={otpCode} onChange={setOtpCode} disabled={phase === 'verifying'}>
            <InputOTPGroup>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <InputOTPSlot key={i} index={i} />
              ))}
            </InputOTPGroup>
          </InputOTP>
          <Button
            type="button"
            onClick={handleVerifyOtp}
            disabled={otpCode.length !== 6 || phase === 'verifying'}
            className={`w-full ${PRIMARY_BTN}`}
          >
            {phase === 'verifying' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
            Verify
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleResendOtp}
            disabled={resendSecondsLeft > 0}
            className="h-11 w-full rounded-xl"
          >
            {resendSecondsLeft > 0 ? `Resend OTP (${resendSecondsLeft}s)` : 'Resend OTP'}
          </Button>
        </div>
      )}

      <Button type="button" variant="outline" onClick={onBack} className={`w-full ${BACK_BTN}`}>
        <ChevronLeft className="mr-1 h-4 w-4" aria-hidden /> Back
      </Button>
    </div>
  );
}

function CredentialsStep({
  data,
  onChange,
  onBack,
  onSubmitted,
}: StepProps & { onBack: () => void; onSubmitted: () => void }) {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const checks = passwordChecks(data.password);
  const passwordValid = Object.values(checks).every(Boolean);
  const confirmValid = data.confirmPassword.length > 0 && data.confirmPassword === data.password;
  const canSubmit = passwordValid && confirmValid && !submitting;

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
        password: data.password,
        confirmPassword: data.confirmPassword,
        registrationSessionId: data.registrationSessionId,
      });
      onSubmitted();
    } catch (err) {
      setError(extractErrorMessage(err, 'Unable to create account. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  const passwordField = (
    key: 'password' | 'confirmPassword',
    label: string,
    shown: boolean,
    toggle: () => void
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={key}>{label} *</Label>
      <div className="relative">
        <Input
          id={key}
          type={shown ? 'text' : 'password'}
          value={data[key]}
          onChange={(e) => onChange({ [key]: e.target.value })}
          autoComplete="new-password"
          className="pr-10"
        />
        <button
          type="button"
          onClick={toggle}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-gray-500 hover:text-gray-700"
          aria-label={shown ? 'Hide password' : 'Show password'}
        >
          {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <ErrorAlert message={error} />
      <div className="space-y-1.5">
        <Label>Email (used to log in)</Label>
        <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800">
          {data.personalEmail}
        </div>
        <p className="text-xs text-gray-500">This is the email you verified in the previous step.</p>
      </div>
      {passwordField('password', 'Password', showPassword, () => setShowPassword((s) => !s))}
      {data.password ? (
        <ul className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
          {PASSWORD_RULES.map(([key, label]) => (
            <li key={key} className={`flex items-center gap-1.5 ${checks[key] ? 'text-green-700' : 'text-gray-500'}`}>
              <CheckCircle2 className={`h-3.5 w-3.5 ${checks[key] ? 'text-green-600' : 'text-gray-300'}`} aria-hidden />
              {label}
            </li>
          ))}
        </ul>
      ) : null}
      {passwordField('confirmPassword', 'Confirm Password', showConfirm, () => setShowConfirm((s) => !s))}
      <FieldError
        message={data.confirmPassword && !confirmValid ? 'Passwords do not match' : undefined}
      />
      <div className="flex gap-3">
        <Button type="button" variant="outline" onClick={onBack} className={BACK_BTN}>
          <ChevronLeft className="mr-1 h-4 w-4" aria-hidden /> Back
        </Button>
        <Button type="button" onClick={handleSubmit} disabled={!canSubmit} className={`flex-[1.5] ${PRIMARY_BTN}`}>
          {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
          Create Account
        </Button>
      </div>
    </div>
  );
}

function RegistrationSubmitted({ onLogin }: { onLogin: () => void }) {
  return (
    <Card className="overflow-hidden rounded-2xl border border-gray-200 shadow-lg shadow-gray-200/60">
      <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
          <CheckCircle2 className="h-8 w-8 text-green-600" aria-hidden />
        </div>
        <h2 className="text-2xl font-bold text-gray-900">Registration submitted!</h2>
        <p className="max-w-sm text-sm text-gray-600">
          Your account is pending admin approval. You&apos;ll be able to log in once approved.
        </p>
        <Button type="button" onClick={onLogin} className={`w-full max-w-xs ${PRIMARY_BTN}`}>
          Go to Login
        </Button>
      </CardContent>
    </Card>
  );
}

export default function SignUpPage() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [step, setStep] = useState<StepNumber>(1);
  const [data, setData] = useState<WizardData>(INITIAL_DATA);
  const [submitted, setSubmitted] = useState(false);

  const patch = (p: Partial<WizardData>) => setData((d) => ({ ...d, ...p }));
  // Signs out any session already in this browser before /login, so the
  // login page doesn't bounce straight back into someone else's account.
  const goToLogin = () => {
    logout();
    navigate('/login');
  };

  const Icon = STEP_ICONS[step - 1];

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[560px] flex-col gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <img src={nurseLinkLogo} alt="NurseLink" className="h-24 w-auto object-contain" />
          {!submitted && <p className="text-sm text-gray-500">Create your NurseLink account</p>}
        </div>

        {submitted ? (
          <RegistrationSubmitted onLogin={goToLogin} />
        ) : (
          <>
            <StepStepper current={step} />
            <Card className="overflow-hidden rounded-2xl border border-gray-200 shadow-lg shadow-gray-200/60">
              <div className="bg-gradient-to-r from-[#2563EB] to-blue-600 px-6 py-5 text-white">
                <div className="flex items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/20">
                    <Icon className="h-5 w-5" aria-hidden />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold leading-snug text-white sm:text-xl">
                      Step {step} of {STEP_LABELS.length} — {STEP_TITLES[step - 1]}
                    </h2>
                    <p className="mt-1 text-sm text-blue-100">{STEP_DESCRIPTIONS[step - 1]}</p>
                  </div>
                </div>
              </div>
              <CardContent className="p-6 sm:p-8">
                {step === 1 && <PersonalInfoStep data={data} onChange={patch} onNext={() => setStep(2)} />}
                {step === 2 && (
                  <RoleStep data={data} onChange={patch} onNext={() => setStep(3)} onBack={() => setStep(1)} />
                )}
                {step === 3 && (
                  <VerificationStep
                    data={data}
                    onChange={patch}
                    onVerified={() => setStep(4)}
                    onBack={() => setStep(2)}
                  />
                )}
                {step === 4 && (
                  <CredentialsStep
                    data={data}
                    onChange={patch}
                    onBack={() => setStep(3)}
                    onSubmitted={() => setSubmitted(true)}
                  />
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
