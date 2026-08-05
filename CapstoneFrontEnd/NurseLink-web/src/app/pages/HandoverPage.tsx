import React, { useState, useEffect } from 'react';
import type { HandoverNote } from '../types/domain';
import { fetchHandovers, createHandover, acknowledgeHandover, deleteHandover } from '../api/nurselink';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Input } from '../components/ui/input';
import {
  FileText,
  CheckCircle,
  Clock,
  Shield,
  AlertCircle,
  Loader2,
  Plus,
  Search,
  ArrowUpDown,
  Trash2,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Alert, AlertDescription } from '../components/ui/alert';
import { HandoverModal } from '../components/HandoverModal';
import { DeleteConfirmDialog } from '../components/DeleteConfirmDialog';
import { toast } from 'sonner';

export default function HandoverPage() {
  useEffect(() => {
    (async () => {
      try {
        setHandovers(await fetchHandovers());
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  const [handovers, setHandovers] = useState<HandoverNote[]>([]);
  const [handoverModalOpen, setHandoverModalOpen] = useState(false);
  const [acknowledgeLoading, setAcknowledgeLoading] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'patient' | 'status'>('newest');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [handoverToDelete, setHandoverToDelete] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

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
        nurseFrom: 'You',
        nurseTo: handoverData.nurseTo || '',
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
      setHandovers((prev) => [newHandover, ...prev]);
      toast.success('Handover submitted successfully!', {
        description: `Handover note for ${newHandover.patientName} has been sent to ${newHandover.nurseTo}.`,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to submit handover');
      throw error;
    }
  };

  const handleAcknowledgeHandover = async (handoverId: string) => {
    setAcknowledgeLoading(handoverId);
    try {
      const updated = await acknowledgeHandover(handoverId);
      setHandovers((prev) => prev.map((h) => (h.id === handoverId ? updated : h)));
      toast.success('Handover acknowledged!', {
        description: `You've acknowledged the handover for ${updated.patientName}.`,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to acknowledge handover');
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
      toast.success('Handover deleted', {
        description: `Handover for ${deletedHandover?.patientName} has been removed.`,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete handover');
    } finally {
      setDeleteLoading(false);
    }
  };

  // Sort handovers
  const sortHandovers = (handoverList: HandoverNote[]) => {
    return [...handoverList].sort((a, b) => {
      const aTime = new Date(a.date).getTime();
      const bTime = new Date(b.date).getTime();
      if (sortBy === 'newest') return bTime - aTime;
      if (sortBy === 'oldest') return aTime - bTime;
      if (sortBy === 'patient') return a.patientName.localeCompare(b.patientName);
      if (sortBy === 'status') {
        const statusOrder: Record<string, number> = {
          pending: 0,
          acknowledged: 1,
          completed: 2,
        };
        return (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
      }
      return 0;
    });
  };

  const incomingHandovers = sortHandovers(
    handovers.filter(h => h.nurseTo !== 'You').filter(h =>
      h.patientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      h.nurseFrom.toLowerCase().includes(searchQuery.toLowerCase()) ||
      h.sbar.situation.toLowerCase().includes(searchQuery.toLowerCase())
    )
  );
  
  const outgoingHandovers = sortHandovers(
    handovers.filter(h => h.nurseFrom === 'You').filter(h =>
      h.patientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      h.nurseTo.toLowerCase().includes(searchQuery.toLowerCase()) ||
      h.sbar.situation.toLowerCase().includes(searchQuery.toLowerCase())
    )
  );

  const renderHandoverCard = (handover: HandoverNote, type: 'incoming' | 'outgoing') => (
    <Card key={handover.id} className="border-2 hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-600" />
              {handover.patientName}
            </CardTitle>
            <CardDescription className="mt-1">
              {type === 'incoming' ? `From: ${handover.nurseFrom}` : `To: ${handover.nurseTo}`} • {handover.shift} shift • {handover.date}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant={
                handover.status === 'acknowledged' || handover.status === 'completed' ? 'default' :
                handover.status === 'pending' ? 'secondary' :
                'outline'
              }
            >
              {handover.status}
            </Badge>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => handleDeleteHandover(handover.id)}
              className="text-red-600 hover:bg-red-50"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <Shield className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-700">Situation</p>
              <p className="text-sm text-gray-600">{handover.sbar.situation}</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <FileText className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-700">Background</p>
              <p className="text-sm text-gray-600">{handover.sbar.background}</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-orange-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-700">Assessment</p>
              <p className="text-sm text-gray-600">{handover.sbar.assessment}</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle className="w-4 h-4 text-purple-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-700">Recommendation</p>
              <p className="text-sm text-gray-600">{handover.sbar.recommendation}</p>
            </div>
          </div>
        </div>
        {type === 'incoming' && handover.status === 'pending' && (
          <Button
            className="w-full bg-blue-600 hover:bg-blue-700"
            onClick={() => handleAcknowledgeHandover(handover.id)}
            disabled={acknowledgeLoading === handover.id}
          >
            {acknowledgeLoading === handover.id ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Acknowledging...
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4 mr-2" />
                Acknowledge Handover
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="p-4 pb-24 space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Shift Handover</h1>
        <p className="text-gray-600">SBAR-based digital endorsement</p>
      </div>

      {/* Security Notice */}
      <Alert>
        <Shield className="h-4 w-4" />
        <AlertDescription>
          All handover notes are encrypted and HIPAA-compliant. Only authorized personnel can access this information.
        </AlertDescription>
      </Alert>

      {/* Search and Sort */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search handovers..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-10 rounded-lg transition-colors shadow-md border-2 border-gray-200 focus:border-blue-500 focus:shadow-lg focus:ring-2 focus:ring-blue-200"
          />
        </div>
        <Select value={sortBy} onValueChange={(value: any) => setSortBy(value)}>
          <SelectTrigger className="w-full sm:w-[160px] shadow-md border-2 border-gray-200 focus:border-blue-500 focus:shadow-lg focus:ring-2 focus:ring-blue-200">
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
        <Button
          onClick={handleCreateHandover}
          className="bg-blue-600 hover:bg-blue-700 w-full sm:w-auto"
        >
          <Plus className="w-4 h-4 mr-2" />
          New Handover
        </Button>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="incoming" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="incoming">
            Incoming ({incomingHandovers.length})
          </TabsTrigger>
          <TabsTrigger value="outgoing">
            Outgoing ({outgoingHandovers.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="incoming" className="space-y-4">
          {incomingHandovers.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Clock className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-500">No incoming handovers</p>
              </CardContent>
            </Card>
          ) : (
            incomingHandovers.map(handover => renderHandoverCard(handover, 'incoming'))
          )}
        </TabsContent>

        <TabsContent value="outgoing" className="space-y-4">
          {outgoingHandovers.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <FileText className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-500">No outgoing handovers</p>
              </CardContent>
            </Card>
          ) : (
            outgoingHandovers.map(handover => renderHandoverCard(handover, 'outgoing'))
          )}
        </TabsContent>
      </Tabs>

      {/* Modals */}
      <HandoverModal
        open={handoverModalOpen}
        onOpenChange={setHandoverModalOpen}
        onSave={handleSaveHandover}
      />

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={confirmDeleteHandover}
        loading={deleteLoading}
        title="Delete Handover"
        description="Are you sure you want to delete this handover? This action cannot be undone."
      />
    </div>
  );
}