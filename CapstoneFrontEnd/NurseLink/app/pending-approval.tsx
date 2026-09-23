import React from 'react';
import { View, Text, StyleSheet, Image, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CheckCircle2, ChevronRight, Clock, ShieldCheck } from 'lucide-react-native';
import { Button } from '../components/Button';
import { Card, CardContent } from '../components/Card';
import { Colors, Radius, Shadows } from '../constants/colors';

export default function PendingApprovalPage() {
  const router = useRouter();
  const { method } = useLocalSearchParams<{ method?: string }>();

  // Every verification step below has already succeeded by the time this
  // screen renders — identity, ID and face/OTP checks are all real and done.
  // What is still pending is the human step on top of them: an admin
  // checking the claimed hospital/department against what they actually
  // know, before the account can sign in. Enforced server-side (LoginView,
  // IsApprovedNurse) — this screen is just telling the truth about that.
  const COMPLETED_STEPS = [
    'Identity Verification Completed',
    'Hospital ID Successfully Verified',
    method === 'EMAIL_OTP' ? 'Email OTP Verification Completed' : 'Face Verification Completed',
    'License Number Captured',
    'Registration Information Submitted',
    'Account Created and Activated',
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Image
          source={require('../assets/images/NurseLinkLogo.png')}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="NurseLink Logo"
        />

        <Card style={styles.card}>
          <View style={[styles.successHeader, styles.pendingHeader]}>
            <View style={styles.headerIconWrap}>
              <View style={styles.shieldCircle}>
                <ShieldCheck size={32} color={Colors.white} />
              </View>
              <View style={styles.clockBadge}>
                <Clock size={14} color={Colors.orange700} />
              </View>
            </View>
            <Text style={styles.headerTitle}>Registration Submitted</Text>
            <Text style={styles.headerSubtitle}>
              Your registration has been received and is awaiting administrator verification.
            </Text>
          </View>

          <CardContent style={styles.content}>
            <View style={styles.statusBadgeWrap}>
              <View style={[styles.statusBadge, styles.pendingBadge]}>
                <Clock size={14} color={Colors.orange700} />
                <Text style={[styles.statusBadgeText, styles.pendingBadgeText]}>
                  Status: Pending Administrator Approval
                </Text>
              </View>
            </View>

            <View style={styles.stepsList}>
              {COMPLETED_STEPS.map((label) => (
                <View key={label} style={styles.completedStep}>
                  <View style={styles.completedIcon}>
                    <CheckCircle2 size={14} color={Colors.white} />
                  </View>
                  <Text style={styles.completedText}>{label}</Text>
                </View>
              ))}
              <View style={styles.pendingStep}>
                <View style={styles.pendingLeft}>
                  <View style={[styles.pendingIcon, styles.pendingIconOutstanding]}>
                    <Clock size={14} color={Colors.white} />
                  </View>
                  <Text style={styles.pendingText}>Account Approval Pending</Text>
                </View>
                <View style={styles.pendingTag}>
                  <Text style={styles.pendingTagText}>Pending</Text>
                </View>
              </View>
            </View>

            <View style={styles.infoBox}>
              <View style={styles.infoHeader}>
                <ShieldCheck size={16} color={Colors.blue600} />
                <Text style={styles.infoTitle}>What happens next</Text>
              </View>
              <Text style={styles.infoBody}>
                An administrator checks the hospital and department details from your
                registration before your account can sign in. This is usually quick — you&apos;ll be
                able to log in with the email and password you just set as soon as it&apos;s approved.
              </Text>
            </View>

            <View style={styles.actions}>
              <Button onPress={() => router.replace('/login')} size="lg" style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>Go to Login</Text>
                <ChevronRight size={18} color={Colors.white} />
              </Button>
            </View>
          </CardContent>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.gray50 },
  scroll: { flexGrow: 1, padding: 20, alignItems: 'center', justifyContent: 'center' },
  logo: { width: 200, height: 80, marginBottom: 20 },
  card: { width: '100%', maxWidth: 520, borderWidth: 0, overflow: 'hidden', ...Shadows.lg },
  successHeader: {
    // green700, a shade deeper than the green600 tick circles below, so the
    // header anchors the card and the checklist reads as lighter accents.
    backgroundColor: Colors.green700,
    paddingHorizontal: 24,
    paddingVertical: 28,
    alignItems: 'center',
  },
  // Overrides successHeader's green — this screen is reporting a pending
  // review, not a completed success, and the color should say so at a glance.
  pendingHeader: { backgroundColor: Colors.orange700 },
  headerIconWrap: { position: 'relative', marginBottom: 16 },
  shieldCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clockBadge: {
    position: 'absolute',
    bottom: -4,
    right: -8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 22, fontWeight: '700', color: Colors.white, textAlign: 'center' },
  headerSubtitle: { marginTop: 8, fontSize: 14, color: 'rgba(255,255,255,0.85)', textAlign: 'center', lineHeight: 20 },
  content: { gap: 16, padding: 20 },
  statusBadgeWrap: { alignItems: 'center' },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.green200,
    backgroundColor: Colors.green50,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: Radius.full,
  },
  statusBadgeText: { fontSize: 13, fontWeight: '700', color: Colors.green700 },
  pendingBadge: { borderColor: Colors.orange300, backgroundColor: Colors.orange50 },
  pendingBadgeText: { color: Colors.orange700 },
  stepsList: { gap: 8 },
  completedStep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.green50,
    borderWidth: 1,
    borderColor: Colors.green100,
    borderRadius: Radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  completedIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.green600,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completedText: { flex: 1, fontSize: 13, fontWeight: '600', color: Colors.green700 },
  pendingStep: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.yellow50,
    borderWidth: 1,
    borderColor: Colors.yellow100,
    borderRadius: Radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  pendingLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  pendingIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.orange600,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Kept separate from pendingIcon so a future step that reuses pendingIcon
  // for something else doesn't silently inherit this one's color.
  pendingIconOutstanding: { backgroundColor: Colors.orange600 },
  pendingText: { flex: 1, fontSize: 13, fontWeight: '600', color: Colors.orange700 },
  pendingTag: {
    backgroundColor: Colors.orange100,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  pendingTagText: { fontSize: 11, fontWeight: '600', color: Colors.orange700 },
  infoBox: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.blue200,
    backgroundColor: Colors.blue50,
    padding: 16,
    gap: 8,
  },
  infoHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoTitle: { fontSize: 14, fontWeight: '700', color: Colors.blue800, flex: 1 },
  infoBody: { fontSize: 13, color: Colors.blue700, lineHeight: 18 },
  infoBold: { fontWeight: '700' },
  infoFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.blue200,
    paddingTop: 12,
    marginTop: 4,
  },
  infoFooterText: { fontSize: 13, color: Colors.blue800, flex: 1 },
  actions: { gap: 12, marginTop: 4 },
  primaryButton: { backgroundColor: Colors.blue600, minHeight: 48, borderRadius: Radius.full },
  primaryButtonText: { color: Colors.white, fontSize: 15, fontWeight: '700' },
  secondaryButton: { minHeight: 48, borderRadius: Radius.full, borderColor: Colors.green200 },
  secondaryButtonText: { color: Colors.green700, fontSize: 15, fontWeight: '700' },
});
