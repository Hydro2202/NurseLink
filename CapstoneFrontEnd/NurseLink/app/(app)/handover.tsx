import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Image,
  ActivityIndicator,
} from 'react-native';
import {
  FileText,
  CheckCircle,
  Clock,
  Shield,
  AlertCircle,
  Plus,
  Search,
  Trash2,
  Image as ImageIcon,
} from 'lucide-react-native';
import {
  fetchHandovers,
  createHandover,
  acknowledgeHandover,
  deleteHandover,
  ApiError,
} from '../../services/api';
import type { HandoverNote } from '../../types/domain';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/Card';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Select } from '../../components/Select';
import { Tabs } from '../../components/Tabs';
import { Alert, AlertDescription } from '../../components/Alert';
import { HandoverModal } from '../../components/HandoverModal';
import { DeleteConfirmDialog } from '../../components/ConfirmDialog';
import { useAuth } from '../../contexts/AuthContext';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useToast } from '../../contexts/ToastContext';
import { useNotifications } from '../../contexts/NotificationsContext';
import { useLive, useLiveRefresh } from '../../contexts/LiveContext';
import { Colors, Shadows, Radius } from '../../constants/colors';

type SortBy = 'newest' | 'oldest' | 'patient' | 'status';

type HandoverWithMeta = HandoverNote & {
  createdAt?: string;
};

const SORT_OPTIONS = [
  { label: 'Newest', value: 'newest' },
  { label: 'Oldest', value: 'oldest' },
  { label: 'Patient Name', value: 'patient' },
  { label: 'Status', value: 'status' },
];

function isAcknowledged(status: string) {
  return status === 'acknowledged' || status === 'received' || status === 'completed';
}

function statusBadgeVariant(
  status: string
): 'default' | 'secondary' | 'outline' | 'success' | 'warning' {
  if (status === 'acknowledged' || status === 'received' || status === 'completed') return 'success';
  if (status === 'submitted' || status === 'pending') return 'secondary';
  return 'outline';
}

