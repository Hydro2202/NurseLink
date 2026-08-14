import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  Pressable,
  ScrollView,
  Modal,
  useWindowDimensions,
  ActivityIndicator,
} from 'react-native';
import { Slot, useRouter, usePathname } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  LayoutDashboard,
  ClipboardList,
  FileText,
  BarChart3,
  Settings,
  LogOut,
  Bell,
  User,
  Menu,
  X,
  BookOpen,
  Users,
  type LucideIcon,
} from 'lucide-react-native';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { NotificationPanel } from '../../components/NotificationPanel';
import { BottomNavigation } from '../../components/BottomNavigation';
import { Colors, Shadows, Radius } from '../../constants/colors';
import { fetchNotifications } from '../../services/api';

interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  show: boolean;
}

function normalizePath(path: string): string {
  return path.replace(/^\/\(app\)/, '') || '/';
}

function pathMatches(pathname: string, href: string): boolean {
  const active = normalizePath(pathname);
  const target = normalizePath(href);
  return active === target || active.startsWith(target + '/');
}

function ProfileMenu({
  visible,
  onClose,
  userName,
  userEmail,
  userDepartment,
  onSettings,
  onLogout,
}: {
  visible: boolean;
  onClose: () => void;
  userName?: string;
  userEmail?: string;
  userDepartment?: string;
  onSettings: () => void;
  onLogout: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.menuBackdrop} onPress={onClose}>
        <Pressable
          style={[styles.menuSheet, Shadows.xl]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.menuHeader}>
            <Text style={styles.menuName}>{userName}</Text>
            <Text style={styles.menuEmail}>{userEmail}</Text>
            <Text style={styles.menuDept}>{userDepartment}</Text>
          </View>
          <View style={styles.menuDivider} />
          <Pressable
            style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
            onPress={() => {
              onClose();
              onSettings();
            }}
          >
            <Settings size={16} color={Colors.blue600} />
            <Text style={styles.menuItemText}>Settings</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.menuItem, pressed && styles.menuLogoutPressed]}
            onPress={() => {
              onClose();
              onLogout();
            }}
          >
            <LogOut size={16} color={Colors.red600} />
            <Text style={styles.menuLogoutText}>Logout</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function NotificationBell({
  onPress,
  unreadCount,
}: {
  onPress: () => void;
  unreadCount: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
      accessibilityLabel="Open notifications"
    >
      <Bell size={18} color={Colors.blue600} />
      {unreadCount > 0 ? (
        <View style={styles.bellBadge}>
          <Text style={styles.bellBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function ProfileAvatar({
  avatar,
  size = 28,
  onPress,
}: {
  avatar?: string;
  size?: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
      accessibilityLabel="Open profile menu"
    >
      {avatar ? (
        <Image
          source={{ uri: avatar }}
          style={{ width: size, height: size, borderRadius: 8 }}
        />
      ) : (
        <View
          style={[
            styles.avatarFallback,
            { width: size, height: size, borderRadius: size * 0.28 },
          ]}
        >
          <User size={size * 0.55} color={Colors.white} />
        </View>
      )}
    </Pressable>
  );
}

export default function AppLayout() {
  const { user, logout, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;

  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/login' as any);
    }
  }, [user, isLoading, router]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchNotifications();
        if (!cancelled) setUnreadCount(data.unreadCount);
      } catch {
        // ignore badge errors
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={Colors.blue600} />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  if (!user) {
    return null;
  }

  const isStaffNurse = user.role === 'staff_nurse';
  const isSupervisor = user.role === 'supervisor';

  const handleLogout = () => {
    setShowLogoutDialog(false);
    logout();
    router.replace('/login' as any);
  };

  const navigation: NavItem[] = [
    { name: 'Dashboard', href: '/(app)/dashboard', icon: LayoutDashboard, show: true },
    { name: 'Tasks', href: '/(app)/tasks', icon: ClipboardList, show: isStaffNurse },
    { name: 'Handover', href: '/(app)/handover', icon: FileText, show: isStaffNurse },
    { name: 'Charting', href: '/(app)/charting', icon: FileText, show: isStaffNurse },
    { name: 'Kardex', href: '/(app)/kardex', icon: BookOpen, show: isStaffNurse },
    { name: 'All Patients', href: '/(app)/all-patients', icon: Users, show: isSupervisor },
    { name: 'Analytics', href: '/(app)/analytics', icon: BarChart3, show: isSupervisor },
    { name: 'Workload Monitor', href: '/(app)/workload', icon: BarChart3, show: isSupervisor },
    { name: 'Settings', href: '/(app)/settings', icon: Settings, show: true },
  ].filter((item) => item.show);

  const currentPageName =
    navigation.find((item) => pathMatches(pathname, item.href))?.name || 'Dashboard';

  const portalName = isStaffNurse ? 'Staff Portal' : isSupervisor ? 'Supervisor Portal' : 'Management Portal';
  const desktopPortalName = isStaffNurse ? 'Staff Portal' : 'Management Portal';

  const goSettings = () => router.push('/(app)/settings' as any);

  const logoutDialog = (
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
  );

  const notificationPanel = (
    <NotificationPanel
      isOpen={notificationPanelOpen}
      onClose={() => setNotificationPanelOpen(false)}
      onUnreadChange={setUnreadCount}
    />
  );

  const profileMenu = (
    <ProfileMenu
      visible={profileMenuOpen}
      onClose={() => setProfileMenuOpen(false)}
      userName={user.name}
      userEmail={user.email}
      userDepartment={user.department}
      onSettings={goSettings}
      onLogout={() => setShowLogoutDialog(true)}
    />
  );

  // Mobile: Staff Nurse
  if (isStaffNurse && !isDesktop) {
    return (
      <SafeAreaView style={styles.mobileRoot} edges={['top']}>
        <View style={[styles.mobileHeader, Shadows.md]}>
          <View style={styles.brandPill}>
            <View style={styles.brandLogoWrap}>
              <Image
                source={require('../../assets/images/NurseLinkLogo.png')}
                style={styles.brandLogo}
                resizeMode="contain"
              />
            </View>
            <View>
              <Text style={styles.brandTitle}>NurseLink</Text>
              <Text style={styles.brandSub}>{portalName}</Text>
            </View>
          </View>
          <View style={styles.headerActions}>
            <NotificationBell unreadCount={unreadCount} onPress={() => setNotificationPanelOpen(true)} />
            <ProfileAvatar avatar={user.avatar} onPress={() => setProfileMenuOpen(true)} />
          </View>
        </View>

        <View style={styles.mobileMain}>
          <Slot />
        </View>

        <BottomNavigation role="staff_nurse" activePath={pathname} />
        {logoutDialog}
        {notificationPanel}
        {profileMenu}
      </SafeAreaView>
    );
  }

  // Mobile: Supervisor
  if (isSupervisor && !isDesktop) {
    return (
      <SafeAreaView style={styles.mobileRoot} edges={['top']}>
        <View style={[styles.supervisorHeader, Shadows.lg]}>
          <View style={styles.supervisorBrand}>
            <View style={styles.supervisorLogoCircle}>
              <Image
                source={require('../../assets/images/NurseLinkLogo.png')}
                style={styles.supervisorLogo}
                resizeMode="contain"
              />
            </View>
            <View>
              <Text style={styles.supervisorTitle}>NurseLink</Text>
              <Text style={styles.supervisorSub}>{portalName}</Text>
            </View>
          </View>
          <View style={styles.headerActions}>
            <NotificationBell unreadCount={unreadCount} onPress={() => setNotificationPanelOpen(true)} />
            <ProfileAvatar
              avatar={user.avatar}
              size={36}
              onPress={() => setProfileMenuOpen(true)}
            />
          </View>
        </View>

        <View style={styles.mobileMain}>
          <Slot />
        </View>

        <BottomNavigation role="supervisor" activePath={pathname} />
        {logoutDialog}
        {notificationPanel}
        {profileMenu}
      </SafeAreaView>
    );
  }

  // Desktop / tablet (>= 1024)
  return (
    <SafeAreaView style={styles.desktopRoot} edges={['top', 'left', 'right']}>
      <View style={styles.desktopRow}>
        {(sidebarOpen || isDesktop) && (
          <View style={[styles.sidebar, !isDesktop && styles.sidebarOverlay, Shadows.xl]}>
            <View style={styles.sidebarLogo}>
              <View style={styles.sidebarLogoBox}>
                <Image
                  source={require('../../assets/images/NurseLinkLogo.png')}
                  style={styles.sidebarLogoImg}
                  resizeMode="contain"
                />
              </View>
              <View>
                <Text style={styles.sidebarBrand}>NurseLink</Text>
                <Text style={styles.sidebarPortal}>{desktopPortalName}</Text>
              </View>
              {!isDesktop ? (
                <Pressable
                  onPress={() => setSidebarOpen(false)}
                  style={styles.sidebarClose}
                  accessibilityLabel="Close sidebar"
                >
                  <X size={20} color={Colors.blue600} />
                </Pressable>
              ) : null}
            </View>

            <ScrollView style={styles.sidebarNav} contentContainerStyle={styles.sidebarNavContent}>
              {navigation.map((item) => {
                const Icon = item.icon;
                const active = pathMatches(pathname, item.href);
                return (
                  <Pressable
                    key={item.name}
                    onPress={() => {
                      router.push(item.href as any);
                      if (!isDesktop) setSidebarOpen(false);
                    }}
                    style={[styles.navLink, active && styles.navLinkActive]}
                  >
                    <Icon size={20} color={active ? Colors.white : Colors.blue700} />
                    <Text style={[styles.navLinkText, active && styles.navLinkTextActive]}>
                      {item.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={styles.sidebarFooter}>
              <View style={styles.sidebarUser}>
                {user.avatar ? (
                  <Image source={{ uri: user.avatar }} style={styles.sidebarAvatar} />
                ) : (
                  <View style={styles.sidebarAvatarFallback}>
                    <User size={22} color={Colors.white} />
                  </View>
                )}
                <View style={styles.sidebarUserInfo}>
                  <Text style={styles.sidebarUserName} numberOfLines={1}>
                    {user.name}
                  </Text>
                  <Text style={styles.sidebarUserDept} numberOfLines={1}>
                    {user.department}
                  </Text>
                </View>
              </View>
              <Button
                onPress={() => setShowLogoutDialog(true)}
                style={styles.sidebarLogout}
                textStyle={styles.sidebarLogoutText}
              >
                <View style={styles.logoutInner}>
                  <LogOut size={18} color={Colors.white} />
                  <Text style={styles.sidebarLogoutText}>Logout</Text>
                </View>
              </Button>
            </View>
          </View>
        )}

        {!isDesktop && sidebarOpen ? (
          <Pressable style={styles.sidebarScrim} onPress={() => setSidebarOpen(false)} />
        ) : null}

        <View style={styles.desktopMain}>
          <View style={[styles.desktopHeader, Shadows.md]}>
            <View style={styles.desktopHeaderLeft}>
              {!isDesktop ? (
                <Pressable
                  onPress={() => setSidebarOpen(!sidebarOpen)}
                  style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
                >
                  {sidebarOpen ? (
                    <X size={20} color={Colors.blue600} />
                  ) : (
                    <Menu size={20} color={Colors.blue600} />
                  )}
                </Pressable>
              ) : null}
              <View>
                <Text style={styles.pageTitle}>{currentPageName}</Text>
                <Text style={styles.welcome}>Welcome back, {user.name}</Text>
              </View>
            </View>
            <View style={styles.headerActions}>
              <NotificationBell unreadCount={unreadCount} onPress={() => setNotificationPanelOpen(true)} />
              <ProfileAvatar
                avatar={user.avatar}
                size={36}
                onPress={() => setProfileMenuOpen(true)}
              />
            </View>
          </View>

          <View style={styles.desktopContent}>
            <Slot />
          </View>
        </View>
      </View>

      {logoutDialog}
      {notificationPanel}
      {profileMenu}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.gray50,
    gap: 12,
  },
  loadingText: {
    color: Colors.gray600,
    fontSize: 14,
  },

  mobileRoot: {
    flex: 1,
    backgroundColor: Colors.blue50,
  },
  mobileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: Colors.white,
    borderBottomWidth: 2,
    borderBottomColor: Colors.blue300,
    zIndex: 50,
  },
  brandPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.white,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    ...Shadows.sm,
  },
  brandLogoWrap: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandLogo: {
    width: 44,
    height: 44,
  },
  brandTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: Colors.blue600,
  },
  brandSub: {
    fontSize: 9,
    fontWeight: '600',
    color: Colors.blue500,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnPressed: {
    backgroundColor: Colors.blue100,
  },
  bellBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Colors.blue700,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  bellBadgeText: {
    color: Colors.white,
    fontSize: 9,
    fontWeight: '900',
  },
  avatarFallback: {
    backgroundColor: Colors.blue700,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mobileMain: {
    flex: 1,
    paddingBottom: 88,
  },

  supervisorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: Colors.white,
    borderBottomWidth: 4,
    borderBottomColor: Colors.blue300,
    zIndex: 50,
  },
  supervisorBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  supervisorLogoCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    ...Shadows.sm,
  },
  supervisorLogo: {
    width: '100%',
    height: '100%',
  },
  supervisorTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: Colors.blue800,
  },
  supervisorSub: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.blue600,
  },

  desktopRoot: {
    flex: 1,
    backgroundColor: Colors.blue50,
  },
  desktopRow: {
    flex: 1,
    flexDirection: 'row',
  },
  sidebar: {
    width: 256,
    backgroundColor: Colors.white,
    borderRightWidth: 4,
    borderRightColor: Colors.blue300,
    zIndex: 40,
  },
  sidebarOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
  },
  sidebarScrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.25)',
    zIndex: 30,
  },
  sidebarLogo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 18,
    borderBottomWidth: 4,
    borderBottomColor: Colors.blue300,
    backgroundColor: Colors.blue50,
  },
  sidebarLogoBox: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: Colors.white,
    padding: 8,
    ...Shadows.md,
  },
  sidebarLogoImg: {
    width: '100%',
    height: '100%',
  },
  sidebarBrand: {
    fontSize: 20,
    fontWeight: '900',
    color: Colors.blue800,
  },
  sidebarPortal: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.blue600,
  },
  sidebarClose: {
    marginLeft: 'auto',
    padding: 4,
  },
  sidebarNav: {
    flex: 1,
  },
  sidebarNavContent: {
    paddingHorizontal: 12,
    paddingVertical: 20,
    gap: 8,
  },
  navLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
  },
  navLinkActive: {
    backgroundColor: Colors.blue600,
    ...Shadows.md,
    transform: [{ scale: 1.02 }],
  },
  navLinkText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.blue700,
  },
  navLinkTextActive: {
    color: Colors.white,
    fontWeight: '900',
  },
  sidebarFooter: {
    borderTopWidth: 4,
    borderTopColor: Colors.blue300,
    padding: 16,
    gap: 12,
    backgroundColor: Colors.blue50,
  },
  sidebarUser: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    backgroundColor: Colors.blue100,
    borderRadius: 16,
  },
  sidebarAvatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
  },
  sidebarAvatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.blue700,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sidebarUserInfo: {
    flex: 1,
    minWidth: 0,
  },
  sidebarUserName: {
    fontSize: 14,
    fontWeight: '900',
    color: Colors.gray900,
  },
  sidebarUserDept: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.blue600,
  },
  sidebarLogout: {
    backgroundColor: Colors.red600,
    justifyContent: 'flex-start',
  },
  logoutInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sidebarLogoutText: {
    color: Colors.white,
    fontWeight: '900',
  },
  desktopMain: {
    flex: 1,
  },
  desktopHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 16,
    backgroundColor: Colors.white,
    borderBottomWidth: 4,
    borderBottomColor: Colors.blue300,
  },
  desktopHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  pageTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: Colors.blue800,
  },
  welcome: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.blue600,
  },
  desktopContent: {
    flex: 1,
    padding: 24,
  },

  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.2)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 56,
    paddingRight: 12,
  },
  menuSheet: {
    width: 256,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderColor: Colors.blue200,
    overflow: 'hidden',
  },
  menuHeader: {
    padding: 16,
    gap: 6,
  },
  menuName: {
    fontSize: 14,
    fontWeight: '900',
    color: Colors.gray900,
  },
  menuEmail: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.blue600,
  },
  menuDept: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.blue700,
  },
  menuDivider: {
    height: 1,
    backgroundColor: Colors.border,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  menuItemPressed: {
    backgroundColor: Colors.blue50,
  },
  menuItemText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.foreground,
  },
  menuLogoutPressed: {
    backgroundColor: Colors.red100,
  },
  menuLogoutText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.red600,
  },
});
