import React, { useEffect, useState } from 'react';
import { Patient } from '../data/mockData';
import { fetchPatients } from '../api/nurselink';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
  Search,
  UserPlus,
  Activity,
  User,
  MapPin,
  AlertCircle,
  Calendar,
  Stethoscope,
  Eye,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { TaskAssignmentModal } from '../components/TaskAssignmentModal';
import { useNavigate } from 'react-router';

export default function AllPatientsPage() {
  const navigate = useNavigate();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loadingPatients, setLoadingPatients] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [roomFilter, setRoomFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [taskModalOpen, setTaskModalOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchPatients();
        if (!cancelled) setPatients(data);
      } catch (error) {
        console.error('Failed to load patients:', error);
      } finally {
        if (!cancelled) setLoadingPatients(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Get unique rooms for filter
  const uniqueRooms = Array.from(new Set(patients.map(p => p.room.split('-')[0])));

  // Filter patients
  const filteredPatients = patients.filter(patient => {
    const matchesSearch = 
      patient.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      patient.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      patient.room.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesRoom = roomFilter === 'all' || patient.room.startsWith(roomFilter);
    const matchesRisk = riskFilter === 'all' || patient.riskLevel === riskFilter;

    return matchesSearch && matchesRoom && matchesRisk;
  });

  const handleAssignTask = (patient: Patient) => {
    setSelectedPatient(patient);
    setTaskModalOpen(true);
  };

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'high': return 'bg-red-100 text-red-800 border-red-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'low': return 'bg-green-100 text-green-800 border-green-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getAttendingPhysician = (diagnosis: string) => {
    if (diagnosis.toLowerCase().includes('cardiac') || diagnosis.toLowerCase().includes('heart')) {
      return 'Dr. Sarah Mitchell';
    } else if (diagnosis.toLowerCase().includes('septic') || diagnosis.toLowerCase().includes('infection')) {
      return 'Dr. James Rodriguez';
    } else if (diagnosis.toLowerCase().includes('pneumonia') || diagnosis.toLowerCase().includes('respiratory')) {
      return 'Dr. Emily Chen';
    } else if (diagnosis.toLowerCase().includes('stroke') || diagnosis.toLowerCase().includes('cva')) {
      return 'Dr. Robert Williams';
    } else if (diagnosis.toLowerCase().includes('kidney') || diagnosis.toLowerCase().includes('renal')) {
      return 'Dr. Patricia Brown';
    } else if (diagnosis.toLowerCase().includes('diabetes')) {
      return 'Dr. David Lee';
    } else {
      return 'Dr. Michael Anderson';
    }
  };

  return (
    <div className="p-4 md:p-6 pb-24 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">All Patients</h1>
        <p className="text-gray-600">
          Supervisor view - {filteredPatients.length} of {patients.length} patients
          {loadingPatients ? ' (loading...)' : ''}
        </p>
      </div>

      {/* Search and Filters */}
      <div className="space-y-3">
        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
          <Input
            type="text"
            placeholder="Search by name, patient ID, or room..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-10 shadow-md border-2 border-gray-200 focus:border-blue-500 focus:shadow-lg focus:ring-2 focus:ring-blue-200"
          />
        </div>

        {/* Filters */}
        <div className="flex gap-3 flex-wrap">
          <Select value={roomFilter} onValueChange={setRoomFilter}>
            <SelectTrigger className="w-[180px] shadow-md border-2 border-gray-200">
              <SelectValue placeholder="Filter by room" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Rooms</SelectItem>
              {uniqueRooms.map(room => (
                <SelectItem key={room} value={room}>{room}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={riskFilter} onValueChange={setRiskFilter}>
            <SelectTrigger className="w-[180px] shadow-md border-2 border-gray-200">
              <SelectValue placeholder="Filter by risk" />
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

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-600">Total Patients</p>
                <p className="text-2xl font-bold text-gray-900">{patients.length}</p>
              </div>
              <User className="w-8 h-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-600">High Risk</p>
                <p className="text-2xl font-bold text-red-600">
                  {patients.filter(p => p.riskLevel === 'high').length}
                </p>
              </div>
              <AlertCircle className="w-8 h-8 text-red-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-600">Medium Risk</p>
                <p className="text-2xl font-bold text-yellow-600">
                  {patients.filter(p => p.riskLevel === 'medium').length}
                </p>
              </div>
              <Activity className="w-8 h-8 text-yellow-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-600">Low Risk</p>
                <p className="text-2xl font-bold text-green-600">
                  {patients.filter(p => p.riskLevel === 'low').length}
                </p>
              </div>
              <Activity className="w-8 h-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Patient List */}
      <div className="space-y-3">
        {filteredPatients.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-gray-500">No patients found</p>
            </CardContent>
          </Card>
        ) : (
          filteredPatients.map(patient => (
            <Card key={patient.id} className="border-2 hover:shadow-lg transition-all">
              <CardContent className="p-4">
                <div className="space-y-3">
                  {/* Header Row */}
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-lg font-bold text-gray-900">{patient.name}</h3>
                        <Badge variant="outline" className="text-xs">
                          {patient.id}
                        </Badge>
                        <Badge className={`text-xs border ${getRiskColor(patient.riskLevel)}`}>
                          {patient.riskLevel.toUpperCase()} RISK
                        </Badge>
                      </div>
                      
                      <div className="flex items-center gap-4 mt-2 text-sm text-gray-600 flex-wrap">
                        <span className="flex items-center gap-1">
                          <User className="w-4 h-4" />
                          {patient.age}y • {patient.gender}
                        </span>
                        <span className="flex items-center gap-1">
                          <MapPin className="w-4 h-4" />
                          {patient.room}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="w-4 h-4" />
                          Admitted {new Date(patient.admissionDate).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Diagnosis & Physician */}
                  <div className="space-y-2">
                    <div className="p-2 bg-gray-50 rounded-lg">
                      <p className="text-sm">
                        <span className="font-semibold">Diagnosis:</span> {patient.diagnosis}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-blue-700">
                      <Stethoscope className="w-4 h-4" />
                      <span className="font-medium">{getAttendingPhysician(patient.diagnosis)}</span>
                    </div>
                  </div>

                  {/* Vital Signs */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    <div className="p-2 bg-blue-50 rounded text-center">
                      <p className="text-xs text-gray-600">HR</p>
                      <p className="text-sm font-bold">{patient.vitalSigns.heartRate}</p>
                    </div>
                    <div className="p-2 bg-blue-50 rounded text-center">
                      <p className="text-xs text-gray-600">BP</p>
                      <p className="text-sm font-bold">{patient.vitalSigns.bloodPressure}</p>
                    </div>
                    <div className="p-2 bg-blue-50 rounded text-center">
                      <p className="text-xs text-gray-600">Temp</p>
                      <p className="text-sm font-bold">{patient.vitalSigns.temperature}°C</p>
                    </div>
                    <div className="p-2 bg-blue-50 rounded text-center">
                      <p className="text-xs text-gray-600">SpO2</p>
                      <p className="text-sm font-bold">{patient.vitalSigns.oxygenSaturation}%</p>
                    </div>
                    <div className="p-2 bg-blue-50 rounded text-center">
                      <p className="text-xs text-gray-600">RR</p>
                      <p className="text-sm font-bold">{patient.vitalSigns.respiratoryRate}</p>
                    </div>
                  </div>

                  {/* Alerts */}
                  {patient.alerts.length > 0 && (
                    <div className="flex gap-2 flex-wrap">
                      {patient.alerts.map((alert, idx) => (
                        <Badge key={idx} variant="outline" className="text-xs bg-orange-50 border-orange-300 text-orange-800">
                          <AlertCircle className="w-3 h-3 mr-1" />
                          {alert}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate('/my-patients', { state: { viewPatient: patient.id } })}
                      className="w-full"
                    >
                      <Eye className="w-4 h-4 mr-2" />
                      View Details
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => handleAssignTask(patient)}
                      className="w-full bg-blue-600 hover:bg-blue-700"
                    >
                      <UserPlus className="w-4 h-4 mr-2" />
                      Assign Task
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Task Assignment Modal */}
      <TaskAssignmentModal
        open={taskModalOpen}
        onOpenChange={setTaskModalOpen}
        patient={selectedPatient}
        onTaskAssigned={() => {
          // Refresh or update state if needed
        }}
      />
    </div>
  );
}
