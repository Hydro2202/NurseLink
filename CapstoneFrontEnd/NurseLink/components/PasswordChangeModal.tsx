import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
} from 'react-native';
import { Eye, EyeOff, CheckCircle, XCircle } from 'lucide-react-native';
import { Colors, Radius, Shadows } from '../constants/colors';
import { Button } from './Button';
import { Input } from './Input';
import { Progress } from './Progress';

interface PasswordChangeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (currentPassword: string, newPassword: string) => Promise<void>;
}

export function PasswordChangeModal({ open, onOpenChange, onSave }: PasswordChangeModalProps) {
  const [loading, setLoading] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [formData, setFormData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) {
      setFormData({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
      setErrors({});
      setShowCurrentPassword(false);
      setShowNewPassword(false);
      setShowConfirmPassword(false);
    }
  }, [open]);

  const calculatePasswordStrength = (password: string): number => {
    let strength = 0;
    if (password.length >= 8) strength += 25;
    if (password.length >= 12) strength += 25;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) strength += 25;
    if (/[0-9]/.test(password)) strength += 12.5;
    if (/[^a-zA-Z0-9]/.test(password)) strength += 12.5;
    return Math.min(strength, 100);
  };

  const passwordStrength = calculatePasswordStrength(formData.newPassword);

  const getPasswordStrengthLabel = (strength: number): string => {
    if (strength < 25) return 'Very Weak';
    if (strength < 50) return 'Weak';
    if (strength < 75) return 'Good';
    return 'Strong';
  };

  const getPasswordStrengthColor = (strength: number): string => {
    if (strength < 25) return Colors.red600;
    if (strength < 50) return Colors.orange600;
    if (strength < 75) return Colors.warning;
    return Colors.green600;
  };

  const getPasswordStrengthTextColor = (strength: number): string => {
    if (strength < 50) return Colors.red600;
    if (strength < 75) return Colors.orange700;
    return Colors.green600;
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.currentPassword) {
      newErrors.currentPassword = 'Current password is required';
    }

    if (!formData.newPassword) {
      newErrors.newPassword = 'New password is required';
    } else if (formData.newPassword.length < 8) {
      newErrors.newPassword = 'Password must be at least 8 characters';
    } else if (formData.newPassword === formData.currentPassword) {
      newErrors.newPassword = 'New password must be different from current password';
    }

    if (!formData.confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your new password';
    } else if (formData.newPassword !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;
    setLoading(true);
    try {
      await onSave(formData.currentPassword, formData.newPassword);
      onOpenChange(false);
    } catch (error) {
      console.error('Error changing password:', error);
    } finally {
      setLoading(false);
    }
  };

  const passwordRequirements = [
    { met: formData.newPassword.length >= 8, label: 'At least 8 characters' },
    {
      met: /[a-z]/.test(formData.newPassword) && /[A-Z]/.test(formData.newPassword),
      label: 'Mixed case letters',
    },
    { met: /[0-9]/.test(formData.newPassword), label: 'Contains numbers' },
    {
      met: /[^a-zA-Z0-9]/.test(formData.newPassword),
      label: 'Contains special characters',
    },
  ];

  const EyeToggle = ({
    show,
    onToggle,
  }: {
    show: boolean;
    onToggle: () => void;
  }) => (
    <Pressable onPress={onToggle} hitSlop={8}>
      {show ? (
        <EyeOff size={16} color={Colors.mutedForeground} />
      ) : (
        <Eye size={16} color={Colors.mutedForeground} />
      )}
    </Pressable>
  );

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => onOpenChange(false)}>
      <Pressable style={styles.backdrop} onPress={() => !loading && onOpenChange(false)}>
        <Pressable style={[styles.dialog, Shadows.xl]} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>Change Password</Text>
          <Text style={styles.description}>
            Ensure your account is using a strong and secure password.
          </Text>

          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.form}>
              <Input
                label="Current Password *"
                placeholder="Enter your current password"
                value={formData.currentPassword}
                onChangeText={(currentPassword) => setFormData({ ...formData, currentPassword })}
                secureTextEntry={!showCurrentPassword}
                error={errors.currentPassword}
                rightIcon={
                  <EyeToggle
                    show={showCurrentPassword}
                    onToggle={() => setShowCurrentPassword(!showCurrentPassword)}
                  />
                }
              />

              <View style={{ gap: 8 }}>
                <Input
                  label="New Password *"
                  placeholder="Enter your new password"
                  value={formData.newPassword}
                  onChangeText={(newPassword) => setFormData({ ...formData, newPassword })}
                  secureTextEntry={!showNewPassword}
                  error={errors.newPassword}
                  rightIcon={
                    <EyeToggle
                      show={showNewPassword}
                      onToggle={() => setShowNewPassword(!showNewPassword)}
                    />
                  }
                />

                {formData.newPassword ? (
                  <View style={styles.strengthBox}>
                    <View style={styles.strengthHeader}>
                      <Text style={styles.strengthLabel}>Password Strength</Text>
                      <Text
                        style={[
                          styles.strengthValue,
                          { color: getPasswordStrengthTextColor(passwordStrength) },
                        ]}
                      >
                        {getPasswordStrengthLabel(passwordStrength)}
                      </Text>
                    </View>
                    <Progress
                      value={passwordStrength}
                      height={8}
                      fillColor={getPasswordStrengthColor(passwordStrength)}
                      trackColor={Colors.muted}
                    />
                  </View>
                ) : null}
              </View>

              <Input
                label="Confirm New Password *"
                placeholder="Confirm your new password"
                value={formData.confirmPassword}
                onChangeText={(confirmPassword) => setFormData({ ...formData, confirmPassword })}
                secureTextEntry={!showConfirmPassword}
                error={errors.confirmPassword}
                rightIcon={
                  <EyeToggle
                    show={showConfirmPassword}
                    onToggle={() => setShowConfirmPassword(!showConfirmPassword)}
                  />
                }
              />

              {formData.newPassword ? (
                <View style={styles.requirements}>
                  <Text style={styles.requirementsTitle}>Password Requirements</Text>
                  {passwordRequirements.map((req, idx) => (
                    <View key={idx} style={styles.reqRow}>
                      {req.met ? (
                        <CheckCircle size={14} color={Colors.green600} />
                      ) : (
                        <XCircle size={14} color={Colors.mutedForeground} />
                      )}
                      <Text
                        style={[
                          styles.reqText,
                          { color: req.met ? Colors.green700 : Colors.mutedForeground },
                        ]}
                      >
                        {req.label}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <Button
              variant="outline"
              onPress={() => onOpenChange(false)}
              disabled={loading}
              style={{ flex: 1 }}
            >
              Cancel
            </Button>
            <Button onPress={handleSubmit} disabled={loading} loading={loading} style={{ flex: 1 }}>
              {loading ? 'Changing...' : 'Change Password'}
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
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  dialog: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: 20,
    width: '100%',
    maxWidth: 540,
    maxHeight: '90%',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.foreground,
    marginBottom: 4,
  },
  description: {
    fontSize: 13,
    color: Colors.mutedForeground,
    marginBottom: 16,
    lineHeight: 18,
  },
  form: { gap: 16, paddingBottom: 8 },
  strengthBox: { gap: 8, marginTop: 4 },
  strengthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  strengthLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: Colors.mutedForeground,
  },
  strengthValue: {
    fontSize: 11,
    fontWeight: '600',
  },
  requirements: {
    padding: 14,
    backgroundColor: Colors.muted,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
  },
  requirementsTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.foreground,
    marginBottom: 2,
  },
  reqRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  reqText: {
    fontSize: 12,
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
});
