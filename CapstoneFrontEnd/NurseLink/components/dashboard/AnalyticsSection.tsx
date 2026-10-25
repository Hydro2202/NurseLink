import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, LayoutChangeEvent, ViewStyle } from 'react-native';
import {
  BedDouble, Users, ListChecks, BarChart3, Clock, PieChart as PieChartIcon, AlertTriangle,
} from 'lucide-react-native';
import { BarChart, PieChart } from '../Charts';
import type { AnalyticsData } from '../../types/domain';

/**
 * Head Nurse Analytics charts, one exported card per chart so the page can
 * lay them out in the reference grid (Patient Flow | Patients by Status,
 * Task Performance | Task Volume, and Shift & Delay / Task Type stacked
 * beside Nurse Workload). Every card reads straight from the /analytics/
 * response — nothing here is computed from placeholder data.
 */

/** The dashboard's own palette (see the Analytics design spec). */
export const AN = {
  navy: '#102A63',
  blue: '#2563EB',
  blueSoft: '#EAF1FF',
  pageBg: '#F0F5FF',
  border: '#D9E6FA',
  text: '#1E293B',
  text2: '#64748B',
  grid: '#E7EEFA',
  green: '#16A765',
  greenSoft: '#E7F7EF',
  orange: '#F59E0B',
  orangeSoft: '#FFF4E0',
  red: '#EF4444',
  redSoft: '#FDECEC',
  purple: '#7C3AED',
  purpleSoft: '#F1EAFE',
};

/** Same four status colors everywhere a task status is charted. */
export const TASK_STATUS_COLORS = {
  completed: AN.green,
  inProgress: AN.blue,
  pending: AN.orange,
  overdue: AN.red,
};

const PATIENT_STATUS_COLORS: Record<string, string> = {
  admitted: AN.blue,
  observation: AN.orange,
  discharged: AN.green,
};

const Y_LABEL_WIDTH = 30;
const axisText = { fontSize: 10, color: AN.text2 };

function humanizeCategory(label?: string): string {
  if (!label) return 'Other';
  return label.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function pct(part: number, total: number): string {
  return total > 0 ? `${Math.round((part / total) * 100)}%` : '0%';
}

/** Bar width is capped so wide cards don't get fat bars; whatever width
 * the cap leaves over goes into spacing, so bars always span the plot. */
function barSizing(slots: number, plotWidth: number, perSlot = 1) {
  const n = Math.max(slots, 1);
  const usable = Math.max(plotWidth - 12, 60);
  const slot = usable / n;
  const barWidth = Math.max(Math.min((slot * 0.62) / perSlot, 34), 6);
  const spacing = Math.max((usable - barWidth * perSlot * n) / n, 6);
  return { barWidth, spacing };
}

// A y-axis maximum ~1.8x the tallest bar, rounded up to a clean multiple
// of the section count. The extra headroom leaves space above the tallest
// bar for the pop-up tooltip, so it can't be cut off at the top of the
// chart (or, for the Shift chart, its clipped box).
function chartTopValue(values: number[], sections = 4): number {
  const max = values.length ? Math.max(...values, 0) : 0;
  if (max <= 0) return sections;
  return Math.ceil((max * 1.8) / sections) * sections;
}

function useMeasuredWidth() {
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const next = e.nativeEvent.layout.width;
    setWidth((prev) => (Math.abs(prev - next) > 1 ? next : prev));
  }, []);
  return [width, onLayout] as const;
}

function Tooltip({ lines }: { lines: string[] }) {
  return (
    <View style={styles.tooltip}>
      {lines.map((l) => (
        <Text key={l} style={styles.tooltipText}>{l}</Text>
      ))}
    </View>
  );
}

export function LegendInline({ items }: { items: { color: string; label: string }[] }) {
  return (
    <View style={styles.legendInline}>
      {items.map((i) => (
        <View key={i.label} style={styles.legendInlineItem}>
          <View style={[styles.dot, { backgroundColor: i.color }]} />
          <Text style={styles.legendInlineText}>{i.label}</Text>
        </View>
      ))}
    </View>
  );
}

