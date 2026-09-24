import React, { useState, useEffect, useRef } from 'react';
import { adminFetch, getStoredAdminToken } from './adminFetch';
import {
  Users,
  Search,
  RefreshCw,
  Radio,
  Building,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Upload,
  FileSpreadsheet,
  Lock,
  Unlock,
  ArrowRight,
  ShieldCheck,
  Clock,
  UserCheck,
  UserMinus,
  RotateCcw,
  Filter,
} from 'lucide-react';

interface ParticipantItem {
  id: string;
  name: string;
  email?: string;
  participantCode?: string;
  teamName: string;
  college: string;
  status: 'ACTIVE' | 'INACTIVE';
  registrationStatus?: string;
  connectionStatus: 'CONNECTED' | 'DISCONNECTED';
  problemsSolved?: number;
  totalScore?: number;
  lastActivity: string;
}

interface RegistrationStats {
  registeredTeams: number;
  registeredParticipants: number;
  oneMemberTeams: number;
  twoMemberTeams: number;
  threeMemberTeams?: number;
  eventStatus: string;
  registrationLocked: boolean;
  lastImportTime: string | null;
  lastImportResult: any | null;
}

interface ParsedParticipantPreview {
  rowNumber: number;
  name: string;
  email?: string;
  phone?: string;
  college?: string;
  participantCode: string;
  status: 'NEW' | 'UNCHANGED' | 'UPDATED' | 'CONFLICT';
  warnings: string[];
  errors: string[];
}

interface ValidationData {
  valid: boolean;
  canImport: boolean;
  registrationLocked: boolean;
  eventStatus: string;
  stats: {
    totalRows: number;
    totalTeams: number;
    totalParticipants: number;
    oneMemberTeams: number;
    twoMemberTeams: number;
    threeMemberTeams?: number;
    newParticipants: number;
    existingParticipants: number;
    unchangedParticipants: number;
    updatedParticipants: number;
    conflictParticipants: number;
    newTeams: number;
    existingTeams: number;
    unchangedTeams: number;
    updatedTeams: number;
    conflictTeams: number;
    errorCount: number;
    warningCount: number;
  };
  participants?: ParsedParticipantPreview[];
  teams?: any[];
  errors: Array<{ row?: number; participantName?: string; teamName?: string; message: string }>;
  warnings: Array<{ row?: number; participantName?: string; teamName?: string; message: string }>;
}

