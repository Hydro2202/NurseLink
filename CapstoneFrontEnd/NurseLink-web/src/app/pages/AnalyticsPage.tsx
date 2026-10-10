import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
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
import { TrendingUp, Activity, AlertTriangle, CheckCircle, Clock, ListChecks, Users } from 'lucide-react';
import { fetchAnalytics, ApiError } from '../api/nurselink';
import type { AnalyticsData } from '../types/domain';
import { toast } from 'sonner';

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const analytics = await fetchAnalytics();
        if (!cancelled) setData(analytics);
      } catch (error) {
        toast.error(error instanceof ApiError ? error.message : 'Failed to load analytics');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const taskCompletionData = useMemo(
    () =>
      (data?.taskCompletion || []).map((row) => ({
        day: row.label,
        completed: row.value,
        pending: 0,
        overdue: 0,
      })),
    [data]
  );

  const workloadTrendData = useMemo(() => {
    const trend = data?.workloadTrend || [];
    const avgTasks = data?.avgTasks || [];
    return trend.map((row, i) => ({
      week: row.label,
      avgPatients: row.value,
      avgTasks: avgTasks[i]?.value ?? 0,
      overtimeHrs: 0,
    }));
  }, [data]);

  const taskTypeDistribution = useMemo(
    () =>
      (data?.taskTypes || []).map((row) => ({
        name: row.label || row.text,
        value: row.value,
        color: row.color,
      })),
    [data]
  );

  const delayFrequencyData = useMemo(
    () =>
      (data?.delayData || []).map((row) => ({
        shift: row.label,
        delays: row.value,
      })),
    [data]
  );

  const burnoutRiskData = useMemo(
    () =>
      (data?.burnout || []).map((row) => ({
        risk: row.label,
        nurses: row.value,
        color: row.frontColor || '#64748B',
      })),
    [data]
  );

  const kpis = data?.kpis;

  const kpiItems = useMemo(
    () => [
      { key: 'completion', icon: TrendingUp, iconBg: 'bg-green-100', iconColor: 'text-green-600', value: `${kpis?.completionRate ?? 0}%`, label: 'Completion Rate' },
      { key: 'total', icon: ListChecks, iconBg: 'bg-blue-100', iconColor: 'text-blue-600', value: `${kpis?.totalTasks ?? 0}`, label: 'Total Tasks' },
      { key: 'completed', icon: CheckCircle, iconBg: 'bg-green-100', iconColor: 'text-green-600', value: `${kpis?.completedTasks ?? 0}`, label: 'Completed Tasks' },
      { key: 'overdue', icon: AlertTriangle, iconBg: 'bg-red-100', iconColor: 'text-red-600', value: `${kpis?.overdueTasks ?? 0}`, label: 'Overdue Tasks' },
      { key: 'nurses', icon: Users, iconBg: 'bg-purple-100', iconColor: 'text-purple-600', value: `${kpis?.activeNurses ?? 0}`, label: 'Active Nurses' },
      { key: 'ratio', icon: Activity, iconBg: 'bg-purple-100', iconColor: 'text-purple-600', value: `${kpis?.avgPatientsPerNurse ?? 0}`, label: 'Avg Patients / Nurse' },
      { key: 'response', icon: Clock, iconBg: 'bg-yellow-100', iconColor: 'text-yellow-600', value: `${kpis?.avgResponseMinutes ?? 0}m`, label: 'Avg Response' },
    ],
    [kpis]
  );

  const highBurnout = burnoutRiskData.find((b) => b.risk === 'High')?.nurses ?? 0;
  const medBurnout = burnoutRiskData.find((b) => b.risk === 'Med' || b.risk === 'Medium')?.nurses ?? 0;
  const lowBurnout = burnoutRiskData.find((b) => b.risk === 'Low')?.nurses ?? 0;

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading analytics…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        {kpiItems.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <Card key={kpi.key}>
              <CardContent className="p-4">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${kpi.iconBg}`}>
                  <Icon className={`w-4 h-4 ${kpi.iconColor}`} />
                </div>
                <div className="text-xl font-bold">{kpi.value}</div>
                <p className="text-xs text-muted-foreground mt-0.5">{kpi.label}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Tabs defaultValue="completion" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="completion">Task Completion</TabsTrigger>
          <TabsTrigger value="workload">Workload</TabsTrigger>
          <TabsTrigger value="distribution">Task Types</TabsTrigger>
          <TabsTrigger value="burnout">Burnout Risk</TabsTrigger>
        </TabsList>

        <TabsContent value="completion" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Weekly Task Completion Trends</CardTitle>
              <CardDescription>Completed tasks over the last 7 days</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="w-full">
                <ResponsiveContainer width="100%" height={350}>
                  <BarChart data={taskCompletionData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="completed" fill="#10B981" name="Completed" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="workload" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Workload Distribution Trends</CardTitle>
              <CardDescription>Average patients and task volume</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="w-full">
                <ResponsiveContainer width="100%" height={350}>
                  <LineChart data={workloadTrendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="week" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="avgPatients" stroke="#3B82F6" name="Avg Patients" strokeWidth={2} />
                    <Line type="monotone" dataKey="avgTasks" stroke="#10B981" name="Avg Tasks" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Delay Frequency by Shift</CardTitle>
              <CardDescription>Overdue tasks per shift</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="w-full">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={delayFrequencyData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="shift" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="delays" fill="#EF4444" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="distribution" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Task Type Distribution</CardTitle>
              <CardDescription>Breakdown of tasks by category</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="w-full relative">
                <ResponsiveContainer width="100%" height={340}>
                  <PieChart>
                    <Pie
                      data={taskTypeDistribution}
                      cx="50%"
                      cy="50%"
                      innerRadius={78}
                      outerRadius={120}
                      dataKey="value"
                    >
                      {taskTypeDistribution.map((entry, index) => (
                        <Cell key={`cell-task-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                {/* Centered total — recharts has no native center-label slot,
                    so this is a plain absolutely-positioned overlay matching
                    the donut's own center. */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="text-center">
                    <p className="text-2xl font-bold">{kpis?.totalTasks ?? 0}</p>
                    <p className="text-xs text-muted-foreground">Tasks</p>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-4">
                {taskTypeDistribution.map((item) => (
                  <div key={item.name} className="flex items-center gap-2 text-sm">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
                    <span className="text-muted-foreground truncate">{item.name}</span>
                    <span className="font-semibold ml-auto">{item.value}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="burnout" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Nurse Burnout Risk Analysis</CardTitle>
              <CardDescription>Distribution of nurses by burnout risk level</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="w-full">
                <ResponsiveContainer width="100%" height={350}>
                  <BarChart data={burnoutRiskData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" />
                    <YAxis dataKey="risk" type="category" />
                    <Tooltip />
                    <Bar dataKey="nurses" name="Number of Nurses">
                      {burnoutRiskData.map((entry, index) => (
                        <Cell key={`cell-burnout-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-6 space-y-3">
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                  <h4 className="font-semibold text-red-900 mb-2 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    High Risk ({highBurnout} nurses)
                  </h4>
                  <p className="text-sm text-red-700">
                    Consider workload redistribution for elevated overtime or patient load.
                  </p>
                </div>
                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <h4 className="font-semibold text-yellow-900 mb-2">Medium Risk ({medBurnout} nurses)</h4>
                  <p className="text-sm text-yellow-700">Monitor closely. Approaching burnout thresholds.</p>
                </div>
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                  <h4 className="font-semibold text-green-900 mb-2 flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" />
                    Low Risk ({lowBurnout} nurses)
                  </h4>
                  <p className="text-sm text-green-700">Workload within acceptable limits.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
