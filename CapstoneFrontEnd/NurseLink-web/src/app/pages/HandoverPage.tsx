import React, { useEffect, useMemo, useState } from 'react';
import type { HandoverNote } from '../types/domain';
import {
  fetchHandovers,
  createHandover,
  acceptHandover,
  declineHandover,
  completeHandover,
  deleteHandover,
  ApiError,
} from '../api/nurselink';
import { useAuth } from '../contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import {
  FileText,
  CheckCircle,
  XCircle,
  Clock,
  Shield,
  AlertCircle,
  Loader2,
  Plus,
  Search,
  ArrowUpDown,
  Trash2,
  Eye,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Alert, AlertDescription } from '../components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { HandoverModal } from '../components/HandoverModal';
import { DeleteConfirmDialog } from '../components/DeleteConfirmDialog';
import { toast } from 'sonner';

type SortBy = 'newest' | 'oldest' | 'patient' | 'status';

const STATUS_BADGE: Record<HandoverNote['status'], { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' }> = {
  sent: { label: 'Sent', variant: 'secondary' },
  received: { label: 'Received', variant: 'secondary' },
  accepted: { label: 'Accepted', variant: 'success' },
  declined: { label: 'Declined', variant: 'warning' },
  completed: { label: 'Completed', variant: 'success' },
};

function isActionable(status: HandoverNote['status']) {
  return status === 'sent' || status === 'received';
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
        ? `${handover.shiftLabel} → ${handover.toShiftLabel} shift${handover.shiftDate ? ` • ${handover.shiftDate}` : ''}`
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
  // incoming — the sender's shift at the time they filed this referral is
  // the relevant context here (the viewer already knows their own shift).
  return `From: ${handover.nurseFrom} • ${handover.shiftLabel || handover.shift} shift • ${handover.date}`;
}

