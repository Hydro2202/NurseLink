import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link, useRouter } from 'expo-router';
import { Eye, EyeOff, User, Lock, Clock, CheckCircle2, XCircle } from 'lucide-react-native';
import { useAuth, UserRole } from '../contexts/AuthContext';
import { ApiError } from '../services/api';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/Card';
import { Alert, AlertDescription } from '../components/Alert';
import { Colors, Shadows, Radius } from '../constants/colors';
import { isDesktopBrowser } from '../utils/isDesktopBrowser';
import { useToast } from '../contexts/ToastContext';

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
  const { width } = useWindowDimensions();
  const hideSignUp = isDesktopBrowser(width);
  const { login, logout, isLoading } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [selectedRole, setSelectedRole] = useState<UserRole>('staff_nurse');
  const [error, setError] = useState('');
  // Set only when the account itself is pending/rejected/newly-approved —
  // every other failure (wrong password, network error, ...) stays a plain
  // Alert above the form instead of replacing it with this card.
  const [statusCard, setStatusCard] = useState<'pending' | 'approved' | 'rejected' | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [checkingStatus, setCheckingStatus] = useState(false);

  const handleSubmit = async () => {
    setError('');

    if (!email || !password) {
      setError('Please enter both email and password');
      return;
    }

    try {
      await login(email, password, selectedRole);
      router.replace('/(app)/dashboard' as any);
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
  // sign the nurse in, so the token is discarded immediately (same pattern
  // signup.tsx uses after registration) and the green card asks them to sign
  // in again through the normal form.
  const handleCheckStatus = async () => {
    setCheckingStatus(true);
    try {
      await login(email, password, selectedRole);
      await logout();
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

  const handleProceedToLogin = () => {
    setStatusCard(null);
    setPassword('');
  };

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
            <View style={styles.logoWrap}>
              <Image
                source={require('../assets/images/NurseLinkLogo.png')}
                style={styles.logo}
                resizeMode="contain"
                accessibilityLabel="NurseLink Logo"
              />
            </View>

            <Card style={styles.card}>
              <CardHeader style={styles.cardHeader}>
                <CardTitle style={styles.cardTitle}>Sign In</CardTitle>
                <CardDescription>Enter your credentials to access the system</CardDescription>
              </CardHeader>

              <CardContent style={styles.cardContent}>
                {statusCard ? (
                  <View style={styles.statusWrap}>
                    {statusCard === 'pending' && (
                      <View style={[styles.statusCard, styles.statusCardPending]}>
                        <View style={[styles.statusIconRing, styles.statusIconRingPending]}>
                          <Clock size={26} color={Colors.orange700} />
                        </View>
                        <Text style={styles.statusTitle}>Your Account is Pending Approval</Text>
                        <Text style={styles.statusBody}>
                          Your account has been successfully registered and is currently waiting
                          for administrator approval. Please wait while the administrator reviews
                          and approves your account.
                        </Text>
                        <View style={[styles.statusPill, styles.statusPillPending]}>
                          <Text style={[styles.statusPillText, styles.statusPillTextPending]}>
                            Status: Pending
                          </Text>
                        </View>
                        <Button
                          onPress={handleCheckStatus}
                          loading={checkingStatus}
                          disabled={checkingStatus}
                          style={styles.statusPrimaryBtn}
                        >
                          {checkingStatus ? 'Checking...' : 'Check Approval Status'}
                        </Button>
                        <Pressable onPress={handleBackToSignIn} hitSlop={8}>
                          <Text style={styles.statusBackLink}>Back to Sign In</Text>
                        </Pressable>
                      </View>
                    )}

                    {statusCard === 'approved' && (
                      <View style={[styles.statusCard, styles.statusCardApproved]}>
                        <View style={[styles.statusIconRing, styles.statusIconRingApproved]}>
                          <CheckCircle2 size={26} color={Colors.green700} />
                        </View>
                        <Text style={styles.statusTitle}>Account Approved</Text>
                        <Text style={styles.statusBody}>
                          Your account has been approved by the administrator. You can now
                          continue to the login page and sign in.
                        </Text>
                        <View style={[styles.statusPill, styles.statusPillApproved]}>
                          <Text style={[styles.statusPillText, styles.statusPillTextApproved]}>
                            ✓ Approved
                          </Text>
                        </View>
                        <Button onPress={handleProceedToLogin} style={styles.statusPrimaryBtn}>
                          Proceed to Login
                        </Button>
                      </View>
                    )}

                    {statusCard === 'rejected' && (
                      <View style={[styles.statusCard, styles.statusCardRejected]}>
                        <View style={[styles.statusIconRing, styles.statusIconRingRejected]}>
                          <XCircle size={26} color={Colors.red700} />
                        </View>
                        <Text style={styles.statusTitle}>Account Not Approved</Text>
                        <Text style={styles.statusBody}>
                          {rejectionReason ||
                            'Your account registration was not approved by the administrator. Please contact an administrator for details.'}
                        </Text>
                        <Button onPress={handleBackToSignIn} style={styles.statusPrimaryBtn}>
                          Back to Sign In
                        </Button>
                      </View>
                    )}
                  </View>
                ) : (
                  <>
                {error ? (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}

                <View style={styles.field}>
                  <Text style={styles.label}>Select Role</Text>
                  <View style={styles.roleRow}>
                    <Pressable
                      onPress={() => setSelectedRole('staff_nurse')}
                      style={[
                        styles.roleBtn,
                        selectedRole === 'staff_nurse' ? styles.roleBtnActive : styles.roleBtnOutline,
                      ]}
                    >
                      <Text
                        style={[
                          styles.roleBtnText,
                          selectedRole === 'staff_nurse'
                            ? styles.roleBtnTextActive
                            : styles.roleBtnTextOutline,
                        ]}
                      >
                        Nurse
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setSelectedRole('supervisor')}
                      style={[
                        styles.roleBtn,
                        selectedRole === 'supervisor' ? styles.roleBtnActive : styles.roleBtnOutline,
                      ]}
                    >
                      <Text
                        style={[
                          styles.roleBtnText,
                          selectedRole === 'supervisor'
                            ? styles.roleBtnTextActive
                            : styles.roleBtnTextOutline,
                        ]}
                      >
                        Supervisor
                      </Text>
                    </Pressable>
                  </View>
                </View>

                <Input
                  label="Email Address"
                  placeholder="Enter your email"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  leftIcon={<User size={16} color={Colors.mutedForeground} />}
                />

                <Input
                  label="Password"
                  placeholder="Enter your password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  leftIcon={<Lock size={16} color={Colors.mutedForeground} />}
                  rightIcon={
                    <Pressable
                      onPress={() => setShowPassword(!showPassword)}
                      hitSlop={8}
                      accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? (
                        <EyeOff size={16} color={Colors.mutedForeground} />
                      ) : (
                        <Eye size={16} color={Colors.mutedForeground} />
                      )}
                    </Pressable>
                  }
                />

                <Button
                  onPress={handleSubmit}
                  loading={isLoading}
                  disabled={isLoading}
                  style={styles.submit}
                >
                  {isLoading ? 'Signing In...' : 'Sign In'}
                </Button>

                {/* Registration needs a live camera for the PRC ID scan and
                    face match, which desktops handle poorly or not at all —
                    so desktop users are pointed at a phone instead. */}
                <View style={styles.footer}>
                  {hideSignUp ? (
                    <Text style={styles.footerText}>
                      New here? Registration is done in the NurseLink mobile app, which
                      can scan your PRC ID and verify your face.
                    </Text>
                  ) : (
                    <Text style={styles.footerText}>
                      Don't have an account?{' '}
                      <Link href="/signup" style={styles.link}>
                        Sign Up
                      </Link>
                    </Text>
                  )}
                </View>
                  </>
                )}
              </CardContent>
            </Card>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 16,
  },
  inner: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },
  logoWrap: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logo: {
    width: 256,
    height: 120,
  },
  card: {
    ...Shadows.sm,
  },
  cardHeader: {
    paddingBottom: 8,
  },
  statusWrap: {
    alignItems: 'stretch',
  },
  statusCard: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: 22,
    alignItems: 'center',
    gap: 6,
  },
  statusCardPending: { backgroundColor: Colors.orange50, borderColor: Colors.orange300 },
  statusCardApproved: { backgroundColor: Colors.green50, borderColor: Colors.green200 },
  statusCardRejected: { backgroundColor: Colors.red50, borderColor: Colors.red200 },
  statusIconRing: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  statusIconRingPending: { backgroundColor: Colors.orange100 },
  statusIconRingApproved: { backgroundColor: Colors.green100 },
  statusIconRingRejected: { backgroundColor: Colors.red100 },
  statusTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.foreground,
    textAlign: 'center',
  },
  statusBody: {
    fontSize: 13.5,
    lineHeight: 20,
    color: Colors.mutedForeground,
    textAlign: 'center',
    marginTop: 2,
  },
  statusPill: {
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: Radius.full,
    borderWidth: 1,
  },
  statusPillPending: { backgroundColor: Colors.orange100, borderColor: Colors.orange300 },
  statusPillApproved: { backgroundColor: Colors.green100, borderColor: Colors.green200 },
  statusPillText: { fontSize: 12, fontWeight: '700' },
  statusPillTextPending: { color: Colors.orange700 },
  statusPillTextApproved: { color: Colors.green700 },
  statusPrimaryBtn: {
    marginTop: 14,
    alignSelf: 'stretch',
    backgroundColor: Colors.blue600,
  },
  statusBackLink: {
    marginTop: 12,
    fontSize: 13,
    fontWeight: '600',
    color: Colors.mutedForeground,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  cardContent: {
    gap: 16,
  },
  field: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.foreground,
  },
  roleRow: {
    flexDirection: 'row',
    gap: 8,
  },
  roleBtn: {
    flex: 1,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleBtnActive: {
    backgroundColor: Colors.blue600,
  },
  roleBtnOutline: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  roleBtnText: {
    fontSize: 14,
    fontWeight: '500',
  },
  roleBtnTextActive: {
    color: Colors.white,
  },
  roleBtnTextOutline: {
    color: Colors.foreground,
  },
  submit: {
    marginTop: 8,
    backgroundColor: Colors.blue600,
  },
  footer: {
    alignItems: 'center',
    paddingTop: 8,
  },
  footerText: {
    fontSize: 14,
    color: Colors.mutedForeground,
  },
  link: {
    color: Colors.blue600,
    fontWeight: '600',
  },
});
