import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  ActivityIndicator,
} from 'react-native';
import { BarChart, LineChart, PieChart } from 'react-native-gifted-charts';
import {
  TrendingUp,
  Clock,
  AlertTriangle,
  Activity,
} from 'lucide-react-native';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/Card';
import { Tabs } from '../../components/Tabs';
import { Colors } from '../../constants/colors';
import { fetchAnalytics, ApiError } from '../../services/api';
import type { AnalyticsData } from '../../types/domain';
import { useToast } from '../../contexts/ToastContext';

export default function AnalyticsPage() {
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(width - 64, 280);
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
  }, []);

  const tabs = useMemo(
    () => [
      { value: 'completion', label: 'Completion' },
      { value: 'workload', label: 'Workload' },
      { value: 'distribution', label: 'Types' },
      { value: 'burnout', label: 'Burnout' },
    ],
    []
  );

  if (loading) {
    return (
      <View style={[styles.scroll, { alignItems: 'center', justifyContent: 'center', paddingTop: 80 }]}>
        <ActivityIndicator size="large" color={Colors.blue600} />
      </View>
    );
  }

  const taskCompletion = data?.taskCompletion || [];
  const workloadTrend = data?.workloadTrend || [];
  const avgTasks = data?.avgTasks || [];
  const delayData = data?.delayData || [];
  const taskTypes = data?.taskTypes || [];
  const burnout = data?.burnout || [];
  const kpis = data?.kpis;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.title}>Analytics</Text>
      <Text style={styles.subtitle}>Operational insights from live hospital data</Text>

      <View style={styles.kpiRow}>
        <Card style={styles.kpiCard}>
          <CardContent style={styles.kpiContent}>
            <TrendingUp size={16} color={Colors.green600} />
            <Text style={styles.kpiValue}>{kpis?.completionRate ?? 0}%</Text>
            <Text style={styles.kpiLabel}>Completion</Text>
          </CardContent>
        </Card>
        <Card style={styles.kpiCard}>
          <CardContent style={styles.kpiContent}>
            <Clock size={16} color={Colors.blue600} />
            <Text style={styles.kpiValue}>{kpis?.avgResponseMinutes ?? 0}m</Text>
            <Text style={styles.kpiLabel}>Avg Response</Text>
          </CardContent>
        </Card>
        <Card style={styles.kpiCard}>
          <CardContent style={styles.kpiContent}>
            <AlertTriangle size={16} color={Colors.destructive} />
            <Text style={styles.kpiValue}>{kpis?.overdueTasks ?? 0}</Text>
            <Text style={styles.kpiLabel}>Overdue</Text>
          </CardContent>
        </Card>
        <Card style={styles.kpiCard}>
          <CardContent style={styles.kpiContent}>
            <Activity size={16} color={Colors.blue600} />
            <Text style={styles.kpiValue}>{kpis?.activeNurses ?? 0}</Text>
            <Text style={styles.kpiLabel}>Nurses</Text>
          </CardContent>
        </Card>
      </View>

      <Tabs tabs={tabs} value={tab} onValueChange={setTab} />

      {tab === 'completion' ? (
        <Card style={styles.chartCard}>
          <CardHeader>
            <CardTitle>Task Completion</CardTitle>
            <CardDescription>Completed tasks over the last 7 days</CardDescription>
          </CardHeader>
          <CardContent>
            <BarChart
              data={taskCompletion}
              width={chartWidth}
              height={180}
              barWidth={22}
              spacing={16}
              roundedTop
              hideRules
              xAxisThickness={0}
              yAxisThickness={0}
              noOfSections={4}
            />
          </CardContent>
        </Card>
      ) : null}

      {tab === 'workload' ? (
        <>
          <Card style={styles.chartCard}>
            <CardHeader>
              <CardTitle>Workload Trend</CardTitle>
              <CardDescription>Average patients per nurse</CardDescription>
            </CardHeader>
            <CardContent>
              <LineChart
                data={workloadTrend}
                width={chartWidth}
                height={180}
                curved
                color={Colors.blue600}
                thickness={2}
                hideDataPoints={false}
                hideRules
                xAxisThickness={0}
                yAxisThickness={0}
              />
            </CardContent>
          </Card>
          <Card style={styles.chartCard}>
            <CardHeader>
              <CardTitle>Task Volume</CardTitle>
              <CardDescription>Recent task creation volume</CardDescription>
            </CardHeader>
            <CardContent>
              <BarChart
                data={avgTasks.map((item, i) => ({
                  ...item,
                  label: `B${i + 1}`,
                  frontColor: Colors.blue600,
                }))}
                width={chartWidth}
                height={160}
                barWidth={28}
                spacing={20}
                roundedTop
                hideRules
                xAxisThickness={0}
                yAxisThickness={0}
              />
            </CardContent>
          </Card>
          <Card style={styles.chartCard}>
            <CardHeader>
              <CardTitle>Delay by Shift</CardTitle>
              <CardDescription>Overdue tasks by shift</CardDescription>
            </CardHeader>
            <CardContent>
              <BarChart
                data={delayData.map((d) => ({ ...d, frontColor: Colors.warning }))}
                width={chartWidth}
                height={160}
                barWidth={36}
                spacing={28}
                roundedTop
                hideRules
                xAxisThickness={0}
                yAxisThickness={0}
              />
            </CardContent>
          </Card>
        </>
      ) : null}

      {tab === 'distribution' ? (
        <Card style={styles.chartCard}>
          <CardHeader>
            <CardTitle>Task Types</CardTitle>
            <CardDescription>Distribution of task categories</CardDescription>
          </CardHeader>
          <CardContent style={{ alignItems: 'center' }}>
            {taskTypes.length ? (
              <PieChart data={taskTypes} donut radius={80} innerRadius={45} />
            ) : (
              <Text style={styles.empty}>No task type data yet.</Text>
            )}
          </CardContent>
        </Card>
      ) : null}

      {tab === 'burnout' ? (
        <Card style={styles.chartCard}>
          <CardHeader>
            <CardTitle>Burnout Risk</CardTitle>
            <CardDescription>Staff burnout risk distribution</CardDescription>
          </CardHeader>
          <CardContent>
            <BarChart
              data={burnout}
              width={chartWidth}
              height={180}
              barWidth={40}
              spacing={30}
              roundedTop
              hideRules
              xAxisThickness={0}
              yAxisThickness={0}
            />
          </CardContent>
        </Card>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.gray50 },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  title: { fontSize: 22, fontWeight: '700', color: Colors.gray900 },
  subtitle: { fontSize: 13, color: Colors.gray500, marginBottom: 4 },
  kpiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kpiCard: { flexGrow: 1, flexBasis: '45%', minWidth: 140 },
  kpiContent: { padding: 12, gap: 4 },
  kpiValue: { fontSize: 20, fontWeight: '700', color: Colors.gray900 },
  kpiLabel: { fontSize: 12, color: Colors.gray500 },
  chartCard: { marginTop: 4 },
  empty: { color: Colors.gray500, paddingVertical: 24 },
});
