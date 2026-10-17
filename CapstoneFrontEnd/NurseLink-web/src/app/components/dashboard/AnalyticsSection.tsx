import React, { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { TrendingUp, Activity, ListChecks, Clock, PieChart as PieChartIcon } from 'lucide-react';
import type { AnalyticsData } from '../../types/domain';

function humanizeCategory(label?: string): string {
  if (!label) return 'Other';
  return label.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

interface ChartCardProps {
  icon: React.ComponentType<{ className?: string }>;
  iconBg: string;
  iconColor: string;
  title: string;
  description: string;
  hasData: boolean;
  children: React.ReactNode;
}

/** One chart's card: title, a one-line description naming the period/filter
 * it reflects, and a "no data" message instead of an empty chart canvas. */
function ChartCard({ icon: Icon, iconBg, iconColor, title, description, hasData, children }: ChartCardProps) {
  return (
    <Card className="border border-border shadow-sm">
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${iconBg}`}>
            <Icon className={`w-4 h-4 ${iconColor}`} />
          </span>
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {hasData ? children : (
          <p className="text-sm text-muted-foreground text-center py-12">No data for these filters.</p>
        )}
      </CardContent>
    </Card>
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
 * used to be the separate Analytics page (see pages/AnalyticsPage.tsx, now
 * deleted; routes.tsx redirects /analytics here). Not behind tabs.
 */
export function AnalyticsSection({ data, loading, filterSummary }: AnalyticsSectionProps) {
  const taskCompletionData = useMemo(
    () => (data?.taskCompletion || []).map((row) => ({ day: row.label, completed: row.value })),
    [data]
  );
  const workloadTrendData = useMemo(() => {
    const trend = data?.workloadTrend || [];
    return trend.map((row) => ({ week: row.label, avgPatients: row.value }));
  }, [data]);
  const taskVolumeData = useMemo(
    () => (data?.avgTasks || []).map((row, i) => ({ week: `Wk ${i + 1}`, tasks: row.value })),
    [data]
  );
  const delayData = useMemo(
    () => (data?.delayData || []).map((row) => ({ shift: row.label, delays: row.value })),
    [data]
  );
  const taskTypeData = useMemo(
    () => (data?.taskTypes || []).map((row) => ({ name: humanizeCategory(row.label), value: row.value, color: row.color })),
    [data]
  );
  const totalTasks = data?.kpis.totalTasks ?? 0;

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading analytics…</div>;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <ChartCard
        icon={TrendingUp}
        iconBg="bg-green-100"
        iconColor="text-green-600"
        title="Task Completion"
        description={`Completed tasks · ${filterSummary}`}
        hasData={taskCompletionData.some((d) => d.completed > 0)}
      >
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={taskCompletionData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey="day" style={{ fontSize: '12px' }} />
            <YAxis style={{ fontSize: '12px' }} allowDecimals={false} label={{ value: 'Tasks', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
            <Tooltip />
            <Legend />
            <Bar dataKey="completed" fill="#10B981" name="Completed" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard
        icon={Activity}
        iconBg="bg-blue-100"
        iconColor="text-blue-600"
        title="Workload Trend"
        description={`Average patients per nurse · ${filterSummary}`}
        hasData={workloadTrendData.length > 0}
      >
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={workloadTrendData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey="week" style={{ fontSize: '12px' }} />
            <YAxis style={{ fontSize: '12px' }} label={{ value: 'Avg patients', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="avgPatients" stroke="#3B82F6" name="Avg Patients" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard
        icon={ListChecks}
        iconBg="bg-blue-100"
        iconColor="text-blue-600"
        title="Task Volume"
        description={`Tasks created · ${filterSummary}`}
        hasData={taskVolumeData.some((d) => d.tasks > 0)}
      >
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={taskVolumeData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey="week" style={{ fontSize: '12px' }} />
            <YAxis style={{ fontSize: '12px' }} allowDecimals={false} label={{ value: 'Tasks', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
            <Tooltip />
            <Legend />
            <Bar dataKey="tasks" fill="#3B82F6" name="Tasks created" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard
        icon={Clock}
        iconBg="bg-yellow-100"
        iconColor="text-yellow-600"
        title="Delay by Shift"
        description={`Overdue tasks per shift · ${filterSummary}`}
        hasData={delayData.some((d) => d.delays > 0)}
      >
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={delayData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey="shift" style={{ fontSize: '12px' }} />
            <YAxis style={{ fontSize: '12px' }} allowDecimals={false} label={{ value: 'Overdue tasks', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
            <Tooltip />
            <Legend />
            <Bar dataKey="delays" fill="#EF4444" name="Overdue tasks" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard
        icon={PieChartIcon}
        iconBg="bg-purple-100"
        iconColor="text-purple-600"
        title="Task Types"
        description={`Distribution of task categories · ${filterSummary}`}
        hasData={taskTypeData.length > 0}
      >
        <div className="w-full relative">
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie data={taskTypeData} cx="50%" cy="50%" innerRadius={70} outerRadius={105} dataKey="value">
                {taskTypeData.map((entry, index) => (
                  <Cell key={`cell-task-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ top: -20 }}>
            <div className="text-center">
              <p className="text-2xl font-bold">{totalTasks}</p>
              <p className="text-xs text-muted-foreground">Tasks</p>
            </div>
          </div>
        </div>
      </ChartCard>
    </div>
  );
}
