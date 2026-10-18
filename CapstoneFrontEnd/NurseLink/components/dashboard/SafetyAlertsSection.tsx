import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { AlertTriangle, CheckCircle2 } from 'lucide-react-native';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../Card';
import { Alert, AlertDescription, AlertTitle } from '../Alert';
import { Button } from '../Button';
import { Badge } from '../Badge';
import { Colors, Radius } from '../../constants/colors';
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
 * "Patient Safety Alerts" — moved to the top of the head nurse dashboard
 * (see dashboard.tsx) so an urgent alert is the first thing seen, not
 * something scrolled past everything else to find.
 */
export function SafetyAlertsSection({ patients, tasks, onRespond, onNotifyNurse }: SafetyAlertsSectionProps) {
  const alerts = useMemo<SafetyAlert[]>(() => {
    const list: SafetyAlert[] = [];

    patients
      .filter((p) => p.riskLevel === 'high' || p.riskLevel === 'critical')
      // Critical patients surface before merely high-risk ones.
      .sort((a, b) => (a.riskLevel === b.riskLevel ? 0 : a.riskLevel === 'critical' ? -1 : 1))
      .slice(0, 5)
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
      .slice(0, 5)
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

  return (
    <Card>
      <CardHeader>
        <View style={styles.titleRow}>
          <AlertTriangle size={20} color={Colors.destructive} />
          <CardTitle>Patient Safety Alerts</CardTitle>
          <Badge variant="destructive">{alerts.length}</Badge>
        </View>
        <CardDescription>High-priority alerts requiring immediate attention</CardDescription>
      </CardHeader>
      <CardContent style={styles.list}>
        {alerts.map((alert) => (
          <Alert key={alert.key} variant={alert.variant} style={styles.alert}>
            <AlertTitle>{alert.title}</AlertTitle>
            <AlertDescription>{alert.description}</AlertDescription>
            <View style={styles.actions}>
              {alert.variant === 'destructive' ? (
                <Button size="sm" variant="destructive" onPress={() => onRespond(alert)}>
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
      </CardContent>
    </Card>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  list: { gap: 14, paddingTop: 4 },
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
