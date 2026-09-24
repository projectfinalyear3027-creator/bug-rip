/**
 * BUG RIP - Coding Arena Active Route Shell
 * Route: /arena
 * 
 * Strict Fragment 5 & 6 Requirements:
 * - Authoritative timer synchronization with server (no client-side clock drift or manual manipulation)
 * - Timer stops and freezes when PAUSED
 * - Explicit pause screen:
 *     BUG RIP
 *     COMPETITION PAUSED
 *     Your competition time is temporarily stopped.
 * - Explicit end screen:
 *     BUG RIP
 *     COMPETITION ENDED
 *     The final results will be available shortly.
 * - Fragment 6 Progression:
 *     Live difficulty tiers (Easy, Medium, Hard, Extreme)
 *     Monotonic unlocks & sequential threshold tracking
 *     Free choice challenge selection within unlocked tiers
 *     Safe challenge inspector with starter code and public test cases
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Terminal,
  Clock,
  LogOut,
  Code2,
  Unlock,
  Lock,
  PauseCircle,
  AlertOctagon,
  ShieldCheck,
  CheckCircle2,
  Sparkles,
  ChevronRight,
  FileCode,
  Layers,
  ArrowRight,
  X,
  AlertTriangle,
  Loader2,
} from 'lucide-react';

interface ArenaPlaceholderProps {
  team: {
    id: string;
    teamName: string;
    registeredMemberCount: number;
    connectedMemberCount: number;
  };
  eventStatus: string;
  onLogout: () => void;
  onReturnToWaiting?: () => void;
}

interface RoundProgressionInfo {
  id: string;
  name: string;
  slug: string;
  displayOrder: number;
  isUnlocked: boolean;
  unlockRequiredSolves: number;
  solvesInPreceding?: number;
  solvesRemainingToUnlock?: number;
  challengesCount: number;
}

interface ChallengeItem {
  id: string;
  roundId: string;
  title: string;
  slug: string;
  score: number;
  displayOrder: number;
  validationType: string;
  status: 'LOCKED' | 'AVAILABLE' | 'IN_PROGRESS' | 'COMPLETED';
  attemptCount: number;
}

interface ProgressionResponse {
  teamId: string;
  teamName: string;
  progressionMode: string;
  problemsSolved: number;
  totalScore: number;
  rounds: RoundProgressionInfo[];
  challenges: ChallengeItem[];
}

interface ChallengeDetails {
  id: string;
  roundId: string;
  roundName: string;
  title: string;
  slug: string;
  description: string;
  starterCode: string;
  score: number;
  displayOrder: number;
  validationType: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  status: string;
  attemptCount: number;
  publicTestCases: Array<{
    id: string;
    inputData: string;
    expectedOutput: string;
    displayOrder: number;
  }>;
}

export const ArenaPlaceholder: React.FC<ArenaPlaceholderProps> = ({
  team,
  eventStatus: initialStatus,
  onLogout,
}) => {
  const [currentStatus, setCurrentStatus] = useState<string>(initialStatus || 'RUNNING');
  const [remainingSeconds, setRemainingSeconds] = useState<number>(3600);
  const [loggingOut, setLoggingOut] = useState(false);
  const [lastSyncServerTime, setLastSyncServerTime] = useState<Date | null>(null);

  // Progression & Challenges State
  const [progression, setProgression] = useState<ProgressionResponse | null>(null);
  const [selectedRoundSlug, setSelectedRoundSlug] = useState<string>('easy');
  const [activeChallengeId, setActiveChallengeId] = useState<string | null>(null);
  const [challengeDetails, setChallengeDetails] = useState<ChallengeDetails | null>(null);
  const [loadingChallenge, setLoadingChallenge] = useState(false);
  const [challengeError, setChallengeError] = useState<string | null>(null);

  // Sync with authoritative backend /api/event/status
  const syncEventStatus = async () => {
    try {
      const res = await fetch('/api/event/status');
      if (res.ok) {
        const data = await res.json();
        if (data.status) {
          setCurrentStatus(data.status);
        }
        if (typeof data.remainingSeconds === 'number') {
          setRemainingSeconds(Math.max(0, data.remainingSeconds));
        }
        if (data.serverTime) {
          setLastSyncServerTime(new Date(data.serverTime));
        }
      }
    } catch {
      // Network hiccup - keep current state
    }
  };

  // Fetch team progression & challenges
  const fetchProgression = async () => {
    try {
      const res = await fetch('/api/challenges');
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data) {
          setProgression(data.data);
        }
      }
    } catch (err) {
      console.error('Failed to load progression:', err);
    }
  };

  useEffect(() => {
    syncEventStatus();
    fetchProgression();
    const syncInterval = setInterval(() => {
      syncEventStatus();
      fetchProgression();
    }, 4000);
    return () => clearInterval(syncInterval);
  }, []);

  // Local authoritative tick interpolation (only ticks down when RUNNING and > 0)
  useEffect(() => {
    if (currentStatus !== 'RUNNING') return;

    const tick = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          syncEventStatus();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(tick);
  }, [currentStatus]);

  const loadChallenge = async (id: string) => {
    setActiveChallengeId(id);
    setLoadingChallenge(true);
    setChallengeError(null);
    try {
      const res = await fetch(`/api/challenges/${id}`);
      const data = await res.json();
      if (res.ok && data.success) {
        setChallengeDetails(data.data);
      } else {
        setChallengeError(data.error || 'Failed to open challenge.');
        setChallengeDetails(null);
      }
    } catch (err: any) {
      setChallengeError(err.message || 'Network error.');
      setChallengeDetails(null);
    } finally {
      setLoadingChallenge(false);
    }
  };

  const formatTime = (secs: number) => {
    const clamped = Math.max(0, secs);
    const mins = Math.floor(clamped / 60);
    const s = clamped % 60;
    return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleLogoutClick = async () => {
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      setLoggingOut(false);
      onLogout();
    }
  };

  const isPaused = currentStatus === 'PAUSED';
  const isEnded = currentStatus === 'ENDED';

  const currentRound = progression?.rounds.find((r) => r.slug === selectedRoundSlug) || progression?.rounds[0];
  const roundChallenges = progression?.challenges.filter((c) => c.roundId === currentRound?.id) || [];

  return (
    <div id="coding-arena-root" className="space-y-6 font-mono">
      {/* Top Banner with Authoritative Status & Server Timer */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 flex flex-col md:flex-row items-center justify-between gap-4 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
            <Terminal className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase text-zinc-500 font-bold">BUG SNIPER ARENA</span>
              <span
                className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider ${
                  currentStatus === 'RUNNING'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 animate-pulse'
                    : currentStatus === 'PAUSED'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'bg-red-500/20 text-red-400 border border-red-500/40'
                }`}
              >
                {currentStatus}
              </span>
            </div>
            <div className="text-sm font-bold text-white flex items-center gap-2">
              <span>{team.teamName}</span>
              <span className="text-xs text-zinc-500">•</span>
              <span className="text-xs text-emerald-400">
                {progression?.totalScore ?? 0} PTS ({progression?.problemsSolved ?? 0} Solves)
              </span>
            </div>
          </div>
        </div>

        {/* 60-Minute Authoritative Countdown Display */}
        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 flex items-center justify-end gap-1 font-bold">
              <Clock className="w-3 h-3 text-emerald-400" />
              <span>COMPETITION TIME</span>
            </div>
            <div
              id="arena-authoritative-timer"
              className={`text-3xl sm:text-4xl font-black font-mono tracking-tight ${
                isPaused
                  ? 'text-amber-400'
                  : isEnded
                  ? 'text-red-500'
                  : remainingSeconds <= 300
                  ? 'text-red-400 animate-pulse'
                  : 'text-emerald-400'
              }`}
            >
              {formatTime(remainingSeconds)}
            </div>
          </div>

          <button
            onClick={handleLogoutClick}
            disabled={loggingOut}
            className="p-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-red-400 border border-zinc-800 hover:border-red-500/40 transition-colors cursor-pointer"
            title="Leave Arena / Disconnect Session"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* PAUSE SCREEN STATE */}
      {isPaused && (
        <div
          id="arena-paused-banner"
          className="relative overflow-hidden rounded-2xl border border-amber-500/40 bg-amber-950/20 p-8 text-center space-y-4 shadow-2xl"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-300 text-xs">
            <PauseCircle className="w-4 h-4" />
            <span>BUG SNIPER</span>
          </div>

          <h2 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
            COMPETITION PAUSED
          </h2>

          <p className="text-amber-100 text-sm max-w-xl mx-auto leading-relaxed font-semibold">
            Your competition time is temporarily stopped.
          </p>

          <p className="text-xs text-zinc-400 max-w-lg mx-auto">
            The event organizer has paused the competition clock. Challenge code editing and flag submissions are temporarily suspended. Do not refresh or disconnect; the arena will automatically resume when the organizer reactivates the event.
          </p>
        </div>
      )}

      {/* END SCREEN STATE */}
      {isEnded && (
        <div
          id="arena-ended-banner"
          className="relative overflow-hidden rounded-2xl border border-red-500/40 bg-red-950/20 p-8 text-center space-y-4"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-red-500/40 bg-red-500/10 text-red-300 text-xs">
            <AlertOctagon className="w-4 h-4" />
            <span>BUG SNIPER</span>
          </div>

          <h2 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
            COMPETITION ENDED
          </h2>

          <p className="text-zinc-200 text-sm max-w-xl mx-auto leading-relaxed font-semibold">
            The final results will be available shortly.
          </p>

          <p className="text-xs text-zinc-400 max-w-lg mx-auto">
            The 60-minute competition duration has officially elapsed. Submissions and code executions are permanently locked. Official final scores and tiebreaker rankings are being computed.
          </p>
        </div>
      )}

      {/* FRAGMENT 6: DIFFICULTY TIERS & PROGRESSION BAR */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase text-zinc-400 tracking-wider font-bold flex items-center gap-2">
            <Layers className="w-4 h-4 text-emerald-400" />
            <span>Competition Difficulty Tiers</span>
          </div>
          {progression?.progressionMode === 'UNLOCK_ALL' && (
            <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 font-bold">
              ORGANIZER OVERRIDE: ALL TIERS UNLOCKED
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          {progression?.rounds.map((r, idx) => {
            const isSelected = r.slug === selectedRoundSlug;
            const prevRound = idx > 0 ? progression.rounds[idx - 1] : null;

            return (
              <button
                key={r.id}
                onClick={() => setSelectedRoundSlug(r.slug)}
                className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                  isSelected
                    ? 'border-blue-500 bg-blue-950/20 shadow-lg shadow-blue-950/30'
                    : r.isUnlocked
                    ? 'border-emerald-500/40 bg-zinc-900/80 hover:bg-zinc-850'
                    : 'border-zinc-800 bg-zinc-950/60 opacity-70 hover:opacity-90'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-bold ${r.isUnlocked ? 'text-emerald-400' : 'text-zinc-400'}`}>
                    TIER {r.displayOrder}: {(r.name || '').toUpperCase()}
                  </span>
                  {r.isUnlocked ? (
                    <Unlock className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Lock className="w-3.5 h-3.5 text-zinc-500" />
                  )}
                </div>

                <div className="text-base font-black text-white mt-1.5 flex items-center justify-between">
                  <span>{r.isUnlocked ? 'UNLOCKED' : 'LOCKED'}</span>
                  <span className="text-xs font-normal text-zinc-400">{r.challengesCount} Problems</span>
                </div>

                <div className="text-[11px] text-zinc-400 mt-2">
                  {r.displayOrder === 1 ? (
                    <span className="text-emerald-400/90">Default Available</span>
                  ) : r.isUnlocked ? (
                    <span className="text-emerald-400/90">Requirements Met</span>
                  ) : (
                    <span className="text-amber-400/90">
                      Need {r.solvesRemainingToUnlock ?? r.unlockRequiredSolves} more solves in {prevRound?.name || 'preceding tier'}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* CHALLENGES IN SELECTED ROUND */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Challenge List */}
        <div className="lg:col-span-1 space-y-3">
          <div className="flex items-center justify-between text-xs text-zinc-400 px-1 font-bold">
            <span>{(currentRound?.name || 'CURRENT').toUpperCase()} CHALLENGES</span>
            <span>{roundChallenges.length} Total</span>
          </div>

          <div className="space-y-2">
            {roundChallenges.map((c) => {
              const isSelected = c.id === activeChallengeId;
              const isLocked = c.status === 'LOCKED';
              const isCompleted = c.status === 'COMPLETED';

              return (
                <button
                  key={c.id}
                  onClick={() => loadChallenge(c.id)}
                  disabled={isLocked}
                  className={`w-full p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                    isSelected
                      ? 'border-blue-500 bg-blue-950/30'
                      : isCompleted
                      ? 'border-emerald-500/40 bg-emerald-950/10 hover:bg-emerald-950/20'
                      : isLocked
                      ? 'border-zinc-850 bg-zinc-950/40 opacity-50 cursor-not-allowed'
                      : 'border-zinc-800 bg-zinc-900/60 hover:bg-zinc-850'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold text-blue-400">{c.id}</span>
                    <span className="text-xs font-bold text-amber-400">{c.score} PTS</span>
                  </div>

                  <div className="text-sm font-semibold text-white mt-1 flex items-center justify-between">
                    <span className="truncate">{c.title}</span>
                  </div>

                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-zinc-800/60 text-[10px]">
                    <span className="text-zinc-400 font-mono">{c.validationType}</span>
                    <span
                      className={`font-bold ${
                        isCompleted
                          ? 'text-emerald-400 flex items-center gap-1'
                          : isLocked
                          ? 'text-zinc-500'
                          : 'text-blue-400'
                      }`}
                    >
                      {isCompleted ? (
                        <>
                          <CheckCircle2 className="w-3 h-3" />
                          <span>SOLVED</span>
                        </>
                      ) : isLocked ? (
                        'LOCKED'
                      ) : (
                        'AVAILABLE'
                      )}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Column: Challenge Viewer / Inspector */}
        <div className="lg:col-span-2">
          {activeChallengeId && challengeDetails ? (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-5">
              {/* Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-zinc-800">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-mono font-bold">
                      {challengeDetails.id}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs font-semibold">
                      {challengeDetails.roundName}
                    </span>
                  </div>
                  <h3 className="text-xl font-black text-white mt-1.5">
                    {challengeDetails.title}
                  </h3>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-[10px] text-zinc-400 font-bold uppercase">REWARD</div>
                    <div className="text-xl font-black text-amber-400 font-mono">
                      +{challengeDetails.score} PTS
                    </div>
                  </div>
                </div>
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <h4 className="text-xs uppercase text-zinc-400 font-bold">Problem Statement</h4>
                <div className="p-4 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 leading-relaxed font-sans whitespace-pre-wrap">
                  {challengeDetails.description}
                </div>
              </div>

              {/* Constraints */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800">
                  <div className="text-[10px] text-zinc-500 uppercase">Validation</div>
                  <div className="text-zinc-200 font-bold font-mono mt-0.5">{challengeDetails.validationType}</div>
                </div>
                <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800">
                  <div className="text-[10px] text-zinc-500 uppercase">Time Limit</div>
                  <div className="text-zinc-200 font-bold font-mono mt-0.5">{challengeDetails.timeLimitMs} ms</div>
                </div>
                <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800">
                  <div className="text-[10px] text-zinc-500 uppercase">Memory Limit</div>
                  <div className="text-zinc-200 font-bold font-mono mt-0.5">{challengeDetails.memoryLimitMb} MB</div>
                </div>
                <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800">
                  <div className="text-[10px] text-zinc-500 uppercase">Attempts</div>
                  <div className="text-zinc-200 font-bold font-mono mt-0.5">{challengeDetails.attemptCount} (unlimited)</div>
                </div>
              </div>

              {/* Starter Code Preview */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-zinc-400 font-bold">
                  <span className="flex items-center gap-1.5">
                    <FileCode className="w-3.5 h-3.5 text-amber-400" />
                    <span>Buggy Java Code (Main.java)</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950 text-amber-400 border border-amber-800/60 font-mono">
                      Debug Required
                    </span>
                  </span>
                </div>
                <pre className="p-4 rounded-lg bg-zinc-950 border border-zinc-800 text-emerald-400 text-xs font-mono overflow-x-auto">
                  <code>{challengeDetails.starterCode}</code>
                </pre>
              </div>

              {/* Public Test Cases */}
              <div className="space-y-2">
                <h4 className="text-xs uppercase text-zinc-400 font-bold">Public Test Cases</h4>
                <div className="space-y-2">
                  {challengeDetails.publicTestCases.map((tc, idx) => (
                    <div key={tc.id || `tc-${idx}`} className="p-3 rounded-lg bg-zinc-950 border border-zinc-800 space-y-2 text-xs">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <div className="text-[10px] text-zinc-500 uppercase font-bold">Input #{tc.displayOrder || idx + 1}</div>
                          <div className="font-mono text-zinc-300 mt-1 bg-zinc-900 p-2 rounded border border-zinc-850 whitespace-pre-wrap">
                            {tc.inputData}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-zinc-500 uppercase font-bold">Expected Output</div>
                          <div className="font-mono text-emerald-400 mt-1 bg-zinc-900 p-2 rounded border border-zinc-850 whitespace-pre-wrap">
                            {tc.expectedOutput}
                          </div>
                        </div>
                      </div>
                      {tc.explanation && (
                        <div className="pt-1.5 border-t border-zinc-850/80">
                          <span className="text-[9px] text-zinc-500 uppercase font-bold block">Explanation:</span>
                          <div className="text-[11px] text-zinc-400 italic">
                            {tc.explanation}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : loadingChallenge ? (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-12 text-center text-zinc-500 flex flex-col items-center justify-center gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
              <span>Loading challenge environment...</span>
            </div>
          ) : challengeError ? (
            <div className="bg-zinc-900 border border-red-500/40 rounded-xl p-8 text-center space-y-3">
              <AlertTriangle className="w-6 h-6 text-red-400 mx-auto" />
              <div className="text-sm font-bold text-red-300">{challengeError}</div>
              <p className="text-xs text-zinc-400">
                This challenge cannot be accessed. Make sure your team has unlocked its difficulty tier.
              </p>
            </div>
          ) : (
            <div className="bg-zinc-900/60 border border-dashed border-zinc-800 rounded-xl p-12 text-center space-y-3">
              <Code2 className="w-8 h-8 text-zinc-600 mx-auto" />
              <div className="text-sm font-bold text-zinc-300">Select a Challenge to Begin</div>
              <p className="text-xs text-zinc-500 max-w-sm mx-auto">
                Choose any unlocked challenge on the left. All active problems within unlocked difficulty tiers are freely accessible.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
