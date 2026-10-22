import React, { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import {
  BarChart,
  Bar,
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
import { TrendingUp, ListChecks, Clock, PieChart as PieChartIcon, BedDouble, Users, AlertTriangle } from 'lucide-react';
import type { AnalyticsData } from '../../types/domain';

function humanizeCategory(label?: string): string {
  if (!label) return 'Other';
  return label.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Same hex values this file already used for "Completed"/"Tasks created"/
 * "Overdue tasks" before this rebuild — kept identical so a returning user
 * sees the same color meaning the same thing. "In Progress"/"Pending" are
 * new additions, picked to stay visually distinct from the other two. */
export const TASK_STATUS_COLORS = {
  completed: '#10B981',
  inProgress: '#3B82F6',
  pending: '#F59E0B',
  overdue: '#EF4444',
} as const;

/** Matches Expo's own AnalyticsSection.tsx STATUS_COLORS mapping for the
 * same 3 Patient.STATUS_CHOICES values, so the two platforms agree. */
export const PATIENT_STATUS_COLORS: Record<string, string> = {
  admitted: '#3B82F6',
  observation: '#F59E0B',
  discharged: '#10B981',
};

interface ChartCardProps {
  icon: React.ComponentType<{ className?: string }>;
  iconBg: string;
  iconColor: string;
  title: string;
  description: string;
  hasData: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/** One chart's card: title, a one-line description naming the period/filter
 * it reflects, and a "no data" message instead of an empty chart canvas. */
function ChartCard({ icon: Icon, iconBg, iconColor, title, description, hasData, children, footer }: ChartCardProps) {
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
        {hasData && footer ? footer : null}
      </CardContent>
    </Card>
  );
}

/** A small "swatch + label + value" legend row, used below the two donut
 * charts (Patients by Status, Task Type Distribution) so each slice's exact
 * count/percentage is readable, not just inferable from the wedge size. */
function SwatchLegend({ items }: { items: { color: string; label: string; value: string }[] }) {
  return (
    <div className="flex flex-wrap justify-center gap-x-5 gap-y-2 mt-3 pt-3 border-t border-border">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2 text-sm">
          <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: item.color }} />
          <span className="text-foreground font-medium">{item.label}</span>
          <span className="text-muted-foreground">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

interface SectionProps {
  data: AnalyticsData | null;
  loading: boolean;
  /** e.g. "Last 7 days · Medical Ward" — appended to every chart's
   * description so it's clear what period/filter each one reflects. */
  filterSummary: string;
}

function LoadingBox() {
  return <div className="p-8 text-sm text-muted-foreground">Loading analytics…</div>;
}

/** Section B: Patient Flow (admissions vs discharges) and Patients by
 * Status, side by side on desktop. */
export function PatientFlowAndStatusSection({ data, loading, filterSummary }: SectionProps) {
  const patientFlow = data?.patientFlow || [];
  const totalAdmissions = patientFlow.reduce((sum, d) => sum + d.admissions, 0);
  const totalDischarges = patientFlow.reduce((sum, d) => sum + d.discharges, 0);

  const patientStatus = useMemo(
    () => (data?.patientStatus || []).map((s) => ({ ...s, color: PATIENT_STATUS_COLORS[s.status] || '#94A3B8' })),
    [data]
  );
  const totalPatients = patientStatus.reduce((sum, s) => sum + s.value, 0);

  if (loading) return <LoadingBox />;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ChartCard
        icon={BedDouble}
        iconBg="bg-blue-100"
        iconColor="text-blue-600"
        title="Patient Flow"
        description={`Admissions vs Discharges · ${filterSummary}`}
        hasData={totalAdmissions + totalDischarges > 0}
        footer={
          <div className="mt-3 pt-3 border-t border-border flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span><span className="font-semibold text-foreground">{totalAdmissions}</span> <span className="text-muted-foreground">total admissions</span></span>
            <span><span className="font-semibold text-foreground">{totalDischarges}</span> <span className="text-muted-foreground">total discharges</span></span>
            {data?.avgLengthOfStayDays != null ? (
              <span><span className="font-semibold text-foreground">{data.avgLengthOfStayDays}</span> <span className="text-muted-foreground">avg. length of stay (days)</span></span>
            ) : null}
          </div>
        }
      >
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={patientFlow}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey="label" style={{ fontSize: '12px' }} />
            <YAxis style={{ fontSize: '12px' }} allowDecimals={false} />
            <Tooltip />
            <Legend />
            <Bar dataKey="admissions" fill="#3B82F6" name="Admissions" radius={[4, 4, 0, 0]} />
            <Bar dataKey="discharges" fill="#10B981" name="Discharges" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard
        icon={Users}
        iconBg="bg-purple-100"
        iconColor="text-purple-600"
        title="Patients by Status"
        description="Current patient distribution"
        hasData={totalPatients > 0}
        footer={
          <SwatchLegend
            items={patientStatus.map((s) => ({
              color: s.color,
              label: s.label,
              value: `${s.value} (${totalPatients ? Math.round((s.value / totalPatients) * 100) : 0}%)`,
            }))}
          />
        }
      >
        <div className="w-full relative">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={patientStatus} cx="50%" cy="50%" innerRadius={70} outerRadius={105} dataKey="value">
                {patientStatus.map((entry, index) => (
                  <Cell key={`cell-status-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <p className="text-2xl font-bold">{totalPatients}</p>
              <p className="text-xs text-muted-foreground">Total Patients</p>
            </div>
          </div>
        </div>
      </ChartCard>
    </div>
  );
}

/** Section C: Task Completion (stacked by status, grouped by due date) and
 * Task Volume (tasks created per day), side by side on desktop. */
export function TaskPerformanceSection({ data, loading, filterSummary }: SectionProps) {
  const taskPerformance = data?.taskPerformance || [];
  const taskVolume = data?.taskVolume || [];

  if (loading) return <LoadingBox />;

  return (
    <div>
      <div className="mb-3">
        <h2 className="text-lg font-semibold text-gray-900">Task Performance</h2>
        <p className="text-sm text-gray-500">{filterSummary}</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard
          icon={TrendingUp}
          iconBg="bg-green-100"
          iconColor="text-green-600"
          title="Task Completion"
          description="Task status comparison"
          hasData={taskPerformance.some((d) => d.completed + d.inProgress + d.pending + d.overdue > 0)}
        >
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={taskPerformance}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="label" style={{ fontSize: '12px' }} />
              <YAxis style={{ fontSize: '12px' }} allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="completed" stackId="status" fill={TASK_STATUS_COLORS.completed} name="Completed" />
              <Bar dataKey="inProgress" stackId="status" fill={TASK_STATUS_COLORS.inProgress} name="In Progress" />
              <Bar dataKey="pending" stackId="status" fill={TASK_STATUS_COLORS.pending} name="Pending" />
              <Bar dataKey="overdue" stackId="status" fill={TASK_STATUS_COLORS.overdue} name="Overdue" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          icon={ListChecks}
          iconBg="bg-blue-100"
          iconColor="text-blue-600"
          title="Task Volume"
          description="Tasks created over time"
          hasData={taskVolume.some((d) => d.value > 0)}
        >
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={taskVolume}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="label" style={{ fontSize: '12px' }} />
              <YAxis style={{ fontSize: '12px' }} allowDecimals={false} />
              <Tooltip labelFormatter={(_, payload) => payload?.[0]?.payload?.date || ''} />
              <Legend />
              <Bar dataKey="value" fill="#3B82F6" name="Tasks created" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}

/** "{Shift} shift has the highest number of overdue tasks." — or the
 * accurate tied/no-data phrasing. Never invents an insight the data
 * doesn't actually support. */
function shiftInsight(delayData: { label: string; value: number }[]): string | null {
  if (!delayData.length) return null;
  const max = Math.max(...delayData.map((d) => d.value));
  if (max <= 0) return null;
  const top = delayData.filter((d) => d.value === max);
  if (top.length === 1) return `${top[0].label} shift has the highest number of overdue tasks.`;
  return `${top.map((d) => d.label).join(' and ')} shifts are tied for the highest number of overdue tasks.`;
}

/** Section E: Shift & Delay Analysis — overdue tasks per shift, plus a
 * data-driven insight callout. */
export function ShiftDelaySection({ data, loading, filterSummary }: SectionProps) {
  const delayData = data?.delayData || [];
  const insight = useMemo(() => shiftInsight(delayData), [delayData]);

  if (loading) return <LoadingBox />;

  return (
    <div>
      <div className="mb-3">
        <h2 className="text-lg font-semibold text-gray-900">Shift & Delay Analysis</h2>
        <p className="text-sm text-gray-500">Overdue tasks by shift · {filterSummary}</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <ChartCard
            icon={Clock}
            iconBg="bg-orange-100"
            iconColor="text-orange-600"
            title="Overdue Tasks by Shift"
            description={filterSummary}
            hasData={delayData.some((d) => d.value > 0)}
          >
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={delayData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="label" style={{ fontSize: '12px' }} />
                <YAxis style={{ fontSize: '12px' }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="value" fill="#F97316" name="Overdue tasks" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-orange-800">
            {insight || 'No overdue tasks in this period.'}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Section F: Task Type Distribution — full width, with a readable legend. */
export function TaskTypeSection({ data, loading, filterSummary }: SectionProps) {
  const taskTypeData = useMemo(
    () => (data?.taskTypes || []).map((row) => ({ name: humanizeCategory(row.label), value: row.value, color: row.color, text: row.text })),
    [data]
  );
  const totalTasks = data?.kpis.totalTasks ?? 0;

  if (loading) return <LoadingBox />;

  return (
    <div>
      <div className="mb-3">
        <h2 className="text-lg font-semibold text-gray-900">Task Type Distribution</h2>
        <p className="text-sm text-gray-500">{filterSummary}</p>
      </div>
      <ChartCard
        icon={PieChartIcon}
        iconBg="bg-purple-100"
        iconColor="text-purple-600"
        title="Task Categories"
        description="Distribution of task categories"
        hasData={taskTypeData.length > 0}
        footer={
          <SwatchLegend
            items={taskTypeData.map((t) => ({ color: t.color, label: t.name, value: t.text }))}
          />
        }
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
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ top: -20 }}>
            <div className="text-center">
              <p className="text-2xl font-bold">{totalTasks}</p>
              <p className="text-xs text-muted-foreground">Total Tasks</p>
            </div>
          </div>
        </div>
      </ChartCard>
    </div>
  );
}