export default function HandoverPage() {
  const { user } = useAuth();
  const router = useRouter();
  // Set when a notification or popup sends the nurse straight to one handover.
  const params = useLocalSearchParams<{ highlightId?: string }>();
  const highlightId = typeof params.highlightId === 'string' ? params.highlightId : null;
  const toast = useToast();
  const { refresh: refreshNotifications } = useNotifications();
  const { poll: pollLive } = useLive();
  const [handovers, setHandovers] = useState<HandoverWithMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('incoming');
  const [handoverModalOpen, setHandoverModalOpen] = useState(false);
  const [acknowledgeLoading, setAcknowledgeLoading] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('newest');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [handoverToDelete, setHandoverToDelete] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const currentUserName = user?.name || 'You';

  const loadHandovers = useCallback(async (options?: { quiet?: boolean }) => {
    try {
      const data = await fetchHandovers();
      setHandovers(data.map((h) => ({ ...h, createdAt: h.date })));
    } catch (error) {
      // A background refresh that fails should not interrupt the nurse; the
      // next live tick will try again.
      if (!options?.quiet) {
        toast.error('Failed to load referrals', {
          description: error instanceof ApiError ? error.message : 'Please try again.',
        });
      }
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadHandovers();
  }, [loadHandovers]);

  // Handovers are written on other nurses' devices, and acknowledged there too,
  // so this list follows the shared live revision instead of only what this
  // screen has done itself.
  useLiveRefresh('handovers', () => {
    void loadHandovers({ quiet: true });
  });

  const handleCreateHandover = () => {
    setHandoverModalOpen(true);
  };

  const handleSaveHandover = async (handoverData: Partial<HandoverNote>) => {
    try {
      const newHandover = await createHandover({
        patientId: handoverData.patientId || '',
        patientName: handoverData.patientName || '',
        shift: handoverData.shift || 'morning',
        date: new Date().toISOString().slice(0, 10),
        nurseFrom: currentUserName,
        nurseTo: handoverData.nurseTo || '',
        // The account behind nurseTo. Several nurses on this ward share a
        // display name, so without this the server cannot tell which inbox to
        // notify and deliberately notifies nobody.
        nurseToId: handoverData.nurseToId || '',
        sbar: handoverData.sbar || {
          situation: '',
          background: '',
          assessment: '',
          recommendation: '',
        },
        unfinishedTasks: handoverData.unfinishedTasks || [],
        photos: handoverData.photos || [],
        status: 'pending',
      });
      setHandovers((prev) => [{ ...newHandover, createdAt: newHandover.date }, ...prev]);
      // Writing a handover also puts its work on this nurse's task list and
      // notifies the receiving nurse — let the rest of the app catch up now.
      void pollLive();
      toast.success('Referral submitted successfully!', {
        description: `Referral note for ${newHandover.patientName} has been sent to ${newHandover.nurseTo}.`,
      });
    } catch (error) {
      toast.error('Failed to submit referral', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
      throw error;
    }
  };

  const handleAcknowledgeHandover = async (handoverId: string) => {
    setAcknowledgeLoading(handoverId);
    try {
      const updated = await acknowledgeHandover(handoverId);
      setHandovers((prev) =>
        prev.map((h) => (h.id === handoverId ? { ...updated, createdAt: updated.date } : h))
      );
      // Say what actually happened: acknowledging moves the outgoing nurse's
      // unfinished work onto this nurse's list, and they should not have to
      // discover that by wandering over to the Tasks screen.
      const moved = updated.adoptedTasks?.length ?? 0;
      toast.success('Referral acknowledged!', {
        description:
          moved > 0
            ? `${moved} unfinished task${moved > 1 ? 's' : ''} added to your tasks for ${updated.patientName}.`
            : `You've acknowledged the referral for ${updated.patientName}.`,
      });
      // We just changed state other nurses are watching. Poll immediately so
      // this device is consistent at once, rather than briefly showing a list
      // that disagrees with the action just taken.
      void pollLive();
      void refreshNotifications();

      // Take the nurse to the work they just accepted. Acknowledging is the
      // point at which the patient becomes theirs, so landing on the task that
      // came with it is more useful than staying on a handover now marked done.
      const firstTask = updated.adoptedTasks?.[0];
      if (firstTask) {
        router.push({
          pathname: '/(app)/tasks' as any,
          params: { highlightId: firstTask },
        });
      }
    } catch (error) {
      toast.error('Failed to acknowledge referral', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
    } finally {
      setAcknowledgeLoading(null);
    }
  };

  const handleDeleteHandover = (handoverId: string) => {
    setHandoverToDelete(handoverId);
    setDeleteDialogOpen(true);
  };

  const confirmDeleteHandover = async () => {
    if (!handoverToDelete) return;

    setDeleteLoading(true);
    try {
      const deletedHandover = handovers.find((h) => h.id === handoverToDelete);
      await deleteHandover(handoverToDelete);
      setHandovers((prev) => prev.filter((h) => h.id !== handoverToDelete));
      setDeleteDialogOpen(false);
      setHandoverToDelete(null);
      toast.success('Referral deleted', {
        description: `Referral for ${deletedHandover?.patientName} has been removed.`,
      });
    } catch (error) {
      toast.error('Failed to delete referral', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
    } finally {
      setDeleteLoading(false);
    }
  };

  const sortHandovers = (handoverList: HandoverWithMeta[]) => {
    return [...handoverList].sort((a, b) => {
      const aTime = new Date(a.createdAt || a.date).getTime();
      const bTime = new Date(b.createdAt || b.date).getTime();
      if (sortBy === 'newest') return bTime - aTime;
      if (sortBy === 'oldest') return aTime - bTime;
      if (sortBy === 'patient') return a.patientName.localeCompare(b.patientName);
      if (sortBy === 'status') {
        const statusOrder: Record<string, number> = {
          pending: 0,
          submitted: 1,
          draft: 1,
          acknowledged: 2,
          received: 2,
          completed: 3,
        };
        return (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
      }
      return 0;
    });
  };

  const matchesSearch = (h: HandoverWithMeta) => {
    const q = searchQuery.toLowerCase();
    if (!q) return true;
    return (
      h.patientName.toLowerCase().includes(q) ||
      h.nurseFrom.toLowerCase().includes(q) ||
      h.nurseTo.toLowerCase().includes(q) ||
      h.sbar.situation.toLowerCase().includes(q)
    );
  };

  const incomingHandovers = useMemo(
    () =>
      sortHandovers(
        handovers.filter((h) => {
          // Match web: incoming = not authored as "You"; also include addressed to current user
          const isOutgoing = h.nurseFrom === 'You' || h.nurseFrom === currentUserName;
          return !isOutgoing && matchesSearch(h);
        })
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handovers, searchQuery, sortBy, currentUserName]
  );

  const outgoingHandovers = useMemo(
    () =>
      sortHandovers(
        handovers.filter((h) => {
          const isOutgoing = h.nurseFrom === 'You' || h.nurseFrom === currentUserName;
          return isOutgoing && matchesSearch(h);
        })
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handovers, searchQuery, sortBy, currentUserName]
  );

  const renderHandoverCard = (handover: HandoverWithMeta, type: 'incoming' | 'outgoing') => (
    <Card
      key={handover.id}
      // Card takes a single ViewStyle, so merge rather than pass an array.
      // Arrived here from a notification or the handover popup: make the one
      // they were sent to look at obvious among the rest.
      style={{
        ...styles.handoverCard,
        ...(highlightId === handover.id ? styles.handoverCardHighlighted : null),
      }}
    >
      <CardHeader style={styles.cardHeader}>
        <View style={styles.cardHeaderRow}>
          <View style={styles.flex1}>
            <View style={styles.cardTitleRow}>
              <FileText size={20} color={Colors.blue600} />
              <CardTitle style={styles.cardTitle}>{handover.patientName}</CardTitle>
            </View>
            <CardDescription>
              {type === 'incoming' ? `From: ${handover.nurseFrom}` : `To: ${handover.nurseTo}`} •{' '}
              {handover.shift} shift • {handover.date}
            </CardDescription>
          </View>
          <View style={styles.headerActions}>
            <Badge variant={statusBadgeVariant(handover.status)}>{handover.status}</Badge>
            <Button
              size="icon-sm"
              variant="ghost"
              onPress={() => handleDeleteHandover(handover.id)}
            >
              <Trash2 size={16} color={Colors.red600} />
            </Button>
          </View>
        </View>
      </CardHeader>
      <CardContent style={styles.cardBody}>
        <View style={styles.sbarBlock}>
          <View style={styles.sbarRow}>
            <Shield size={16} color={Colors.blue600} style={styles.sbarIcon} />
            <View style={styles.flex1}>
              <Text style={styles.sbarLabel}>Situation</Text>
              <Text style={styles.sbarText}>{handover.sbar.situation}</Text>
            </View>
          </View>
          <View style={styles.sbarRow}>
            <FileText size={16} color={Colors.green600} style={styles.sbarIcon} />
            <View style={styles.flex1}>
              <Text style={styles.sbarLabel}>Background</Text>
              <Text style={styles.sbarText}>{handover.sbar.background}</Text>
            </View>
          </View>
          <View style={styles.sbarRow}>
            <AlertCircle size={16} color={Colors.orange600} style={styles.sbarIcon} />
            <View style={styles.flex1}>
              <Text style={styles.sbarLabel}>Assessment</Text>
              <Text style={styles.sbarText}>{handover.sbar.assessment}</Text>
            </View>
          </View>
          <View style={styles.sbarRow}>
            <CheckCircle size={16} color={Colors.purple600} style={styles.sbarIcon} />
            <View style={styles.flex1}>
              <Text style={styles.sbarLabel}>Recommendation</Text>
              <Text style={styles.sbarText}>{handover.sbar.recommendation}</Text>
            </View>
          </View>
        </View>

        {handover.unfinishedTasks && handover.unfinishedTasks.length > 0 ? (
          <View style={styles.tasksBox}>
            <Text style={styles.tasksTitle}>Unfinished Tasks</Text>
            {handover.unfinishedTasks.map((task, idx) => (
              <Text key={idx} style={styles.taskItem}>
                • {task}
              </Text>
            ))}
          </View>
        ) : null}

        {handover.photos && handover.photos.length > 0 ? (
          <View style={styles.photosSection}>
            <View style={styles.photosHeader}>
              <ImageIcon size={16} color={Colors.blue600} />
              <Text style={styles.photosTitle}>Clinical Photos</Text>
              <Badge variant="secondary">{handover.photos.length}</Badge>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.photosRow}
            >
              {handover.photos.map((photo) => (
                <View key={photo.id} style={styles.photoCard}>
                  <Image source={{ uri: photo.url }} style={styles.photoImage} />
                  <Text style={styles.photoDesc} numberOfLines={2}>
                    {photo.description}
                  </Text>
                  <Text style={styles.photoMeta}>
                    Expires {new Date(photo.expiresAt).toLocaleDateString()}
                  </Text>
                </View>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {type === 'incoming' && !isAcknowledged(handover.status) ? (
          <Button
            style={styles.ackBtn}
            onPress={() => handleAcknowledgeHandover(handover.id)}
            disabled={acknowledgeLoading === handover.id}
            loading={acknowledgeLoading === handover.id}
          >
            {acknowledgeLoading === handover.id ? (
              <>
                <ActivityIndicator size="small" color={Colors.white} />
                <Text style={styles.ackBtnText}>Acknowledging...</Text>
              </>
            ) : (
              <>
                <CheckCircle size={16} color={Colors.white} />
                <Text style={styles.ackBtnText}>Acknowledge Referral</Text>
              </>
            )}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View>
          <Text style={styles.title}>Referral</Text>
          <Text style={styles.subtitle}>SBAR-based digital endorsement</Text>
        </View>

        <Alert variant="info">
          <AlertDescription>
            All referral notes are encrypted and HIPAA-compliant. Only authorized personnel can
            access this information.
          </AlertDescription>
        </Alert>

        <View style={styles.controls}>
          <View style={styles.searchWrap}>
            <Input
              placeholder="Search referrals..."
              value={searchQuery}
              onChangeText={setSearchQuery}
              leftIcon={<Search size={18} color={Colors.mutedForeground} />}
              inputWrapperStyle={styles.searchInput}
            />
          </View>
          <Select
            value={sortBy}
            onValueChange={(value) => setSortBy(value as SortBy)}
            options={SORT_OPTIONS}
            placeholder="Sort by"
            style={styles.sortSelect}
          />
          <Button onPress={handleCreateHandover} style={styles.newBtn}>
            <Plus size={16} color={Colors.white} />
            <Text style={styles.newBtnText}>New Referral</Text>
          </Button>
        </View>

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          tabs={[
            { value: 'incoming', label: 'Incoming', badge: incomingHandovers.length },
            { value: 'outgoing', label: 'Outgoing', badge: outgoingHandovers.length },
          ]}
        />

        <View style={styles.list}>
          {activeTab === 'incoming' ? (
            incomingHandovers.length === 0 ? (
              <Card>
                <CardContent style={styles.empty}>
                  <Clock size={48} color={Colors.gray500} />
                  <Text style={styles.emptyText}>No incoming referrals</Text>
                </CardContent>
              </Card>
            ) : (
              incomingHandovers.map((h) => renderHandoverCard(h, 'incoming'))
            )
          ) : outgoingHandovers.length === 0 ? (
            <Card>
              <CardContent style={styles.empty}>
                <FileText size={48} color={Colors.gray500} />
                <Text style={styles.emptyText}>No outgoing referrals</Text>
              </CardContent>
            </Card>
          ) : (
            outgoingHandovers.map((h) => renderHandoverCard(h, 'outgoing'))
          )}
        </View>
      </ScrollView>

      <HandoverModal
        open={handoverModalOpen}
        onOpenChange={setHandoverModalOpen}
        onSave={handleSaveHandover as any}
      />

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={confirmDeleteHandover}
        loading={deleteLoading}
        title="Delete Referral"
        description="Are you sure you want to delete this referral? This action cannot be undone."
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
    gap: 16,
    maxWidth: 896,
    width: '100%',
    alignSelf: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.gray900,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.gray600,
    marginTop: 2,
  },
  controls: {
    gap: 12,
  },
  searchWrap: {
    flex: 1,
  },
  searchInput: {
    borderWidth: 2,
    borderColor: Colors.gray200,
    borderRadius: Radius.md,
    ...Shadows.md,
  },
  sortSelect: {
    width: '100%',
  },
  newBtn: {
    backgroundColor: Colors.blue600,
  },
  newBtnText: {
    color: Colors.white,
    fontWeight: '600',
    fontSize: 14,
  },
  list: {
    gap: 16,
  },
  empty: {
    paddingVertical: 48,
    alignItems: 'center',
    gap: 12,
  },
  emptyText: {
    color: Colors.gray500,
    fontSize: 14,
  },
  handoverCardHighlighted: {
    borderWidth: 2,
    borderColor: Colors.blue600,
  },
  handoverCard: {
    borderWidth: 2,
    borderColor: Colors.border,
  },
  cardHeader: {
    paddingBottom: 8,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  flex1: {
    flex: 1,
    minWidth: 0,
  },
  cardBody: {
    gap: 12,
  },
  sbarBlock: {
    gap: 10,
  },
  sbarRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  sbarIcon: {
    marginTop: 2,
  },
  sbarLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.gray700,
  },
  sbarText: {
    fontSize: 13,
    color: Colors.gray600,
    marginTop: 2,
    lineHeight: 18,
  },
  tasksBox: {
    backgroundColor: Colors.orange50,
    borderWidth: 1,
    borderColor: Colors.orange100,
    borderRadius: Radius.md,
    padding: 12,
    gap: 4,
  },
  tasksTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.orange700,
    marginBottom: 4,
  },
  taskItem: {
    fontSize: 12,
    color: Colors.gray700,
    lineHeight: 18,
  },
  photosSection: {
    gap: 8,
  },
  photosHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  photosTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.gray700,
    flex: 1,
  },
  photosRow: {
    gap: 10,
    paddingVertical: 4,
  },
  photoCard: {
    width: 160,
    backgroundColor: Colors.gray50,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  photoImage: {
    width: 160,
    height: 110,
    backgroundColor: Colors.gray200,
  },
  photoDesc: {
    fontSize: 11,
    color: Colors.gray700,
    paddingHorizontal: 8,
    paddingTop: 6,
    lineHeight: 15,
  },
  photoMeta: {
    fontSize: 10,
    color: Colors.mutedForeground,
    paddingHorizontal: 8,
    paddingBottom: 8,
    paddingTop: 2,
  },
  ackBtn: {
    backgroundColor: Colors.blue600,
    width: '100%',
  },
  ackBtnText: {
    color: Colors.white,
    fontWeight: '600',
    fontSize: 14,
  },
});
