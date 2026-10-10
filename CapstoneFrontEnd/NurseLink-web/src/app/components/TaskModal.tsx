import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Textarea } from './ui/textarea';
import {
  Loader2,
  Stethoscope,
  Bed,
  ClipboardList,
  Building2,
  CheckCircle2,
  Square,
  CheckSquare,
  AlertCircle,
} from 'lucide-react';
import type { Doctor, Patient, Task, TaskPriority } from '../types/domain';
import { fetchPatients, fetchPatientAssignedDoctors, ApiError } from '../api/nurselink';

interface TaskModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: Task | null;
  onSave: (task: Partial<Task>) => Promise<void>;
  mode: 'add' | 'edit';
  allTasks?: Task[];
  // 'mine' scopes the patient picker to patients assigned to the logged-in
  // user (a nurse's own Add Task). Defaults to 'all' so head-nurse-facing
  // call sites keep their existing unscoped roster.
  patientScope?: 'mine' | 'all';
}

export function TaskModal({
  open,
  onOpenChange,
  task,
  onSave,
  mode,
  allTasks = [],
  patientScope = 'all',
}: TaskModalProps) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    priority: 'routine' as TaskPriority,
    patientName: '',
    patientId: '',
    dueTime: '',
    attendingPhysician: '',
    patientRoom: '',
    doctorOrder: '',
  });
  const [departmentId, setDepartmentId] = useState('');
  const [doctorIds, setDoctorIds] = useState<number[]>([]);
  // The selected patient's Kardex-assigned doctors — the department and
  // doctor fields are both derived from this list, never from the
  // hospital-wide rosters. The backend re-validates doctorIds against the
  // patient's active PatientDoctor rows (TaskSerializer._validate_doctor_ids).
  const [patientDoctors, setPatientDoctors] = useState<Doctor[]>([]);
  const [patientDoctorsLoading, setPatientDoctorsLoading] = useState(false);
  const [patientDoctorsError, setPatientDoctorsError] = useState('');

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchPatients(patientScope === 'mine' ? { mine: true } : undefined)
      .then((data) => {
        if (!cancelled) setPatients(data);
      })
      .catch(() => {
        if (!cancelled) setPatients([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, patientScope]);

  useEffect(() => {
    if (task && mode === 'edit') {
      setFormData({
        title: task.title,
        description: task.description || '',
        priority: task.priority,
        patientName: task.patientName,
        patientId: task.patientId || '',
        dueTime: task.dueTime,
        attendingPhysician: task.attendingPhysician || '',
        patientRoom: task.patientRoom || '',
        doctorOrder: task.doctorOrder || '',
      });
      setDepartmentId(task.departmentId ? String(task.departmentId) : '');
      setDoctorIds((task.assignedDoctors || []).map((d) => d.id));
    } else {
      // For new tasks, patient ID will be set when patient is selected
      setFormData({
        title: '',
        description: '',
        priority: 'routine',
        patientName: '',
        patientId: '',
        dueTime: '',
        attendingPhysician: '',
        patientRoom: '',
        doctorOrder: '',
      });
      setDepartmentId('');
      setDoctorIds([]);
    }
    setErrors({});
  }, [task, mode, open]);

  // Reload the doctor list whenever the selected patient changes (including
  // on open, for edit mode's pre-filled patient).
  useEffect(() => {
    if (!open || !formData.patientId) {
      setPatientDoctors([]);
      return;
    }
    let cancelled = false;
    setPatientDoctorsLoading(true);
    setPatientDoctorsError('');
    fetchPatientAssignedDoctors(formData.patientId)
      .then((data) => {
        if (!cancelled) setPatientDoctors(data);
      })
      .catch((e) => {
        if (cancelled) return;
        setPatientDoctors([]);
        setPatientDoctorsError(
          e instanceof ApiError
            ? e.message
            : "Unable to load the patient's assigned doctors. Please try again."
        );
      })
      .finally(() => {
        if (!cancelled) setPatientDoctorsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, formData.patientId]);

  // Only departments the patient actually has a Kardex-assigned doctor in.
  const patientDepartments = Array.from(
    new Map(patientDoctors.map((d) => [String(d.departmentId), d.departmentName])).entries()
  ).map(([id, name]) => ({ id, name }));

  const matchingDoctors = departmentId
    ? patientDoctors.filter((d) => String(d.departmentId) === departmentId)
    : [];

  // Auto-assign when there is exactly one match.
  useEffect(() => {
    if (matchingDoctors.length === 1) {
      setDoctorIds([matchingDoctors[0].id]);
    }
    // matchingDoctors is derived each render from departmentId/patientDoctors.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentId, patientDoctors]);

  const handleDepartmentChange = (value: string) => {
    // Doctors belong to a specific patient+department pair — changing either
    // half invalidates whatever was selected before.
    setDoctorIds([]);
    setDepartmentId(value);
  };

  const toggleDoctor = (doctorId: number) => {
    setDoctorIds((prev) =>
      prev.includes(doctorId) ? prev.filter((id) => id !== doctorId) : [...prev, doctorId]
    );
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.title.trim()) {
      newErrors.title = 'Task title is required';
    }

    if (!formData.patientName.trim()) {
      newErrors.patientName = 'Patient name is required';
    }

    // Patient ID is auto-generated, no validation needed

    if (!formData.dueTime) {
      newErrors.dueTime = 'Due time is required';
    }

    if (!departmentId) {
      newErrors.department = 'No department selected.';
    }

    if (doctorIds.length === 0) {
      newErrors.doctors =
        patientDoctors.length === 0
          ? 'No doctors are assigned to this patient.'
          : matchingDoctors.length === 0
            ? 'No doctor is currently assigned to this patient in the selected department.'
            : 'Please select at least one doctor.';
    }

    if (!formData.patientRoom) {
      newErrors.patientRoom = 'Patient room is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setLoading(true);
    
    try {
      await onSave({
        ...formData,
        departmentId,
        doctorIds,
        id: task?.id || `task-${Date.now()}`,
        status: task?.status || 'pending',
      });
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving task:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[525px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === 'add' ? 'Add New Task' : 'Edit Task'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'add' 
              ? 'Create a new task and assign it to a patient.' 
              : 'Update the task details below.'}
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Task Title *</Label>
            <Input
              id="title"
              placeholder="e.g., Administer medication"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className={errors.title ? 'border-red-500' : ''}
            />
            {errors.title && (
              <p className="text-sm text-red-500">{errors.title}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Additional details about the task..."
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="priority">Priority *</Label>
              <Select
                value={formData.priority}
                onValueChange={(value: TaskPriority) =>
                  setFormData({ ...formData, priority: value })
                }
              >
                <SelectTrigger id="priority">
                  <SelectValue placeholder="Select priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="urgent">🔴 Urgent</SelectItem>
                  <SelectItem value="routine">🟡 Routine</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="dueTime">Due Time *</Label>
              <Input
                id="dueTime"
                type="time"
                value={formData.dueTime}
                onChange={(e) => setFormData({ ...formData, dueTime: e.target.value })}
                className={errors.dueTime ? 'border-red-500' : ''}
              />
              {errors.dueTime && (
                <p className="text-sm text-red-500">{errors.dueTime}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="patientName">Patient Name *</Label>
              <Select
                value={formData.patientId}
                onValueChange={(patientId) => {
                  const selectedPatient = patients.find((p) => p.id === patientId);
                  setFormData({
                    ...formData,
                    patientId,
                    patientName: selectedPatient?.name || '',
                    attendingPhysician:
                      selectedPatient?.attendingPhysician || formData.attendingPhysician,
                    patientRoom: selectedPatient?.room || formData.patientRoom,
                  });
                  // A doctor assigned to the previous patient must never carry over.
                  if (patientId !== formData.patientId) {
                    setDepartmentId('');
                    setDoctorIds([]);
                    setPatientDoctors([]);
                  }
                }}
              >
                <SelectTrigger id="patientName" className={errors.patientName ? 'border-red-500' : ''}>
                  <SelectValue placeholder={patients.length ? 'Select patient' : 'No patients found'} />
                </SelectTrigger>
                <SelectContent>
                  {patients.length === 0 ? (
                    <SelectItem value="__none" disabled>
                      No patients found
                    </SelectItem>
                  ) : (
                    patients.map((patient) => {
                      // Same name, different patient is exactly the mixup
                      // Patient ID exists to prevent — spell out age/sex/
                      // room too so picking the right one doesn't depend on
                      // a nurse memorizing or double-checking IDs.
                      const sameName = patients.filter(
                        (other) => other.name.toLowerCase() === patient.name.toLowerCase()
                      );
                      return (
                        <SelectItem key={patient.id} value={patient.id}>
                          {sameName.length > 1
                            ? `${patient.name} (${patient.id}) — ${patient.age}y, ${patient.gender}, Room ${patient.room}`
                            : `${patient.name} (${patient.id})`}
                        </SelectItem>
                      );
                    })
                  )}
                </SelectContent>
              </Select>
            {errors.patientName && (
              <p className="text-sm text-red-500">{errors.patientName}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="patientId">Patient ID</Label>
            <Input
              id="patientId"
              placeholder="Select patient to view ID"
              value={formData.patientId}
              readOnly
              disabled
              className="bg-gray-100 cursor-not-allowed"
            />
            <p className="text-xs text-gray-500">Patient ID is automatically filled from selected patient</p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-blue-600" />
              <Label htmlFor="task-department">Department *</Label>
            </div>
            <Select
              value={departmentId}
              onValueChange={handleDepartmentChange}
              disabled={!formData.patientId || patientDoctorsLoading}
            >
              <SelectTrigger
                id="task-department"
                className={errors.department ? 'border-red-500' : ''}
              >
                <SelectValue
                  placeholder={
                    !formData.patientId
                      ? 'Select a patient first'
                      : patientDoctorsLoading
                        ? 'Loading...'
                        : patientDepartments.length === 0
                          ? 'No departments assigned to this patient'
                          : 'Choose a department'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {patientDepartments.length === 0 ? (
                  <SelectItem value="__none" disabled>
                    No departments assigned to this patient.
                  </SelectItem>
                ) : (
                  patientDepartments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {errors.department && <p className="text-sm text-red-500">{errors.department}</p>}
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Stethoscope className="w-4 h-4 text-blue-600" />
              <Label>Doctor *</Label>
            </div>
            {!formData.patientId ? (
              <p className="rounded-md border border-border bg-gray-50 px-3 py-2 text-sm text-gray-500">
                No patient selected.
              </p>
            ) : patientDoctorsLoading ? (
              <p className="flex items-center gap-2 rounded-md border border-border bg-gray-50 px-3 py-2 text-sm text-gray-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading assigned doctors...
              </p>
            ) : patientDoctorsError ? (
              <p className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {patientDoctorsError}
              </p>
            ) : !departmentId ? (
              <p className="rounded-md border border-border bg-gray-50 px-3 py-2 text-sm text-gray-500">
                Select a department to see this patient's assigned doctor.
              </p>
            ) : matchingDoctors.length === 0 ? (
              <p className="rounded-md border border-border bg-gray-50 px-3 py-2 text-sm text-gray-500">
                No doctor is currently assigned to this patient in the selected department.
              </p>
            ) : matchingDoctors.length === 1 ? (
              <>
                <div className="flex items-center justify-between rounded-md border border-green-200 bg-green-50 px-3 py-2">
                  <span className="text-sm font-semibold text-gray-900">
                    {matchingDoctors[0].fullName}
                  </span>
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                </div>
                <p className="text-xs text-gray-500">
                  Doctor is automatically assigned based on the patient's Kardex.
                </p>
              </>
            ) : (
              <div className="space-y-1.5 rounded-md border border-border p-2">
                {matchingDoctors.map((doctor) => {
                  const isSelected = doctorIds.includes(doctor.id);
                  return (
                    <button
                      type="button"
                      key={doctor.id}
                      onClick={() => toggleDoctor(doctor.id)}
                      aria-pressed={isSelected}
                      className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                        isSelected ? 'bg-primary/10' : 'hover:bg-gray-50'
                      }`}
                    >
                      {isSelected ? (
                        <CheckSquare className="w-4 h-4 text-primary shrink-0" />
                      ) : (
                        <Square className="w-4 h-4 text-gray-400 shrink-0" />
                      )}
                      <span>
                        <span className="block text-sm font-semibold text-gray-900">
                          {doctor.fullName}
                        </span>
                        <span className="block text-xs text-gray-500">{doctor.specialization}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {errors.doctors && <p className="text-sm text-red-500">{errors.doctors}</p>}
          </div>

          <div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Bed className="w-4 h-4 text-gray-600" />
                <Label htmlFor="patientRoom">Room *</Label>
              </div>
              <Input
                id="patientRoom"
                placeholder="Room number"
                value={formData.patientRoom}
                onChange={(e) => setFormData({ ...formData, patientRoom: e.target.value })}
                className={errors.patientRoom ? 'border-red-500' : ''}
              />
              {errors.patientRoom && (
                <p className="text-sm text-red-500">{errors.patientRoom}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-blue-600" />
              <Label htmlFor="doctorOrder">Doctor's Order / Notes</Label>
            </div>
            <Textarea
              id="doctorOrder"
              placeholder="Enter doctor's orders or clinical notes..."
              value={formData.doctorOrder}
              onChange={(e) => setFormData({ ...formData, doctorOrder: e.target.value })}
              rows={3}
            />
            <p className="text-xs text-gray-500">Medical instructions or clinical notes from the attending physician</p>
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              className="bg-primary hover:bg-primary-hover"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                mode === 'add' ? 'Add Task' : 'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
