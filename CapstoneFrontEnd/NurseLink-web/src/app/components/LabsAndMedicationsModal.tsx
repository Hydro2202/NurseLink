import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { FlaskConical } from 'lucide-react';
import { KardexLabsAndMedications } from './KardexLabsAndMedications';
import type { Patient } from '../types/domain';

interface LabsAndMedicationsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: Patient | null;
}

/**
 * A dedicated jump-straight-there entry point for a patient's Laboratories/
 * Medication Intake — skips the Kardex form entirely. Wraps the same
 * KardexLabsAndMedications component KardexPage's history detail view
 * uses, so behavior (permissions, validation) is identical.
 */
export function LabsAndMedicationsModal({ open, onOpenChange, patient }: LabsAndMedicationsModalProps) {
  if (!patient) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px] max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="w-5 h-5 text-blue-600" />
            Laboratories &amp; Medication Intake
          </DialogTitle>
          <DialogDescription>
            {patient.name} · {patient.id}
          </DialogDescription>
        </DialogHeader>
        <KardexLabsAndMedications key={patient.id} patientId={patient.id} />
      </DialogContent>
    </Dialog>
  );
}
