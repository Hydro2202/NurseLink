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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link, useRouter } from 'expo-router';
import { Eye, EyeOff, User, Lock } from 'lucide-react-native';
import { useAuth, UserRole } from '../contexts/AuthContext';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/Card';
import { Alert, AlertDescription } from '../components/Alert';
import { Colors, Shadows, Radius } from '../constants/colors';

export default function LoginPage() {
  const { login, isLoading } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [selectedRole, setSelectedRole] = useState<UserRole>('staff_nurse');
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setError('');

    if (!email || !password) {
      setError('Please enter both email and password');
      return;
    }

    const result = await login(email, password, selectedRole);

    if (result === 'success') {
      router.replace('/(app)/dashboard' as any);
    } else if (result === 'pending') {
      setError(
        'Your registration is pending administrator approval. Please try again after you are notified.'
      );
    } else if (result === 'rejected') {
      setError('Your registration was rejected by an administrator. Please contact support.');
    } else {
      setError('Login failed. Please check your credentials and try again.');
    }
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

                <View style={styles.footer}>
                  <Text style={styles.footerText}>
                    Don't have an account?{' '}
                    <Link href="/signup" style={styles.link}>
                      Sign Up
                    </Link>
                  </Text>
                </View>
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
