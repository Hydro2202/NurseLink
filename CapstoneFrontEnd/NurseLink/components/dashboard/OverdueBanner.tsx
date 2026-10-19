import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { AlertTriangle, ArrowRight } from 'lucide-react-native';
import { Colors, Radius } from '../../constants/colors';

interface OverdueBannerProps {
  count: number;
  message: string;
  /** Opens the Tasks page filtered to overdue tasks. */
  onView: () => void;
}

/**
 * "Urgent Attention Required" — overdue tasks, with a button that goes
 * straight to the overdue list. Shared by the nurse and head nurse dashboards.
 * Stacks the button under the text on narrow screens (flexWrap).
 */
export function OverdueBanner({ count, message, onView }: OverdueBannerProps) {
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <View style={styles.iconWrap}>
        <AlertTriangle size={18} color={Colors.red600} />
      </View>
      <View style={styles.text}>
        <Text style={styles.title}>Urgent Attention Required</Text>
        <Text style={styles.message}>{message}</Text>
      </View>
      <Pressable
        onPress={onView}
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        accessibilityRole="button"
        accessibilityLabel={`View ${count} overdue task${count === 1 ? '' : 's'}`}
      >
        <Text style={styles.buttonText}>View Overdue Tasks</Text>
        <ArrowRight size={15} color={Colors.white} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.red200,
    borderLeftWidth: 4,
    borderLeftColor: Colors.red600,
    backgroundColor: Colors.red50,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.red100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, minWidth: 200, gap: 2 },
  title: { fontSize: 14, fontWeight: '700', color: Colors.red700 },
  message: { fontSize: 13, color: Colors.gray700 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    height: 38,
    borderRadius: Radius.md,
    backgroundColor: Colors.red600,
  },
  buttonPressed: { opacity: 0.85 },
  buttonText: { fontSize: 13, fontWeight: '700', color: Colors.white },
});
