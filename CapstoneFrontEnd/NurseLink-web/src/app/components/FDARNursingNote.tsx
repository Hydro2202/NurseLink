import React from 'react';
import { Card, CardContent, CardHeader } from './ui/card';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import {
  User,
  Stethoscope,
  Activity,
  FileText,
  AlertCircle,
  Clock,
  MapPin,
  Heart,
  Thermometer,
  Droplet,
  Wind,
  Calendar,
  Pill,
  Target,
  ClipboardList,
  Wrench,
  TrendingUp,
} from 'lucide-react';

interface VitalSign {
  label: string;
  value: string;
  icon: React.ReactNode;
}

interface FDARNursingNoteProps {
  patientName: string;
  patientId: string;
  room: string;
  date: string;
  time: string;
  attendingPhysician: string;
  nurseName: string;
  vitalSigns: {
    heartRate: string;
    bloodPressure: string;
    temperature: string;
    oxygenSaturation: string;
    respiratoryRate: string;
  };
  diagnosis: string;
  riskLevel: string;
  allergies: string;
  medications: string;
  alerts: string;
  focus: string;
  data: string;
  action: string;
  response: string;
  plan?: string;
  clinicalSummary?: string;
  timestamp: string;
  isDraft?: boolean;
  onEdit?: () => void;
}

