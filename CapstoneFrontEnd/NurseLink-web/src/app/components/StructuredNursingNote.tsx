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
  ClipboardList,
  TrendingUp,
  CheckCircle2,
} from 'lucide-react';

interface VitalSign {
  label: string;
  value: string;
  icon: React.ReactNode;
}

interface StructuredNursingNoteProps {
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
  assessment: string;
  diagnosis: string;
  riskLevel: string;
  allergies: string;
  medications: string;
  alerts: string;
  interventions?: string[];
  patientResponse?: string;
  clinicalSummary?: string;
  plan?: string;
  timestamp: string;
  isDraft?: boolean;
  onEdit?: () => void;
}

export function StructuredNursingNote({
  patientName,
  patientId,
  room,
  date,
  time,
  attendingPhysician,
  nurseName,
  vitalSigns,
  assessment,
  diagnosis,
  riskLevel,
  allergies,
  medications,
  alerts,
  interventions,
  patientResponse,
  clinicalSummary,
  plan,
  timestamp,
  isDraft = false,
}: StructuredNursingNoteProps) {
  const vitalSignsData: VitalSign[] = [
    {
      label: 'Heart Rate',
      value: vitalSigns.heartRate,
      icon: <Heart className="w-4 h-4 text-red-500" />,
    },
    {
      label: 'Blood Pressure',
      value: vitalSigns.bloodPressure,
      icon: <Activity className="w-4 h-4 text-blue-500" />,
    },
    {
      label: 'Temperature',
      value: vitalSigns.temperature,
      icon: <Thermometer className="w-4 h-4 text-orange-500" />,
    },
    {
      label: 'O₂ Saturation',
      value: vitalSigns.oxygenSaturation,
      icon: <Droplet className="w-4 h-4 text-cyan-500" />,
    },
    {
      label: 'Respiratory Rate',
      value: vitalSigns.respiratoryRate,
      icon: <Wind className="w-4 h-4 text-teal-500" />,
    },
  ];

  const getRiskColor = (risk: string) => {
    const riskLower = risk.toLowerCase();
    if (riskLower === 'high') return 'bg-red-100 text-red-800 border-red-300';
    if (riskLower === 'medium') return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    return 'bg-green-100 text-green-800 border-green-300';
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <FileText className="w-6 h-6 text-blue-600" />
                <h2 className="text-2xl font-bold text-gray-900">Nursing Progress Note</h2>
              </div>
              <p className="text-sm text-gray-600">Electronic Health Record Documentation</p>
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

      {/* Vital Signs */}
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

      {/* Assessment & Observations */}
      <Card className="border-l-4 border-l-green-500">
        <CardHeader>
          <div className="flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-green-600" />
            <h3 className="text-lg font-semibold">Assessment & Observations</h3>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
            <p className="text-sm leading-relaxed text-gray-800 whitespace-pre-wrap">{assessment}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-2">Current Diagnosis</p>
              <p className="text-sm text-gray-900">{diagnosis}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-2">Risk Level</p>
              <Badge className={getRiskColor(riskLevel)}>{riskLevel}</Badge>
            </div>
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-xs font-semibold text-gray-600 mb-1">Allergies</p>
                <p className="text-sm text-gray-900">{allergies}</p>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <Pill className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-xs font-semibold text-gray-600 mb-1">Active Medications</p>
                <p className="text-sm text-gray-900">{medications}</p>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-orange-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-xs font-semibold text-gray-600 mb-1">Alerts</p>
                <p className="text-sm text-gray-900">{alerts}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Interventions Performed */}
      {interventions && interventions.length > 0 && (
        <Card className="border-l-4 border-l-purple-500">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-purple-600" />
              <h3 className="text-lg font-semibold">Interventions Performed</h3>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {interventions.map((intervention, index) => (
                <li key={index} className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-purple-500 mt-2 flex-shrink-0" />
                  <p className="text-sm text-gray-800">{intervention}</p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Patient Response */}
      {patientResponse && (
        <Card className="border-l-4 border-l-teal-500">
          <CardHeader>
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-teal-600" />
              <h3 className="text-lg font-semibold">Patient Response</h3>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed text-gray-800">{patientResponse}</p>
          </CardContent>
        </Card>
      )}

      {/* Clinical Summary */}
      {clinicalSummary && (
        <Card className="border-l-4 border-l-indigo-500 bg-gradient-to-br from-indigo-50 to-white">
          <CardHeader>
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-indigo-600" />
              <h3 className="text-lg font-semibold">Clinical Summary</h3>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm leading-relaxed text-gray-800">{clinicalSummary}</p>

            {plan && (
              <>
                <Separator />
                <div>
                  <p className="text-xs font-semibold text-gray-600 mb-2">Plan</p>
                  <p className="text-sm text-gray-900">{plan}</p>
                </div>
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
