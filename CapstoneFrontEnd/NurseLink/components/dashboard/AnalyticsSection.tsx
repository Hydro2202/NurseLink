import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, LayoutChangeEvent, useWindowDimensions } from 'react-native';
import { BarChart, LineChart, PieChart } from '../Charts';
import { TrendingUp, Activity, ListChecks, Clock, PieChart as PieChartIcon, BedDouble, Users } from 'lucide-react-native';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../Card';
import { Colors } from '../../constants/colors';
import type { AnalyticsData } from '../../types/domain';

// Card.tsx's own content inset (1px border + 24px padding, each side) —
// the chart inside a card must subtract this or it overflows/clips.
const CARD_INSET = (1 + 24) * 2;
/** Below this measured card width, a chart stacks to one column even on an
 * otherwise-wide screen (matches the dashboard's own phone/desktop split). */
const TWO_COLUMN_MIN_WIDTH = 640;

function humanizeCategory(label?: string): string {
  if (!label) return 'Other';
  return label.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function computeBarSizing(count: number, chartWidth: number) {
  const usable = Math.max(chartWidth - 40, 120);
  const slot = usable / Math.max(count, 1);
  const spacing = Math.max(Math.min(slot * 0.5, 32), 10);
  const barWidth = Math.max(Math.min(slot - spacing, 44), 16);
  return { barWidth, spacing };
}

const axisLabelStyle = { fontSize: 10, color: Colors.mutedForeground, fontWeight: '500' as const };
const yAxisTextStyle = { fontSize: 10, color: Colors.mutedForeground };
const topLabelTextStyle = { fontSize: 10, color: Colors.gray700, fontWeight: '600' as const };

function useMeasuredWidth() {
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const next = e.nativeEvent.layout.width;
    setWidth((prev) => (Math.abs(prev - next) > 1 ? next : prev));
  }, []);
  return [width, onLayout] as const;
}

interface ChartCardProps {
  icon: React.ComponentType<{ size?: number; color?: string }>;
  iconTint: string;
  iconColor: string;
  title: string;
  description: string;
  hasData: boolean;
  children: (chartWidth: number) => React.ReactNode;
  footnote?: string;
  /** Grid placement (full-width on phone, half-width on desktop) — owned by
   * the caller, not this card, since it depends on the whole grid's layout. */
  itemStyle: object;
}

/** One chart's card: measures its own rendered width (so the same chart
 * looks right whether the grid below put it at full width on phone or half
 * width on desktop) and swaps in a "no data" message instead of an empty
 * chart canvas. */
