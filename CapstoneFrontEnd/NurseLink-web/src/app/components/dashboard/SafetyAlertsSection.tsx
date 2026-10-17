import React, { useMemo } from 'react';
import { AlertTriangle, AlertCircle, Clock, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
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
 * (see DashboardPage.tsx) so an urgent alert is the first thing seen, not
 * something scrolled past everything else to find.
 */
export function SafetyAlertsSection({ patients, tasks, onRespond, onNotifyNurse }: SafetyAlertsSectionProps) {
  const alerts = useMemo<SafetyAlert[]>(() => {
    const list: SafetyAlert[] = [];

    patients
      .filter((p) => p.riskLevel === 'high' || p.riskLevel === 'critical')
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

    // Destructive (patient safety) alerts always lead.
    return list.sort((a, b) => (a.variant === b.variant ? 0 : a.variant === 'destructive' ? -1 : 1));
  }, [patients, tasks]);

  if (alerts.length === 0) {
    return (
      <div className="flex items-center gap-2 py-2.5 px-3.5 rounded-lg bg-green-50 border border-green-200">
        <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
        <span className="text-sm font-semibold text-green-700">No active safety alerts</span>
      </div>
    );
  }

  return (
    <Card className="border border-border shadow-sm">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-destructive" />
          Patient Safety Alerts
          <Badge variant="destructive">{alerts.length}</Badge>
        </CardTitle>
        <CardDescription>High-priority alerts requiring immediate attention</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {alerts.map((alert) => (
          <Alert
            key={alert.key}
            variant={alert.variant === 'destructive' ? 'destructive' : 'default'}
            className={`p-4 ${alert.variant === 'destructive' ? 'border-l-4' : 'border-l-4 border-warning bg-warning/5'}`}
          >
            {alert.variant === 'destructive' ? (
              <AlertCircle className="h-5 w-5" />
            ) : (
              <Clock className="h-5 w-5 text-warning" />
            )}
            <AlertTitle className="font-semibold">{alert.title}</AlertTitle>
            <AlertDescription className="mt-2">{alert.description}</AlertDescription>
            <div className="flex flex-wrap gap-2.5 mt-3">
              <Button
                size="sm"
                variant={alert.variant === 'destructive' ? 'destructive' : 'default'}
                onClick={() => onRespond(alert)}
              >
                {alert.variant === 'destructive' ? 'Respond Now' : 'View Task'}
              </Button>
              {alert.nurseName ? (
                <Button size="sm" variant="outline" onClick={() => onNotifyNurse(alert)}>
                  Notify Nurse
                </Button>
              ) : null}
            </div>
          </Alert>
        ))}
      </CardContent>
    </Card>
  );
}