interface AnalyticsCardProps {
  icon: React.ComponentType<{ size?: number; color?: string }>;
  title: string;
  subtitle: string;
  right?: React.ReactNode;
  loading?: boolean;
  hasData: boolean;
  style?: ViewStyle;
  /** Receives the card's inner (padding-excluded) width. */
  children: (innerWidth: number) => React.ReactNode;
  footer?: React.ReactNode;
}

/** The one card shell every Analytics card shares — same border, radius,
 * padding, header spacing and empty state. */
export function AnalyticsCard({ icon: Icon, title, subtitle, right, loading, hasData, style, children, footer }: AnalyticsCardProps) {
  const [width, onLayout] = useMeasuredWidth();
  const inner = Math.max(width - CARD_PAD * 2, 0);
  return (
    <View style={[styles.card, style]} onLayout={onLayout}>
      <View style={styles.cardHeader}>
        <View style={styles.cardIcon}>
          <Icon size={15} color={AN.blue} />
        </View>
        <View style={styles.flex1}>
          <Text style={styles.cardTitle} numberOfLines={1}>{title}</Text>
          <Text style={styles.cardSubtitle} numberOfLines={1}>{subtitle}</Text>
        </View>
        {right}
      </View>
      {loading ? (
        <Text style={styles.empty}>Loading…</Text>
      ) : !hasData ? (
        <Text style={styles.empty}>No data for these filters.</Text>
      ) : inner > 0 ? (
        <>
          {children(inner)}
          {footer}
        </>
      ) : null}
    </View>
  );
}

interface ChartProps {
  data: AnalyticsData | null;
  loading: boolean;
  filterSummary: string;
  style?: ViewStyle;
}

/** Patient Flow — admissions vs discharges per day, grouped bars. */
export function PatientFlowCard({ data, loading, filterSummary, style }: ChartProps) {
  const flow = data?.patientFlow || [];
  const totalAdmissions = flow.reduce((s, d) => s + d.admissions, 0);
  const totalDischarges = flow.reduce((s, d) => s + d.discharges, 0);

  return (
    <AnalyticsCard
      style={style}
      icon={BedDouble}
      title="Patient Flow"
      subtitle={`Admissions vs Discharges · ${filterSummary}`}
      right={<LegendInline items={[{ color: AN.blue, label: 'Admissions' }, { color: AN.green, label: 'Discharges' }]} />}
      loading={loading}
      hasData={totalAdmissions + totalDischarges > 0}
      footer={
        <View style={styles.flowFooter}>
          <View style={styles.flowStat}>
            <View style={[styles.flowStatIcon, { backgroundColor: AN.blueSoft }]}>
              <Users size={13} color={AN.blue} />
            </View>
            <View>
              <Text style={styles.flowStatLabel}>Total Admissions</Text>
              <Text style={styles.flowStatValue}>{totalAdmissions}</Text>
            </View>
          </View>
          <View style={styles.flowDivider} />
          <View style={styles.flowStat}>
            <View style={[styles.flowStatIcon, { backgroundColor: AN.greenSoft }]}>
              <Users size={13} color={AN.green} />
            </View>
            <View>
              <Text style={styles.flowStatLabel}>Total Discharges</Text>
              <Text style={styles.flowStatValue}>{totalDischarges}</Text>
            </View>
          </View>
          {data?.avgLengthOfStayDays != null ? (
            <>
              <View style={styles.flowDivider} />
              <View style={styles.flowStat}>
                <View>
                  <Text style={styles.flowStatLabel}>Avg Length of Stay</Text>
                  <Text style={styles.flowStatValue}>{data.avgLengthOfStayDays} d</Text>
                </View>
              </View>
            </>
          ) : null}
        </View>
      }
    >
      {(inner) => {
        // Size bars against the plot minus each pair's 3px inner gap, which
        // barSizing doesn't know about, so the pairs fit inside `plot`.
        const plot = inner - Y_LABEL_WIDTH - 8;
        const { barWidth, spacing } = barSizing(flow.length, plot - 3 * flow.length, 2);
        const bars = flow.flatMap((d, i) => {
          // The last pair gets no trailing gap, otherwise it runs past the
          // plot's right edge. Its label keeps full width so it isn't truncated.
          const gap = i === flow.length - 1 ? 0 : spacing;
          return [
            { value: d.admissions, label: d.label, spacing: 3, frontColor: AN.blue, labelWidth: barWidth * 2 + 3 + spacing,
              labelTextStyle: axisText, tip: [`${d.label}`, `Adm ${d.admissions}  ·  Dis ${d.discharges}`] },
            { value: d.discharges, frontColor: AN.green, spacing: gap,
              tip: [`${d.label}`, `Adm ${d.admissions}  ·  Dis ${d.discharges}`] },
          ];
        });
        return (
          <BarChart
            data={bars}
            width={plot}
            height={130}
            maxValue={chartTopValue(flow.flatMap((d) => [d.admissions, d.discharges]))}
            barWidth={barWidth}
            initialSpacing={spacing / 2}
            endSpacing={spacing / 2}
            roundedTop
            barBorderTopLeftRadius={3}
            barBorderTopRightRadius={3}
            noOfSections={4}
            yAxisLabelWidth={Y_LABEL_WIDTH}
            yAxisThickness={0}
            xAxisThickness={1}
            xAxisColor={AN.border}
            rulesColor={AN.grid}
            rulesType="solid"
            yAxisTextStyle={axisText}
            xAxisLabelTextStyle={axisText}
            renderTooltip={(item: { tip?: string[] }) => (item.tip ? <Tooltip lines={item.tip} /> : null)}
          />
        );
      }}
    </AnalyticsCard>
  );
}

