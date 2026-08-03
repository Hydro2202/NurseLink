import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Separator } from '../components/ui/separator';
import { Badge } from '../components/ui/badge';
import {
  User,
  Heart,
  Pill,
  Droplet,
  Microscope,
  Activity,
  FileText,
  AlertTriangle,
  Printer,
  Save,
  Plus,
  X,
  Clock,
  Calendar,
  History,
  Eye,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { toast } from 'sonner';

interface KardexHistory {
  id: string;
  // Patient Demographics
  patientName: string;
  lastName: string;
  firstName: string;
  middleName: string;
  age: string;
  gender: string;
  religion: string;
  room: string;
  bedNumber: string;
  admissionDate: string;
  // Medical Information
  attendingPhysician: string;
  chiefComplaint: string;
  admittingDiagnosis: string;
  finalDiagnosis: string;
  diet: string;
  // Vital Signs
  temperature: string;
  pulseRate: string;
  respiratoryRate: string;
  bloodPressure: string;
  oxygenSaturation: string;
  // Special Endorsements
  specialEndorsements: string;
  // Metadata
  savedAt: string;
  savedBy: string;
}

export default function KardexPage() {
  // Patient Demographics
  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('');
  const [religion, setReligion] = useState('');
  const [room, setRoom] = useState('');
  const [bedNumber, setBedNumber] = useState('');
  const [admissionDate, setAdmissionDate] = useState('');

  // Medical Information
  const [attendingPhysician, setAttendingPhysician] = useState('');
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [admittingDiagnosis, setAdmittingDiagnosis] = useState('');
  const [finalDiagnosis, setFinalDiagnosis] = useState('');
  const [diet, setDiet] = useState('');

  // Vital Signs
  const [temperature, setTemperature] = useState('');
  const [pulseRate, setPulseRate] = useState('');
  const [respiratoryRate, setRespiratoryRate] = useState('');
  const [bloodPressure, setBloodPressure] = useState('');
  const [oxygenSaturation, setOxygenSaturation] = useState('');

  // Special Endorsements
  const [specialEndorsements, setSpecialEndorsements] = useState('');

  // History
  const [kardexHistory, setKardexHistory] = useState<KardexHistory[]>([]);
  
  // Confirmation Dialog
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  // History Dialog
  const [showHistoryDialog, setShowHistoryDialog] = useState(false);
  const [selectedHistoryEntry, setSelectedHistoryEntry] = useState<KardexHistory | null>(null);

  const handleViewHistory = (entry: KardexHistory) => {
    setSelectedHistoryEntry(entry);
    setShowHistoryDialog(true);
  };

  const handleOpenHistoryList = () => {
    if (kardexHistory.length === 0) {
      toast.info('No History Available', {
        description: 'No kardex records have been saved yet.',
      });
      return;
    }
    setShowHistoryDialog(true);
    setSelectedHistoryEntry(null);
  };

  const validateRequiredFields = () => {
    const errors = [];
    if (!firstName) errors.push('First Name');
    if (!lastName) errors.push('Last Name');
    if (!age) errors.push('Age');
    if (!gender) errors.push('Sex/Gender');
    if (!admissionDate) errors.push('Admission Date');
    if (!room) errors.push('Room');

    return errors;
  };

  const handleSaveClick = () => {
    const errors = validateRequiredFields();
    
    if (errors.length > 0) {
      toast.error('Missing Required Fields', {
        description: `Please fill in: ${errors.join(', ')}`,
      });
      return;
    }

    // Show confirmation dialog
    setShowConfirmDialog(true);
  };

  const handleConfirmSave = () => {
    // Create kardex entry
    const newEntry: KardexHistory = {
      id: `kardex-${Date.now()}`,
      patientName: `${firstName} ${lastName}`,
      lastName: lastName,
      firstName: firstName,
      middleName: middleName,
      age: age,
      gender: gender,
      religion: religion,
      room: room,
      bedNumber: bedNumber,
      admissionDate: admissionDate,
      attendingPhysician: attendingPhysician,
      chiefComplaint: chiefComplaint,
      admittingDiagnosis: admittingDiagnosis,
      finalDiagnosis: finalDiagnosis,
      diet: diet,
      temperature: temperature,
      pulseRate: pulseRate,
      respiratoryRate: respiratoryRate,
      bloodPressure: bloodPressure,
      oxygenSaturation: oxygenSaturation,
      specialEndorsements: specialEndorsements,
      savedAt: new Date().toISOString(),
      savedBy: 'Current User',
    };

    setKardexHistory([newEntry, ...kardexHistory]);
    setShowConfirmDialog(false);

    toast.success('Kardex Saved Successfully! 📋', {
      description: `Patient kardex for ${firstName} ${lastName} has been saved.`,
    });

    // Clear form
    clearForm();
  };

  const handlePrint = () => {
    const errors = validateRequiredFields();
    
    if (errors.length > 0) {
      toast.error('Cannot Print - Missing Required Fields', {
        description: `Please fill in: ${errors.join(', ')}`,
      });
      return;
    }

    toast.info('Printing Kardex...', {
      description: 'Print dialog will open shortly.',
    });
    
    // In a real app, this would trigger print
    setTimeout(() => {
      window.print();
    }, 500);
  };

  const clearForm = () => {
    setLastName('');
    setFirstName('');
    setMiddleName('');
    setAge('');
    setGender('');
    setReligion('');
    setRoom('');
    setBedNumber('');
    setAdmissionDate('');
    setAttendingPhysician('');
    setChiefComplaint('');
    setAdmittingDiagnosis('');
    setFinalDiagnosis('');
    setDiet('');
    setTemperature('');
    setPulseRate('');
    setRespiratoryRate('');
    setBloodPressure('');
    setOxygenSaturation('');
    setSpecialEndorsements('');
  };

  return (
    <div className="p-4 pb-24 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Kardex</h1>
        <p className="text-gray-600">Patient Summary & Care Plan</p>
      </div>

      {/* Patient Demographics */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="w-5 h-5 text-blue-600" />
            Patient Demographics
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="lastName">
                Last Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="lastName"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Enter last name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="firstName">
                First Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="firstName"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Enter first name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="middleName">Middle Name</Label>
              <Input
                id="middleName"
                value={middleName}
                onChange={(e) => setMiddleName(e.target.value)}
                placeholder="Enter middle name"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label htmlFor="age">
                Age <span className="text-red-500">*</span>
              </Label>
              <Input
                id="age"
                type="number"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                placeholder="Age"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gender">
                Sex/Gender <span className="text-red-500">*</span>
              </Label>
              <Select value={gender} onValueChange={setGender}>
                <SelectTrigger id="gender">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Male">Male</SelectItem>
                  <SelectItem value="Female">Female</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="religion">Religion</Label>
              <Input
                id="religion"
                value={religion}
                onChange={(e) => setReligion(e.target.value)}
                placeholder="Religion"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="admissionDate">
                Admission Date <span className="text-red-500">*</span>
              </Label>
              <Input
                id="admissionDate"
                type="date"
                value={admissionDate}
                onChange={(e) => setAdmissionDate(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="room">
                Room <span className="text-red-500">*</span>
              </Label>
              <Input
                id="room"
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                placeholder="Room number"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bedNumber">Bed Number</Label>
              <Input
                id="bedNumber"
                value={bedNumber}
                onChange={(e) => setBedNumber(e.target.value)}
                placeholder="Bed number"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Medical Information */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-green-600" />
            Medical Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="attendingPhysician">Attending Physician</Label>
            <Input
              id="attendingPhysician"
              value={attendingPhysician}
              onChange={(e) => setAttendingPhysician(e.target.value)}
              placeholder="Dr. name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="chiefComplaint">Chief Complaint</Label>
            <Textarea
              id="chiefComplaint"
              value={chiefComplaint}
              onChange={(e) => setChiefComplaint(e.target.value)}
              placeholder="Enter chief complaint"
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="admittingDiagnosis">Admitting Diagnosis</Label>
            <Textarea
              id="admittingDiagnosis"
              value={admittingDiagnosis}
              onChange={(e) => setAdmittingDiagnosis(e.target.value)}
              placeholder="Enter admitting diagnosis"
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="finalDiagnosis">Final Diagnosis</Label>
            <Textarea
              id="finalDiagnosis"
              value={finalDiagnosis}
              onChange={(e) => setFinalDiagnosis(e.target.value)}
              placeholder="Enter final diagnosis"
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="diet">Diet</Label>
            <Input
              id="diet"
              value={diet}
              onChange={(e) => setDiet(e.target.value)}
              placeholder="e.g., NPO, Regular, Low-sodium"
            />
          </div>
        </CardContent>
      </Card>

      {/* Vital Signs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Heart className="w-5 h-5 text-red-600" />
            Latest Vital Signs
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="temperature">Temperature (°C)</Label>
              <Input
                id="temperature"
                type="number"
                step="0.1"
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
                placeholder="36.5"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pulseRate">Pulse Rate (bpm)</Label>
              <Input
                id="pulseRate"
                type="number"
                value={pulseRate}
                onChange={(e) => setPulseRate(e.target.value)}
                placeholder="80"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="respiratoryRate">Respiratory Rate</Label>
              <Input
                id="respiratoryRate"
                type="number"
                value={respiratoryRate}
                onChange={(e) => setRespiratoryRate(e.target.value)}
                placeholder="18"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bloodPressure">Blood Pressure</Label>
              <Input
                id="bloodPressure"
                value={bloodPressure}
                onChange={(e) => setBloodPressure(e.target.value)}
                placeholder="120/80"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="oxygenSaturation">O2 Saturation (%)</Label>
              <Input
                id="oxygenSaturation"
                type="number"
                value={oxygenSaturation}
                onChange={(e) => setOxygenSaturation(e.target.value)}
                placeholder="98"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Special Endorsements */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-orange-600" />
            Special Endorsements
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={specialEndorsements}
            onChange={(e) => setSpecialEndorsements(e.target.value)}
            placeholder="Enter any special instructions, precautions, or important notes for this patient..."
            rows={4}
          />
        </CardContent>
      </Card>

      {/* Action Buttons - Moved to Bottom */}
      <Card className="bg-blue-50 border-2 border-blue-200">
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              onClick={handleSaveClick}
              className="flex-1 bg-blue-600 hover:bg-blue-700 h-12"
            >
              <Save className="w-5 h-5 mr-2" />
              Save Kardex
            </Button>
            <Button
              onClick={handlePrint}
              variant="outline"
              className="flex-1 h-12 border-2"
            >
              <Printer className="w-5 h-5 mr-2" />
              Print Kardex
            </Button>
          </div>
          
          {/* History Button */}
          <div className="mt-3">
            <Button
              onClick={handleOpenHistoryList}
              variant="outline"
              className="w-full h-12 border-2 border-purple-600 text-purple-600 hover:bg-purple-50"
            >
              <History className="w-5 h-5 mr-2" />
              View Kardex History {kardexHistory.length > 0 && `(${kardexHistory.length})`}
            </Button>
          </div>

          <p className="text-xs text-gray-600 mt-3 text-center">
            <span className="text-red-500">*</span> Required fields must be filled before saving
          </p>
        </CardContent>
      </Card>

      {/* Recent Kardex History */}
      {kardexHistory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-purple-600" />
              Recent Kardex History
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {kardexHistory.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <div className="flex-1">
                    <h4 className="font-semibold text-gray-900">{entry.patientName}</h4>
                    <p className="text-sm text-gray-600">Room: {entry.room}</p>
                    <p className="text-xs text-gray-500 flex items-center gap-1 mt-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(entry.savedAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-600">Saved by</p>
                    <p className="font-semibold text-gray-900">{entry.savedBy}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Confirmation Dialog */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Save Kardex</DialogTitle>
            <DialogDescription>
              Are you sure you want to save this kardex? Please verify all information is correct before proceeding.
            </DialogDescription>
          </DialogHeader>
          <div className="bg-blue-50 p-4 rounded-lg border border-blue-200 space-y-2">
            <p className="text-sm"><strong>Patient:</strong> {firstName} {lastName}</p>
            <p className="text-sm"><strong>Age:</strong> {age} | <strong>Sex:</strong> {gender}</p>
            <p className="text-sm"><strong>Room:</strong> {room}</p>
            <p className="text-sm"><strong>Admission Date:</strong> {admissionDate}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirmDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmSave} className="bg-blue-600 hover:bg-blue-700">
              <Save className="w-4 h-4 mr-2" />
              Confirm & Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* History Dialog */}
      <Dialog open={showHistoryDialog} onOpenChange={setShowHistoryDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="w-5 h-5 text-purple-600" />
              Kardex History ({kardexHistory.length})
            </DialogTitle>
            <DialogDescription>
              {selectedHistoryEntry 
                ? 'Complete kardex record - Read-only view for audit and verification' 
                : 'View all saved kardex records'}
            </DialogDescription>
          </DialogHeader>
          
          {selectedHistoryEntry ? (
            /* Detailed View */
            <div className="space-y-4 px-1">
              {/* Metadata Banner */}
              <div className="bg-purple-50 border-2 border-purple-200 rounded-lg p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-purple-600" />
                    <div>
                      <p className="text-xs text-gray-600">Saved On</p>
                      <p className="font-semibold text-gray-900">{new Date(selectedHistoryEntry.savedAt).toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-purple-600" />
                    <div>
                      <p className="text-xs text-gray-600">Saved By</p>
                      <p className="font-semibold text-gray-900">{selectedHistoryEntry.savedBy}</p>
                    </div>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Patient Demographics Section */}
              <div>
                <h3 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <User className="w-5 h-5 text-blue-600" />
                  Patient Demographics
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Last Name</Label>
                    <Input value={selectedHistoryEntry.lastName} readOnly className="bg-gray-50" />
                  </div>
                  <div className="space-y-2">
                    <Label>First Name</Label>
                    <Input value={selectedHistoryEntry.firstName} readOnly className="bg-gray-50" />
                  </div>
                  <div className="space-y-2">
                    <Label>Middle Name</Label>
                    <Input value={selectedHistoryEntry.middleName} readOnly className="bg-gray-50" />
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                  <div className="space-y-2">
                    <Label>Age</Label>
                    <Input value={selectedHistoryEntry.age} readOnly className="bg-gray-50" />
                  </div>
                  <div className="space-y-2">
                    <Label>Sex/Gender</Label>
                    <Input value={selectedHistoryEntry.gender} readOnly className="bg-gray-50" />
                  </div>
                  <div className="space-y-2">
                    <Label>Religion</Label>
                    <Input value={selectedHistoryEntry.religion} readOnly className="bg-gray-50" />
                  </div>
                  <div className="space-y-2">
                    <Label>Admission Date</Label>
                    <Input value={selectedHistoryEntry.admissionDate} readOnly className="bg-gray-50" />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <div className="space-y-2">
                    <Label>Room</Label>
                    <Input value={selectedHistoryEntry.room} readOnly className="bg-gray-50" />
                  </div>
                  <div className="space-y-2">
                    <Label>Bed Number</Label>
                    <Input value={selectedHistoryEntry.bedNumber || 'N/A'} readOnly className="bg-gray-50" />
                  </div>
                </div>
              </div>

              <Separator />

              {/* Medical Information Section */}
              <div>
                <h3 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-green-600" />
                  Medical Information
                </h3>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Attending Physician</Label>
                    <Input value={selectedHistoryEntry.attendingPhysician || 'N/A'} readOnly className="bg-gray-50" />
                  </div>
                  <div className="space-y-2">
                    <Label>Chief Complaint</Label>
                    <Textarea value={selectedHistoryEntry.chiefComplaint || 'N/A'} readOnly className="bg-gray-50" rows={2} />
                  </div>
                  <div className="space-y-2">
                    <Label>Admitting Diagnosis</Label>
                    <Textarea value={selectedHistoryEntry.admittingDiagnosis || 'N/A'} readOnly className="bg-gray-50" rows={2} />
                  </div>
                  <div className="space-y-2">
                    <Label>Final Diagnosis</Label>
                    <Textarea value={selectedHistoryEntry.finalDiagnosis || 'N/A'} readOnly className="bg-gray-50" rows={2} />
                  </div>
                  <div className="space-y-2">
                    <Label>Diet</Label>
                    <Input value={selectedHistoryEntry.diet || 'N/A'} readOnly className="bg-gray-50" />
                  </div>
                </div>
              </div>

              <Separator />

              {/* Vital Signs Section */}
              <div>
                <h3 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <Heart className="w-5 h-5 text-red-600" />
                  Vital Signs
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Temperature (°C)</Label>
                    <Input value={selectedHistoryEntry.temperature || 'N/A'} readOnly className="bg-gray-50" />
                  </div>
                  <div className="space-y-2">
                    <Label>Pulse Rate (bpm)</Label>
                    <Input value={selectedHistoryEntry.pulseRate || 'N/A'} readOnly className="bg-gray-50" />
                  </div>
                  <div className="space-y-2">
                    <Label>Respiratory Rate</Label>
                    <Input value={selectedHistoryEntry.respiratoryRate || 'N/A'} readOnly className="bg-gray-50" />
                  </div>
                  <div className="space-y-2">
                    <Label>Blood Pressure</Label>
                    <Input value={selectedHistoryEntry.bloodPressure || 'N/A'} readOnly className="bg-gray-50" />
                  </div>
                  <div className="space-y-2">
                    <Label>O2 Saturation (%)</Label>
                    <Input value={selectedHistoryEntry.oxygenSaturation || 'N/A'} readOnly className="bg-gray-50" />
                  </div>
                </div>
              </div>

              <Separator />

              {/* Special Endorsements Section */}
              <div>
                <h3 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-orange-600" />
                  Special Endorsements
                </h3>
                <Textarea 
                  value={selectedHistoryEntry.specialEndorsements || 'No special endorsements recorded'} 
                  readOnly 
                  className="bg-gray-50" 
                  rows={4} 
                />
              </div>
            </div>
          ) : (
            /* List View */
            <div className="space-y-3">
              {kardexHistory.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between p-4 border-2 rounded-lg hover:shadow-md transition-all"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h4 className="font-bold text-gray-900 text-lg">{entry.patientName}</h4>
                      <Badge variant="secondary" className="text-xs">
                        {entry.age}y • {entry.gender}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                      <p className="text-gray-600">
                        <span className="font-semibold">Room:</span> {entry.room}
                        {entry.bedNumber && ` - Bed ${entry.bedNumber}`}
                      </p>
                      <p className="text-gray-600">
                        <span className="font-semibold">Physician:</span>{' '}
                        {entry.attendingPhysician || 'Not specified'}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 mt-2">
                      <p className="text-xs text-gray-500 flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {new Date(entry.savedAt).toLocaleString()}
                      </p>
                      <p className="text-xs text-gray-500">
                        <span className="font-semibold">By:</span> {entry.savedBy}
                      </p>
                    </div>
                  </div>
                  <div className="ml-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleViewHistory(entry)}
                      className="border-2 border-purple-600 text-purple-600 hover:bg-purple-50"
                    >
                      <Eye className="w-4 h-4 mr-2" />
                      View Details
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          
          <DialogFooter className="sticky bottom-0 bg-white pt-4 border-t">
            {selectedHistoryEntry && (
              <Button
                variant="outline"
                onClick={() => setSelectedHistoryEntry(null)}
                className="mr-auto"
              >
                ← Back to List
              </Button>
            )}
            <Button variant="outline" onClick={() => setShowHistoryDialog(false)}>
              <X className="w-4 h-4 mr-2" />
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}