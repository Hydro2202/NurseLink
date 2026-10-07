import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  ViewStyle,
} from 'react-native';
import { ChevronDown, Check, Search } from 'lucide-react-native';
import { Colors, Radius, Shadows } from '../constants/colors';

export interface SelectOption {
  label: string;
  value: string;
  disabled?: boolean;
  /**
   * Extra text matched by search but not shown as the option label — e.g. a
   * nurse's username/email or a patient's ID, so search works on fields the
   * label doesn't spell out.
   */
  keywords?: string;
}

interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  label?: string;
  error?: string;
  style?: ViewStyle;
  /** Shows a search box above the option list, filtering as the user types. */
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Shown instead of the list when search/options produce zero results. */
  emptyMessage?: string;
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder = 'Select...',
  label,
  error,
  style,
  searchable = false,
  searchPlaceholder = 'Search...',
  emptyMessage = 'No results found.',
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.find((o) => o.value === value);

  const visibleOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.keywords ? o.keywords.toLowerCase().includes(q) : false)
    );
  }, [options, query]);

  const closeModal = () => {
    setOpen(false);
    setQuery('');
  };

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

      <Modal visible={open} transparent animationType="fade" onRequestClose={closeModal}>
        <Pressable style={styles.backdrop} onPress={closeModal}>
          <Pressable style={[styles.sheet, Shadows.lg]} onPress={(e) => e.stopPropagation()}>
            {label ? <Text style={styles.sheetTitle}>{label}</Text> : null}
            {searchable ? (
              <View style={styles.searchBox}>
                <Search size={15} color={Colors.mutedForeground} />
                <TextInput
                  style={styles.searchInput}
                  placeholder={searchPlaceholder}
                  placeholderTextColor={Colors.mutedForeground}
                  value={query}
                  onChangeText={setQuery}
                  autoCorrect={false}
                  autoCapitalize="none"
                />
              </View>
            ) : null}
            {visibleOptions.length === 0 ? (
              // Two different empty states share this: genuinely nothing to
              // offer (emptyMessage, server/caller-driven) vs. the search
              // box filtering out everything that IS there — distinguished
              // by whether options itself is non-empty.
              query.trim() && options.length > 0 ? (
                <View style={styles.emptySearchBox}>
                  <Text style={styles.emptySearchText}>No matches for &quot;{query.trim()}&quot;.</Text>
                  <Pressable onPress={() => setQuery('')} accessibilityRole="button">
                    <Text style={styles.clearSearchText}>Clear search</Text>
                  </Pressable>
                </View>
              ) : (
                <Text style={styles.emptyText}>{emptyMessage}</Text>
              )
            ) : (
            <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
              {visibleOptions.map((option) => {
                const isSelected = option.value === value;
                const isDisabled = !!option.disabled;
                return (
                  <Pressable
                    key={option.value}
                    disabled={isDisabled}
                    onPress={() => {
                      if (isDisabled) return;
                      onValueChange(option.value);
                      closeModal();
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
            )}
            <Pressable style={styles.cancelBtn} onPress={closeModal}>
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
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    height: 38,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.inputBackground,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: Colors.foreground,
    padding: 0,
  },
  emptySearchBox: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 24,
  },
  emptySearchText: {
    fontSize: 13,
    color: Colors.mutedForeground,
    textAlign: 'center',
  },
  clearSearchText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primary,
  },
  emptyText: {
    fontSize: 13,
    color: Colors.mutedForeground,
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingVertical: 32,
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
