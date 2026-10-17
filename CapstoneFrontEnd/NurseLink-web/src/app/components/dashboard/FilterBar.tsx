import { useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from '../ui/sheet';
import type { Department } from '../../types/domain';
import { DEFAULT_FILTERS, type DashboardFilters } from '../../utils/dashboardFilters';

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
  { label: 'All shifts', value: '__all' },
  { label: 'Morning', value: 'morning' },
  { label: 'Afternoon', value: 'afternoon' },
  { label: 'Night', value: 'night' },
];
const RISK_OPTIONS = [
  { label: 'All risk levels', value: '__all' },
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
 * single "Filters (N)" button opening a sheet on phone width, so the
 * controls don't push the rest of the dashboard down on a small screen.
 */
export function FilterBar({ filters, onChange, onReset, departments, nurses }: FilterBarProps) {
  const [sheetOpen, setSheetOpen] = useState(false);

  const activeChips: { key: string; label: string; clear: () => void }[] = [];
  if (filters.datePreset !== DEFAULT_FILTERS.datePreset) {
    activeChips.push({
      key: 'date',
      label: dateChipLabel(filters),
      clear: () => onChange({ ...filters, datePreset: '7d', customStart: '', customEnd: '' }),
    });
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

  const chipsRow = activeChips.length > 0 && (
    <div className="flex flex-wrap items-center gap-2">
      {activeChips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={chip.clear}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100"
        >
          {chip.label}
          <X className="w-3 h-3" />
        </button>
      ))}
      <button type="button" onClick={onReset} className="text-xs font-bold text-muted-foreground hover:text-foreground px-1.5">
        Reset filters
      </button>
    </div>
  );

  const controls = (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <div className="space-y-1.5">
        <Label>Date range</Label>
        <Select value={filters.datePreset} onValueChange={(v) => onChange({ ...filters, datePreset: v as DashboardFilters['datePreset'] })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {DATE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filters.datePreset === 'custom' ? (
        <>
          <div className="space-y-1.5">
            <Label>Start date</Label>
            <Input
              type="date"
              value={filters.customStart}
              max={filters.customEnd || undefined}
              onChange={(e) => onChange({ ...filters, customStart: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>End date</Label>
            <Input
              type="date"
              value={filters.customEnd}
              min={filters.customStart || undefined}
              onChange={(e) => onChange({ ...filters, customEnd: e.target.value })}
            />
          </div>
        </>
      ) : null}

      <div className="space-y-1.5">
        <Label>Department</Label>
        <Select value={filters.departmentId || '__all'} onValueChange={(v) => onChange({ ...filters, departmentId: v === '__all' ? '' : v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All departments</SelectItem>
            {departments.map((d) => (
              <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Shift</Label>
        <Select value={filters.shift || '__all'} onValueChange={(v) => onChange({ ...filters, shift: v === '__all' ? '' : v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {SHIFT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Nurse</Label>
        <Select value={filters.nurseId || '__all'} onValueChange={(v) => onChange({ ...filters, nurseId: v === '__all' ? '' : v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All nurses</SelectItem>
            {nurses.map((n) => (
              <SelectItem key={n.id} value={n.id}>{n.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Risk level</Label>
        <Select value={filters.risk || '__all'} onValueChange={(v) => onChange({ ...filters, risk: v === '__all' ? '' : v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {RISK_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Search</Label>
        <Input
          placeholder="Patient name or room"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
        />
      </div>
    </div>
  );

  return (
    <div className="bg-card border-b border-border">
      {/* Desktop/tablet: inline bar. Phone: a single "Filters (N)" button. */}
      <div className="hidden sm:block p-4 space-y-3">
        {controls}
        {chipsRow}
      </div>

      <div className="sm:hidden p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" size="sm" onClick={() => setSheetOpen(true)} className="gap-1.5">
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Filters{activeChips.length > 0 ? ` (${activeChips.length})` : ''}
          </Button>
        </div>
        {activeChips.length > 0 ? <div className="overflow-x-auto">{chipsRow}</div> : null}

        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Filters</SheetTitle>
            </SheetHeader>
            <div className="py-4">{controls}</div>
            <SheetFooter className="flex-row gap-2">
              <Button variant="outline" onClick={onReset} className="flex-1">Reset filters</Button>
              <Button onClick={() => setSheetOpen(false)} className="flex-1">Done</Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}
