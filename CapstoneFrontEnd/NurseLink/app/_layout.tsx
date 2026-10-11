import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { ToastProvider } from '../contexts/ToastContext';
import { LiveProvider } from '../contexts/LiveContext';
import { RealtimeProvider } from '../contexts/RealtimeContext';
import { PreferencesProvider } from '../contexts/PreferencesContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import { NotificationsProvider } from '../contexts/NotificationsContext';
import SplashScreen from '../components/SplashScreen';
import { AppErrorBoundary } from '../components/AppErrorBoundary';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet, Platform } from 'react-native';

// react-native-gifted-charts (still on its latest release, 1.4.78) forwards
// native-only Pressable handlers straight onto react-native-svg's web nodes
// for its interactive chart points — react-native-web logs that as a
// console.error on every chart render. Harmless on native (LogBox never even
// sees it) and doesn't affect chart interactivity on web; only the dev
// overlay is muted, and only for this exact upstream warning.
if (Platform.OS === 'web') {
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    const joined = args
      .map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : ''))
      .join(' ');
    if (joined.includes('Unknown event handler property')) {
      return;
    }
    originalConsoleError(...args);
  };
}

function RootNavigator() {
  const [showSplash, setShowSplash] = useState(true);
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (showSplash || isLoading) return;

    const first = segments[0];
    const onPublicAuthFlow =
      first === 'login' || first === 'signup' || first === 'pending-approval';

    if (isAuthenticated) {
      if (first === 'pending-approval') return;
      if (first !== '(app)') {
        router.replace('/(app)/dashboard' as any);
      }
      return;
    }

    if (!onPublicAuthFlow) {
      router.replace('/login');
    }
  }, [showSplash, isLoading, isAuthenticated, segments, router]);

  if (showSplash) {
    return <SplashScreen onComplete={() => setShowSplash(false)} />;
  }

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="signup" />
        <Stack.Screen name="pending-approval" />
        <Stack.Screen name="(app)" />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <AppErrorBoundary>
        <ToastProvider>
          <AuthProvider>
            <PreferencesProvider>
              <ThemeProvider>
                <RealtimeProvider>
                  <LiveProvider>
                    <NotificationsProvider>
                      <RootNavigator />
                    </NotificationsProvider>
                  </LiveProvider>
                </RealtimeProvider>
              </ThemeProvider>
            </PreferencesProvider>
          </AuthProvider>
        </ToastProvider>
      </AppErrorBoundary>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
