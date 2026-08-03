import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
import { User, MapPin, FileText, AlertCircle } from 'lucide-react';
import { Task } from '../types';
import { addPatientAssignment } from '../utils/patientAssignments';

// List of available rooms (same as TaskModal)
const rooms = [
  'ICU-201',
  'ICU-202',
  'ICU-203',
  'ICU-204',
  'ICU-205',
  'Ward 4A-101',
  'Ward 4A-102',
  'Ward 4A-103',
  'Ward 4A-104',
  'Ward 4B-201',
  'Ward 4B-202',
  'Ward 4B-203',
  'Ward 5A-101',
  'Ward 5A-102',
  'Ward 5A-103',
  'ER-1',
  'ER-2',
  'ER-3',
];

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

interface AssignPatientModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (assignment: Omit<PatientAssignment, 'id' | 'assignedAt' | 'updatedAt' | 'status'>) => void;
  editingAssignment?: PatientAssignment | null;
  availableNurses: Array<{ id: string; name: string; patientCount: number }>;
  allTasks?: Task[];
  allAssignments?: PatientAssignment[];
}

export function AssignPatientModal({
  isOpen,
  onClose,
  onSubmit,
  editingAssignment,
  availableNurses,
  allTasks = [],
  allAssignments = [],
}: AssignPatientModalProps) {
  const [formData, setFormData] = useState({
    patientName: '',
    patientId: '',
    room: '',
    ward: 'ICU',
    diagnosis: '',
    assignedNurse: '',
    assignedNurseId: '',
    priority: 'routine' as 'urgent' | 'routine',
    notes: '',
  });

  // Check which rooms are occupied by active tasks
  const getOccupiedRooms = () => {
    const occupiedRooms = new Map<string, { patientName: string; taskId: string }>();

    allTasks.forEach(task => {
      // Only consider active tasks (not completed)
      if (task.patientRoom && task.status !== 'completed') {
        // If editing, don't mark current assignment's room as occupied
        if (editingAssignment && editingAssignment.room === task.patientRoom) {
          return;
        }
        occupiedRooms.set(task.patientRoom, {
          patientName: task.patientName,
          taskId: task.id,
        });
      }
    });

    return occupiedRooms;
  };

  const occupiedRooms = getOccupiedRooms();

  useEffect(() => {
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
    } else {
      // Auto-generate sequential patient ID starting from P004
      let nextPatientNumber = 4; // Start from P004

      // Find the highest existing patient number
      allAssignments.forEach(assignment => {
        const match = assignment.patientId.match(/^P(\d+)$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num >= nextPatientNumber) {
            nextPatientNumber = num + 1;
          }
        }
      });

      const generatedPatientId = `P${String(nextPatientNumber).padStart(3, '0')}`;

      setFormData({
        patientName: '',
        patientId: generatedPatientId,
        room: '',
        ward: 'ICU',
        diagnosis: '',
        assignedNurse: '',
        assignedNurseId: '',
        priority: 'routine',
        notes: '',
      });
    }
  }, [editingAssignment, isOpen, allAssignments]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Patient ID is auto-generated, no validation needed
    if (!formData.patientName || !formData.room || !formData.assignedNurseId) {
      return;
    }
    onSubmit(formData);
    onClose();
  };

  const handleNurseSelect = (nurseId: string) => {
    const nurse = availableNurses.find(n => n.id === nurseId);
    if (nurse) {
      setFormData(prev => ({
        ...prev,
        assignedNurseId: nurse.id,
        assignedNurse: nurse.name,
      }));
    }
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
            {editingAssignment ? 'Update patient assignment details' : 'Assign a patient to a nurse for care'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Patient Information */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 pb-2 border-b">
              <FileText className="w-4 h-4 text-blue-600" />
              <h3 className="text-sm font-semibold text-gray-900">Patient Information</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="patientName" className="text-sm font-medium">
                  Patient Name <span className="text-red-600">*</span>
                </Label>
                <Input
                  id="patientName"
                  value={formData.patientName}
                  onChange={(e) => setFormData(prev => ({ ...prev, patientName: e.target.value }))}
                  placeholder="Enter patient full name"
                  required
                  className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="patientId" className="text-sm font-medium">
                  Patient ID (Auto-generated)
                </Label>
                <Input
                  id="patientId"
                  value={formData.patientId}
                  readOnly
                  disabled
                  placeholder="Auto-generated"
                  className="bg-gray-100 cursor-not-allowed"
                />
                <p className="text-xs text-gray-500">Patient ID is automatically assigned</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="room" className="text-sm font-medium">
                  Room Number <span className="text-red-600">*</span>
                </Label>
                <Select
                  value={formData.room}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, room: value }))}
                >
                  <SelectTrigger id="room" className="border-gray-300 focus:border-blue-500 focus:ring-blue-500">
                    <SelectValue placeholder="Select room" />
                  </SelectTrigger>
                  <SelectContent>
                    {rooms.map((room) => {
                      const occupation = occupiedRooms.get(room);
                      const isOccupied = !!occupation;
                      const displayText = isOccupied
                        ? `${room} (Occupied - Patient: ${occupation.patientName})`
                        : room;

                      return (
                        <SelectItem
                          key={room}
                          value={room}
                          disabled={isOccupied}
                          className={isOccupied ? 'text-gray-400' : ''}
                        >
                          {displayText}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-500">Select an available room for the patient</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ward" className="text-sm font-medium">
                  Ward / Department <span className="text-red-600">*</span>
                </Label>
                <Select value={formData.ward} onValueChange={(value) => setFormData(prev => ({ ...prev, ward: value }))}>
                  <SelectTrigger className="border-gray-300 focus:border-blue-500 focus:ring-blue-500">
                    <SelectValue placeholder="Select ward" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ICU">ICU (Intensive Care Unit)</SelectItem>
                    <SelectItem value="General Ward">General Ward</SelectItem>
                    <SelectItem value="Emergency">Emergency Department</SelectItem>
                    <SelectItem value="Surgery">Surgery Department</SelectItem>
                    <SelectItem value="Pediatrics">Pediatrics</SelectItem>
                    <SelectItem value="Maternity">Maternity Ward</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="diagnosis" className="text-sm font-medium">
                Diagnosis (Optional)
              </Label>
              <Input
                id="diagnosis"
                value={formData.diagnosis}
                onChange={(e) => setFormData(prev => ({ ...prev, diagnosis: e.target.value }))}
                placeholder="e.g., Myocardial Infarction, Post-operative care"
                className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Assignment Details */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 pb-2 border-b">
              <User className="w-4 h-4 text-blue-600" />
              <h3 className="text-sm font-semibold text-gray-900">Assignment Details</h3>
            </div>

            <div className="space-y-2">
              <Label htmlFor="assignedNurse" className="text-sm font-medium">
                Assign to Nurse <span className="text-red-600">*</span>
              </Label>
              <Select value={formData.assignedNurseId} onValueChange={handleNurseSelect} required>
                <SelectTrigger className="border-gray-300 focus:border-blue-500 focus:ring-blue-500">
                  <SelectValue placeholder="Select a nurse" />
                </SelectTrigger>
                <SelectContent>
                  {availableNurses.map(nurse => (
                    <SelectItem key={nurse.id} value={nurse.id}>
                      <div className="flex items-center justify-between w-full gap-3">
                        <span>{nurse.name}</span>
                        <Badge variant="outline" className="text-xs">
                          {nurse.patientCount} patients
                        </Badge>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500">Select a nurse from the available staff</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="priority" className="text-sm font-medium">
                Priority Level <span className="text-red-600">*</span>
              </Label>
              <Select value={formData.priority} onValueChange={(value: 'urgent' | 'routine') => setFormData(prev => ({ ...prev, priority: value }))}>
                <SelectTrigger className="border-gray-300 focus:border-blue-500 focus:ring-blue-500">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="urgent">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-red-600" />
                      <span className="font-medium text-red-600">Urgent</span>
                      <span className="text-xs text-gray-500">- Requires immediate attention</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="routine">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-gray-600" />
                      <span className="font-medium text-gray-600">Routine</span>
                      <span className="text-xs text-gray-500">- Standard care</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes" className="text-sm font-medium">
                Notes / Special Instructions (Optional)
              </Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Enter any special care instructions, allergies, or important notes..."
                rows={4}
                className="border-gray-300 focus:border-blue-500 focus:ring-blue-500 resize-none"
              />
              <p className="text-xs text-gray-500">Include any relevant information for the assigned nurse</p>
            </div>
          </div>

          <DialogFooter className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1 md:flex-none">
              Cancel
            </Button>
            <Button
              type="submit"
              className="flex-1 md:flex-none bg-blue-600 hover:bg-blue-700 text-white"
              disabled={!formData.patientName || !formData.room || !formData.assignedNurseId}
            >
              {editingAssignment ? 'Update Assignment' : 'Assign Patient'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}