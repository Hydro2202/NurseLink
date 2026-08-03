import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
} from 'react-native';
import { Colors, Radius, Shadows } from '../constants/colors';
import { Button } from './Button';
import { Input } from './Input';
import { User } from '../types';

interface ProfileEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: User | null;
  onSave: (data: { name: string; email: string; department: string }) => Promise<void>;
}

export function ProfileEditModal({ open, onOpenChange, user, onSave }: ProfileEditModalProps) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    department: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (user && open) {
      setFormData({
        name: user.name,
        email: user.email,
        department: user.department || '',
      });
      setErrors({});
    }
  }, [user, open]);

  const validateEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Name is required';
    } else if (formData.name.trim().length < 2) {
      newErrors.name = 'Name must be at least 2 characters';
    }

    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!validateEmail(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }

    if (!formData.department.trim()) {
      newErrors.department = 'Department is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;
    setLoading(true);
    try {
      await onSave(formData);
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const roleLabel = user?.role === 'staff_nurse' ? 'Nurse' : 'Supervisor';

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => onOpenChange(false)}>
      <Pressable style={styles.backdrop} onPress={() => !loading && onOpenChange(false)}>
        <Pressable style={[styles.dialog, Shadows.xl]} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>Edit Profile</Text>
          <Text style={styles.description}>
            Update your personal information. Changes will be reflected across the system.
          </Text>

          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.form}>
              <Input
                label="Full Name *"
                placeholder="e.g., Sarah Johnson"
                value={formData.name}
                onChangeText={(name) => setFormData({ ...formData, name })}
                error={errors.name}
              />

              <Input
                label="Email Address *"
                placeholder="your.email@hospital.com"
                value={formData.email}
                onChangeText={(email) => setFormData({ ...formData, email })}
                keyboardType="email-address"
                autoCapitalize="none"
                error={errors.email}
              />

              <Input
                label="Department *"
                placeholder="e.g., ICU, Emergency, General Ward"
                value={formData.department}
                onChangeText={(department) => setFormData({ ...formData, department })}
                error={errors.department}
              />

              <View style={styles.roleBox}>
                <Text style={styles.roleText}>
                  <Text style={styles.roleBold}>Role: </Text>
                  {roleLabel}
                </Text>
                <Text style={styles.roleHint}>
                  Role cannot be changed. Contact your administrator for role updates.
                </Text>
              </View>
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
              {loading ? 'Saving...' : 'Save Changes'}
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
  roleBox: {
    padding: 14,
    backgroundColor: Colors.muted,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 4,
  },
  roleText: {
    fontSize: 14,
    color: Colors.foreground,
  },
  roleBold: {
    fontWeight: '700',
  },
  roleHint: {
    fontSize: 12,
    color: Colors.mutedForeground,
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
