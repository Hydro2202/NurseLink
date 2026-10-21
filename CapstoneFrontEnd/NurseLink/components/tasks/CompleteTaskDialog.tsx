import React, { useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { CheckCircle, X } from 'lucide-react-native';
import { completeTask, ApiError } from '../../services/api';
import { Colors, Radius, Shadows } from '../../constants/colors';
import type { Task } from '../../types/domain';
import { TaskTypeBadge } from './taskLabels';

const REMARKS_PROMPT = "Document the care or procedure performed, relevant findings, and the patient's response.";

interface Props {
  task: Task | null;
  onClose: () => void;
  /** Called only after the server confirmed the completion. */
  onCompleted: (updated: Task) => void;
}

/**
 * The Done step: the nurse writes their completion remarks and the task is
 * marked Completed only once the server has saved them. On failure the
 * remarks stay in the box with the error, ready to retry; the Save button is
 * disabled while a request is in flight so a double tap can't send two.
 */
export function CompleteTaskDialog({ task, onClose, onCompleted }: Props) {
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Start fresh for each task (render-time reset, no effect needed).
  const [forTask, setForTask] = useState<string | null>(task?.id ?? null);
  if ((task?.id ?? null) !== forTask) {
    setForTask(task?.id ?? null);
    setRemarks('');
    setError(null);
    setSaving(false);
  }

  if (!task) return null;

  const trimmed = remarks.trim();
  const close = () => {
    if (!saving) onClose();
  };

  const submit = async () => {
    if (saving) return;
    if (trimmed.length < 3) {
      setError('Remarks are required before this task can be completed.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await completeTask(task.id, trimmed);
      onCompleted(updated);
    } catch (err) {
      if (err instanceof ApiError) {
        const data = err.data as { remarks?: string[]; unfinishedChecklistItems?: string[] } | undefined;
        const items = data?.unfinishedChecklistItems;
        setError(
          items?.length
            ? `${err.message} Still open: ${items.join(', ')}.`
            : data?.remarks?.[0] || err.message
        );
      } else {
        setError('Could not save. Check your connection and try again.');
      }
      setSaving(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={[styles.dialog, Shadows.xl]} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <View style={styles.iconWrap}>
              <CheckCircle size={20} color={Colors.green600} />
            </View>
            <View style={styles.flex1}>
              <Text style={styles.title}>Complete task</Text>
              <Text style={styles.subtitle} numberOfLines={2}>
                {task.title}
              </Text>
            </View>
            <Pressable onPress={close} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
              <X size={20} color={Colors.mutedForeground} />
            </Pressable>
          </View>

          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
            <View style={styles.patientBox}>
              <Text style={styles.patientName}>
                {task.patientName || 'No patient'}
                {task.patientId ? ` · ${task.patientId}` : ''}
              </Text>
              <View style={styles.patientMeta}>
                {task.patientRoom ? <Text style={styles.metaText}>Room {task.patientRoom}</Text> : null}
                <TaskTypeBadge type={task.taskType} />
              </View>
            </View>

            <Text style={styles.label}>Completion remarks *</Text>
            <TextInput
              value={remarks}
              onChangeText={(text) => {
                setRemarks(text);
                if (error) setError(null);
              }}
              placeholder={REMARKS_PROMPT}
              placeholderTextColor={Colors.gray400}
              multiline
              editable={!saving}
              style={[styles.textarea, error ? styles.textareaError : null]}
              accessibilityLabel="Completion remarks"
            />
            <Text style={styles.hint}>{REMARKS_PROMPT}</Text>
            {error ? (
              <Text style={styles.error} accessibilityRole="alert">
                {error}
              </Text>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable onPress={close} disabled={saving} style={[styles.btn, styles.btnGhost]}>
              <Text style={styles.btnGhostText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={submit}
              disabled={saving}
              style={[styles.btn, styles.btnPrimary, (saving || trimmed.length < 3) && styles.btnDisabled]}
              accessibilityRole="button"
              accessibilityLabel="Save and mark as done"
            >
              {saving ? <ActivityIndicator size="small" color={Colors.white} /> : <CheckCircle size={16} color={Colors.white} />}
              <Text style={styles.btnPrimaryText}>{saving ? 'Saving…' : 'Mark as Done'}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  dialog: { backgroundColor: Colors.white, borderRadius: Radius.xl, padding: 20, width: '100%', maxWidth: 560, maxHeight: '88%' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: Colors.green50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex1: { flex: 1, minWidth: 0 },
  title: { fontSize: 18, fontWeight: '700', color: Colors.foreground },
  subtitle: { fontSize: 13, color: Colors.mutedForeground, marginTop: 2 },
  body: { flexGrow: 0, marginTop: 16 },
  patientBox: {
    backgroundColor: Colors.blue50,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.blue100,
    padding: 12,
    gap: 6,
    marginBottom: 14,
  },
  patientName: { fontSize: 14, fontWeight: '700', color: Colors.gray900 },
  patientMeta: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  metaText: { fontSize: 12, color: Colors.gray600 },
  label: { fontSize: 13, fontWeight: '600', color: Colors.gray800, marginBottom: 6 },
  textarea: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: Colors.foreground,
    minHeight: 120,
    textAlignVertical: 'top',
    backgroundColor: Colors.white,
  },
  textareaError: { borderColor: Colors.red600 },
  hint: { fontSize: 12, color: Colors.mutedForeground, marginTop: 6 },
  error: { fontSize: 13, color: Colors.red600, marginTop: 8, fontWeight: '600' },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, height: 40, borderRadius: Radius.md },
  btnGhost: { borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white },
  btnGhostText: { fontSize: 14, fontWeight: '600', color: Colors.gray700 },
  btnPrimary: { backgroundColor: Colors.green600 },
  btnPrimaryText: { fontSize: 14, fontWeight: '700', color: Colors.white },
  btnDisabled: { opacity: 0.6 },
});
