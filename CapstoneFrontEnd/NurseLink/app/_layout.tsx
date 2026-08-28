import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { ToastProvider } from '../contexts/ToastContext';
import { LiveProvider } from '../contexts/LiveContext';
import { RealtimeProvider } from '../contexts/RealtimeContext';
import { NotificationsProvider } from '../contexts/NotificationsContext';
import SplashScreen from '../components/SplashScreen';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';

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
  }, [showSplash, isLoading, isAuthenticated, segments]);

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
      <AuthProvider>
        <ToastProvider>
          <RealtimeProvider>
            <LiveProvider>
              <NotificationsProvider>
                <RootNavigator />
              </NotificationsProvider>
            </LiveProvider>
          </RealtimeProvider>
        </ToastProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
