import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { TrendingUp, TrendingDown, Activity, AlertTriangle, CheckCircle, Clock } from 'lucide-react';

export default function AnalyticsPage() {
  // Mock data for charts
  const taskCompletionData = [
    { day: 'Mon', completed: 45, pending: 8, overdue: 2 },
    { day: 'Tue', completed: 52, pending: 6, overdue: 1 },
    { day: 'Wed', completed: 48, pending: 10, overdue: 3 },
    { day: 'Thu', completed: 56, pending: 5, overdue: 1 },
    { day: 'Fri', completed: 50, pending: 7, overdue: 2 },
    { day: 'Sat', completed: 42, pending: 9, overdue: 4 },
    { day: 'Sun', completed: 38, pending: 12, overdue: 5 },
  ];

  const workloadTrendData = [
    { week: 'Week 1', avgPatients: 3.2, avgTasks: 11, overtimeHrs: 2.1 },
    { week: 'Week 2', avgPatients: 3.5, avgTasks: 13, overtimeHrs: 2.8 },
    { week: 'Week 3', avgPatients: 3.8, avgTasks: 14, overtimeHrs: 3.2 },
    { week: 'Week 4', avgPatients: 3.4, avgTasks: 12, overtimeHrs: 2.5 },
  ];

  const taskTypeDistribution = [
    { name: 'Medication', value: 35, color: '#3B82F6' },
    { name: 'Vital Signs', value: 25, color: '#10B981' },
    { name: 'Patient Care', value: 20, color: '#F59E0B' },
    { name: 'Documentation', value: 12, color: '#8B5CF6' },
    { name: 'Assessment', value: 8, color: '#EC4899' },
  ];

  const delayFrequencyData = [
    { shift: 'Morning', delays: 8 },
    { shift: 'Afternoon', delays: 12 },
    { shift: 'Night', delays: 15 },
  ];

  const burnoutRiskData = [
    { risk: 'Low', nurses: 8, color: '#10B981' },
    { risk: 'Medium', nurses: 6, color: '#F59E0B' },
    { risk: 'High', nurses: 3, color: '#EF4444' },
  ];

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Task Completion</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">89.4%</div>
            <p className="text-xs text-green-600 mt-1">+5.2% from last week</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Response Time</CardTitle>
            <Clock className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">12 min</div>
            <p className="text-xs text-green-600 mt-1">-3 min from last week</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Critical Delays</CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">35</div>
            <p className="text-xs text-red-600 mt-1">+12 from last week</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Nurse Satisfaction</CardTitle>
            <Activity className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">8.2/10</div>
            <p className="text-xs text-green-600 mt-1">+0.3 from last month</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
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
              <CardDescription>Breakdown of completed, pending, and overdue tasks</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="w-full" key="completion-chart-wrapper">
                <ResponsiveContainer width="100%" height={350}>
                  <BarChart data={taskCompletionData} key="analytics-completion-chart">
                    <CartesianGrid key="analytics-completion-grid" strokeDasharray="3 3" />
                    <XAxis key="analytics-completion-xaxis" dataKey="day" />
                    <YAxis key="analytics-completion-yaxis" />
                    <Tooltip key="analytics-completion-tooltip" />
                    <Legend key="analytics-completion-legend" />
                    <Bar key="analytics-completed-bar" dataKey="completed" fill="#10B981" name="Completed" />
                    <Bar key="analytics-pending-bar" dataKey="pending" fill="#F59E0B" name="Pending" />
                    <Bar key="analytics-overdue-bar" dataKey="overdue" fill="#EF4444" name="Overdue" />
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
              <CardDescription>Average patients, tasks, and overtime hours per nurse</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="w-full" key="workload-chart-wrapper">
                <ResponsiveContainer width="100%" height={350}>
                  <LineChart data={workloadTrendData} key="analytics-workload-chart">
                    <CartesianGrid key="analytics-workload-grid" strokeDasharray="3 3" />
                    <XAxis key="analytics-workload-xaxis" dataKey="week" />
                    <YAxis key="analytics-workload-yaxis" />
                    <Tooltip key="analytics-workload-tooltip" />
                    <Legend key="analytics-workload-legend" />
                    <Line key="analytics-patients-line" type="monotone" dataKey="avgPatients" stroke="#3B82F6" name="Avg Patients" strokeWidth={2} />
                    <Line key="analytics-tasks-line" type="monotone" dataKey="avgTasks" stroke="#10B981" name="Avg Tasks" strokeWidth={2} />
                    <Line key="analytics-overtime-line" type="monotone" dataKey="overtimeHrs" stroke="#EF4444" name="Overtime Hours" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Delay Frequency by Shift</CardTitle>
              <CardDescription>Number of delayed tasks per shift</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="w-full" key="delays-chart-wrapper">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={delayFrequencyData} key="analytics-delays-chart">
                    <CartesianGrid key="analytics-delays-grid" strokeDasharray="3 3" />
                    <XAxis key="analytics-delays-xaxis" dataKey="shift" />
                    <YAxis key="analytics-delays-yaxis" />
                    <Tooltip key="analytics-delays-tooltip" />
                    <Bar key="analytics-delays-bar" dataKey="delays" fill="#EF4444" />
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
              <div className="w-full" key="distribution-chart-wrapper">
                <ResponsiveContainer width="100%" height={400}>
                  <PieChart key="analytics-pie-chart">
                    <Pie
                      key="analytics-task-pie"
                      data={taskTypeDistribution}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, value }) => `${name}: ${value}%`}
                      outerRadius={120}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {taskTypeDistribution.map((entry, index) => (
                        <Cell key={`cell-task-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip key="analytics-pie-tooltip" />
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
              <div className="w-full" key="burnout-chart-wrapper">
                <ResponsiveContainer width="100%" height={350}>
                  <BarChart data={burnoutRiskData} layout="vertical" key="analytics-burnout-chart">
                    <CartesianGrid key="analytics-burnout-grid" strokeDasharray="3 3" />
                    <XAxis key="analytics-burnout-xaxis" type="number" />
                    <YAxis key="analytics-burnout-yaxis" dataKey="risk" type="category" />
                    <Tooltip key="analytics-burnout-tooltip" />
                    <Bar key="analytics-burnout-bar" dataKey="nurses" name="Number of Nurses">
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
                    High Risk (3 nurses)
                  </h4>
                  <p className="text-sm text-red-700">
                    These nurses have exceeded 3 hours of overtime and are managing 4+ patients. Consider workload redistribution.
                  </p>
                </div>
                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <h4 className="font-semibold text-yellow-900 mb-2">Medium Risk (6 nurses)</h4>
                  <p className="text-sm text-yellow-700">
                    Monitor closely. Approaching burnout thresholds with 2-3 hours overtime.
                  </p>
                </div>
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                  <h4 className="font-semibold text-green-900 mb-2 flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" />
                    Low Risk (8 nurses)
                  </h4>
                  <p className="text-sm text-green-700">
                    Workload within acceptable limits. Continue monitoring.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Activity Log */}
      <Card>
        <CardHeader>
          <CardTitle>Recent System Activity</CardTitle>
          <CardDescription>Audit trail of user actions</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { user: 'Sarah Johnson', action: 'Completed task', detail: 'Medication administration - John Smith', time: '10 min ago' },
              { user: 'Emily Rodriguez', action: 'Created handover note', detail: 'Morning shift handover - Maria Garcia', time: '25 min ago' },
              { user: 'David Kim', action: 'Edited charting note', detail: 'Progress note - Robert Chen', time: '1 hour ago' },
              { user: 'Sarah Johnson', action: 'Acknowledged handover', detail: 'Incoming handover from Night Nurse Lisa', time: '2 hours ago' },
            ].map((log, idx) => (
              <div key={idx} className="flex items-start justify-between p-3 border rounded-lg hover:bg-gray-50 transition-colors">
                <div className="flex-1">
                  <p className="font-medium text-gray-900">{log.user}</p>
                  <p className="text-sm text-gray-600">{log.action} • {log.detail}</p>
                </div>
                <span className="text-xs text-gray-500">{log.time}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}