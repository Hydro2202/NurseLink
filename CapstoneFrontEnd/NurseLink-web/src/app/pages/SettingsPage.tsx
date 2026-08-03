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
} from 'lucide-react';
import { toast } from 'sonner';

export default function SettingsPage() {
  const { user, logout, updateUser } = useAuth();
  const navigate = useNavigate();
  
  // Profile settings
  const [profileName, setProfileName] = useState(user?.name || '');
  const [profileEmail, setProfileEmail] = useState(user?.email || '');
  const [profileDepartment, setProfileDepartment] = useState(user?.department || '');
  const [profilePhoto, setProfilePhoto] = useState(user?.avatar || '');
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  
  // Appearance settings
  const [fontSize, setFontSize] = useState(() => {
    return localStorage.getItem('nurselink_fontsize') || 'medium';
  });
  const [compactView, setCompactView] = useState(() => {
    const saved = localStorage.getItem('nurselink_compactview');
    return saved === 'true';
  });

  // Notification settings
  const [taskNotifications, setTaskNotifications] = useState(true);
  const [handoverNotifications, setHandoverNotifications] = useState(true);
  const [criticalAlerts, setCriticalAlerts] = useState(true);
  const [emailNotifications, setEmailNotifications] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);

  // System preferences
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showCharts, setShowCharts] = useState(true);
  const [dataSync, setDataSync] = useState(true);

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

  const handleSaveProfile = () => {
    if (!profileName || !profileEmail) {
      toast.error('Please fill in all required fields');
      return;
    }

    updateUser({
      name: profileName,
      email: profileEmail,
      department: profileDepartment,
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
                  className="w-24 h-24 rounded-full object-cover border-4 border-blue-200"
                />
              ) : (
                <div className="w-24 h-24 rounded-full bg-blue-100 flex items-center justify-center border-4 border-blue-200">
                  <User className="w-12 h-12 text-blue-600" />
                </div>
              )}
              <label
                htmlFor="photo-upload"
                className="absolute bottom-0 right-0 bg-blue-600 text-white p-2 rounded-full cursor-pointer hover:bg-blue-700 shadow-lg"
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
                {user?.role === 'staff_nurse' ? 'Nurse' : 'Supervisor'}
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

            <div className="space-y-2">
              <Label htmlFor="department">Department</Label>
              <Input
                id="department"
                value={profileDepartment}
                onChange={(e) => setProfileDepartment(e.target.value)}
                placeholder="Enter your department"
              />
            </div>

            <div className="p-3 bg-blue-50 rounded-lg">
              <p className="text-sm text-gray-700">
                <strong>Role:</strong> {user?.role === 'staff_nurse' ? 'Nurse' : 'Supervisor'}
              </p>
              <p className="text-xs mt-1 text-gray-600">
                Role cannot be changed. Contact your administrator for role updates.
              </p>
            </div>

            <Button onClick={handleSaveProfile} className="w-full bg-blue-600 hover:bg-blue-700">
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
            <Select value={fontSize} onValueChange={setFontSize}>
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
            <Switch checked={compactView} onCheckedChange={setCompactView} />
          </div>

          <Button onClick={handleSaveAppearance} className="w-full bg-purple-600 hover:bg-purple-700">
            <Save className="w-4 h-4 mr-2" />
            Save Appearance
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
            <Switch checked={taskNotifications} onCheckedChange={setTaskNotifications} />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-base">Handover Notifications</Label>
              <p className="text-sm text-gray-600">
                Receive shift handover alerts
              </p>
            </div>
            <Switch checked={handoverNotifications} onCheckedChange={setHandoverNotifications} />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-base">Critical Patient Alerts</Label>
              <p className="text-sm text-gray-600">
                Urgent notifications for critical patients
              </p>
            </div>
            <Switch checked={criticalAlerts} onCheckedChange={setCriticalAlerts} />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-base">Email Notifications</Label>
              <p className="text-sm text-gray-600">
                Send notifications to your email
              </p>
            </div>
            <Switch checked={emailNotifications} onCheckedChange={setEmailNotifications} />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-base">Sound Alerts</Label>
              <p className="text-sm text-gray-600">
                Play sound for notifications
              </p>
            </div>
            <Switch checked={soundEnabled} onCheckedChange={setSoundEnabled} />
          </div>

          <Button onClick={handleSaveNotifications} className="w-full bg-orange-600 hover:bg-orange-700">
            <Save className="w-4 h-4 mr-2" />
            Save Notifications
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
            <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-base">Show Charts & Graphs</Label>
              <p className="text-sm text-gray-600">
                Display visual data analytics
              </p>
            </div>
            <Switch checked={showCharts} onCheckedChange={setShowCharts} />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-base">Background Data Sync</Label>
              <p className="text-sm text-gray-600">
                Sync data in the background
              </p>
            </div>
            <Switch checked={dataSync} onCheckedChange={setDataSync} />
          </div>

          <Button onClick={handleSavePreferences} className="w-full bg-green-600 hover:bg-green-700">
            <Save className="w-4 h-4 mr-2" />
            Save Preferences
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
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
            <h4 className="font-semibold text-red-900 mb-2">Account Actions</h4>
            <Button
              onClick={() => setShowLogoutDialog(true)}
              variant="destructive"
              className="w-full"
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
    </div>
  );
}
