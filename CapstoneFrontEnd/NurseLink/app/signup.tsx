import React, { useCallback, useState } from 'react';
import { View, Text, Image, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, CardContent } from '../components/Card';
import { Colors, Shadows } from '../constants/colors';
import { SignupStepper, type SignupStepNumber } from '../components/signup-steps/SignupStepper';
import { Step1PersonalInfo } from '../components/signup-steps/Step1PersonalInfo';
import { Step2Role } from '../components/signup-steps/Step2Role';
import { Step3Verification } from '../components/signup-steps/Step3Verification';
import { Step4Credentials } from '../components/signup-steps/Step4Credentials';
import type { UserRole } from '../types/user';

/**
 * New 4-step signup wizard (Personal Info -> Role -> Email+Phone OTP
 * Verification -> Credentials). Replaces the old PRC-ID-scan + face-match
 * wizard that used to live at this same route (since retired, along with
 * its backend endpoints).
 *
 * Unlike the old flow, nothing here needs a live camera, so this wizard
 * does not redirect desktop browsers to /login the way the legacy one did.
 *
 * All four steps' fields live in one piece of state here so pressing Back
 * never loses what was already typed.
 */

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

const STEP_TITLES = ['Personal Information', 'Requested Role', 'Verify Your Email', 'Account Credentials'];
const STEP_DESCRIPTIONS = [
  'Tell us your name, exactly as it appears on your ID.',
  'Choose the role you are requesting. You start as a staff nurse; a head nurse request needs admin approval.',
  'Verify your personal email and phone number with a one-time code.',
  'Set your login email and password to finish creating your account.',
];

export default function SignUpPage() {
  const [step, setStep] = useState<SignupStepNumber>(1);
  const [data, setData] = useState<WizardData>(INITIAL_DATA);

  const patch = useCallback((p: Partial<WizardData>) => setData((d) => ({ ...d, ...p })), []);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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
              <Text style={styles.subtitle}>Create your NurseLink account</Text>
            </View>

            <SignupStepper current={step} />

            <Card style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.headerText}>
                  <Text style={styles.headerTitle}>
                    Step {step} of 4 — {STEP_TITLES[step - 1]}
                  </Text>
                  <Text style={styles.headerDesc}>{STEP_DESCRIPTIONS[step - 1]}</Text>
                </View>
              </View>

              <CardContent style={styles.cardContent}>
                {step === 1 && (
                  <Step1PersonalInfo
                    data={{ lastName: data.lastName, firstName: data.firstName, middleName: data.middleName }}
                    onChange={patch}
                    onNext={() => setStep(2)}
                  />
                )}
                {step === 2 && (
                  <Step2Role
                    value={data.role}
                    onChange={(role) => patch({ role })}
                    onNext={() => setStep(3)}
                    onBack={() => setStep(1)}
                  />
                )}
                {step === 3 && (
                  <Step3Verification
                    data={{
                      personalEmail: data.personalEmail,
                      phone: data.phone,
                      registrationSessionId: data.registrationSessionId,
                      otpVerified: data.otpVerified,
                    }}
                    onChange={patch}
                    onVerified={() => setStep(4)}
                    onBack={() => setStep(2)}
                  />
                )}
                {step === 4 && <Step4Credentials data={data} onChange={patch} onBack={() => setStep(3)} />}
              </CardContent>
            </Card>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.gray50 },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, padding: 16, paddingVertical: 24 },
  inner: { width: '100%', maxWidth: 560, alignSelf: 'center' },
  header: { alignItems: 'center', marginBottom: 16 },
  logo: { width: 220, height: 90, marginBottom: 4 },
  subtitle: { fontSize: 13, color: Colors.gray500, textAlign: 'center' },
  card: { borderWidth: 0, overflow: 'hidden', ...Shadows.lg },
  cardHeader: {
    backgroundColor: Colors.blue600,
    paddingHorizontal: 20,
    paddingVertical: 18,
  },
  headerText: { minWidth: 0 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.white, lineHeight: 22, flexShrink: 1 },
  headerDesc: { marginTop: 4, fontSize: 13, color: Colors.blue100, lineHeight: 18, flexShrink: 1 },
  cardContent: { padding: 20 },
});