export function FDARNursingNote({
  patientName,
  patientId,
  room,
  date,
  time,
  attendingPhysician,
  nurseName,
  vitalSigns,
  diagnosis,
  riskLevel,
  allergies,
  medications,
  alerts,
  focus,
  data,
  action,
  response,
  plan,
  clinicalSummary,
  timestamp,
  isDraft = false,
}: FDARNursingNoteProps) {
  const vitalSignsData: VitalSign[] = [
    { label: 'Heart Rate', value: vitalSigns.heartRate, icon: <Heart className="w-4 h-4 text-red-500" /> },
    { label: 'Blood Pressure', value: vitalSigns.bloodPressure, icon: <Activity className="w-4 h-4 text-blue-500" /> },
    { label: 'Temperature', value: vitalSigns.temperature, icon: <Thermometer className="w-4 h-4 text-orange-500" /> },
    { label: 'O₂ Saturation', value: vitalSigns.oxygenSaturation, icon: <Droplet className="w-4 h-4 text-cyan-500" /> },
    { label: 'Respiratory Rate', value: vitalSigns.respiratoryRate, icon: <Wind className="w-4 h-4 text-teal-500" /> },
  ].filter((vital) => Boolean(vital.value && String(vital.value).trim()));

  const getRiskColor = (risk: string) => {
    const riskLower = risk.toLowerCase();
    if (riskLower === 'high' || riskLower === 'critical') return 'bg-red-100 text-red-800 border-red-300';
    if (riskLower === 'medium') return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    return 'bg-green-100 text-green-800 border-green-300';
  };

  const hasClinicalContext =
    Boolean(diagnosis?.trim()) ||
    Boolean(riskLevel?.trim()) ||
    Boolean(allergies?.trim()) ||
    Boolean(medications?.trim()) ||
    Boolean(alerts?.trim());
  const hasPlan = Boolean(plan?.trim()) || Boolean(clinicalSummary?.trim());

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <FileText className="w-6 h-6 text-blue-600" />
                <h2 className="text-2xl font-bold text-gray-900">FDAR Nursing Note</h2>
              </div>
              <p className="text-sm text-gray-600">Focus · Data · Action · Response Documentation</p>
            </div>
            {isDraft && (
              <Badge variant="outline" className="bg-yellow-100 border-yellow-300 text-yellow-800">
                Draft
              </Badge>
            )}
          </div>
        </CardHeader>
      </Card>

      {/* Patient Information */}
      <Card className="border-l-4 border-l-blue-500">
        <CardHeader>
          <div className="flex items-center gap-2">
            <User className="w-5 h-5 text-blue-600" />
            <h3 className="text-lg font-semibold">Patient Information</h3>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-gray-600 mb-1">Patient Name</p>
              <p className="font-semibold text-base">{patientName}</p>
            </div>
            <div>
              <p className="text-xs text-gray-600 mb-1">Patient ID</p>
              <p className="font-semibold text-base">{patientId}</p>
            </div>
            <div>
              <p className="text-xs text-gray-600 mb-1 flex items-center gap-1">
                <MapPin className="w-3 h-3" /> Room
              </p>
              <p className="font-semibold text-base">{room}</p>
            </div>
            <div>
              <p className="text-xs text-gray-600 mb-1 flex items-center gap-1">
                <Calendar className="w-3 h-3" /> Date & Time
              </p>
              <p className="font-semibold text-sm">{date}</p>
              <p className="text-sm text-gray-700">{time}</p>
            </div>
          </div>

          <Separator className="my-4" />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
              <p className="text-xs text-blue-700 mb-1 flex items-center gap-1">
                <Stethoscope className="w-3 h-3" /> Attending Physician
              </p>
              <p className="font-semibold text-sm text-blue-900">{attendingPhysician}</p>
            </div>
            <div className="bg-purple-50 p-3 rounded-lg border border-purple-200">
              <p className="text-xs text-purple-700 mb-1 flex items-center gap-1">
                <User className="w-3 h-3" /> Documenting Nurse
                <span className="text-[10px] bg-purple-200 px-1.5 py-0.5 rounded ml-1">Auto-assigned</span>
              </p>
              <p className="font-semibold text-sm text-purple-900">{nurseName}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Vital Signs — only values that were actually recorded */}
      {vitalSignsData.length > 0 && (
        <Card className="border-l-4 border-l-red-500">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-red-600" />
              <h3 className="text-lg font-semibold">Vital Signs</h3>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {vitalSignsData.map((vital, index) => (
                <div
                  key={index}
                  className="bg-gradient-to-br from-gray-50 to-white border-2 border-gray-200 rounded-lg p-3 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center gap-2 mb-2">
                    {vital.icon}
                    <p className="text-xs font-medium text-gray-600">{vital.label}</p>
                  </div>
                  <p className="text-lg font-bold text-gray-900">{vital.value}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Clinical Context — patient-record metadata, kept separate from the nurse-authored FDAR sections below */}
      {hasClinicalContext && (
        <Card className="border-l-4 border-l-gray-400">
          <CardHeader>
            <div className="flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-gray-600" />
              <h3 className="text-lg font-semibold">Clinical Context</h3>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {(diagnosis?.trim() || riskLevel?.trim()) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {diagnosis?.trim() && (
                  <div>
                    <p className="text-xs font-semibold text-gray-600 mb-2">Current Diagnosis</p>
                    <p className="text-sm text-gray-900">{diagnosis}</p>
                  </div>
                )}
                {riskLevel?.trim() && (
                  <div>
                    <p className="text-xs font-semibold text-gray-600 mb-2">Risk Level</p>
                    <Badge className={getRiskColor(riskLevel)}>{riskLevel}</Badge>
                  </div>
                )}
              </div>
            )}
            {(allergies?.trim() || medications?.trim() || alerts?.trim()) && (
              <div className="space-y-3">
                {allergies?.trim() && (
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-xs font-semibold text-gray-600 mb-1">Allergies</p>
                      <p className="text-sm text-gray-900">{allergies}</p>
                    </div>
                  </div>
                )}
                {medications?.trim() && (
                  <div className="flex items-start gap-2">
                    <Pill className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-xs font-semibold text-gray-600 mb-1">Active Medications</p>
                      <p className="text-sm text-gray-900">{medications}</p>
                    </div>
                  </div>
                )}
                {alerts?.trim() && (
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-orange-500 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-xs font-semibold text-gray-600 mb-1">Alerts</p>
                      <p className="text-sm text-gray-900">{alerts}</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Focus */}
      {focus?.trim() && (
        <Card className="border-l-4 border-l-purple-500">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Target className="w-5 h-5 text-purple-600" />
              <h3 className="text-lg font-semibold">Focus</h3>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed text-gray-800 whitespace-pre-wrap">{focus}</p>
          </CardContent>
        </Card>
      )}

      {/* Data */}
      {data?.trim() && (
        <Card className="border-l-4 border-l-blue-500">
          <CardHeader>
            <div className="flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-blue-600" />
              <h3 className="text-lg font-semibold">Data</h3>
            </div>
          </CardHeader>
          <CardContent>
            <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
              <p className="text-sm leading-relaxed text-gray-800 whitespace-pre-wrap">{data}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Action */}
      {action?.trim() && (
        <Card className="border-l-4 border-l-green-500">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Wrench className="w-5 h-5 text-green-600" />
              <h3 className="text-lg font-semibold">Action</h3>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {action
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean)
                .map((line, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500 mt-2 flex-shrink-0" />
                    <p className="text-sm text-gray-800">{line.replace(/^-\s*/, '')}</p>
                  </li>
                ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Response */}
      {(response?.trim() || hasPlan) && (
        <Card className="border-l-4 border-l-teal-500">
          <CardHeader>
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-teal-600" />
              <h3 className="text-lg font-semibold">Response</h3>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {response?.trim() && (
              <p className="text-sm leading-relaxed text-gray-800 whitespace-pre-wrap">{response}</p>
            )}
            {hasPlan && (
              <>
                {response?.trim() && <Separator />}
                {clinicalSummary?.trim() && (
                  <div>
                    <p className="text-xs font-semibold text-gray-600 mb-2">Clinical Summary</p>
                    <p className="text-sm text-gray-900">{clinicalSummary}</p>
                  </div>
                )}
                {plan?.trim() && (
                  <div>
                    <p className="text-xs font-semibold text-gray-600 mb-2">Plan / Follow-up</p>
                    <p className="text-sm text-gray-900">{plan}</p>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Footer - Electronic Signature */}
      <Card className="border-t-4 border-t-gray-300 bg-gray-50">
        <CardContent className="py-4">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-gray-500" />
              <span className="text-gray-600">Electronically signed by:</span>
              <span className="font-semibold text-gray-900">{nurseName}</span>
            </div>
            <div className="text-xs text-gray-500">
              <span>Timestamp: {timestamp}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
