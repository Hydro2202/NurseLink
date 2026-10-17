import React, { useMemo, useState } from 'react';
import { Users, Edit2, Trash2, Search, UserPlus, MapPin, FileText, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Badge } from '../ui/badge';
import { Progress } from '../ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { NurseAssignModal, AssignTarget } from '../NurseAssignModal';
import { PresenceDot } from '../PresenceDot';
import { presenceLabel, sortByPresence } from '../../utils/presence';
import { assignNurse, deleteAssignment, ApiError } from '../../api/nurselink';
import type { PatientAssignment } from '../AssignPatientModal';
import type { WorkloadData } from '../../types/domain';
import { toast } from 'sonner';

interface WorkloadSectionProps {
  workloadData: WorkloadData[];
  assignments: PatientAssignment[];
  loading: boolean;
  onAssignPatientClick: () => void;
  onEditAssignment: (assignment: PatientAssignment) => void;
  onRefresh: () => void | Promise<void>;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

/**
 * Nurse Workload + Patient Assignments — the full version of what used to
 * be its own "Workload Monitor" page (see pages/WorkloadPage.tsx, now
 * deleted; routes.tsx redirects /workload here), folded into the head
 * nurse dashboard. Owns its own nurse-reassign and delete-assignment
 * mutations directly; creating/editing an assignment opens the dashboard's
 * shared AssignPatientModal instead (the same one "Respond Now" on a
 * Safety Alert opens), so there is only ever one instance of that modal.
 */
export function WorkloadSection({
  workloadData,
  assignments,
  loading,
  onAssignPatientClick,
  onEditAssignment,
  onRefresh,
}: WorkloadSectionProps) {
  const [nurseSearch, setNurseSearch] = useState('');
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<AssignTarget | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toDelete, setToDelete] = useState<string | null>(null);

  const filteredWorkload = useMemo(() => {
    const q = nurseSearch.trim().toLowerCase();
    const base = q ? workloadData.filter((n) => n.nurseName.toLowerCase().includes(q)) : workloadData;
    return sortByPresence(base);
  }, [workloadData, nurseSearch]);

