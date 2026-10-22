import React, { useMemo, useState } from 'react';
import { Users, Edit2, Trash2, Search, UserPlus, MapPin, FileText, Clock, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Badge } from '../ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../ui/table';
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
import { presenceLabel } from '../../utils/presence';
import { assignNurse, deleteAssignment, ApiError } from '../../api/nurselink';
import type { PatientAssignment } from '../AssignPatientModal';
import type { WorkloadData } from '../../types/domain';
import { toast } from 'sonner';

type SortKey = 'patientCount' | 'overdueTasks' | 'completionRate';
const PAGE_SIZE = 5;

function completionRate(nurse: WorkloadData): number {
  return nurse.taskCount ? Math.round((nurse.completedTasks / nurse.taskCount) * 100) : 0;
}

interface WorkloadSectionProps {
  workloadData: WorkloadData[];
  assignments: PatientAssignment[];
  loading: boolean;
  onAssignPatientClick: () => void;
  onEditAssignment: (assignment: PatientAssignment) => void;
  onRefresh: () => void | Promise<void>;
}

/** "Ana Cruz" -> "AC" — no profile photos exist for nurses, so a small
 * initials circle stands in for an avatar in the workload table. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

/** A clickable column header that toggles sorting the Nurse Workload table
 * by that column — ascending/descending, one column active at a time. */
function SortableHead({ label, active, dir, onClick }: { label: string; active: boolean; dir: 'asc' | 'desc'; onClick: () => void }) {
  return (
    <TableHead>
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 hover:text-foreground ${active ? 'text-foreground font-semibold' : ''}`}
      >
        {label}
        <ArrowUpDown className={`w-3 h-3 ${active ? (dir === 'asc' ? 'rotate-180' : '') : 'opacity-40'}`} />
      </button>
    </TableHead>
  );
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
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);

  const filteredWorkload = useMemo(() => {
    const q = nurseSearch.trim().toLowerCase();
    return q ? workloadData.filter((n) => n.nurseName.toLowerCase().includes(q)) : workloadData;
  }, [workloadData, nurseSearch]);

  const sortedWorkload = useMemo(() => {
    if (!sortKey) return filteredWorkload;
    const sorted = [...filteredWorkload].sort((a, b) => {
      const av = sortKey === 'completionRate' ? completionRate(a) : a[sortKey];
      const bv = sortKey === 'completionRate' ? completionRate(b) : b[sortKey];
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return sorted;
  }, [filteredWorkload, sortKey, sortDir]);

  const pageCount = Math.max(Math.ceil(sortedWorkload.length / PAGE_SIZE), 1);
  const safePage = Math.min(page, pageCount - 1);
  const pagedWorkload = sortedWorkload.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const toggleSort = (key: SortKey) => {
    setPage(0);
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  // Top 8 by patient count — a compact at-a-glance comparison, not a full
  // re-listing of the table above.
  const comparisonData = useMemo(
    () =>
      [...workloadData]
        .sort((a, b) => b.patientCount - a.patientCount)
        .slice(0, 8)
        .map((n) => ({ name: n.nurseName, Patients: n.patientCount, Overdue: n.overdueTasks }))
        .reverse(),
    [workloadData]
  );

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
              <div className="relative mb-4 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Search nurses by name..."
                  value={nurseSearch}
                  onChange={(e) => {
                    setNurseSearch(e.target.value);
                    setPage(0);
                  }}
                  className="pl-9"
                />
              </div>
              {!loading && sortedWorkload.length === 0 ? (
                <p className="text-center py-8 text-gray-600">
                  {nurseSearch ? `No nurses match "${nurseSearch}".` : 'No nurses found.'}
                </p>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nurse Name</TableHead>
                        <TableHead>Department</TableHead>
                        <TableHead>Duty Status</TableHead>
                        <SortableHead label="Assigned Patients" active={sortKey === 'patientCount'} dir={sortDir} onClick={() => toggleSort('patientCount')} />
                        <TableHead>Total Tasks</TableHead>
                        <TableHead>Completed</TableHead>
                        <SortableHead label="Completion Rate" active={sortKey === 'completionRate'} dir={sortDir} onClick={() => toggleSort('completionRate')} />
                        <SortableHead label="Overdue" active={sortKey === 'overdueTasks'} dir={sortDir} onClick={() => toggleSort('overdueTasks')} />
                        <TableHead>Overtime</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedWorkload.map((nurse) => {
                        const rate = completionRate(nurse);
                        return (
                          <TableRow key={nurse.nurseId}>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <span className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold flex items-center justify-center">
                                  {initials(nurse.nurseName)}
                                </span>
                                <div>
                                  <div className="flex items-center gap-1.5">
                                    <PresenceDot presence={nurse.presence} lastSeenAt={nurse.lastSeenAt} />
                                    <span className="font-medium text-gray-900">{nurse.nurseName}</span>
                                  </div>
                                  {/* Several nurses share a display name —
                                      without the email there's no way to tell
                                      which account "Assign" is about to change. */}
                                  <p className="text-xs text-gray-500">{nurse.nurseEmail}</p>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-gray-600">{nurse.department || '—'}</TableCell>
                            <TableCell>
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                                  nurse.shift ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                                }`}
                                title={presenceLabel(nurse.presence, nurse.lastSeenAt)}
                              >
                                {nurse.shift ? 'On Duty' : 'Off Duty'}
                              </span>
                            </TableCell>
                            <TableCell>{nurse.patientCount}</TableCell>
                            <TableCell>{nurse.taskCount}</TableCell>
                            <TableCell>{nurse.completedTasks}</TableCell>
                            <TableCell className={rate >= 80 ? 'text-green-600 font-medium' : 'text-gray-700'}>{rate}%</TableCell>
                            <TableCell className={nurse.overdueTasks > 0 ? 'text-red-600 font-semibold' : 'text-gray-500'}>
                              {nurse.overdueTasks}
                            </TableCell>
                            <TableCell className="text-gray-600">{nurse.overtimeHours}h</TableCell>
                            <TableCell className="text-right">
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
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>

                  <div className="flex items-center justify-between mt-4 text-sm text-gray-600">
                    <p>
                      Showing {safePage * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE + PAGE_SIZE, sortedWorkload.length)} of{' '}
                      {sortedWorkload.length} nurses
                    </p>
                    {pageCount > 1 ? (
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon" variant="outline" className="h-8 w-8"
                          disabled={safePage === 0}
                          onClick={() => setPage((p) => Math.max(p - 1, 0))}
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </Button>
                        {Array.from({ length: pageCount }, (_, i) => (
                          <Button
                            key={i}
                            size="icon"
                            variant={i === safePage ? 'default' : 'outline'}
                            className="h-8 w-8"
                            onClick={() => setPage(i)}
                          >
                            {i + 1}
                          </Button>
                        ))}
                        <Button
                          size="icon" variant="outline" className="h-8 w-8"
                          disabled={safePage === pageCount - 1}
                          onClick={() => setPage((p) => Math.min(p + 1, pageCount - 1))}
                        >
                          <ChevronRight className="w-4 h-4" />
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {comparisonData.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Workload Comparison</CardTitle>
                <CardDescription>Assigned patients vs overdue tasks, top nurses by patient load</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={Math.max(comparisonData.length * 36, 180)}>
                  <BarChart data={comparisonData} layout="vertical" margin={{ left: 12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} style={{ fontSize: '12px' }} />
                    <YAxis type="category" dataKey="name" width={120} style={{ fontSize: '12px' }} />
                    <Tooltip />
                    <Bar dataKey="Patients" fill="#3B82F6" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="Overdue" fill="#EF4444" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          ) : null}
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
