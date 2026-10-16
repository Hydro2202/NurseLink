import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Image,
  ActivityIndicator,
  Modal,
  Pressable,
  TextInput,
} from 'react-native';
import {
  FileText,
  CheckCircle,
  XCircle,
  Clock,
  Shield,
  AlertCircle,
  Plus,
  Search,
  Trash2,
  Image as ImageIcon,
  Eye,
  History,
  CheckSquare,
  Square,
} from 'lucide-react-native';
import {
  fetchHandovers,
  createEndorsement,
  acceptEndorsement,
  rejectEndorsement,
  cancelEndorsement,
  completeEndorsementTask,
  completeHandover,
  deleteHandover,
  ApiError,
} from '../../services/api';
import type { EndorsementTaskOutput, HandoverNote } from '../../types/domain';
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

// Nurse-to-nurse only — no head-nurse approval gate. sent -> received ->
// accepted | declined | cancelled -> completed. Action buttons only ever
// show for the receiving nurse (Accept/Reject) or the sending nurse
// (Cancel, outgoing only) — see renderHandoverCard; head nurses get a
// read-only view regardless of status (see the isHeadNurse branch below).
function isActionable(status: string) {
  return status === 'sent' || status === 'received';
}

function statusBadgeVariant(
  status: string
): 'default' | 'secondary' | 'outline' | 'success' | 'warning' {
  if (status === 'accepted' || status === 'completed') return 'success';
  if (status === 'declined' || status === 'cancelled') return 'warning';
  if (status === 'sent' || status === 'received') return 'secondary';
  return 'outline';
}

function statusLabel(status: string): string {
  switch (status) {
    case 'sent':
      return 'Pending';
    case 'received':
      return 'Pending';
    case 'accepted':
      return 'Accepted';
    case 'declined':
      return 'Rejected';
    case 'cancelled':
      return 'Cancelled';
    case 'completed':
      return 'Completed';
    default:
      return status;
  }
}

/**
 * The nurse/shift line under the patient name. Previously this always
 * showed the *sender's* shift (`handover.shift`), even for an outgoing
 * referral where what actually matters is the shift the receiving nurse
 * (`handover.nurseTo`) is assigned to — so "Assigned Shift" never appeared
 * for the two most common views (only the head-nurse oversight branch used
 * toShiftLabel at all). Fixed to show the real assigned nurse + shift for
 * each view, using the same toShiftLabel/nurseToRole the API already
 * returns — falls back to "Not assigned" rather than hiding the line
 * whenever a referral predates these fields.
 */