/** Patients by Status — current census donut with a side legend. */
export function PatientStatusCard({ data, loading, style }: ChartProps) {
  const rows = (data?.patientStatus || []).map((s) => ({ ...s, color: PATIENT_STATUS_COLORS[s.status] || '#94A3B8' }));
  const total = rows.reduce((s, r) => s + r.value, 0);

  return (
    <AnalyticsCard
      style={style}
      icon={Users}
      title="Patients by Status"
      subtitle="Current patient distribution"
      loading={loading}
      hasData={total > 0}
    >
      {(inner) => {
        const radius = Math.max(Math.min(inner * 0.2, 74), 52);
        return (
          <View style={styles.donutRow}>
            <PieChart
              data={rows.filter((r) => r.value > 0).map((r) => ({ value: r.value, color: r.color }))}
              donut
              radius={radius}
              innerRadius={radius * 0.68}
              innerCircleColor="#FFFFFF"
              centerLabelComponent={() => (
                <View style={styles.donutCenter}>
                  <Text style={styles.donutValue}>{total}</Text>
                  <Text style={styles.donutLabel}>Total Patients</Text>
                </View>
              )}
            />
            <View style={styles.sideLegend}>
              {rows.map((r) => (
                <View key={r.status} style={styles.sideLegendRow}>
                  <View style={[styles.legendBullet, { backgroundColor: r.color }]} />
                  <Text style={styles.sideLegendName} numberOfLines={1}>{r.label}</Text>
                  <Text style={styles.sideLegendCount}>{r.value}</Text>
                  <Text style={styles.sideLegendPct}>{pct(r.value, total)}</Text>
                </View>
              ))}
            </View>
          </View>
        );
      }}
    </AnalyticsCard>
  );
}

