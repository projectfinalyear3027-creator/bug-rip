import React, { useEffect, useState } from 'react';
import { adminFetch, getStoredAdminToken } from './adminFetch';
import {
  Activity,
  Users,
  Shield,
  Clock,
  Trophy,
  CheckCircle2,
  AlertCircle,
  Play,
  Pause,
  StopCircle,
  RefreshCw,
  Radio,
  ExternalLink,
} from 'lucide-react';

interface DashboardMetrics {
  eventStatus: 'NOT_STARTED' | 'RUNNING' | 'PAUSED' | 'ENDED';
  durationMinutes: number;
  startedAt: string | null;
  pausedAt: string | null;
  endedAt: string | null;
  registeredTeamsCount?: number;
  registeredParticipantsCount: number;
  connectedParticipantsCount: number;
  activeParticipantSessionsCount?: number;
  activeTeamSessionsCount?: number;
  problemsSolvedCount: number;
  currentLeader: string | null;
}

interface AdminDashboardProps {
  onNavigateTab: (tab: 'dashboard' | 'controls' | 'progression' | 'participants' | 'anticheat' | 'audit') => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ onNavigateTab }) => {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  const fetchMetrics = async () => {
    try {
      const res = await adminFetch('/api/admin/dashboard');
      if (!res.ok) {
        throw new Error(`Failed to load metrics: HTTP ${res.status}`);
      }
      const data = await res.json();
      setMetrics(data.metrics);
      setLastRefreshed(new Date());
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Error fetching real-time dashboard data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
    // Auto-refresh every 5 seconds fallback
    const interval = setInterval(fetchMetrics, 5000);

    let eventSource: EventSource | null = null;
    try {
      const token = getStoredAdminToken();
      const sseUrl = token ? `/api/admin/events?token=${encodeURIComponent(token)}` : '/api/admin/events';
      eventSource = new EventSource(sseUrl, { withCredentials: true });
      eventSource.addEventListener('admin.connection.changed', (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload && typeof payload.totalConnectedParticipants === 'number') {
            setMetrics((prev) =>
              prev
                ? {
                    ...prev,
                    connectedParticipantsCount: payload.totalConnectedParticipants,
                  }
                : prev
            );
          }
        } catch {}
        fetchMetrics();
      });
      eventSource.addEventListener('admin.metrics.updated', () => {
        fetchMetrics();
      });
      eventSource.addEventListener('admin.participant.deactivated', () => {
        fetchMetrics();
      });
      eventSource.addEventListener('admin.participant.reactivated', () => {
        fetchMetrics();
      });
      eventSource.addEventListener('event.status.changed', () => {
        fetchMetrics();
      });
    } catch {
      // Fallback handled by interval
    }

    return () => {
      clearInterval(interval);
      if (eventSource) {
        eventSource.close();
      }
    };
  }, []);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'RUNNING':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            RUNNING • 60-MIN CTF ACTIVE
          </span>
        );
      case 'PAUSED':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 font-bold">
            <Pause className="w-3.5 h-3.5" />
            PAUSED BY ORGANIZER
          </span>
        );
      case 'ENDED':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-zinc-500/10 border border-zinc-500/30 text-zinc-400 font-bold">
            <StopCircle className="w-3.5 h-3.5" />
            COMPETITION CONCLUDED
          </span>
        );
      case 'NOT_STARTED':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 font-bold">
            <Radio className="w-3.5 h-3.5 animate-pulse" />
            NOT STARTED (WAITING ROOM OPEN)
          </span>
        );
    }
  };

  // Calculate elapsed time if event has started
  const calculateTimerDisplay = () => {
    if (!metrics || !metrics.startedAt) {
      return { elapsedText: '00:00', remainingText: '60:00' };
    }
    const startMs = new Date(metrics.startedAt).getTime();
    const endMs = metrics.endedAt ? new Date(metrics.endedAt).getTime() : Date.now();
    const elapsedSeconds = Math.max(0, Math.floor((endMs - startMs) / 1000));
    const totalSeconds = (metrics.durationMinutes || 60) * 60;
    const remainingSeconds = Math.max(0, totalSeconds - elapsedSeconds);

    const formatMins = (secs: number) => {
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    };

    return {
      elapsedText: formatMins(elapsedSeconds),
      remainingText: formatMins(remainingSeconds),
    };
  };

  const timer = calculateTimerDisplay();

  return (
    <div id="admin-dashboard-view" className="space-y-6 font-mono">
      {/* Top Banner with Event Status & Quick Actions */}
      <div className="bg-zinc-950/80 border border-zinc-800 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-zinc-400 uppercase tracking-wider font-semibold">
              Live Competition State
            </span>
            <span className="text-zinc-600">•</span>
            <span className="text-xs text-zinc-500">
              Synced: {lastRefreshed.toLocaleTimeString()}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {metrics ? getStatusBadge(metrics.eventStatus) : <div className="h-6 w-32 bg-zinc-800 animate-pulse rounded" />}
            <span className="text-xs text-zinc-400">
              Standard Duration: <strong className="text-zinc-200">60 Minutes</strong>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => fetchMetrics()}
            className="px-3 py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/70 rounded-lg text-xs text-zinc-300 flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Refresh database metrics"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Sync</span>
          </button>
          <button
            onClick={() => onNavigateTab('controls')}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg text-xs flex items-center gap-1.5 transition-colors shadow-md shadow-blue-950/50 cursor-pointer"
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Event Controls</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-950/30 border border-red-500/30 rounded-lg text-xs text-red-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Primary KPI Grid (All backed by Real DB metrics) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Connected Participants */}
        <div
          onClick={() => onNavigateTab('participants')}
          className="bg-zinc-950/70 border border-zinc-800 hover:border-blue-500/50 rounded-xl p-4 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-2">
            <span className="uppercase tracking-wider">Connected Participants</span>
            <Users className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
          </div>
          <div className="text-2xl font-bold text-zinc-100 flex items-baseline gap-1.5">
            <span>{metrics ? metrics.connectedParticipantsCount : '--'}</span>
            <span className="text-xs text-zinc-500 font-normal">
              / {metrics ? metrics.registeredParticipantsCount : '--'} registered
            </span>
          </div>
          <div className="text-[11px] text-zinc-400 mt-2 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
            <span>Active Heartbeat (&lt;3m)</span>
          </div>
        </div>

        {/* Registered Participants */}
        <div
          onClick={() => onNavigateTab('participants')}
          className="bg-zinc-950/70 border border-zinc-800 hover:border-blue-500/50 rounded-xl p-4 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-2">
            <span className="uppercase tracking-wider">Registered Participants</span>
            <Shield className="w-4 h-4 text-blue-400 group-hover:scale-110 transition-transform" />
          </div>
          <div className="text-2xl font-bold text-zinc-100 flex items-baseline gap-1.5">
            <span>{metrics ? metrics.registeredParticipantsCount : '--'}</span>
            <span className="text-xs text-zinc-500 font-normal">
              competitors in DB
            </span>
          </div>
          <div className="text-[11px] text-zinc-400 mt-2 flex items-center justify-between">
            <span>Active Sessions:</span>
            <strong className="text-blue-400">
              {metrics ? (metrics.activeParticipantSessionsCount ?? metrics.connectedParticipantsCount) : '--'}
            </strong>
          </div>
        </div>

        {/* CTF Clock / Time */}
        <div
          onClick={() => onNavigateTab('controls')}
          className="bg-zinc-950/70 border border-zinc-800 hover:border-blue-500/50 rounded-xl p-4 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-2">
            <span className="uppercase tracking-wider">CTF Clock</span>
            <Clock className="w-4 h-4 text-purple-400 group-hover:scale-110 transition-transform" />
          </div>
          <div className="text-2xl font-bold text-zinc-100 flex items-baseline gap-1.5">
            <span>{timer.remainingText}</span>
            <span className="text-xs text-zinc-500 font-normal">rem</span>
          </div>
          <div className="text-[11px] text-zinc-400 mt-2 flex items-center justify-between">
            <span>Elapsed:</span>
            <strong className="text-purple-300">{timer.elapsedText}</strong>
          </div>
        </div>

        {/* Problems Solved */}
        <div className="bg-zinc-950/70 border border-zinc-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-2">
            <span className="uppercase tracking-wider">Problems Solved</span>
            <Trophy className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-zinc-100">
            {metrics ? metrics.problemsSolvedCount : '--'}
          </div>
          <div className="text-[11px] text-zinc-400 mt-2 truncate">
            Leader: <strong className="text-amber-300">{metrics?.currentLeader || 'No solves yet'}</strong>
          </div>
        </div>
      </div>

      {/* Operational Highlights / Preconditions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Preconditions Checklist Card */}
        <div className="bg-zinc-950/80 border border-zinc-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <h3 className="text-xs font-bold text-zinc-200 uppercase tracking-wider">
                Event Preconditions & Integrity
              </h3>
            </div>
            <span className="text-[11px] text-zinc-500">Authoritative</span>
          </div>

          <div className="space-y-2.5 text-xs">
            <div className="flex items-center justify-between p-2 rounded bg-zinc-900/60 border border-zinc-800/60">
              <span className="text-zinc-300">Authoritative Database:</span>
              <span className="text-emerald-400 font-semibold">PostgreSQL / PGlite (Zero-Config Active)</span>
            </div>
            <div className="flex items-center justify-between p-2 rounded bg-zinc-900/60 border border-zinc-800/60">
              <span className="text-zinc-300">Participant Registration:</span>
              <span className="text-zinc-200">
                {metrics && metrics.registeredParticipantsCount > 0 ? (
                  <span className="text-emerald-400">Ready ({metrics.registeredParticipantsCount} participants registered)</span>
                ) : (
                  <span className="text-amber-400">No participants registered</span>
                )}
              </span>
            </div>
            <div className="flex items-center justify-between p-2 rounded bg-zinc-900/60 border border-zinc-800/60">
              <span className="text-zinc-300">Competition Duration:</span>
              <span className="text-zinc-200 font-semibold">Strict 60 Minutes (Single Period)</span>
            </div>
            <div className="flex items-center justify-between p-2 rounded bg-zinc-900/60 border border-zinc-800/60">
              <span className="text-zinc-300">Waiting Room Handshake:</span>
              <span className="text-blue-400">Synchronized via status polling</span>
            </div>
          </div>
        </div>

        {/* Quick Navigation / Command Center Shortcuts */}
        <div className="bg-zinc-950/80 border border-zinc-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-blue-400" />
              <h3 className="text-xs font-bold text-zinc-200 uppercase tracking-wider">
                Organizer Operational Views
              </h3>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
            <button
              onClick={() => onNavigateTab('controls')}
              className="p-3 text-left rounded-lg bg-zinc-900 hover:bg-zinc-800/80 border border-zinc-800 hover:border-blue-500/50 transition-colors flex flex-col justify-between group cursor-pointer"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-zinc-200">Event Controls</span>
                <Play className="w-3.5 h-3.5 text-emerald-400 group-hover:translate-x-0.5 transition-transform" />
              </div>
              <span className="text-[11px] text-zinc-400">Start, Pause, Resume, End</span>
            </button>

            <button
              onClick={() => onNavigateTab('participants')}
              className="p-3 text-left rounded-lg bg-zinc-900 hover:bg-zinc-800/80 border border-zinc-800 hover:border-blue-500/50 transition-colors flex flex-col justify-between group cursor-pointer"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-zinc-200">Participant Monitor</span>
                <Users className="w-3.5 h-3.5 text-blue-400 group-hover:translate-x-0.5 transition-transform" />
              </div>
              <span className="text-[11px] text-zinc-400">Live participant connection/session status</span>
            </button>

            <button
              onClick={() => onNavigateTab('participants')}
              className="p-3 text-left rounded-lg bg-zinc-900 hover:bg-zinc-800/80 border border-zinc-800 hover:border-blue-500/50 transition-colors flex flex-col justify-between group cursor-pointer"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-zinc-200">Registered Participants</span>
                <Radio className="w-3.5 h-3.5 text-purple-400 group-hover:translate-x-0.5 transition-transform" />
              </div>
              <span className="text-[11px] text-zinc-400">Participant directory and heartbeat telemetry</span>
            </button>

            <button
              onClick={() => onNavigateTab('anticheat')}
              className="p-3 text-left rounded-lg bg-zinc-900 hover:bg-zinc-800/80 border border-zinc-800 hover:border-blue-500/50 transition-colors flex flex-col justify-between group cursor-pointer"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-zinc-200">Anti-Cheat</span>
                <Shield className="w-3.5 h-3.5 text-rose-400 group-hover:translate-x-0.5 transition-transform" />
              </div>
              <span className="text-[11px] text-zinc-400">Participant violations and review</span>
            </button>

            <button
              onClick={() => onNavigateTab('audit')}
              className="p-3 text-left rounded-lg bg-zinc-900 hover:bg-zinc-800/80 border border-zinc-800 hover:border-blue-500/50 transition-colors flex flex-col justify-between group cursor-pointer"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-zinc-200">Audit Logs</span>
                <ExternalLink className="w-3.5 h-3.5 text-amber-400 group-hover:translate-x-0.5 transition-transform" />
              </div>
              <span className="text-[11px] text-zinc-400">Organizer interventions and system events</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
