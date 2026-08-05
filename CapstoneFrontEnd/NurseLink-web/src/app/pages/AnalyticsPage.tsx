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
import { TrendingUp, Activity, AlertTriangle, CheckCircle, Clock } from 'lucide-react';
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
  const highBurnout = burnoutRiskData.find((b) => b.risk === 'High')?.nurses ?? 0;
  const medBurnout = burnoutRiskData.find((b) => b.risk === 'Med' || b.risk === 'Medium')?.nurses ?? 0;
  const lowBurnout = burnoutRiskData.find((b) => b.risk === 'Low')?.nurses ?? 0;

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading analytics…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Task Completion</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{kpis?.completionRate ?? 0}%</div>
            <p className="text-xs text-muted-foreground mt-1">
              {kpis?.completedTasks ?? 0} of {kpis?.totalTasks ?? 0} tasks
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Response Time</CardTitle>
            <Clock className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{kpis?.avgResponseMinutes ?? 0} min</div>
            <p className="text-xs text-muted-foreground mt-1">Derived from overdue load</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Critical Delays</CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{kpis?.overdueTasks ?? 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Overdue tasks</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Nurses</CardTitle>
            <Activity className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{kpis?.activeNurses ?? 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Avg {kpis?.avgPatientsPerNurse ?? 0} patients/nurse
            </p>
          </CardContent>
        </Card>
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
              <div className="w-full">
                <ResponsiveContainer width="100%" height={400}>
                  <PieChart>
                    <Pie
                      data={taskTypeDistribution}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, value }) => `${name}: ${value}%`}
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