/** Task Performance — per day, tasks due that day stacked by current status. */
export function TaskPerformanceCard({ data, loading, filterSummary, style }: ChartProps) {
  const rows = data?.taskPerformance || [];
  const hasData = rows.some((r) => r.completed + r.inProgress + r.pending + r.overdue > 0);

  return (
    <AnalyticsCard
      style={style}
      icon={ListChecks}
      title="Task Performance"
      subtitle={`Task status comparison · ${filterSummary}`}
      right={
        <LegendInline
          items={[
            { color: TASK_STATUS_COLORS.completed, label: 'Completed' },
            { color: TASK_STATUS_COLORS.inProgress, label: 'In Progress' },
            { color: TASK_STATUS_COLORS.pending, label: 'Pending' },
            { color: TASK_STATUS_COLORS.overdue, label: 'Overdue' },
          ]}
        />
      }
      loading={loading}
      hasData={hasData}
    >
      {(inner) => {
        const plot = inner - Y_LABEL_WIDTH;
        const { barWidth, spacing } = barSizing(rows.length, plot);
        const stackData = rows.map((r) => ({
          label: r.label,
          labelTextStyle: axisText,
          tip: [r.label, `C ${r.completed}  IP ${r.inProgress}  P ${r.pending}  O ${r.overdue}`],
          stacks: [
            { value: r.completed, color: TASK_STATUS_COLORS.completed },
            { value: r.inProgress, color: TASK_STATUS_COLORS.inProgress },
            { value: r.pending, color: TASK_STATUS_COLORS.pending },
            { value: r.overdue, color: TASK_STATUS_COLORS.overdue, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
          ],
        }));
        return (
          <BarChart
            stackData={stackData}
            width={plot}
            height={110}
            maxValue={chartTopValue(rows.map((r) => r.completed + r.inProgress + r.pending + r.overdue))}
            barWidth={barWidth}
            spacing={spacing}
            initialSpacing={spacing / 2}
            endSpacing={spacing / 2}
            noOfSections={4}
            yAxisLabelWidth={Y_LABEL_WIDTH}
            yAxisThickness={0}
            xAxisThickness={1}
            xAxisColor={AN.border}
            rulesColor={AN.grid}
            rulesType="solid"
            yAxisTextStyle={axisText}
            xAxisLabelTextStyle={axisText}
            renderTooltip={(item: { tip?: string[] }) => (item.tip ? <Tooltip lines={item.tip} /> : null)}
          />
        );
      }}
    </AnalyticsCard>
  );
}

/** Task Volume — tasks created per day (creation date, not completion). */
export function TaskVolumeCard({ data, loading, filterSummary, style }: ChartProps) {
  const rows = data?.taskVolume || [];
  return (
    <AnalyticsCard
      style={style}
      icon={BarChart3}
      title="Task Volume"
      subtitle={`Tasks created · ${filterSummary}`}
      loading={loading}
      hasData={rows.some((r) => r.value > 0)}
    >
      {(inner) => {
        const plot = inner - Y_LABEL_WIDTH;
        const { barWidth, spacing } = barSizing(rows.length, plot);
        return (
          <BarChart
            data={rows.map((r) => ({ value: r.value, label: r.label, labelTextStyle: axisText, tip: [r.label, `Created ${r.value}`] }))}
            width={plot}
            height={110}
            maxValue={chartTopValue(rows.map((r) => r.value))}
            barWidth={barWidth}
            spacing={spacing}
            initialSpacing={spacing / 2}
            endSpacing={spacing / 2}
            frontColor={AN.blue}
            roundedTop
            barBorderTopLeftRadius={3}
            barBorderTopRightRadius={3}
            noOfSections={4}
            yAxisLabelWidth={Y_LABEL_WIDTH}
            yAxisThickness={0}
            xAxisThickness={1}
            xAxisColor={AN.border}
            rulesColor={AN.grid}
            rulesType="solid"
            yAxisTextStyle={axisText}
            xAxisLabelTextStyle={axisText}
            showValuesAsTopLabel
            topLabelTextStyle={{ fontSize: 10, color: AN.text, fontWeight: '600' }}
            renderTooltip={(item: { tip?: string[] }) => (item.tip ? <Tooltip lines={item.tip} /> : null)}
          />
        );
      }}
    </AnalyticsCard>
  );
}

/** "Afternoon shift has the highest number of overdue tasks." — only when
 * the data actually supports it: null when every shift is at zero, and a
 * tie is named as a tie rather than arbitrarily picking one shift. */
export function shiftInsight(rows: { label: string; value: number }[]): string | null {
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => r.value));
  if (max <= 0) return null;
  const top = rows.filter((r) => r.value === max);
  if (top.length === 1) return `${top[0].label} shift has the highest number of overdue tasks.`;
  return `${top.map((r) => r.label).join(' and ')} shifts are tied for the most overdue tasks.`;
}

