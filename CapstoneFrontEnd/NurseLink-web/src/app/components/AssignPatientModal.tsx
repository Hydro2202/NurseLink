import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Textarea } from './ui/textarea';
import { User, FileText } from 'lucide-react';
import { fetchPatients } from '../api/nurselink';
import type { NursePresence, Patient } from '../types/domain';
import { PresenceDot } from './PresenceDot';
import { sortByPresence } from '../utils/presence';

export interface PatientAssignment {
  id: string;
  patientName: string;
  patientId: string;
  room: string;
  ward: string;
  diagnosis: string;
  assignedNurse: string;
  assignedNurseId: string;
  priority: 'urgent' | 'routine';
  notes: string;
  status: 'active' | 'completed' | 'reassigned';
  assignedAt: Date;
  updatedAt: Date;
}

/** Everything but the nurse — e.g. from the dashboard's Patient Safety
 * Alerts "Respond Now", which already knows which patient and how urgent;
 * the head nurse's only remaining decision is who to assign. */
export interface AssignPatientPrefill {
  patientId: string;
  patientName: string;
  room: string;
  ward: string;
  diagnosis: string;
  priority: 'urgent' | 'routine';
}

interface AssignPatientModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (assignment: Omit<PatientAssignment, 'id' | 'assignedAt' | 'updatedAt' | 'status'>) => void;
  editingAssignment?: PatientAssignment | null;
  prefill?: AssignPatientPrefill | null;
  availableNurses: Array<{
    id: string;
    name: string;
    patientCount: number;
    presence?: NursePresence;
    lastSeenAt?: string | null;
  }>;
  allTasks?: unknown[];
  allAssignments?: PatientAssignment[];
}

export function AssignPatientModal({
  isOpen,
  onClose,
  onSubmit,
  editingAssignment,
  prefill,
  availableNurses,
}: AssignPatientModalProps) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [formData, setFormData] = useState({
    patientName: '',
    patientId: '',
    room: '',
    ward: '',
    diagnosis: '',
    assignedNurse: '',
    assignedNurseId: '',
    priority: 'routine' as 'urgent' | 'routine',
    notes: '',
  });

  useEffect(() => {
    if (!isOpen) return;
    fetchPatients()
      .then(setPatients)
      .catch(() => setPatients([]));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (editingAssignment) {
      setFormData({
        patientName: editingAssignment.patientName,
        patientId: editingAssignment.patientId,
        room: editingAssignment.room,
        ward: editingAssignment.ward,
        diagnosis: editingAssignment.diagnosis,
        assignedNurse: editingAssignment.assignedNurse,
        assignedNurseId: editingAssignment.assignedNurseId,
        priority: editingAssignment.priority,
        notes: editingAssignment.notes,
      });
    } else if (prefill) {
      // Everything but the nurse is already known — the head nurse's only
      // remaining step is picking who to assign.
      setFormData({
        patientName: prefill.patientName,
        patientId: prefill.patientId,
        room: prefill.room,
        ward: prefill.ward,
        diagnosis: prefill.diagnosis,
        assignedNurse: '',
        assignedNurseId: '',
        priority: prefill.priority,
        notes: '',
      });
    } else {
      setFormData({
        patientName: '',
        patientId: '',
        room: '',
        ward: '',
        diagnosis: '',
        assignedNurse: '',
        assignedNurseId: '',
        priority: 'routine',
        notes: '',
      });
    }
  }, [editingAssignment, prefill, isOpen]);

  const handlePatientSelect = (patientId: string) => {
    const patient = patients.find((p) => p.id === patientId);
    if (!patient) return;
    setFormData((prev) => ({
      ...prev,
      patientId: patient.id,
      patientName: patient.name,
      room: patient.room || '',
      diagnosis: patient.diagnosis || '',
    }));
  };

  const handleNurseSelect = (nurseId: string) => {
    const nurse = availableNurses.find((n) => n.id === nurseId);
    if (nurse) {
      setFormData((prev) => ({
        ...prev,
        assignedNurseId: nurse.id,
        assignedNurse: nurse.name,
      }));
    }
  };

  const canSubmit = !!formData.patientId && !!formData.room && !!formData.assignedNurseId;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit(formData);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <User className="w-5 h-5 text-blue-600" />
            {editingAssignment ? 'Edit Patient Assignment' : 'Assign Patient to Nurse'}
          </DialogTitle>
          <DialogDescription>
            {editingAssignment
              ? 'Update patient assignment details'
              : 'Select an existing patient and assign them to a nurse'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-4">
            <div className="flex items-center gap-2 pb-2 border-b">
              <FileText className="w-4 h-4 text-blue-600" />
              <h3 className="text-sm font-semibold text-gray-900">Patient</h3>
            </div>

            {patients.length === 0 ? (
              <p className="text-sm text-gray-500">
                No patients found. Create a patient via Kardex first.
              </p>
            ) : (
              <div className="space-y-2">
                <Label>Select Patient *</Label>
                <Select value={formData.patientId} onValueChange={handlePatientSelect}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select patient" />
                  </SelectTrigger>
                  <SelectContent>
                    {patients.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} • {p.room} ({p.id})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Room *</Label>
                <Input
                  value={formData.room}
                  onChange={(e) => setFormData((prev) => ({ ...prev, room: e.target.value }))}
                  placeholder="Room number"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Ward / Department</Label>
                <Input
                  value={formData.ward}
                  onChange={(e) => setFormData((prev) => ({ ...prev, ward: e.target.value }))}
                  placeholder="e.g., ICU"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Diagnosis (Optional)</Label>
              <Input
                value={formData.diagnosis}
                onChange={(e) => setFormData((prev) => ({ ...prev, diagnosis: e.target.value }))}
                placeholder="Diagnosis"
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2 pb-2 border-b">
              <User className="w-4 h-4 text-blue-600" />
              <h3 className="text-sm font-semibold text-gray-900">Assignment Details</h3>
            </div>

            <div className="space-y-2">
              <Label>Assign to Nurse *</Label>
              {availableNurses.length === 0 ? (
                <p className="text-sm text-gray-500">No nurses available</p>
              ) : (
                <Select value={formData.assignedNurseId} onValueChange={handleNurseSelect}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select nurse" />
                  </SelectTrigger>
                  <SelectContent>
                    {sortByPresence(availableNurses).map((n) => (
                      <SelectItem key={n.id} value={n.id}>
                        <span className="inline-flex items-center gap-1.5">
                          <PresenceDot presence={n.presence} lastSeenAt={n.lastSeenAt} />
                          {n.name} ({n.patientCount} patients)
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-2">
              <Label>Priority</Label>
              <Select
                value={formData.priority}
                onValueChange={(value: 'urgent' | 'routine') =>
                  setFormData((prev) => ({ ...prev, priority: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="routine">Routine</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={formData.notes}
                onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))}
                rows={3}
                placeholder="Optional notes"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {editingAssignment ? 'Update Assignment' : 'Assign Patient'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
