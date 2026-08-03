import React, { useState } from 'react';
import { mockWorkloadData, mockTasks } from '../data/mockData';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Progress } from '../components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Button } from '../components/ui/button';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import {
  Users,
  AlertTriangle,
  TrendingUp,
  Clock,
  Activity,
  CheckCircle,
  UserPlus,
  Edit2,
  Trash2,
  MapPin,
  FileText,
} from 'lucide-react';
import { AssignPatientModal, PatientAssignment } from '../components/AssignPatientModal';
import { addPatientAssignment, removePatientAssignment } from '../utils/patientAssignments';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';

export default function WorkloadPage() {
  const highRiskNurses = mockWorkloadData.filter(n => n.burnoutRisk === 'high');
  const mediumRiskNurses = mockWorkloadData.filter(n => n.burnoutRisk === 'medium');
  const lowRiskNurses = mockWorkloadData.filter(n => n.burnoutRisk === 'low');

  // Patient Assignment State
  const [assignments, setAssignments] = useState<PatientAssignment[]>([
    {
      id: '1',
      patientName: 'Maria Garcia',
      patientId: 'P-2024-001',
      room: 'ICU-202',
      ward: 'ICU',
      diagnosis: 'Myocardial Infarction',
      assignedNurse: 'Sarah Johnson',
      assignedNurseId: 'N001',
      priority: 'urgent',
      notes: 'Monitor vital signs every 15 minutes. Cardiac monitoring required.',
      status: 'active',
      assignedAt: new Date('2024-03-26T08:00:00'),
      updatedAt: new Date('2024-03-26T08:00:00'),
    },
    {
      id: '2',
      patientName: 'John Smith',
      patientId: 'P-2024-002',
      room: 'ICU-201',
      ward: 'ICU',
      diagnosis: 'Post-operative care',
      assignedNurse: 'David Kim',
      assignedNurseId: 'N002',
      priority: 'routine',
      notes: 'Regular pain medication schedule. Monitor surgical site.',
      status: 'active',
      assignedAt: new Date('2024-03-26T07:30:00'),
      updatedAt: new Date('2024-03-26T07:30:00'),
    },
  ]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<PatientAssignment | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [assignmentToDelete, setAssignmentToDelete] = useState<string | null>(null);

  // Available nurses for assignment
  const availableNurses = mockWorkloadData.map(nurse => ({
    id: nurse.nurseId,
    name: nurse.nurseName,
    patientCount: nurse.patientCount,
  }));

  const handleAssignPatient = (assignmentData: Omit<PatientAssignment, 'id' | 'assignedAt' | 'updatedAt' | 'status'>) => {
    if (editingAssignment) {
      // Update existing assignment
      setAssignments(prev =>
        prev.map(assignment =>
          assignment.id === editingAssignment.id
            ? {
                ...assignment,
                ...assignmentData,
                updatedAt: new Date(),
              }
            : assignment
        )
      );
      
      // Update in patient assignments storage
      addPatientAssignment({
        patientId: assignmentData.patientId,
        nurseId: assignmentData.assignedNurseId,
        nurseName: assignmentData.assignedNurse,
        attendingPhysician: 'Not Assigned', // Can be enhanced later
      });
      
      setEditingAssignment(null);
    } else {
      // Create new assignment
      const newAssignment: PatientAssignment = {
        ...assignmentData,
        id: `assignment-${Date.now()}`,
        status: 'active',
        assignedAt: new Date(),
        updatedAt: new Date(),
      };
      setAssignments(prev => [newAssignment, ...prev]);
      
      // Save to patient assignments storage
      addPatientAssignment({
        patientId: assignmentData.patientId,
        nurseId: assignmentData.assignedNurseId,
        nurseName: assignmentData.assignedNurse,
        attendingPhysician: 'Not Assigned', // Can be enhanced later
      });
    }
  };

  const handleEditAssignment = (assignment: PatientAssignment) => {
    setEditingAssignment(assignment);
    setIsModalOpen(true);
  };

  const handleDeleteAssignment = (id: string) => {
    setAssignmentToDelete(id);
    setDeleteConfirmOpen(true);
  };

  const confirmDelete = () => {
    if (assignmentToDelete) {
      setAssignments(prev => prev.filter(a => a.id !== assignmentToDelete));
      setAssignmentToDelete(null);
    }
    setDeleteConfirmOpen(false);
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  const avgOvertimeData = [
    { shift: 'Morning', hours: 2.1 },
    { shift: 'Afternoon', hours: 2.8 },
    { shift: 'Night', hours: 3.5 },
  ];

  const patientRatioData = [
    { day: 'Mon', ratio: 3.2 },
    { day: 'Tue', ratio: 3.5 },
    { day: 'Wed', ratio: 3.8 },
    { day: 'Thu', ratio: 3.4 },
    { day: 'Fri', ratio: 3.6 },
    { day: 'Sat', ratio: 3.9 },
    { day: 'Sun', ratio: 4.1 },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Workload Monitor</h1>
          <p className="text-gray-600">Real-time nurse workload and burnout risk assessment</p>
        </div>
        <Button
          onClick={() => {
            setEditingAssignment(null);
            setIsModalOpen(true);
          }}
          className="bg-blue-600 hover:bg-blue-700 text-white shadow-lg hover:shadow-xl transition-all"
        >
          <UserPlus className="w-5 h-5 mr-2" />
          Assign Patient
        </Button>
      </div>

      {/* Critical Alerts */}
      {highRiskNurses.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>⚠️ High Burnout Risk Detected</AlertTitle>
          <AlertDescription>
            {highRiskNurses.length} nurse{highRiskNurses.length > 1 ? 's are' : ' is'} at high risk of burnout. 
            Immediate workload redistribution recommended.
          </AlertDescription>
        </Alert>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Nurses On Duty</CardTitle>
            <Users className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{mockWorkloadData.length}</div>
            <p className="text-xs text-gray-600 mt-1">Across all shifts</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Nurse-Patient Ratio</CardTitle>
            <Activity className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">1:3.4</div>
            <p className="text-xs text-gray-600 mt-1">Within acceptable range</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Overtime Hours</CardTitle>
            <Clock className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">2.8h</div>
            <p className="text-xs text-orange-600 mt-1">+0.5h from last week</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">High Risk Nurses</CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{highRiskNurses.length}</div>
            <p className="text-xs text-gray-600 mt-1">Require attention</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="assignments" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="assignments">Patient Assignments</TabsTrigger>
          <TabsTrigger value="current">Current Workload</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
          <TabsTrigger value="recommendations">Recommendations</TabsTrigger>
        </TabsList>

        <TabsContent value="assignments" className="space-y-4">
          {/* Patient Assignments List */}
          <Card>
            <CardHeader>
              <CardTitle>Active Patient Assignments</CardTitle>
              <CardDescription>Current patient-to-nurse assignments and their status</CardDescription>
            </CardHeader>
            <CardContent>
              {assignments.length === 0 ? (
                <div className="text-center py-12">
                  <Users className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                  <p className="text-gray-600 font-medium">No patient assignments yet</p>
                  <p className="text-sm text-gray-500 mt-1">Click "Assign Patient" to create your first assignment</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Desktop View - Table */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b-2 border-gray-200">
                          <th className="text-left py-3 px-4 font-semibold text-sm text-gray-700">Patient</th>
                          <th className="text-left py-3 px-4 font-semibold text-sm text-gray-700">Room</th>
                          <th className="text-left py-3 px-4 font-semibold text-sm text-gray-700">Diagnosis</th>
                          <th className="text-left py-3 px-4 font-semibold text-sm text-gray-700">Assigned Nurse</th>
                          <th className="text-left py-3 px-4 font-semibold text-sm text-gray-700">Priority</th>
                          <th className="text-left py-3 px-4 font-semibold text-sm text-gray-700">Assigned</th>
                          <th className="text-right py-3 px-4 font-semibold text-sm text-gray-700">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {assignments.map(assignment => (
                          <tr key={assignment.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                            <td className="py-4 px-4">
                              <div>
                                <p className="font-semibold text-gray-900">{assignment.patientName}</p>
                                <p className="text-xs text-gray-500">{assignment.patientId}</p>
                              </div>
                            </td>
                            <td className="py-4 px-4">
                              <div className="flex items-center gap-2">
                                <MapPin className="w-4 h-4 text-blue-600" />
                                <div>
                                  <p className="text-sm font-medium text-gray-900">{assignment.room}</p>
                                  <p className="text-xs text-gray-500">{assignment.ward}</p>
                                </div>
                              </div>
                            </td>
                            <td className="py-4 px-4">
                              <p className="text-sm text-gray-700">{assignment.diagnosis || '-'}</p>
                            </td>
                            <td className="py-4 px-4">
                              <div className="flex items-center gap-2">
                                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                                  <Users className="w-4 h-4 text-blue-600" />
                                </div>
                                <p className="text-sm font-medium text-gray-900">{assignment.assignedNurse}</p>
                              </div>
                            </td>
                            <td className="py-4 px-4">
                              <Badge variant={assignment.priority === 'urgent' ? 'destructive' : 'default'}>
                                {assignment.priority === 'urgent' ? 'URGENT' : 'ROUTINE'}
                              </Badge>
                            </td>
                            <td className="py-4 px-4">
                              <p className="text-xs text-gray-600">{formatDate(assignment.assignedAt)}</p>
                            </td>
                            <td className="py-4 px-4">
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleEditAssignment(assignment)}
                                  className="hover:bg-blue-100 hover:text-blue-600"
                                >
                                  <Edit2 className="w-4 h-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleDeleteAssignment(assignment.id)}
                                  className="hover:bg-red-100 hover:text-red-600"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile View - Cards */}
                  <div className="md:hidden space-y-4">
                    {assignments.map(assignment => (
                      <div
                        key={assignment.id}
                        className={`p-4 border-2 rounded-xl shadow-sm ${
                          assignment.priority === 'urgent' ? 'border-red-200 bg-red-50' : 'border-blue-200 bg-blue-50'
                        }`}
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="font-bold text-gray-900">{assignment.patientName}</h3>
                              <Badge variant={assignment.priority === 'urgent' ? 'destructive' : 'default'} className="text-xs">
                                {assignment.priority === 'urgent' ? 'URGENT' : 'ROUTINE'}
                              </Badge>
                            </div>
                            <p className="text-xs text-gray-600">{assignment.patientId}</p>
                          </div>
                        </div>

                        <div className="space-y-2 mb-3">
                          <div className="flex items-center gap-2 text-sm">
                            <MapPin className="w-4 h-4 text-blue-600" />
                            <span className="font-medium">{assignment.room}</span>
                            <span className="text-gray-500">•</span>
                            <span className="text-gray-600">{assignment.ward}</span>
                          </div>

                          {assignment.diagnosis && (
                            <div className="flex items-start gap-2 text-sm">
                              <FileText className="w-4 h-4 text-gray-600 mt-0.5" />
                              <span className="text-gray-700">{assignment.diagnosis}</span>
                            </div>
                          )}

                          <div className="flex items-center gap-2 text-sm">
                            <Users className="w-4 h-4 text-blue-600" />
                            <span className="font-medium text-gray-900">{assignment.assignedNurse}</span>
                          </div>

                          <div className="flex items-center gap-2 text-xs text-gray-600">
                            <Clock className="w-3 h-3" />
                            <span>Assigned {formatDate(assignment.assignedAt)}</span>
                          </div>
                        </div>

                        {assignment.notes && (
                          <div className="p-2 bg-white rounded-lg mb-3 border border-gray-200">
                            <p className="text-xs text-gray-600 font-medium mb-1">Notes:</p>
                            <p className="text-xs text-gray-700">{assignment.notes}</p>
                          </div>
                        )}

                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleEditAssignment(assignment)}
                            className="flex-1 border-blue-300 hover:bg-blue-100 hover:border-blue-400"
                          >
                            <Edit2 className="w-4 h-4 mr-2" />
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDeleteAssignment(assignment.id)}
                            className="flex-1 border-red-300 hover:bg-red-100 hover:border-red-400 text-red-600"
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Remove
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="current" className="space-y-4">
          {/* Burnout Risk Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Burnout Risk Distribution</CardTitle>
              <CardDescription>Current status of all nurses</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold text-green-900 flex items-center gap-2">
                      <CheckCircle className="w-4 h-4" />
                      Low Risk
                    </h4>
                    <Badge variant="outline" className="bg-green-100 border-green-300">
                      {lowRiskNurses.length}
                    </Badge>
                  </div>
                  <p className="text-sm text-green-700">Workload within acceptable limits</p>
                </div>

                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold text-yellow-900">Medium Risk</h4>
                    <Badge variant="outline" className="bg-yellow-100 border-yellow-300">
                      {mediumRiskNurses.length}
                    </Badge>
                  </div>
                  <p className="text-sm text-yellow-700">Monitor closely - approaching threshold</p>
                </div>

                <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold text-red-900 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" />
                      High Risk
                    </h4>
                    <Badge variant="destructive">
                      {highRiskNurses.length}
                    </Badge>
                  </div>
                  <p className="text-sm text-red-700">Immediate intervention needed</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Individual Nurse Workload */}
          <Card>
            <CardHeader>
              <CardTitle>Individual Nurse Workload Details</CardTitle>
              <CardDescription>Detailed breakdown by nurse</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {mockWorkloadData.map(nurse => (
                  <div key={nurse.nurseId} className={`p-4 border rounded-lg ${
                    nurse.burnoutRisk === 'high' ? 'bg-red-50 border-red-200' :
                    nurse.burnoutRisk === 'medium' ? 'bg-yellow-50 border-yellow-200' :
                    'bg-green-50 border-green-200'
                  }`}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                          <Users className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                          <h4 className="font-semibold text-gray-900">{nurse.nurseName}</h4>
                          <p className="text-sm text-gray-600">{nurse.shift}</p>
                        </div>
                      </div>
                      <Badge variant={
                        nurse.burnoutRisk === 'high' ? 'destructive' :
                        nurse.burnoutRisk === 'medium' ? 'default' : 'outline'
                      }>
                        {nurse.burnoutRisk === 'high' ? '🔴 High Risk' :
                         nurse.burnoutRisk === 'medium' ? '🟡 Medium Risk' : '🟢 Low Risk'}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-3">
                      <div>
                        <p className="text-xs text-gray-600">Patients</p>
                        <p className="text-lg font-semibold">{nurse.patientCount}</p>
                        <p className="text-xs text-gray-500">1:{nurse.patientCount} ratio</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">Total Tasks</p>
                        <p className="text-lg font-semibold">{nurse.taskCount}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">Completed</p>
                        <p className="text-lg font-semibold text-green-600">{nurse.completedTasks}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">Completion Rate</p>
                        <p className="text-lg font-semibold">
                          {Math.round((nurse.completedTasks / nurse.taskCount) * 100)}%
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">Overtime</p>
                        <p className={`text-lg font-semibold ${
                          nurse.overtimeHours > 3 ? 'text-red-600' :
                          nurse.overtimeHours > 2 ? 'text-orange-600' : 'text-green-600'
                        }`}>
                          {nurse.overtimeHours}h
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span>Task Progress</span>
                        <span>{nurse.completedTasks}/{nurse.taskCount}</span>
                      </div>
                      <Progress value={(nurse.completedTasks / nurse.taskCount) * 100} />
                    </div>

                    {nurse.burnoutRisk === 'high' && (
                      <div className="mt-3 p-2 bg-red-100 rounded text-sm text-red-800">
                        ⚠️ <strong>Action Required:</strong> Consider redistributing workload or providing additional support
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trends" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Average Overtime by Shift</CardTitle>
              <CardDescription>Overtime hours comparison across shifts</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="w-full" key="overtime-chart-wrapper">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={avgOvertimeData} key="workload-overtime-chart">
                    <CartesianGrid key="workload-overtime-grid" strokeDasharray="3 3" />
                    <XAxis key="workload-overtime-xaxis" dataKey="shift" />
                    <YAxis key="workload-overtime-yaxis" />
                    <Tooltip key="workload-overtime-tooltip" />
                    <Legend key="workload-overtime-legend" />
                    <Bar key="workload-overtime-bar" dataKey="hours" fill="#F59E0B" name="Avg Overtime (hours)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Nurse-to-Patient Ratio Trends</CardTitle>
              <CardDescription>Weekly ratio analysis</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="w-full" key="ratio-chart-wrapper">
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={patientRatioData} key="workload-ratio-chart">
                    <CartesianGrid key="workload-ratio-grid" strokeDasharray="3 3" />
                    <XAxis key="workload-ratio-xaxis" dataKey="day" />
                    <YAxis key="workload-ratio-yaxis" />
                    <Tooltip key="workload-ratio-tooltip" />
                    <Legend key="workload-ratio-legend" />
                    <Line key="workload-ratio-line" type="monotone" dataKey="ratio" stroke="#2D9CDB" name="Patients per Nurse" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 p-3 bg-blue-50 rounded-lg">
                <p className="text-sm text-blue-900">
                  <strong>Note:</strong> Recommended ratio for ICU is 1:2. Current average is 1:3.4, which is above optimal levels.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="recommendations" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Workload Optimization Recommendations</CardTitle>
              <CardDescription>Evidence-based suggestions for improvement</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <TrendingUp className="h-4 w-4" />
                <AlertTitle>Priority Action Items</AlertTitle>
                <AlertDescription>
                  <ul className="mt-2 space-y-2 text-sm">
                    <li>• <strong>Reduce Night Shift Overtime:</strong> Night shift averaging 3.5h overtime - consider adding float nurse</li>
                    <li>• <strong>Address High-Risk Nurses:</strong> David Kim requires immediate workload adjustment (3.5h overtime, 4 patients)</li>
                    <li>• <strong>Optimize Patient Distribution:</strong> Redistribute patients to maintain 1:3 ratio maximum</li>
                  </ul>
                </AlertDescription>
              </Alert>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 border rounded-lg">
                  <h4 className="font-semibold mb-2 flex items-center gap-2">
                    <Users className="w-4 h-4 text-blue-600" />
                    Staffing Recommendations
                  </h4>
                  <ul className="text-sm space-y-2 text-gray-700">
                    <li>• Add 1 float nurse for night shifts</li>
                    <li>• Consider part-time support for peak hours</li>
                    <li>• Implement buddy system for high-workload periods</li>
                  </ul>
                </div>

                <div className="p-4 border rounded-lg">
                  <h4 className="font-semibold mb-2 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-orange-600" />
                    Schedule Optimization
                  </h4>
                  <ul className="text-sm space-y-2 text-gray-700">
                    <li>• Limit consecutive high-intensity shifts</li>
                    <li>• Mandatory breaks after 6-hour periods</li>
                    <li>• Rotate high-risk patient assignments</li>
                  </ul>
                </div>

                <div className="p-4 border rounded-lg">
                  <h4 className="font-semibold mb-2 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-green-600" />
                    Wellness Initiatives
                  </h4>
                  <ul className="text-sm space-y-2 text-gray-700">
                    <li>• Weekly check-ins with high-risk nurses</li>
                    <li>• Access to mental health resources</li>
                    <li>• Peer support groups</li>
                  </ul>
                </div>

                <div className="p-4 border rounded-lg">
                  <h4 className="font-semibold mb-2 flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-blue-600" />
                    Process Improvements
                  </h4>
                  <ul className="text-sm space-y-2 text-gray-700">
                    <li>• Automate routine documentation</li>
                    <li>• Streamline medication administration</li>
                    <li>• Enhanced handover efficiency</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Assign Patient Modal */}
      <AssignPatientModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingAssignment(null);
        }}
        onSubmit={handleAssignPatient}
        editingAssignment={editingAssignment}
        availableNurses={availableNurses}
        allTasks={mockTasks}
        allAssignments={assignments}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Patient Assignment</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove this patient assignment? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">
              Remove Assignment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}