function describeHandover(handover: HandoverNote, type: 'incoming' | 'outgoing' | 'oversight'): string {
  if (type === 'oversight') {
    const who = `${handover.nurseFrom} → ${handover.nurseTo}`;
    const shifts =
      handover.shiftLabel && handover.toShiftLabel
        ? `${handover.shiftLabel} → ${handover.toShiftLabel} shift${
            handover.shiftDate ? ` • ${handover.shiftDate}` : ''
          }`
        : `${handover.shift} shift • ${handover.date}`;
    return `${who} • ${shifts}`;
  }
  if (type === 'outgoing') {
    const who = `To: ${handover.nurseTo}${handover.nurseToRole ? `, ${handover.nurseToRole}` : ''}`;
    const shift = handover.toShiftLabel
      ? `Assigned shift: ${handover.toShiftLabel}${handover.shiftDate ? ` (${handover.shiftDate})` : ''}`
      : 'Assigned shift: Not assigned';
    return `${who} • ${shift}`;
  }
  return `From: ${handover.nurseFrom} • ${handover.shiftLabel || handover.shift} shift • ${handover.date}`;
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
  // Mirrors acknowledgeLoading but set synchronously — setAcknowledgeLoading
  // is a state update, so a fast double-tap on Accept/Reject/Cancel can both
  // fire before React re-renders with the button disabled. Checked first in
  // each handler below so a second call for the same handover can't start a
  // second in-flight request.
  const acknowledgeLoadingRef = useRef<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('newest');
  // Head-nurse oversight only — filters by the referral's FROM shift.
  const [shiftFilter, setShiftFilter] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [handoverToDelete, setHandoverToDelete] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [declineTarget, setDeclineTarget] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const [historyTarget, setHistoryTarget] = useState<HandoverWithMeta | null>(null);

  const currentUserName = user?.name || 'You';
  // Head nurses are FYI observers only — no create/delete/accept/decline/
  // complete. See CanManageReferral (backend) for the matching write-side
  // lockout; this only controls what the UI offers.
  const isHeadNurse = user?.role === 'head_nurse';

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
    (async () => {
      await loadHandovers();
    })();
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
      const newHandover = await createEndorsement({
        patientIds: handoverData.patientIds || [],
        patientNotes: handoverData.patientNotes || {},
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
      });
      setHandovers((prev) => [{ ...newHandover, createdAt: newHandover.date }, ...prev]);
      // Writing an endorsement notifies the receiving nurse — let the rest
      // of the app catch up now.
      void pollLive();
      const count = newHandover.patients?.length ?? 1;
      toast.success('Endorsement submitted!', {
        description:
          count > 1
            ? `${count} patients have been endorsed to ${newHandover.nurseTo}.`
            : `${newHandover.patientName} has been endorsed to ${newHandover.nurseTo}.`,
      });
    } catch (error) {
      toast.error('Failed to submit endorsement', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
      throw error;
    }
  };

  const handleAcceptHandover = async (handoverId: string) => {
    if (acknowledgeLoadingRef.current) return;
    acknowledgeLoadingRef.current = handoverId;
    setAcknowledgeLoading(handoverId);
    try {
      const updated = await acceptEndorsement(handoverId);
      setHandovers((prev) =>
        prev.map((h) => (h.id === handoverId ? { ...updated, createdAt: updated.date } : h))
      );
      const count = updated.patients?.length ?? 1;
      const moved = updated.adoptedTasks?.length ?? 0;
      toast.success('Endorsement accepted!', {
        description:
          count > 1
            ? `${count} patients are now assigned to you.`
            : moved > 0
              ? `${moved} unfinished task${moved > 1 ? 's' : ''} added to your tasks for ${updated.patientName}.`
              : `${updated.patientName} is now assigned to you.`,
      });
      // We just changed state other nurses are watching. Poll immediately so
      // this device is consistent at once, rather than briefly showing a list
      // that disagrees with the action just taken.
      void pollLive();
      void refreshNotifications();

      // Only a legacy single-patient referral (never a bulk endorsement)
      // moves tasks on accept — see HandoverViewSet.accept.
      const firstTask = updated.adoptedTasks?.[0];
      if (firstTask) {
        router.push({
          pathname: '/(app)/tasks' as any,
          params: { highlightId: firstTask },
        });
      }
    } catch (error) {
      toast.error('Failed to accept endorsement', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
    } finally {
      acknowledgeLoadingRef.current = null;
      setAcknowledgeLoading(null);
    }
  };

  const handleDeclineHandover = async (handoverId: string, reason: string) => {
    if (acknowledgeLoadingRef.current) return;
    acknowledgeLoadingRef.current = handoverId;
    setAcknowledgeLoading(handoverId);
    try {
      const updated = await rejectEndorsement(handoverId, reason.trim());
      setHandovers((prev) =>
        prev.map((h) => (h.id === handoverId ? { ...updated, createdAt: updated.date } : h))
      );
      toast.success('Endorsement rejected', {
        description: `The endorsement for ${updated.patientName} has been rejected and the sender notified.`,
      });
      void pollLive();
      void refreshNotifications();
    } catch (error) {
      toast.error('Failed to reject endorsement', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
    } finally {
      acknowledgeLoadingRef.current = null;
      setAcknowledgeLoading(null);
      setDeclineTarget(null);
      setDeclineReason('');
    }
  };

  const handleCancelHandover = async (handoverId: string) => {
    if (acknowledgeLoadingRef.current) return;
    acknowledgeLoadingRef.current = handoverId;
    setAcknowledgeLoading(handoverId);
    try {
      const updated = await cancelEndorsement(handoverId);
      setHandovers((prev) =>
        prev.map((h) => (h.id === handoverId ? { ...updated, createdAt: updated.date } : h))
      );
      toast.success('Endorsement cancelled', {
        description: `The endorsement for ${updated.patientName} has been withdrawn.`,
      });
      void pollLive();
      void refreshNotifications();
    } catch (error) {
      toast.error('Failed to cancel endorsement', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
    } finally {
      acknowledgeLoadingRef.current = null;
      setAcknowledgeLoading(null);
    }
  };

  const [taskLoadingId, setTaskLoadingId] = useState<number | null>(null);

  const handleToggleTask = async (handoverId: string, task: EndorsementTaskOutput) => {
    setTaskLoadingId(task.id);
    try {
      const updatedTask = await completeEndorsementTask(handoverId, task.id, !task.isCompleted);
      setHandovers((prev) =>
        prev.map((h) =>
          h.id === handoverId
            ? { ...h, tasks: (h.tasks as EndorsementTaskOutput[] | undefined)?.map((t) => (t.id === task.id ? updatedTask : t)) }
            : h
        )
      );
    } catch (error) {
      toast.error('Failed to update task', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
    } finally {
      setTaskLoadingId(null);
    }
  };

  const handleCompleteHandover = async (handoverId: string) => {
    setAcknowledgeLoading(handoverId);
    try {
      const updated = await completeHandover(handoverId);
      setHandovers((prev) =>
        prev.map((h) => (h.id === handoverId ? { ...updated, createdAt: updated.date } : h))
      );
      toast.success('Referral marked completed', {
        description: `Referral for ${updated.patientName} is closed out.`,
      });
      void pollLive();
      void refreshNotifications();
    } catch (error) {
      toast.error('Failed to complete referral', {
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
      toast.success('Endorsement deleted', {
        description: `The endorsement for ${deletedHandover?.patientName} has been removed.`,
      });
    } catch (error) {
      toast.error('Failed to delete endorsement', {
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
          sent: 0,
          received: 1,
          accepted: 2,
          declined: 2,
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

  // Head-nurse oversight: every referral (see HandoverViewSet.get_queryset,
  // which returns all of them to a head nurse, unfiltered) — no
  // incoming/outgoing split, since a head nurse is neither sender nor
  // recipient of any of them.
  const oversightHandovers = useMemo(
    () =>
      sortHandovers(
        handovers.filter((h) => matchesSearch(h) && (!shiftFilter || h.shift === shiftFilter))
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handovers, searchQuery, sortBy, shiftFilter]
  );

  const renderHandoverCard = (handover: HandoverWithMeta, type: 'incoming' | 'outgoing' | 'oversight') => (
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
              <CardTitle style={styles.cardTitle}>
                {handover.patientName}
                {(handover.patients?.length ?? 1) > 1 ? ` +${(handover.patients?.length ?? 1) - 1} more` : ''}
              </CardTitle>
            </View>
            <CardDescription>{describeHandover(handover, type)}</CardDescription>
          </View>
          <View style={styles.headerActions}>
            <Badge variant={statusBadgeVariant(handover.status)}>{statusLabel(handover.status)}</Badge>
            <Button
              size="icon-sm"
              variant="ghost"
              onPress={() => setHistoryTarget(handover)}
            >
              <History size={16} color={Colors.gray600} />
            </Button>
            {type !== 'oversight' ? (
              <Button
                size="icon-sm"
                variant="ghost"
                onPress={() => handleDeleteHandover(handover.id)}
              >
                <Trash2 size={16} color={Colors.red600} />
              </Button>
            ) : null}
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

        {type === 'incoming' && handover.tasks && handover.tasks.length > 0 ? (
          <View style={styles.tasksBox}>
            <Text style={styles.tasksTitle}>Unfinished Tasks</Text>
            {(handover.tasks as EndorsementTaskOutput[]).map((task) => {
              const canCheck = handover.status === 'accepted';
              return (
                <Pressable
                  key={task.id}
                  style={styles.endorsementTaskRow}
                  disabled={!canCheck || taskLoadingId === task.id}
                  onPress={() => handleToggleTask(handover.id, task)}
                >
                  {task.isCompleted ? (
                    <CheckSquare size={16} color={Colors.green600} />
                  ) : (
                    <Square size={16} color={canCheck ? Colors.gray400 : Colors.gray300} />
                  )}
                  <Text
                    style={[
                      styles.endorsementTaskText,
                      task.isCompleted && styles.endorsementTaskTextDone,
                    ]}
                  >
                    {task.description}
                    {task.dueTime ? ` • ${task.dueTime.slice(0, 5)}` : ''}
                    {task.priority === 'HIGH' ? ' • High priority' : ''}
                  </Text>
                </Pressable>
              );
            })}
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

        {type === 'incoming' && isActionable(handover.status) ? (
          <View style={styles.actionButtonsRow}>
            <Button
              style={[styles.ackBtn, { flex: 1 }]}
              onPress={() => handleAcceptHandover(handover.id)}
              disabled={acknowledgeLoading === handover.id}
              loading={acknowledgeLoading === handover.id}
            >
              {acknowledgeLoading === handover.id ? (
                <>
                  <ActivityIndicator size="small" color={Colors.white} />
                  <Text style={styles.ackBtnText}>Accepting...</Text>
                </>
              ) : (
                <>
                  <CheckCircle size={16} color={Colors.white} />
                  <Text style={styles.ackBtnText}>Accept</Text>
                </>
              )}
            </Button>
            <Button
              variant="outline"
              style={{ flex: 1, borderColor: Colors.red200 }}
              onPress={() => setDeclineTarget(handover.id)}
              disabled={acknowledgeLoading === handover.id}
            >
              <XCircle size={16} color={Colors.red600} />
              <Text style={{ color: Colors.red600, fontWeight: '600', fontSize: 14 }}>Reject</Text>
            </Button>
          </View>
        ) : null}
        {type === 'outgoing' && isActionable(handover.status) ? (
          <View style={styles.actionButtonsRow}>
            <Button
              variant="outline"
              style={{ flex: 1, borderColor: Colors.red200 }}
              onPress={() => handleCancelHandover(handover.id)}
              disabled={acknowledgeLoading === handover.id}
              loading={acknowledgeLoading === handover.id}
            >
              <XCircle size={16} color={Colors.red600} />
              <Text style={{ color: Colors.red600, fontWeight: '600', fontSize: 14 }}>Cancel Endorsement</Text>
            </Button>
          </View>
        ) : null}
        {type === 'incoming' && handover.status === 'accepted' && !handover.isEndorsement ? (
          <Button
            style={styles.ackBtn}
            onPress={() => handleCompleteHandover(handover.id)}
            disabled={acknowledgeLoading === handover.id}
            loading={acknowledgeLoading === handover.id}
          >
            <CheckCircle size={16} color={Colors.white} />
            <Text style={styles.ackBtnText}>Mark Completed</Text>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );

  if (loading) {
    return (
      <View style={[styles.root, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={Colors.blue600} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View>
          <Text style={styles.title}>Endorsement</Text>
          <Text style={styles.subtitle}>
            {isHeadNurse
              ? 'Endorsement oversight — view only, for your information'
              : 'Hand over patients to another nurse, any shift or department'}
          </Text>
        </View>

        <Alert variant="info">
          <AlertDescription>
            {isHeadNurse
              ? 'Endorsements move directly between nurses with no approval step. You can see every endorsement and its full history here, but cannot accept, reject, cancel, or edit one.'
              : "Demo system: don't enter real patient information."}
          </AlertDescription>
        </Alert>

        <View style={styles.controls}>
          <View style={styles.searchWrap}>
            <Input
              placeholder="Search endorsements..."
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
          {isHeadNurse ? (
            <Select
              value={shiftFilter}
              onValueChange={setShiftFilter}
              options={[
                { label: 'All shifts', value: '' },
                { label: 'From Morning', value: 'morning' },
                { label: 'From Afternoon', value: 'afternoon' },
                { label: 'From Night', value: 'night' },
              ]}
              placeholder="Filter by shift"
              style={styles.sortSelect}
            />
          ) : null}
          {!isHeadNurse ? (
            <Button onPress={handleCreateHandover} style={styles.newBtn}>
              <Plus size={16} color={Colors.white} />
              <Text style={styles.newBtnText}>New Endorsement</Text>
            </Button>
          ) : null}
        </View>

        {isHeadNurse ? (
          <View style={styles.list}>
            {oversightHandovers.length === 0 ? (
              <Card>
                <CardContent style={styles.empty}>
                  <Eye size={48} color={Colors.gray500} />
                  <Text style={styles.emptyText}>No referrals yet</Text>
                </CardContent>
              </Card>
            ) : (
              oversightHandovers.map((h) => renderHandoverCard(h, 'oversight'))
            )}
          </View>
        ) : (
          <>
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
          </>
        )}
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
        title="Delete Endorsement"
        description="Are you sure you want to delete this endorsement? This action cannot be undone."
      />

      <Modal
        visible={Boolean(declineTarget)}
        transparent
        animationType="fade"
        onRequestClose={() => setDeclineTarget(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setDeclineTarget(null)}>
          <Pressable style={[styles.declineDialog, Shadows.xl]} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.declineTitle}>Reject Endorsement</Text>
            <Text style={styles.declineDescription}>
              Let the sending nurse know why, so they can endorse the patient to someone else.
            </Text>
            <TextInput
              style={styles.declineInput}
              value={declineReason}
              onChangeText={setDeclineReason}
              placeholder="Reason (required)"
              placeholderTextColor={Colors.mutedForeground}
              multiline
              textAlignVertical="top"
            />
            <View style={styles.declineFooter}>
              <Button
                variant="outline"
                style={{ flex: 1 }}
                onPress={() => {
                  setDeclineTarget(null);
                  setDeclineReason('');
                }}
                disabled={Boolean(acknowledgeLoading)}
              >
                Cancel
              </Button>
              <Button
                style={{ flex: 1, backgroundColor: Colors.red600 }}
                onPress={() => declineTarget && handleDeclineHandover(declineTarget, declineReason)}
                disabled={Boolean(acknowledgeLoading) || !declineReason.trim()}
                loading={acknowledgeLoading === declineTarget}
              >
                Reject Endorsement
              </Button>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={Boolean(historyTarget)}
        transparent
        animationType="fade"
        onRequestClose={() => setHistoryTarget(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setHistoryTarget(null)}>
          <Pressable style={[styles.declineDialog, Shadows.xl]} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.declineTitle}>Referral History</Text>
            {historyTarget ? (
              <Text style={styles.declineDescription}>
                {historyTarget.patientName} • {historyTarget.nurseFrom} → {historyTarget.nurseTo}
              </Text>
            ) : null}
            <ScrollView style={{ maxHeight: 320 }}>
              {(historyTarget?.statusHistory ?? []).length === 0 ? (
                <Text style={styles.emptyText}>No history recorded for this endorsement.</Text>
              ) : (
                (historyTarget?.statusHistory ?? []).map((entry, idx) => (
                  <View key={idx} style={styles.historyRow}>
                    <View style={styles.historyDot} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.historyStatus}>{statusLabel(entry.status)}</Text>
                      <Text style={styles.historyMeta}>
                        {entry.byName || 'Unknown'}
                        {entry.at ? ` • ${new Date(entry.at).toLocaleString()}` : ''}
                      </Text>
                      {entry.note ? <Text style={styles.historyNote}>{entry.note}</Text> : null}
                    </View>
                  </View>
                ))
              )}
            </ScrollView>
            <View style={styles.declineFooter}>
              <Button style={{ flex: 1 }} onPress={() => setHistoryTarget(null)}>
                Close
              </Button>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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
  endorsementTaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 3,
  },
  endorsementTaskText: {
    fontSize: 13,
    color: Colors.gray700,
    flex: 1,
  },
  endorsementTaskTextDone: {
    textDecorationLine: 'line-through',
    color: Colors.mutedForeground,
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
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  declineDialog: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: 24,
    width: '100%',
    maxWidth: 420,
  },
  declineTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.foreground,
    marginBottom: 8,
  },
  declineDescription: {
    fontSize: 14,
    color: Colors.mutedForeground,
    lineHeight: 20,
    marginBottom: 16,
  },
  declineInput: {
    borderWidth: 1,
    borderColor: Colors.gray200,
    borderRadius: Radius.md,
    padding: 12,
    minHeight: 80,
    fontSize: 16,
    color: Colors.foreground,
    marginBottom: 16,
  },
  declineFooter: {
    flexDirection: 'row',
    gap: 12,
  },
  historyRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.gray100,
  },
  historyDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.blue500,
    marginTop: 6,
  },
  historyStatus: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.foreground,
  },
  historyMeta: {
    fontSize: 12,
    color: Colors.mutedForeground,
    marginTop: 2,
  },
  historyNote: {
    fontSize: 13,
    color: Colors.gray700,
    marginTop: 4,
    fontStyle: 'italic',
  },
});
