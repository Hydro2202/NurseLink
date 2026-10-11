import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { Button } from '../Button';
import { Colors, Radius } from '../../constants/colors';
import type { UserRole } from '../../types/user';

const ROLE_OPTIONS: { value: UserRole; label: string; emoji: string; detail: string }[] = [
  {
    value: 'staff_nurse',
    label: 'Nurse',
    emoji: '\u{1F469}‍⚕️',
    detail: 'Staff Nurse or Registered Nurse responsible for direct patient care and clinical documentation.',
  },
  {
    value: 'head_nurse',
    label: 'Head Nurse (requested, needs admin approval)',
    emoji: '\u{1F468}‍\u{1F4BC}',
    detail: 'Requested only. Head nurse access is granted by an administrator after review, never at signup.',
  },
];

interface Step2RoleProps {
  value: UserRole | '';
  onChange: (role: UserRole) => void;
  onNext: () => void;
  onBack: () => void;
}

export function Step2Role({ value, onChange, onNext, onBack }: Step2RoleProps) {
  return (
    <View style={styles.stepBody}>
      <Text style={styles.heading}>Choose the role you are requesting.</Text>
      <Text style={styles.subheading}>
        You start as a staff nurse; a head nurse request needs admin approval before it takes effect.
      </Text>

      {ROLE_OPTIONS.map((opt) => {
        const selected = value === opt.value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={[styles.card, selected ? styles.cardSelected : null]}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
          >
            <Text style={styles.emoji}>{opt.emoji}</Text>
            <View style={styles.cardText}>
              <Text style={[styles.cardLabel, selected ? styles.cardLabelSelected : null]} numberOfLines={2}>
                {opt.label}
              </Text>
              <Text style={styles.cardDetail}>{opt.detail}</Text>
            </View>
            {selected ? <CheckCircle2 size={20} color={Colors.blue600} /> : null}
          </Pressable>
        );
      })}

      <View style={styles.navRow}>
        <Button variant="outline" onPress={onBack} size="lg" style={styles.backBtn}>
          <ChevronLeft size={18} color={Colors.gray700} />
          <Text style={styles.backText} numberOfLines={1}>Back</Text>
        </Button>
        <Button onPress={onNext} disabled={!value} size="lg" style={[styles.continueBtn, !value && styles.btnDisabled]}>
          <Text style={[styles.btnText, !value && styles.btnTextDisabled]} numberOfLines={1}>Continue</Text>
          <ChevronRight size={18} color={!value ? Colors.gray500 : Colors.white} />
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stepBody: { gap: 14 },
  heading: { fontSize: 15, fontWeight: '600', color: Colors.foreground },
  subheading: { fontSize: 13, color: Colors.gray500, lineHeight: 18, marginBottom: 4 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
    padding: 16,
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  cardSelected: { borderColor: Colors.blue600, backgroundColor: Colors.blue50 },
  emoji: { fontSize: 28 },
  cardText: { flex: 1, flexShrink: 1, minWidth: 0, gap: 2 },
  cardLabel: { fontSize: 14, fontWeight: '600', color: Colors.foreground, flexShrink: 1 },
  cardLabelSelected: { color: Colors.blue700 },
  cardDetail: { fontSize: 12, color: Colors.gray500, lineHeight: 16, flexShrink: 1 },
  navRow: { flexDirection: 'row', gap: 12, marginTop: 4, minWidth: 0 },
  // paddingHorizontal explicitly overrides Button's size="lg" default of 32
  // — at half (or 1/2.5) of a 360px-wide row that default alone leaves too
  // little room for "Back"/"Create Account" and the chevron, which is what
  // was forcing the label to wrap mid-word.
  backBtn: { flex: 1, borderRadius: Radius.full, minHeight: 52, minWidth: 0, paddingHorizontal: 12 },
  continueBtn: {
    flex: 1.6,
    backgroundColor: Colors.blue600,
    borderRadius: Radius.full,
    minHeight: 52,
    minWidth: 0,
    paddingHorizontal: 12,
  },
  btnDisabled: { backgroundColor: Colors.gray200 },
  btnText: { color: Colors.white, fontWeight: '600', fontSize: 15, flexShrink: 1 },
  btnTextDisabled: { color: Colors.gray500 },
  backText: { color: Colors.gray700, fontWeight: '600', fontSize: 15, flexShrink: 1 },
});