export const AdminParticipants: React.FC = () => {
  // Surveillance Table State
  const [participants, setParticipants] = useState<ParticipantItem[]>([]);
  const [loadingParticipants, setLoadingParticipants] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [lastRefreshed, setLastRefreshed] = useState(new Date());

  // Filter state: 'ACTIVE' | 'INACTIVE' | 'ALL' (Default: 'ACTIVE')
  const [statusFilter, setStatusFilter] = useState<'ACTIVE' | 'INACTIVE' | 'ALL'>('ACTIVE');

  // Remove Participant Modal State
  const [removeModalParticipant, setRemoveModalParticipant] = useState<ParticipantItem | null>(null);
  const [removeReason, setRemoveReason] = useState('');
  const [removing, setRemoving] = useState(false);

  // Reactivate Participant Modal State
  const [reactivateModalParticipant, setReactivateModalParticipant] = useState<ParticipantItem | null>(null);
  const [reactivating, setReactivating] = useState(false);

  // Action feedback
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Registration Stats State
  const [regStats, setRegStats] = useState<RegistrationStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  // CSV Import State
  const [csvContent, setCsvContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationData | null>(null);
  const [importing, setImporting] = useState(false);
  const [importSuccessMessage, setImportSuccessMessage] = useState<string | null>(null);
  const [importErrorMessage, setImportErrorMessage] = useState<string | null>(null);
  const [showManualCsvInput, setShowManualCsvInput] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchStats = async () => {
    try {
      const res = await adminFetch('/api/admin/participants/stats');
      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await res.json();
          if (data && data.stats) {
            setRegStats(data.stats);
          }
        }
      }
    } catch (err) {
      console.error('Failed to load registration statistics:', err);
    } finally {
      setLoadingStats(false);
    }
  };

  const fetchParticipants = async () => {
    try {
      const res = await adminFetch('/api/admin/participants?status=all');
      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await res.json();
          if (data && Array.isArray(data.participants)) {
            setParticipants(data.participants);
            setLastRefreshed(new Date());
          }
        }
      }
    } catch (err) {
      console.error('Failed to load participants:', err);
    } finally {
      setLoadingParticipants(false);
    }
  };

  const handleRemoveParticipant = async () => {
    if (!removeModalParticipant) return;
    setRemoving(true);
    setActionError(null);
    try {
      const res = await adminFetch(`/api/admin/participants/${removeModalParticipant.id}/deactivate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: removeReason }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionError(data.error || 'Failed to remove participant.');
        return;
      }
      setActionSuccess(`Participant "${removeModalParticipant.name}" has been removed from active registration.`);
      setRemoveModalParticipant(null);
      setRemoveReason('');
      await Promise.all([fetchParticipants(), fetchStats()]);
    } catch (err: any) {
      setActionError(err.message || 'Network error while removing participant.');
    } finally {
      setRemoving(false);
    }
  };

  const handleReactivateParticipant = async () => {
    if (!reactivateModalParticipant) return;
    setReactivating(true);
    setActionError(null);
    try {
      const res = await adminFetch(`/api/admin/participants/${reactivateModalParticipant.id}/reactivate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Reactivated by administrator.' }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionError(data.error || 'Failed to reactivate participant.');
        return;
      }
      setActionSuccess(`Participant "${reactivateModalParticipant.name}" has been reactivated.`);
      setReactivateModalParticipant(null);
      await Promise.all([fetchParticipants(), fetchStats()]);
    } catch (err: any) {
      setActionError(err.message || 'Network error while reactivating participant.');
    } finally {
      setReactivating(false);
    }
  };

  useEffect(() => {
    fetchStats();
    fetchParticipants();

    let eventSource: EventSource | null = null;
    try {
      const token = getStoredAdminToken();
      const sseUrl = token ? `/api/admin/events?token=${encodeURIComponent(token)}` : '/api/admin/events';
      eventSource = new EventSource(sseUrl, { withCredentials: true });

      const handleRefresh = () => {
        fetchParticipants();
        fetchStats();
      };

      eventSource.addEventListener('admin.metrics.updated', handleRefresh);
      eventSource.addEventListener('admin.participant.deactivated', handleRefresh);
      eventSource.addEventListener('admin.participant.reactivated', handleRefresh);
      eventSource.addEventListener('admin.connection.changed', handleRefresh);
    } catch {
      // Fallback handled by polling
    }

    const interval = setInterval(() => {
      fetchParticipants();
      fetchStats();
    }, 10000);

    return () => {
      clearInterval(interval);
      if (eventSource) {
        eventSource.close();
      }
    };
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setImportSuccessMessage(null);
    setImportErrorMessage(null);
    setValidationResult(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setCsvContent(text || '');
    };
    reader.onerror = () => {
      setImportErrorMessage('Failed to read the selected file. Please try again.');
    };
    reader.readAsText(file);
  };

  const triggerValidate = async (customContent?: string) => {
    const contentToValidate = customContent !== undefined ? customContent : csvContent;
    if (!contentToValidate || !contentToValidate.trim()) {
      setImportErrorMessage('Please select a file or paste participant CSV content to validate.');
      return;
    }

    setValidating(true);
    setImportSuccessMessage(null);
    setImportErrorMessage(null);

    try {
      const res = await adminFetch('/api/admin/participants/validate-csv', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ csvContent: contentToValidate }),
      });

      const data = await res.json();
      if (!res.ok) {
        setImportErrorMessage(data.error || 'CSV validation failed.');
        setValidationResult(null);
        return;
      }

      setValidationResult(data.validation || data);
    } catch (err) {
      console.error('Validation request error:', err);
      setImportErrorMessage('Network error while validating CSV. Check connection and retry.');
      setValidationResult(null);
    } finally {
      setValidating(false);
    }
  };

  const triggerConfirmImport = async () => {
    if (!csvContent || !validationResult || !validationResult.canImport) {
      return;
    }

    setImporting(true);
    setImportSuccessMessage(null);
    setImportErrorMessage(null);

    try {
      const res = await adminFetch('/api/admin/participants/confirm-csv', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ confirm: true, csvContent }),
      });

      const data = await res.json();
      if (!res.ok) {
        setImportErrorMessage(data.error || 'Failed to confirm CSV import.');
        return;
      }

      setImportSuccessMessage(
        data.message ||
          `Successfully imported ${data.stats?.participantsImported || 0} independent competitors.`
      );
      setValidationResult(null);
      setCsvContent('');
      setFileName('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      // Refresh data
      await Promise.all([fetchStats(), fetchParticipants()]);
    } catch (err) {
      console.error('Import confirmation error:', err);
      setImportErrorMessage('Network error while committing CSV import.');
    } finally {
      setImporting(false);
    }
  };

  const handleResetImport = () => {
    setCsvContent('');
    setFileName('');
    setValidationResult(null);
    setImportSuccessMessage(null);
    setImportErrorMessage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const activeCount = participants.filter((p) => p.status === 'ACTIVE' || !p.status).length;
  const inactiveCount = participants.filter((p) => p.status === 'INACTIVE' || p.status === 'DISABLED').length;
  const totalCount = participants.length;

  const filtered = participants.filter((p) => {
    const isActive = p.status === 'ACTIVE' || !p.status;
    if (statusFilter === 'ACTIVE' && !isActive) return false;
    if (statusFilter === 'INACTIVE' && isActive) return false;

    const term = searchTerm.toLowerCase();
    return (
      p.name.toLowerCase().includes(term) ||
      (p.participantCode || '').toLowerCase().includes(term) ||
      (p.email || '').toLowerCase().includes(term) ||
      (p.college || '').toLowerCase().includes(term)
    );
  });

  return (
    <div id="admin-participants-view" className="space-y-8 font-mono">
      {/* SECTION 1: REGISTERED PARTICIPANTS & STATS */}
      <div id="registered-participants-section" className="space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-zinc-100 flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-blue-400" />
              SOLO COMPETITOR REGISTRATION & CSV IMPORT
            </h2>
            <p className="text-xs text-zinc-400 mt-1">
              Authoritative solo participant registration import. Each row represents one individual competitor with their own independent identity, access code, session, and leaderboard progress.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {regStats?.registrationLocked ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-bold">
                <Lock className="w-3.5 h-3.5" />
                REGISTRATION LOCKED ({regStats.eventStatus})
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold">
                <Unlock className="w-3.5 h-3.5" />
                REGISTRATION OPEN ({regStats?.eventStatus || 'NOT_STARTED'})
              </span>
            )}
          </div>
        </div>

        {/* STATS TILES */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-xl p-4">
            <div className="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">Total Competitors</div>
            <div className="text-2xl font-black text-blue-400 mt-1">
              {loadingStats ? '...' : regStats?.registeredParticipants ?? 0}
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">Independent competitors registered</div>
          </div>

          <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-xl p-4">
            <div className="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">Competition Mode</div>
            <div className="text-2xl font-black text-purple-400 mt-1">
              SOLO
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">1 competitor = 1 independent unit</div>
          </div>

          <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-xl p-4">
            <div className="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">Session Limit</div>
            <div className="text-2xl font-black text-emerald-400 mt-1">
              1 Active
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">Strictly 1 concurrent session per person</div>
          </div>

          <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-xl p-4">
            <div className="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">Event Status</div>
            <div className="text-2xl font-black text-zinc-200 mt-1">
              {regStats?.eventStatus || 'NOT_STARTED'}
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">
              {regStats?.registrationLocked ? 'Mutations locked' : 'Ready for registration'}
            </div>
          </div>
        </div>

        {/* Last Import Info if available */}
        {regStats?.lastImportTime && (
          <div className="text-[11px] text-zinc-500 flex items-center gap-2 px-1">
            <Clock className="w-3.5 h-3.5 text-zinc-400" />
            <span>
              Last import confirmed at <strong className="text-zinc-300">{new Date(regStats.lastImportTime).toLocaleString()}</strong>
            </span>
          </div>
        )}
      </div>

      {/* SECTION 2: CSV IMPORTER WORKFLOW */}
      <div className="bg-zinc-950/90 border border-zinc-800 rounded-xl p-5 shadow-xl space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800/80 pb-4">
          <div>
            <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
              <Upload className="w-4 h-4 text-blue-400" />
              Two-Phase Participant CSV Importer
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Each row represents one individual competitor. Upload and validate before committing to database.
            </p>
          </div>

          <button
            onClick={() => setShowManualCsvInput(!showManualCsvInput)}
            className="text-xs text-zinc-400 hover:text-zinc-200 underline cursor-pointer"
          >
            {showManualCsvInput ? 'Hide Raw Input' : 'Paste Raw CSV Text'}
          </button>
        </div>

        {/* Alerts & Feedback */}
        {importSuccessMessage && (
          <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <div>
              <strong className="font-bold">IMPORT CONFIRMED:</strong> {importSuccessMessage}
            </div>
          </div>
        )}

        {importErrorMessage && (
          <div className="p-4 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2.5">
            <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <strong className="font-bold">IMPORT BLOCKED:</strong> {importErrorMessage}
            </div>
          </div>
        )}

        {/* Phase 1 Upload Controls */}
        <div className="space-y-4">
          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
            <input
              type="file"
              ref={fileInputRef}
              accept=".csv,text/csv"
              onChange={handleFileChange}
              className="hidden"
              id="csv-file-picker"
            />
            <label
              htmlFor="csv-file-picker"
              className="px-4 py-2.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 rounded-lg text-xs font-semibold text-zinc-200 flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-sm"
            >
              <Upload className="w-4 h-4 text-blue-400" />
              <span>{fileName ? `File: ${fileName}` : 'Choose Participant CSV File...'}</span>
            </label>

            {fileName && (
              <button
                onClick={() => triggerValidate()}
                disabled={validating || regStats?.registrationLocked}
                className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow"
              >
                {validating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                <span>{validating ? 'Validating CSV...' : 'Validate CSV'}</span>
              </button>
            )}

            {(csvContent || validationResult) && (
              <button
                onClick={handleResetImport}
                className="px-3 py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-800 rounded-lg text-xs transition-colors cursor-pointer"
              >
                Reset
              </button>
            )}
          </div>

          {showManualCsvInput && (
            <div className="space-y-2 pt-2">
              <label className="text-xs text-zinc-400 block font-semibold">
                Paste Participant CSV (Each row represents one individual competitor. Header: "Participant Name", "Participant Code", "Email", "College"):
              </label>
              <textarea
                value={csvContent}
                onChange={(e) => {
                  setCsvContent(e.target.value);
                  setValidationResult(null);
                }}
                rows={5}
                placeholder="Participant Name,Participant Code,Email,College&#10;Ravi Kumar,RIP-1001,ravi@example.com,ABC College&#10;Arun Kumar,RIP-1002,arun@example.com,XYZ College&#10;Priya Kumar,RIP-1003,priya@example.com,DEF College"
                className="w-full bg-zinc-900 border border-zinc-700/80 rounded-lg p-3 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-blue-500 font-mono"
              />
              <button
                onClick={() => triggerValidate()}
                disabled={validating || !csvContent.trim() || regStats?.registrationLocked}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                {validating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                <span>Validate Pasted CSV</span>
              </button>
            </div>
          )}
        </div>

        {/* Phase 2: Validation Preview */}
        {validationResult && (
          <div className="space-y-4 pt-3 border-t border-zinc-800/80">
            {/* Validation Outcome Banner */}
            <div
              className={`p-4 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                validationResult.valid && validationResult.canImport
                  ? 'bg-emerald-950/20 border-emerald-500/40'
                  : 'bg-rose-950/20 border-rose-500/40'
              }`}
            >
              <div>
                <div className="flex items-center gap-2">
                  {validationResult.valid && validationResult.canImport ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-rose-400" />
                  )}
                  <h4 className="text-sm font-bold text-zinc-100">
                    {validationResult.registrationLocked
                      ? 'VALIDATION BLOCKED: Competition is Active'
                      : validationResult.valid
                      ? 'CSV VALIDATION PASSED — Ready to Import'
                      : `VALIDATION FAILED — ${validationResult.errors.length} Error(s) Found`}
                  </h4>
                </div>
                <p className="text-xs text-zinc-400 mt-1">
                  {validationResult.registrationLocked
                    ? 'Registration roster cannot be altered while the event is RUNNING or PAUSED.'
                    : validationResult.valid
                    ? 'Each row represents one individual competitor. Review the preview below and confirm import.'
                    : 'Please correct the issues listed below in the CSV file before confirming import.'}
                </p>
              </div>

              {validationResult.canImport && (
                <button
                  onClick={triggerConfirmImport}
                  disabled={importing}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-lg"
                >
                  {importing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                  <span>{importing ? 'Importing Competitors...' : 'Confirm & Import Competitors'}</span>
                </button>
              )}
            </div>

            {/* Validation Summary Metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-xs">
              <div className="bg-zinc-900/80 p-2.5 rounded-lg border border-zinc-800">
                <div className="text-zinc-500 text-[10px]">Total Competitors</div>
                <div className="font-bold text-blue-400 text-sm mt-0.5">{validationResult.stats.totalParticipants}</div>
              </div>
              <div className="bg-zinc-900/80 p-2.5 rounded-lg border border-zinc-800">
                <div className="text-zinc-500 text-[10px]">New Competitors</div>
                <div className="font-bold text-emerald-400 text-sm mt-0.5">{validationResult.stats.newParticipants}</div>
              </div>
              <div className="bg-zinc-900/80 p-2.5 rounded-lg border border-zinc-800">
                <div className="text-zinc-500 text-[10px]">Unchanged</div>
                <div className="font-bold text-zinc-400 text-sm mt-0.5">{validationResult.stats.unchangedParticipants}</div>
              </div>
              <div className="bg-zinc-900/80 p-2.5 rounded-lg border border-zinc-800">
                <div className="text-zinc-500 text-[10px]">Updated</div>
                <div className="font-bold text-amber-400 text-sm mt-0.5">{validationResult.stats.updatedParticipants}</div>
              </div>
              <div className="bg-zinc-900/80 p-2.5 rounded-lg border border-zinc-800">
                <div className="text-zinc-500 text-[10px]">Conflicts</div>
                <div className="font-bold text-rose-400 text-sm mt-0.5">{validationResult.stats.conflictParticipants}</div>
              </div>
            </div>

            {/* Validation Errors Box */}
            {validationResult.errors.length > 0 && (
              <div className="p-3.5 rounded-lg bg-rose-950/30 border border-rose-800/60 text-xs space-y-1.5">
                <div className="font-bold text-rose-400 flex items-center gap-1.5">
                  <XCircle className="w-4 h-4" />
                  <span>Blocking Errors ({validationResult.errors.length}):</span>
                </div>
                <ul className="list-disc list-inside space-y-1 text-rose-300">
                  {validationResult.errors.map((err, idx) => (
                    <li key={idx}>
                      {err.row ? <strong className="text-rose-200">Row {err.row}: </strong> : null}
                      {err.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Validation Warnings Box */}
            {validationResult.warnings.length > 0 && (
              <div className="p-3.5 rounded-lg bg-amber-950/20 border border-amber-800/50 text-xs space-y-1.5">
                <div className="font-bold text-amber-400 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4" />
                  <span>Notices & Warnings ({validationResult.warnings.length}):</span>
                </div>
                <ul className="list-disc list-inside space-y-1 text-amber-300/90">
                  {validationResult.warnings.map((warn, idx) => (
                    <li key={idx}>
                      {warn.row ? <strong className="text-amber-200">Row {warn.row}: </strong> : null}
                      {warn.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Preview Table for Individual Participants */}
            {validationResult.participants && validationResult.participants.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                  <UserCheck className="w-3.5 h-3.5 text-blue-400" />
                  Parsed Competitors Preview ({validationResult.participants.length})
                </h4>
                <div className="border border-zinc-800 rounded-lg overflow-x-auto max-h-72 overflow-y-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="sticky top-0 bg-zinc-900 border-b border-zinc-800 text-zinc-400 font-semibold uppercase">
                      <tr>
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-3">Competitor Name</th>
                        <th className="py-2.5 px-3">Participant Code</th>
                        <th className="py-2.5 px-3">College / Institution</th>
                        <th className="py-2.5 px-3">Email</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60 bg-zinc-950">
                      {validationResult.participants.map((p, idx) => (
                        <tr key={idx} className="hover:bg-zinc-900/40">
                          <td className="py-2.5 px-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                p.status === 'NEW'
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                                  : p.status === 'UNCHANGED'
                                  ? 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                                  : p.status === 'UPDATED'
                                  ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                                  : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                              }`}
                            >
                              {p.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 font-bold text-zinc-200">{p.name}</td>
                          <td className="py-2.5 px-3 text-purple-400 font-mono font-semibold">{p.participantCode}</td>
                          <td className="py-2.5 px-3 text-zinc-400">{p.college || '—'}</td>
                          <td className="py-2.5 px-3 text-zinc-400">{p.email || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* SECTION 3: PARTICIPANT SURVEILLANCE & REGISTRATION MANAGEMENT DIRECTORY */}
      <div className="space-y-4">
        {/* Action feedback banners */}
        {actionSuccess && (
          <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{actionSuccess}</span>
            </div>
            <button
              onClick={() => setActionSuccess(null)}
              className="text-emerald-400 hover:text-emerald-200 font-bold ml-3 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {actionError && !removeModalParticipant && !reactivateModalParticipant && (
          <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{actionError}</span>
            </div>
            <button
              onClick={() => setActionError(null)}
              className="text-rose-400 hover:text-rose-200 font-bold ml-3 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {/* Surveillance Header & Filters */}
        <div className="bg-zinc-950/80 border border-zinc-800 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
              <Radio className="w-4 h-4 text-purple-400" />
              Live Solo Competitor Directory
            </h3>
            <p className="text-xs text-zinc-400 mt-1">
              Real-time telemetry and participant registration management. Last synced: {lastRefreshed.toLocaleTimeString()}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Status Filter Pills: Active / Inactive / All */}
            <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 p-1 rounded-lg">
              <button
                type="button"
                onClick={() => setStatusFilter('ACTIVE')}
                className={`px-3 py-1 rounded text-xs font-semibold transition-colors cursor-pointer ${
                  statusFilter === 'ACTIVE'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Active ({activeCount})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('INACTIVE')}
                className={`px-3 py-1 rounded text-xs font-semibold transition-colors cursor-pointer ${
                  statusFilter === 'INACTIVE'
                    ? 'bg-rose-600/80 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Removed / Inactive ({inactiveCount})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('ALL')}
                className={`px-3 py-1 rounded text-xs font-semibold transition-colors cursor-pointer ${
                  statusFilter === 'ALL'
                    ? 'bg-zinc-700 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                All ({totalCount})
              </button>
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search name, code, email..."
                className="bg-zinc-900 border border-zinc-700/80 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <button
              onClick={() => {
                fetchParticipants();
                fetchStats();
              }}
              className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/70 rounded-lg text-xs text-zinc-300 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Sync</span>
            </button>
          </div>
        </div>

        {/* Participants Table */}
        <div className="bg-zinc-950/90 border border-zinc-800 rounded-xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-zinc-900/80 text-zinc-400 border-b border-zinc-800 font-semibold uppercase tracking-wider">
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Competitor Name</th>
                  <th className="py-3 px-4">Participant Code</th>
                  <th className="py-3 px-4">Email</th>
                  <th className="py-3 px-4">College / Institution</th>
                  <th className="py-3 px-4">Connection</th>
                  <th className="py-3 px-4">Last Telemetry</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-zinc-500">
                      {loadingParticipants
                        ? 'Loading competitors from database...'
                        : `No ${statusFilter === 'ALL' ? '' : statusFilter.toLowerCase() + ' '}registered competitors found.`}
                    </td>
                  </tr>
                ) : (
                  filtered.map((p) => {
                    const isConnected = p.connectionStatus === 'CONNECTED';
                    const isActive = p.status === 'ACTIVE' || !p.status;
                    return (
                      <tr key={p.id} className="hover:bg-zinc-900/40 transition-colors">
                        <td className="py-3 px-4">
                          {isActive ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                              ACTIVE
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/30">
                              REMOVED
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 font-bold text-zinc-200">{p.name}</td>
                        <td className="py-3 px-4 text-purple-400 font-mono font-semibold">{p.participantCode || p.id.slice(0, 8)}</td>
                        <td className="py-3 px-4 text-zinc-400">{p.email || '—'}</td>
                        <td className="py-3 px-4 text-zinc-400">{p.college || '—'}</td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-bold ${
                              isConnected
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                                : 'bg-zinc-800/80 text-zinc-400 border border-zinc-700'
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                isConnected ? 'bg-emerald-400 animate-ping' : 'bg-zinc-500'
                              }`}
                            />
                            {p.connectionStatus}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-zinc-400">
                          {p.lastActivity ? new Date(p.lastActivity).toLocaleTimeString() : 'Never'}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {isActive ? (
                            <button
                              type="button"
                              onClick={() => {
                                setRemoveModalParticipant(p);
                                setRemoveReason('');
                                setActionError(null);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-semibold transition-colors cursor-pointer"
                              title="Remove Participant from competition"
                            >
                              <UserMinus className="w-3 h-3" />
                              <span>Remove</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setReactivateModalParticipant(p);
                                setActionError(null);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-semibold transition-colors cursor-pointer"
                              title="Reactivate Participant"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>Reactivate</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* MODAL: REMOVE PARTICIPANT CONFIRMATION */}
      {removeModalParticipant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 shrink-0">
                <UserMinus className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-zinc-100">Remove Participant?</h3>
                <p className="text-xs text-zinc-400 mt-1">
                  This will remove the participant from the active registration list and prevent them from participating.
                </p>
              </div>
            </div>

            <div className="bg-zinc-900/80 border border-zinc-800 rounded-lg p-3 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-zinc-500">Participant:</span>
                <span className="font-bold text-zinc-200">{removeModalParticipant.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Code:</span>
                <span className="font-mono text-purple-400 font-semibold">{removeModalParticipant.participantCode || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Email:</span>
                <span className="text-zinc-300">{removeModalParticipant.email || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">College:</span>
                <span className="text-zinc-300">{removeModalParticipant.college || '—'}</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-300">Reason (optional):</label>
              <input
                type="text"
                value={removeReason}
                onChange={(e) => setRemoveReason(e.target.value)}
                placeholder="e.g. Duplicate registration, incorrectly imported"
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-rose-500"
              />
            </div>

            {actionError && (
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{actionError}</span>
              </div>
            )}

            {regStats?.registrationLocked && (
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Warning: Competition is {regStats.eventStatus}. Removals are restricted to NOT_STARTED state.</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setRemoveModalParticipant(null);
                  setRemoveReason('');
                  setActionError(null);
                }}
                disabled={removing}
                className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded-lg text-xs font-semibold text-zinc-300 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRemoveParticipant}
                disabled={removing || regStats?.registrationLocked}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg flex items-center gap-2 transition-colors cursor-pointer shadow-lg shadow-rose-900/30"
              >
                {removing ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Removing...</span>
                  </>
                ) : (
                  <>
                    <UserMinus className="w-3.5 h-3.5" />
                    <span>Remove Participant</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: REACTIVATE PARTICIPANT CONFIRMATION */}
      {reactivateModalParticipant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 shrink-0">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-zinc-100">Reactivate Participant?</h3>
                <p className="text-xs text-zinc-400 mt-1">
                  This will restore the participant to the active registration list and allow them to log in.
                </p>
              </div>
            </div>

            <div className="bg-zinc-900/80 border border-zinc-800 rounded-lg p-3 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-zinc-500">Participant:</span>
                <span className="font-bold text-zinc-200">{reactivateModalParticipant.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Code:</span>
                <span className="font-mono text-purple-400 font-semibold">{reactivateModalParticipant.participantCode || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Email:</span>
                <span className="text-zinc-300">{reactivateModalParticipant.email || '—'}</span>
              </div>
            </div>

            {actionError && (
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{actionError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setReactivateModalParticipant(null);
                  setActionError(null);
                }}
                disabled={reactivating}
                className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded-lg text-xs font-semibold text-zinc-300 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReactivateParticipant}
                disabled={reactivating}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg flex items-center gap-2 transition-colors cursor-pointer shadow-lg shadow-emerald-900/30"
              >
                {reactivating ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Reactivating...</span>
                  </>
                ) : (
                  <>
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reactivate Participant</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
