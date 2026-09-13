import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
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
} from 'lucide-react-native';
import { Colors, Radius } from '../constants/colors';
import { Card, CardContent, CardHeader } from './Card';
import { Badge } from './Badge';

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
    { label: 'Heart Rate', value: vitalSigns.heartRate, icon: <Heart size={16} color={Colors.red600} /> },
    { label: 'Blood Pressure', value: vitalSigns.bloodPressure, icon: <Activity size={16} color={Colors.blue500} /> },
    { label: 'Temperature', value: vitalSigns.temperature, icon: <Thermometer size={16} color={Colors.orange600} /> },
    { label: 'O₂ Saturation', value: vitalSigns.oxygenSaturation, icon: <Droplet size={16} color={Colors.info} /> },
    { label: 'Respiratory Rate', value: vitalSigns.respiratoryRate, icon: <Wind size={16} color={Colors.teal600} /> },
  ].filter((vital) => Boolean(vital.value && String(vital.value).trim()));

  const getRiskBadgeStyle = (risk: string) => {
    const riskLower = risk.toLowerCase();
    if (riskLower === 'high') {
      return { backgroundColor: Colors.red100, borderColor: Colors.red200, textColor: Colors.red700 };
    }
    if (riskLower === 'medium') {
      return { backgroundColor: Colors.yellow100, borderColor: Colors.yellow200, textColor: Colors.orange700 };
    }
    return { backgroundColor: Colors.green100, borderColor: Colors.green200, textColor: Colors.green700 };
  };

  const riskStyle = riskLevel ? getRiskBadgeStyle(riskLevel) : null;
  const hasClinicalContext =
    Boolean(diagnosis?.trim()) ||
    Boolean(riskLevel?.trim()) ||
    Boolean(allergies?.trim()) ||
    Boolean(medications?.trim()) ||
    Boolean(alerts?.trim());
  const hasPlan = Boolean(plan?.trim()) || Boolean(clinicalSummary?.trim());

  return (
    <View style={styles.container}>
      {/* Header */}
      <Card style={styles.headerCard}>
        <CardHeader>
          <View style={styles.headerTop}>
            <View style={{ flex: 1 }}>
              <View style={styles.headerTitleRow}>
                <FileText size={24} color={Colors.blue600} />
                <Text style={styles.headerTitle}>FDAR Nursing Note</Text>
              </View>
              <Text style={styles.headerSubtitle}>Focus · Data · Action · Response Documentation</Text>
            </View>
            {isDraft ? (
              <Badge
                variant="outline"
                style={{ backgroundColor: Colors.yellow100, borderColor: Colors.yellow200 }}
                textStyle={{ color: Colors.orange700 }}
              >
                Draft
              </Badge>
            ) : null}
          </View>
        </CardHeader>
      </Card>

      {/* Patient Information */}
      <Card style={{ ...styles.sectionCard, borderLeftColor: Colors.blue500 }}>
        <CardHeader>
          <View style={styles.sectionTitleRow}>
            <User size={20} color={Colors.blue600} />
            <Text style={styles.sectionTitle}>Patient Information</Text>
          </View>
        </CardHeader>
        <CardContent>
          <View style={styles.infoGrid}>
            <View style={styles.infoCell}>
              <Text style={styles.infoLabel}>Patient Name</Text>
              <Text style={styles.infoValue}>{patientName}</Text>
            </View>
            <View style={styles.infoCell}>
              <Text style={styles.infoLabel}>Patient ID</Text>
              <Text style={styles.infoValue}>{patientId}</Text>
            </View>
            <View style={styles.infoCell}>
              <View style={styles.labelWithIcon}>
                <MapPin size={12} color={Colors.gray600} />
                <Text style={styles.infoLabel}>Room</Text>
              </View>
              <Text style={styles.infoValue}>{room}</Text>
            </View>
            <View style={styles.infoCell}>
              <View style={styles.labelWithIcon}>
                <Calendar size={12} color={Colors.gray600} />
                <Text style={styles.infoLabel}>Date & Time</Text>
              </View>
              <Text style={styles.infoValueSm}>{date}</Text>
              <Text style={styles.infoSecondary}>{time}</Text>
            </View>
          </View>

          <View style={styles.separator} />

          <View style={styles.staffRow}>
            <View style={[styles.staffBox, styles.physicianBox]}>
              <View style={styles.labelWithIcon}>
                <Stethoscope size={12} color={Colors.blue700} />
                <Text style={[styles.infoLabel, { color: Colors.blue700 }]}>Attending Physician</Text>
              </View>
              <Text style={[styles.infoValueSm, { color: Colors.blue900 }]}>{attendingPhysician}</Text>
            </View>
            <View style={[styles.staffBox, styles.nurseBox]}>
              <View style={styles.labelWithIcon}>
                <User size={12} color={Colors.purple700} />
                <Text style={[styles.infoLabel, { color: Colors.purple700 }]}>Documenting Nurse</Text>
                <View style={styles.autoBadge}>
                  <Text style={styles.autoBadgeText}>Auto-assigned</Text>
                </View>
              </View>
              <Text style={[styles.infoValueSm, { color: Colors.purple700 }]}>{nurseName}</Text>
            </View>
          </View>
        </CardContent>
      </Card>

      {/* Vital Signs — only values that were actually recorded */}
      {vitalSignsData.length > 0 ? (
        <Card style={{ ...styles.sectionCard, borderLeftColor: Colors.red600 }}>
          <CardHeader>
            <View style={styles.sectionTitleRow}>
              <Activity size={20} color={Colors.red600} />
              <Text style={styles.sectionTitle}>Vital Signs</Text>
            </View>
          </CardHeader>
          <CardContent>
            <View style={styles.vitalsGrid}>
              {vitalSignsData.map((vital, index) => (
                <View key={index} style={styles.vitalCard}>
                  <View style={styles.vitalHeader}>
                    {vital.icon}
                    <Text style={styles.vitalLabel}>{vital.label}</Text>
                  </View>
                  <Text style={styles.vitalValue}>{vital.value}</Text>
                </View>
              ))}
            </View>
          </CardContent>
        </Card>
      ) : null}

      {/* Clinical Context — patient-record metadata, kept separate from the nurse-authored FDAR sections below */}
      {hasClinicalContext ? (
        <Card style={{ ...styles.sectionCard, borderLeftColor: Colors.gray400 }}>
          <CardHeader>
            <View style={styles.sectionTitleRow}>
              <ClipboardList size={20} color={Colors.gray600} />
              <Text style={styles.sectionTitle}>Clinical Context</Text>
            </View>
          </CardHeader>
          <CardContent style={{ gap: 12 }}>
            {diagnosis?.trim() || riskLevel?.trim() ? (
              <View style={styles.diagRow}>
                {diagnosis?.trim() ? (
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Current Diagnosis</Text>
                    <Text style={styles.fieldValue}>{diagnosis}</Text>
                  </View>
                ) : null}
                {riskLevel?.trim() && riskStyle ? (
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Risk Level</Text>
                    <Badge
                      variant="outline"
                      style={{ backgroundColor: riskStyle.backgroundColor, borderColor: riskStyle.borderColor }}
                      textStyle={{ color: riskStyle.textColor }}
                    >
                      {riskLevel}
                    </Badge>
                  </View>
                ) : null}
              </View>
            ) : null}
            {allergies?.trim() || medications?.trim() || alerts?.trim() ? (
              <View style={{ gap: 12 }}>
                {allergies?.trim() ? (
                  <DetailRow icon={<AlertCircle size={16} color={Colors.red600} />} label="Allergies" value={allergies} />
                ) : null}
                {medications?.trim() ? (
                  <DetailRow icon={<Pill size={16} color={Colors.blue500} />} label="Active Medications" value={medications} />
                ) : null}
                {alerts?.trim() ? (
                  <DetailRow icon={<AlertCircle size={16} color={Colors.orange600} />} label="Alerts" value={alerts} />
                ) : null}
              </View>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Focus */}
      {focus?.trim() ? (
        <Card style={{ ...styles.sectionCard, borderLeftColor: Colors.purple600 }}>
          <CardHeader>
            <View style={styles.sectionTitleRow}>
              <Target size={20} color={Colors.purple600} />
              <Text style={styles.sectionTitle}>Focus</Text>
            </View>
          </CardHeader>
          <CardContent>
            <Text style={styles.bodyText}>{focus}</Text>
          </CardContent>
        </Card>
      ) : null}

      {/* Data */}
      {data?.trim() ? (
        <Card style={{ ...styles.sectionCard, borderLeftColor: Colors.blue600 }}>
          <CardHeader>
            <View style={styles.sectionTitleRow}>
              <ClipboardList size={20} color={Colors.blue600} />
              <Text style={styles.sectionTitle}>Data</Text>
            </View>
          </CardHeader>
          <CardContent>
            <View style={styles.assessmentBox}>
              <Text style={styles.assessmentText}>{data}</Text>
            </View>
          </CardContent>
        </Card>
      ) : null}

      {/* Action */}
      {action?.trim() ? (
        <Card style={{ ...styles.sectionCard, borderLeftColor: Colors.green600 }}>
          <CardHeader>
            <View style={styles.sectionTitleRow}>
              <Wrench size={20} color={Colors.green600} />
              <Text style={styles.sectionTitle}>Action</Text>
            </View>
          </CardHeader>
          <CardContent>
            <View style={{ gap: 8 }}>
              {action
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean)
                .map((line, index) => (
                  <View key={index} style={styles.listItem}>
                    <View style={styles.bullet} />
                    <Text style={styles.listText}>{line.replace(/^-\s*/, '')}</Text>
                  </View>
                ))}
            </View>
          </CardContent>
        </Card>
      ) : null}

      {/* Response */}
      {response?.trim() || hasPlan ? (
        <Card style={{ ...styles.sectionCard, borderLeftColor: Colors.teal600 }}>
          <CardHeader>
            <View style={styles.sectionTitleRow}>
              <TrendingUp size={20} color={Colors.teal600} />
              <Text style={styles.sectionTitle}>Response</Text>
            </View>
          </CardHeader>
          <CardContent style={{ gap: 16 }}>
            {response?.trim() ? <Text style={styles.bodyText}>{response}</Text> : null}
            {hasPlan ? (
              <>
                {response?.trim() ? <View style={styles.separator} /> : null}
                {clinicalSummary?.trim() ? (
                  <View>
                    <Text style={styles.fieldLabel}>Clinical Summary</Text>
                    <Text style={styles.fieldValue}>{clinicalSummary}</Text>
                  </View>
                ) : null}
                {plan?.trim() ? (
                  <View>
                    <Text style={styles.fieldLabel}>Plan / Follow-up</Text>
                    <Text style={styles.fieldValue}>{plan}</Text>
                  </View>
                ) : null}
              </>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Footer - Electronic Signature */}
      <Card style={styles.footerCard}>
        <CardContent style={styles.footerContent}>
          <View style={styles.footerLeft}>
            <Clock size={16} color={Colors.gray500} />
            <Text style={styles.footerMuted}>Electronically signed by:</Text>
            <Text style={styles.footerName}>{nurseName}</Text>
          </View>
          <Text style={styles.footerTimestamp}>Timestamp: {timestamp}</Text>
        </CardContent>
      </Card>
    </View>
  );
}

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <View style={{ marginTop: 2 }}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={styles.fieldValue}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 16 },
  headerCard: {
    borderWidth: 2,
    borderColor: Colors.blue200,
    backgroundColor: Colors.blue50,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 4,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.gray900,
    flexShrink: 1,
  },
  headerSubtitle: {
    fontSize: 13,
    color: Colors.gray600,
  },
  sectionCard: {
    borderLeftWidth: 4,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: Colors.foreground,
  },
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  infoCell: {
    width: '47%',
    gap: 4,
  },
  infoLabel: {
    fontSize: 11,
    color: Colors.gray600,
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.foreground,
  },
  infoValueSm: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.foreground,
  },
  infoSecondary: {
    fontSize: 13,
    color: Colors.gray700,
  },
  labelWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
  },
  separator: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 16,
  },
  staffRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  staffBox: {
    flex: 1,
    minWidth: 140,
    padding: 12,
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: 4,
  },
  physicianBox: {
    backgroundColor: Colors.blue50,
    borderColor: Colors.blue200,
  },
  nurseBox: {
    backgroundColor: Colors.purple50,
    borderColor: Colors.purple100,
  },
  autoBadge: {
    backgroundColor: Colors.purple100,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  autoBadgeText: {
    fontSize: 9,
    color: Colors.purple700,
    fontWeight: '600',
  },
  vitalsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  vitalCard: {
    width: '47%',
    backgroundColor: Colors.gray50,
    borderWidth: 2,
    borderColor: Colors.gray200,
    borderRadius: Radius.md,
    padding: 12,
  },
  vitalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  vitalLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: Colors.gray600,
    flexShrink: 1,
  },
  vitalValue: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.gray900,
  },
  assessmentBox: {
    backgroundColor: Colors.gray50,
    padding: 14,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.gray200,
  },
  assessmentText: {
    fontSize: 13,
    lineHeight: 20,
    color: Colors.gray700,
  },
  diagRow: {
    flexDirection: 'row',
    gap: 16,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.gray600,
    marginBottom: 6,
  },
  fieldValue: {
    fontSize: 13,
    color: Colors.gray900,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  bullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.green600,
    marginTop: 6,
  },
  listText: {
    flex: 1,
    fontSize: 13,
    color: Colors.gray700,
    lineHeight: 18,
  },
  bodyText: {
    fontSize: 13,
    lineHeight: 20,
    color: Colors.gray700,
  },
  footerCard: {
    borderTopWidth: 4,
    borderTopColor: Colors.gray200,
    backgroundColor: Colors.gray50,
  },
  footerContent: {
    paddingVertical: 14,
    gap: 8,
  },
  footerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  footerMuted: {
    fontSize: 13,
    color: Colors.gray600,
  },
  footerName: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.gray900,
  },
  footerTimestamp: {
    fontSize: 11,
    color: Colors.gray500,
  },
});
