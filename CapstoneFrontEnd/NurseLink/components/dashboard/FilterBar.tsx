import React, { useState } from 'react';
import { View, Text, Pressable, Modal, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { SlidersHorizontal, X, RotateCcw } from 'lucide-react-native';
import { Select } from '../Select';
import { DatePicker } from '../DatePicker';
import { Input } from '../Input';
import { Button } from '../Button';
import { SearchablePicker } from '../SearchablePicker';
import { Colors, Radius, Shadows } from '../../constants/colors';
import type { Department } from '../../types/domain';
import { DEFAULT_FILTERS, type DashboardFilters } from '../../utils/dashboardFilters';

const DESKTOP_MIN_WIDTH = 1024;

export interface NurseOption {
  id: string;
  name: string;
}

interface FilterBarProps {
  filters: DashboardFilters;
  onChange: (filters: DashboardFilters) => void;
  onReset: () => void;
  departments: Department[];
  nurses: NurseOption[];
}

const DATE_OPTIONS = [
  { label: 'Today', value: 'today' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'Custom', value: 'custom' },
];
const SHIFT_OPTIONS = [
  { label: 'All shifts', value: '' },
  { label: 'Morning', value: 'morning' },
  { label: 'Afternoon', value: 'afternoon' },
  { label: 'Night', value: 'night' },
];
const RISK_OPTIONS = [
  { label: 'All risk levels', value: '' },
  { label: 'High', value: 'high' },
  { label: 'Medium', value: 'medium' },
  { label: 'Low', value: 'low' },
];

function dateChipLabel(filters: DashboardFilters): string {
  switch (filters.datePreset) {
    case 'today':
      return 'Today';
    case '30d':
      return 'Last 30 days';
    case 'custom':
      return filters.customStart && filters.customEnd
        ? `${filters.customStart} – ${filters.customEnd}`
        : 'Custom range';
    default:
      return '';
  }
}

/**
 * Controls the stat cards, Workload section and Analytics section together
 * (see utils/dashboardFilters.ts). Inline bar on desktop; collapses into a
 * single "Filters (N)" button opening a bottom sheet on phone width, so the
 * controls don't push the rest of the dashboard down on a small screen.
 */
export function FilterBar({ filters, onChange, onReset, departments, nurses }: FilterBarProps) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_MIN_WIDTH;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [nursePickerOpen, setNursePickerOpen] = useState(false);
  const [nurseSearch, setNurseSearch] = useState('');

  const activeChips: { key: string; label: string; clear: () => void }[] = [];
  if (filters.datePreset !== DEFAULT_FILTERS.datePreset) {
    activeChips.push({ key: 'date', label: dateChipLabel(filters), clear: () => onChange({ ...filters, datePreset: '7d', customStart: '', customEnd: '' }) });
  }
  if (filters.departmentId) {
    const dept = departments.find((d) => String(d.id) === filters.departmentId);
    activeChips.push({ key: 'dept', label: dept?.name || 'Department', clear: () => onChange({ ...filters, departmentId: '' }) });
  }
  if (filters.shift) {
    activeChips.push({
      key: 'shift',
      label: `${filters.shift.charAt(0).toUpperCase()}${filters.shift.slice(1)} shift`,
      clear: () => onChange({ ...filters, shift: '' }),
    });
  }
  if (filters.nurseId) {
    const nurse = nurses.find((n) => n.id === filters.nurseId);
    activeChips.push({ key: 'nurse', label: nurse?.name || 'Nurse', clear: () => onChange({ ...filters, nurseId: '' }) });
  }
  if (filters.risk) {
    activeChips.push({
      key: 'risk',
      label: `${filters.risk.charAt(0).toUpperCase()}${filters.risk.slice(1)} risk`,
      clear: () => onChange({ ...filters, risk: '' }),
    });
  }
  if (filters.search.trim()) {
    activeChips.push({ key: 'search', label: `"${filters.search.trim()}"`, clear: () => onChange({ ...filters, search: '' }) });
  }

  const nurseOptions = nurses.filter((n) => n.name.toLowerCase().includes(nurseSearch.trim().toLowerCase()));
  const selectedNurse = nurses.find((n) => n.id === filters.nurseId);

  const controls = (
    <View style={styles.controlsGrid}>
      <View style={styles.field}>
        <Select
          label="Date Range"
          value={filters.datePreset}
          onValueChange={(value) => onChange({ ...filters, datePreset: value as DashboardFilters['datePreset'] })}
          options={DATE_OPTIONS}
        />
      </View>
      {filters.datePreset === 'custom' ? (
        <>
          <View style={styles.field}>
            <DatePicker
              label="Start date"
              value={filters.customStart}
              onChange={(iso) => onChange({ ...filters, customStart: iso })}
              maxDate={filters.customEnd || undefined}
            />
          </View>
          <View style={styles.field}>
            <DatePicker
              label="End date"
              value={filters.customEnd}
              onChange={(iso) => onChange({ ...filters, customEnd: iso })}
              minDate={filters.customStart || undefined}
            />
          </View>
        </>
      ) : null}
      <View style={styles.field}>
        <Select
          label="Department"
          value={filters.departmentId}
          onValueChange={(value) => onChange({ ...filters, departmentId: value })}
          options={[{ label: 'All departments', value: '' }, ...departments.map((d) => ({ label: d.name, value: String(d.id) }))]}
        />
      </View>
      <View style={styles.field}>
        <Select
          label="Shift"
          value={filters.shift}
          onValueChange={(value) => onChange({ ...filters, shift: value })}
          options={SHIFT_OPTIONS}
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Nurse</Text>
        <Pressable style={styles.pickerTrigger} onPress={() => setNursePickerOpen(true)}>
          <Text style={styles.pickerTriggerText} numberOfLines={1}>
            {selectedNurse ? selectedNurse.name : 'All nurses'}
          </Text>
        </Pressable>
      </View>
      <View style={styles.field}>
        <Select
          label="Risk Level"
          value={filters.risk}
          onValueChange={(value) => onChange({ ...filters, risk: value })}
          options={RISK_OPTIONS}
        />
      </View>
      <View style={styles.field}>
        <Input
          label="Search"
          placeholder="Patient name or room"
          value={filters.search}
          onChangeText={(value) => onChange({ ...filters, search: value })}
          autoCapitalize="none"
        />
      </View>
    </View>
  );

  const nursePicker = (
    <SearchablePicker
      visible={nursePickerOpen}
      onClose={() => setNursePickerOpen(false)}
      title="Nurse"
      searchPlaceholder="Search nurses..."
      searchQuery={nurseSearch}
      onSearchChange={setNurseSearch}
      groups={[{ key: 'all', items: [{ id: '', name: 'All nurses' }, ...nurseOptions] }]}
      keyExtractor={(item) => item.id}
      isSelected={(item) => item.id === filters.nurseId}
      isDisabled={() => false}
      onToggle={(item) => {
        onChange({ ...filters, nurseId: item.id });
        setNursePickerOpen(false);
      }}
      renderContent={(item, selected) => (
        <Text style={[styles.pickerRowText, selected && styles.pickerRowTextSelected]}>{item.name}</Text>
      )}
      emptyMessage="No nurses match your search."
    />
  );

  if (isDesktop) {
    return (
      <View style={styles.desktopBar}>
        {controls}
        <View style={styles.chipsRow}>
          {activeChips.map((chip) => (
            <Pressable key={chip.key} style={styles.chip} onPress={chip.clear}>
              <Text style={styles.chipText}>{chip.label}</Text>
              <X size={12} color={Colors.blue700} />
            </Pressable>
          ))}
          <Pressable
            style={[styles.clearLink, activeChips.length === 0 && styles.clearLinkIdle]}
            onPress={onReset}
            disabled={activeChips.length === 0}
          >
            <RotateCcw size={12} color={Colors.blue600} />
            <Text style={styles.clearText}>Clear Filters</Text>
          </Pressable>
        </View>
        {nursePicker}
      </View>
    );
  }

  return (
    <View style={styles.mobileBar}>
      <Pressable style={styles.filtersButton} onPress={() => setSheetOpen(true)}>
        <SlidersHorizontal size={15} color={Colors.foreground} />
        <Text style={styles.filtersButtonText}>
          Filters{activeChips.length > 0 ? ` (${activeChips.length})` : ''}
        </Text>
      </Pressable>
      {activeChips.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRowMobile}>
          {activeChips.map((chip) => (
            <Pressable key={chip.key} style={styles.chip} onPress={chip.clear}>
              <Text style={styles.chipText}>{chip.label}</Text>
              <X size={12} color={Colors.blue700} />
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <Modal visible={sheetOpen} transparent animationType="slide" onRequestClose={() => setSheetOpen(false)}>
        <View style={styles.sheetOverlay}>
          <View style={[styles.sheet, Shadows.xl]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Filters</Text>
              <Pressable onPress={() => setSheetOpen(false)} hitSlop={8}>
                <X size={20} color={Colors.foreground} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.sheetContent}>{controls}</ScrollView>
            <View style={styles.sheetFooter}>
              <Button variant="outline" onPress={onReset} style={styles.flex1}>
                Reset filters
              </Button>
              <Button onPress={() => setSheetOpen(false)} style={styles.flex1}>
                Done
              </Button>
            </View>
          </View>
        </View>
      </Modal>
      {nursePicker}
    </View>
  );
}

const styles = StyleSheet.create({
  desktopBar: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: '#D9E6FA',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
    gap: 6,
  },
  clearLink: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 'auto', paddingVertical: 4, paddingHorizontal: 4 },
  clearLinkIdle: { opacity: 0.85 },
  clearText: { fontSize: 12, fontWeight: '600', color: Colors.blue600 },
  mobileBar: {
    backgroundColor: Colors.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    padding: 12,
    gap: 8,
  },
  controlsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  field: { minWidth: 160, flexGrow: 1, flexBasis: 160 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: Colors.gray700, marginBottom: 6 },
  pickerTrigger: {
    height: 44,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    justifyContent: 'center',
    backgroundColor: Colors.inputBackground,
  },
  pickerTriggerText: { fontSize: 14, color: Colors.foreground },
  pickerRowText: { fontSize: 14, color: Colors.foreground, flex: 1 },
  pickerRowTextSelected: { fontWeight: '700', color: Colors.primary },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  chipsRowMobile: { flexDirection: 'row', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.full,
    backgroundColor: Colors.blue50,
    borderWidth: 1,
    borderColor: Colors.blue200,
  },
  chipText: { fontSize: 12, fontWeight: '600', color: Colors.blue700 },
  resetLink: { paddingHorizontal: 8, paddingVertical: 6 },
  resetText: { fontSize: 12.5, fontWeight: '700', color: Colors.mutedForeground },
  filtersButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  filtersButtonText: { fontSize: 13, fontWeight: '600', color: Colors.foreground },
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '85%',
    backgroundColor: Colors.card,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  sheetTitle: { fontSize: 16, fontWeight: '700', color: Colors.foreground },
  sheetContent: { padding: 16, gap: 12 },
  sheetFooter: {
    flexDirection: 'row',
    gap: 10,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  flex1: { flex: 1 },
});