export default function HandoverPage() {
  const { user } = useAuth();
  const currentUserName = user?.name || 'You';
  // Head nurses are FYI observers only — no create/delete/accept/decline/
  // complete. See CanManageReferral (backend) for the matching write-side
  // lockout; this only controls what the UI offers.
  const isHeadNurse = user?.role === 'head_nurse';

  const [handovers, setHandovers] = useState<HandoverNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [handoverModalOpen, setHandoverModalOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('newest');
  const [shiftFilter, setShiftFilter] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [handoverToDelete, setHandoverToDelete] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [declineTarget, setDeclineTarget] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState('');

  const loadHandovers = () => {
    fetchHandovers()
      .then(setHandovers)
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadHandovers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreateHandover = () => setHandoverModalOpen(true);

  const handleSaveHandover = async (handoverData: Partial<HandoverNote>) => {
    try {
      const newHandover = await createHandover({
        patientId: handoverData.patientId || '',
        patientName: handoverData.patientName || '',
        // shift/toShift/shiftDate/department are all server-derived from
        // the sender's own Duty Roster shift now — nothing to send here,
        // see api/referral_shifts.py.
        date: new Date().toISOString().slice(0, 10),
        nurseFrom: currentUserName,
        nurseTo: handoverData.nurseTo || '',
        nurseToId: handoverData.nurseToId || '',
        sbar: handoverData.sbar || { situation: '', background: '', assessment: '', recommendation: '' },
        unfinishedTasks: handoverData.unfinishedTasks || [],
      });
      setHandovers((prev) => [newHandover, ...prev]);
      toast.success('Referral submitted successfully!', {
        description: `Referral note for ${newHandover.patientName} has been sent to ${newHandover.nurseTo}.`,
      });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to submit referral');
      throw error;
    }
  };

  const handleAccept = async (id: string) => {
    setActionLoading(id);
    try {
      const updated = await acceptHandover(id);
      setHandovers((prev) => prev.map((h) => (h.id === id ? updated : h)));
      toast.success('Referral accepted', { description: `You've accepted the referral for ${updated.patientName}.` });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to accept referral');
    } finally {
      setActionLoading(null);
    }
  };

  const handleComplete = async (id: string) => {
    setActionLoading(id);
    try {
      const updated = await completeHandover(id);
      setHandovers((prev) => prev.map((h) => (h.id === id ? updated : h)));
      toast.success('Referral marked completed');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to complete referral');
    } finally {
      setActionLoading(null);
    }
  };

  const handleConfirmDecline = async () => {
    if (!declineTarget || !declineReason.trim()) return;
    setActionLoading(declineTarget);
    try {
      const updated = await declineHandover(declineTarget, declineReason.trim());
      setHandovers((prev) => prev.map((h) => (h.id === declineTarget ? updated : h)));
      toast.success('Referral declined');
      setDeclineTarget(null);
      setDeclineReason('');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to decline referral');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteHandover = (id: string) => {
    setHandoverToDelete(id);
    setDeleteDialogOpen(true);
  };

  const confirmDeleteHandover = async () => {
    if (!handoverToDelete) return;
    setDeleteLoading(true);
    try {
      const deleted = handovers.find((h) => h.id === handoverToDelete);
      await deleteHandover(handoverToDelete);
      setHandovers((prev) => prev.filter((h) => h.id !== handoverToDelete));
      setDeleteDialogOpen(false);
      setHandoverToDelete(null);
      toast.success('Referral deleted', { description: `Referral for ${deleted?.patientName} has been removed.` });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to delete referral');
    } finally {
      setDeleteLoading(false);
    }
  };

  const sortHandovers = (list: HandoverNote[]) =>
    [...list].sort((a, b) => {
      const aTime = new Date(a.date).getTime();
      const bTime = new Date(b.date).getTime();
      if (sortBy === 'newest') return bTime - aTime;
      if (sortBy === 'oldest') return aTime - bTime;
      if (sortBy === 'patient') return a.patientName.localeCompare(b.patientName);
      if (sortBy === 'status') {
        const order: Record<string, number> = { sent: 0, received: 1, accepted: 2, declined: 2, completed: 3 };
        return (order[a.status] ?? 9) - (order[b.status] ?? 9);
      }
      return 0;
    });

  const matchesSearch = (h: HandoverNote) => {
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
    () => sortHandovers(handovers.filter((h) => h.nurseFrom !== currentUserName && matchesSearch(h))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handovers, searchQuery, sortBy, currentUserName]
  );
  const outgoingHandovers = useMemo(
    () => sortHandovers(handovers.filter((h) => h.nurseFrom === currentUserName && matchesSearch(h))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handovers, searchQuery, sortBy, currentUserName]
  );
  // Head-nurse oversight: every referral (see HandoverViewSet.get_queryset,
  // which returns all of them to a head nurse, unfiltered) — no
  // incoming/outgoing split, since a head nurse is neither sender nor
  // recipient of any of them.
  const oversightHandovers = useMemo(
    () => sortHandovers(handovers.filter((h) => matchesSearch(h) && (!shiftFilter || h.shift === shiftFilter))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handovers, searchQuery, sortBy, shiftFilter]
  );

  const renderHandoverCard = (handover: HandoverNote, type: 'incoming' | 'outgoing' | 'oversight') => (
    <Card key={handover.id} className="border-2 hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-600" />
              {handover.patientName}
            </CardTitle>
            <CardDescription className="mt-1">
              {describeHandover(handover, type)}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={STATUS_BADGE[handover.status].variant}>{STATUS_BADGE[handover.status].label}</Badge>
            {type === 'outgoing' && (
              <Button size="sm" variant="ghost" onClick={() => handleDeleteHandover(handover.id)} className="text-red-600 hover:bg-red-50">
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <Shield className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-700">Situation</p>
              <p className="text-sm text-gray-600 whitespace-pre-line">{handover.sbar.situation}</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <FileText className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-700">Background</p>
              <p className="text-sm text-gray-600 whitespace-pre-line">{handover.sbar.background}</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-orange-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-700">Assessment</p>
              <p className="text-sm text-gray-600 whitespace-pre-line">{handover.sbar.assessment}</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle className="w-4 h-4 text-purple-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-700">Recommendation</p>
              <p className="text-sm text-gray-600 whitespace-pre-line">{handover.sbar.recommendation}</p>
            </div>
          </div>
        </div>

        {handover.status === 'declined' && handover.declinedReason && (
          <Alert variant="warning">
            <AlertDescription>Declined: {handover.declinedReason}</AlertDescription>
          </Alert>
        )}

        {type === 'incoming' && isActionable(handover.status) && (
          <div className="flex gap-2">
            <Button
              className="flex-1 bg-green-600 hover:bg-green-700"
              onClick={() => handleAccept(handover.id)}
              disabled={actionLoading === handover.id}
            >
              {actionLoading === handover.id ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-2" />}
              Accept
            </Button>
            <Button
              variant="outline"
              className="flex-1 border-red-300 text-red-700 hover:bg-red-50"
              onClick={() => setDeclineTarget(handover.id)}
              disabled={actionLoading === handover.id}
            >
              <XCircle className="w-4 h-4 mr-2" />
              Decline
            </Button>
          </div>
        )}

        {type === 'incoming' && handover.status === 'accepted' && (
          <Button className="w-full bg-blue-600 hover:bg-blue-700" onClick={() => handleComplete(handover.id)} disabled={actionLoading === handover.id}>
            {actionLoading === handover.id ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-2" />}
            Mark Completed
          </Button>
        )}
      </CardContent>
    </Card>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="p-4 pb-24 space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Referral</h1>
        <p className="text-gray-600">{isHeadNurse ? 'Department oversight — view only, for your information' : 'SBAR-based digital endorsement'}</p>
      </div>

      <Alert>
        <Shield className="h-4 w-4" />
        <AlertDescription>
          {isHeadNurse
            ? 'Referrals move directly between nurses with no approval step. You can see every referral and its full history here, but cannot accept, decline, or edit one.'
            : 'All referral notes are encrypted and HIPAA-compliant. Only authorized personnel can access this information.'}
        </AlertDescription>
      </Alert>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search referrals..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
          <SelectTrigger className="w-full sm:w-[160px]">
            <ArrowUpDown className="w-4 h-4 mr-2" />
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest</SelectItem>
            <SelectItem value="oldest">Oldest</SelectItem>
            <SelectItem value="patient">Patient Name</SelectItem>
            <SelectItem value="status">Status</SelectItem>
          </SelectContent>
        </Select>
        {isHeadNurse ? (
          <Select value={shiftFilter} onValueChange={setShiftFilter}>
            <SelectTrigger className="w-full sm:w-[170px]">
              <SelectValue placeholder="Filter by shift" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All shifts</SelectItem>
              <SelectItem value="morning">From Morning</SelectItem>
              <SelectItem value="afternoon">From Afternoon</SelectItem>
              <SelectItem value="night">From Night</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <Button onClick={handleCreateHandover} className="w-full sm:w-auto">
            <Plus className="w-4 h-4 mr-2" />
            New Referral
          </Button>
        )}
      </div>

      {isHeadNurse ? (
        <div className="space-y-4">
          {oversightHandovers.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Eye className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-500">No referrals yet</p>
              </CardContent>
            </Card>
          ) : (
            oversightHandovers.map((h) => renderHandoverCard(h, 'oversight'))
          )}
        </div>
      ) : (
        <Tabs defaultValue="incoming" className="space-y-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="incoming">Incoming ({incomingHandovers.length})</TabsTrigger>
            <TabsTrigger value="outgoing">Outgoing ({outgoingHandovers.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="incoming" className="space-y-4">
            {incomingHandovers.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Clock className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                  <p className="text-gray-500">No incoming referrals</p>
                </CardContent>
              </Card>
            ) : (
              incomingHandovers.map((h) => renderHandoverCard(h, 'incoming'))
            )}
          </TabsContent>

          <TabsContent value="outgoing" className="space-y-4">
            {outgoingHandovers.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <FileText className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                  <p className="text-gray-500">No outgoing referrals</p>
                </CardContent>
              </Card>
            ) : (
              outgoingHandovers.map((h) => renderHandoverCard(h, 'outgoing'))
            )}
          </TabsContent>
        </Tabs>
      )}

      <HandoverModal open={handoverModalOpen} onOpenChange={setHandoverModalOpen} onSave={handleSaveHandover} />

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={confirmDeleteHandover}
        loading={deleteLoading}
        title="Delete Referral"
        description="Are you sure you want to delete this referral? This action cannot be undone."
      />

      <Dialog open={!!declineTarget} onOpenChange={(open) => !open && setDeclineTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Decline Referral</DialogTitle>
            <DialogDescription>Explain why this referral is being declined.</DialogDescription>
          </DialogHeader>
          <Textarea value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} rows={4} placeholder="Reason for declining..." />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeclineTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmDecline} disabled={!declineReason.trim() || actionLoading === declineTarget}>
              {actionLoading === declineTarget ? 'Submitting...' : 'Confirm Decline'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
