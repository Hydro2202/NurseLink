import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import { Switch } from '../components/ui/switch';
import { Separator } from '../components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import {
  User,
  Bell,
  Shield,
  LogOut,
  Palette,
  Settings as SettingsIcon,
  Camera,
  Save,
  KeyRound,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { PasswordChangeModal } from '../components/PasswordChangeModal';
import {
  ApiError,
  changePasswordRequest,
  fetchPreferences,
  updatePreferences,
  type UserPreferences,
} from '../api/nurselink';

/** Same defaults as mobile's PreferencesContext, used until the server
 * answers. emailNotifications has no Settings control anymore (removed —
 * email dispatch is still a real backend feature, see notifications.py),
 * but the UserPreferences type still carries it since GET /preferences/
 * still returns it; this placeholder is overwritten the moment the real
 * fetch resolves and is never written back from this page. */
const DEFAULT_PREFERENCES: UserPreferences = {
  fontSize: 'medium',
  compactView: false,
  taskNotifications: true,
  handoverNotifications: true,
  criticalAlerts: true,
  emailNotifications: false,
  soundAlerts: true,
  autoRefresh: true,
  showCharts: true,
  backgroundSync: true,
};

/** Which controls each Save button is responsible for (mirrors mobile). */
const SECTIONS = {
  appearance: ['fontSize', 'compactView'],
  notifications: [
    'taskNotifications',
    'handoverNotifications',
    'criticalAlerts',
    'soundAlerts',
  ],
  system: ['autoRefresh', 'showCharts', 'backgroundSync'],
} as const satisfies Record<string, readonly (keyof UserPreferences)[]>;

type SectionName = keyof typeof SECTIONS;

