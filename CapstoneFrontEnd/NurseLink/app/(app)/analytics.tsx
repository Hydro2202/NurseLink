import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  LayoutChangeEvent,
} from 'react-native';
// Wrapper that honours the Show Charts & Graphs setting; same API.
import { BarChart, LineChart, PieChart } from '../../components/Charts';
import {
  TrendingUp,
  Clock,
  AlertTriangle,
  Activity,
  ListChecks,
  CheckCircle2,
  Users,
  PieChart as PieChartIcon,
} from 'lucide-react-native';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/Card';
import { Tabs } from '../../components/Tabs';
import { Colors } from '../../constants/colors';
import { fetchAnalytics, ApiError } from '../../services/api';
import type { AnalyticsData } from '../../types/domain';
import { useToast } from '../../contexts/ToastContext';

/** Measures the real rendered width of a full-width container (e.g. the
 * scroll content) via onLayout, instead of deriving it from
 * useWindowDimensions() minus hardcoded padding constants — that approach
 * silently drifts out of sync whenever Card/ScrollView padding changes
 * (as happened when Card's padding moved from 16 to 24). */
function useMeasuredWidth() {
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const next = e.nativeEvent.layout.width;
    setWidth((prev) => (Math.abs(prev - next) > 1 ? next : prev));
  }, []);
  return [width, onLayout] as const;
}

// Card.tsx's own content inset (1px border + 24px padding, each side).
const CARD_INSET = (1 + 24) * 2;

