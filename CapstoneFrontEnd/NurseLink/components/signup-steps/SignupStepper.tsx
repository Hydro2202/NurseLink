import React from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import { CheckCircle2 } from 'lucide-react-native';
import { Colors } from '../../constants/colors';

export type SignupStepNumber = 1 | 2 | 3 | 4;

const STEP_LABELS = ['Personal Info', 'Role', 'Verification', 'Credentials'];
// Shown instead of the full label on a narrow phone, where four full words
// plus connectors would overflow the screen width — the same class of
// mobile-overflow bug just fixed app-wide for icon+text rows (see
// components/Button.tsx's `row` style, which this component follows the
// same minWidth:0/flexShrink convention from). Responsive via
// useWindowDimensions, matching the pattern used throughout
// app/(app)/_layout.tsx rather than a CSS media query.
const STEP_LABELS_NARROW = ['Info', 'Role', 'Verify', 'Login'];

const STEP_LABELS_LENGTH = STEP_LABELS.length;

interface SignupStepperProps {
  current: SignupStepNumber;
}

/**
 * Visual step indicator for the 4-step signup wizard: numbered dots joined
 * by connectors, with a label under each step.
 */
export function SignupStepper({ current }: SignupStepperProps) {
  const { width } = useWindowDimensions();
  const isNarrow = width < 400;
  const labels = isNarrow ? STEP_LABELS_NARROW : STEP_LABELS;

  return (
    <View style={styles.row}>
      {labels.map((label, index) => {
        const step = (index + 1) as SignupStepNumber;
        const active = step === current;
        const complete = step < current;
        const isLast = index === STEP_LABELS_LENGTH - 1;

        return (
          <View key={label} style={styles.segment}>
            <View style={styles.stepCol}>
              <View style={[styles.dot, complete ? styles.dotComplete : null, active ? styles.dotActive : null]}>
                {complete ? (
                  <CheckCircle2 size={14} color={Colors.white} />
                ) : (
                  <Text style={[styles.dotText, active ? styles.dotTextLight : styles.dotTextMuted]}>{step}</Text>
                )}
              </View>
              <Text
                style={[styles.label, complete ? styles.labelComplete : null, active ? styles.labelActive : null]}
                numberOfLines={1}
              >
                {label}
              </Text>
            </View>
            {!isLast && (
              <View style={[styles.connector, complete ? styles.connectorComplete : styles.connectorFuture]} />
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: 4,
    paddingBottom: 16,
    minWidth: 0,
  },
  segment: { flexDirection: 'row', alignItems: 'flex-start', flexShrink: 1, minWidth: 0 },
  stepCol: { alignItems: 'center', flexShrink: 1, minWidth: 0, maxWidth: 72 },
  dot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.gray200,
    backgroundColor: Colors.white,
  },
  dotActive: { backgroundColor: Colors.blue600, borderColor: Colors.blue600 },
  dotComplete: { backgroundColor: Colors.green600, borderColor: Colors.green600 },
  dotText: { fontSize: 13, fontWeight: '700' },
  dotTextLight: { color: Colors.white },
  dotTextMuted: { color: Colors.gray400 },
  label: {
    marginTop: 6,
    fontSize: 10,
    textAlign: 'center',
    color: Colors.gray400,
    flexShrink: 1,
  },
  labelActive: { color: Colors.blue600, fontWeight: '600' },
  labelComplete: { color: Colors.green600, fontWeight: '600' },
  connector: { width: 16, height: 2, marginTop: 15, flexShrink: 1, minWidth: 6 },
  connectorComplete: { backgroundColor: Colors.green400 },
  connectorFuture: { backgroundColor: Colors.gray200 },
});
