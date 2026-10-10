import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Badge } from './ui/badge';
import {
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  FileText,
  HeartPulse,
  Loader2,
  MapPin,
  Sparkles,
  Stethoscope,
  User,
} from 'lucide-react';
import { fetchPatientVisits, ApiError } from '../api/nurselink';
import type { Patient, PatientVisit } from '../types/domain';

interface PatientVisitHistoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: Patient | null;
}

function formatDate(value: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(value: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const METHOD_FIELDS: {
  key: 'medications' | 'environment' | 'treatment' | 'healthTeaching' | 'outpatientReferral' | 'diet';
  letter: string;
  label: string;
}[] = [
  { key: 'medications', letter: 'M', label: 'Medications' },
  { key: 'environment', letter: 'E', label: 'Environment' },
  { key: 'treatment', letter: 'T', label: 'Treatment' },
  { key: 'healthTeaching', letter: 'H', label: 'Health Teaching' },
  { key: 'outpatientReferral', letter: 'O', label: 'Outpatient Referral' },
  { key: 'diet', letter: 'D', label: 'Diet' },
];

export function PatientVisitHistoryModal({ open, onOpenChange, patient }: PatientVisitHistoryModalProps) {
  const [visits, setVisits] = useState<PatientVisit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedPlans, setExpandedPlans] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!open || !patient) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setVisits([]);
    setExpandedPlans(new Set());
    fetchPatientVisits(patient.id)
      .then((data) => {
        if (!cancelled) setVisits(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Failed to load visit history.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, patient]);

  const togglePlan = (visitId: number) => {
    setExpandedPlans((prev) => {
      const next = new Set(prev);
      if (next.has(visitId)) next.delete(visitId);
      else next.add(visitId);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Visit History</DialogTitle>
          <DialogDescription>{patient ? `${patient.name} · ${patient.id}` : ''}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        ) : error ? (
          <p className="py-8 text-center text-sm text-red-600">{error}</p>
        ) : visits.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">No visit history recorded yet.</p>
        ) : (
          <div className="space-y-3">
            {visits.map((visit) => {
              const latest = visit.vitals[0];
              const expanded = expandedPlans.has(visit.id);
              return (
                <div
                  key={visit.id}
                  className={`space-y-2 rounded-lg border p-3.5 ${
                    visit.isActive ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-sm font-bold text-gray-900">
                      <CalendarDays className="w-3.5 h-3.5 text-blue-700" />
                      {formatDate(visit.admissionDate)} —{' '}
                      {visit.isActive ? 'Present' : formatDate(visit.dischargeDate)}
                    </div>
                    <Badge variant={visit.isActive ? 'info' : 'outline'}>
                      {visit.isActive ? 'Current Visit' : 'Past Visit'}
                    </Badge>
                  </div>

                  <p className="text-sm font-semibold text-gray-900">
                    {visit.diagnosis || 'No diagnosis recorded'}
                  </p>

                  <div className="space-y-1 text-xs text-gray-600">
                    <div className="flex items-center gap-1.5">
                      <MapPin className="w-3 h-3 shrink-0" />
                      {visit.room || 'No room recorded'}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Stethoscope className="w-3 h-3 shrink-0" />
                      {visit.attendingPhysician || 'No physician recorded'}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <User className="w-3 h-3 shrink-0" />
                      {visit.assignedNurseName || 'No nurse recorded'}
                    </div>
                  </div>

                  {visit.medicalTeam.length > 0 ? (
                    <div className="flex items-start gap-1.5 text-xs text-blue-800">
                      <Building2 className="w-3 h-3 mt-0.5 shrink-0 text-blue-700" />
                      <span className="line-clamp-2">
                        {visit.medicalTeam.map((d) => `${d.name} (${d.departmentName})`).join(', ')}
                      </span>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-gray-700">
                      <HeartPulse className="w-3 h-3 text-red-600" />
                      {visit.vitals.length} vitals reading{visit.vitals.length === 1 ? '' : 's'}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-gray-700">
                      <FileText className="w-3 h-3 text-blue-600" />
                      {visit.notes.length} note{visit.notes.length === 1 ? '' : 's'}
                    </span>
                  </div>

                  {latest ? (
                    <div className="rounded-md bg-white p-2">
                      <p className="text-[10.5px] font-semibold text-gray-500">
                        Most recent · {formatDateTime(latest.recordedAt)}
                      </p>
                      <p className="text-xs font-semibold text-gray-900">
                        {[
                          latest.heartRate != null ? `HR ${latest.heartRate}` : null,
                          latest.bloodPressure ? `BP ${latest.bloodPressure}` : null,
                          latest.temperature != null ? `Temp ${latest.temperature}°C` : null,
                          latest.oxygenSaturation != null ? `SpO2 ${latest.oxygenSaturation}%` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ') || 'No values documented'}
                      </p>
                    </div>
                  ) : null}

                  {visit.dischargedByName ? (
                    <p className="text-xs italic text-gray-500">Discharged by {visit.dischargedByName}</p>
                  ) : null}

                  {visit.hasDischargePlan && visit.dischargePlan ? (
                    <div className="mt-1 border-t border-gray-200 pt-2">
                      <button
                        type="button"
                        onClick={() => togglePlan(visit.id)}
                        className="flex w-full items-center justify-between"
                        aria-expanded={expanded}
                      >
                        <span className="flex items-center gap-1.5 text-xs font-bold text-blue-700">
                          <ClipboardCheck className="w-3.5 h-3.5" />
                          Discharge Plan
                          {visit.dischargePlan.aiGenerated ? (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-blue-100 px-1.5 py-0.5 text-[9.5px] font-semibold text-blue-700">
                              <Sparkles className="w-2.5 h-2.5" />
                              AI-assisted
                            </span>
                          ) : null}
                        </span>
                        {expanded ? (
                          <ChevronUp className="w-3.5 h-3.5 text-gray-500" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
                        )}
                      </button>

                      {expanded ? (
                        <div className="mt-2.5 space-y-2.5">
                          {METHOD_FIELDS.map(({ key, letter, label }) => (
                            <div key={key} className="space-y-0.5">
                              <div className="flex items-center gap-1.5">
                                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-blue-100 text-[9px] font-bold text-blue-700">
                                  {letter}
                                </span>
                                <span className="text-[11.5px] font-semibold text-gray-700">{label}</span>
                              </div>
                              <p className="whitespace-pre-wrap pl-[22px] text-xs leading-4 text-gray-900">
                                {visit.dischargePlan?.[key] || 'Not documented'}
                              </p>
                            </div>
                          ))}
                          <p className="text-[11px] italic text-gray-500">
                            Completed by {visit.dischargePlan.completedByName || 'Unknown'}
                            {visit.dischargePlan.completedAt
                              ? ` on ${formatDateTime(visit.dischargePlan.completedAt)}`
                              : ''}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
