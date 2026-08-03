import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router';
import { Lock, User, Mail, AlertCircle, Activity, Loader2, Shield, UserPlus, CheckCircle } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import type { UserRole } from '../types';
import nurseLinkLogo from 'figma:asset/3d9b7c179afc2d98d9124ffe39a7807d2ffa64d9.png';

export default function SignUpPage() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  
  // Form fields
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState<UserRole>('staff_nurse');
  const [department, setDepartment] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  
  // Error states
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const validateEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};

    if (!firstName.trim()) errors.firstName = 'First name is required';
    if (!lastName.trim()) errors.lastName = 'Last name is required';
    
    if (!email) {
      errors.email = 'Email is required';
    } else if (!validateEmail(email)) {
      errors.email = 'Please enter a valid email address';
    }

    if (!password) {
      errors.password = 'Password is required';
    } else if (password.length < 8) {
      errors.password = 'Password must be at least 8 characters';
    }

    if (!confirmPassword) {
      errors.confirmPassword = 'Please confirm your password';
    } else if (password !== confirmPassword) {
      errors.confirmPassword = 'Passwords do not match';
    }

    if (!department.trim()) errors.department = 'Department is required';
    if (!licenseNumber.trim()) errors.licenseNumber = 'License number is required';

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setFieldErrors({});

    if (!validateForm()) return;

    setIsLoading(true);

    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Create user object (in real app, this would be sent to backend)
      const newUser = {
        id: Date.now().toString(),
        firstName,
        middleName,
        lastName,
        name: `${firstName} ${middleName ? middleName + ' ' : ''}${lastName}`,
        email,
        role,
        department,
        licenseNumber,
        createdAt: new Date().toISOString(),
      };

      console.log('New user created:', newUser);

      setSuccess(true);
      
      // Redirect to login after success
      setTimeout(() => {
        navigate('/login');
      }, 2000);

    } catch (err) {
      setError('An error occurred during registration. Please try again.');
      setIsLoading(false);
    }
  };

  const getRoleName = (role: UserRole) => {
    const roleNames = {
      staff_nurse: 'Nurse',
      supervisor: 'Supervisor',
    };
    return roleNames[role as keyof typeof roleNames] || role;
  };

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white flex items-center justify-center p-4">
        <Card className="w-full max-w-md text-center border-2 border-green-200 shadow-xl">
          <CardContent className="pt-10 pb-10">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-green-100 rounded-full mb-6">
              <CheckCircle className="w-12 h-12 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">Registration Successful!</h2>
            <p className="text-gray-600 mb-6">
              Your account has been created successfully. Redirecting you to login...
            </p>
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-600" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Logo and Header */}
        <div className="text-center mb-8">
          <img
            src={nurseLinkLogo}
            alt="NurseLink Logo"
            className="w-64 mx-auto object-contain mb-2"
          />
          <p className="text-gray-600">Create your healthcare professional account</p>
        </div>

        <Card className="border-2 border-gray-200 shadow-xl">
          <CardHeader className="border-b bg-gradient-to-r from-blue-50 to-white">
            <CardTitle className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <UserPlus className="w-6 h-6 text-blue-600" />
              Sign Up
            </CardTitle>
            <CardDescription className="text-base">
              Fill in your information to create an account
            </CardDescription>
          </CardHeader>
          
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Error Alert */}
              {error && (
                <Alert variant="destructive" className="border-2">
                  <AlertCircle className="h-5 w-5" />
                  <AlertDescription className="ml-2">{error}</AlertDescription>
                </Alert>
              )}

              {/* Name Fields */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName" className="text-sm font-semibold text-gray-700">
                    First Name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="firstName"
                    type="text"
                    placeholder="Juan"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className={fieldErrors.firstName ? 'border-red-500' : ''}
                  />
                  {fieldErrors.firstName && (
                    <p className="text-sm text-red-600 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {fieldErrors.firstName}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="middleName" className="text-sm font-semibold text-gray-700">
                    Middle Name
                  </Label>
                  <Input
                    id="middleName"
                    type="text"
                    placeholder="Santos"
                    value={middleName}
                    onChange={(e) => setMiddleName(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="lastName" className="text-sm font-semibold text-gray-700">
                    Last Name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="lastName"
                    type="text"
                    placeholder="Dela Cruz"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className={fieldErrors.lastName ? 'border-red-500' : ''}
                  />
                  {fieldErrors.lastName && (
                    <p className="text-sm text-red-600 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {fieldErrors.lastName}
                    </p>
                  )}
                </div>
              </div>

              {/* Email */}
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <Mail className="w-4 h-4 text-gray-500" />
                  Email Address <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="your.email@hospital.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={fieldErrors.email ? 'border-red-500' : ''}
                />
                {fieldErrors.email && (
                  <p className="text-sm text-red-600 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    {fieldErrors.email}
                  </p>
                )}
              </div>

              {/* Password Fields */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <Lock className="w-4 h-4 text-gray-500" />
                    Password <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="At least 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={fieldErrors.password ? 'border-red-500' : ''}
                  />
                  {fieldErrors.password && (
                    <p className="text-sm text-red-600 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {fieldErrors.password}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword" className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <Lock className="w-4 h-4 text-gray-500" />
                    Confirm Password <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder="Re-enter password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className={fieldErrors.confirmPassword ? 'border-red-500' : ''}
                  />
                  {fieldErrors.confirmPassword && (
                    <p className="text-sm text-red-600 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {fieldErrors.confirmPassword}
                    </p>
                  )}
                </div>
              </div>

              {/* Role Selection */}
              <div className="space-y-2">
                <Label htmlFor="role" className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-gray-500" />
                  Role / Position <span className="text-red-500">*</span>
                </Label>
                <Select value={role} onValueChange={(value) => setRole(value as UserRole)}>
                  <SelectTrigger id="role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="staff_nurse">Nurse</SelectItem>
                    <SelectItem value="supervisor">Supervisor</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-500">
                  Selected: {getRoleName(role)}
                </p>
              </div>

              {/* Department & License Number */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="department" className="text-sm font-semibold text-gray-700">
                    Department <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="department"
                    type="text"
                    placeholder="e.g., ICU, ER, Pediatrics"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className={fieldErrors.department ? 'border-red-500' : ''}
                  />
                  {fieldErrors.department && (
                    <p className="text-sm text-red-600 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {fieldErrors.department}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="licenseNumber" className="text-sm font-semibold text-gray-700">
                    PRC License Number <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="licenseNumber"
                    type="text"
                    placeholder="e.g., 1234567"
                    value={licenseNumber}
                    onChange={(e) => setLicenseNumber(e.target.value)}
                    className={fieldErrors.licenseNumber ? 'border-red-500' : ''}
                  />
                  {fieldErrors.licenseNumber && (
                    <p className="text-sm text-red-600 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {fieldErrors.licenseNumber}
                    </p>
                  )}
                </div>
              </div>

              {/* Submit Button */}
              <Button
                type="submit"
                className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-base shadow-md hover:shadow-lg transition-all"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    Creating Account...
                  </>
                ) : (
                  <>
                    <UserPlus className="w-5 h-5 mr-2" />
                    Create Account
                  </>
                )}
              </Button>

              {/* Login Link */}
              <div className="text-center pt-4 border-t">
                <p className="text-sm text-gray-600">
                  Already have an account?{' '}
                  <Link
                    to="/login"
                    className="text-blue-600 hover:text-blue-700 font-semibold hover:underline"
                  >
                    Log In
                  </Link>
                </p>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Footer Notice */}
        <div className="mt-6 text-center">
          <p className="text-xs text-gray-500">
            By creating an account, you agree to our Terms of Service and Privacy Policy
          </p>
        </div>
      </div>
    </div>
  );
}