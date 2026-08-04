import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
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

const TASK_COMPLETION = [
  { value: 45, label: 'Mon', frontColor: Colors.green600 },
  { value: 52, label: 'Tue', frontColor: Colors.green600 },
  { value: 48, label: 'Wed', frontColor: Colors.green600 },
  { value: 56, label: 'Thu', frontColor: Colors.green600 },
  { value: 50, label: 'Fri', frontColor: Colors.green600 },
  { value: 42, label: 'Sat', frontColor: Colors.green600 },
  { value: 38, label: 'Sun', frontColor: Colors.green600 },
];

const WORKLOAD_TREND = [
  { value: 3.2, label: 'W1' },
  { value: 3.5, label: 'W2' },
  { value: 3.8, label: 'W3' },
  { value: 3.4, label: 'W4' },
];

const AVG_TASKS = [
  { value: 11 },
  { value: 13 },
  { value: 14 },
  { value: 12 },
];

const DELAY_DATA = [
  { value: 8, label: 'Morning' },
  { value: 12, label: 'Afternoon' },
  { value: 15, label: 'Night' },
];

const TASK_TYPES = [
  { value: 35, color: '#3B82F6', text: '35%' },
  { value: 25, color: '#10B981', text: '25%' },
  { value: 20, color: '#F59E0B', text: '20%' },
  { value: 12, color: '#8B5CF6', text: '12%' },
  { value: 8, color: '#EC4899', text: '8%' },
];

const BURNOUT = [
  { value: 8, label: 'Low', frontColor: Colors.green600 },
  { value: 6, label: 'Med', frontColor: Colors.warning },
  { value: 3, label: 'High', frontColor: Colors.destructive },
];

