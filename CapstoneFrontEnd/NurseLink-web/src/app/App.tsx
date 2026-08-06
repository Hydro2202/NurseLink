import { RouterProvider } from 'react-router';
import { AuthProvider } from './contexts/AuthContext';
import { router } from './routes.tsx';
import { Toaster } from './components/ui/toaster';
import { Toaster as SonnerToaster } from 'sonner';
import { useEffect, useState } from 'react';
import SplashScreen from './components/SplashScreen';

export default function App() {
  const [showSplash, setShowSplash] = useState(true);

  // Clean up any dark mode preference left by earlier builds.
  useEffect(() => {
    localStorage.removeItem('nurselink_darkmode');
    document.documentElement.classList.remove('dark');
  }, []);

  if (showSplash) {
    return <SplashScreen onComplete={() => setShowSplash(false)} />;
  }

  return (
    <AuthProvider>
      <RouterProvider router={router} />
      <Toaster />
      <SonnerToaster position="top-right" richColors />
    </AuthProvider>
  );
}
