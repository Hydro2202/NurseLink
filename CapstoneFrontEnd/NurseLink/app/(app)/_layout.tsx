import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  Pressable,
  ScrollView,
  Modal,
  Animated,
  Dimensions,
  useWindowDimensions,
  ActivityIndicator,
} from 'react-native';
import { Slot, useRouter, usePathname } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  LayoutDashboard,
  ClipboardList,
  FileText,
  Settings,
  LogOut,
  Bell,
  User,
  Menu,
  X,
  BookOpen,
  Users,
  Calendar,
  Stethoscope,
  ShieldCheck,
  IdCard,
  History,
  BarChart3,
  type LucideIcon,
} from 'lucide-react-native';
import { useAuth } from '../../contexts/AuthContext';
import { GlobalPatientSearch } from '../../components/GlobalPatientSearch';
import { useLive } from '../../contexts/LiveContext';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { NotificationPanel } from '../../components/NotificationPanel';
import { BottomNavigation } from '../../components/BottomNavigation';
import { Colors, Shadows, Radius } from '../../constants/colors';
import { useNotifications } from '../../contexts/NotificationsContext';
import { useTheme } from '../../contexts/ThemeContext';
import { HandoverAlertModal } from '../../components/HandoverAlertModal';
import { TaskDueAlertModal } from '../../components/TaskDueAlertModal';
import { ReferralDueAlertModal } from '../../components/ReferralDueAlertModal';
import { ProfileSyncListener } from '../../components/ProfileSyncListener';
import { NotificationToastHost } from '../../components/NotificationToastHost';

interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  show: boolean;
  /** Match only the exact path, never a sub-route prefix. Needed for
   * '/(app)/admin' — every other admin nav item lives under that same
   * path (/(app)/admin/accounts, etc.), so the default prefix match would
   * make Dashboard show "active" on every admin screen at once. */
  exact?: boolean;
}

function normalizePath(path: string): string {
  return path.replace(/^\/\(app\)/, '') || '/';
}

function pathMatches(pathname: string, href: string, exact?: boolean): boolean {
  const active = normalizePath(pathname);
  const target = normalizePath(href);
  if (exact) return active === target;
  return active === target || active.startsWith(target + '/');
}


/**
 * The themed stylesheet for this file.
 *
 * Several components here share one stylesheet, so they share one hook rather
 * than each rebuilding it. useMemo keyed on the theme means a render caused by
 * anything else reuses the same style objects.
 */
function useLayoutStyles() {
  const { colors, scale, space } = useTheme();
  return useMemo(() => createStyles(colors, scale, space), [colors, scale, space]);
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
  const styles = useLayoutStyles();
  const { colors: c } = useTheme();
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
            <Settings size={16} color={c.blue600} />
            <Text style={styles.menuItemText}>Settings</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.menuItem, pressed && styles.menuLogoutPressed]}
            onPress={() => {
              onClose();
              onLogout();
            }}
          >
            <LogOut size={16} color={c.red600} />
            <Text style={styles.menuLogoutText}>Logout</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * Head nurse's mobile nav — a slide-in drawer from a hamburger button,
 * replacing the bottom tab bar (which had to fit 7 items and overflowed on
 * phone width; see the "Mobile: Head Nurse" branch below). Staff nurse and
 * admin keep BottomNavigation exactly as before — this is head-nurse-only.
 */
const HN_MENU_WIDTH = Math.min(Dimensions.get('window').width * 0.8, 320);

