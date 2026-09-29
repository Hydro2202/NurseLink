import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Image,
  ActivityIndicator,
} from 'react-native';
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
} from 'lucide-react-native';
import { useAuth } from '../../contexts/AuthContext';
import { usePreferences } from '../../contexts/PreferencesContext';
import { useTheme } from '../../contexts/ThemeContext';
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
import { changePasswordRequest, ApiError, type UserPreferences } from '../../services/api';

/** Which controls each Save button is responsible for. */
const SECTIONS = {
  appearance: ['fontSize', 'compactView'],
  notifications: [
    'taskNotifications',
    'handoverNotifications',
    'criticalAlerts',
    'emailNotifications',
    'soundAlerts',
  ],
  system: ['autoRefresh', 'showCharts', 'backgroundSync'],
} as const satisfies Record<string, readonly (keyof UserPreferences)[]>;

type SectionName = keyof typeof SECTIONS;

// Module-scope, not defined inside SettingsScreen: a component declared
// inside another component's render body gets a brand-new identity every
// render, so React tears down and remounts it on every state change
// instead of just updating it in place. `styles` is themed per-render (see
// createStyles below), so it's taken as a prop rather than closed over.
const ToggleRow = ({
  styles,
  label,
  description,
  value,
  onValueChange,
  showSeparator = true,
}: {
  styles: ReturnType<typeof createStyles>;
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

export default function SettingsScreen() {
  const { user, logout, updateUser } = useAuth();
  // Rebuilt only when the theme changes, so toggling a switch does not rebuild
  // every style object on every keystroke elsewhere on the page.
  const { colors: c, scale, space } = useTheme();
  const styles = useMemo(() => createStyles(c, scale, space), [c, scale, space]);
  const toast = useToast();
  const router = useRouter();

  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const [showProfileEdit, setShowProfileEdit] = useState(false);
  const [showPasswordChange, setShowPasswordChange] = useState(false);

  // Every control on this page reads and writes the account's settings on the
  // server. Toggling is local so a nurse can change several things and press
  // Save once; Save is what actually persists them.
  const { preferences, loading: preferencesLoading, setLocal, save } = usePreferences();
  const [savingSection, setSavingSection] = useState<SectionName | null>(null);

  const {
    fontSize,
    compactView,
    taskNotifications,
    handoverNotifications,
    criticalAlerts,
    emailNotifications,
    soundAlerts,
    autoRefresh,
    showCharts,
    backgroundSync,
  } = preferences;

  const saveSection = async (section: SectionName, successMessage: string) => {
    setSavingSection(section);
    try {
      // Send only this section's fields, so pressing one Save button cannot
      // overwrite unsaved edits sitting in another section.
      const changes: Partial<UserPreferences> = {};
      for (const key of SECTIONS[section]) {
        (changes as Record<string, unknown>)[key] = preferences[key];
      }
      await save(changes);
      toast.success(successMessage, { description: 'Your settings have been saved.' });
    } catch (error) {
      toast.error('Could not save your settings', {
        description:
          error instanceof ApiError
            ? error.message
            : 'Check your connection and try again — nothing was changed.',
      });
    } finally {
      setSavingSection(null);
    }
  };

  const handleSaveAppearance = () => saveSection('appearance', 'Appearance settings saved!');
  const handleSaveNotifications = () =>
    saveSection('notifications', 'Notification preferences saved!');
  const handleSavePreferences = () => saveSection('system', 'System preferences saved!');

  const handleProfileSave = async (data: {
    name: string;
    email: string;
    avatar: string;
  }) => {
    try {
      // Awaited: the dialog stays open and reports the problem if the server
      // refuses, instead of closing on a success message that was never true.
      await updateUser({
        name: data.name,
        email: data.email,
        avatar: data.avatar,
      });
      toast.success('Profile updated successfully!', {
        description: 'Your profile information has been saved.',
      });
    } catch (error) {
      toast.error('Could not update your profile', {
        description:
          error instanceof ApiError
            ? error.message
            : 'Check your connection and try again — nothing was changed.',
      });
      throw error;
    }
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

  const handleLogout = async () => {
    setShowLogoutDialog(false);
    // Awaited: only navigate once the token is actually revoked and cleared,
    // so a reload right after logout cannot resume the session.
    await logout();
    router.replace('/login' as any);
  };

  const roleLabel =
    user?.role === 'staff_nurse' ? 'Nurse' : user?.role === 'admin' ? 'Administrator' : 'Head Nurse';

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
        shift: user.shift,
        licenseNumber: user.licenseNumber,
        avatar: user.avatar,
        createdAt: '',
      }
    : null;

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
            <User size={20} color={c.blue600} />
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
                <User size={48} color={c.blue600} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.profileName}>{user?.name}</Text>
              <Text style={styles.profileMeta}>{roleLabel}</Text>
              <Text style={styles.profileMeta}>{user?.department}</Text>
              <Text style={styles.profileEmail}>{user?.email}</Text>
            </View>
          </View>

          {user?.role !== 'admin' ? (
            <View style={styles.roleBox}>
              <Text style={styles.roleText}>
                <Text style={styles.roleBold}>Role: </Text>
                {roleLabel}
              </Text>
              <Text style={styles.roleHint}>
                Role cannot be changed. Contact your administrator for role updates.
              </Text>
            </View>
          ) : null}

          <Button
            onPress={() => setShowProfileEdit(true)}
            style={{ backgroundColor: c.blue600 }}
          >
            <View style={styles.btnInner}>
              <Pencil size={16} color={c.white} />
              <Text style={styles.btnTextWhite}>Edit Profile</Text>
            </View>
          </Button>
        </CardContent>
      </Card>

      {/* Appearance Settings */}
      <Card>
        <CardHeader>
          <View style={styles.titleRow}>
            <Palette size={20} color={c.purple600} />
            <CardTitle>Appearance</CardTitle>
          </View>
          <CardDescription>Customize how the app looks</CardDescription>
        </CardHeader>
        <CardContent style={styles.gap4}>
          <Select
            label="Font Size"
            value={fontSize}
            onValueChange={(value) => setLocal({ fontSize: value as UserPreferences['fontSize'] })}
            options={[
              { label: 'Small', value: 'small' },
              { label: 'Medium (Default)', value: 'medium' },
              { label: 'Large', value: 'large' },
            ]}
          />

          <View style={styles.separator} />

          <ToggleRow
            styles={styles}
            label="Compact View"
            description="Reduce spacing between elements"
            value={compactView}
            onValueChange={(value) => setLocal({ compactView: value })}
            showSeparator={false}
          />

          <Button
            onPress={handleSaveAppearance}
            // Disabled until the account's real settings have arrived, so a
            // nurse cannot save defaults over what they already had.
            disabled={preferencesLoading || savingSection !== null}
            style={{ backgroundColor: c.purple600 }}
          >
            <View style={styles.btnInner}>
              {savingSection === 'appearance' ? (
                <ActivityIndicator size="small" color={c.white} />
              ) : (
                <Save size={16} color={c.white} />
              )}
              <Text style={styles.btnTextWhite}>
                {savingSection === 'appearance' ? 'Saving...' : 'Save Appearance'}
              </Text>
            </View>
          </Button>
        </CardContent>
      </Card>

      {/* Notification Preferences */}
      <Card>
        <CardHeader>
          <View style={styles.titleRow}>
            <Bell size={20} color={c.orange600} />
            <CardTitle>Notification Preferences</CardTitle>
          </View>
          <CardDescription>Choose what notifications you receive</CardDescription>
        </CardHeader>
        <CardContent style={styles.gap4}>
          <ToggleRow
            styles={styles}
            label="Task Notifications"
            description="Get notified about new and updated tasks"
            value={taskNotifications}
            onValueChange={(value) => setLocal({ taskNotifications: value })}
          />
          <ToggleRow
            styles={styles}
            label="Referral Notifications"
            description="Receive patient referral alerts"
            value={handoverNotifications}
            onValueChange={(value) => setLocal({ handoverNotifications: value })}
          />
          <ToggleRow
            styles={styles}
            label="Critical Patient Alerts"
            description="Urgent notifications for critical patients"
            value={criticalAlerts}
            onValueChange={(value) => setLocal({ criticalAlerts: value })}
          />
          <ToggleRow
            styles={styles}
            label="Email Notifications"
            description="Send notifications to your email"
            value={emailNotifications}
            onValueChange={(value) => setLocal({ emailNotifications: value })}
          />
          <ToggleRow
            styles={styles}
            label="Sound Alerts"
            description="Play sound for notifications"
            value={soundAlerts}
            onValueChange={(value) => setLocal({ soundAlerts: value })}
            showSeparator={false}
          />

          <Button
            onPress={handleSaveNotifications}
            // Disabled until the account's real settings have arrived, so a
            // nurse cannot save defaults over what they already had.
            disabled={preferencesLoading || savingSection !== null}
            style={{ backgroundColor: c.orange600 }}
          >
            <View style={styles.btnInner}>
              {savingSection === 'notifications' ? (
                <ActivityIndicator size="small" color={c.white} />
              ) : (
                <Save size={16} color={c.white} />
              )}
              <Text style={styles.btnTextWhite}>
                {savingSection === 'notifications' ? 'Saving...' : 'Save Notifications'}
              </Text>
            </View>
          </Button>
        </CardContent>
      </Card>

      {/* System Preferences */}
      <Card>
        <CardHeader>
          <View style={styles.titleRow}>
            <SettingsIcon size={20} color={c.green600} />
            <CardTitle>System Preferences</CardTitle>
          </View>
          <CardDescription>Configure system behavior</CardDescription>
        </CardHeader>
        <CardContent style={styles.gap4}>
          <ToggleRow
            styles={styles}
            label="Auto-Refresh Data"
            description="Automatically update data every 30 seconds"
            value={autoRefresh}
            onValueChange={(value) => setLocal({ autoRefresh: value })}
          />
          <ToggleRow
            styles={styles}
            label="Show Charts & Graphs"
            description="Display visual data analytics"
            value={showCharts}
            onValueChange={(value) => setLocal({ showCharts: value })}
          />
          <ToggleRow
            styles={styles}
            label="Background Data Sync"
            description="Sync data in the background"
            value={backgroundSync}
            onValueChange={(value) => setLocal({ backgroundSync: value })}
            showSeparator={false}
          />

          <Button
            onPress={handleSavePreferences}
            // Disabled until the account's real settings have arrived, so a
            // nurse cannot save defaults over what they already had.
            disabled={preferencesLoading || savingSection !== null}
            style={{ backgroundColor: c.green600 }}
          >
            <View style={styles.btnInner}>
              {savingSection === 'system' ? (
                <ActivityIndicator size="small" color={c.white} />
              ) : (
                <Save size={16} color={c.white} />
              )}
              <Text style={styles.btnTextWhite}>
                {savingSection === 'system' ? 'Saving...' : 'Save Preferences'}
              </Text>
            </View>
          </Button>
        </CardContent>
      </Card>

      {/* Security & Privacy */}
      <Card>
        <CardHeader>
          <View style={styles.titleRow}>
            <Shield size={20} color={c.red600} />
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
              <KeyRound size={16} color={c.foreground} />
              <Text style={styles.btnTextDark}>Change Password</Text>
            </View>
          </Button>

          <View style={styles.logoutCard}>
            <Text style={styles.logoutTitle}>Account Actions</Text>
            <Button
              onPress={() => setShowLogoutDialog(true)}
              variant="destructive"
              style={{ backgroundColor: c.red600 }}
            >
              <View style={styles.btnInner}>
                <LogOut size={16} color={c.white} />
                <Text style={styles.btnTextWhite}>Logout</Text>
              </View>
            </Button>
          </View>
        </CardContent>
      </Card>

      {/* System Info Footer */}
      <View style={styles.systemInfo}>
        <View style={styles.systemInfoHeader}>
          <Info size={16} color={c.mutedForeground} />
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

/**
 * Built per theme rather than once at import.
 *
 * StyleSheet.create resolves the moment a module loads, so a stylesheet written
 * at the top of the file captures the startup colours and can never change.
 * Taking the palette and the two scales as arguments is what lets Dark Mode,
 * Font Size and Compact View actually take effect on this screen.
 */
const createStyles = (c: typeof Colors, scale: (n: number) => number, space: (n: number) => number) =>
  StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: c.background,
  },
  content: {
    padding: space(16),
    paddingBottom: space(40),
    gap: space(24),
    maxWidth: 896,
    width: '100%',
    alignSelf: 'center',
  },
  pageTitle: {
    fontSize: scale(24),
    fontWeight: '700',
    color: c.gray900,
  },
  pageSubtitle: {
    fontSize: scale(14),
    color: c.gray600,
    marginTop: space(2),
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(8),
  },
  gap4: { gap: space(16) },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(16),
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 4,
    borderColor: c.blue200,
  },
  avatarFallback: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: c.blue100,
    borderWidth: 4,
    borderColor: c.blue200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileName: {
    fontSize: scale(16),
    fontWeight: '600',
    color: c.gray900,
  },
  profileMeta: {
    fontSize: scale(13),
    color: c.gray600,
    marginTop: space(2),
  },
  profileEmail: {
    fontSize: scale(12),
    color: c.blue600,
    marginTop: space(4),
  },
  roleBox: {
    padding: space(12),
    backgroundColor: c.blue50,
    borderRadius: Radius.lg,
    gap: space(4),
  },
  roleText: {
    fontSize: scale(13),
    color: c.gray700,
  },
  roleBold: {
    fontWeight: '700',
  },
  roleHint: {
    fontSize: scale(11),
    color: c.gray600,
    marginTop: space(2),
  },
  separator: {
    height: 1,
    backgroundColor: c.border,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space(12),
    paddingVertical: space(4),
  },
  toggleText: {
    flex: 1,
    gap: space(2),
  },
  toggleLabel: {
    fontSize: scale(15),
    fontWeight: '500',
    color: c.foreground,
  },
  toggleDesc: {
    fontSize: scale(13),
    color: c.gray600,
    lineHeight: scale(18),
  },
  btnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(8),
  },
  btnTextWhite: {
    color: c.white,
    fontWeight: '600',
    fontSize: scale(14),
  },
  btnTextDark: {
    color: c.foreground,
    fontWeight: '600',
    fontSize: scale(14),
  },
  passwordBtn: {
    borderWidth: 1,
  },
  logoutCard: {
    padding: space(16),
    backgroundColor: c.red50,
    borderWidth: 1,
    borderColor: c.red200,
    borderRadius: Radius.lg,
    gap: space(12),
  },
  logoutTitle: {
    fontSize: scale(14),
    fontWeight: '600',
    color: c.red700,
  },
  systemInfo: {
    alignItems: 'center',
    paddingVertical: space(16),
    paddingHorizontal: space(12),
    gap: space(4),
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  systemInfoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(6),
    marginBottom: space(6),
  },
  systemInfoTitle: {
    fontSize: scale(13),
    fontWeight: '600',
    color: c.mutedForeground,
  },
  systemInfoLine: {
    fontSize: scale(12),
    color: c.gray500,
  },
  systemInfoCopy: {
    fontSize: scale(11),
    color: c.gray500,
    marginTop: space(8),
    textAlign: 'center',
  },
  });
