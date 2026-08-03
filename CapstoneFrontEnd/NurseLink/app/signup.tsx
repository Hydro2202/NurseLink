import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link, useRouter } from 'expo-router';
import {
  Lock,
  Mail,
  Shield,
  UserPlus,
  CheckCircle,
} from 'lucide-react-native';
import type { UserRole } from '../contexts/AuthContext';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/Card';
import { Alert, AlertDescription } from '../components/Alert';
import { Select } from '../components/Select';
import { Colors, Shadows } from '../constants/colors';

const ROLE_OPTIONS = [
  { label: 'Nurse', value: 'staff_nurse' },
  { label: 'Supervisor', value: 'supervisor' },
];

export default function SignUpPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState<UserRole>('staff_nurse');
  const [department, setDepartment] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');

  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const validateEmail = (value: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(value);
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

  const getRoleName = (r: UserRole) => {
    const roleNames: Record<string, string> = {
      staff_nurse: 'Nurse',
      supervisor: 'Supervisor',
    };
    return roleNames[r] || r;
  };

  const handleSubmit = async () => {
    setError('');
    setFieldErrors({});

    if (!validateForm()) return;

    setIsLoading(true);

    try {
      await new Promise((resolve) => setTimeout(resolve, 2000));

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

      setTimeout(() => {
        router.replace('/login');
      }, 2000);
    } catch {
      setError('An error occurred during registration. Please try again.');
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <SafeAreaView style={styles.successSafe} edges={['top', 'bottom']}>
        <View style={styles.successCenter}>
          <Card style={styles.successCard}>
            <CardContent style={styles.successContent}>
              <View style={styles.successIconWrap}>
                <CheckCircle size={48} color={Colors.green600} />
              </View>
              <Text style={styles.successTitle}>Registration Successful!</Text>
              <Text style={styles.successDesc}>
                Your account has been created successfully. Redirecting you to login...
              </Text>
              <ActivityIndicator size="large" color={Colors.blue600} />
            </CardContent>
          </Card>
        </View>
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
          <View style={styles.inner}>
            <View style={styles.header}>
              <Image
                source={require('../assets/images/NurseLinkLogo.png')}
                style={styles.logo}
                resizeMode="contain"
                accessibilityLabel="NurseLink Logo"
              />
              <Text style={styles.subtitle}>Create your healthcare professional account</Text>
            </View>

            <Card style={styles.card}>
              <CardHeader style={styles.cardHeader}>
                <View style={styles.titleRow}>
                  <UserPlus size={24} color={Colors.blue600} />
                  <CardTitle style={styles.cardTitle}>Sign Up</CardTitle>
                </View>
                <CardDescription style={styles.cardDesc}>
                  Fill in your information to create an account
                </CardDescription>
              </CardHeader>

              <CardContent style={styles.cardContent}>
                {error ? (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}

                <View style={styles.nameRow}>
                  <View style={styles.nameCol}>
                    <Input
                      label="First Name *"
                      placeholder="Juan"
                      value={firstName}
                      onChangeText={setFirstName}
                      error={fieldErrors.firstName}
                    />
                  </View>
                  <View style={styles.nameCol}>
                    <Input
                      label="Middle Name"
                      placeholder="Santos"
                      value={middleName}
                      onChangeText={setMiddleName}
                    />
                  </View>
                  <View style={styles.nameCol}>
                    <Input
                      label="Last Name *"
                      placeholder="Dela Cruz"
                      value={lastName}
                      onChangeText={setLastName}
                      error={fieldErrors.lastName}
                    />
                  </View>
                </View>

                <View>
                  <View style={styles.labelRow}>
                    <Mail size={16} color={Colors.gray500} />
                    <Text style={styles.fieldLabel}>Email Address *</Text>
                  </View>
                  <Input
                    placeholder="your.email@hospital.com"
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    error={fieldErrors.email}
                  />
                </View>

                <View style={styles.passwordRow}>
                  <View style={styles.half}>
                    <View style={styles.labelRow}>
                      <Lock size={16} color={Colors.gray500} />
                      <Text style={styles.fieldLabel}>Password *</Text>
                    </View>
                    <Input
                      placeholder="At least 8 characters"
                      value={password}
                      onChangeText={setPassword}
                      secureTextEntry
                      autoCapitalize="none"
                      error={fieldErrors.password}
                    />
                  </View>
                  <View style={styles.half}>
                    <View style={styles.labelRow}>
                      <Lock size={16} color={Colors.gray500} />
                      <Text style={styles.fieldLabel}>Confirm Password *</Text>
                    </View>
                    <Input
                      placeholder="Re-enter password"
                      value={confirmPassword}
                      onChangeText={setConfirmPassword}
                      secureTextEntry
                      autoCapitalize="none"
                      error={fieldErrors.confirmPassword}
                    />
                  </View>
                </View>

                <View>
                  <View style={styles.labelRow}>
                    <Shield size={16} color={Colors.gray500} />
                    <Text style={styles.fieldLabel}>Role / Position *</Text>
                  </View>
                  <Select
                    value={role}
                    onValueChange={(v) => setRole(v as UserRole)}
                    options={ROLE_OPTIONS}
                  />
                  <Text style={styles.roleHint}>Selected: {getRoleName(role)}</Text>
                </View>

                <View style={styles.passwordRow}>
                  <View style={styles.half}>
                    <Input
                      label="Department *"
                      placeholder="e.g., ICU, ER, Pediatrics"
                      value={department}
                      onChangeText={setDepartment}
                      error={fieldErrors.department}
                    />
                  </View>
                  <View style={styles.half}>
                    <Input
                      label="PRC License Number *"
                      placeholder="e.g., 1234567"
                      value={licenseNumber}
                      onChangeText={setLicenseNumber}
                      error={fieldErrors.licenseNumber}
                    />
                  </View>
                </View>

                <Button
                  onPress={handleSubmit}
                  loading={isLoading}
                  disabled={isLoading}
                  size="lg"
                  style={styles.submit}
                >
                  {isLoading ? (
                    'Creating Account...'
                  ) : (
                    <View style={styles.submitInner}>
                      <UserPlus size={20} color={Colors.white} />
                      <Text style={styles.submitText}>Create Account</Text>
                    </View>
                  )}
                </Button>

                <View style={styles.loginLink}>
                  <Text style={styles.loginText}>
                    Already have an account?{' '}
                    <Link href="/login" style={styles.link}>
                      Log In
                    </Link>
                  </Text>
                </View>
              </CardContent>
            </Card>

            <Text style={styles.terms}>
              By creating an account, you agree to our Terms of Service and Privacy Policy
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.blue50,
  },
  successSafe: {
    flex: 1,
    backgroundColor: Colors.blue50,
  },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 16,
    paddingVertical: 24,
  },
  inner: {
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logo: {
    width: 256,
    height: 120,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.gray600,
    textAlign: 'center',
  },
  card: {
    borderWidth: 2,
    borderColor: Colors.gray200,
    ...Shadows.xl,
  },
  cardHeader: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.blue50,
    paddingBottom: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.gray900,
  },
  cardDesc: {
    fontSize: 15,
  },
  cardContent: {
    gap: 20,
    paddingTop: 20,
  },
  nameRow: {
    gap: 12,
  },
  nameCol: {
    flex: 1,
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
  passwordRow: {
    gap: 12,
  },
  half: {
    flex: 1,
  },
  roleHint: {
    fontSize: 12,
    color: Colors.gray500,
    marginTop: 6,
  },
  submit: {
    backgroundColor: Colors.blue600,
    height: 48,
    ...Shadows.md,
  },
  submitInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  submitText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: '600',
  },
  loginLink: {
    alignItems: 'center',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  loginText: {
    fontSize: 14,
    color: Colors.gray600,
  },
  link: {
    color: Colors.blue600,
    fontWeight: '700',
  },
  terms: {
    marginTop: 24,
    textAlign: 'center',
    fontSize: 12,
    color: Colors.gray500,
  },
  successCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  successCard: {
    width: '100%',
    maxWidth: 420,
    borderWidth: 2,
    borderColor: Colors.green200,
    ...Shadows.xl,
  },
  successContent: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 12,
  },
  successIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.green100,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  successTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.gray900,
    textAlign: 'center',
  },
  successDesc: {
    fontSize: 14,
    color: Colors.gray600,
    textAlign: 'center',
    marginBottom: 12,
    lineHeight: 20,
  },
});
