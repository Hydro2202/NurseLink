import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  Image,
  Platform,
  ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Camera, Trash2, User as UserIcon } from 'lucide-react-native';
import { Colors, Radius, Shadows } from '../constants/colors';
import { Button } from './Button';
import { Input } from './Input';
import { User } from '../types';

interface ProfileEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: User | null;
  onSave: (data: {
    name: string;
    email: string;
    avatar: string;
  }) => Promise<void>;
}

export function ProfileEditModal({ open, onOpenChange, user, onSave }: ProfileEditModalProps) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    avatar: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [photoBusy, setPhotoBusy] = useState(false);

  useEffect(() => {
    (() => {
      if (user && open) {
        setFormData({
          name: user.name,
          email: user.email,
          avatar: user.avatar || '',
        });
        setErrors({});
      }
    })();
  }, [user, open]);

  /**
   * Pick a profile photo.
   *
   * The bytes are read straight into a data: URI rather than uploaded as a
   * file, because the API stores the photo inline — the server re-encodes it
   * to a small square JPEG and strips EXIF, so nothing here has to resize or
   * worry about what the camera roll handed back.
   *
   * On web, expo-image-picker falls back to a file input, which needs no
   * permission; asking for one there returns a denial on some browsers and
   * would block the picker that would otherwise have worked.
   */
  const handlePickPhoto = async () => {
    setErrors((prev) => ({ ...prev, avatar: '' }));

    if (Platform.OS !== 'web') {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setErrors((prev) => ({
          ...prev,
          avatar: 'Photo library access is needed to choose a profile photo.',
        }));
        return;
      }
    }

    setPhotoBusy(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
        base64: true,
      });
      if (result.canceled) return;

      const asset = result.assets[0];
      if (!asset?.base64) {
        setErrors((prev) => ({
          ...prev,
          avatar: 'That photo could not be read. Please try another one.',
        }));
        return;
      }

      // mimeType is absent on some platforms; JPEG is what quality:0.85 produces.
      const mime = asset.mimeType || 'image/jpeg';
      setFormData((prev) => ({ ...prev, avatar: `data:${mime};base64,${asset.base64}` }));
    } catch (error) {
      console.error('Error choosing profile photo:', error);
      setErrors((prev) => ({
        ...prev,
        avatar: 'Could not open your photos. Please try again.',
      }));
    } finally {
      setPhotoBusy(false);
    }
  };

  const handleRemovePhoto = () => {
    setErrors((prev) => ({ ...prev, avatar: '' }));
    setFormData((prev) => ({ ...prev, avatar: '' }));
  };

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

  const roleLabel = user?.role === 'staff_nurse' ? 'Nurse' : 'Head Nurse';

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
              <View style={styles.photoSection}>
                <Text style={styles.photoLabel}>Profile Photo</Text>
                <View style={styles.photoRow}>
                  {formData.avatar ? (
                    <Image source={{ uri: formData.avatar }} style={styles.photo} />
                  ) : (
                    <View style={[styles.photo, styles.photoFallback]}>
                      <UserIcon size={34} color={Colors.blue600} />
                    </View>
                  )}

                  <View style={styles.photoActions}>
                    <Button
                      variant="outline"
                      size="sm"
                      onPress={handlePickPhoto}
                      disabled={photoBusy || loading}
                      style={styles.photoBtn}
                    >
                      {photoBusy ? (
                        <ActivityIndicator size="small" color={Colors.blue700} />
                      ) : (
                        <Camera size={15} color={Colors.blue700} />
                      )}
                      <Text style={styles.photoBtnText}>
                        {formData.avatar ? 'Change Photo' : 'Upload Photo'}
                      </Text>
                    </Button>

                    {formData.avatar ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onPress={handleRemovePhoto}
                        disabled={photoBusy || loading}
                        style={styles.photoBtn}
                      >
                        <Trash2 size={15} color={Colors.red600} />
                        <Text style={[styles.photoBtnText, { color: Colors.red600 }]}>Remove</Text>
                      </Button>
                    ) : null}

                    <Text style={styles.photoHint}>JPG or PNG. Squared automatically.</Text>
                  </View>
                </View>
                {errors.avatar ? <Text style={styles.photoError}>{errors.avatar}</Text> : null}
              </View>

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
                label="Phone Number"
                value={user?.phoneNumber || ''}
                placeholder="Not provided at sign-up"
                editable={false}
              />

              <View style={styles.roleBox}>
                <Text style={styles.roleText}>
                  <Text style={styles.roleBold}>Role: </Text>
                  {roleLabel}
                </Text>
                {user?.role === 'staff_nurse' ? (
                  <>
                    <Text style={styles.roleText}>
                      <Text style={styles.roleBold}>Department: </Text>
                      {user?.department || '—'}
                    </Text>
                    <Text style={styles.roleText}>
                      <Text style={styles.roleBold}>Shift: </Text>
                      {user?.shift
                        ? user.shift.charAt(0).toUpperCase() + user.shift.slice(1)
                        : 'No duty assigned'}
                    </Text>
                    <Text style={styles.roleHint}>
                      Role, department and shift are set by your head nurse. Contact them for changes.
                    </Text>
                  </>
                ) : (
                  // A head nurse or admin has no duty-roster department/shift
                  // of their own — those only describe a staff nurse's
                  // scheduled ward assignment, so showing them here (and
                  // worse, showing them stale/wrong, since nothing ever
                  // assigns a head nurse or admin a duty shift) was
                  // confusing rather than informative.
                  <Text style={styles.roleHint}>Your role is managed by an administrator.</Text>
                )}
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
  photoSection: { gap: 8 },
  photoLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.foreground,
  },
  photoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  photo: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.muted,
  },
  photoFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoActions: {
    flex: 1,
    gap: 8,
    alignItems: 'flex-start',
  },
  photoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  photoBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.blue700,
  },
  photoHint: {
    fontSize: 11,
    color: Colors.mutedForeground,
  },
  photoError: {
    fontSize: 12,
    color: Colors.red600,
  },
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