  const handleAssignSave = async (data: { department: string; shift: string }) => {
    if (!assignTarget) return;
    try {
      await assignNurse(assignTarget.id, data);
      await onRefresh();
      toast.success('Nurse assignment updated');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to update assignment');
      throw e;
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      await deleteAssignment(toDelete);
      await onRefresh();
      toast.success('Assignment removed');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete assignment');
    }
    setToDelete(null);
    setDeleteOpen(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Nurse Workload</h2>
          <p className="text-sm text-gray-600">Per-nurse workload and active patient assignments</p>
        </div>
        <Button onClick={onAssignPatientClick} className="bg-blue-600 hover:bg-blue-700 text-white">
          <UserPlus className="w-4 h-4 mr-2" />
          Assign Patient
        </Button>
      </div>

      <Tabs defaultValue="nurses" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="nurses">Nurses</TabsTrigger>
          <TabsTrigger value="assignments">Assignments ({assignments.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="nurses" className="space-y-4">
          <Card>
            <CardContent className="pt-6">
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Search nurses by name..."
                  value={nurseSearch}
                  onChange={(e) => setNurseSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              {!loading && filteredWorkload.length === 0 ? (
                <p className="text-center py-8 text-gray-600">
                  {nurseSearch ? `No nurses match "${nurseSearch}".` : 'No nurses found.'}
                </p>
              ) : (
                <div className="space-y-4">
                  {filteredWorkload.map((nurse) => (
                    <div key={nurse.nurseId} className="p-4 border rounded-lg bg-white">
                      <div className="flex items-center justify-between mb-3 gap-3">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <PresenceDot presence={nurse.presence} lastSeenAt={nurse.lastSeenAt} />
                            <h4 className="font-semibold text-gray-900">{nurse.nurseName}</h4>
                          </div>
                          {/* Several nurses share a display name — without the
                              email there's no way to tell which account
                              "Assign" is about to change. */}
                          <p className="text-xs text-gray-500">{nurse.nurseEmail}</p>
                          <p className="text-sm text-gray-600">
                            {nurse.department || 'No department'}
                            {nurse.shift ? ` · ${nurse.shift} shift` : ' · No duty assigned'}
                            {' · '}
                            {presenceLabel(nurse.presence, nurse.lastSeenAt)}
                          </p>
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
                              presence: nurse.presence,
                              lastSeenAt: nurse.lastSeenAt,
                            });
                            setAssignOpen(true);
                          }}
                        >
                          <Edit2 className="w-3.5 h-3.5 mr-1" />
                          Assign
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
                        <div>
                          <p className="text-xs text-gray-600">Patients</p>
                          <p className="text-lg font-semibold">{nurse.patientCount}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-600">Tasks</p>
                          <p className="text-lg font-semibold">{nurse.completedTasks}/{nurse.taskCount}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-600">Done</p>
                          <p className="text-lg font-semibold text-green-600">
                            {nurse.taskCount ? Math.round((nurse.completedTasks / nurse.taskCount) * 100) : 0}%
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-600">Overtime</p>
                          <p className="text-lg font-semibold text-orange-600">{nurse.overtimeHours}h</p>
                        </div>
                      </div>
                      <Progress value={nurse.taskCount ? (nurse.completedTasks / nurse.taskCount) * 100 : 0} />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="assignments" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Active Patient Assignments</CardTitle>
              <CardDescription>Current patient-to-nurse assignments and their status</CardDescription>
            </CardHeader>
            <CardContent>
              {!loading && assignments.length === 0 ? (
                <div className="text-center py-12">
                  <Users className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                  <p className="text-gray-600 font-medium">No patient assignments yet</p>
                  <p className="text-sm text-gray-500 mt-1">Click "Assign Patient" to create your first assignment</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {assignments.map((assignment) => (
                    <div
                      key={assignment.id}
                      className={`p-4 border-2 rounded-xl shadow-sm ${
                        assignment.priority === 'urgent' ? 'border-red-200 bg-red-50' : 'border-blue-200 bg-blue-50'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-2">
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
                      <div className="space-y-1.5 mb-3">
                        <div className="flex items-center gap-2 text-sm">
                          <MapPin className="w-4 h-4 text-blue-600" />
                          <span className="font-medium">{assignment.room}</span>
                          <span className="text-gray-500">•</span>
                          <span className="text-gray-600">{assignment.ward}</span>
                        </div>
                        {assignment.diagnosis ? (
                          <div className="flex items-start gap-2 text-sm">
                            <FileText className="w-4 h-4 text-gray-600 mt-0.5" />
                            <span className="text-gray-700">{assignment.diagnosis}</span>
                          </div>
                        ) : null}
                        <div className="flex items-center gap-2 text-sm">
                          <Users className="w-4 h-4 text-blue-600" />
                          <span className="font-medium text-gray-900">{assignment.assignedNurse}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-600">
                          <Clock className="w-3 h-3" />
                          <span>Assigned {formatDate(assignment.assignedAt)}</span>
                        </div>
                      </div>
                      {assignment.notes ? (
                        <div className="p-2 bg-white rounded-lg mb-3 border border-gray-200">
                          <p className="text-xs text-gray-600 font-medium mb-1">Notes:</p>
                          <p className="text-xs text-gray-700">{assignment.notes}</p>
                        </div>
                      ) : null}
                      <div className="flex gap-2">
                        <Button
                          size="sm" variant="outline"
                          onClick={() => onEditAssignment(assignment)}
                          className="flex-1 border-blue-300 hover:bg-blue-100 hover:border-blue-400"
                        >
                          <Edit2 className="w-4 h-4 mr-2" />
                          Edit
                        </Button>
                        <Button
                          size="sm" variant="outline"
                          onClick={() => {
                            setToDelete(assignment.id);
                            setDeleteOpen(true);
                          }}
                          className="flex-1 border-red-300 hover:bg-red-100 hover:border-red-400 text-red-600"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <NurseAssignModal open={assignOpen} onOpenChange={setAssignOpen} nurse={assignTarget} onSave={handleAssignSave} />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
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
