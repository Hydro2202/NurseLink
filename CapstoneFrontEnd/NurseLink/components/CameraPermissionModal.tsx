import React from 'react';
import { View, Text, StyleSheet, Modal, Linking, Platform, Pressable } from 'react-native';
import { Camera, Settings as SettingsIcon, ShieldCheck } from 'lucide-react-native';
import { Button } from './Button';
import { Colors, Radius, Shadows } from '../constants/colors';

/**
 * Asks for camera access *before* any camera is opened.
 *
 * Both platforms show their own permission dialog exactly once per install.
 * Firing it cold — with no context — is how apps get denied: the user has no
 * idea why a nursing app suddenly wants their camera, taps "Don't Allow",
 * and the system never asks again. This screen explains the reason first, so
 * the native prompt arrives already answered.
 *
 * It also handles the one-way door. Once `canAskAgain` is false the OS will
 * not show the prompt again no matter what the app does, so the only honest
 * thing left is to say so and offer a shortcut to Settings.
 */

export type CameraPurpose = 'face' | 'id';

const COPY: Record<CameraPurpose, { title: string; body: string }> = {
  face: {
    title: 'Camera Access Required',
    body:
      'We need access to your camera to take a live photo of your face, so we can '
      + 'confirm it matches the photo on your PRC ID. Your camera is used only for '
      + 'this verification step — nothing is recorded, and no video is stored.',
  },
  id: {
    title: 'Camera Access Required',
    body:
      'We need access to your camera to photograph your PRC ID, so we can read your '
      + 'licence details automatically. Your camera is used only to capture this '
      + 'document — nothing is recorded, and no video is stored.',
  },
};

interface Props {
  visible: boolean;
  purpose: CameraPurpose;
  /** True once the OS refuses to prompt again — only Settings can grant it. */
  blocked?: boolean;
  onAllow: () => void;
  onCancel: () => void;
}

export function CameraPermissionModal({ visible, purpose, blocked = false, onAllow, onCancel }: Props) {
  const copy = COPY[purpose];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel} accessible={false}>
        <Pressable
          style={[styles.sheet, Shadows.xl]}
          onPress={(e) => e.stopPropagation()}
          accessibilityViewIsModal
        >
          <View style={styles.iconWrap}>
            {blocked ? (
              <SettingsIcon size={26} color={Colors.blue600} />
            ) : (
              <Camera size={26} color={Colors.blue600} />
            )}
          </View>

          <Text style={styles.title} accessibilityRole="header">
            {blocked ? 'Camera Access Is Turned Off' : copy.title}
          </Text>

          <Text style={styles.body}>
            {blocked
              ? 'Camera access for NurseLink is currently blocked, so we can’t ask again from '
                + 'here. You can turn it back on in your device settings, then return to this step.'
              : copy.body}
          </Text>

          {blocked && (
            <View style={styles.steps}>
              <Text style={styles.stepsTitle}>How to enable it</Text>
              <Text style={styles.step}>
                {Platform.OS === 'ios'
                  ? '1. Open Settings  →  NurseLink\n2. Turn on Camera\n3. Come back and try again'
                  : '1. Open Settings  →  Apps  →  NurseLink\n2. Tap Permissions  →  Camera\n3. Choose Allow, then try again'}
              </Text>
            </View>
          )}

          {!blocked && (
            <View style={styles.assurance}>
              <ShieldCheck size={14} color={Colors.green700} />
              <Text style={styles.assuranceText}>
                Used only for this step. You can revoke access any time in settings.
              </Text>
            </View>
          )}

          <View style={styles.actions}>
            <Button
              onPress={blocked ? () => void Linking.openSettings() : onAllow}
              size="lg"
              style={styles.primary}
            >
              <Text style={styles.primaryText}>
                {blocked ? 'Open Settings' : 'Allow Camera Access'}
              </Text>
            </Button>
            <Button onPress={onCancel} variant="outline" size="lg" style={styles.secondary}>
              <Text style={styles.secondaryText}>Not Now</Text>
            </Button>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  sheet: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: 24,
    gap: 14,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.blue50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 19, fontWeight: '700', color: Colors.gray900 },
  body: { fontSize: 14, lineHeight: 21, color: Colors.gray600 },
  steps: {
    backgroundColor: Colors.gray50,
    borderRadius: Radius.lg,
    padding: 14,
    gap: 6,
  },
  stepsTitle: { fontSize: 13, fontWeight: '700', color: Colors.gray700 },
  step: { fontSize: 13, lineHeight: 22, color: Colors.gray600 },
  assurance: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  assuranceText: { flex: 1, fontSize: 12, lineHeight: 18, color: Colors.gray500 },
  actions: { gap: 10, marginTop: 4 },
  primary: { width: '100%' },
  primaryText: { color: Colors.white, fontSize: 15, fontWeight: '600' },
  secondary: { width: '100%' },
  secondaryText: { color: Colors.gray700, fontSize: 15, fontWeight: '600' },
});
