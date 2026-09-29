import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, Link } from 'react-router';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Eye, EyeOff, Loader2, User, Lock, AlertCircle } from 'lucide-react';
import nurseLinkLogo from 'figma:asset/3d9b7c179afc2d98d9124ffe39a7807d2ffa64d9.png';
import hospitalBg from '../../assets/branding/hospital-bg.jpg';
import { ApiError } from '../api/nurselink';

export default function LoginPage() {
  const { login, isLoading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [selectedRole, setSelectedRole] = useState<'staff_nurse' | 'head_nurse'>('staff_nurse');
  const [error, setError] = useState('');

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
      setError(err instanceof ApiError ? err.message : 'Login failed. Please try again.');
    }
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}