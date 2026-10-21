import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, ScrollView } from 'react-native';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react-native';
import { Card, CardContent } from '../Card';
import { Alert, AlertDescription, AlertTitle } from '../Alert';
import { Button } from '../Button';
import { Badge } from '../Badge';
import { Colors, Radius, Shadows } from '../../constants/colors';
import type { Patient, Task } from '../../types/domain';

export interface SafetyAlert {
  key: string;
  variant: 'destructive' | 'warning';
  title: string;
  description: string;
  nurseName?: string;
  patient?: Patient;
  task?: Task;
}

interface SafetyAlertsSectionProps {
  patients: Patient[];
  tasks: Task[];
  onRespond: (alert: SafetyAlert) => void;
  onNotifyNurse: (alert: SafetyAlert) => void;
}

/**
 * "Patient Safety Alerts" at the top of the head nurse dashboard. The
 * dashboard shows only the title and the live count; "View All Alerts"
 * opens every active alert (with Respond Now / Notify Nurse) in a pop-up
 * whose list scrolls under a fixed header, so the count and the list are
 * always built from the same array.
 */
export function SafetyAlertsSection({ patients, tasks, onRespond, onNotifyNurse }: SafetyAlertsSectionProps) {
  const [open, setOpen] = useState(false);
  const alerts = useMemo<SafetyAlert[]>(() => {
    const list: SafetyAlert[] = [];

    patients
      .filter((p) => (p.riskLevel === 'high' || p.riskLevel === 'critical') && p.status !== 'discharged')
      // Critical patients surface before merely high-risk ones.
      .sort((a, b) => (a.riskLevel === b.riskLevel ? 0 : a.riskLevel === 'critical' ? -1 : 1))
      .forEach((p) => {
        const vs = p.vitalSigns;
        const label = p.riskLevel === 'critical' ? 'Critical' : 'High Risk';
        list.push({
          key: `patient-${p.id}`,
          variant: 'destructive',
          title: `${label} - ${p.name} (${p.room})`,
          description: vs
            ? `Vital signs require attention. BP ${vs.bloodPressure}, HR ${vs.heartRate}, Temp ${vs.temperature}°C.`
            : `${p.diagnosis || 'High-risk patient'} — immediate assessment required.`,
          nurseName: p.assignedNurseName || undefined,
          patient: p,
        });
      });

    tasks
      .filter((t) => t.status === 'overdue')
      .forEach((t) => {
        list.push({
          key: `task-${t.id}`,
          variant: 'warning',
          title: `Delayed Task - ${t.patientName || 'Patient'}`,
          description: `${t.title}${t.assignedTo ? `. Assigned nurse: ${t.assignedTo}` : ''}`,
          nurseName: t.assignedTo || undefined,
          task: t,
        });
      });

    // Destructive (patient safety) alerts always lead, even though both
    // loops above already group by kind — this is the actual ordering
    // guarantee the spec asks for, not an incidental side effect of push order.
    return list.sort((a, b) => (a.variant === b.variant ? 0 : a.variant === 'destructive' ? -1 : 1));
  }, [patients, tasks]);

  if (alerts.length === 0) {
    return (
      <View style={styles.emptyBar}>
        <CheckCircle2 size={15} color={Colors.green600} />
        <Text style={styles.emptyText}>No active safety alerts</Text>
      </View>
    );
  }

  const close = () => setOpen(false);

  return (
    <>
      <Card>
        <CardContent style={styles.summary}>
          <View style={styles.titleRow}>
            <AlertTriangle size={20} color={Colors.destructive} />
            <Text style={styles.summaryTitle}>Patient Safety Alerts</Text>
            <Badge variant="destructive">{alerts.length}</Badge>
          </View>
          <Button size="sm" variant="outline" onPress={() => setOpen(true)}>
            View All Alerts
          </Button>
        </CardContent>
      </Card>

      {/* onRequestClose covers Escape on web and the back button on Android. */}
      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={styles.backdrop} onPress={close}>
          <Pressable style={[styles.dialog, Shadows.xl]} onPress={(e) => e.stopPropagation()}>
            <View style={styles.dialogHeader}>
              <View style={styles.titleRow}>
                <AlertTriangle size={20} color={Colors.destructive} />
                <Text style={styles.dialogTitle}>Patient Safety Alerts</Text>
                <Badge variant="destructive">{alerts.length}</Badge>
              </View>
              <Pressable onPress={close} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close alerts">
                <X size={20} color={Colors.mutedForeground} />
              </Pressable>
            </View>
            <Text style={styles.dialogSubtitle}>High-priority alerts requiring immediate attention</Text>
            <ScrollView style={styles.scroll} contentContainerStyle={styles.list}>
              {alerts.map((alert) => (
                <Alert key={alert.key} variant={alert.variant} style={styles.alert}>
                  <AlertTitle>{alert.title}</AlertTitle>
                  <AlertDescription>{alert.description}</AlertDescription>
                  {alert.patient && alert.nurseName ? <Text style={styles.nurse}>Assigned nurse: {alert.nurseName}</Text> : null}
                  <View style={styles.actions}>
                    {alert.variant === 'destructive' ? (
                      // Respond Now opens the assign form, so get this pop-up out of its way.
                      <Button size="sm" variant="destructive" onPress={() => { close(); onRespond(alert); }}>
                        Respond Now
                      </Button>
                    ) : null}
                    {alert.nurseName ? (
                      <Button size="sm" variant="outline" onPress={() => onNotifyNurse(alert)}>
                        Notify Nurse
                      </Button>
                    ) : null}
                  </View>
                </Alert>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  summary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 16,
  },
  summaryTitle: { fontSize: 16, fontWeight: '700', color: Colors.foreground },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  dialog: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: 20,
    width: '100%',
    maxWidth: 720,
    maxHeight: '85%',
  },
  dialogHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  dialogTitle: { fontSize: 18, fontWeight: '700', color: Colors.foreground },
  dialogSubtitle: { fontSize: 13, color: Colors.mutedForeground, marginTop: 2, marginBottom: 12 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  list: { gap: 14, paddingBottom: 4 },
  nurse: { fontSize: 12, color: Colors.mutedForeground, marginTop: 6 },
  alert: { padding: 16 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  emptyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: Radius.md,
    backgroundColor: Colors.green50,
    borderWidth: 1,
    borderColor: Colors.green200,
  },
  emptyText: { fontSize: 13, fontWeight: '600', color: Colors.green700 },
});
