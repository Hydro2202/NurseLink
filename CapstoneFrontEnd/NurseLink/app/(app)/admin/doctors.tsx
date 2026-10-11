import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, Modal } from 'react-native';
import { Search, Plus, X, Stethoscope } from 'lucide-react-native';
import {
  fetchDoctors,
  createDoctor,
  updateDoctor,
  fetchDepartments,
  ApiError,
} from '../../../services/api';
import type { Doctor, Department } from '../../../types/domain';
import { Input } from '../../../components/Input';
import { Badge } from '../../../components/Badge';
import { Button } from '../../../components/Button';
import { Select } from '../../../components/Select';
import { useToast } from '../../../contexts/ToastContext';
import { Colors, Shadows, Radius } from '../../../constants/colors';

interface DoctorForm {
  fullName: string;
  specialization: string;
  departmentId: string;
  licenseNumber: string;
  status: 'active' | 'inactive';
}

const EMPTY_FORM: DoctorForm = { fullName: '', specialization: '', departmentId: '', licenseNumber: '', status: 'active' };

export default function AdminDoctorsPage() {
  const toast = useToast();
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Doctor | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<DoctorForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [doctorData, deptData] = await Promise.all([fetchDoctors(), fetchDepartments()]);
        if (cancelled) return;
        setDoctors(doctorData);
        setDepartments(deptData);
      } catch (err) {
        if (cancelled) return;
        toast.error('Could not load doctors', {
          description: err instanceof ApiError ? err.message : 'Check your connection and try again.',
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return doctors;
    return doctors.filter(
      (d) => d.fullName.toLowerCase().includes(q) || d.specialization.toLowerCase().includes(q)
    );
  }, [doctors, search]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError('');
    setFormOpen(true);
  };

  const openEdit = (doctor: Doctor) => {
    setEditing(doctor);
    setForm({
      fullName: doctor.fullName,
      specialization: doctor.specialization,
      departmentId: String(doctor.departmentId),
      licenseNumber: doctor.licenseNumber || '',
      status: doctor.status,
    });
    setError('');
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!form.fullName.trim()) {
      setError('Full name is required.');
      return;
    }
    if (!form.departmentId) {
      setError('Department is required.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        fullName: form.fullName.trim(),
        specialization: form.specialization.trim(),
        departmentId: Number(form.departmentId),
        licenseNumber: form.licenseNumber.trim(),
        status: form.status,
      };
      if (editing) {
        const updated = await updateDoctor(editing.id, payload);
        setDoctors((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
        toast.success('Doctor updated');
      } else {
        const created = await createDoctor(payload);
        setDoctors((prev) => [created, ...prev]);
        toast.success('Doctor added');
      }
      setFormOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Doctors</Text>
            <Text style={styles.subtitle}>The hospital doctor directory used by Kardex, Tasks, and Patients.</Text>
          </View>
          <Button onPress={openCreate} size="sm">
            <View style={styles.btnInner}>
              <Plus size={16} color={Colors.white} />
              <Text style={styles.btnLabel}>Add</Text>
            </View>
          </Button>
        </View>

        <Input
          placeholder="Search by name or specialization"
          value={search}
          onChangeText={setSearch}
          leftIcon={<Search size={16} color={Colors.gray400} />}
        />

        {loading ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={Colors.blue600} />
        ) : filtered.length === 0 ? (
          <Text style={styles.empty}>No doctors match.</Text>
        ) : (
          <View style={styles.list}>
            {filtered.map((doctor) => (
              <Pressable key={doctor.id} onPress={() => openEdit(doctor)}>
                <View style={[styles.row, Shadows.sm]}>
                  <View style={styles.rowIconWrap}>
                    <Stethoscope size={18} color={Colors.blue600} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.rowTop}>
                      <Text style={styles.rowName}>Dr. {doctor.fullName}</Text>
                      <Badge variant={doctor.status === 'active' ? 'success' : 'secondary'}>
                        {doctor.status}
                      </Badge>
                    </View>
                    <Text style={styles.rowMeta}>
                      {doctor.specialization || 'No specialization set'} · {doctor.departmentName}
                    </Text>
                  </View>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      <Modal visible={formOpen} transparent animationType="fade" onRequestClose={() => setFormOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => !saving && setFormOpen(false)}>
          <Pressable style={[styles.dialog, Shadows.xl]} onPress={(e) => e.stopPropagation()}>
            <View style={styles.dialogHeader}>
              <Text style={styles.dialogTitle}>{editing ? 'Edit Doctor' : 'Add Doctor'}</Text>
              <Pressable onPress={() => setFormOpen(false)} hitSlop={8}>
                <X size={20} color={Colors.gray500} />
              </Pressable>
            </View>

            <View style={{ gap: 14, marginTop: 12 }}>
              <Input
                label="Full name *"
                placeholder="e.g. Maria Santos"
                value={form.fullName}
                onChangeText={(v) => setForm((f) => ({ ...f, fullName: v }))}
              />
              <Input
                label="Specialization"
                placeholder="e.g. Cardiology"
                value={form.specialization}
                onChangeText={(v) => setForm((f) => ({ ...f, specialization: v }))}
              />
              <Select
                label="Department *"
                value={form.departmentId}
                onValueChange={(v) => setForm((f) => ({ ...f, departmentId: v }))}
                options={departments.map((d) => ({ label: d.name, value: String(d.id) }))}
              />
              <Input
                label="License number"
                placeholder="Optional"
                value={form.licenseNumber}
                onChangeText={(v) => setForm((f) => ({ ...f, licenseNumber: v }))}
              />
              <Select
                label="Status"
                value={form.status}
                onValueChange={(v) => setForm((f) => ({ ...f, status: v as 'active' | 'inactive' }))}
                options={[
                  { label: 'Active', value: 'active' },
                  { label: 'Inactive', value: 'inactive' },
                ]}
              />
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
            </View>

            <View style={styles.footer}>
              <Button variant="outline" onPress={() => setFormOpen(false)} style={{ flex: 1 }} disabled={saving}>
                Cancel
              </Button>
              <Button onPress={handleSave} style={{ flex: 1 }} disabled={saving} loading={saving}>
                Save
              </Button>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 100, gap: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  title: { fontSize: 20, fontWeight: '900', color: Colors.gray900 },
  subtitle: { fontSize: 12.5, color: Colors.mutedForeground, marginTop: 2 },
  btnInner: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0, flexShrink: 1 },
  btnLabel: { color: Colors.white, fontWeight: '700', fontSize: 13, flexShrink: 1 },
  empty: { textAlign: 'center', color: Colors.mutedForeground, marginTop: 32, fontSize: 13 },
  list: { gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
  },
  rowIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.blue50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  rowName: { fontSize: 14.5, fontWeight: '800', color: Colors.gray900 },
  rowMeta: { fontSize: 12, color: Colors.mutedForeground, marginTop: 3 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  dialog: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: 20,
    width: '100%',
    maxWidth: 440,
  },
  dialogHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dialogTitle: { fontSize: 17, fontWeight: '800', color: Colors.gray900 },
  errorText: { fontSize: 12.5, color: Colors.red700 },
  footer: { flexDirection: 'row', gap: 12, marginTop: 20 },
});
