import React, { useState, useEffect, useRef } from 'react';
import { ThemeId, PublicLeaderboardEntry } from '../types';
import { THEMES } from '../theme';
import {
  Tv,
  Clock,
  Trophy,
  Users,
  Shield,
  Maximize2,
  Minimize2,
  Lock,
  RefreshCw,
  AlertTriangle,
  Flame,
  Medal,
  Activity,
  CheckCircle,
} from 'lucide-react';

interface LiveScoreboardExperienceProps {
  currentTheme?: ThemeId;
  onBackToOverview?: () => void;
}

interface EventStatusState {
  status: 'NOT_STARTED' | 'RUNNING' | 'PAUSED' | 'ENDED';
  remainingSeconds: number;
  elapsedSeconds: number;
  durationMinutes: number;
  startedAt?: string | null;
  pausedAt?: string | null;
  endedAt?: string | null;
  serverTime?: string;
  currentMatchNumber?: number;
}

interface MatchListItem {
  id: string;
  matchNumber: number;
  name: string;
  status: string;
}

export const LiveScoreboardExperience: React.FC<LiveScoreboardExperienceProps> = ({
  currentTheme = 'cyber-obsidian',
}) => {
  const [leaderboard, setLeaderboard] = useState<PublicLeaderboardEntry[]>([]);
  const [eventStatus, setEventStatus] = useState<EventStatusState>({
    status: 'NOT_STARTED',
    remainingSeconds: 3600,
    elapsedSeconds: 0,
    durationMinutes: 60,
    currentMatchNumber: 1,
  });
  const [matchesList, setMatchesList] = useState<MatchListItem[]>([]);
  const [selectedMatchNumber, setSelectedMatchNumber] = useState<number | null>(null);
  const [isArchivedView, setIsArchivedView] = useState(false);
  const [isBigScreen, setIsBigScreen] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'reconnecting' | 'error'>('connecting');
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>(new Date().toISOString());
  const [recentChanges, setRecentChanges] = useState<Record<string, { type: 'solve' | 'rank_up'; timestamp: number }>>({});

  const previousRanksRef = useRef<Map<string, { rank: number; solved: number; score: number }>>(new Map());
  const eventSourceRef = useRef<EventSource | null>(null);

  const fetchMatchesList = async () => {
    try {
      const res = await fetch('/api/leaderboard/matches');
      if (res.ok) {
        const data = await res.json();
        if (data.matches && Array.isArray(data.matches)) {
          setMatchesList(data.matches);
        }
      }
    } catch (err) {
      console.warn('[LiveScoreboard] Failed to fetch matches list:', err);
    }
  };

  // Fetch authoritative leaderboard and event state
  const fetchAuthoritativeLeaderboard = async (matchNum?: number | null) => {
    try {
      const targetMatch = matchNum !== undefined ? matchNum : selectedMatchNumber;
      const url = targetMatch ? `/api/leaderboard?matchNumber=${targetMatch}` : '/api/leaderboard';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.data || data.leaderboard)) {
          const freshList: PublicLeaderboardEntry[] = data.data || data.leaderboard;
          handleLeaderboardUpdate(freshList);
        }
        setIsArchivedView(Boolean(data.isArchivedMatch));
        if (data.event) {
          setEventStatus((prev) => ({
            ...prev,
            status: data.event.status || prev.status,
            remainingSeconds: typeof data.event.remainingSeconds === 'number' ? data.event.remainingSeconds : prev.remainingSeconds,
            elapsedSeconds: typeof data.event.elapsedSeconds === 'number' ? data.event.elapsedSeconds : prev.elapsedSeconds,
            durationMinutes: data.event.durationMinutes || prev.durationMinutes,
            startedAt: data.event.startedAt,
            pausedAt: data.event.pausedAt,
            endedAt: data.event.endedAt,
            serverTime: data.event.serverTime,
            currentMatchNumber: data.event.currentMatchNumber || prev.currentMatchNumber,
          }));
        }
        setLastUpdated(new Date().toISOString());
      }
    } catch (err) {
      console.warn('[LiveScoreboard] Failed to fetch authoritative snapshot:', err);
    } finally {
      setLoading(false);
    }
  };

  // Detect deltas for restrained live change animation
  const handleLeaderboardUpdate = (newList: PublicLeaderboardEntry[]) => {
    const prevMap = previousRanksRef.current;
    const now = Date.now();
    const newChanges: Record<string, { type: 'solve' | 'rank_up'; timestamp: number }> = {};

    if (prevMap.size > 0) {
      for (const entry of newList) {
        const prev = prevMap.get(entry.teamName);
        if (prev) {
          if (entry.problemsSolved > prev.solved) {
            newChanges[entry.teamName] = { type: 'solve', timestamp: now };
          } else if (entry.rank < prev.rank) {
            newChanges[entry.teamName] = { type: 'rank_up', timestamp: now };
          }
        }
      }
    }

    // Update reference map
    const nextMap = new Map<string, { rank: number; solved: number; score: number }>();
    for (const entry of newList) {
      nextMap.set(entry.teamName, {
        rank: entry.rank,
        solved: entry.problemsSolved,
        score: entry.score,
      });
    }
    previousRanksRef.current = nextMap;

    if (Object.keys(newChanges || {}).length > 0) {
      setRecentChanges((prev) => ({ ...(prev || {}), ...newChanges }));
    }

    setLeaderboard(newList);
    setLastUpdated(new Date().toISOString());
  };

  // Clean up highlighted deltas after 4 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setRecentChanges((prev) => {
        const next: Record<string, { type: 'solve' | 'rank_up'; timestamp: number }> = {};
        let changed = false;
        const entries = Object.entries(prev || {}) as [string, { type: 'solve' | 'rank_up'; timestamp: number }][];
        for (const [key, val] of entries) {
          if (now - val.timestamp < 4000) {
            next[key] = val;
          } else {
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Connect to dedicated public SSE stream (/api/leaderboard/stream)
  useEffect(() => {
    fetchAuthoritativeLeaderboard();
    fetchMatchesList();

    let es: EventSource | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;

    const connectSSE = () => {
      try {
        es = new EventSource('/api/leaderboard/stream');
        eventSourceRef.current = es;

        es.onopen = () => {
          setConnectionStatus('connected');
          // Re-fetch authoritative state upon reconnection to prevent any missed updates
          fetchAuthoritativeLeaderboard();
          fetchMatchesList();
        };

        es.addEventListener('leaderboard.init', (e: MessageEvent) => {
          try {
            const parsed = JSON.parse(e.data);
            if (parsed.leaderboard) {
              handleLeaderboardUpdate(parsed.leaderboard);
            }
            if (parsed.event) {
              setEventStatus((prev) => ({
                ...prev,
                ...parsed.event,
              }));
            }
          } catch (parseErr) {
            console.warn('[LiveScoreboard] Error parsing leaderboard.init:', parseErr);
          }
        });

        es.addEventListener('leaderboard.updated', (e: MessageEvent) => {
          try {
            const parsed = JSON.parse(e.data);
            if (parsed.leaderboard) {
              handleLeaderboardUpdate(parsed.leaderboard);
            }
            if (parsed.event) {
              setEventStatus((prev) => ({
                ...prev,
                ...parsed.event,
              }));
            }
          } catch (parseErr) {
            console.warn('[LiveScoreboard] Error parsing leaderboard.updated:', parseErr);
          }
        });

        es.addEventListener('event.status.changed', (e: MessageEvent) => {
          try {
            const parsed = JSON.parse(e.data);
            setEventStatus((prev) => ({
              ...prev,
              status: parsed.status || prev.status,
              remainingSeconds: typeof parsed.remainingSeconds === 'number' ? parsed.remainingSeconds : prev.remainingSeconds,
              elapsedSeconds: typeof parsed.elapsedSeconds === 'number' ? parsed.elapsedSeconds : prev.elapsedSeconds,
              currentMatchNumber: parsed.currentMatchNumber || prev.currentMatchNumber,
            }));
            fetchAuthoritativeLeaderboard();
            fetchMatchesList();
          } catch (parseErr) {
            console.warn('[LiveScoreboard] Error parsing event.status.changed:', parseErr);
          }
        });

        es.addEventListener('match.reset', () => {
          try {
            previousRanksRef.current.clear();
            fetchAuthoritativeLeaderboard();
            fetchMatchesList();
          } catch (err) {
            console.warn('[LiveScoreboard] Error handling match.reset:', err);
          }
        });

        es.onerror = () => {
          setConnectionStatus('reconnecting');
          if (es) {
            es.close();
            es = null;
          }
          // Schedule reconnect attempt
          if (!reconnectTimeout) {
            reconnectTimeout = setTimeout(() => {
              reconnectTimeout = null;
              connectSSE();
            }, 3000);
          }
        };
      } catch (err) {
        setConnectionStatus('error');
      }
    };

    connectSSE();

    return () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (es) es.close();
      if (eventSourceRef.current) eventSourceRef.current.close();
    };
  }, [selectedMatchNumber]);

  // Local authoritative countdown reconciler
  useEffect(() => {
    const timer = setInterval(() => {
      setEventStatus((prev) => {
        if (prev.status !== 'RUNNING') return prev;
        if (prev.remainingSeconds <= 1) {
          // Time expired; auto transition to ENDED locally while awaiting server confirmation
          return {
            ...prev,
            status: 'ENDED',
            remainingSeconds: 0,
            elapsedSeconds: prev.durationMinutes * 60,
          };
        }
        return {
          ...prev,
          remainingSeconds: prev.remainingSeconds - 1,
          elapsedSeconds: prev.elapsedSeconds + 1,
        };
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const formatClock = (totalSeconds: number) => {
    const safeSec = Math.max(0, totalSeconds);
    const m = Math.floor(safeSec / 60);
    const s = safeSec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const toggleFullscreen = () => {
    setIsBigScreen(!isBigScreen);
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };

  const getStatusBadge = () => {
    switch (eventStatus.status) {
      case 'RUNNING':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-mono text-xs font-bold">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            MATCH STATE: RUNNING
          </span>
        );
      case 'PAUSED':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 font-mono text-xs font-bold">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            MATCH STATE: PAUSED
          </span>
        );
      case 'ENDED':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/30 text-red-400 font-mono text-xs font-bold">
            <CheckCircle className="w-3.5 h-3.5" />
            MATCH CONCLUDED (FINAL)
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-300 font-mono text-xs font-bold">
            <Clock className="w-3.5 h-3.5 text-zinc-400" />
            MATCH NOT STARTED
          </span>
        );
    }
  };

  return (
    <div
      id="live-scoreboard-root"
      className={`space-y-6 transition-all duration-300 ${
        isBigScreen
          ? 'fixed inset-0 z-50 overflow-y-auto bg-black text-white p-6 sm:p-10'
          : 'relative'
      }`}
    >
      {/* Scoreboard Control & Privacy Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800/80 pb-4 font-mono text-xs">
        <div className="flex items-center gap-2">
          <Tv className="w-4 h-4 text-amber-400" />
          <span className="font-bold text-white tracking-wider">BUG SNIPER</span>
          <span className="text-zinc-600">/</span>
          <span className="text-zinc-400">Live Auditorium Display (/live)</span>

          {/* SSE Live Status Indicator */}
          <div className="ml-2 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[10px] font-bold border">
            {connectionStatus === 'connected' ? (
              <div className="flex items-center gap-1.5 text-emerald-400 border-emerald-500/30 bg-emerald-500/10">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>LIVE SSE CONNECTED</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-amber-400 border-amber-500/30 bg-amber-500/10">
                <RefreshCw className="w-3 h-3 animate-spin" />
                <span>RECONNECTING...</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {/* Match Round Switcher */}
          {matchesList.length > 0 && (
            <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1 text-xs">
              <span className="text-zinc-500 font-semibold">ROUND:</span>
              <select
                id="live-match-selector"
                value={selectedMatchNumber ?? eventStatus.currentMatchNumber ?? 1}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setSelectedMatchNumber(val);
                  fetchAuthoritativeLeaderboard(val);
                }}
                className="bg-transparent text-cyan-300 font-bold focus:outline-none cursor-pointer"
              >
                {matchesList.map((m) => (
                  <option key={m.id} value={m.matchNumber} className="bg-zinc-950 text-zinc-200">
                    Match #{m.matchNumber} {m.matchNumber === eventStatus.currentMatchNumber ? '(Active)' : `(${m.status})`}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Privacy confirmation badge */}
          <div className="hidden lg:flex items-center gap-1.5 px-3 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[11px]">
            <Lock className="w-3.5 h-3.5" />
            <span>Public Projector Surface</span>
          </div>

          {/* Refresh Snapshot */}
          <button
            id="live-manual-refresh-btn"
            onClick={() => fetchAuthoritativeLeaderboard(selectedMatchNumber)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-300 hover:text-white hover:border-zinc-700 transition-colors disabled:opacity-50"
            title="Fetch fresh snapshot"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
            <span className="hidden sm:inline">Sync</span>
          </button>

          {/* Projector / TV Mode Toggle */}
          <button
            id="live-projector-toggle-btn"
            onClick={toggleFullscreen}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 transition-all font-bold"
          >
            {isBigScreen ? (
              <>
                <Minimize2 className="w-3.5 h-3.5" />
                <span>Exit Projector View</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-3.5 h-3.5" />
                <span>Auditorium Projector Mode</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Archived match alert banner if viewing historical match */}
      {isArchivedView && selectedMatchNumber && (
        <div className="p-3 bg-amber-950/30 border border-amber-500/40 rounded-xl text-xs font-mono text-amber-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Viewing archived final standings for <strong>Match #{selectedMatchNumber}</strong>.</span>
          </div>
          <button
            onClick={() => {
              setSelectedMatchNumber(null);
              fetchAuthoritativeLeaderboard(null);
            }}
            className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 rounded text-[11px] font-bold cursor-pointer transition-colors"
          >
            Return to Active Match (#{eventStatus.currentMatchNumber || 1})
          </button>
        </div>
      )}

      {/* Main Scoreboard Header (Auditorium Display) */}
      <div
        id="live-projector-banner"
        className={`rounded-2xl border ${
          isBigScreen
            ? 'border-zinc-700 bg-gradient-to-b from-zinc-900 via-zinc-950 to-black p-8 sm:p-10'
            : 'border-zinc-800 bg-zinc-950/90 p-6 sm:p-8'
        } flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-2xl relative overflow-hidden`}
      >
        <div className="space-y-2 relative z-10">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-300 font-mono text-xs font-bold">
              <Tv className="w-3.5 h-3.5" />
              <span>COLLEGIATE TECHNICAL SYMPOSIUM • JAVA DEBUGGING CTF</span>
            </div>
            {getStatusBadge()}
          </div>

          <h1 className={`${isBigScreen ? 'text-5xl sm:text-6xl' : 'text-4xl sm:text-5xl'} font-black text-white font-mono tracking-tight`}>
            BUG <span className="text-emerald-400">SNIPER</span> STANDINGS
          </h1>

          <p className="text-zinc-400 font-mono text-xs max-w-xl">
            Immutable Ranking Invariant:{' '}
            <span className="text-emerald-400 font-bold">1. Problems Solved (Primary)</span>{' '}
            &gt; <span className="text-amber-400 font-bold">2. Score (Secondary)</span>{' '}
            &gt; <span className="text-cyan-400 font-bold">3. Earliest Achievement Time (Tiebreaker)</span>
          </p>
        </div>

        {/* Big Match Clock */}
        <div
          id="live-match-clock"
          className={`p-6 rounded-2xl border ${
            eventStatus.status === 'RUNNING'
              ? 'border-amber-500/40 bg-zinc-900/90 shadow-amber-500/5 shadow-xl'
              : eventStatus.status === 'PAUSED'
              ? 'border-amber-500/30 bg-amber-950/20'
              : eventStatus.status === 'ENDED'
              ? 'border-red-500/30 bg-red-950/20'
              : 'border-zinc-800 bg-zinc-900/50'
          } text-right min-w-[260px] shrink-0`}
        >
          <div className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider flex items-center justify-end gap-1.5 mb-1">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span>TIME REMAINING</span>
          </div>

          <div
            className={`${
              isBigScreen ? 'text-6xl sm:text-7xl' : 'text-5xl'
            } font-black font-mono tracking-wider ${
              eventStatus.status === 'RUNNING'
                ? 'text-amber-400'
                : eventStatus.status === 'PAUSED'
                ? 'text-amber-300'
                : eventStatus.status === 'ENDED'
                ? 'text-red-400'
                : 'text-zinc-500'
            }`}
          >
            {formatClock(eventStatus.remainingSeconds)}
          </div>

          <div className="text-[11px] font-mono text-zinc-400 font-semibold mt-1.5 flex items-center justify-end gap-2">
            <span>Duration: {eventStatus.durationMinutes}m</span>
            <span>•</span>
            <span className="text-zinc-500">Elapsed: {formatClock(eventStatus.elapsedSeconds)}</span>
          </div>
        </div>
      </div>

      {/* Event Pause Notice */}
      {eventStatus.status === 'PAUSED' && (
        <div className="p-4 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-300 font-mono text-xs flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
          <div>
            <span className="font-bold">COMPETITION PAUSED BY ORGANIZER:</span> Flag submissions and problem solving are temporarily suspended. Remaining match time is frozen.
          </div>
        </div>
      )}

      {/* Event Concluded Notice */}
      {eventStatus.status === 'ENDED' && (
        <div className="p-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 font-mono text-xs flex items-center gap-3">
          <Trophy className="w-5 h-5 text-amber-400 shrink-0" />
          <div>
            <span className="font-bold">COMPETITION CONCLUDED:</span> All 60 minutes have elapsed. Standings below represent the official, immutable tournament results.
          </div>
        </div>
      )}

      {/* Primary Standings Table */}
      <div
        id="live-leaderboard-table-container"
        className="rounded-2xl border border-zinc-800 bg-zinc-950 overflow-hidden shadow-2xl font-mono"
      >
        <div className="p-4 border-b border-zinc-800/80 bg-zinc-900/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5 font-bold text-white">
            <Trophy className="w-4 h-4 text-amber-400" />
            <span className="tracking-wide uppercase">OFFICIAL SYMPOSIUM LEADERBOARD</span>
            <span className="text-zinc-600">|</span>
            <span className="text-zinc-400 font-normal">
              {leaderboard.length} Registered {leaderboard.length === 1 ? 'Competitor' : 'Competitors'}
            </span>
          </div>

          <div className="flex items-center gap-3 text-[11px] text-zinc-400">
            <span>
              Updated: <span className="text-zinc-200">{new Date(lastUpdated).toLocaleTimeString()}</span>
            </span>
            <div className="hidden lg:flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>Authoritative DB Sort</span>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          {leaderboard.length === 0 ? (
            <div className="py-16 px-6 text-center space-y-3 font-mono">
              <Users className="w-10 h-10 text-zinc-600 mx-auto" />
              <div className="text-zinc-300 text-sm font-bold">NO COMPETITORS ON LEADERBOARD YET</div>
              <p className="text-zinc-500 text-xs max-w-md mx-auto">
                Competitors will automatically appear here once registered and active in the competition.
              </p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse" id="leaderboard-table">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/50 text-zinc-400 text-xs uppercase tracking-wider">
                  <th className="py-4 px-4 sm:px-6 font-bold w-20">Rank</th>
                  <th className="py-4 px-4 sm:px-6 font-bold">Competitor</th>
                  <th className="py-4 px-4 sm:px-6 font-bold text-center">Status</th>
                  <th className="py-4 px-4 sm:px-6 font-bold text-emerald-400 text-center">Problems Solved</th>
                  <th className="py-4 px-4 sm:px-6 font-bold text-amber-400 text-right">Score</th>
                  <th className="py-4 px-4 sm:px-6 font-bold text-zinc-400 text-right">Last Solved</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 text-xs">
                {leaderboard.map((team) => {
                  const isPodium = team.rank <= 3;
                  const recentChange = recentChanges[team.teamName];

                  return (
                    <tr
                      key={team.teamName}
                      id={`team-row-${team.rank}`}
                      className={`transition-all duration-500 ${
                        recentChange
                          ? 'bg-emerald-500/20 ring-1 ring-emerald-500/50'
                          : team.rank === 1
                          ? 'bg-amber-500/5 hover:bg-amber-500/10'
                          : team.rank === 2
                          ? 'bg-zinc-800/20 hover:bg-zinc-800/30'
                          : team.rank === 3
                          ? 'bg-amber-900/10 hover:bg-amber-900/20'
                          : 'hover:bg-zinc-900/40'
                      }`}
                    >
                      {/* Rank Indicator */}
                      <td className="py-4 px-4 sm:px-6 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          {team.rank === 1 ? (
                            <div className="flex items-center gap-1.5">
                              <span className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-300 to-amber-500 text-zinc-950 font-black flex items-center justify-center text-sm shadow-lg shadow-amber-500/20">
                                1
                              </span>
                              <Medal className="w-4 h-4 text-amber-400 shrink-0" />
                            </div>
                          ) : team.rank === 2 ? (
                            <div className="flex items-center gap-1.5">
                              <span className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-200 to-slate-400 text-zinc-950 font-black flex items-center justify-center text-sm shadow-md">
                                2
                              </span>
                              <Medal className="w-4 h-4 text-slate-300 shrink-0" />
                            </div>
                          ) : team.rank === 3 ? (
                            <div className="flex items-center gap-1.5">
                              <span className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-700 to-amber-900 text-amber-100 font-black flex items-center justify-center text-sm shadow-md">
                                3
                              </span>
                              <Medal className="w-4 h-4 text-amber-600 shrink-0" />
                            </div>
                          ) : (
                            <span className="text-zinc-400 font-bold px-3 text-sm">
                              #{team.rank}
                            </span>
                          )}

                          {recentChange?.type === 'rank_up' && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500 text-zinc-950 animate-pulse">
                              ▲ UP
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Competitor Name */}
                      <td className="py-4 px-4 sm:px-6 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className={`font-bold text-white ${isBigScreen ? 'text-lg' : 'text-sm'}`}>
                            {team.participantName || team.teamName}
                          </span>
                          {team.rank === 1 && (
                            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300">
                              Tournament Leader
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Solo Competitor Active Status */}
                      <td className="py-4 px-4 sm:px-6 whitespace-nowrap text-center">
                        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-[11px] text-zinc-300">
                          <Users className="w-3.5 h-3.5 text-cyan-400" />
                          <span className="font-bold">
                            {team.connectedMembers > 0 ? 'ONLINE' : 'OFFLINE'}
                          </span>
                        </div>
                      </td>

                      {/* Problems Solved (PRIMARY CRITERION) */}
                      <td className="py-4 px-4 sm:px-6 whitespace-nowrap text-center">
                        <div className="inline-flex items-center gap-1.5">
                          <span
                            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl font-black ${
                              isBigScreen ? 'text-base' : 'text-sm'
                            } ${
                              team.problemsSolved > 0
                                ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300'
                                : 'bg-zinc-900 border border-zinc-800 text-zinc-500'
                            }`}
                          >
                            <CheckCircle className="w-4 h-4 text-emerald-400" />
                            <span>{team.problemsSolved} SOLVED</span>
                          </span>

                          {recentChange?.type === 'solve' && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-400 text-zinc-950 animate-bounce">
                              +SOLVE!
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Score (SECONDARY CRITERION) */}
                      <td className="py-4 px-4 sm:px-6 whitespace-nowrap text-right font-black text-amber-400">
                        <span className={`${isBigScreen ? 'text-xl' : 'text-base'}`}>
                          {team.score.toLocaleString()}
                        </span>
                        <span className="text-xs text-amber-500/80 ml-1 font-semibold">PTS</span>
                      </td>

                      {/* Last Solve Timestamp (TIEBREAKER) */}
                      <td className="py-4 px-4 sm:px-6 whitespace-nowrap text-right text-zinc-400 text-xs">
                        {team.problemsSolved > 0 ? (
                          <div className="space-y-0.5">
                            <span className="font-mono text-zinc-300">
                              {new Date(team.lastSolveTimestamp).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                              })}
                            </span>
                            <div className="text-[10px] text-zinc-500">Solve Tiebreaker</div>
                          </div>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Scoreboard Rules & Tiebreaker Footer */}
        <div className="p-4 border-t border-zinc-800/80 bg-zinc-900/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-zinc-400">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              Authoritative Sorting Guarantee: Solved count ranks strictly above score. Earlier solve time breaks ties.
            </span>
          </div>

          <div className="flex items-center gap-4 text-[11px]">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded bg-emerald-500/30 border border-emerald-500/50" />
              Primary: Solves
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded bg-amber-500/30 border border-amber-500/50" />
              Secondary: Points
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded bg-cyan-500/30 border border-cyan-500/50" />
              Tiebreaker: Time
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
