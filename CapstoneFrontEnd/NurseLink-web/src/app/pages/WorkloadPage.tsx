import React, { useMemo, useState } from 'react';
import type { PatientAssignmentRecord, Task, WorkloadData } from '../types/domain';
import {
  fetchWorkload,
  fetchTasks,
  fetchAssignments,
  createAssignment,
  updateAssignment,
  deleteAssignment,
  assignNurse,
} from '../api/nurselink';
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
import { toast } from 'sonner';
import { NurseAssignModal, AssignTarget } from '../components/NurseAssignModal';

function toLocalAssignment(record: PatientAssignmentRecord): PatientAssignment {
  return {
    id: record.id,
    patientName: record.patientName,
    patientId: record.patientId,
    room: record.room,
    ward: record.ward,
    diagnosis: record.diagnosis,
    assignedNurse: record.assignedNurse,
    assignedNurseId: record.assignedNurseId,
    priority: record.priority,
    notes: record.notes,
    status: record.status,
    assignedAt: new Date(record.assignedAt),
    updatedAt: new Date(record.updatedAt),
  };
}

export default function WorkloadPage() {
  const [workloadData, setWorkloadData] = React.useState<WorkloadData[]>([]);
  const [allTasks, setAllTasks] = React.useState<Task[]>([]);
  const [assignments, setAssignments] = useState<PatientAssignment[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<PatientAssignment | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [assignmentToDelete, setAssignmentToDelete] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<AssignTarget | null>(null);

  const loadData = async () => {
    try {
      const [w, tasks, assignmentData] = await Promise.all([
        fetchWorkload(),
        fetchTasks(),
        fetchAssignments({ status: 'active' }),
      ]);
      setWorkloadData(w);
      setAllTasks(tasks);
      setAssignments(assignmentData.map(toLocalAssignment));
    } catch (e) {
      console.error(e);
      toast.error('Failed to load workload data');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    loadData();
  }, []);

  const highRiskNurses = workloadData.filter(n => n.burnoutRisk === 'high');
  const mediumRiskNurses = workloadData.filter(n => n.burnoutRisk === 'medium');
  const lowRiskNurses = workloadData.filter(n => n.burnoutRisk === 'low');

  const availableNurses = workloadData.map(nurse => ({
    id: nurse.nurseId,
    name: nurse.nurseName,
    patientCount: nurse.patientCount,
  }));

  const avgPatients = workloadData.length
    ? workloadData.reduce((s, n) => s + n.patientCount, 0) / workloadData.length
    : 0;
  const avgOvertime = workloadData.length
    ? workloadData.reduce((s, n) => s + n.overtimeHours, 0) / workloadData.length
    : 0;

  const handleAssignPatient = async (
    assignmentData: Omit<PatientAssignment, 'id' | 'assignedAt' | 'updatedAt' | 'status'>
  ) => {
    try {
      const payload = {
        patientId: assignmentData.patientId,
        nurseId: assignmentData.assignedNurseId,
        nurseName: assignmentData.assignedNurse,
        priority: assignmentData.priority,
        notes: assignmentData.notes,
        ward: assignmentData.ward,
      };
      if (editingAssignment) {
        await updateAssignment(editingAssignment.id, payload);
        toast.success('Assignment updated');
      } else {
        await createAssignment(payload);
        toast.success('Patient assigned');
      }
      setEditingAssignment(null);
      setIsModalOpen(false);
      await loadData();
    } catch (e) {
      console.error(e);
      toast.error(editingAssignment ? 'Failed to update assignment' : 'Failed to create assignment');
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

  const confirmDelete = async () => {
    if (assignmentToDelete) {
      try {
        await deleteAssignment(assignmentToDelete);
        setAssignments(prev => prev.filter(a => a.id !== assignmentToDelete));
        toast.success('Assignment removed');
      } catch (e) {
        console.error(e);
        toast.error('Failed to delete assignment');
      }
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

  const avgOvertimeData = useMemo(() => {
    const byShift: Record<string, number[]> = { Morning: [], Afternoon: [], Night: [] };
    workloadData.forEach((n) => {
      const key =
        n.shift === 'afternoon' ? 'Afternoon' : n.shift === 'night' ? 'Night' : 'Morning';
      byShift[key].push(n.overtimeHours);
    });
    return (['Morning', 'Afternoon', 'Night'] as const).map((shift) => {
      const vals = byShift[shift];
      const hours = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      return { shift, hours: Math.round(hours * 10) / 10 };
    });
  }, [workloadData]);

  const byDepartment = useMemo(() => {
    const groups: Record<string, WorkloadData[]> = {};
    workloadData.forEach((nurse) => {
      const key = nurse.department || 'Unassigned';
      if (!groups[key]) groups[key] = [];
      groups[key].push(nurse);
    });
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [workloadData]);

  const handleAssignSave = async (data: { department: string; shift: string }) => {
    if (!assignTarget) return;
    try {
      await assignNurse(assignTarget.id, data);
      await loadData();
      toast.success('Nurse assignment updated');
    } catch (e) {
      console.error(e);
      toast.error('Failed to update assignment');
      throw e;
    }
  };

  const patientRatioData = useMemo(
    () =>
      workloadData.map((n) => ({
        day: n.nurseName.split(' ')[0] || n.nurseName,
        ratio: n.patientCount,
      })),
    [workloadData]
  );

  const recommendations = useMemo(() => {
    const items: string[] = [];
    highRiskNurses.forEach((n) => {
      items.push(
        `Address high-risk nurse ${n.nurseName}: ${n.patientCount} patients, ${n.overtimeHours}h overtime`
      );
    });
    if (avgPatients > 3) {
      items.push(
        `Optimize patient distribution: current average is 1:${avgPatients.toFixed(1)} patients per nurse`
      );
    }
    const night = avgOvertimeData.find((d) => d.shift === 'Night');
    if (night && night.hours > 2) {
      items.push(
        `Reduce night shift overtime: currently averaging ${night.hours}h — consider staffing adjustments`
      );
    }
    return items;
  }, [highRiskNurses, avgPatients, avgOvertimeData]);

  if (loading) {
    return <div className="p-8 text-center text-gray-600">Loading workload…</div>;
  }

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
            <div className="text-2xl font-bold">{workloadData.length}</div>
            <p className="text-xs text-gray-600 mt-1">Across all shifts</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Nurse-Patient Ratio</CardTitle>
            <Activity className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">1:{avgPatients.toFixed(1)}</div>
            <p className="text-xs text-gray-600 mt-1">
              {workloadData.length ? 'Based on current assignments' : 'No nurses on duty'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Overtime Hours</CardTitle>
            <Clock className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{avgOvertime.toFixed(1)}h</div>
            <p className="text-xs text-gray-600 mt-1">From nurse profiles</p>
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
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="assignments">Patient Assignments</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="current">Current Workload</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
          <TabsTrigger value="recommendations">Recommendations</TabsTrigger>
        </TabsList>

        <TabsContent value="team" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Nurses by Department</CardTitle>
              <CardDescription>
                Assign a nurse to a department or shift — they'll be notified of the change.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {byDepartment.length === 0 ? (
                <p className="text-center py-8 text-gray-600">No nurses found.</p>
              ) : (
                <div className="space-y-6">
                  {byDepartment.map(([department, nurses]) => (
                    <div key={department}>
                      <div className="flex items-center gap-2 mb-2">
                        <MapPin className="w-4 h-4 text-blue-600" />
                        <h4 className="font-semibold text-gray-900">{department}</h4>
                        <Badge variant="outline">{nurses.length}</Badge>
                      </div>
                      <div className="space-y-2">
                        {nurses.map((nurse) => (
                          <div
                            key={nurse.nurseId}
                            className="flex items-center justify-between p-3 border rounded-lg bg-white"
                          >
                            <div>
                              <p className="font-medium text-gray-900">{nurse.nurseName}</p>
                              <p className="text-sm text-gray-600 capitalize">{nurse.shift} shift</p>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setAssignTarget({
                                  id: nurse.nurseId,
                                  name: nurse.nurseName,
                                  department: nurse.department,
                                  shift: nurse.shift,
                                });
                                setAssignModalOpen(true);
                              }}
                            >
                              <Edit2 className="w-3.5 h-3.5 mr-1" />
                              Assign
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

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
              {workloadData.length === 0 ? (
                <p className="text-center py-8 text-gray-600">No records found.</p>
              ) : (
              <div className="space-y-4">
                {workloadData.map(nurse => (
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
                          {nurse.taskCount
                            ? Math.round((nurse.completedTasks / nurse.taskCount) * 100)
                            : 0}%
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
                      <Progress value={nurse.taskCount ? (nurse.completedTasks / nurse.taskCount) * 100 : 0} />
                    </div>

                    {nurse.burnoutRisk === 'high' && (
                      <div className="mt-3 p-2 bg-red-100 rounded text-sm text-red-800">
                        ⚠️ <strong>Action Required:</strong> Consider redistributing workload or providing additional support
                      </div>
                    )}
                  </div>
                ))}
              </div>
              )}
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
              {workloadData.length === 0 ? (
                <p className="text-center py-8 text-gray-600">No data available.</p>
              ) : (
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
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Nurse-to-Patient Ratio Trends</CardTitle>
              <CardDescription>Current patients per nurse</CardDescription>
            </CardHeader>
            <CardContent>
              {patientRatioData.length === 0 ? (
                <p className="text-center py-8 text-gray-600">No data available.</p>
              ) : (
              <>
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
                  <strong>Note:</strong> Recommended ratio for ICU is 1:2. Current average is 1:{avgPatients.toFixed(1)}.
                </p>
              </div>
              </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="recommendations" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Workload Optimization Recommendations</CardTitle>
              <CardDescription>Generated from live workload data</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {recommendations.length === 0 ? (
                <p className="text-center py-8 text-gray-600">No recommendations available. Workload is within expected ranges or no data yet.</p>
              ) : (
              <Alert>
                <TrendingUp className="h-4 w-4" />
                <AlertTitle>Priority Action Items</AlertTitle>
                <AlertDescription>
                  <ul className="mt-2 space-y-2 text-sm">
                    {recommendations.map((item) => (
                      <li key={item}>• {item}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
              )}
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
        allTasks={allTasks}
        allAssignments={assignments}
      />

      <NurseAssignModal
        open={assignModalOpen}
        onOpenChange={setAssignModalOpen}
        nurse={assignTarget}
        onSave={handleAssignSave}
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
            <AlertDialogAction onClick={confirmDelete} variant="destructive">
              Remove Assignment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}