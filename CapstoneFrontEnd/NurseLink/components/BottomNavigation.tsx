import React from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  LayoutDashboard,
  ClipboardList,
  FileText,
  BookOpen,
  Users,
  BarChart3,
  Settings,
  Stethoscope,
  Calendar,
  type LucideIcon,
} from 'lucide-react-native';
import { Colors, Shadows } from '../constants/colors';

export type NavRole = 'staff_nurse' | 'supervisor';

interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  color: string;
}

// Kept in sync by hand with the sidebar's navItems in app/(app)/_layout.tsx —
// this is a *separate* list (mobile's bottom tab bar vs. the desktop
// sidebar), so a screen added to one does not automatically appear in the
// other. My Duty / Duty Roster were added to the sidebar without ever being
// added here, which is exactly why they were missing on mobile.
const STAFF_NAV: NavItem[] = [
  { name: 'Dashboard', href: '/(app)/dashboard', icon: LayoutDashboard, color: Colors.blue600 },
  { name: 'My Duty', href: '/(app)/my-duty', icon: Stethoscope, color: Colors.teal600 },
  { name: 'Tasks', href: '/(app)/tasks', icon: ClipboardList, color: Colors.green600 },
  { name: 'Handover', href: '/(app)/handover', icon: FileText, color: Colors.purple600 },
  { name: 'Charting', href: '/(app)/charting', icon: FileText, color: Colors.orange600 },
  { name: 'Kardex', href: '/(app)/kardex', icon: BookOpen, color: Colors.gray600 },
];

const SUPERVISOR_NAV: NavItem[] = [
  { name: 'Dashboard', href: '/(app)/dashboard', icon: LayoutDashboard, color: Colors.blue600 },
  { name: 'Duty Roster', href: '/(app)/duty-roster', icon: Calendar, color: Colors.teal600 },
  { name: 'Patients', href: '/(app)/all-patients', icon: Users, color: Colors.purple600 },
  { name: 'Analytics', href: '/(app)/analytics', icon: BarChart3, color: Colors.green600 },
  { name: 'Workload', href: '/(app)/workload', icon: BarChart3, color: Colors.orange600 },
  { name: 'Settings', href: '/(app)/settings', icon: Settings, color: Colors.gray600 },
];

interface BottomNavigationProps {
  role: NavRole;
  activePath: string;
}

function normalizePath(path: string): string {
  // Match both "/dashboard" and "/(app)/dashboard"
  return path.replace(/^\/\(app\)/, '') || '/';
}

function isActivePath(activePath: string, href: string): boolean {
  const active = normalizePath(activePath);
  const target = normalizePath(href);
  return active === target || active.startsWith(target + '/');
}

export function BottomNavigation({ role, activePath }: BottomNavigationProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const items = role === 'staff_nurse' ? STAFF_NAV : SUPERVISOR_NAV;

  return (
    <View
      style={[
        styles.nav,
        {
          paddingBottom: Math.max(insets.bottom, 8),
        },
        Shadows.xl,
      ]}
    >
      <View style={styles.row}>
        {items.map((item) => {
          const Icon = item.icon;
          const active = isActivePath(activePath, item.href);

          return (
            <Pressable
              key={item.name}
              onPress={() => router.push(item.href as any)}
              style={({ pressed }) => [
                styles.item,
                active && styles.itemActive,
                pressed && !active && styles.itemPressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={item.name}
            >
              <Icon size={24} color={item.color} />
              <Text style={[styles.label, { color: item.color }]} numberOfLines={1}>
                {item.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  nav: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.white,
    borderTopWidth: 2,
    borderTopColor: Colors.gray200,
    paddingTop: 8,
    paddingHorizontal: 4,
    zIndex: 50,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.12,
        shadowRadius: 12,
      },
      android: { elevation: 16 },
      default: {},
    }),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    maxWidth: 512,
    alignSelf: 'center',
    width: '100%',
  },
  item: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 16,
    minWidth: 60,
  },
  itemActive: {
    transform: [{ scale: 1.1 }, { translateY: -8 }],
  },
  itemPressed: {
    transform: [{ scale: 0.95 }],
  },
  label: {
    fontSize: 10,
    fontWeight: '900',
    textAlign: 'center',
    lineHeight: 12,
  },
});
