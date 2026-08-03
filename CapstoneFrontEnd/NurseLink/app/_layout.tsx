import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { ToastProvider } from '../contexts/ToastContext';
import SplashScreen from '../components/SplashScreen';
import { initializeDefaultAssignments } from '../utils/patientAssignments';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';

function RootNavigator() {
  const [showSplash, setShowSplash] = useState(true);
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    initializeDefaultAssignments();
  }, []);

  useEffect(() => {
    if (showSplash || isLoading) return;
    if (isAuthenticated) {
      router.replace('/(app)/dashboard' as any);
    } else {
      router.replace('/login');
    }
  }, [showSplash, isLoading, isAuthenticated]);

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
          <RootNavigator />
        </ToastProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
