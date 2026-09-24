import React, { useState, useEffect } from 'react';
import { adminFetch } from './adminFetch';
import {
  Play,
  Pause,
  StopCircle,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Shield,
  Loader2,
  AlertCircle,
  Info,
  History,
  Sparkles,
  Trophy,
  RefreshCw,
} from 'lucide-react';

interface EventStatusResponse {
  status: 'NOT_STARTED' | 'RUNNING' | 'PAUSED' | 'ENDED';
  durationMinutes: number;
  startedAt: string | null;
  pausedAt: string | null;
  endedAt: string | null;
  serverTimestamp: string;
  currentMatchNumber?: number;
}

interface MatchRecord {
  id: string;
  matchNumber: number;
  name: string;
  status: string;
  durationMinutes: number;
  startedAt: string | null;
  endedAt: string | null;
  finalLeaderboard?: any[];
  endedReason?: string | null;
  createdAt: string;
}

export const AdminEventControl: React.FC = () => {
  const [eventData, setEventData] = useState<EventStatusResponse | null>(null);
  const [currentMatchNumber, setCurrentMatchNumber] = useState<number>(1);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(3600);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [scheduledEndTime, setScheduledEndTime] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [preconditions, setPreconditions] = useState<any>(null);

  // Match History
  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [viewingLeaderboardMatch, setViewingLeaderboardMatch] = useState<MatchRecord | null>(null);

  // End Event Confirmation Modal State
  const [showEndModal, setShowEndModal] = useState(false);
  const [endConfirmationCheck, setEndConfirmationCheck] = useState(false);

  // New Match Modal State
  const [showNewMatchModal, setShowNewMatchModal] = useState(false);
  const [newMatchName, setNewMatchName] = useState('');
  const [newMatchDuration, setNewMatchDuration] = useState(60);
  const [newMatchConfirmationCheck, setNewMatchConfirmationCheck] = useState(false);

  const fetchMatches = async () => {
    try {
      const res = await adminFetch('/api/admin/matches');
      if (res.ok) {
        const data = await res.json();
        setMatches(data.matches || []);
      }
    } catch (err) {
      console.error('Failed to load matches list:', err);
    }
  };

  const fetchStatus = async () => {
    try {
      const [statusRes, precheckRes, eventStatusRes] = await Promise.all([
        adminFetch('/api/admin/dashboard'),
        adminFetch('/api/admin/event/preconditions').catch(() => null),
        fetch('/api/event/status').catch(() => null),
      ]);

      if (statusRes.ok) {
        const data = await statusRes.json();
        setEventData({
          status: data.metrics.eventStatus,
          durationMinutes: data.metrics.durationMinutes || 60,
          startedAt: data.metrics.startedAt,
          pausedAt: data.metrics.pausedAt,
          endedAt: data.metrics.endedAt,
          serverTimestamp: new Date().toISOString(),
          currentMatchNumber: data.metrics.currentMatchNumber || 1,
        });
        if (data.metrics.currentMatchNumber) {
          setCurrentMatchNumber(data.metrics.currentMatchNumber);
        }
      }

      if (eventStatusRes && eventStatusRes.ok) {
        const timerData = await eventStatusRes.json();
        if (typeof timerData.remainingSeconds === 'number') {
          setRemainingSeconds(Math.max(0, timerData.remainingSeconds));
        }
        if (typeof timerData.elapsedSeconds === 'number') {
          setElapsedSeconds(timerData.elapsedSeconds);
        }
        if (timerData.scheduledEndTime) {
          setScheduledEndTime(timerData.scheduledEndTime);
        }
        if (timerData.currentMatchNumber) {
          setCurrentMatchNumber(timerData.currentMatchNumber);
        }
      }

      if (precheckRes && precheckRes.ok) {
        const pData = await precheckRes.json();
        setPreconditions(pData.preconditions);
      }
    } catch (err: any) {
      console.error('Failed to load event control data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchMatches();
    const interval = setInterval(() => {
      fetchStatus();
      fetchMatches();
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  // Real-time authoritative timer tick down during RUNNING
  useEffect(() => {
    if (eventData?.status !== 'RUNNING') return;

    const tick = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          fetchStatus();
          return 0;
        }
        return prev - 1;
      });
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(tick);
  }, [eventData?.status]);

  const formatTime = (secs: number) => {
    const clamped = Math.max(0, secs);
    const mins = Math.floor(clamped / 60);
    const s = clamped % 60;
    return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleStart = async () => {
    setActionInProgress(true);
    setActionMessage(null);
    try {
      const res = await adminFetch('/api/admin/event/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Organizer triggered event start' }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionMessage({ type: 'error', text: data.error || 'Failed to start event' });
      } else {
        setActionMessage({ type: 'success', text: `Match #${currentMatchNumber} started! Arena unlocked.` });
        await fetchStatus();
        await fetchMatches();
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: 'Network failure during event start' });
    } finally {
      setActionInProgress(false);
    }
  };

  const handlePause = async () => {
    setActionInProgress(true);
    setActionMessage(null);
    try {
      const res = await adminFetch('/api/admin/event/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Organizer paused competition' }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionMessage({ type: 'error', text: data.error || 'Failed to pause event' });
      } else {
        setActionMessage({ type: 'success', text: 'Event PAUSED. Submissions temporarily suspended.' });
        await fetchStatus();
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: 'Network failure during event pause' });
    } finally {
      setActionInProgress(false);
    }
  };

  const handleResume = async () => {
    setActionInProgress(true);
    setActionMessage(null);
    try {
      const res = await adminFetch('/api/admin/event/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Organizer resumed competition' }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionMessage({ type: 'error', text: data.error || 'Failed to resume event' });
      } else {
        setActionMessage({ type: 'success', text: 'Event RESUMED. Clock and submissions reactivated.' });
        await fetchStatus();
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: 'Network failure during event resume' });
    } finally {
      setActionInProgress(false);
    }
  };

  const handleConfirmEnd = async () => {
    if (!endConfirmationCheck) return;
    setActionInProgress(true);
    setActionMessage(null);
    setShowEndModal(false);
    try {
      const res = await adminFetch('/api/admin/event/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, reason: 'Organizer officially concluded event' }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionMessage({ type: 'error', text: data.error || 'Failed to end event' });
      } else {
        setActionMessage({ type: 'success', text: `Match #${currentMatchNumber} permanently ENDED. Final results archived.` });
        await fetchStatus();
        await fetchMatches();
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: 'Network failure during event end' });
    } finally {
      setActionInProgress(false);
      setEndConfirmationCheck(false);
    }
  };

  const handleCreateNewMatch = async () => {
    if (!newMatchConfirmationCheck) return;
    setActionInProgress(true);
    setActionMessage(null);
    setShowNewMatchModal(false);
    try {
      const res = await adminFetch('/api/admin/event/new-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirm: true,
          matchName: newMatchName.trim() || undefined,
          durationMinutes: newMatchDuration || 60,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionMessage({ type: 'error', text: data.error || 'Failed to initialize new match' });
      } else {
        setActionMessage({
          type: 'success',
          text: `Match #${data.match.matchNumber} created! State reset to NOT_STARTED with fresh 60:00 timer. Previous match archived.`,
        });
        await fetchStatus();
        await fetchMatches();
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: 'Network failure during new match creation' });
    } finally {
      setActionInProgress(false);
      setNewMatchConfirmationCheck(false);
      setNewMatchName('');
    }
  };

  const currentStatus = eventData?.status || 'NOT_STARTED';

  // Rule constraints
  const canStart = currentStatus === 'NOT_STARTED';
  const canPause = currentStatus === 'RUNNING';
  const canResume = currentStatus === 'PAUSED';
  const canEnd = currentStatus === 'RUNNING' || currentStatus === 'PAUSED';
  const isEnded = currentStatus === 'ENDED';

  return (
    <div id="admin-event-control-view" className="space-y-6 font-mono">
      {/* State Overview Deck */}
      <div className="bg-zinc-950/90 border border-zinc-800 rounded-xl p-6 relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-800 pb-5">
          <div>
            <div className="flex items-center gap-2 text-xs text-zinc-400 mb-1.5 uppercase tracking-wider font-semibold">
              <Shield className="w-4 h-4 text-blue-400" />
              <span>Authoritative State Deck &bull; Active Round: <strong className="text-cyan-400">Match #{currentMatchNumber}</strong></span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xl font-bold text-zinc-100">
                Current Status:
              </span>
              <span
                id="admin-active-status-badge"
                className={`text-sm px-3 py-1 rounded-md font-bold tracking-wide ${
                  currentStatus === 'RUNNING'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 animate-pulse'
                    : currentStatus === 'PAUSED'
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                    : currentStatus === 'ENDED'
                    ? 'bg-zinc-800 text-zinc-300 border border-zinc-700'
                    : 'bg-blue-500/20 text-blue-400 border border-blue-500/40'
                }`}
              >
                {currentStatus}
              </span>
              <span className="text-xs px-2.5 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-zinc-400">
                Match #{currentMatchNumber}
              </span>
            </div>
          </div>

          <div className="text-right text-xs space-y-1 text-zinc-400">
            <div>
              Competition Duration: <strong className="text-zinc-200">60 Minutes</strong>
            </div>
            <div>
              Platform Mode: <strong className="text-emerald-400">PostgreSQL / PGlite</strong>
            </div>
          </div>
        </div>

        {/* Timestamps Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-5 text-xs">
          <div className="p-3 bg-zinc-900/70 border border-zinc-800/80 rounded-lg">
            <span className="text-zinc-500 block mb-1">Started At</span>
            <span className="text-zinc-200 font-semibold">
              {eventData?.startedAt ? new Date(eventData.startedAt).toLocaleTimeString() : 'Not Yet Started'}
            </span>
          </div>
          <div className="p-3 bg-zinc-900/70 border border-zinc-800/80 rounded-lg">
            <span className="text-zinc-500 block mb-1">Paused At</span>
            <span className="text-zinc-200 font-semibold">
              {eventData?.pausedAt ? new Date(eventData.pausedAt).toLocaleTimeString() : 'None'}
            </span>
          </div>
          <div className="p-3 bg-zinc-900/70 border border-zinc-800/80 rounded-lg">
            <span className="text-zinc-500 block mb-1">Ended At</span>
            <span className="text-zinc-200 font-semibold">
              {eventData?.endedAt ? new Date(eventData.endedAt).toLocaleTimeString() : 'In Progress / Open'}
            </span>
          </div>
          <div className="p-3 bg-zinc-900/70 border border-zinc-800/80 rounded-lg">
            <span className="text-zinc-500 block mb-1">Server Clock</span>
            <span className="text-zinc-400 font-semibold">
              {new Date().toLocaleTimeString()}
            </span>
          </div>
        </div>

        {/* Authoritative Competition Timer Card */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-5 mt-5 border-t border-zinc-800/80">
          <div className="p-4 bg-zinc-900/90 border border-zinc-800 rounded-xl">
            <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
              <span>TIME REMAINING</span>
              <Clock
                className={`w-4 h-4 ${
                  currentStatus === 'RUNNING'
                    ? 'text-emerald-400 animate-pulse'
                    : currentStatus === 'PAUSED'
                    ? 'text-amber-400'
                    : 'text-zinc-500'
                }`}
              />
            </div>
            <div
              id="admin-timer-remaining-display"
              className={`text-3xl font-black tracking-wider ${
                currentStatus === 'RUNNING'
                  ? 'text-emerald-400'
                  : currentStatus === 'PAUSED'
                  ? 'text-amber-400'
                  : currentStatus === 'ENDED'
                  ? 'text-zinc-500'
                  : 'text-zinc-200'
              }`}
            >
              {formatTime(remainingSeconds)}
            </div>
            <div className="text-[11px] text-zinc-500 mt-1">
              {currentStatus === 'RUNNING'
                ? 'Official 60-minute clock active'
                : currentStatus === 'PAUSED'
                ? 'Clock frozen at pause timestamp'
                : currentStatus === 'ENDED'
                ? 'Match concluded. Standings archived.'
                : 'Standard 60:00 duration allocated'}
            </div>
          </div>

          <div className="p-4 bg-zinc-900/90 border border-zinc-800 rounded-xl">
            <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
              <span>ACTIVE ELAPSED TIME</span>
              <RotateCcw className="w-3.5 h-3.5 text-zinc-500" />
            </div>
            <div id="admin-timer-elapsed-display" className="text-3xl font-black text-zinc-200 tracking-wider">
              {formatTime(elapsedSeconds)}
            </div>
            <div className="text-[11px] text-zinc-500 mt-1">
              Total active elapsed time for Match #{currentMatchNumber}
            </div>
          </div>

          <div className="p-4 bg-zinc-900/90 border border-zinc-800 rounded-xl">
            <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
              <span>SCHEDULED CONCLUSION</span>
              <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />
            </div>
            <div className="text-xl font-bold text-zinc-200 mt-1">
              {scheduledEndTime
                ? new Date(scheduledEndTime).toLocaleTimeString()
                : eventData?.endedAt
                ? new Date(eventData.endedAt).toLocaleTimeString()
                : 'Calculated on Start'}
            </div>
            <div className="text-[11px] text-zinc-500 mt-2">
              Authoritative automatic end time (auto-extends during pauses)
            </div>
          </div>
        </div>
      </div>

      {actionMessage && (
        <div
          className={`p-3 rounded-lg border text-xs flex items-center gap-2 ${
            actionMessage.type === 'success'
              ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
              : 'bg-red-950/30 border-red-500/30 text-red-300'
          }`}
        >
          {actionMessage.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          )}
          <span>{actionMessage.text}</span>
        </div>
      )}

      {/* Primary Action Controls Deck */}
      <div className="bg-zinc-950/90 border border-zinc-800 rounded-xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div>
            <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-400" />
              Event Lifecycle Directives &bull; Active: Match #{currentMatchNumber}
            </h3>
            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
              Authoritative state transitions apply immediately. State changes trigger database transaction locks and immutable audit log entries.
            </p>
          </div>

          {/* New Match trigger button (available when ENDED) */}
          {isEnded && (
            <button
              id="admin-btn-header-new-match"
              onClick={() => {
                setNewMatchName(`Match ${currentMatchNumber + 1}`);
                setShowNewMatchModal(true);
              }}
              className="px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold text-xs rounded-lg flex items-center gap-2 shadow-lg shadow-cyan-950/60 transition-all cursor-pointer shrink-0 animate-bounce"
            >
              <Sparkles className="w-4 h-4" />
              <span>START NEW MATCH (#{currentMatchNumber + 1})</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* START EVENT */}
          <button
            id="admin-btn-start-event"
            onClick={handleStart}
            disabled={!canStart || actionInProgress}
            className={`p-4 rounded-xl border flex flex-col items-center text-center justify-between gap-3 transition-all cursor-pointer ${
              canStart
                ? 'bg-emerald-950/30 hover:bg-emerald-900/40 border-emerald-500/40 text-emerald-300 shadow-lg shadow-emerald-950/50 hover:border-emerald-400'
                : 'bg-zinc-900/40 border-zinc-800 text-zinc-600 cursor-not-allowed opacity-50'
            }`}
          >
            <div className="w-10 h-10 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
              <Play className="w-5 h-5 text-emerald-400 fill-emerald-400/20" />
            </div>
            <div>
              <div className="font-bold text-xs uppercase tracking-wider">Start Competition</div>
              <div className="text-[11px] text-zinc-400 mt-1">Starts 60-min timer &amp; unlocks arena</div>
            </div>
            <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded bg-zinc-900 border border-zinc-700">
              {canStart ? 'READY TO START' : 'DISABLED'}
            </span>
          </button>

          {/* PAUSE EVENT */}
          <button
            id="admin-btn-pause-event"
            onClick={handlePause}
            disabled={!canPause || actionInProgress}
            className={`p-4 rounded-xl border flex flex-col items-center text-center justify-between gap-3 transition-all cursor-pointer ${
              canPause
                ? 'bg-amber-950/30 hover:bg-amber-900/40 border-amber-500/40 text-amber-300 shadow-lg shadow-amber-950/50 hover:border-amber-400'
                : 'bg-zinc-900/40 border-zinc-800 text-zinc-600 cursor-not-allowed opacity-50'
            }`}
          >
            <div className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
              <Pause className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <div className="font-bold text-xs uppercase tracking-wider">Pause Competition</div>
              <div className="text-[11px] text-zinc-400 mt-1">Suspends submissions &amp; pauses timer</div>
            </div>
            <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded bg-zinc-900 border border-zinc-700">
              {canPause ? 'ACTIVE (CLICK TO PAUSE)' : 'DISABLED'}
            </span>
          </button>

          {/* RESUME EVENT */}
          <button
            id="admin-btn-resume-event"
            onClick={handleResume}
            disabled={!canResume || actionInProgress}
            className={`p-4 rounded-xl border flex flex-col items-center text-center justify-between gap-3 transition-all cursor-pointer ${
              canResume
                ? 'bg-blue-950/30 hover:bg-blue-900/40 border-blue-500/40 text-blue-300 shadow-lg shadow-blue-950/50 hover:border-blue-400 animate-pulse'
                : 'bg-zinc-900/40 border-zinc-800 text-zinc-600 cursor-not-allowed opacity-50'
            }`}
          >
            <div className="w-10 h-10 rounded-full bg-blue-500/10 border border-blue-500/30 flex items-center justify-center">
              <RotateCcw className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <div className="font-bold text-xs uppercase tracking-wider">Resume Competition</div>
              <div className="text-[11px] text-zinc-400 mt-1">Unpauses CTF &amp; restores submissions</div>
            </div>
            <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded bg-zinc-900 border border-zinc-700">
              {canResume ? 'PAUSED (CLICK TO RESUME)' : 'DISABLED'}
            </span>
          </button>

          {/* END EVENT OR NEW MATCH */}
          {isEnded ? (
            <button
              id="admin-btn-new-match"
              onClick={() => {
                setNewMatchName(`Match ${currentMatchNumber + 1}`);
                setShowNewMatchModal(true);
              }}
              disabled={actionInProgress}
              className="p-4 rounded-xl border flex flex-col items-center text-center justify-between gap-3 transition-all cursor-pointer bg-cyan-950/40 hover:bg-cyan-900/50 border-cyan-500/50 text-cyan-300 shadow-lg shadow-cyan-950/60 hover:border-cyan-400"
            >
              <div className="w-10 h-10 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-cyan-400" />
              </div>
              <div>
                <div className="font-bold text-xs uppercase tracking-wider text-cyan-300">Prepare New Match</div>
                <div className="text-[11px] text-zinc-400 mt-1">Advance to Match #{currentMatchNumber + 1}</div>
              </div>
              <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded bg-cyan-950 border border-cyan-700 text-cyan-300 font-semibold">
                READY FOR MATCH #{currentMatchNumber + 1}
              </span>
            </button>
          ) : (
            <button
              id="admin-btn-end-event"
              onClick={() => setShowEndModal(true)}
              disabled={!canEnd || actionInProgress}
              className={`p-4 rounded-xl border flex flex-col items-center text-center justify-between gap-3 transition-all cursor-pointer ${
                canEnd
                  ? 'bg-red-950/40 hover:bg-red-900/50 border-red-500/50 text-red-300 shadow-lg shadow-red-950/60 hover:border-red-400'
                  : 'bg-zinc-900/40 border-zinc-800 text-zinc-600 cursor-not-allowed opacity-50'
              }`}
            >
              <div className="w-10 h-10 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center">
                <StopCircle className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <div className="font-bold text-xs uppercase tracking-wider text-red-400">End Competition</div>
                <div className="text-[11px] text-zinc-400 mt-1">Permanently concludes 60-min CTF</div>
              </div>
              <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-red-400 font-semibold">
                {canEnd ? 'DESTRUCTIVE' : 'DISABLED'}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Match History / Multi-Match Archive Panel */}
      <div className="bg-zinc-950/90 border border-zinc-800 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-xs font-bold text-zinc-300 uppercase tracking-wider">
            <History className="w-4 h-4 text-cyan-400" />
            <span>Match History &amp; Archived Competitions ({matches.length})</span>
          </div>
          <button
            onClick={() => fetchMatches()}
            className="text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
        </div>

        {matches.length === 0 ? (
          <div className="text-xs text-zinc-500 italic p-4 text-center border border-zinc-900 rounded-lg">
            No matches recorded yet. Match 1 will be archived once concluded.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-400">
                  <th className="pb-2 font-semibold">Match</th>
                  <th className="pb-2 font-semibold">Name</th>
                  <th className="pb-2 font-semibold">Status</th>
                  <th className="pb-2 font-semibold">Duration</th>
                  <th className="pb-2 font-semibold">Started At</th>
                  <th className="pb-2 font-semibold">Ended At</th>
                  <th className="pb-2 font-semibold text-right">Archived Results</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900">
                {matches.map((m) => (
                  <tr key={m.id} className="hover:bg-zinc-900/40">
                    <td className="py-2.5 font-bold text-zinc-200">
                      #{m.matchNumber} {m.matchNumber === currentMatchNumber && (
                        <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-cyan-950 border border-cyan-800 text-cyan-300">
                          Active
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 text-zinc-300">{m.name}</td>
                    <td className="py-2.5">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        m.status === 'RUNNING'
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : m.status === 'PAUSED'
                          ? 'bg-amber-950 text-amber-400 border border-amber-800'
                          : m.status === 'ENDED'
                          ? 'bg-zinc-900 text-zinc-400 border border-zinc-800'
                          : 'bg-blue-950 text-blue-400 border border-blue-800'
                      }`}>
                        {m.status}
                      </span>
                    </td>
                    <td className="py-2.5 text-zinc-400">{m.durationMinutes}m</td>
                    <td className="py-2.5 text-zinc-400">
                      {m.startedAt ? new Date(m.startedAt).toLocaleTimeString() : '-'}
                    </td>
                    <td className="py-2.5 text-zinc-400">
                      {m.endedAt ? new Date(m.endedAt).toLocaleTimeString() : '-'}
                    </td>
                    <td className="py-2.5 text-right">
                      {m.finalLeaderboard && Array.isArray(m.finalLeaderboard) && m.finalLeaderboard.length > 0 ? (
                        <button
                          onClick={() => setViewingLeaderboardMatch(m)}
                          className="px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 rounded text-[11px] inline-flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          <Trophy className="w-3 h-3 text-amber-400" />
                          <span>View Standings ({m.finalLeaderboard.length})</span>
                        </button>
                      ) : (
                        <span className="text-zinc-600 text-[11px]">No snapshot</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Preconditions Information Box */}
      {preconditions && (
        <div className="bg-zinc-950/70 border border-zinc-800/80 rounded-xl p-5">
          <div className="flex items-center gap-2 text-xs font-semibold text-zinc-300 mb-3">
            <Info className="w-4 h-4 text-blue-400" />
            <span>Start Preconditions Status Check</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div className="p-2.5 rounded bg-zinc-900/60 border border-zinc-800">
              <span className="text-zinc-500 block">State Requirement</span>
              <span className={preconditions.currentStatus === 'NOT_STARTED' ? 'text-emerald-400 font-bold' : 'text-amber-400'}>
                {preconditions.currentStatus}
              </span>
            </div>
            <div className="p-2.5 rounded bg-zinc-900/60 border border-zinc-800">
              <span className="text-zinc-500 block">Registered Competitors</span>
              <span className={((preconditions as any).activeParticipantCount ?? preconditions.activeTeamCount) > 0 ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                {((preconditions as any).activeParticipantCount ?? preconditions.activeTeamCount)} participants ready
              </span>
            </div>
            <div className="p-2.5 rounded bg-zinc-900/60 border border-zinc-800">
              <span className="text-zinc-500 block">Challenges Configured</span>
              <span className={preconditions.challengeCount > 0 ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                {preconditions.challengeCount} challenges
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Red Alert Modal for END EVENT */}
      {showEndModal && (
        <div
          id="admin-end-event-modal"
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="bg-zinc-950 border-2 border-red-500/60 rounded-xl max-w-lg w-full p-6 shadow-2xl shadow-red-950/70 relative">
            <div className="flex items-center gap-3 text-red-400 mb-4">
              <div className="p-2.5 rounded-full bg-red-500/10 border border-red-500/30">
                <AlertTriangle className="w-6 h-6 text-red-500" />
              </div>
              <div>
                <h3 className="text-base font-bold text-zinc-100 uppercase tracking-wide">
                  Conclude Match #{currentMatchNumber}
                </h3>
                <span className="text-xs text-red-400 font-semibold">DESTRUCTIVE ORGANIZER ACTION</span>
              </div>
            </div>

            <div className="p-3.5 bg-red-950/40 border border-red-500/40 rounded-lg text-xs text-red-200 mb-4 leading-relaxed">
              <strong className="block text-red-300 font-bold mb-1">
                THIS ACTION CONCLUDES MATCH #{currentMatchNumber}.
              </strong>
              Submissions will be permanently locked for this match, and final rankings will be snapshotted. You can subsequently start Match #{currentMatchNumber + 1} with a clean state.
            </div>

            <div className="mb-6">
              <label className="flex items-start gap-2.5 cursor-pointer text-xs text-zinc-300 select-none">
                <input
                  id="admin-end-confirm-checkbox"
                  type="checkbox"
                  checked={endConfirmationCheck}
                  onChange={(e) => setEndConfirmationCheck(e.target.checked)}
                  className="mt-0.5 rounded bg-zinc-900 border-zinc-700 text-red-500 focus:ring-red-500"
                />
                <span>
                  I confirm concluding Match #{currentMatchNumber} and archiving its final leaderboard.
                </span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-800">
              <button
                onClick={() => {
                  setShowEndModal(false);
                  setEndConfirmationCheck(false);
                }}
                disabled={actionInProgress}
                className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded-lg text-xs transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                id="admin-btn-confirm-end-submit"
                onClick={handleConfirmEnd}
                disabled={!endConfirmationCheck || actionInProgress}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold rounded-lg text-xs flex items-center gap-2 transition-colors shadow-lg shadow-red-950/50 cursor-pointer"
              >
                {actionInProgress ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Ending Competition...</span>
                  </>
                ) : (
                  <span>Officially Conclude CTF</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NEW MATCH Confirmation Modal */}
      {showNewMatchModal && (
        <div
          id="admin-new-match-modal"
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="bg-zinc-950 border-2 border-cyan-500/60 rounded-xl max-w-lg w-full p-6 shadow-2xl shadow-cyan-950/70 relative font-mono">
            <div className="flex items-center gap-3 text-cyan-400 mb-4">
              <div className="p-2.5 rounded-full bg-cyan-500/10 border border-cyan-500/30">
                <Sparkles className="w-6 h-6 text-cyan-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-zinc-100 uppercase tracking-wide">
                  Initialize Match #{currentMatchNumber + 1}
                </h3>
                <span className="text-xs text-cyan-400 font-semibold">NEW COMPETITION ROUND WORKFLOW</span>
              </div>
            </div>

            <div className="p-3.5 bg-cyan-950/30 border border-cyan-500/30 rounded-lg text-xs text-cyan-200 mb-4 leading-relaxed space-y-3">
              <div>
                <span className="font-bold text-amber-400 block mb-1">WHAT WILL RESET (New Match Run):</span>
                <ul className="list-disc list-inside space-y-0.5 text-zinc-300">
                  <li><strong>Timer:</strong> Resets to configured {newMatchDuration || 60}:00 duration in NOT_STARTED state</li>
                  <li><strong>Scores:</strong> Team scores reset to 0 for Match #{currentMatchNumber + 1}</li>
                  <li><strong>Solved Challenges:</strong> Solved counters and active completions reset to 0</li>
                  <li><strong>Progression:</strong> Difficulty unlocks reset to initial Easy tier</li>
                  <li><strong>Live Leaderboard:</strong> Clean board initialized for the new match</li>
                </ul>
              </div>
              <div className="border-t border-cyan-900/60 pt-2">
                <span className="font-bold text-emerald-400 block mb-1">WHAT WILL BE PRESERVED:</span>
                <ul className="list-disc list-inside space-y-0.5 text-zinc-300">
                  <li><strong>Registration:</strong> All participants remain registered (no re-import needed)</li>
                  <li><strong>Match History:</strong> Match #{currentMatchNumber} final standings and statistics archived</li>
                  <li><strong>Submissions &amp; Results:</strong> Previous code submissions, outputs, and flag attempts preserved</li>
                  <li><strong>Audit Logs:</strong> Complete immutable audit trail and security logs retained</li>
                </ul>
              </div>
            </div>

            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Match Name (Optional)</label>
                <input
                  id="admin-new-match-name-input"
                  type="text"
                  value={newMatchName}
                  onChange={(e) => setNewMatchName(e.target.value)}
                  placeholder={`Match ${currentMatchNumber + 1}`}
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-xs text-zinc-100 focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Duration (Minutes)</label>
                <input
                  id="admin-new-match-duration-input"
                  type="number"
                  min="5"
                  max="300"
                  value={newMatchDuration}
                  onChange={(e) => setNewMatchDuration(parseInt(e.target.value, 10) || 60)}
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-xs text-zinc-100 focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <label className="flex items-start gap-2.5 cursor-pointer text-xs text-zinc-300 select-none pt-2">
                <input
                  id="admin-new-match-confirm-checkbox"
                  type="checkbox"
                  checked={newMatchConfirmationCheck}
                  onChange={(e) => setNewMatchConfirmationCheck(e.target.checked)}
                  className="mt-0.5 rounded bg-zinc-900 border-zinc-700 text-cyan-500 focus:ring-cyan-500"
                />
                <span>
                  I confirm starting a new match run. The arena will reset to NOT_STARTED for all participants while past match data remains archived.
                </span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-800">
              <button
                onClick={() => {
                  setShowNewMatchModal(false);
                  setNewMatchConfirmationCheck(false);
                }}
                disabled={actionInProgress}
                className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded-lg text-xs transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                id="admin-btn-confirm-new-match-submit"
                onClick={handleCreateNewMatch}
                disabled={!newMatchConfirmationCheck || actionInProgress}
                className="px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50 text-white font-bold rounded-lg text-xs flex items-center gap-2 transition-colors shadow-lg shadow-cyan-950/50 cursor-pointer"
              >
                {actionInProgress ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Preparing Match #{currentMatchNumber + 1}...</span>
                  </>
                ) : (
                  <span>Create &amp; Ready Match #{currentMatchNumber + 1}</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Historical Leaderboard Modal */}
      {viewingLeaderboardMatch && (
        <div
          id="admin-match-leaderboard-modal"
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl max-w-2xl w-full p-6 shadow-2xl relative font-mono max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-4 mb-4">
              <div>
                <h3 className="text-base font-bold text-zinc-100 flex items-center gap-2">
                  <Trophy className="w-5 h-5 text-amber-400" />
                  <span>Archived Standings: {viewingLeaderboardMatch.name} (Match #{viewingLeaderboardMatch.matchNumber})</span>
                </h3>
                <span className="text-xs text-zinc-400">
                  Status: {viewingLeaderboardMatch.status} &bull; Concluded: {viewingLeaderboardMatch.endedAt ? new Date(viewingLeaderboardMatch.endedAt).toLocaleString() : 'N/A'}
                </span>
              </div>
              <button
                onClick={() => setViewingLeaderboardMatch(null)}
                className="text-zinc-400 hover:text-zinc-200 text-xs px-2.5 py-1 bg-zinc-900 border border-zinc-800 rounded cursor-pointer"
              >
                Close
              </button>
            </div>

            <div className="overflow-y-auto flex-1">
              {viewingLeaderboardMatch.finalLeaderboard && viewingLeaderboardMatch.finalLeaderboard.length > 0 ? (
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-zinc-800 text-zinc-400">
                      <th className="pb-2 font-semibold">Rank</th>
                      <th className="pb-2 font-semibold">Competitor</th>
                      <th className="pb-2 font-semibold text-center">Solves</th>
                      <th className="pb-2 font-semibold text-right">Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-900">
                    {viewingLeaderboardMatch.finalLeaderboard.map((t: any, idx: number) => (
                      <tr key={t.participantId || t.teamId || idx} className="hover:bg-zinc-900/40">
                        <td className="py-2.5 font-bold text-zinc-300">
                          {idx === 0 ? '🥇 1' : idx === 1 ? '🥈 2' : idx === 2 ? '🥉 3' : `#${idx + 1}`}
                        </td>
                        <td className="py-2.5 font-semibold text-zinc-100">{t.participantName || t.name || t.teamName}</td>
                        <td className="py-2.5 text-center text-zinc-300">{t.challengesSolved ?? t.solvedCount ?? 0}</td>
                        <td className="py-2.5 text-right font-bold text-emerald-400">{t.totalScore ?? 0} pts</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="p-8 text-center text-xs text-zinc-500">
                  No final standings recorded for this match.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
