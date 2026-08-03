import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import { ChevronDown, Check } from 'lucide-react-native';
import { Colors, Radius, Shadows } from '../constants/colors';

export interface SelectOption {
  label: string;
  value: string;
  disabled?: boolean;
}

interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  label?: string;
  error?: string;
  style?: ViewStyle;
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder = 'Select...',
  label,
  error,
  style,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <View style={[styles.container, style]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <Pressable
        onPress={() => setOpen(true)}
        style={[styles.trigger, error ? styles.triggerError : null]}
      >
        <Text
          style={[styles.triggerText, !selected && styles.placeholder]}
          numberOfLines={1}
        >
          {selected ? selected.label : placeholder}
        </Text>
        <ChevronDown size={16} color={Colors.mutedForeground} />
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={[styles.sheet, Shadows.lg]} onPress={(e) => e.stopPropagation()}>
            {label ? <Text style={styles.sheetTitle}>{label}</Text> : null}
            <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
              {options.map((option) => {
                const isSelected = option.value === value;
                const isDisabled = !!option.disabled;
                return (
                  <Pressable
                    key={option.value}
                    disabled={isDisabled}
                    onPress={() => {
                      if (isDisabled) return;
                      onValueChange(option.value);
                      setOpen(false);
                    }}
                    style={[
                      styles.option,
                      isSelected && styles.optionSelected,
                      isDisabled && styles.optionDisabled,
                    ]}
                  >
                    <Text
                      style={[
                        styles.optionText,
                        isSelected && styles.optionTextSelected,
                        isDisabled && styles.optionTextDisabled,
                      ]}
                    >
                      {option.label}
                    </Text>
                    {isSelected ? <Check size={16} color={Colors.primary} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable style={styles.cancelBtn} onPress={() => setOpen(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 6 },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.foreground,
  },
  trigger: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.inputBackground,
    gap: 8,
  },
  triggerError: {
    borderColor: Colors.destructive,
  },
  triggerText: {
    flex: 1,
    fontSize: 14,
    color: Colors.foreground,
  },
  placeholder: {
    color: Colors.mutedForeground,
  },
  error: {
    fontSize: 12,
    color: Colors.destructive,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  sheet: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    width: '100%',
    maxWidth: 400,
    maxHeight: '70%',
    overflow: 'hidden',
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.foreground,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  list: {
    maxHeight: 320,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
    gap: 8,
  },
  optionSelected: {
    backgroundColor: Colors.blue50,
  },
  optionDisabled: {
    opacity: 0.45,
  },
  optionText: {
    flex: 1,
    fontSize: 14,
    color: Colors.foreground,
  },
  optionTextSelected: {
    color: Colors.primary,
    fontWeight: '600',
  },
  optionTextDisabled: {
    color: Colors.gray500,
  },
  cancelBtn: {
    padding: 16,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  cancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.mutedForeground,
  },
});