function humanizeCategory(label?: string) {
  if (!label) return 'Other';
  return label
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Picks a bar width/spacing pair that scales with both the data length and
 * the available chart width, so bars stay evenly sized instead of the fixed
 * per-chart magic numbers looking cramped on narrow phones or stretched out
 * on tablets. */
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

export default function AnalyticsPage() {
  const [measuredWidth, onLayout] = useMeasuredWidth();
  const chartWidth = Math.min(Math.max(measuredWidth - CARD_INSET, 240), 560);
  const toast = useToast();
  const [tab, setTab] = useState('completion');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AnalyticsData | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const analytics = await fetchAnalytics();
        if (!cancelled) setData(analytics);
      } catch (error) {
        if (!cancelled) {
          toast.error('Failed to load analytics', {
            description: error instanceof ApiError ? error.message : 'Please try again.',
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  const tabs = useMemo(
    () => [
      { value: 'completion', label: 'Completion' },
      { value: 'workload', label: 'Workload' },
      { value: 'distribution', label: 'Types' },
    ],
    []
  );

  const kpis = data?.kpis;

  const kpiItems = useMemo(
    () => [
      { key: 'completion', icon: TrendingUp, color: Colors.green600, tint: Colors.green50, value: `${kpis?.completionRate ?? 0}%`, label: 'Completion Rate' },
      { key: 'total', icon: ListChecks, color: Colors.blue600, tint: Colors.blue50, value: `${kpis?.totalTasks ?? 0}`, label: 'Total Tasks' },
      { key: 'completed', icon: CheckCircle2, color: Colors.green600, tint: Colors.green50, value: `${kpis?.completedTasks ?? 0}`, label: 'Completed Tasks' },
      { key: 'overdue', icon: AlertTriangle, color: Colors.destructive, tint: Colors.red50, value: `${kpis?.overdueTasks ?? 0}`, label: 'Overdue Tasks' },
      { key: 'nurses', icon: Users, color: Colors.purple600, tint: Colors.purple50, value: `${kpis?.activeNurses ?? 0}`, label: 'Active Nurses' },
      { key: 'ratio', icon: Activity, color: Colors.purple600, tint: Colors.purple50, value: `${kpis?.avgPatientsPerNurse ?? 0}`, label: 'Avg Patients / Nurse' },
      { key: 'response', icon: Clock, color: Colors.warningHover, tint: Colors.warningLight, value: `${kpis?.avgResponseMinutes ?? 0}m`, label: 'Avg Response' },
    ],
    [kpis]
  );

  const taskCompletion = data?.taskCompletion || [];
  const workloadTrend = data?.workloadTrend || [];
  const delayData = useMemo(
    () => (data?.delayData || []).map((d) => ({ ...d, frontColor: Colors.warning })),
    [data]
  );
  const taskVolume = useMemo(
    () => (data?.avgTasks || []).map((item, i) => ({ ...item, label: `Wk ${i + 1}`, frontColor: Colors.blue500 })),
    [data]
  );
  const taskTypes = useMemo(() => data?.taskTypes || [], [data]);

  const taskTypeLegend = useMemo(
    () => taskTypes.map((t) => ({ color: t.color, label: humanizeCategory(t.label), value: t.text })),
    [taskTypes]
  );

  if (loading) {
    return (
      <View style={[styles.scroll, { alignItems: 'center', justifyContent: 'center', paddingTop: 80 }]}>
        <ActivityIndicator size="large" color={Colors.blue600} />
      </View>
    );
  }

  const completionSizing = computeBarSizing(taskCompletion.length, chartWidth);
  const volumeSizing = computeBarSizing(taskVolume.length, chartWidth);
  const delaySizing = computeBarSizing(delayData.length, chartWidth);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View onLayout={onLayout}>
        <Text style={styles.title}>Analytics</Text>
        <Text style={styles.subtitle}>Operational insights from live hospital data</Text>

        <View style={styles.kpiRow}>
          {kpiItems.map((kpi) => (
            <Card key={kpi.key} style={styles.kpiCard}>
              <CardContent style={styles.kpiContent}>
                <View style={[styles.kpiIconWrap, { backgroundColor: kpi.tint }]}>
                  <kpi.icon size={18} color={kpi.color} />
                </View>
                <Text style={styles.kpiValue}>{kpi.value}</Text>
                <Text style={styles.kpiLabel}>{kpi.label}</Text>
              </CardContent>
            </Card>
          ))}
        </View>

        <View style={styles.tabsWrap}>
          <Tabs tabs={tabs} value={tab} onValueChange={setTab} />
        </View>

        {tab === 'completion' ? (
          <Card style={styles.chartCard}>
            <CardHeader style={styles.chartHeader}>
              <View style={styles.chartHeaderRow}>
                <View style={[styles.chartIconWrap, { backgroundColor: Colors.green50 }]}>
                  <TrendingUp size={16} color={Colors.green600} />
                </View>
                <View style={{ flex: 1 }}>
                  <CardTitle>Task Completion</CardTitle>
                  <CardDescription>Completed tasks over the last 7 days</CardDescription>
                </View>
              </View>
            </CardHeader>
            <CardContent>
              {chartWidth > 0 ? (
                <BarChart
                  data={taskCompletion}
                  width={chartWidth}
                  height={200}
                  barWidth={completionSizing.barWidth}
                  spacing={completionSizing.spacing}
                  initialSpacing={completionSizing.spacing / 2}
                  endSpacing={completionSizing.spacing / 2}
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
              ) : null}
              <Text style={styles.chartFootnote}>Value shown above each bar is the number of tasks completed that day.</Text>
            </CardContent>
          </Card>
        ) : null}

        {tab === 'workload' ? (
          <>
            <Card style={styles.chartCard}>
              <CardHeader style={styles.chartHeader}>
                <View style={styles.chartHeaderRow}>
                  <View style={[styles.chartIconWrap, { backgroundColor: Colors.blue50 }]}>
                    <Activity size={16} color={Colors.blue600} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <CardTitle>Workload Trend</CardTitle>
                    <CardDescription>Average patients per nurse, last 4 weeks</CardDescription>
                  </View>
                </View>
              </CardHeader>
              <CardContent>
                {chartWidth > 0 ? (
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
                ) : null}
              </CardContent>
            </Card>
            <Card style={styles.chartCard}>
              <CardHeader style={styles.chartHeader}>
                <View style={styles.chartHeaderRow}>
                  <View style={[styles.chartIconWrap, { backgroundColor: Colors.blue50 }]}>
                    <ListChecks size={16} color={Colors.blue600} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <CardTitle>Task Volume</CardTitle>
                    <CardDescription>Tasks created, last 4 two-day windows</CardDescription>
                  </View>
                </View>
              </CardHeader>
              <CardContent>
                {chartWidth > 0 ? (
                  <BarChart
                    data={taskVolume}
                    width={chartWidth}
                    height={180}
                    barWidth={volumeSizing.barWidth}
                    spacing={volumeSizing.spacing}
                    initialSpacing={volumeSizing.spacing / 2}
                    endSpacing={volumeSizing.spacing / 2}
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
                ) : null}
              </CardContent>
            </Card>
            <Card style={styles.chartCard}>
              <CardHeader style={styles.chartHeader}>
                <View style={styles.chartHeaderRow}>
                  <View style={[styles.chartIconWrap, { backgroundColor: Colors.warningLight }]}>
                    <Clock size={16} color={Colors.warningHover} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <CardTitle>Delay by Shift</CardTitle>
                    <CardDescription>Overdue tasks per shift</CardDescription>
                  </View>
                </View>
              </CardHeader>
              <CardContent>
                {chartWidth > 0 ? (
                  <BarChart
                    data={delayData}
                    width={chartWidth}
                    height={180}
                    barWidth={delaySizing.barWidth}
                    spacing={delaySizing.spacing}
                    initialSpacing={delaySizing.spacing / 2}
                    endSpacing={delaySizing.spacing / 2}
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
                ) : null}
              </CardContent>
            </Card>
          </>
        ) : null}

        {tab === 'distribution' ? (
          <Card style={styles.chartCard}>
            <CardHeader style={styles.chartHeader}>
              <View style={styles.chartHeaderRow}>
                <View style={[styles.chartIconWrap, { backgroundColor: Colors.purple50 }]}>
                  <PieChartIcon size={16} color={Colors.purple600} />
                </View>
                <View style={{ flex: 1 }}>
                  <CardTitle>Task Types</CardTitle>
                  <CardDescription>Distribution of task categories</CardDescription>
                </View>
              </View>
            </CardHeader>
            <CardContent style={{ alignItems: 'center' }}>
              {taskTypes.length ? (
                <>
                  <PieChart
                    data={taskTypes}
                    donut
                    radius={92}
                    innerRadius={58}
                    centerLabelComponent={() => (
                      <View style={styles.pieCenter}>
                        <Text style={styles.pieCenterValue}>{kpis?.totalTasks ?? 0}</Text>
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
                </>
              ) : (
                <Text style={styles.empty}>No task type data yet.</Text>
              )}
            </CardContent>
          </Card>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.gray50 },
  content: { padding: 16, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: '700', color: Colors.gray900 },
  subtitle: { fontSize: 13, color: Colors.gray500, marginBottom: 16 },

  kpiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  kpiCard: { flexGrow: 1, flexBasis: '47%', minWidth: 150 },
  kpiContent: { padding: 14, gap: 4 },
  kpiIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  kpiValue: { fontSize: 22, fontWeight: '700', color: Colors.gray900 },
  kpiLabel: { fontSize: 12, color: Colors.mutedForeground, fontWeight: '500' },

  tabsWrap: { marginTop: 16, marginBottom: 4 },

  chartCard: { marginTop: 12 },
  chartHeader: { paddingBottom: 12 },
  chartHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chartIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chartFootnote: { fontSize: 11, color: Colors.mutedForeground, marginTop: 8 },

  legendGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    width: '100%',
    justifyContent: 'center',
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 10, height: 10, borderRadius: 3 },
  legendLabel: { fontSize: 12, color: Colors.gray700, fontWeight: '500' },
  legendValue: { color: Colors.mutedForeground, fontWeight: '400' },

  pieCenter: { alignItems: 'center', justifyContent: 'center' },
  pieCenterValue: { fontSize: 20, fontWeight: '700', color: Colors.gray900 },
  pieCenterLabel: { fontSize: 11, color: Colors.mutedForeground },

  empty: { color: Colors.gray500, paddingVertical: 24 },
});
