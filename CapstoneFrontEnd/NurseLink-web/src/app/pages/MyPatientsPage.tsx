import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, useLocation } from 'react-router';
import { Patient } from '../types/domain';
import { fetchPatients, deletePatient, ApiError } from '../api/nurselink';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
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
import {
  User,
  MapPin,
  Calendar,
  AlertTriangle,
  Search,
  ArrowLeft,
  Heart,
  Activity,
  Thermometer,
  Stethoscope,
  Pill,
  AlertCircle,
  Edit2,
  Trash2,
} from 'lucide-react';
import { PatientKardexModal } from '../components/PatientKardexModal';
import { toast } from 'sonner';

export default function MyPatientsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [assignedPatients, setAssignedPatients] = useState<Patient[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [roomFilter, setRoomFilter] = useState<string>('all');
  const [riskFilter, setRiskFilter] = useState<string>('all');
  const [highlightedPatientId, setHighlightedPatientId] = useState<string | null>(null);
  const patientRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const [editOpen, setEditOpen] = useState(false);
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Patient | null>(null);

  const loadPatients = async () => {
    if (!user) return;
    try {
      const data = await fetchPatients({ mine: true });
      setAssignedPatients(data);
    } catch (error) {
      console.error('Failed to load assigned patients:', error);
      setAssignedPatients([]);
    }
  };

  useEffect(() => {
    loadPatients();
  }, [user]);

  // Auto-scroll and highlight patient when navigating from All Patients page
  useEffect(() => {
    const state = location.state as { viewPatient?: string };
    if (state?.viewPatient) {
      const targetPatientId = state.viewPatient;
      
      // Wait for DOM to be ready
      setTimeout(() => {
        const patientElement = patientRefs.current[targetPatientId];
        if (patientElement) {
          // Scroll to patient card with smooth behavior
          patientElement.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'center'
          });
          
          // Add highlight effect
          setHighlightedPatientId(targetPatientId);
          
          // Remove highlight after 3 seconds
          setTimeout(() => {
            setHighlightedPatientId(null);
          }, 3000);
        }
      }, 100);
      
      // Clear the state to prevent re-triggering on re-render
      window.history.replaceState({}, document.title);
    }
  }, [location]);

  // Filter patients based on search and filters
  const filteredPatients = useMemo(() => {
    let filtered = assignedPatients;

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        p =>
          p.name.toLowerCase().includes(query) ||
          p.id.toLowerCase().includes(query) ||
          p.room.toLowerCase().includes(query) ||
          p.diagnosis.toLowerCase().includes(query)
      );
    }

    // Room filter
    if (roomFilter !== 'all') {
      filtered = filtered.filter(p => p.room.startsWith(roomFilter));
    }

    // Risk filter
    if (riskFilter !== 'all') {
      filtered = filtered.filter(p => p.riskLevel === riskFilter);
    }

    return filtered;
  }, [assignedPatients, searchQuery, roomFilter, riskFilter]);

  // Get unique room prefixes for filter
  const roomPrefixes = useMemo(() => {
    const prefixes = new Set(assignedPatients.map(p => p.room.split('-')[0]));
    return Array.from(prefixes);
  }, [assignedPatients]);

  // Get attending physician for patient
  const getAttendingPhysician = (patient: { attendingPhysician?: string }): string => {
    return patient.attendingPhysician?.trim() || 'Not Assigned';
  };

  const getRiskBadgeVariant = (risk: string) => {
    switch (risk) {
      case 'high':
        return 'destructive';
      case 'medium':
        return 'default';
      case 'low':
        return 'outline';
      default:
        return 'outline';
    }
  };

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20 lg:pb-8 prevent-overflow">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="w-full max-w-7xl mx-auto px-3 sm:px-4 py-3 sm:py-4">
          <div className="flex items-center gap-3 mb-3 sm:mb-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/dashboard')}
              className="lg:hidden touch-target"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="flex-1 min-w-0">
              <h1 className="text-lg sm:text-xl lg:text-2xl font-bold text-gray-900 truncate">My Assigned Patients</h1>
              <p className="text-xs sm:text-sm text-gray-600 mt-0.5">
                {filteredPatients.length} of {assignedPatients.length} patient{assignedPatients.length !== 1 ? 's' : ''} assigned to you
              </p>
            </div>
          </div>

          {/* Search and Filters */}
          <div className="space-y-3">
            {/* Search Bar */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                type="text"
                placeholder="Search by name, ID, room, or diagnosis..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 touch-target"
              />
            </div>

            {/* Filters */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Select value={roomFilter} onValueChange={setRoomFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Rooms" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Rooms</SelectItem>
                    {roomPrefixes.map(prefix => (
                      <SelectItem key={prefix} value={prefix}>
                        {prefix}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Select value={riskFilter} onValueChange={setRiskFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Risk Levels" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Risk Levels</SelectItem>
                    <SelectItem value="high">High Risk</SelectItem>
                    <SelectItem value="medium">Medium Risk</SelectItem>
                    <SelectItem value="low">Low Risk</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Patient List */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        {filteredPatients.length === 0 ? (
          <Card className="border border-gray-200">
            <CardContent className="py-12 text-center">
              <User className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {assignedPatients.length === 0 ? 'No Patients Assigned' : 'No Patients Found'}
              </h3>
              <p className="text-sm text-gray-600">
                {assignedPatients.length === 0
                  ? 'You currently have no patients assigned to you.'
                  : 'Try adjusting your search or filter criteria.'}
              </p>
              {searchQuery || roomFilter !== 'all' || riskFilter !== 'all' ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => {
                    setSearchQuery('');
                    setRoomFilter('all');
                    setRiskFilter('all');
                  }}
                >
                  Clear Filters
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filteredPatients.map((patient) => (
              <div
                key={patient.id}
                ref={el => { patientRefs.current[patient.id] = el; }}
              >
                <Card
                  className={`border-l-4 hover:shadow-lg transition-shadow ${
                    patient.riskLevel === 'high'
                      ? 'border-l-red-500 bg-red-50/30'
                      : patient.riskLevel === 'medium'
                      ? 'border-l-yellow-500 bg-yellow-50/30'
                      : 'border-l-green-500 bg-green-50/30'
                  }`}
                  style={highlightedPatientId === patient.id ? { boxShadow: '0 0 10px 5px rgba(0, 153, 255, 0.5)' } : {}}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-lg font-bold text-gray-900 mb-1">
                          {patient.name}
                        </CardTitle>
                        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
                          <span className="font-medium">{patient.id}</span>
                          <span className="text-gray-400">•</span>
                          <span>{patient.age} y/o {patient.gender}</span>
                        </div>
                      </div>
                      <Badge variant={getRiskBadgeVariant(patient.riskLevel)} className="flex-shrink-0">
                        {patient.riskLevel.toUpperCase()}
                      </Badge>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    {/* Room and Admission Info */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex items-center gap-2 text-sm">
                        <MapPin className="w-4 h-4 text-blue-600 flex-shrink-0" />
                        <div>
                          <p className="text-xs text-gray-500">Room</p>
                          <p className="font-semibold text-gray-900">{patient.room}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <Calendar className="w-4 h-4 text-purple-600 flex-shrink-0" />
                        <div>
                          <p className="text-xs text-gray-500">Admitted</p>
                          <p className="font-semibold text-gray-900">
                            {new Date(patient.admissionDate).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                            })}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Diagnosis */}
                    <div className="bg-white rounded-lg p-3 border border-gray-200">
                      <div className="flex items-start gap-2">
                        <Stethoscope className="w-4 h-4 text-teal-600 flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-gray-500 mb-1">Diagnosis</p>
                          <p className="text-sm font-medium text-gray-900">{patient.diagnosis}</p>
                        </div>
                      </div>
                    </div>

                    {/* Attending Physician */}
                    <div className="bg-white rounded-lg p-3 border border-gray-200">
                      <div className="flex items-start gap-2">
                        <User className="w-4 h-4 text-indigo-600 flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-gray-500 mb-1">Attending Physician</p>
                          <p className="text-sm font-medium text-gray-900">
                            {getAttendingPhysician(patient)}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Vital Signs */}
                    <div className="bg-white rounded-lg p-3 border border-gray-200">
                      <p className="text-xs font-semibold text-gray-700 mb-2">Latest Vitals</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="flex items-center gap-2">
                          <Heart className="w-3.5 h-3.5 text-red-600" />
                          <div>
                            <p className="text-xs text-gray-500">HR</p>
                            <p className="text-sm font-bold">{patient.vitalSigns.heartRate} bpm</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Activity className="w-3.5 h-3.5 text-blue-600" />
                          <div>
                            <p className="text-xs text-gray-500">SpO2</p>
                            <p className="text-sm font-bold">{patient.vitalSigns.oxygenSaturation}%</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Thermometer className="w-3.5 h-3.5 text-orange-600" />
                          <div>
                            <p className="text-xs text-gray-500">Temp</p>
                            <p className="text-sm font-bold">{patient.vitalSigns.temperature}°C</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Activity className="w-3.5 h-3.5 text-green-600" />
                          <div>
                            <p className="text-xs text-gray-500">BP</p>
                            <p className="text-sm font-bold">{patient.vitalSigns.bloodPressure}</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Medications */}
                    {patient.medications.length > 0 && (
                      <div className="bg-white rounded-lg p-3 border border-gray-200">
                        <div className="flex items-center gap-2 mb-2">
                          <Pill className="w-4 h-4 text-purple-600" />
                          <p className="text-xs font-semibold text-gray-700">Medications</p>
                        </div>
                        <div className="space-y-1">
                          {patient.medications.slice(0, 3).map((med, idx) => (
                            <p key={idx} className="text-xs text-gray-600">
                              • {med}
                            </p>
                          ))}
                          {patient.medications.length > 3 && (
                            <p className="text-xs text-blue-600 font-medium">
                              +{patient.medications.length - 3} more
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Allergies */}
                    {patient.allergies.length > 0 && patient.allergies[0] !== 'None known' && (
                      <div className="bg-red-50 rounded-lg p-3 border border-red-200">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-red-700 mb-1">Allergies</p>
                            <p className="text-sm font-medium text-red-900">
                              {patient.allergies.join(', ')}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Alerts */}
                    {patient.alerts.length > 0 && (
                      <div className="space-y-2">
                        {patient.alerts.map((alert, idx) => (
                          <div
                            key={idx}
                            className="bg-orange-50 rounded-lg p-3 border border-orange-200"
                          >
                            <div className="flex items-start gap-2">
                              <AlertCircle className="w-4 h-4 text-orange-600 flex-shrink-0 mt-0.5" />
                              <p className="text-sm font-medium text-orange-900 flex-1">{alert}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="grid grid-cols-2 gap-2 pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditingPatient(patient);
                          setEditOpen(true);
                        }}
                        className="w-full"
                      >
                        <Edit2 className="w-4 h-4 mr-2" />
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setToDelete(patient);
                          setDeleteOpen(true);
                        }}
                        className="w-full text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate('/charting', { state: { patientId: patient.id } })}
                        className="w-full"
                      >
                        View Chart
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => navigate('/tasks', { state: { patientId: patient.id, scrollToPatient: true } })}
                        className="w-full bg-blue-600 hover:bg-blue-700"
                      >
                        View Tasks
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ))}
          </div>
        )}
      </div>

      <PatientKardexModal
        open={editOpen}
        onOpenChange={setEditOpen}
        mode="edit"
        patient={editingPatient}
        onSaved={loadPatients}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Patient</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete
                ? `Delete ${toDelete.name}? Related kardex, tasks, and assignments will be removed.`
                : 'Delete this patient?'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                if (!toDelete) return;
                try {
                  await deletePatient(toDelete.id);
                  toast.success('Patient deleted');
                  setToDelete(null);
                  await loadPatients();
                } catch (error) {
                  toast.error('Failed to delete patient', {
                    description: error instanceof ApiError ? error.message : 'Please try again.',
                  });
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}