export default function AnalyticsPage() {
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(width - 64, 280);
  const [tab, setTab] = useState('completion');

  const tabs = useMemo(
    () => [
      { value: 'completion', label: 'Completion' },
      { value: 'workload', label: 'Workload' },
      { value: 'distribution', label: 'Types' },
      { value: 'burnout', label: 'Burnout' },
    ],
    []
  );

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Analytics</Text>
        <Text style={styles.subtitle}>Unit performance and staffing insights</Text>
      </View>

      <View style={styles.statsGrid}>
        <Card style={styles.statCard}>
          <CardContent style={styles.statContent}>
            <View style={styles.statTop}>
              <Text style={styles.statLabel}>Avg Task Completion</Text>
              <TrendingUp size={16} color={Colors.green600} />
            </View>
            <Text style={styles.statValue}>89.4%</Text>
            <Text style={styles.statTrend}>+5.2% from last week</Text>
          </CardContent>
        </Card>
        <Card style={styles.statCard}>
          <CardContent style={styles.statContent}>
            <View style={styles.statTop}>
              <Text style={styles.statLabel}>Avg Response Time</Text>
              <Clock size={16} color={Colors.blue600} />
            </View>
            <Text style={styles.statValue}>12 min</Text>
            <Text style={styles.statTrend}>-3 min from last week</Text>
          </CardContent>
        </Card>
        <Card style={styles.statCard}>
          <CardContent style={styles.statContent}>
            <View style={styles.statTop}>
              <Text style={styles.statLabel}>Critical Delays</Text>
              <AlertTriangle size={16} color={Colors.red600} />
            </View>
            <Text style={styles.statValue}>35</Text>
            <Text style={[styles.statTrend, { color: Colors.red600 }]}>+12 from last week</Text>
          </CardContent>
        </Card>
        <Card style={styles.statCard}>
          <CardContent style={styles.statContent}>
            <View style={styles.statTop}>
              <Text style={styles.statLabel}>Nurse Satisfaction</Text>
              <Activity size={16} color={Colors.green600} />
            </View>
            <Text style={styles.statValue}>8.2/10</Text>
            <Text style={styles.statTrend}>+0.3 from last month</Text>
          </CardContent>
        </Card>
      </View>

      <Tabs value={tab} onValueChange={setTab} tabs={tabs} />

      {tab === 'completion' ? (
        <Card>
          <CardHeader>
            <CardTitle>Weekly Task Completion</CardTitle>
            <CardDescription>Completed, pending, and overdue tasks</CardDescription>
          </CardHeader>
          <CardContent>
            <BarChart
              data={TASK_COMPLETION}
              width={chartWidth}
              height={260}
              barWidth={28}
              spacing={18}
              roundedTop
              yAxisThickness={0}
              xAxisThickness={1}
              xAxisColor={Colors.border}
              rulesColor={Colors.border}
              rulesType="dashed"
              noOfSections={4}
              maxValue={70}
              yAxisTextStyle={styles.axis}
              xAxisLabelTextStyle={styles.axis}
            />
          </CardContent>
        </Card>
      ) : null}

      {tab === 'workload' ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Workload Trends</CardTitle>
              <CardDescription>Average patients and tasks per nurse</CardDescription>
            </CardHeader>
            <CardContent>
              <View style={styles.legendRow}>
                <LegendDot color={Colors.blue600} label="Avg Patients" />
                <LegendDot color={Colors.green600} label="Avg Tasks" />
              </View>
              <LineChart
                data={WORKLOAD_TREND}
                data2={AVG_TASKS}
                width={chartWidth}
                height={260}
                spacing={Math.max((chartWidth - 40) / 4, 50)}
                color1={Colors.blue600}
                color2={Colors.green600}
                thickness={2}
                dataPointsColor1={Colors.blue600}
                dataPointsColor2={Colors.green600}
                yAxisThickness={0}
                xAxisThickness={1}
                xAxisColor={Colors.border}
                rulesColor={Colors.border}
                rulesType="dashed"
                noOfSections={4}
                maxValue={16}
                yAxisTextStyle={styles.axis}
                xAxisLabelTextStyle={styles.axis}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Delay Frequency by Shift</CardTitle>
              <CardDescription>Number of delayed tasks per shift</CardDescription>
            </CardHeader>
            <CardContent>
              <BarChart
                data={DELAY_DATA}
                width={chartWidth}
                height={220}
                barWidth={36}
                spacing={40}
                frontColor={Colors.destructive}
                roundedTop
                yAxisThickness={0}
                xAxisThickness={1}
                xAxisColor={Colors.border}
                rulesColor={Colors.border}
                rulesType="dashed"
                noOfSections={4}
                maxValue={20}
                yAxisTextStyle={styles.axis}
                xAxisLabelTextStyle={styles.axis}
              />
            </CardContent>
          </Card>
        </>
      ) : null}

      {tab === 'distribution' ? (
        <Card>
          <CardHeader>
            <CardTitle>Task Type Distribution</CardTitle>
            <CardDescription>Breakdown of tasks by category</CardDescription>
          </CardHeader>
          <CardContent style={styles.pieWrap}>
            <PieChart
              data={TASK_TYPES}
              donut
              radius={100}
              innerRadius={55}
              centerLabelComponent={() => (
                <View style={styles.pieCenter}>
                  <Text style={styles.pieCenterValue}>100%</Text>
                  <Text style={styles.pieCenterLabel}>Tasks</Text>
                </View>
              )}
            />
            <View style={styles.pieLegend}>
              <LegendDot color="#3B82F6" label="Medication 35%" />
              <LegendDot color="#10B981" label="Vital Signs 25%" />
              <LegendDot color="#F59E0B" label="Patient Care 20%" />
              <LegendDot color="#8B5CF6" label="Documentation 12%" />
              <LegendDot color="#EC4899" label="Assessment 8%" />
            </View>
          </CardContent>
        </Card>
      ) : null}

      {tab === 'burnout' ? (
        <Card>
          <CardHeader>
            <CardTitle>Burnout Risk Distribution</CardTitle>
            <CardDescription>Number of nurses by burnout risk level</CardDescription>
          </CardHeader>
          <CardContent>
            <BarChart
              data={BURNOUT}
              width={chartWidth}
              height={240}
              barWidth={40}
              spacing={36}
              roundedTop
              yAxisThickness={0}
              xAxisThickness={1}
              xAxisColor={Colors.border}
              rulesColor={Colors.border}
              rulesType="dashed"
              noOfSections={4}
              maxValue={10}
              yAxisTextStyle={styles.axis}
              xAxisLabelTextStyle={styles.axis}
            />
          </CardContent>
        </Card>
      ) : null}
    </ScrollView>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 32, gap: 14 },
  header: { gap: 4 },
  title: { fontSize: 22, fontWeight: '700', color: Colors.foreground },
  subtitle: { fontSize: 13, color: Colors.mutedForeground },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: { width: '47%', flexGrow: 1, minWidth: 140 },
  statContent: { padding: 12, gap: 4 },
  statTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statLabel: { fontSize: 11, color: Colors.mutedForeground, flex: 1, paddingRight: 6 },
  statValue: { fontSize: 22, fontWeight: '700', color: Colors.foreground },
  statTrend: { fontSize: 11, color: Colors.green600, fontWeight: '600' },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 12, color: Colors.mutedForeground },
  axis: { fontSize: 11, color: Colors.mutedForeground },
  pieWrap: { alignItems: 'center', gap: 16 },
  pieCenter: { alignItems: 'center' },
  pieCenterValue: { fontSize: 18, fontWeight: '700', color: Colors.foreground },
  pieCenterLabel: { fontSize: 12, color: Colors.mutedForeground },
  pieLegend: { gap: 8, alignSelf: 'stretch' },
});
