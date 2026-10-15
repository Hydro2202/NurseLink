import React from 'react';
import { View, Text, Modal, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { Search } from 'lucide-react-native';
import { Colors, Radius, Shadows } from '../constants/colors';
import { Button } from './Button';

export interface PickerChip {
  key: string;
  label: string;
  count: number;
}

export interface PickerGroup<T> {
  key: string;
  /** Section header text (e.g. "MORNING SHIFT"). Omit/empty to render this
   * group's items with no header — used when the picker has nothing to
   * group by (e.g. the patient picker). */
  label?: string;
  items: T[];
}

interface SearchablePickerProps<T> {
  visible: boolean;
  onClose: () => void;
  title: string;
  searchPlaceholder: string;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  /** Filter chip row shown under the search box — omit entirely for a picker with nothing to filter by shift/category. */
  chips?: PickerChip[];
  activeChipKey?: string;
  onChipChange?: (key: string) => void;
  groups: PickerGroup<T>[];
  keyExtractor: (item: T) => string;
  isSelected: (item: T) => boolean;
  isDisabled: (item: T) => boolean;
  onToggle: (item: T) => void;
  /** The row's inner content only — the picker itself renders the
   * Pressable wrapper (padding, border, selected/disabled styling), same
   * convention as Select.tsx's option rows. */
  renderContent: (item: T, selected: boolean, disabled: boolean) => React.ReactNode;
  emptyMessage: string;
  /** Shown as a "Clear filters" link under emptyMessage when provided — the
   * empty state is caused by a filter (search/chip), not a genuine lack of data. */
  onClearFilters?: () => void;
  /** Multi-select: shows a checkbox-style selection (handled by renderContent),
   * a Select all / Clear row, and a "Done (N selected)" footer button instead
   * of closing on tap. Single-select (default) closes on tap, like Select.tsx. */
  multiSelect?: boolean;
  selectedCount?: number;
  onSelectAll?: () => void;
  onClearSelection?: () => void;
  onDone?: () => void;
}

export function SearchablePicker<T>({
  visible,
  onClose,
  title,
  searchPlaceholder,
  searchQuery,
  onSearchChange,
  chips,
  activeChipKey,
  onChipChange,
  groups,
  keyExtractor,
  isSelected,
  isDisabled,
  onToggle,
  renderContent,
  emptyMessage,
  onClearFilters,
  multiSelect = false,
  selectedCount = 0,
  onSelectAll,
  onClearSelection,
  onDone,
}: SearchablePickerProps<T>) {
  const totalItems = groups.reduce((sum, g) => sum + g.items.length, 0);

  const handlePress = (item: T) => {
    if (isDisabled(item)) return;
    onToggle(item);
    if (!multiSelect) onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, Shadows.lg]} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.sheetTitle}>{title}</Text>

          <View style={styles.searchBox}>
            <Search size={15} color={Colors.mutedForeground} />
            <TextInput
              style={styles.searchInput}
              placeholder={searchPlaceholder}
              placeholderTextColor={Colors.mutedForeground}
              value={searchQuery}
              onChangeText={onSearchChange}
              autoCorrect={false}
              autoCapitalize="none"
            />
          </View>

          {chips && chips.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipsRow}
            >
              {chips.map((chip) => {
                const active = chip.key === activeChipKey;
                return (
                  <Pressable
                    key={chip.key}
                    onPress={() => onChipChange?.(chip.key)}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {chip.label} ({chip.count})
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

          {multiSelect && totalItems > 0 ? (
            <View style={styles.selectAllRow}>
              <Pressable onPress={onSelectAll} accessibilityRole="button">
                <Text style={styles.selectAllText}>Select all</Text>
              </Pressable>
              <Pressable onPress={onClearSelection} accessibilityRole="button">
                <Text style={styles.selectAllText}>Clear</Text>
              </Pressable>
            </View>
          ) : null}

          {totalItems === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>{emptyMessage}</Text>
              {onClearFilters ? (
                <Pressable onPress={onClearFilters} accessibilityRole="button">
                  <Text style={styles.clearSearchText}>Clear filters</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
              {groups.map((group) => (
                <View key={group.key}>
                  {group.label ? <Text style={styles.sectionHeader}>{group.label}</Text> : null}
                  {group.items.map((item) => {
                    const selected = isSelected(item);
                    const disabled = isDisabled(item);
                    return (
                      <Pressable
                        key={keyExtractor(item)}
                        disabled={disabled}
                        onPress={() => handlePress(item)}
                        style={[
                          styles.option,
                          selected && styles.optionSelected,
                          disabled && styles.optionDisabled,
                        ]}
                      >
                        {renderContent(item, selected, disabled)}
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          )}

          {multiSelect ? (
            <View style={styles.doneFooter}>
              <Button onPress={onDone} style={{ flex: 1 }}>
                {`Done (${selectedCount} selected)`}
              </Button>
            </View>
          ) : (
            <Pressable style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  sheet: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    width: '100%',
    maxWidth: 420,
    maxHeight: '80%',
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
    fontSize: 16,
    color: Colors.foreground,
    padding: 0,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  chipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.foreground,
  },
  chipTextActive: {
    color: Colors.white,
  },
  selectAllRow: {
    flexDirection: 'row',
    gap: 16,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  selectAllText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primary,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.mutedForeground,
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
    backgroundColor: Colors.gray50,
  },
  emptyBox: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 32,
    paddingHorizontal: 16,
  },
  emptyText: {
    fontSize: 13,
    color: Colors.mutedForeground,
    textAlign: 'center',
  },
  clearSearchText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primary,
  },
  list: {
    maxHeight: 360,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
    gap: 10,
  },
  optionSelected: {
    backgroundColor: Colors.blue50,
  },
  optionDisabled: {
    opacity: 0.5,
  },
  doneFooter: {
    flexDirection: 'row',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
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
