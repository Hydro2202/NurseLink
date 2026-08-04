import React from 'react';
import { View, Text, StyleSheet, Image, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { CheckCircle2, ChevronLeft, Clock, Eye, ShieldCheck } from 'lucide-react-native';
import { Button } from '../components/Button';
import { Card, CardContent } from '../components/Card';
import { Colors, Radius, Shadows } from '../constants/colors';

const COMPLETED_STEPS = [
  'Identity Verification Completed',
  'Hospital ID Successfully Verified',
  'Face Verification Completed',
  'Registration Information Submitted',
];

const PENDING_STEPS = ['PRC License Verification Pending', 'Account Approval Pending'];

export default function PendingApprovalPage() {
  const router = useRouter();

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
          <View style={styles.orangeHeader}>
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
              <View style={styles.statusBadge}>
                <Clock size={14} color={Colors.orange700} />
                <Text style={styles.statusBadgeText}>Status: Pending Administrator Approval</Text>
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
              {PENDING_STEPS.map((label) => (
                <View key={label} style={styles.pendingStep}>
                  <View style={styles.pendingLeft}>
                    <View style={styles.pendingIcon}>
                      <Clock size={14} color={Colors.white} />
                    </View>
                    <Text style={styles.pendingText}>{label}</Text>
                  </View>
                  <View style={styles.pendingTag}>
                    <Text style={styles.pendingTagText}>Pending</Text>
                  </View>
                </View>
              ))}
            </View>

            <View style={styles.infoBox}>
              <View style={styles.infoHeader}>
                <ShieldCheck size={16} color={Colors.blue600} />
                <Text style={styles.infoTitle}>Your account is currently under review.</Text>
              </View>
              <Text style={styles.infoBody}>
                An administrator will verify your PRC License Number and confirm your employment details before
                activating your account.
              </Text>
              <Text style={styles.infoBody}>
                You will receive a notification once your account has been <Text style={styles.infoBold}>approved</Text> or{' '}
                <Text style={styles.infoBold}>rejected</Text>.
              </Text>
              <View style={styles.infoFooter}>
                <Clock size={14} color={Colors.blue600} />
                <Text style={styles.infoFooterText}>
                  Estimated verification time: <Text style={styles.infoBold}>Within 24–48 hours</Text>
                </Text>
              </View>
            </View>

            <View style={styles.actions}>
              <Button onPress={() => router.replace('/login')} size="lg" style={styles.primaryButton}>
                <ChevronLeft size={18} color={Colors.white} />
                <Text style={styles.primaryButtonText}>Return to Login</Text>
              </Button>
              <Button onPress={() => router.replace('/login')} variant="outline" size="lg" style={styles.secondaryButton}>
                <Eye size={18} color={Colors.orange700} />
                <Text style={styles.secondaryButtonText}>View Registration Status</Text>
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
  orangeHeader: {
    backgroundColor: Colors.orange600,
    paddingHorizontal: 24,
    paddingVertical: 28,
    alignItems: 'center',
  },
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
    backgroundColor: Colors.yellow200,
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
    borderColor: Colors.orange100,
    backgroundColor: Colors.orange50,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: Radius.full,
  },
  statusBadgeText: { fontSize: 13, fontWeight: '700', color: Colors.orange700 },
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
  secondaryButton: { minHeight: 48, borderRadius: Radius.full, borderColor: Colors.orange300 },
  secondaryButtonText: { color: Colors.orange700, fontSize: 15, fontWeight: '700' },
});