/** Shift & Delay Analysis — overdue tasks per real duty shift. */
export function ShiftDelayCard({ data, loading, filterSummary, style }: ChartProps) {
  const rows = useMemo(() => data?.delayData || [], [data]);
  const insight = useMemo(() => shiftInsight(rows), [rows]);

  return (
    <AnalyticsCard
      style={style}
      icon={Clock}
      title="Shift & Delay Analysis"
      subtitle={`Overdue tasks by shift · ${filterSummary}`}
      loading={loading}
      hasData={rows.length > 0}
    >
      {(inner) => {
        const sideBySide = inner >= 380;
        // The chart's box is fixed and clipped so the library's own extra
        // axis width can never push the insight panel off the card.
        const boxWidth = sideBySide ? Math.floor(inner * 0.6) : inner;
        const chartWidth = boxWidth - Y_LABEL_WIDTH - 20;
        const { barWidth, spacing } = barSizing(rows.length, chartWidth);
        return (
          <View style={sideBySide ? styles.shiftRow : styles.gap10}>
            <View style={{ width: boxWidth, overflow: 'hidden' }}>
            <BarChart
              data={rows.map((r) => ({ value: r.value, label: r.label, labelTextStyle: axisText, tip: [`${r.label} shift`, `Overdue ${r.value}`] }))}
              width={chartWidth}
              height={92}
              maxValue={chartTopValue(rows.map((r) => r.value))}
              barWidth={Math.min(barWidth, 30)}
              spacing={spacing}
              initialSpacing={spacing / 2}
              endSpacing={spacing / 2}
              frontColor={AN.orange}
              roundedTop
              barBorderTopLeftRadius={3}
              barBorderTopRightRadius={3}
              noOfSections={4}
              yAxisLabelWidth={Y_LABEL_WIDTH}
              yAxisThickness={0}
              xAxisThickness={1}
              xAxisColor={AN.border}
              rulesColor={AN.grid}
              rulesType="solid"
              yAxisTextStyle={axisText}
              xAxisLabelTextStyle={axisText}
              showValuesAsTopLabel
              topLabelTextStyle={{ fontSize: 10, color: AN.text, fontWeight: '600' }}
              renderTooltip={(item: { tip?: string[] }) => (item.tip ? <Tooltip lines={item.tip} /> : null)}
            />
            </View>
            <View style={[styles.insight, sideBySide && styles.flex1]}>
              <View style={styles.insightIcon}>
                <AlertTriangle size={13} color={AN.orange} />
              </View>
              <Text style={styles.insightText}>{insight || 'No overdue tasks in this period.'}</Text>
            </View>
          </View>
        );
      }}
    </AnalyticsCard>
  );
}

/** Task Type Distribution — task categories, real counts behind each slice. */
export function TaskTypeCard({ data, loading, filterSummary, style }: ChartProps) {
  const totalTasks = data?.kpis.totalTasks ?? 0;
  const rows = (data?.taskTypes || []).map((t) => ({
    name: humanizeCategory(t.label),
    color: t.color,
    // count is the real number; an older backend without it falls back to
    // deriving one from the rounded percentage.
    count: t.count ?? Math.round((t.value / 100) * totalTasks),
    text: t.text,
  }));
  const total = rows.reduce((s, r) => s + r.count, 0);

  return (
    <AnalyticsCard
      style={style}
      icon={PieChartIcon}
      title="Task Type Distribution"
      subtitle={`Distribution of task categories · ${filterSummary}`}
      loading={loading}
      hasData={total > 0}
    >
      {(inner) => {
        const radius = Math.max(Math.min(inner * 0.16, 58), 44);
        return (
          <View style={styles.donutRow}>
            <PieChart
              data={rows.filter((r) => r.count > 0).map((r) => ({ value: r.count, color: r.color }))}
              donut
              radius={radius}
              innerRadius={radius * 0.68}
              innerCircleColor="#FFFFFF"
              centerLabelComponent={() => (
                <View style={styles.donutCenter}>
                  <Text style={styles.donutValueSm}>{total}</Text>
                  <Text style={styles.donutLabel}>Total Tasks</Text>
                </View>
              )}
            />
            <View style={styles.sideLegend}>
              {rows.map((r) => (
                <View key={r.name} style={styles.sideLegendRowSm}>
                  <View style={[styles.legendBullet, { backgroundColor: r.color }]} />
                  <Text style={styles.sideLegendNameSm} numberOfLines={1}>{r.name}</Text>
                  <Text style={styles.sideLegendCountSm}>{r.count}</Text>
                  <Text style={styles.sideLegendPct}>{pct(r.count, total)}</Text>
                </View>
              ))}
            </View>
          </View>
        );
      }}
    </AnalyticsCard>
  );
}

