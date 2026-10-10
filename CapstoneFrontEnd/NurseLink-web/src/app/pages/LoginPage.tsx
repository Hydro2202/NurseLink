import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, Link } from 'react-router';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Eye, EyeOff, Loader2, User, Lock, AlertCircle, Clock, CheckCircle2, XCircle } from 'lucide-react';
import nurseLinkLogo from 'figma:asset/3d9b7c179afc2d98d9124ffe39a7807d2ffa64d9.png';
import hospitalBg from '../../assets/branding/hospital-bg.jpg';
import { ApiError } from '../api/nurselink';
import { toast } from 'sonner';

// LoginView (CapstoneBackEnd/api/views.py) rejects a pending/rejected account
// before ever issuing a token, and puts the reason in `data.approvalStatus` —
// this reads that field back out rather than guessing from the message text.
function approvalStatusFromError(err: unknown): 'pending' | 'rejected' | null {
  if (
    err instanceof ApiError &&
    err.data &&
    typeof err.data === 'object' &&
    'approvalStatus' in err.data
  ) {
    const value = (err.data as { approvalStatus?: unknown }).approvalStatus;
    if (value === 'pending' || value === 'rejected') return value;
  }
  return null;
}

export default function LoginPage() {
  const { login, logout, isLoading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [selectedRole, setSelectedRole] = useState<'staff_nurse' | 'head_nurse'>('staff_nurse');
  const [error, setError] = useState('');
  // Set only when the account itself is pending/rejected/newly-approved —
  // every other failure (wrong password, network error, ...) stays a plain
  // Alert above the form instead of replacing it with this card.
  const [statusCard, setStatusCard] = useState<'pending' | 'approved' | 'rejected' | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [checkingStatus, setCheckingStatus] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Simple validation - allow any input for prototype
    if (!email || !password) {
      setError('Please enter both email and password');
      return;
    }

    try {
      const loggedInUser = await login(email, password, selectedRole);
      // An admin account has no real nurse/head-nurse role — it always
      // lands on the admin interface regardless of which button was
      // selected above (see LoginView on the backend for why that's safe).
      navigate(loggedInUser.isAdmin ? '/admin' : '/dashboard');
    } catch (err) {
      const approval = approvalStatusFromError(err);
      if (approval === 'pending') {
        setStatusCard('pending');
        return;
      }
      if (approval === 'rejected') {
        setRejectionReason(err instanceof ApiError ? err.message : '');
        setStatusCard('rejected');
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Login failed. Please try again.');
    }
  };

  // Re-runs the exact same credential check as Sign In. LoginView validates
  // the password before it ever looks at approval_status, so reaching this
  // screen already proved the password is right — the only thing a retry can
  // reveal is whether an admin has approved the account since. A success
  // here means the account is now approved; per the spec that must still not
  // sign the nurse in, so the token is discarded immediately and the green
  // card asks them to sign in again through the normal form.
  const handleCheckStatus = async () => {
    setCheckingStatus(true);
    try {
      await login(email, password, selectedRole);
      logout();
      setStatusCard('approved');
    } catch (err) {
      const approval = approvalStatusFromError(err);
      if (approval === 'rejected') {
        setRejectionReason(err instanceof ApiError ? err.message : '');
        setStatusCard('rejected');
      } else if (approval === 'pending') {
        toast.info('Still pending', {
          description: 'An administrator has not approved this account yet.',
        });
      } else {
        toast.error('Could not check status', {
          description: err instanceof ApiError ? err.message : 'Please try again.',
        });
      }
    } finally {
      setCheckingStatus(false);
    }
  };

  const handleBackToSignIn = () => {
    setStatusCard(null);
    setPassword('');
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 relative bg-cover bg-center"
      style={{ backgroundImage: `url(${hospitalBg})` }}
    >
      {/* Subtle NurseLink-blue tint over the photo, not a heavy darken — the
          photo stays bright and clear, this just ties it to the brand color
          and keeps the white card from floating on top of it. Same tint as
          the mobile app's login screen (app/login.tsx's `overlay` style). */}
      <div className="absolute inset-0 bg-[rgba(37,99,235,0.38)] pointer-events-none" />
      <div className="w-full max-w-md relative">
        {/* Logo — no container/pill, it sits directly on the photo. The
            bloom behind it and the drop-shadow on the image itself create
            the glow; there's no box. Matches the mobile app's login screen
            exactly (same gradient/blur/shadow values). */}
        <div
          className="mb-6 relative flex items-center justify-center"
          style={{ isolation: 'isolate' }}
        >
          <div
            className="absolute rounded-full pointer-events-none"
            style={{
              width: 130,
              height: 130,
              backgroundImage:
                'radial-gradient(circle, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.2) 40%, transparent 70%)',
              filter: 'blur(6px)',
              zIndex: -1,
            }}
          />
          <img
            src={nurseLinkLogo}
            alt="NurseLink Logo"
            className="w-64 object-contain relative"
            style={{
              filter:
                'drop-shadow(0 0 6px rgba(255,255,255,0.9)) drop-shadow(0 0 14px rgba(255,255,255,0.6)) drop-shadow(0 0 28px rgba(255,255,255,0.35))',
            }}
          />
        </div>

        <Card className="border shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl font-bold">
              Sign In
            </CardTitle>
            <CardDescription className="text-sm">
              Enter your credentials to access the system
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-4">
            {statusCard ? (
              <div className="flex flex-col items-stretch">
                {statusCard === 'pending' && (
                  <div className="flex flex-col items-center gap-1.5 rounded-lg border border-orange-300 bg-orange-50 p-6 text-center">
                    <div className="mb-1.5 flex h-14 w-14 items-center justify-center rounded-full bg-orange-100">
                      <Clock className="h-6.5 w-6.5 text-orange-700" />
                    </div>
                    <p className="text-[17px] font-bold text-foreground">Your Account is Pending Approval</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      Your account has been successfully registered and is currently waiting for
                      administrator approval. Please wait while the administrator reviews and
                      approves your account.
                    </p>
                    <span className="mt-2 rounded-full border border-orange-300 bg-orange-100 px-3.5 py-1.5 text-xs font-bold text-orange-700">
                      Status: Pending
                    </span>
                    <Button
                      onClick={handleCheckStatus}
                      disabled={checkingStatus}
                      className="mt-3.5 w-full bg-primary hover:bg-primary-hover text-white"
                    >
                      {checkingStatus ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          Checking...
                        </>
                      ) : (
                        'Check Approval Status'
                      )}
                    </Button>
                    <button
                      type="button"
                      onClick={handleBackToSignIn}
                      className="mt-3 text-sm font-semibold text-muted-foreground hover:text-foreground"
                    >
                      Back to Sign In
                    </button>
                  </div>
                )}

                {statusCard === 'approved' && (
                  <div className="flex flex-col items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 p-6 text-center">
                    <div className="mb-1.5 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
                      <CheckCircle2 className="h-6.5 w-6.5 text-green-700" />
                    </div>
                    <p className="text-[17px] font-bold text-foreground">Account Approved</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      Your account has been approved by the administrator. You can now continue to
                      the login page and sign in.
                    </p>
                    <span className="mt-2 rounded-full border border-green-200 bg-green-100 px-3.5 py-1.5 text-xs font-bold text-green-700">
                      ✓ Approved
                    </span>
                    <Button
                      onClick={handleBackToSignIn}
                      className="mt-3.5 w-full bg-primary hover:bg-primary-hover text-white"
                    >
                      Proceed to Login
                    </Button>
                  </div>
                )}

                {statusCard === 'rejected' && (
                  <div className="flex flex-col items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 p-6 text-center">
                    <div className="mb-1.5 flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
                      <XCircle className="h-6.5 w-6.5 text-red-700" />
                    </div>
                    <p className="text-[17px] font-bold text-foreground">Account Not Approved</p>
                    <p className="mt-0.5 text-sm leading-5 text-muted-foreground">
                      {rejectionReason ||
                        'Your account registration was not approved by the administrator. Please contact an administrator for details.'}
                    </p>
                    <Button
                      onClick={handleBackToSignIn}
                      className="mt-3.5 w-full bg-primary hover:bg-primary-hover text-white"
                    >
                      Back to Sign In
                    </Button>
                  </div>
                )}
              </div>
            ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Error Alert */}
              {error && (
                <Alert variant="destructive" className="border">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="ml-2 text-sm">{error}</AlertDescription>
                </Alert>
              )}

              {/* Role Selection */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">
                  Select Role
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant={selectedRole === 'staff_nurse' ? 'default' : 'outline'}
                    className={`w-full h-10 font-medium text-sm rounded-md transition-all ${
                      selectedRole === 'staff_nurse'
                        ? 'bg-primary hover:bg-primary-hover text-white'
                        : 'border hover:bg-muted'
                    }`}
                    onClick={() => setSelectedRole('staff_nurse')}
                  >
                    Nurse
                  </Button>
                  <Button
                    type="button"
                    variant={selectedRole === 'head_nurse' ? 'default' : 'outline'}
                    className={`w-full h-10 font-medium text-sm rounded-md transition-all ${
                      selectedRole === 'head_nurse'
                        ? 'bg-primary hover:bg-primary-hover text-white'
                        : 'border hover:bg-muted'
                    }`}
                    onClick={() => setSelectedRole('head_nurse')}
                  >
                    Head Nurse
                  </Button>
                </div>
              </div>

              {/* Email Input */}
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium">
                  Email Address
                </Label>
                <div className="relative">
                  <User className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="Enter your email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10 h-10 text-sm border"
                  />
                </div>
              </div>

              {/* Password Input with Show/Hide Toggle */}
              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium">
                  Password
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10 pr-10 h-10 text-sm border"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Submit Button */}
              <Button
                type="submit"
                className="w-full h-10 bg-primary hover:bg-primary-hover text-white font-medium text-sm transition-all mt-2"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Signing In...
                  </>
                ) : (
                  'Sign In'
                )}
              </Button>

              {/* Sign Up Link */}
              <div className="text-center pt-2">
                <p className="text-sm text-muted-foreground">
                  Don't have an account?{' '}
                  <Link
                    to="/signup"
                    className="text-primary hover:text-primary-hover font-medium hover:underline"
                  >
                    Sign Up
                  </Link>
                </p>
              </div>
            </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}