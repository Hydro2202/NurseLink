import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Pressable } from 'react-native';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react-native';
import { Colors, Shadows, Radius } from '../constants/colors';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
}

interface ToastContextType {
  toast: {
    success: (title: string, options?: { description?: string }) => void;
    error: (title: string, options?: { description?: string }) => void;
    info: (title: string, options?: { description?: string }) => void;
    warning: (title: string, options?: { description?: string }) => void;
  };
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (type: ToastType, title: string, description?: string) => {
      const id = Date.now().toString();
      setToasts((prev) => [...prev, { id, type, title, description }]);
      setTimeout(() => removeToast(id), 3500);
    },
    [removeToast]
  );

  const toast = {
    success: (title: string, options?: { description?: string }) =>
      addToast('success', title, options?.description),
    error: (title: string, options?: { description?: string }) =>
      addToast('error', title, options?.description),
    info: (title: string, options?: { description?: string }) =>
      addToast('info', title, options?.description),
    warning: (title: string, options?: { description?: string }) =>
      addToast('warning', title, options?.description),
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <View style={styles.container} pointerEvents="box-none">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => removeToast(t.id)} />
        ))}
      </View>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast: t, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const opacity = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }).start();
  }, [opacity]);

  const colors = {
    success: { bg: Colors.successLight, border: Colors.success, icon: Colors.success },
    error: { bg: Colors.destructiveLight, border: Colors.destructive, icon: Colors.destructive },
    info: { bg: Colors.infoLight, border: Colors.primary, icon: Colors.primary },
    warning: { bg: Colors.warningLight, border: Colors.warning, icon: Colors.warning },
  }[t.type];

  const Icon =
    t.type === 'success' ? CheckCircle : t.type === 'error' || t.type === 'warning' ? AlertCircle : Info;

  return (
    <Animated.View style={[styles.toast, { backgroundColor: colors.bg, borderLeftColor: colors.border, opacity }, Shadows.md]}>
      <Icon size={18} color={colors.icon} />
      <View style={styles.content}>
        <Text style={styles.title}>{t.title}</Text>
        {t.description ? <Text style={styles.desc}>{t.description}</Text> : null}
      </View>
      <Pressable onPress={onDismiss} hitSlop={8}>
        <X size={16} color={Colors.mutedForeground} />
      </Pressable>
    </Animated.View>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context.toast;
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 56,
    left: 16,
    right: 16,
    zIndex: 9999,
    gap: 8,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    borderRadius: Radius.md,
    borderLeftWidth: 4,
  },
  content: { flex: 1 },
  title: { fontSize: 14, fontWeight: '600', color: Colors.foreground },
  desc: { fontSize: 12, color: Colors.mutedForeground, marginTop: 2 },
});