const CARD_PAD = 16;

const styles = StyleSheet.create({
  flex1: { flex: 1, minWidth: 0 },
  gap10: { gap: 10 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: AN.border,
    padding: CARD_PAD,
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
    minWidth: 0,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  cardIcon: {
    width: 28, height: 28, borderRadius: 8, backgroundColor: AN.blueSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: AN.navy },
  cardSubtitle: { fontSize: 11.5, color: AN.text2, marginTop: 1 },
  empty: { fontSize: 12.5, color: AN.text2, textAlign: 'center', paddingVertical: 36 },
  legendInline: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10, maxWidth: '55%' },
  legendInlineItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendInlineText: { fontSize: 10.5, color: AN.text2, fontWeight: '500' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  tooltip: {
    backgroundColor: AN.navy, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4,
    marginBottom: 4, marginLeft: -8, maxWidth: 190,
  },
  tooltipText: { color: '#FFFFFF', fontSize: 10.5, lineHeight: 13 },
  flowFooter: {
    flexDirection: 'row', alignItems: 'center', marginTop: 10, paddingVertical: 8, paddingHorizontal: 10,
    backgroundColor: '#F7FAFF', borderRadius: 10, gap: 12,
  },
  flowStat: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  flowStatIcon: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  flowStatLabel: { fontSize: 10.5, color: AN.text2 },
  flowStatValue: { fontSize: 14, fontWeight: '700', color: AN.navy },
  flowDivider: { width: 1, alignSelf: 'stretch', backgroundColor: AN.border },
  donutRow: { flexDirection: 'row', alignItems: 'center', gap: 20, paddingVertical: 4 },
  donutCenter: { alignItems: 'center', justifyContent: 'center' },
  donutValue: { fontSize: 22, fontWeight: '800', color: AN.navy },
  donutValueSm: { fontSize: 17, fontWeight: '800', color: AN.navy },
  donutLabel: { fontSize: 9.5, color: AN.text2 },
  sideLegend: { flex: 1, minWidth: 0, gap: 4 },
  sideLegendRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  sideLegendRowSm: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  legendBullet: { width: 11, height: 11, borderRadius: 6 },
  sideLegendName: { flex: 1, fontSize: 13, color: AN.text, fontWeight: '500' },
  sideLegendNameSm: { flex: 1, fontSize: 11.5, color: AN.text, fontWeight: '500' },
  sideLegendCount: { fontSize: 14, fontWeight: '700', color: AN.navy, minWidth: 30, textAlign: 'right' },
  sideLegendCountSm: { fontSize: 11.5, fontWeight: '700', color: AN.navy, minWidth: 26, textAlign: 'right' },
  sideLegendPct: { fontSize: 11, color: AN.text2, minWidth: 34, textAlign: 'right' },
  shiftRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  insight: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: AN.orangeSoft, borderRadius: 10, borderWidth: 1, borderColor: '#FCE3B6', padding: 10,
  },
  insightIcon: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
  },
  insightText: { flex: 1, fontSize: 11.5, color: '#B45309', lineHeight: 16, fontWeight: '500' },
});
