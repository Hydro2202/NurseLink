import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router';
import { mockTasks, mockWorkloadData, Patient } from '../data/mockData';
import { fetchPatients } from '../api/nurselink';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Progress } from '../components/ui/progress';
import { Button } from '../components/ui/button';
import { toast } from 'sonner';
import { LineChart, Line, BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Clock,
  Users,
  Heart,
  Thermometer,
  AlertCircle,
  ClipboardList,
  FileText,
  BarChart3,
  TrendingUp,
  ArrowRight,
} from 'lucide-react';

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isStaffNurse = user?.role === 'staff_nurse';
  const [currentTime, setCurrentTime] = useState(new Date());
  const [patients, setPatients] = useState<Patient[]>([]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchPatients(isStaffNurse ? { mine: true } : undefined);
        if (!cancelled) setPatients(data);
      } catch (error) {
        console.error('Failed to load patients:', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isStaffNurse]);

  // Calculate stats
  const urgentTasks = mockTasks.filter(t => t.priority === 'urgent' && t.status !== 'completed').length;
  const overdueTasks = mockTasks.filter(t => t.status === 'overdue').length;
  const completedTasks = mockTasks.filter(t => t.status === 'completed').length;
  const totalTasks = mockTasks.length;
  const highRiskPatients = patients.filter(p => p.riskLevel === 'high').length;
  const completionRate = Math.round((completedTasks / totalTasks) * 100);

  // Chart data - memoized with unique references
  const staffTaskTrendData = React.useMemo(() => [
    { time: '07:00', tasks: 3, id: 'staff-t1' },
    { time: '09:00', tasks: 5, id: 'staff-t2' },
    { time: '11:00', tasks: 8, id: 'staff-t3' },
    { time: '13:00', tasks: 6, id: 'staff-t4' },
    { time: '15:00', tasks: 4, id: 'staff-t5' },
  ], []);

  const adminTaskTrendData = React.useMemo(() => [
    { time: '07:00', tasks: 3, id: 'admin-t1' },
    { time: '09:00', tasks: 5, id: 'admin-t2' },
    { time: '11:00', tasks: 8, id: 'admin-t3' },
    { time: '13:00', tasks: 6, id: 'admin-t4' },
    { time: '15:00', tasks: 4, id: 'admin-t5' },
  ], []);

  const vitalTrendsData = React.useMemo(() => [
    { time: '06:00', hr: 72, spo2: 98, id: 'v1' },
    { time: '08:00', hr: 78, spo2: 97, id: 'v2' },
    { time: '10:00', hr: 82, spo2: 96, id: 'v3' },
    { time: '12:00', hr: 76, spo2: 98, id: 'v4' },
    { time: '14:00', hr: 74, spo2: 99, id: 'v5' },
  ], []);

  const StatCard = ({ title, value, subtitle, icon: Icon, trend, trendLabel, bgColor, iconBg, iconColor, borderColor }: any) => (
    <Card className="overflow-hidden">
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <div className={`p-1.5 ${iconBg || 'bg-gray-100'} rounded-lg flex items-center justify-center flex-shrink-0`}>
                <Icon className={`w-3.5 h-3.5 ${iconColor || 'text-gray-600'}`} />
              </div>
              <p className={`text-[10px] font-medium ${iconColor || 'text-blue-600'} uppercase tracking-wide`}>{title}</p>
            </div>
            <h3 className="text-xl font-bold">{value}</h3>
            {subtitle && (
              <p className="text-[10px] text-muted-foreground mt-0.5">{subtitle}</p>
            )}
          </div>
        </div>
        {trend && (
          <div className="flex items-center gap-1 mt-2 pt-2 border-t border-border">
            <TrendingUp className="w-3 h-3 text-green-600" />
            <span className="text-[10px] font-medium text-green-600">{trendLabel}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );

  if (isStaffNurse) {
    return (
      <div className="space-y-4 pb-20 prevent-overflow">
        {/* Header */}
        <div className="bg-card border-b border-border py-3 px-3 sm:px-4 sm:py-4">
          <div className="w-full max-w-7xl mx-auto">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <h1 className="text-base sm:text-lg font-bold truncate">Good Morning, {user?.name}</h1>
                <p className="text-xs text-muted-foreground mt-0.5">Morning Shift (07:00-15:00)</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-base sm:text-lg font-bold">{currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                <p className="text-xs text-muted-foreground mt-0.5">4h 32m</p>
              </div>
            </div>
          </div>
        </div>

        <div className="w-full max-w-7xl mx-auto px-3 sm:px-4 space-y-4">
          {/* Critical Alert */}
          {overdueTasks > 0 && (
            <Alert variant="destructive" className="border-l-4 border-destructive">
              <AlertCircle className="h-5 w-5" />
              <AlertTitle className="font-semibold">Urgent Attention Required</AlertTitle>
              <AlertDescription className="mt-2">
                You have <strong>{overdueTasks} overdue task{overdueTasks > 1 ? 's' : ''}</strong> that need immediate attention.
              </AlertDescription>
            </Alert>
          )}

          {/* Quick Stats */}
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              title="Urgent"
              value={urgentTasks}
              subtitle="Immediate action"
              icon={AlertTriangle}
              bgColor="bg-red-50"
              iconBg="bg-red-100"
              iconColor="text-red-600"
              borderColor="border-red-200"
            />
            <StatCard
              title="Completed"
              value={`${completedTasks}/${totalTasks}`}
              subtitle={`${completionRate}% done`}
              icon={CheckCircle}
              trend="up"
              trendLabel="+8% vs yesterday"
              bgColor="bg-green-50"
              iconBg="bg-green-100"
              iconColor="text-green-600"
              borderColor="border-green-200"
            />
            <StatCard
              title="Patients"
              value={patients.length}
              subtitle="On your roster"
              icon={Users}
              bgColor="bg-blue-50"
              iconBg="bg-blue-100"
              iconColor="text-blue-600"
              borderColor="border-blue-200"
            />
            <StatCard
              title="High Risk"
              value={highRiskPatients}
              subtitle="Close monitoring"
              icon={Heart}
              bgColor="bg-purple-50"
              iconBg="bg-purple-100"
              iconColor="text-purple-600"
              borderColor="border-purple-200"
            />
          </div>

          {/* View All Patients Button */}
          <Card className="border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <Users className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">My Assigned Patients</h3>
                    <p className="text-xs text-gray-600 mt-0.5">
                      View all {patients.length} patients on your roster
                    </p>
                  </div>
                </div>
                <Button
                  onClick={() => navigate('/my-patients')}
                  className="bg-blue-600 hover:bg-blue-700 text-white flex-shrink-0"
                  size="sm"
                >
                  View All
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <div>
            <div className="mb-4">
              <h2 className="text-base font-semibold text-gray-900">Quick Actions</h2>
              <p className="text-xs text-gray-500">Common tasks and shortcuts</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Button 
                className="h-20 flex flex-col gap-2 bg-green-600 hover:bg-green-700 text-white border-0 shadow-sm hover:shadow-md transition-all rounded-xl"
                onClick={() => navigate('/tasks')}
              >
                <ClipboardList className="w-5 h-5" />
                <span className="text-xs font-medium">Tasks</span>
              </Button>
              <Button 
                className="h-20 flex flex-col gap-2 bg-purple-600 hover:bg-purple-700 text-white border-0 shadow-sm hover:shadow-md transition-all rounded-xl"
                onClick={() => navigate('/handover')}
              >
                <FileText className="w-5 h-5" />
                <span className="text-xs font-medium">Handover</span>
              </Button>
              <Button 
                className="h-20 flex flex-col gap-2 bg-orange-600 hover:bg-orange-700 text-white border-0 shadow-sm hover:shadow-md transition-all rounded-xl"
                onClick={() => navigate('/charting')}
              >
                <Activity className="w-5 h-5" />
                <span className="text-xs font-medium">Charting</span>
              </Button>
              <Button
                className="h-20 flex flex-col gap-2 bg-teal-600 hover:bg-teal-700 text-white border-0 shadow-sm hover:shadow-md transition-all rounded-xl"
                onClick={() => navigate('/kardex')}
              >
                <ClipboardList className="w-5 h-5" />
                <span className="text-xs font-medium">Kardex</span>
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Task Timeline */}
            <Card className="border border-border shadow-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Clock className="w-5 h-5 text-primary" />
                  Task Timeline
                </CardTitle>
                <CardDescription>Your hourly task distribution</CardDescription>
              </CardHeader>
              <CardContent>
                <div key="staff-task-timeline-chart">
                  <ResponsiveContainer width="100%" height={220} key="staff-timeline-container">
                    <BarChart data={staffTaskTrendData} key="staff-bar-chart">
                      <CartesianGrid key="staff-grid" strokeDasharray="3 3" stroke="#E2E8F0" />
                      <XAxis 
                        key="staff-x-axis"
                        dataKey="time" 
                        stroke="#718096" 
                        style={{ fontSize: '12px' }}
                      />
                      <YAxis key="staff-y-axis" stroke="#718096" style={{ fontSize: '12px' }} />
                      <Tooltip 
                        key="staff-tooltip"
                        contentStyle={{ 
                          backgroundColor: '#fff', 
                          border: '1px solid #E2E8F0',
                          borderRadius: '8px',
                          fontSize: '14px'
                        }}
                      />
                      <Bar key="staff-tasks-bar" dataKey="tasks" fill="#2EC4B6" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Task Distribution */}
            <Card className="border border-border shadow-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-primary" />
                  Task Status
                </CardTitle>
                <CardDescription>Overview of all tasks</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full bg-success"></div>
                      <span className="text-sm font-medium text-foreground">Completed</span>
                    </div>
                    <span className="text-sm font-bold text-foreground">{completedTasks}</span>
                  </div>
                  <Progress value={(completedTasks / totalTasks) * 100} className="h-2" />
                  
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full bg-warning"></div>
                      <span className="text-sm font-medium text-foreground">In Progress</span>
                    </div>
                    <span className="text-sm font-bold text-foreground">{mockTasks.filter(t => t.status === 'in_progress').length}</span>
                  </div>
                  <Progress value={30} className="h-2" />
                  
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full bg-muted"></div>
                      <span className="text-sm font-medium text-foreground">Pending</span>
                    </div>
                    <span className="text-sm font-bold text-foreground">{mockTasks.filter(t => t.status === 'pending').length}</span>
                  </div>
                  <Progress value={20} className="h-2" />
                  
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full bg-destructive"></div>
                      <span className="text-sm font-medium text-foreground">Overdue</span>
                    </div>
                    <span className="text-sm font-bold text-foreground">{overdueTasks}</span>
                  </div>
                  <Progress value={(overdueTasks / totalTasks) * 100} className="h-2" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* High-Risk Patients */}
          <Card className="border border-border shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-destructive" />
                High-Risk Patients
              </CardTitle>
              <CardDescription>Patients requiring close monitoring</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {patients.filter(p => p.riskLevel === 'high').map(patient => (
                <div key={patient.id} className="p-4 border border-destructive/20 bg-destructive/5 rounded-lg">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h4 className="font-semibold text-foreground">{patient.name}</h4>
                      <p className="text-sm text-muted-foreground">{patient.room}  {patient.diagnosis}</p>
                    </div>
                    <Badge variant="destructive" className="font-medium">HIGH RISK</Badge>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                    <div className="flex items-center gap-2 text-sm">
                      <Heart className="w-4 h-4 text-destructive" />
                      <span className="font-medium">{patient.vitalSigns.heartRate} bpm</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Activity className="w-4 h-4 text-primary" />
                      <span className="font-medium">{patient.vitalSigns.oxygenSaturation}% SpO2</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Thermometer className="w-4 h-4 text-warning" />
                      <span className="font-medium">{patient.vitalSigns.temperature}°C</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Activity className="w-4 h-4 text-success" />
                      <span className="font-medium">{patient.vitalSigns.bloodPressure}</span>
                    </div>
                  </div>
                  {patient.alerts.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-destructive/20">
                      {patient.alerts.map((alert, idx) => (
                        <p key={idx} className="text-sm text-destructive font-medium flex items-center gap-2">
                          <AlertCircle className="w-4 h-4" />
                          {alert}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Upcoming Tasks */}
          <Card className="border border-border shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary" />
                Upcoming Tasks
              </CardTitle>
              <CardDescription>Next scheduled tasks in your shift</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {mockTasks.slice(0, 4).map(task => (
                <div
                  key={task.id}
                  className={`p-4 border rounded-lg ${
                    task.priority === 'urgent' 
                      ? 'border-destructive/30 bg-destructive/5' 
                      : 'border-warning/30 bg-warning/5'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant={task.priority === 'urgent' ? 'destructive' : 'default'} className="font-medium text-xs">
                          {task.priority === 'urgent' ? 'URGENT' : 'ROUTINE'}
                        </Badge>
                        <span className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {task.dueTime}
                        </span>
                      </div>
                      <h4 className="font-semibold text-foreground">{task.title}</h4>
                      <p className="text-sm text-muted-foreground mt-1">{task.patientName} • {task.description}</p>
                    </div>
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      className="ml-4"
                      onClick={() => navigate('/tasks', { state: { taskId: task.id } })}
                    >
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Head Nurse Dashboard
  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="bg-card border-b border-border py-6">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Welcome, {user?.name}</h1>
              <p className="text-sm text-muted-foreground mt-1">Nursing Operations Dashboard</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-foreground">{currentTime.toLocaleTimeString()}</p>
              <p className="text-sm text-muted-foreground">Thursday, March 26, 2026</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 space-y-6">
        {/* Key Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Active Nurses"
            value="12"
            subtitle="On current shift"
            icon={Users}
            trend="up"
            trendLabel="+2 from previous"
          />
          <StatCard
            title="Total Patients"
            value="38"
            subtitle="Across all units"
            icon={Heart}
          />
          <StatCard
            title="Task Completion"
            value={`${completionRate}%`}
            subtitle={`${completedTasks} of ${totalTasks} tasks`}
            icon={CheckCircle}
            trend="up"
            trendLabel="+12% vs yesterday"
          />
          <StatCard
            title="Critical Alerts"
            value="5"
            subtitle="Require attention"
            icon={AlertTriangle}
          />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="border border-border shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-semibold">Task Activity</CardTitle>
              <CardDescription>Hourly task completion today</CardDescription>
            </CardHeader>
            <CardContent>
              <div key="admin-task-activity-chart">
                <ResponsiveContainer width="100%" height={250} key="admin-bar-container">
                  <BarChart data={adminTaskTrendData} key="admin-bar-chart">
                    <CartesianGrid key="admin-grid" strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis key="admin-x-axis" dataKey="time" stroke="#718096" style={{ fontSize: '12px' }} />
                    <YAxis key="admin-y-axis" stroke="#718096" style={{ fontSize: '12px' }} />
                    <Tooltip 
                      key="admin-tooltip"
                      contentStyle={{ 
                        backgroundColor: '#fff', 
                        border: '1px solid #E2E8F0',
                        borderRadius: '8px'
                      }}
                    />
                    <Bar key="admin-tasks-bar" dataKey="tasks" fill="#2D9CDB" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-border shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-semibold">Vital Signs Trends</CardTitle>
              <CardDescription>Average patient vitals throughout the day</CardDescription>
            </CardHeader>
            <CardContent>
              <div key="admin-vitals-chart">
                <ResponsiveContainer width="100%" height={250} key="admin-area-container">
                  <AreaChart data={vitalTrendsData} key="admin-area-chart">
                    <defs>
                      <linearGradient id="colorHR-admin" x1="0" y1="0" x2="0" y2="1" key="grad-hr">
                        <stop key="hr-stop-1" offset="5%" stopColor="#E53E3E" stopOpacity={0.3}/>
                        <stop key="hr-stop-2" offset="95%" stopColor="#E53E3E" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorSpO2-admin" x1="0" y1="0" x2="0" y2="1" key="grad-spo2">
                        <stop key="spo2-stop-1" offset="5%" stopColor="#2D9CDB" stopOpacity={0.3}/>
                        <stop key="spo2-stop-2" offset="95%" stopColor="#2D9CDB" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid key="admin-area-grid" strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis key="admin-area-x-axis" dataKey="time" stroke="#718096" style={{ fontSize: '12px' }} />
                    <YAxis key="admin-area-y-axis" stroke="#718096" style={{ fontSize: '12px' }} />
                    <Tooltip 
                      key="admin-area-tooltip"
                      contentStyle={{ 
                        backgroundColor: '#fff', 
                        border: '1px solid #E2E8F0',
                        borderRadius: '8px'
                      }}
                    />
                    <Area key="admin-hr-area" type="monotone" dataKey="hr" stroke="#E53E3E" strokeWidth={2} fillOpacity={1} fill="url(#colorHR-admin)" />
                    <Area key="admin-spo2-area" type="monotone" dataKey="spo2" stroke="#2D9CDB" strokeWidth={2} fillOpacity={1} fill="url(#colorSpO2-admin)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Nurse Workload */}
        <Card className="border border-border shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-semibold">Nurse Workload Monitor</CardTitle>
            <CardDescription>Current shift nurse-to-patient ratios and burnout risk</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {mockWorkloadData.map(nurse => (
              <div
                key={nurse.nurseId}
                className={`p-4 border rounded-lg ${
                  nurse.burnoutRisk === 'high' ? 'border-destructive/30 bg-destructive/5' :
                  nurse.burnoutRisk === 'medium' ? 'border-warning/30 bg-warning/5' :
                  'border-success/30 bg-success/5'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h4 className="font-semibold text-foreground">{nurse.nurseName}</h4>
                    <p className="text-sm text-muted-foreground">{nurse.shift}</p>
                  </div>
                  <Badge 
                    variant={
                      nurse.burnoutRisk === 'high' ? 'destructive' :
                      nurse.burnoutRisk === 'medium' ? 'default' : 'outline'
                    }
                    className="font-medium"
                  >
                    {nurse.burnoutRisk === 'high' ? 'HIGH RISK' :
                     nurse.burnoutRisk === 'medium' ? 'MEDIUM RISK' : 'LOW RISK'}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Patients</p>
                    <p className="text-lg font-bold text-foreground">{nurse.patientCount}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Tasks</p>
                    <p className="text-lg font-bold text-foreground">{nurse.completedTasks}/{nurse.taskCount}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Completion</p>
                    <p className="text-lg font-bold text-success">{Math.round((nurse.completedTasks / nurse.taskCount) * 100)}%</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Overtime</p>
                    <p className="text-lg font-bold text-warning">{nurse.overtimeHours}h</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Ratio</p>
                    <p className="text-lg font-bold text-primary">1:{Math.floor(nurse.patientCount)}</p>
                  </div>
                </div>
                <Progress value={(nurse.completedTasks / nurse.taskCount) * 100} className="h-2" />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Patient Safety Alerts */}
        <Card className="border border-border shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              Patient Safety Alerts
            </CardTitle>
            <CardDescription>High-priority alerts requiring immediate attention</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Alert variant="destructive" className="border-l-4">
              <AlertCircle className="h-5 w-5" />
              <AlertTitle className="font-semibold">Critical - Maria Garcia (ICU-202)</AlertTitle>
              <AlertDescription className="mt-2">
                Vital signs unstable. BP 98/62, HR 118, Temp 38.9°C. Immediate assessment required.
              </AlertDescription>
              <div className="flex gap-2 mt-3">
                <Button size="sm" variant="destructive" onClick={() => navigate('/workload')}>Respond Now</Button>
                <Button size="sm" variant="outline" onClick={() => toast.success('✅ Notification sent to assigned nurse', { description: 'The nurse has been notified about the patient\'s unstable vital signs.' })}>Notify Nurse</Button>
              </div>
            </Alert>

            <Alert className="border-l-4 border-warning bg-warning/5">
              <Clock className="h-5 w-5 text-warning" />
              <AlertTitle className="font-semibold">Delayed Task - John Smith (ICU-201)</AlertTitle>
              <AlertDescription className="mt-2">
                Cardiac medication overdue by 30 minutes. Assigned nurse: Sarah Johnson.
              </AlertDescription>
              <div className="flex gap-2 mt-3">
                <Button size="sm" onClick={() => navigate('/nurse-tasks/Sarah Johnson')}>View Task</Button>
                <Button size="sm" variant="outline" onClick={() => toast.success('✅ Notification sent to Sarah Johnson', { description: 'The nurse has been notified about the delayed cardiac medication task.' })}>Notify Nurse</Button>
              </div>
            </Alert>
          </CardContent>
        </Card>

        {/* Department Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="border border-border shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-semibold">ICU Department</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-muted-foreground">Occupancy</span>
                  <span className="text-2xl font-bold text-foreground">15/20</span>
                </div>
                <Progress value={75} className="h-2" />
                <div className="flex justify-between text-sm pt-2">
                  <span className="text-muted-foreground">Critical: <strong className="text-destructive">3</strong></span>
                  <span className="text-muted-foreground">Stable: <strong className="text-success">12</strong></span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-border shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-semibold">General Ward</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-muted-foreground">Occupancy</span>
                  <span className="text-2xl font-bold text-foreground">18/25</span>
                </div>
                <Progress value={72} className="h-2" />
                <div className="flex justify-between text-sm pt-2">
                  <span className="text-muted-foreground">Critical: <strong className="text-destructive">1</strong></span>
                  <span className="text-muted-foreground">Stable: <strong className="text-success">17</strong></span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-border shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-semibold">Emergency</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-muted-foreground">Occupancy</span>
                  <span className="text-2xl font-bold text-foreground">5/10</span>
                </div>
                <Progress value={50} className="h-2" />
                <div className="flex justify-between text-sm pt-2">
                  <span className="text-muted-foreground">Critical: <strong className="text-destructive">2</strong></span>
                  <span className="text-muted-foreground">Stable: <strong className="text-success">3</strong></span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}