function ChartCard({ icon: Icon, iconTint, iconColor, title, description, hasData, children, footnote, itemStyle }: ChartCardProps) {
  const [measuredWidth, onLayout] = useMeasuredWidth();
  const chartWidth = Math.min(Math.max(measuredWidth - CARD_INSET, 220), 560);

  return (
    <View style={itemStyle} onLayout={onLayout}>
      <Card>
        <CardHeader style={styles.chartHeader}>
          <View style={styles.chartHeaderRow}>
            <View style={[styles.chartIconWrap, { backgroundColor: iconTint }]}>
              <Icon size={16} color={iconColor} />
            </View>
            <View style={styles.flex1}>
              <CardTitle>{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </View>
          </View>
        </CardHeader>
        <CardContent>
          {!hasData ? (
            <Text style={styles.noData}>No data for these filters.</Text>
          ) : chartWidth > 0 ? (
            children(chartWidth)
          ) : null}
          {hasData && footnote ? <Text style={styles.chartFootnote}>{footnote}</Text> : null}
        </CardContent>
      </Card>
    </View>
  );
}

interface AnalyticsSectionProps {
  data: AnalyticsData | null;
  loading: boolean;
  /** e.g. "Last 7 days · Medical Ward" — appended to every chart's
   * description so it's clear what period/filter each one reflects. */
  filterSummary: string;
}

/**
 * The 5 Analytics charts (Task Completion, Workload Trend, Task Volume,
 * Delay by Shift, Task Types) as an always-visible grid — 2 columns on
 * desktop, 1 on phone — folded into the head nurse dashboard from what
 * used to be the separate Analytics page (see app/(app)/analytics.tsx, now
 * a redirect). Not behind tabs: the spec for this section is that every
 * chart is visible without an extra tap.
 */
export function AnalyticsSection({ data, loading, filterSummary }: AnalyticsSectionProps) {
  const { width } = useWindowDimensions();
  const twoColumn = width >= TWO_COLUMN_MIN_WIDTH;
  const itemStyle = twoColumn ? styles.gridItemHalf : styles.gridItemFull;

  if (loading) {
    return (
      <View style={styles.loadingBox}>
        <Text style={styles.muted}>Loading analytics…</Text>
      </View>
    );
  }

  const taskCompletion = data?.taskCompletion || [];
  const workloadTrend = data?.workloadTrend || [];
  const delayData = (data?.delayData || []).map((d) => ({ ...d, frontColor: Colors.warning }));
  const taskVolume = (data?.avgTasks || []).map((item, i) => ({
    ...item, label: `Wk ${i + 1}`, frontColor: Colors.blue500,
  }));
  const taskTypes = data?.taskTypes || [];
  const taskTypeLegend = taskTypes.map((t) => ({ color: t.color, label: humanizeCategory(t.label), value: t.text }));
  const totalTasks = data?.kpis.totalTasks ?? 0;

  // Patient flow: admissions (blue) and discharges (green) side by side per day.
  const patientFlow = data?.patientFlow || [];
  const flowBars = patientFlow.flatMap((d) => [
    { value: d.admissions, label: d.label, spacing: 2, frontColor: Colors.blue600, labelWidth: 44 },
    { value: d.discharges, frontColor: Colors.green600 },
  ]);
  const totalAdmissions = patientFlow.reduce((sum, d) => sum + d.admissions, 0);
  const totalDischarges = patientFlow.reduce((sum, d) => sum + d.discharges, 0);
  const STATUS_COLORS: Record<string, string> = {
    admitted: Colors.blue600,
    observation: Colors.warning,
    discharged: Colors.green600,
  };
  const patientStatus = (data?.patientStatus || []).map((s) => ({
    ...s,
    color: STATUS_COLORS[s.status] || Colors.gray400,
  }));
  const totalPatients = patientStatus.reduce((sum, s) => sum + s.value, 0);

  return (
    <View style={styles.grid}>
      <ChartCard
        itemStyle={itemStyle}
        icon={BedDouble}
        iconTint={Colors.blue50}
        iconColor={Colors.blue600}
        title="Patient Flow"
        description={`Admissions vs discharges · ${filterSummary}`}
        hasData={totalAdmissions + totalDischarges > 0}
        footnote={
          `${totalAdmissions} admitted · ${totalDischarges} discharged` +
          (data?.avgLengthOfStayDays != null ? ` · average stay ${data.avgLengthOfStayDays} day(s)` : '')
        }
      >
        {(chartWidth) => {
          const sizing = computeBarSizing(patientFlow.length, chartWidth);
          return (
            <View>
              <View style={styles.flowLegend}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendSwatch, { backgroundColor: Colors.blue600 }]} />
                  <Text style={styles.legendLabel}>Admissions</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendSwatch, { backgroundColor: Colors.green600 }]} />
                  <Text style={styles.legendLabel}>Discharges</Text>
                </View>
              </View>
              <BarChart
                data={flowBars}
                width={chartWidth}
                height={200}
                barWidth={Math.max(sizing.barWidth / 2, 8)}
                spacing={sizing.spacing}
                roundedTop
                noOfSections={4}
                yAxisThickness={0}
                xAxisThickness={1}
                xAxisColor={Colors.border}
                rulesColor={Colors.border}
                rulesType="dashed"
                yAxisTextStyle={yAxisTextStyle}
                xAxisLabelTextStyle={axisLabelStyle}
              />
            </View>
          );
        }}
      </ChartCard>

      <ChartCard
        itemStyle={itemStyle}
        icon={Users}
        iconTint={Colors.blue50}
        iconColor={Colors.blue600}
        title="Patients by Status"
        description="Current admitted, under observation and discharged patients"
        hasData={totalPatients > 0}
      >
        {() => (
          <View style={styles.pieWrap}>
            <PieChart
              data={patientStatus.filter((s) => s.value > 0)}
              donut
              radius={92}
              innerRadius={58}
              centerLabelComponent={() => (
                <View style={styles.pieCenter}>
                  <Text style={styles.pieCenterValue}>{totalPatients}</Text>
                  <Text style={styles.pieCenterLabel}>Patients</Text>
                </View>
              )}
            />
            <View style={styles.legendGrid}>
              {patientStatus.map((s) => (
                <View key={s.status} style={styles.legendItem}>
                  <View style={[styles.legendSwatch, { backgroundColor: s.color }]} />
                  <Text style={styles.legendLabel}>
                    {s.label} <Text style={styles.legendValue}>{s.value}</Text>
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </ChartCard>
      <ChartCard
        itemStyle={itemStyle}
        icon={TrendingUp}
        iconTint={Colors.green50}
        iconColor={Colors.green600}
        title="Task Completion"
        description={`Completed tasks · ${filterSummary}`}
        hasData={taskCompletion.some((d) => d.value > 0)}
        footnote="Value shown above each bar is the number of tasks completed that day."
      >
        {(chartWidth) => {
          const sizing = computeBarSizing(taskCompletion.length, chartWidth);
          return (
            <BarChart
              data={taskCompletion}
              width={chartWidth}
              height={200}
              barWidth={sizing.barWidth}
              spacing={sizing.spacing}
              initialSpacing={sizing.spacing / 2}
              endSpacing={sizing.spacing / 2}
              roundedTop
              frontColor={Colors.green600}
              rulesColor={Colors.border}
              rulesThickness={1}
              xAxisThickness={0}
              yAxisThickness={0}
              yAxisTextStyle={yAxisTextStyle}
              xAxisLabelTextStyle={axisLabelStyle}
              noOfSections={4}
              showValuesAsTopLabel
              topLabelTextStyle={topLabelTextStyle}
            />
          );
        }}
      </ChartCard>

      <ChartCard
        itemStyle={itemStyle}
        icon={Activity}
        iconTint={Colors.blue50}
        iconColor={Colors.blue600}
        title="Workload Trend"
        description={`Average patients per nurse · ${filterSummary}`}
        hasData={workloadTrend.length > 0}
      >
        {(chartWidth) => (
          <LineChart
            data={workloadTrend}
            width={chartWidth}
            height={190}
            curved
            color={Colors.blue600}
            thickness={2.5}
            areaChart
            startFillColor={Colors.blue500}
            endFillColor={Colors.blue500}
            startOpacity={0.22}
            endOpacity={0.02}
            dataPointsColor={Colors.blue600}
            dataPointsRadius={4}
            rulesColor={Colors.border}
            rulesThickness={1}
            xAxisThickness={0}
            yAxisThickness={0}
            yAxisTextStyle={yAxisTextStyle}
            xAxisLabelTextStyle={axisLabelStyle}
            formatYLabel={(v: string) => Number(v).toFixed(1)}
            noOfSections={4}
            initialSpacing={20}
            endSpacing={20}
          />
        )}
      </ChartCard>

      <ChartCard
        itemStyle={itemStyle}
        icon={ListChecks}
        iconTint={Colors.blue50}
        iconColor={Colors.blue600}
        title="Task Volume"
        description={`Tasks created · ${filterSummary}`}
        hasData={taskVolume.some((d) => d.value > 0)}
      >
        {(chartWidth) => {
          const sizing = computeBarSizing(taskVolume.length, chartWidth);
          return (
            <BarChart
              data={taskVolume}
              width={chartWidth}
              height={180}
              barWidth={sizing.barWidth}
              spacing={sizing.spacing}
              initialSpacing={sizing.spacing / 2}
              endSpacing={sizing.spacing / 2}
              roundedTop
              rulesColor={Colors.border}
              rulesThickness={1}
              xAxisThickness={0}
              yAxisThickness={0}
              yAxisTextStyle={yAxisTextStyle}
              xAxisLabelTextStyle={axisLabelStyle}
              noOfSections={4}
              showValuesAsTopLabel
              topLabelTextStyle={topLabelTextStyle}
            />
          );
        }}
      </ChartCard>

      <ChartCard
        itemStyle={itemStyle}
        icon={Clock}
        iconTint={Colors.warningLight}
        iconColor={Colors.warningHover}
        title="Delay by Shift"
        description={`Overdue tasks per shift · ${filterSummary}`}
        hasData={delayData.some((d) => d.value > 0)}
      >
        {(chartWidth) => {
          const sizing = computeBarSizing(delayData.length, chartWidth);
          return (
            <BarChart
              data={delayData}
              width={chartWidth}
              height={180}
              barWidth={sizing.barWidth}
              spacing={sizing.spacing}
              initialSpacing={sizing.spacing / 2}
              endSpacing={sizing.spacing / 2}
              roundedTop
              rulesColor={Colors.border}
              rulesThickness={1}
              xAxisThickness={0}
              yAxisThickness={0}
              yAxisTextStyle={yAxisTextStyle}
              xAxisLabelTextStyle={axisLabelStyle}
              xAxisTextNumberOfLines={2}
              noOfSections={4}
              showValuesAsTopLabel
              topLabelTextStyle={topLabelTextStyle}
            />
          );
        }}
      </ChartCard>

      <ChartCard
        itemStyle={itemStyle}
        icon={PieChartIcon}
        iconTint={Colors.purple50}
        iconColor={Colors.purple600}
        title="Task Types"
        description={`Distribution of task categories · ${filterSummary}`}
        hasData={taskTypes.length > 0}
      >
        {() => (
          <View style={styles.pieWrap}>
            <PieChart
              data={taskTypes}
              donut
              radius={92}
              innerRadius={58}
              centerLabelComponent={() => (
                <View style={styles.pieCenter}>
                  <Text style={styles.pieCenterValue}>{totalTasks}</Text>
                  <Text style={styles.pieCenterLabel}>Tasks</Text>
                </View>
              )}
            />
            <View style={styles.legendGrid}>
              {taskTypeLegend.map((item) => (
                <View key={item.label} style={styles.legendItem}>
                  <View style={[styles.legendSwatch, { backgroundColor: item.color }]} />
                  <Text style={styles.legendLabel}>
                    {item.label} <Text style={styles.legendValue}>{item.value}</Text>
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </ChartCard>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingBox: { paddingVertical: 32, alignItems: 'center' },
  muted: { color: Colors.mutedForeground },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  gridItemFull: { flexGrow: 1, flexBasis: '100%', minWidth: 280 },
  gridItemHalf: { flexGrow: 1, flexBasis: '47%', minWidth: 320 },
  flex1: { flex: 1, minWidth: 0 },
  chartHeader: { paddingBottom: 12 },
  chartHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chartIconWrap: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  chartFootnote: { fontSize: 11, color: Colors.mutedForeground, marginTop: 8 },
  noData: { fontSize: 13, color: Colors.mutedForeground, textAlign: 'center', paddingVertical: 32 },
  pieWrap: { alignItems: 'center' },
  flowLegend: { flexDirection: 'row', gap: 16, marginBottom: 8 },
  legendGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 16, paddingTop: 14,
    borderTopWidth: 1, borderTopColor: Colors.border, width: '100%', justifyContent: 'center',
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 10, height: 10, borderRadius: 3 },
  legendLabel: { fontSize: 12, color: Colors.gray700, fontWeight: '500' },
  legendValue: { color: Colors.mutedForeground, fontWeight: '400' },
  pieCenter: { alignItems: 'center', justifyContent: 'center' },
  pieCenterValue: { fontSize: 20, fontWeight: '700', color: Colors.gray900 },
  pieCenterLabel: { fontSize: 11, color: Colors.mutedForeground },
});