export default function SettingsPage() {
  const { user, logout, updateUser } = useAuth();
  const navigate = useNavigate();
  
  // Profile settings
  const [profileName, setProfileName] = useState(user?.name || '');
  const [profileEmail, setProfileEmail] = useState(user?.email || '');
  // Department and shift are head-nurse-assigned, not self-editable — read
  // straight from the account rather than tracked as editable form state.
  const profileDepartment = user?.department || '';
  const profileShift = user?.shift || '';
  const [profilePhoto, setProfilePhoto] = useState(user?.avatar || '');
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  
  const [showPasswordChange, setShowPasswordChange] = useState(false);

  // Every control below reads and writes the account's settings on the
  // server (GET/PATCH /preferences/), mirroring mobile. Toggling is local so a
  // nurse can change several things and press Save once; Save is what
  // actually persists them. Font size / compact view start from the
  // localStorage cache only to avoid a flash before the server answers.
  const [preferences, setPreferences] = useState<UserPreferences>(() => {
    const cachedFont = localStorage.getItem('nurselink_fontsize');
    return {
      ...DEFAULT_PREFERENCES,
      fontSize:
        cachedFont === 'small' || cachedFont === 'large' || cachedFont === 'medium'
          ? cachedFont
          : DEFAULT_PREFERENCES.fontSize,
      compactView: localStorage.getItem('nurselink_compactview') === 'true',
    };
  });
  const [preferencesLoading, setPreferencesLoading] = useState(true);
  const [savingSection, setSavingSection] = useState<SectionName | null>(null);

  const setLocal = (changes: Partial<UserPreferences>) =>
    setPreferences((prev) => ({ ...prev, ...changes }));

  const {
    fontSize,
    compactView,
    taskNotifications,
    handoverNotifications,
    criticalAlerts,
    soundAlerts,
    autoRefresh,
    showCharts,
    backgroundSync,
  } = preferences;

  // Load the account's real settings once per signed-in user.
  useEffect(() => {
    if (!user) {
      setPreferencesLoading(false);
      return;
    }
    let cancelled = false;
    setPreferencesLoading(true);
    fetchPreferences()
      .then((fromServer) => {
        if (!cancelled) setPreferences({ ...DEFAULT_PREFERENCES, ...fromServer });
      })
      .catch(() => {
        // Offline or the server is down: keep what we have rather than
        // resetting a nurse's settings to defaults in front of them.
      })
      .finally(() => {
        if (!cancelled) setPreferencesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Apply font size
  useEffect(() => {
    const root = document.documentElement;
    if (fontSize === 'small') {
      root.style.fontSize = '14px';
    } else if (fontSize === 'large') {
      root.style.fontSize = '18px';
    } else {
      root.style.fontSize = '16px';
    }
    localStorage.setItem('nurselink_fontsize', fontSize);
  }, [fontSize]);

  // Apply compact view
  useEffect(() => {
    if (compactView) {
      document.documentElement.classList.add('compact-view');
    } else {
      document.documentElement.classList.remove('compact-view');
    }
    localStorage.setItem('nurselink_compactview', compactView.toString());
  }, [compactView]);

  const saveSection = async (section: SectionName, successMessage: string) => {
    setSavingSection(section);
    try {
      // Send only this section's fields, so pressing one Save button cannot
      // overwrite unsaved edits sitting in another section.
      const changes: Partial<UserPreferences> = {};
      for (const key of SECTIONS[section]) {
        (changes as Record<string, unknown>)[key] = preferences[key];
      }
      const stored = await updatePreferences(changes);
      // Keep what the server stored for this section (not what we sent), but
      // leave other sections' unsaved local edits alone.
      const confirmed: Partial<UserPreferences> = {};
      for (const key of SECTIONS[section]) {
        if (stored && key in stored) {
          (confirmed as Record<string, unknown>)[key] = stored[key];
        }
      }
      setLocal(confirmed);
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
      // Rethrown so the dialog stays open instead of closing on a failure.
      throw error;
    }
  };

  const handleSaveProfile = () => {
    if (!profileName || !profileEmail) {
      toast.error('Please fill in all required fields');
      return;
    }

    updateUser({
      name: profileName,
      email: profileEmail,
      avatar: profilePhoto,
    });

    toast.success('Profile updated successfully!', {
      description: 'Your profile information has been saved.',
    });
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // In a real app, this would upload to a server
      const reader = new FileReader();
      reader.onloadend = () => {
        setProfilePhoto(reader.result as string);
        toast.success('Photo uploaded!', {
          description: 'Your profile photo has been updated.',
        });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="p-4 pb-24 space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Settings
        </h1>
        <p className="text-gray-600">
          Manage your account and preferences
        </p>
      </div>

      {/* Profile Information */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="w-5 h-5 text-blue-600" />
            Profile Information
          </CardTitle>
          <CardDescription>Update your personal information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Profile Photo */}
          <div className="flex items-center gap-4">
            <div className="relative">
              {profilePhoto ? (
                <img
                  src={profilePhoto}
                  alt="Profile"
                  className="w-24 h-24 rounded-full object-cover border-4 border-primary-light"
                />
              ) : (
                <div className="w-24 h-24 rounded-full bg-primary-light flex items-center justify-center border-4 border-primary-light">
                  <User className="w-12 h-12 text-primary" />
                </div>
              )}
              <label
                htmlFor="photo-upload"
                className="absolute bottom-0 right-0 bg-primary text-white p-2 rounded-full cursor-pointer hover:bg-primary-hover shadow-lg"
              >
                <Camera className="w-4 h-4" />
                <input
                  id="photo-upload"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handlePhotoUpload}
                />
              </label>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">
                {profileName}
              </h3>
              <p className="text-sm text-gray-600">
                {user?.role === 'staff_nurse' ? 'Nurse' : 'Head Nurse'}
              </p>
              <p className="text-sm text-gray-600">
                {profileDepartment}
              </p>
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Full Name</Label>
              <Input
                id="name"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                placeholder="Enter your full name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={profileEmail}
                onChange={(e) => setProfileEmail(e.target.value)}
                placeholder="Enter your email"
              />
            </div>

            <div className="p-3 bg-blue-50 rounded-lg space-y-1">
              <p className="text-sm text-gray-700">
                <strong>Role:</strong> {user?.role === 'staff_nurse' ? 'Nurse' : 'Head Nurse'}
              </p>
              <p className="text-sm text-gray-700">
                <strong>Department:</strong> {profileDepartment || '—'}
              </p>
              <p className="text-sm text-gray-700">
                <strong>Shift:</strong>{' '}
                {profileShift
                  ? profileShift.charAt(0).toUpperCase() + profileShift.slice(1)
                  : '—'}
              </p>
              <p className="text-xs mt-1 text-gray-600">
                Role, department and shift are set by your head nurse. Contact them for changes.
              </p>
            </div>

            <Button onClick={handleSaveProfile} className="w-full md:w-auto">
              <Save className="w-4 h-4 mr-2" />
              Save Profile
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Appearance Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="w-5 h-5 text-purple-600" />
            Appearance
          </CardTitle>
          <CardDescription>Customize how the app looks</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Font Size</Label>
            <Select
              value={fontSize}
              onValueChange={(value) =>
                setLocal({ fontSize: value as UserPreferences['fontSize'] })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="small">Small</SelectItem>
                <SelectItem value="medium">Medium (Default)</SelectItem>
                <SelectItem value="large">Large</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-base">Compact View</Label>
              <p className="text-sm text-gray-600">
                Reduce spacing between elements
              </p>
            </div>
            <Switch checked={compactView} onCheckedChange={(value) => setLocal({ compactView: value })} />
          </div>

          <Button
            onClick={handleSaveAppearance}
            className="w-full md:w-auto"
            // Disabled until the account's real settings have arrived, so a
            // nurse cannot save defaults over what they already had.
            disabled={preferencesLoading || savingSection !== null}
          >
            {savingSection === 'appearance' ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            {savingSection === 'appearance' ? 'Saving...' : 'Save Appearance'}
          </Button>
        </CardContent>
      </Card>

      {/* Notification Preferences */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-orange-600" />
            Notification Preferences
          </CardTitle>
          <CardDescription>Choose what notifications you receive</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-base">Task Notifications</Label>
              <p className="text-sm text-gray-600">
                Get notified about new and updated tasks
              </p>
            </div>
            <Switch checked={taskNotifications} onCheckedChange={(value) => setLocal({ taskNotifications: value })} />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-base">Endorsement Notifications</Label>
              <p className="text-sm text-gray-600">
                Receive endorsement alerts
              </p>
            </div>
            <Switch checked={handoverNotifications} onCheckedChange={(value) => setLocal({ handoverNotifications: value })} />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-base">Critical Patient Alerts</Label>
              <p className="text-sm text-gray-600">
                Urgent notifications for critical patients
              </p>
            </div>
            <Switch checked={criticalAlerts} onCheckedChange={(value) => setLocal({ criticalAlerts: value })} />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-base">Sound Alerts</Label>
              <p className="text-sm text-gray-600">
                Play sound for notifications
              </p>
            </div>
            <Switch
              checked={soundAlerts}
              onCheckedChange={(value) => setLocal({ soundAlerts: value })}
            />
          </div>

          <Button
            onClick={handleSaveNotifications}
            className="w-full md:w-auto"
            // Disabled until the account's real settings have arrived, so a
            // nurse cannot save defaults over what they already had.
            disabled={preferencesLoading || savingSection !== null}
          >
            {savingSection === 'notifications' ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            {savingSection === 'notifications' ? 'Saving...' : 'Save Notifications'}
          </Button>
        </CardContent>
      </Card>

      {/* System Preferences */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SettingsIcon className="w-5 h-5 text-green-600" />
            System Preferences
          </CardTitle>
          <CardDescription>Configure system behavior</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-base">Auto-Refresh Data</Label>
              <p className="text-sm text-gray-600">
                Automatically update data every 30 seconds
              </p>
            </div>
            <Switch checked={autoRefresh} onCheckedChange={(value) => setLocal({ autoRefresh: value })} />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-base">Show Charts & Graphs</Label>
              <p className="text-sm text-gray-600">
                Display visual data analytics
              </p>
            </div>
            <Switch checked={showCharts} onCheckedChange={(value) => setLocal({ showCharts: value })} />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-base">Background Data Sync</Label>
              <p className="text-sm text-gray-600">
                Sync data in the background
              </p>
            </div>
            <Switch
              checked={backgroundSync}
              onCheckedChange={(value) => setLocal({ backgroundSync: value })}
            />
          </div>

          <Button
            onClick={handleSavePreferences}
            className="w-full md:w-auto"
            // Disabled until the account's real settings have arrived, so a
            // nurse cannot save defaults over what they already had.
            disabled={preferencesLoading || savingSection !== null}
          >
            {savingSection === 'system' ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            {savingSection === 'system' ? 'Saving...' : 'Save Preferences'}
          </Button>
        </CardContent>
      </Card>

      {/* Security & Privacy */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-red-600" />
            Security & Privacy
          </CardTitle>
          <CardDescription>Manage your account security</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            variant="outline"
            className="w-full md:w-auto"
            onClick={() => setShowPasswordChange(true)}
          >
            <KeyRound className="w-4 h-4 mr-2" />
            Change Password
          </Button>

          <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
            <h4 className="font-semibold text-red-900 mb-2">Account Actions</h4>
            <Button
              onClick={() => setShowLogoutDialog(true)}
              variant="destructive"
              className="w-full md:w-auto"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Logout Confirmation Dialog */}
      <Dialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Logout</DialogTitle>
            <DialogDescription>
              Are you sure you want to log out? You will need to sign in again to access the system.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLogoutDialog(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleLogout}>
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Password Change Dialog */}
      <PasswordChangeModal
        open={showPasswordChange}
        onOpenChange={setShowPasswordChange}
        onSave={handlePasswordSave}
      />
    </div>
  );
}