function HeadNurseMobileMenu({
  isOpen,
  onClose,
  items,
  pathname,
  onNavigate,
  portalName,
}: {
  isOpen: boolean;
  onClose: () => void;
  items: NavItem[];
  pathname: string;
  onNavigate: (href: string) => void;
  portalName: string;
}) {
  const styles = useLayoutStyles();
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();
  const [slideAnim] = useState(() => new Animated.Value(-HN_MENU_WIDTH));
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    (() => {
      if (isOpen) {
        setVisible(true);
        slideAnim.setValue(-HN_MENU_WIDTH);
        Animated.timing(slideAnim, { toValue: 0, duration: 260, useNativeDriver: true }).start();
        return;
      }
      Animated.timing(slideAnim, { toValue: -HN_MENU_WIDTH, duration: 200, useNativeDriver: true }).start(
        ({ finished }) => {
          if (finished) setVisible(false);
        }
      );
    })();
  }, [isOpen, slideAnim]);

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.hnMenuRoot}>
        <Pressable style={styles.hnMenuBackdrop} onPress={onClose} />
        <Animated.View
          style={[
            styles.hnMenuPanel,
            {
              width: HN_MENU_WIDTH,
              paddingTop: insets.top,
              paddingBottom: insets.bottom,
              transform: [{ translateX: slideAnim }],
            },
            Shadows.xl,
          ]}
        >
          <View style={styles.hnMenuHeader}>
            <View>
              <Text style={styles.hnMenuTitle}>Menu</Text>
              <Text style={styles.hnMenuSubtitle}>{portalName}</Text>
            </View>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
              accessibilityRole="button"
              accessibilityLabel="Close menu"
              hitSlop={8}
            >
              <X size={20} color={c.gray600} />
            </Pressable>
          </View>
          <ScrollView style={styles.hnMenuList} showsVerticalScrollIndicator={false}>
            {items.map((item) => {
              const Icon = item.icon;
              const active = pathMatches(pathname, item.href, item.exact);
              return (
                <Pressable
                  key={item.name}
                  onPress={() => onNavigate(item.href)}
                  style={({ pressed }) => [
                    styles.hnMenuItem,
                    active && styles.hnMenuItemActive,
                    pressed && !active && styles.hnMenuItemPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Icon size={20} color={active ? c.blue700 : c.gray600} />
                  <Text style={[styles.hnMenuItemText, active && styles.hnMenuItemTextActive]}>
                    {item.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </Animated.View>
      </View>
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
  const styles = useLayoutStyles();
  const { colors: c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
      accessibilityLabel="Open notifications"
    >
      <Bell size={18} color={c.blue600} />
      {unreadCount > 0 ? (
        <View style={styles.bellBadge}>
          <Text style={styles.bellBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * Small, unobtrusive indicator for the live-poll safety net being unable to
 * reach the backend — see LiveContext's connectionStatus. Renders nothing
 * while connected, so it never adds visual noise to the normal case; no
 * popup, no dialog, just a quiet pill next to the bell that clears itself
 * the moment a poll succeeds again.
 */
function LiveStatusIndicator() {
  const styles = useLayoutStyles();
  const { connectionStatus } = useLive();
  if (connectionStatus === 'connected') return null;
  return (
    <View style={styles.liveOfflinePill} accessibilityLabel="Backend offline, retrying">
      <View style={styles.liveOfflineDot} />
      <Text style={styles.liveOfflineText}>Offline</Text>
    </View>
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
  const styles = useLayoutStyles();
  const { colors: c } = useTheme();
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
          <User size={size * 0.55} color={c.white} />
        </View>
      )}
    </Pressable>
  );
}

export default function AppLayout() {
  const styles = useLayoutStyles();
  const { colors: c } = useTheme();

  const { user, logout, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;

  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  // Head nurse mobile only — see HeadNurseMobileMenu.
  const [hnMenuOpen, setHnMenuOpen] = useState(false);
  // Live: the provider polls and refreshes on app focus, so the badge keeps
  // itself current instead of only reflecting whatever was true at mount.
  const { unreadCount } = useNotifications();

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/login' as any);
    }
  }, [user, isLoading, router]);

  // Login always lands on /(app)/dashboard (it has no way to know the role
  // ahead of the response) — an admin has no dashboard.tsx of their own, so
  // bounce them to their real home the moment that resolves. Also catches a
  // stray back-navigation into a nurse/head nurse screen from an admin
  // session.
  useEffect(() => {
    if (!isLoading && user?.role === 'admin' && normalizePath(pathname) === '/dashboard') {
      router.replace('/(app)/admin' as any);
    }
  }, [user, isLoading, pathname, router]);

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={c.blue600} />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  if (!user) {
    return null;
  }

  const isStaffNurse = user.role === 'staff_nurse';
  const isSupervisor = user.role === 'head_nurse';
  const isAdmin = user.role === 'admin';

  const handleLogout = async () => {
    setShowLogoutDialog(false);
    // Awaited: only navigate once the token is actually revoked and cleared,
    // so a reload right after logout cannot resume the session.
    await logout();
    router.replace('/login' as any);
  };

  const navigation: NavItem[] = [
    { name: 'Dashboard', href: '/(app)/dashboard', icon: LayoutDashboard, show: true },
    { name: 'Tasks', href: '/(app)/tasks', icon: ClipboardList, show: isStaffNurse },
    // Head nurses get a read-only oversight view of every endorsement — see
    // handover.tsx's isHeadNurse branch — never an approval gate, so this
    // is the same screen, not a separate one.
    { name: 'Endorsement', href: '/(app)/handover', icon: FileText, show: isStaffNurse || isSupervisor },
    { name: 'My Duty', href: '/(app)/my-duty', icon: Stethoscope, show: isStaffNurse },
    { name: 'Duty Roster', href: '/(app)/duty-roster', icon: Calendar, show: isSupervisor },
    { name: 'Charting', href: '/(app)/charting', icon: FileText, show: isStaffNurse },
    { name: 'Kardex', href: '/(app)/kardex', icon: BookOpen, show: isStaffNurse },
    { name: 'All Patients', href: '/(app)/all-patients', icon: Users, show: isSupervisor },
    // The one Analytics destination — stats, charts and workload all live on
    // this single page now (see analytics.tsx); /workload redirects here.
    { name: 'Analytics', href: '/(app)/analytics', icon: BarChart3, show: isSupervisor },
    { name: 'Settings', href: '/(app)/settings', icon: Settings, show: true },
  ].filter((item) => item.show);

  // Deliberately lean: the Admin dashboard itself is the hub (a
  // Django-admin-style index listing every section — Patients, Tasks,
  // Handovers, Charting, Duty, Kardex, Doctors, Departments...), so the
  // persistent nav only carries what's needed everywhere, not a copy of
  // every section link.
  const adminNavigation: NavItem[] = [
    { name: 'Dashboard', href: '/(app)/admin', icon: LayoutDashboard, show: true, exact: true },
    { name: 'Accounts', href: '/(app)/admin/accounts', icon: ShieldCheck, show: true },
    { name: 'Registrations', href: '/(app)/admin/registrations', icon: IdCard, show: true },
    { name: 'Audit Log', href: '/(app)/admin/audit-log', icon: History, show: true },
    { name: 'Settings', href: '/(app)/settings', icon: Settings, show: true },
  ].filter((item) => item.show);

  const activeNavigation = isAdmin ? adminNavigation : navigation;

  const currentPageName =
    activeNavigation.find((item) => pathMatches(pathname, item.href, item.exact))?.name
    || (isAdmin ? 'Admin Console' : 'Dashboard');

  const portalName = isStaffNurse
    ? 'Staff Portal'
    : isSupervisor
      ? 'Head Nurse Portal'
      : isAdmin
        ? 'Admin Console'
        : 'Management Portal';
  const desktopPortalName = isStaffNurse ? 'Staff Portal' : isAdmin ? 'Admin Console' : 'Management Portal';

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

  // Rendered in all three layouts (mobile staff, mobile head nurse, desktop):
  // a patient being handed to you must interrupt wherever you are.
  const handoverAlert = <HandoverAlertModal />;
  const taskDueAlert = <TaskDueAlertModal />;
  const referralDueAlert = <ReferralDueAlertModal />;
  const notificationToastHost = <NotificationToastHost />;
  // Same three-layout placement — invisible, just keeps this nurse's own
  // department/shift in sync after a head nurse reassigns them.
  const profileSync = <ProfileSyncListener />;

  const notificationPanel = (
    <NotificationPanel
      isOpen={notificationPanelOpen}
      onClose={() => setNotificationPanelOpen(false)}
    />
  );

  const profileMenu = (
    <ProfileMenu
      visible={profileMenuOpen}
      onClose={() => setProfileMenuOpen(false)}
      userName={user.name}
      userEmail={user.email}
      userDepartment={isAdmin ? 'System Administrator' : user.department}
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
              {/* nurselink-emblem.png is a tight crop of just the circular
                  mark from the original NurseLinkLogo.png lockup — that file
                  also bakes in the "NURSELINK" wordmark plus a lot of
                  transparent canvas around it, which made the mark render
                  tiny inside every small logo box here even at full
                  container size. The wordmark is redundant anyway since the
                  text below is already rendered separately. Same asset used
                  everywhere else in this file, below. */}
              <Image
                source={require('../../assets/images/nurselink-emblem.png')}
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
            <LiveStatusIndicator />
            <NotificationBell unreadCount={unreadCount} onPress={() => setNotificationPanelOpen(true)} />
            <ProfileAvatar avatar={user.avatar} onPress={() => setProfileMenuOpen(true)} />
          </View>
        </View>

        <View style={styles.mobileMain}>
          <Slot />
        </View>

        <BottomNavigation role="staff_nurse" activePath={pathname} />
        {logoutDialog}
        {handoverAlert}
        {taskDueAlert}
        {referralDueAlert}
        {notificationToastHost}
        {profileSync}
        {notificationPanel}
        {profileMenu}
      </SafeAreaView>
    );
  }

  // Mobile: Head Nurse — a hamburger-triggered slide-in menu instead of the
  // bottom tab bar. Head nurse has more sections (Dashboard, Endorsement, Duty
  // Roster, All Patients, Analytics, Workload, Settings) than fit a phone-
  // width tab bar without overflowing; see HeadNurseMobileMenu above. Staff
  // nurse (the branch just above) is untouched — still BottomNavigation.
  if (isSupervisor && !isDesktop) {
    return (
      <SafeAreaView style={styles.mobileRoot} edges={['top']}>
        <View style={[styles.supervisorHeader, Shadows.lg]}>
          <View style={styles.supervisorBrand}>
            <Pressable
              onPress={() => setHnMenuOpen(true)}
              style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
              accessibilityRole="button"
              accessibilityLabel="Open menu"
              hitSlop={8}
            >
              <Menu size={24} color={c.blue700} />
            </Pressable>
            <View style={styles.supervisorLogoCircle}>
              <Image
                source={require('../../assets/images/nurselink-emblem.png')}
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
            <LiveStatusIndicator />
            <NotificationBell unreadCount={unreadCount} onPress={() => setNotificationPanelOpen(true)} />
            <ProfileAvatar
              avatar={user.avatar}
              size={36}
              onPress={() => setProfileMenuOpen(true)}
            />
          </View>
        </View>

        <View style={[styles.mobileMain, styles.mobileMainNoTabBar]}>
          <Slot />
        </View>

        <HeadNurseMobileMenu
          isOpen={hnMenuOpen}
          onClose={() => setHnMenuOpen(false)}
          items={navigation}
          pathname={pathname}
          portalName={portalName}
          onNavigate={(href) => {
            setHnMenuOpen(false);
            router.push(href as any);
          }}
        />
        {logoutDialog}
        {handoverAlert}
        {taskDueAlert}
        {referralDueAlert}
        {notificationToastHost}
        {profileSync}
        {notificationPanel}
        {profileMenu}
      </SafeAreaView>
    );
  }

  // Mobile: Admin — same visual language as Staff/Head Nurse (same logo,
  // same blue chrome); only the nav content is admin-specific.
  if (isAdmin && !isDesktop) {
    return (
      <SafeAreaView style={styles.mobileRoot} edges={['top']}>
        <View style={[styles.mobileHeader, Shadows.md]}>
          <View style={styles.brandPill}>
            <View style={styles.brandLogoWrap}>
              <Image
                source={require('../../assets/images/nurselink-emblem.png')}
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
            <LiveStatusIndicator />
            <NotificationBell unreadCount={unreadCount} onPress={() => setNotificationPanelOpen(true)} />
            <ProfileAvatar avatar={user.avatar} onPress={() => setProfileMenuOpen(true)} />
          </View>
        </View>

        <View style={styles.mobileMain}>
          <Slot />
        </View>

        <BottomNavigation role="admin" activePath={pathname} />
        {logoutDialog}
        {handoverAlert}
        {taskDueAlert}
        {referralDueAlert}
        {notificationToastHost}
        {profileSync}
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
                  source={require('../../assets/images/nurselink-emblem.png')}
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
                  <X size={20} color={c.blue600} />
                </Pressable>
              ) : null}
            </View>

            <ScrollView style={styles.sidebarNav} contentContainerStyle={styles.sidebarNavContent}>
              {activeNavigation.map((item) => {
                const Icon = item.icon;
                const active = pathMatches(pathname, item.href, item.exact);
                return (
                  <Pressable
                    key={item.name}
                    onPress={() => {
                      router.push(item.href as any);
                      if (!isDesktop) setSidebarOpen(false);
                    }}
                    style={[styles.navLink, active && styles.navLinkActive]}
                  >
                    <Icon size={18} color={active ? NAV_ACTIVE_TEXT : NAV_TEXT} />
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
                    <Text style={styles.sidebarAvatarInitials}>{initialsOf(user.name)}</Text>
                  </View>
                )}
                <View style={styles.sidebarUserInfo}>
                  <Text style={styles.sidebarUserName} numberOfLines={1}>
                    {user.name}
                  </Text>
                  <Text style={styles.sidebarUserDept} numberOfLines={1}>
                    {isAdmin ? user.email : roleLabel(user.role)}
                  </Text>
                </View>
                {/* Opens the same logout confirm dialog as before. */}
                <Pressable
                  onPress={() => setShowLogoutDialog(true)}
                  style={({ pressed }) => [styles.sidebarLogout, pressed && styles.sidebarLogoutPressed]}
                  accessibilityLabel="Logout"
                  hitSlop={4}
                >
                  <LogOut size={18} color={LOGOUT_RED} />
                </Pressable>
              </View>
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
                    <X size={20} color={c.blue600} />
                  ) : (
                    <Menu size={20} color={c.blue600} />
                  )}
                </Pressable>
              ) : null}
              {/* All Patients has its own page header, so the bar does not
                  repeat the title there. */}
              {pathname.includes('all-patients') ? null : (
                <View>
                  <Text style={styles.pageTitle}>{currentPageName}</Text>
                  <Text style={pathname.includes('analytics') ? styles.pageSubtitle : styles.welcome}>
                    {pathname.includes('analytics')
                      ? 'Operations overview, clinical activity, and nurse workload.'
                      : `Welcome back, ${user.name}`}
                  </Text>
                </View>
              )}
              {/* Analytics shows this search inside the page, above its filters. */}
              {isSupervisor && !pathname.includes('analytics') ? <GlobalPatientSearch /> : null}
            </View>
            <View style={styles.headerActions}>
              <LiveStatusIndicator />
            <NotificationBell unreadCount={unreadCount} onPress={() => setNotificationPanelOpen(true)} />
              <ProfileAvatar
                avatar={user.avatar}
                size={36}
                onPress={() => setProfileMenuOpen(true)}
              />
              {isDesktop ? (
                <Pressable onPress={() => setProfileMenuOpen(true)} style={styles.headerIdentity}>
                  <Text style={styles.headerIdentityName} numberOfLines={1}>{user.name}</Text>
                  <Text style={styles.headerIdentityRole}>{roleLabel(user.role)}</Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          <View style={styles.desktopContent}>
            <Slot />
          </View>
        </View>
      </View>

      {logoutDialog}
      {handoverAlert}
      {taskDueAlert}
      {referralDueAlert}
      {notificationToastHost}
      {profileSync}
      {notificationPanel}
      {profileMenu}
    </SafeAreaView>
  );
}

/**
 * Built per theme rather than once at import — see ThemeContext for why a
 * module-scope StyleSheet can never respond to a settings change.
 */
// One divider and one header height for every portal (nurse, head nurse,
// admin) so the sidebar's logo block and the top header end on the same line,
// and every separator is the same weight and color.
const DESKTOP_HEADER_HEIGHT = 88;
const DIVIDER_WIDTH = 1;
// Outer inset shared by the sidebar's logo, nav and footer blocks.
const SIDEBAR_GUTTER = 16;
// "Clean & light" chrome: white sidebar/top bar on a pale page, soft borders.
const PAGE_BG = '#F4F6FB';
const CHROME_BORDER = '#E3E8F0';
const MUTED_TEXT = '#5B6B82';
const NAV_TEXT = '#334155';
const NAV_ACTIVE_BG = '#EAF0FF';
const NAV_ACTIVE_TEXT = '#1D4ED8';
const LOGOUT_RED = '#B91C1C';

function roleLabel(role: string | undefined): string {
  if (role === 'head_nurse') return 'Head Nurse';
  if (role === 'admin') return 'Administrator';
  return 'Staff Nurse';
}

function initialsOf(name: string | undefined): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

const createStyles = (c: typeof Colors, scale: (n: number) => number, space: (n: number) => number) =>
  StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.gray50,
    gap: space(12),
  },
  loadingText: {
    color: c.gray600,
    fontSize: scale(14),
  },

  mobileRoot: {
    flex: 1,
    backgroundColor: c.blue50,
  },
  mobileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space(12),
    paddingVertical: space(8),
    backgroundColor: c.white,
    borderBottomWidth: DIVIDER_WIDTH,
    borderBottomColor: c.blue200,
    zIndex: 50,
  },
  brandPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(8),
    backgroundColor: c.white,
    borderRadius: 16,
    paddingHorizontal: space(12),
    paddingVertical: space(6),
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
    fontSize: scale(14),
    fontWeight: '900',
    color: c.blue600,
  },
  brandSub: {
    fontSize: scale(9),
    fontWeight: '600',
    color: c.blue500,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(6),
  },
  liveOfflinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(4),
    paddingHorizontal: space(8),
    paddingVertical: space(4),
    borderRadius: 999,
    backgroundColor: c.orange50,
    borderWidth: 1,
    borderColor: c.orange300,
  },
  liveOfflineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: c.orange600,
  },
  liveOfflineText: {
    fontSize: scale(10.5),
    fontWeight: '700',
    color: c.orange700,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnPressed: {
    backgroundColor: c.blue100,
  },
  bellBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: c.blue700,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space(3),
  },
  bellBadgeText: {
    color: c.white,
    fontSize: scale(9),
    fontWeight: '900',
  },
  avatarFallback: {
    backgroundColor: c.blue700,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mobileMain: {
    flex: 1,
    paddingBottom: space(88),
  },
  // Head nurse has no bottom tab bar (see HeadNurseMobileMenu) — no need to
  // reserve space for one below the content.
  mobileMainNoTabBar: {
    paddingBottom: 0,
  },

  supervisorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space(16),
    paddingVertical: space(12),
    backgroundColor: c.white,
    borderBottomWidth: DIVIDER_WIDTH,
    borderBottomColor: c.blue200,
    zIndex: 50,
  },
  supervisorBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(12),
  },
  supervisorLogoCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: c.white,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space(8),
    ...Shadows.sm,
  },
  supervisorLogo: {
    width: '100%',
    height: '100%',
  },
  supervisorTitle: {
    fontSize: scale(20),
    fontWeight: '900',
    color: c.blue800,
  },
  supervisorSub: {
    fontSize: scale(12),
    fontWeight: '700',
    color: c.blue600,
  },

  hnMenuRoot: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  hnMenuBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  hnMenuPanel: {
    height: '100%',
    backgroundColor: c.white,
  },
  hnMenuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space(16),
    paddingVertical: space(12),
    borderBottomWidth: DIVIDER_WIDTH,
    borderBottomColor: c.blue200,
  },
  hnMenuTitle: {
    fontSize: scale(17),
    fontWeight: '800',
    color: c.blue900,
  },
  hnMenuSubtitle: {
    fontSize: scale(11),
    fontWeight: '600',
    color: c.blue600,
    marginTop: 1,
  },
  hnMenuList: {
    flex: 1,
    paddingHorizontal: space(10),
    paddingTop: space(10),
  },
  hnMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(14),
    paddingHorizontal: space(12),
    paddingVertical: space(13),
    borderRadius: 12,
    marginBottom: space(2),
  },
  hnMenuItemActive: {
    backgroundColor: c.blue50,
  },
  hnMenuItemPressed: {
    backgroundColor: c.gray50,
  },
  hnMenuItemText: {
    fontSize: scale(15),
    fontWeight: '600',
    color: c.gray700,
  },
  hnMenuItemTextActive: {
    color: c.blue700,
    fontWeight: '800',
  },

  desktopRoot: {
    flex: 1,
    backgroundColor: PAGE_BG,
  },
  desktopRow: {
    flex: 1,
    flexDirection: 'row',
  },
  sidebar: {
    width: 248,
    backgroundColor: c.white,
    borderRightWidth: DIVIDER_WIDTH,
    borderRightColor: CHROME_BORDER,
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
    gap: space(12),
    paddingHorizontal: SIDEBAR_GUTTER,
    // Same fixed height as desktopHeader: their bottom borders form one line.
    height: DESKTOP_HEADER_HEIGHT,
    borderBottomWidth: DIVIDER_WIDTH,
    borderBottomColor: CHROME_BORDER,
    backgroundColor: c.white,
  },
  sidebarLogoBox: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: c.white,
    padding: space(6),
    borderWidth: 1,
    borderColor: CHROME_BORDER,
  },
  sidebarLogoImg: {
    width: '100%',
    height: '100%',
  },
  sidebarBrand: {
    fontSize: scale(19),
    fontWeight: '800',
    color: c.blue800,
  },
  sidebarPortal: {
    fontSize: scale(12),
    fontWeight: '600',
    color: c.blue600,
  },
  sidebarClose: {
    marginLeft: 'auto',
    padding: space(4),
  },
  sidebarNav: {
    flex: 1,
  },
  sidebarNavContent: {
    paddingHorizontal: SIDEBAR_GUTTER,
    paddingVertical: space(16),
    gap: space(4),
  },
  navLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(12),
    paddingHorizontal: space(12),
    height: 44,
    borderRadius: 10,
  },
  navLinkActive: {
    backgroundColor: NAV_ACTIVE_BG,
  },
  navLinkText: {
    fontSize: scale(14),
    fontWeight: '600',
    color: NAV_TEXT,
  },
  navLinkTextActive: {
    color: NAV_ACTIVE_TEXT,
    fontWeight: '700',
  },
  sidebarFooter: {
    borderTopWidth: DIVIDER_WIDTH,
    borderTopColor: CHROME_BORDER,
    padding: SIDEBAR_GUTTER,
    backgroundColor: c.white,
  },
  sidebarUser: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(10),
    padding: space(10),
    borderWidth: 1,
    borderColor: CHROME_BORDER,
    borderRadius: 12,
  },
  sidebarAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  sidebarAvatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: NAV_ACTIVE_TEXT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sidebarAvatarInitials: {
    color: c.white,
    fontSize: scale(13),
    fontWeight: '800',
  },
  sidebarUserInfo: {
    flex: 1,
    minWidth: 0,
  },
  sidebarUserName: {
    fontSize: scale(13.5),
    fontWeight: '700',
    color: '#0F172A',
  },
  sidebarUserDept: {
    fontSize: scale(12),
    fontWeight: '500',
    color: MUTED_TEXT,
  },
  sidebarLogout: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  sidebarLogoutPressed: {
    backgroundColor: '#FEE2E2',
  },
  desktopMain: {
    flex: 1,
  },
  desktopHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space(24),
    // Fixed, matching sidebarLogo (see DESKTOP_HEADER_HEIGHT).
    height: DESKTOP_HEADER_HEIGHT,
    backgroundColor: c.white,
    borderBottomWidth: DIVIDER_WIDTH,
    borderBottomColor: CHROME_BORDER,
    // Above the page so the search results panel can overlap it.
    zIndex: 20,
  },
  desktopHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(16),
    flexShrink: 1,
  },
  pageTitle: {
    fontSize: scale(22),
    fontWeight: '900',
    color: c.blue800,
  },
  welcome: {
    fontSize: scale(13),
    fontWeight: '700',
    color: c.blue600,
  },
  pageSubtitle: {
    fontSize: scale(12.5),
    fontWeight: '500',
    color: '#64748B',
  },
  headerIdentity: { marginLeft: space(2), maxWidth: 170 },
  headerIdentityName: { fontSize: scale(13), fontWeight: '700', color: c.blue800 },
  headerIdentityRole: { fontSize: scale(11), color: '#64748B' },
  desktopContent: {
    flex: 1,
    // Every page pads its own content by 16, so 8 here puts page content at
    // the same 24px left edge as the header title above it.
    paddingHorizontal: 24 - 16,
    paddingTop: space(8),
  },

  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.2)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: space(56),
    paddingRight: 12,
  },
  menuSheet: {
    width: 256,
    backgroundColor: c.white,
    borderRadius: Radius.lg,
    borderWidth: DIVIDER_WIDTH,
    borderColor: c.blue200,
    overflow: 'hidden',
  },
  menuHeader: {
    padding: space(16),
    gap: space(6),
  },
  menuName: {
    fontSize: scale(14),
    fontWeight: '900',
    color: c.gray900,
  },
  menuEmail: {
    fontSize: scale(12),
    fontWeight: '600',
    color: c.blue600,
  },
  menuDept: {
    fontSize: scale(12),
    fontWeight: '600',
    color: c.blue700,
  },
  menuDivider: {
    height: 1,
    backgroundColor: c.border,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(8),
    paddingHorizontal: space(16),
    paddingVertical: space(14),
  },
  menuItemPressed: {
    backgroundColor: c.blue50,
  },
  menuItemText: {
    fontSize: scale(14),
    fontWeight: '600',
    color: c.foreground,
  },
  menuLogoutPressed: {
    backgroundColor: c.red100,
  },
  menuLogoutText: {
    fontSize: scale(14),
    fontWeight: '600',
    color: c.red600,
  },
  });
