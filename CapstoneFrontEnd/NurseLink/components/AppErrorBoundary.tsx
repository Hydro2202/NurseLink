import React from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { AlertTriangle } from 'lucide-react-native';
import { Colors, Radius } from '../constants/colors';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last-resort safety net. Without this, any unhandled render-time error
 * anywhere in the tree unmounts the whole app to a blank white page with no
 * way back except the user figuring out to hard-reload themselves — the
 * worst possible failure mode in the middle of a live demo. This only ever
 * renders when something has already gone wrong elsewhere; it changes
 * nothing about normal operation.
 */
export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[AppErrorBoundary] caught', error, info.componentStack);
  }

  handleReload = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.reload();
      return;
    }
    // Native has no page to reload — clearing the error lets the tree
    // remount and try again from here.
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) {
      return this.props.children;
    }
    return (
      <View style={styles.root}>
        <AlertTriangle size={40} color={Colors.destructive} />
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.message}>
          An unexpected error occurred. Reloading usually fixes it.
        </Text>
        <Pressable style={styles.button} onPress={this.handleReload}>
          <Text style={styles.buttonText}>Reload</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.gray50,
    padding: 24,
    gap: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.foreground,
  },
  message: {
    fontSize: 14,
    color: Colors.mutedForeground,
    textAlign: 'center',
    maxWidth: 320,
  },
  button: {
    marginTop: 8,
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: Radius.md,
  },
  buttonText: {
    color: Colors.white,
    fontWeight: '700',
    fontSize: 15,
  },
});
