import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Image,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import {
  User,
  Bell,
  Shield,
  LogOut,
  Palette,
  Settings as SettingsIcon,
  Save,
  KeyRound,
  Pencil,
  Info,
  Moon,
} from 'lucide-react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/Card';
import { Button } from '../../components/Button';
import { Select } from '../../components/Select';
import { Switch } from '../../components/Switch';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ProfileEditModal } from '../../components/ProfileEditModal';
import { PasswordChangeModal } from '../../components/PasswordChangeModal';
import { Colors, Radius } from '../../constants/colors';
import type { User as ProfileUser } from '../../types';
import { changePasswordRequest, ApiError } from '../../services/api';

const FONT_KEY = 'nurselink_fontsize';
const COMPACT_KEY = 'nurselink_compactview';
const DARK_KEY = 'nurselink_darkmode';

export default function SettingsScreen() {
  const { user, logout, updateUser } = useAuth();
  const toast = useToast();
  const router = useRouter();

  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const [showProfileEdit, setShowProfileEdit] = useState(false);
  const [showPasswordChange, setShowPasswordChange] = useState(false);

  const [fontSize, setFontSize] = useState('medium');
  const [compactView, setCompactView] = useState(false);

  const [taskNotifications, setTaskNotifications] = useState(true);
  const [handoverNotifications, setHandoverNotifications] = useState(true);
  const [criticalAlerts, setCriticalAlerts] = useState(true);
  const [emailNotifications, setEmailNotifications] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);

  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showCharts, setShowCharts] = useState(true);
  const [dataSync, setDataSync] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        // Web app clears dark mode on load — mirror that behavior
        await AsyncStorage.removeItem(DARK_KEY);

        const savedFont = await AsyncStorage.getItem(FONT_KEY);
        if (savedFont) setFontSize(savedFont);

        const savedCompact = await AsyncStorage.getItem(COMPACT_KEY);
        if (savedCompact !== null) setCompactView(savedCompact === 'true');
      } catch (e) {
        console.error('Error loading settings:', e);
      }
    })();
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(FONT_KEY, fontSize).catch(() => {});
  }, [fontSize]);

  useEffect(() => {
    AsyncStorage.setItem(COMPACT_KEY, compactView.toString()).catch(() => {});
  }, [compactView]);

  const handleSaveAppearance = () => {
    toast.success('Appearance settings saved!', {
      description: 'Your theme preferences have been applied.',
    });
  };

  const handleSaveNotifications = () => {
    toast.success('Notification preferences saved!', {
      description: 'Your notification settings have been updated.',
    });
  };

  const handleSavePreferences = () => {
    toast.success('System preferences saved!', {
      description: 'Your system settings have been updated.',
    });
  };

  const handleProfileSave = async (data: {
    name: string;
    email: string;
    department: string;
  }) => {
    updateUser({
      name: data.name,
      email: data.email,
      department: data.department,
    });
    toast.success('Profile updated successfully!', {
      description: 'Your profile information has been saved.',
    });
  };

  const handlePasswordSave = async (currentPassword: string, newPassword: string) => {
    try {
      await changePasswordRequest(currentPassword, newPassword);
      toast.success('Password changed successfully!', {
        description: 'Your password has been updated.',
      });
    } catch (error) {
      toast.error('Failed to change password', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
      throw error;
    }
  };

  const handleLogout = () => {
    setShowLogoutDialog(false);
    logout();
    router.replace('/login' as any);
  };

  const roleLabel = user?.role === 'staff_nurse' ? 'Nurse' : 'Supervisor';

  const profileUserForModal: ProfileUser | null = user
    ? {
        id: user.id,
        name: user.name,
        firstName: user.firstName || user.name.split(' ')[0] || '',
        middleName: user.middleName || '',
        lastName: user.lastName || user.name.split(' ').slice(1).join(' ') || '',
        email: user.email,
        role: user.role as ProfileUser['role'],
        department: user.department,
        licenseNumber: user.licenseNumber,
        avatar: user.avatar,
        createdAt: '',
      }
    : null;

  const ToggleRow = ({
    label,
    description,
    value,
    onValueChange,
    showSeparator = true,
  }: {
    label: string;
    description: string;
    value: boolean;
    onValueChange: (v: boolean) => void;
    showSeparator?: boolean;
  }) => (
    <View>
      <View style={styles.toggleRow}>
        <View style={styles.toggleText}>
          <Text style={styles.toggleLabel}>{label}</Text>
          <Text style={styles.toggleDesc}>{description}</Text>
        </View>
        <Switch value={value} onValueChange={onValueChange} />
      </View>
      {showSeparator ? <View style={styles.separator} /> : null}
    </View>
  );

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View>
        <Text style={styles.pageTitle}>Settings</Text>
        <Text style={styles.pageSubtitle}>Manage your account and preferences</Text>
      </View>

      {/* Profile Information */}
      <Card>
        <CardHeader>
          <View style={styles.titleRow}>
            <User size={20} color={Colors.blue600} />
            <CardTitle>Profile Information</CardTitle>
          </View>
          <CardDescription>Update your personal information</CardDescription>
        </CardHeader>
        <CardContent style={styles.gap4}>
          <View style={styles.profileRow}>
            {user?.avatar ? (
              <Image source={{ uri: user.avatar }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarFallback}>
                <User size={48} color={Colors.blue600} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.profileName}>{user?.name}</Text>
              <Text style={styles.profileMeta}>{roleLabel}</Text>
              <Text style={styles.profileMeta}>{user?.department}</Text>
              <Text style={styles.profileEmail}>{user?.email}</Text>
            </View>
          </View>

          <View style={styles.roleBox}>
            <Text style={styles.roleText}>
              <Text style={styles.roleBold}>Role: </Text>
              {roleLabel}
            </Text>
            <Text style={styles.roleHint}>
              Role cannot be changed. Contact your administrator for role updates.
            </Text>
          </View>

          <Button
            onPress={() => setShowProfileEdit(true)}
            style={{ backgroundColor: Colors.blue600 }}
          >
            <View style={styles.btnInner}>
              <Pencil size={16} color={Colors.white} />
              <Text style={styles.btnTextWhite}>Edit Profile</Text>
            </View>
          </Button>
        </CardContent>
      </Card>

      {/* Appearance Settings */}
      <Card>
        <CardHeader>
          <View style={styles.titleRow}>
            <Palette size={20} color={Colors.purple600} />
            <CardTitle>Appearance</CardTitle>
          </View>
          <CardDescription>Customize how the app looks</CardDescription>
        </CardHeader>
        <CardContent style={styles.gap4}>
          <Select
            label="Font Size"
            value={fontSize}
            onValueChange={setFontSize}
            options={[
              { label: 'Small', value: 'small' },
              { label: 'Medium (Default)', value: 'medium' },
              { label: 'Large', value: 'large' },
            ]}
          />

          <View style={styles.separator} />

          <ToggleRow
            label="Compact View"
            description="Reduce spacing between elements"
            value={compactView}
            onValueChange={setCompactView}
            showSeparator={false}
          />

          {/* Dark mode is intentionally unsupported — web clears nurselink_darkmode */}
          <View style={styles.darkModeNote}>
            <Moon size={16} color={Colors.mutedForeground} />
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Dark Mode</Text>
              <Text style={styles.toggleDesc}>
                Dark mode is not available. Theme preference is cleared on launch to keep a
                consistent light clinical interface.
              </Text>
            </View>
            <Switch value={false} onValueChange={() => {}} disabled />
          </View>

          <Button
            onPress={handleSaveAppearance}
            style={{ backgroundColor: Colors.purple600 }}
          >
            <View style={styles.btnInner}>
              <Save size={16} color={Colors.white} />
              <Text style={styles.btnTextWhite}>Save Appearance</Text>
            </View>
          </Button>
        </CardContent>
      </Card>

      {/* Notification Preferences */}
      <Card>
        <CardHeader>
          <View style={styles.titleRow}>
            <Bell size={20} color={Colors.orange600} />
            <CardTitle>Notification Preferences</CardTitle>
          </View>
          <CardDescription>Choose what notifications you receive</CardDescription>
        </CardHeader>
        <CardContent style={styles.gap4}>
          <ToggleRow
            label="Task Notifications"
            description="Get notified about new and updated tasks"
            value={taskNotifications}
            onValueChange={setTaskNotifications}
          />
          <ToggleRow
            label="Handover Notifications"
            description="Receive shift handover alerts"
            value={handoverNotifications}
            onValueChange={setHandoverNotifications}
          />
          <ToggleRow
            label="Critical Patient Alerts"
            description="Urgent notifications for critical patients"
            value={criticalAlerts}
            onValueChange={setCriticalAlerts}
          />
          <ToggleRow
            label="Email Notifications"
            description="Send notifications to your email"
            value={emailNotifications}
            onValueChange={setEmailNotifications}
          />
          <ToggleRow
            label="Sound Alerts"
            description="Play sound for notifications"
            value={soundEnabled}
            onValueChange={setSoundEnabled}
            showSeparator={false}
          />

          <Button
            onPress={handleSaveNotifications}
            style={{ backgroundColor: Colors.orange600 }}
          >
            <View style={styles.btnInner}>
              <Save size={16} color={Colors.white} />
              <Text style={styles.btnTextWhite}>Save Notifications</Text>
            </View>
          </Button>
        </CardContent>
      </Card>

      {/* System Preferences */}
      <Card>
        <CardHeader>
          <View style={styles.titleRow}>
            <SettingsIcon size={20} color={Colors.green600} />
            <CardTitle>System Preferences</CardTitle>
          </View>
          <CardDescription>Configure system behavior</CardDescription>
        </CardHeader>
        <CardContent style={styles.gap4}>
          <ToggleRow
            label="Auto-Refresh Data"
            description="Automatically update data every 30 seconds"
            value={autoRefresh}
            onValueChange={setAutoRefresh}
          />
          <ToggleRow
            label="Show Charts & Graphs"
            description="Display visual data analytics"
            value={showCharts}
            onValueChange={setShowCharts}
          />
          <ToggleRow
            label="Background Data Sync"
            description="Sync data in the background"
            value={dataSync}
            onValueChange={setDataSync}
            showSeparator={false}
          />

          <Button
            onPress={handleSavePreferences}
            style={{ backgroundColor: Colors.green600 }}
          >
            <View style={styles.btnInner}>
              <Save size={16} color={Colors.white} />
              <Text style={styles.btnTextWhite}>Save Preferences</Text>
            </View>
          </Button>
        </CardContent>
      </Card>

      {/* Security & Privacy */}
      <Card>
        <CardHeader>
          <View style={styles.titleRow}>
            <Shield size={20} color={Colors.red600} />
            <CardTitle>Security & Privacy</CardTitle>
          </View>
          <CardDescription>Manage your account security</CardDescription>
        </CardHeader>
        <CardContent style={styles.gap4}>
          <Button
            variant="outline"
            onPress={() => setShowPasswordChange(true)}
            style={styles.passwordBtn}
          >
            <View style={styles.btnInner}>
              <KeyRound size={16} color={Colors.foreground} />
              <Text style={styles.btnTextDark}>Change Password</Text>
            </View>
          </Button>

          <View style={styles.logoutCard}>
            <Text style={styles.logoutTitle}>Account Actions</Text>
            <Button
              onPress={() => setShowLogoutDialog(true)}
              variant="destructive"
              style={{ backgroundColor: Colors.red600 }}
            >
              <View style={styles.btnInner}>
                <LogOut size={16} color={Colors.white} />
                <Text style={styles.btnTextWhite}>Logout</Text>
              </View>
            </Button>
          </View>
        </CardContent>
      </Card>

      {/* System Info Footer */}
      <View style={styles.systemInfo}>
        <View style={styles.systemInfoHeader}>
          <Info size={16} color={Colors.mutedForeground} />
          <Text style={styles.systemInfoTitle}>System Information</Text>
        </View>
        <Text style={styles.systemInfoLine}>NurseLink Mobile v1.0.0</Text>
        <Text style={styles.systemInfoLine}>Expo Router · React Native</Text>
        <Text style={styles.systemInfoLine}>
          Session: {user?.email || 'Not signed in'}
        </Text>
        <Text style={styles.systemInfoLine}>
          Department: {user?.department || '—'}
        </Text>
        <Text style={styles.systemInfoCopy}>
          © {new Date().getFullYear()} NurseLink. Clinical documentation system.
        </Text>
      </View>

      {/* Logout Confirmation */}
      <ConfirmDialog
        open={showLogoutDialog}
        onOpenChange={setShowLogoutDialog}
        title="Confirm Logout"
        description="Are you sure you want to log out? You will need to sign in again to access the system."
        confirmLabel="Logout"
        cancelLabel="Cancel"
        onConfirm={handleLogout}
        destructive
      />

      {/* Profile Edit Modal */}
      <ProfileEditModal
        open={showProfileEdit}
        onOpenChange={setShowProfileEdit}
        user={profileUserForModal}
        onSave={handleProfileSave}
      />

      {/* Password Change Modal */}
      <PasswordChangeModal
        open={showPasswordChange}
        onOpenChange={setShowPasswordChange}
        onSave={handlePasswordSave}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
    gap: 24,
    maxWidth: 896,
    width: '100%',
    alignSelf: 'center',
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.gray900,
  },
  pageSubtitle: {
    fontSize: 14,
    color: Colors.gray600,
    marginTop: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  gap4: { gap: 16 },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 4,
    borderColor: Colors.blue200,
  },
  avatarFallback: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: Colors.blue100,
    borderWidth: 4,
    borderColor: Colors.blue200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileName: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.gray900,
  },
  profileMeta: {
    fontSize: 13,
    color: Colors.gray600,
    marginTop: 2,
  },
  profileEmail: {
    fontSize: 12,
    color: Colors.blue600,
    marginTop: 4,
  },
  roleBox: {
    padding: 12,
    backgroundColor: Colors.blue50,
    borderRadius: Radius.lg,
    gap: 4,
  },
  roleText: {
    fontSize: 13,
    color: Colors.gray700,
  },
  roleBold: {
    fontWeight: '700',
  },
  roleHint: {
    fontSize: 11,
    color: Colors.gray600,
    marginTop: 2,
  },
  separator: {
    height: 1,
    backgroundColor: Colors.border,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 4,
  },
  toggleText: {
    flex: 1,
    gap: 2,
  },
  toggleLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.foreground,
  },
  toggleDesc: {
    fontSize: 13,
    color: Colors.gray600,
    lineHeight: 18,
  },
  darkModeNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    backgroundColor: Colors.muted,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  btnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  btnTextWhite: {
    color: Colors.white,
    fontWeight: '600',
    fontSize: 14,
  },
  btnTextDark: {
    color: Colors.foreground,
    fontWeight: '600',
    fontSize: 14,
  },
  passwordBtn: {
    borderWidth: 1,
  },
  logoutCard: {
    padding: 16,
    backgroundColor: Colors.red50,
    borderWidth: 1,
    borderColor: Colors.red200,
    borderRadius: Radius.lg,
    gap: 12,
  },
  logoutTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.red700,
  },
  systemInfo: {
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 12,
    gap: 4,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  systemInfoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  systemInfoTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.mutedForeground,
  },
  systemInfoLine: {
    fontSize: 12,
    color: Colors.gray500,
  },
  systemInfoCopy: {
    fontSize: 11,
    color: Colors.gray500,
    marginTop: 8,
    textAlign: 'center',
  },
});
