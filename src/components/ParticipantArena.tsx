/**
 * BUG RIP - Participant Coding Arena (Fragment 7)
 * Primary competitive programming & CTF interface for solo participants.
 * 
 * Architecture & Invariants:
 * 1. Requires valid participant session (server-derived identity).
 * 2. Synchronized with server-authoritative 60-minute competition clock.
 * 3. Monaco Java Editor with syntax highlighting, keyboard shortcuts, and dark theme.
 * 4. Free challenge selection within unlocked difficulties (no intra-tier sequential lock).
 * 5. Local working draft persistence with "Reset to Starter Code".
 * 6. Validated execution requests to POST /api/challenges/:id/run.
 * 7. Real status handling (QUEUED, RUNNING, COMPILE_ERROR, etc.) with NO fake execution output.
 * 8. Terminal output console and secure Flag area (no leaked flags or test cases).
 * 9. Solo participant state with independent progress, score, and solved-challenge states.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import {
  Terminal,
  Clock,
  LogOut,
  Play,
  RotateCcw,
  CheckCircle2,
  Lock,
  Unlock,
  AlertCircle,
  PauseCircle,
  AlertOctagon,
  FileCode,
  Layers,
  ChevronRight,
  Sparkles,
  User,
  Users,
  Trophy,
  Loader2,
  XCircle,
  Save,
  Flag,
  ExternalLink,
  Info,
  Copy,
  Check,
  Send,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Maximize2,
  Minimize2,
} from 'lucide-react';

interface ParticipantArenaProps {
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
  maxOutputBytes?: number;
  maxSourceBytes?: number;
  status: string;
  attemptCount: number;
  publicTestCases: Array<{
    id: string;
    inputData: string;
    expectedOutput: string;
    displayOrder?: number;
    explanation?: string | null;
  }>;
}

interface ExecutionResult {
  submissionId?: string;
  status:
    | 'QUEUED'
    | 'RUNNING'
    | 'SUCCESS'
    | 'COMPILE_ERROR'
    | 'RUNTIME_ERROR'
    | 'TIMEOUT'
    | 'MEMORY_LIMIT'
    | 'OUTPUT_LIMIT'
    | 'SANDBOX_ERROR'
    | 'QUEUE_ERROR';
  stdout?: string;
  stderr?: string;
  message?: string;
  executionTimeMs?: number;
  submittedAt?: string;
  behaviorStatus?: string;
  behaviorDiagnostics?: {
    testsPassed?: boolean;
    flagRevealed?: boolean;
    diagnosticMessage?: string;
  };
  revealedFlag?: string;
}

const arenaFetch = (url: string, options: RequestInit = {}) => {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('bugrip_participant_token') : null;
  const headers = new Headers(options.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (token && !headers.has('X-Session-Token')) {
    headers.set('X-Session-Token', token);
  }
  return fetch(url, {
    ...options,
    credentials: 'include',
    headers,
  });
};

export const ParticipantArena: React.FC<ParticipantArenaProps> = ({
  team,
  eventStatus: initialStatus,
  onLogout,
  onReturnToWaiting,
}) => {
  // Authoritative State
  const [currentStatus, setCurrentStatus] = useState<string>(initialStatus || 'RUNNING');
  const [remainingSeconds, setRemainingSeconds] = useState<number>(3600);
  const [loggingOut, setLoggingOut] = useState(false);

  // Team Progression & Member Counts
  const [connectedCount, setConnectedCount] = useState<number>(team.connectedMemberCount || 1);
  const [registeredCount, setRegisteredCount] = useState<number>(team.registeredMemberCount || 2);
  const [progression, setProgression] = useState<ProgressionResponse | null>(null);

  // Selected Difficulty & Challenge
  const [selectedRoundSlug, setSelectedRoundSlug] = useState<string>('easy');
  const [activeChallengeId, setActiveChallengeId] = useState<string | null>(null);
  const [challengeDetails, setChallengeDetails] = useState<ChallengeDetails | null>(null);
  const [loadingChallenge, setLoadingChallenge] = useState(false);
  const [challengeError, setChallengeError] = useState<string | null>(null);

  // Monaco Code & Draft State
  const [editorSource, setEditorSource] = useState<string>('');
  const [hasDraft, setHasDraft] = useState<boolean>(false);
  const [editorInstance, setEditorInstance] = useState<any>(null);
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const editorContainerRef = useRef<HTMLDivElement | null>(null);

  // Remeasure Monaco fonts and force layout synchronization
  const relayoutAndRemeasure = useCallback(() => {
    if (monacoRef.current) {
      try {
        monacoRef.current.editor?.remeasureFonts?.();
      } catch (err) {
        console.warn('Monaco remeasureFonts warning:', err);
      }
    }
    if (editorRef.current) {
      try {
        editorRef.current.layout?.();
      } catch (err) {
        console.warn('Monaco layout warning:', err);
      }
    }
  }, []);

  // ResizeObserver on editor container to guarantee pixel-accurate layout
  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;

    let resizeTimer: any = null;
    const observer = new ResizeObserver(() => {
      if (editorRef.current) {
        try {
          editorRef.current.layout?.();
        } catch {}
      }
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        relayoutAndRemeasure();
      }, 50);
    });

    observer.observe(container);

    return () => {
      clearTimeout(resizeTimer);
      observer.disconnect();
    };
  }, [relayoutAndRemeasure]);

  // Window resize & DevicePixelRatio / Zoom Level changes
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleResizeOrZoom = () => {
      relayoutAndRemeasure();
    };

    window.addEventListener('resize', handleResizeOrZoom);
    const mediaQuery = window.matchMedia ? window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`) : null;
    mediaQuery?.addEventListener?.('change', handleResizeOrZoom);

    return () => {
      window.removeEventListener('resize', handleResizeOrZoom);
      mediaQuery?.removeEventListener?.('change', handleResizeOrZoom);
    };
  }, [relayoutAndRemeasure]);

  // Execution Run State
  const [submittingRun, setSubmittingRun] = useState<boolean>(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null);

  // Flag Submission & Completion State (Fragment 9)
  const [flagInput, setFlagInput] = useState<string>('');
  const [submittingFlag, setSubmittingFlag] = useState<boolean>(false);
  const [flagSubmitError, setFlagSubmitError] = useState<string | null>(null);
  const [flagSubmitSuccess, setFlagSubmitSuccess] = useState<string | null>(null);
  const [newlyUnlockedTierAlert, setNewlyUnlockedTierAlert] = useState<string | null>(null);
  const [copiedFlag, setCopiedFlag] = useState<boolean>(false);

  // Duplicate Completion Notice State
  const [alreadyCompletedAlert, setAlreadyCompletedAlert] = useState<boolean>(false);
  const previousCompletionRef = useRef<boolean>(false);

  // Anti-Cheat & Client Integrity State (Fragment 12)
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => {
    if (typeof document !== 'undefined') {
      return Boolean(document.fullscreenElement);
    }
    return false;
  });

  // Layout updates on fullscreen and active challenge changes
  useEffect(() => {
    const t = setTimeout(relayoutAndRemeasure, 100);
    return () => clearTimeout(t);
  }, [isFullscreen, activeChallengeId, relayoutAndRemeasure]);
  const [antiCheatNotice, setAntiCheatNotice] = useState<string | null>(null);
  const hiddenTimestampRef = useRef<number | null>(null);
  const lastBlurRef = useRef<number>(0);
  const lastFocusRef = useRef<number>(0);

  // Send integrity signal helper
  const sendIntegrityEvent = useCallback(
    async (eventType: string, metadata: Record<string, any> = {}) => {
      try {
        await arenaFetch('/api/anti-cheat/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventType,
            challengeId: activeChallengeId || undefined,
            metadata: {
              ...metadata,
              activeChallengeId: activeChallengeId || undefined,
              viewportWidth: typeof window !== 'undefined' ? window.innerWidth : 0,
              viewportHeight: typeof window !== 'undefined' ? window.innerHeight : 0,
              timestamp: Date.now(),
            },
          }),
        });
      } catch {
        // Non-critical background telemetry
      }
    },
    [activeChallengeId]
  );

  // Toggle/Request Fullscreen
  const toggleFullscreen = useCallback(async () => {
    try {
      if (typeof document === 'undefined') return;
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        setIsFullscreen(true);
        setAntiCheatNotice(null);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch (err) {
      console.warn('Fullscreen request dismissed or not permitted:', err);
    }
  }, []);

  // Anti-Cheat Event Listeners (Fullscreen, Tab Switch, Window Blur)
  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    const handleFullscreenChange = () => {
      const active = Boolean(document.fullscreenElement);
      setIsFullscreen(active);
      if (currentStatus === 'RUNNING') {
        if (!active) {
          sendIntegrityEvent('FULLSCREEN_EXIT');
          setAntiCheatNotice(
            'Anti-Cheat Alert: Fullscreen exited. This event was logged. Click "Return to Fullscreen" to maintain competition integrity.'
          );
        } else {
          sendIntegrityEvent('FULLSCREEN_ENTER');
          setAntiCheatNotice(null);
        }
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        hiddenTimestampRef.current = Date.now();
        if (currentStatus === 'RUNNING') {
          sendIntegrityEvent('TAB_HIDDEN', { visibilityState: 'hidden' });
        }
      } else {
        const durationSeconds = hiddenTimestampRef.current
          ? Math.max(1, Math.round((Date.now() - hiddenTimestampRef.current) / 1000))
          : 0;
        hiddenTimestampRef.current = null;
        if (currentStatus === 'RUNNING') {
          sendIntegrityEvent('TAB_VISIBLE', { durationSeconds });
          if (durationSeconds >= 2) {
            setAntiCheatNotice(
              `Anti-Cheat Notice: Tab focus lost for ${durationSeconds}s and logged to integrity monitor.`
            );
          }
        }
      }
    };

    const handleWindowBlur = () => {
      // If document is already hidden, tab switch was already reported as TAB_HIDDEN
      if (typeof document !== 'undefined' && document.hidden) return;
      const now = Date.now();
      if (now - lastBlurRef.current > 1200) {
        lastBlurRef.current = now;
        if (currentStatus === 'RUNNING') {
          sendIntegrityEvent('WINDOW_BLUR');
        }
      }
    };

    const handleWindowFocus = () => {
      const now = Date.now();
      if (now - lastFocusRef.current > 1200) {
        lastFocusRef.current = now;
        if (currentStatus === 'RUNNING') {
          sendIntegrityEvent('WINDOW_FOCUS');
        }
      }
    };

    let resizeTimer: any = null;
    let lastDimensions = {
      width: typeof window !== 'undefined' ? window.innerWidth : 0,
      height: typeof window !== 'undefined' ? window.innerHeight : 0,
    };

    const handleResize = () => {
      if (currentStatus !== 'RUNNING') return;
      if (resizeTimer) clearTimeout(resizeTimer);

      resizeTimer = setTimeout(() => {
        if (typeof window === 'undefined') return;
        const currentWidth = window.innerWidth;
        const currentHeight = window.innerHeight;
        const deltaX = Math.abs(currentWidth - lastDimensions.width);
        const deltaY = Math.abs(currentHeight - lastDimensions.height);

        // Only emit if there is a meaningful viewport dimension change (>25px)
        if (deltaX > 25 || deltaY > 25) {
          lastDimensions = { width: currentWidth, height: currentHeight };
          sendIntegrityEvent('VIEWPORT_CHANGE', {
            viewportWidth: currentWidth,
            viewportHeight: currentHeight,
            screenWidth: window.screen?.width,
            screenHeight: window.screen?.height,
            reason: 'WINDOW_RESIZE',
          });
        }
      }, 800);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('resize', handleResize);

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('resize', handleResize);
    };
  }, [currentStatus, sendIntegrityEvent]);

  // Initial reconnect/mount telemetry signal
  useEffect(() => {
    sendIntegrityEvent('RECONNECT', { mode: 'ARENA_MOUNT' });
  }, [sendIntegrityEvent]);

  // Periodic participant heartbeat to keep session and connection alive
  useEffect(() => {
    const sendHeartbeat = async () => {
      try {
        await arenaFetch('/api/auth/heartbeat', { method: 'POST' });
      } catch {}
    };
    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 5000);
    return () => clearInterval(interval);
  }, []);

  // ===========================================================================
  // 1. Authoritative Clock & Event Sync
  // ===========================================================================
  const syncEventStatus = useCallback(async () => {
    try {
      const res = await arenaFetch('/api/event/status');
      if (res.ok) {
        const data = await res.json();
        if (data.status) {
          setCurrentStatus(data.status);
          if (data.status === 'NOT_STARTED' && onReturnToWaiting) {
            onReturnToWaiting();
          }
        }
        if (typeof data.remainingSeconds === 'number') {
          setRemainingSeconds(Math.max(0, data.remainingSeconds));
        }
      }
    } catch {
      // Network hiccup - preserve current state
    }
  }, [onReturnToWaiting]);

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
  }, [currentStatus, syncEventStatus]);

  // ===========================================================================
  // 2. Refresh Team Details & Shared Progression
  // ===========================================================================
  const fetchTeamDetails = useCallback(async () => {
    try {
      const res = await arenaFetch('/api/teams/me');
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data) {
          if (typeof data.data.connectedMemberCount === 'number') {
            setConnectedCount(data.data.connectedMemberCount);
          }
          if (typeof data.data.registeredMemberCount === 'number') {
            setRegisteredCount(data.data.registeredMemberCount);
          }
        }
      }
    } catch {
      // Ignore background sync errors
    }
  }, []);

  const fetchProgression = useCallback(async () => {
    try {
      const res = await arenaFetch('/api/challenges');
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data) {
          setProgression(data.data);

          // Check if active challenge was completed
          if (activeChallengeId) {
            const currentItem = data.data.challenges?.find(
              (c: ChallengeItem) => c.id === activeChallengeId
            );
            if (currentItem && currentItem.status === 'COMPLETED') {
              previousCompletionRef.current = true;
              // Update challengeDetails status if loaded
              setChallengeDetails((prev) => (prev ? { ...prev, status: 'COMPLETED' } : null));
            }
          }
        }
      }
    } catch (err) {
      console.error('Failed to load progression:', err);
    }
  }, [activeChallengeId]);

  // Periodic polling every 4 seconds for event clock, progression, and connected sessions (fallback & initial sync)
  useEffect(() => {
    syncEventStatus();
    fetchTeamDetails();
    fetchProgression();

    const interval = setInterval(() => {
      syncEventStatus();
      fetchTeamDetails();
      fetchProgression();
    }, 4000);

    return () => clearInterval(interval);
  }, [syncEventStatus, fetchTeamDetails, fetchProgression]);

  const activeChallengeIdRef = useRef(activeChallengeId);
  activeChallengeIdRef.current = activeChallengeId;
  const onReturnToWaitingRef = useRef(onReturnToWaiting);
  onReturnToWaitingRef.current = onReturnToWaiting;
  const fetchProgressionRef = useRef(fetchProgression);
  fetchProgressionRef.current = fetchProgression;

  // Real-time SSE Synchronization (Fragment 10)
  useEffect(() => {
    let eventSource: EventSource | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;
    let unmounted = false;

    const connectSSE = () => {
      if (unmounted) return;
      try {
        const storedToken = typeof localStorage !== 'undefined' ? localStorage.getItem('bugrip_participant_token') : null;
        const sseUrl = storedToken ? `/api/teams/stream?token=${encodeURIComponent(storedToken)}` : '/api/teams/stream';
        eventSource = new EventSource(sseUrl, { withCredentials: true });

        eventSource.addEventListener('team.init', (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data);
            if (typeof data.connectedMemberCount === 'number') {
              setConnectedCount(data.connectedMemberCount);
            }
            if (typeof data.registeredMemberCount === 'number') {
              setRegisteredCount(data.registeredMemberCount);
            }
            if (data.progression) {
              setProgression(data.progression);
            }
          } catch {}
        });

        // Canonical solo competition events
        const handleChallengeCompleted = (data: any) => {
          setProgression((prev) => {
            if (!prev) return prev;
            const updatedChallenges = prev.challenges.map((c) =>
              c.id === data.challengeId ? { ...c, status: 'COMPLETED' } : c
            );
            return {
              ...prev,
              problemsSolved: data.problemsSolved ?? prev.problemsSolved,
              totalScore: data.totalScore ?? prev.totalScore,
              challenges: updatedChallenges,
            };
          });

          if (activeChallengeIdRef.current === data.challengeId) {
            setChallengeDetails((prev) => (prev ? { ...prev, status: 'COMPLETED' } : null));
          }

          fetchProgressionRef.current();
        };

        eventSource.addEventListener('challenge.completed', (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data);
            handleChallengeCompleted(data);
          } catch {}
        });

        eventSource.addEventListener('team.challenge.completed', (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data);
            handleChallengeCompleted(data);
          } catch {}
        });

        eventSource.addEventListener('progression.unlocked', (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data);
            const alertText = data.roundName
              ? `${String(data.roundName).toUpperCase()} UNLOCKED.`
              : 'NEW DIFFICULTY UNLOCKED.';
            setNewlyUnlockedTierAlert(alertText);
            fetchProgressionRef.current();
          } catch {}
        });

        eventSource.addEventListener('team.challenge.unlocked', (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data);
            const alertText = data.roundName
              ? `${String(data.roundName).toUpperCase()} UNLOCKED.`
              : 'NEW DIFFICULTY UNLOCKED.';
            setNewlyUnlockedTierAlert(alertText);
            fetchProgressionRef.current();
          } catch {}
        });

        eventSource.addEventListener('score.updated', (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data);
            setProgression((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                totalScore: data.totalScore ?? prev.totalScore,
                problemsSolved: data.problemsSolved ?? prev.problemsSolved,
              };
            });
          } catch {}
        });

        eventSource.addEventListener('solved-count.updated', (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data);
            setProgression((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                problemsSolved: data.problemsSolved ?? prev.problemsSolved,
              };
            });
          } catch {}
        });

        eventSource.addEventListener('team.progress.updated', (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data);
            setProgression((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                problemsSolved: data.problemsSolved ?? prev.problemsSolved,
                totalScore: data.totalScore ?? prev.totalScore,
              };
            });
          } catch {}
        });

        eventSource.addEventListener('team.member.connected', (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data);
            if (typeof data.connectedCount === 'number') {
              setConnectedCount(data.connectedCount);
            }
          } catch {}
        });

        eventSource.addEventListener('team.member.disconnected', (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data);
            if (typeof data.connectedCount === 'number') {
              setConnectedCount(data.connectedCount);
            }
          } catch {}
        });

        eventSource.addEventListener('team.session.updated', (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data);
            if (typeof data.connectedCount === 'number') {
              setConnectedCount(data.connectedCount);
            }
          } catch {}
        });

        eventSource.addEventListener('event.status.changed', (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data);
            if (data.status) {
              setCurrentStatus(data.status);
              if (data.status === 'NOT_STARTED' && onReturnToWaitingRef.current) {
                onReturnToWaitingRef.current();
              }
            }
          } catch {}
        });

        eventSource.onerror = () => {
          if (eventSource) {
            eventSource.close();
            eventSource = null;
          }
          if (!unmounted) {
            reconnectTimeout = setTimeout(connectSSE, 3000);
          }
        };
      } catch {
        if (!unmounted) {
          reconnectTimeout = setTimeout(connectSSE, 3000);
        }
      }
    };

    const handleLeave = () => {
      try {
        const storedToken = typeof localStorage !== 'undefined' ? localStorage.getItem('bugrip_participant_token') : '';
        const url = storedToken ? `/api/auth/disconnect?token=${encodeURIComponent(storedToken)}` : '/api/auth/disconnect';
        const payload = JSON.stringify({ token: storedToken });
        if (navigator.sendBeacon) {
          const blob = new Blob([payload], { type: 'application/json' });
          navigator.sendBeacon(url, blob);
        } else {
          arenaFetch(url, {
            method: 'POST',
            body: payload,
            headers: { 'Content-Type': 'application/json' },
            keepalive: true,
          }).catch(() => {});
        }
      } catch {}
    };
    window.addEventListener('pagehide', handleLeave);
    window.addEventListener('beforeunload', handleLeave);

    connectSSE();

    return () => {
      unmounted = true;
      window.removeEventListener('pagehide', handleLeave);
      window.removeEventListener('beforeunload', handleLeave);
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    };
  }, []);

  // ===========================================================================
  // 3. Challenge Loading & Local Draft Handling
  // ===========================================================================
  const getDraftStorageKey = (challengeId: string) => `bugrip_draft_${team.id}_${challengeId}`;

  const loadChallenge = async (id: string) => {
    setActiveChallengeId(id);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(`bugrip_active_challenge_${team.id}`, id);
      } catch {}
    }
    setLoadingChallenge(true);
    setChallengeError(null);
    setAlreadyCompletedAlert(false);
    setRunError(null);
    setFlagInput('');
    setFlagSubmitError(null);
    setFlagSubmitSuccess(null);
    setNewlyUnlockedTierAlert(null);
    setCopiedFlag(false);

    try {
      const res = await arenaFetch(`/api/challenges/${id}`);
      const data = await res.json();

      if (res.ok && data.success && data.data) {
        const details: ChallengeDetails = data.data;
        setChallengeDetails(details);
        previousCompletionRef.current = details.status === 'COMPLETED';

        // Draft restoration logic:
        const draftKey = getDraftStorageKey(details.id);
        const savedDraft = localStorage.getItem(draftKey);
        if (savedDraft !== null && savedDraft.trim() !== '') {
          setEditorSource(savedDraft);
          setHasDraft(true);
        } else {
          setEditorSource(details.starterCode || '');
          setHasDraft(false);
        }

        // Fetch recent run submissions for this challenge
        fetchSubmissions(details.id);
      } else {
        setChallengeError(data.error || 'Failed to load challenge details.');
        setChallengeDetails(null);
      }
    } catch (err: any) {
      setChallengeError(err.message || 'Network error while loading challenge.');
      setChallengeDetails(null);
    } finally {
      setLoadingChallenge(false);
    }
  };

  const fetchSubmissions = async (challengeId: string) => {
    try {
      const res = await arenaFetch(`/api/challenges/${challengeId}/submissions`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.data) && data.data.length > 0) {
          const latest = data.data[0];
          setExecutionResult({
            submissionId: latest.id,
            status: latest.executionStatus,
            stdout: latest.stdout,
            stderr: latest.stderr,
            submittedAt: latest.createdAt,
            behaviorStatus: latest.behaviorStatus,
            behaviorDiagnostics: latest.behaviorDiagnostics,
            revealedFlag: latest.revealedFlag,
          });

          if (latest.revealedFlag) {
            setFlagInput(latest.revealedFlag);
          } else if (latest.stdout) {
            const match = latest.stdout.match(/DBG\{[A-Za-z0-9_\-]{4,64}\}/);
            if (match) {
              setFlagInput(match[0]);
            }
          }
        }
      }
    } catch {
      // Non-critical
    }
  };

  // Automatically select first available challenge or restore saved selection
  useEffect(() => {
    if (!activeChallengeId && progression && progression.rounds.length > 0) {
      if (typeof localStorage !== 'undefined') {
        const savedActiveId = localStorage.getItem(`bugrip_active_challenge_${team.id}`);
        if (savedActiveId) {
          const savedChal = progression.challenges.find(
            (c) => c.id === savedActiveId && c.status !== 'LOCKED'
          );
          if (savedChal) {
            loadChallenge(savedChal.id);
            return;
          }
        }
      }

      const easyRound = progression.rounds.find((r) => r.slug === 'easy') || progression.rounds[0];
      if (easyRound && easyRound.isUnlocked) {
        const firstChallenge = progression.challenges.find((c) => c.roundId === easyRound.id);
        if (firstChallenge && firstChallenge.status !== 'LOCKED') {
          loadChallenge(firstChallenge.id);
        }
      }
    }
  }, [progression, activeChallengeId, team.id]);

  // Handle Monaco editor changes & draft caching
  const handleEditorChange = (value: string | undefined) => {
    const updated = value ?? '';
    setEditorSource(updated);
    if (activeChallengeId) {
      const draftKey = getDraftStorageKey(activeChallengeId);
      localStorage.setItem(draftKey, updated);
      setHasDraft(true);
    }
  };

  // Reset editor to authoritative starter code
  const handleResetStarterCode = () => {
    if (!challengeDetails) return;
    if (
      window.confirm(
        'Are you sure you want to reset to the original starter code? Any unsaved local edits will be cleared.'
      )
    ) {
      setEditorSource(challengeDetails.starterCode);
      if (activeChallengeId) {
        localStorage.removeItem(getDraftStorageKey(activeChallengeId));
      }
      setHasDraft(false);
    }
  };

  // Monaco Editor Mount
  const handleEditorDidMount: OnMount = (editor, monaco) => {
    setEditorInstance(editor);
    editorRef.current = editor;
    monacoRef.current = monaco;

    const remeasure = () => {
      try {
        monaco.editor?.remeasureFonts?.();
        editor.layout?.();
      } catch (err) {
        console.warn('Monaco remeasure/layout error:', err);
      }
    };

    // Immediate font remeasurement and container layout calculation
    remeasure();

    // Secondary pass on animation frame once DOM styles and fonts render
    if (typeof window !== 'undefined') {
      requestAnimationFrame(() => {
        remeasure();
      });
      setTimeout(remeasure, 100);
      setTimeout(remeasure, 300);
    }

    // Critical: remeasure when custom web fonts finish downloading
    if (typeof document !== 'undefined' && (document as any).fonts) {
      (document as any).fonts.ready?.then?.(() => {
        remeasure();
      })?.catch?.(() => {});

      (document as any).fonts.addEventListener?.('loadingdone', () => {
        remeasure();
      });
    }
  };

  // ===========================================================================
  // 4. Run Code Request Preparation (Fragment 7 Contract)
  // ===========================================================================
  const handleRunCode = async () => {
    if (!activeChallengeId || !challengeDetails) return;
    if (currentStatus !== 'RUNNING') {
      setRunError(`Cannot run code while competition is ${currentStatus}.`);
      return;
    }
    if (challengeDetails.status === 'LOCKED') {
      setRunError('Cannot execute code for a locked challenge.');
      return;
    }
    if (!editorSource || editorSource.trim().length === 0) {
      setRunError('Source code cannot be empty.');
      return;
    }

    // Client-side source size warning
    const maxBytes = challengeDetails.maxSourceBytes || 65536;
    const currentBytes = new TextEncoder().encode(editorSource).length;
    if (currentBytes > maxBytes) {
      setRunError(`SOURCE CODE TOO LARGE: Code size (${currentBytes} B) exceeds maximum limit of ${maxBytes} B.`);
      return;
    }

    setSubmittingRun(true);
    setRunError(null);

    // Initial queued state feedback
    setExecutionResult({
      status: 'QUEUED',
      stdout: 'Validating source code and preparing execution request...',
      message: 'SUBMITTING...',
    });

    try {
      const runEndpoint = `/api/challenges/${activeChallengeId}/run`;
      console.log(`[ParticipantArena] Executing code: POST ${runEndpoint}`, {
        challengeId: activeChallengeId,
        sourceBytes: currentBytes,
      });

      const res = await arenaFetch(runEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceCode: editorSource }),
      });

      const contentType = res.headers.get('content-type') || '';
      console.log(`[ParticipantArena] Run response received:`, {
        status: res.status,
        statusText: res.statusText,
        contentType,
        endpoint: runEndpoint,
      });

      let data: any = null;

      if (!contentType.includes('application/json')) {
        const rawText = await res.text();
        const snippet = rawText.slice(0, 100).replace(/[\r\n\t]+/g, ' ');
        const diagnosticErr = `HTTP ${res.status}: Expected JSON response from execution API but received ${contentType || 'text/html'}.\nEndpoint: ${runEndpoint}\nPreview: ${snippet}`;
        console.error('[ParticipantArena] Non-JSON response from execution API:', {
          status: res.status,
          contentType,
          endpoint: runEndpoint,
          snippet,
        });
        setRunError(diagnosticErr);
        setExecutionResult({
          status: 'QUEUE_ERROR',
          stderr: diagnosticErr,
        });
        setSubmittingRun(false);
        return;
      }

      try {
        data = await res.json();
      } catch (parseError: any) {
        const parseErrMsg = `HTTP ${res.status}: Failed to parse JSON response (${parseError.message}).\nEndpoint: ${runEndpoint}`;
        console.error('[ParticipantArena] JSON parse failure:', parseError);
        setRunError(parseErrMsg);
        setExecutionResult({
          status: 'QUEUE_ERROR',
          stderr: parseErrMsg,
        });
        setSubmittingRun(false);
        return;
      }

      if (res.ok && data?.success) {
        const submissionId = data.data.submissionId;
        setExecutionResult({
          submissionId,
          status: data.data.status || 'QUEUED',
          stdout: 'Code execution request enqueued for isolated sandbox worker...',
          stderr: '',
          submittedAt: data.data.submittedAt,
        });

        // Update attempt count in state
        if (data.data.attemptCount) {
          setChallengeDetails((prev) =>
            prev ? { ...prev, attemptCount: data.data.attemptCount } : null
          );
        }

        // Poll execution status until terminal
        const pollInterval = setInterval(async () => {
          try {
            const pollUrl = `/api/challenges/${activeChallengeId}/executions/${submissionId}`;
            const execRes = await arenaFetch(pollUrl);
            if (!execRes.ok) return;

            const pollContentType = execRes.headers.get('content-type') || '';
            if (!pollContentType.includes('application/json')) return;

            const execData = await execRes.json();
            if (execData.success && execData.data) {
              const item = execData.data;
              setExecutionResult({
                submissionId: item.id,
                status: item.status,
                stdout: item.stdout,
                stderr: item.stderr,
                executionTimeMs: item.executionTimeMs,
                submittedAt: item.createdAt,
                behaviorStatus: item.behaviorStatus,
                behaviorDiagnostics: item.behaviorDiagnostics,
                revealedFlag: item.revealedFlag,
              });

              if (item.revealedFlag) {
                setFlagInput(item.revealedFlag);
              } else if (item.stdout) {
                const match = item.stdout.match(/DBG\{[A-Za-z0-9_\-]{4,64}\}/);
                if (match) {
                  setFlagInput(match[0]);
                }
              }

              if (item.status !== 'QUEUED' && item.status !== 'RUNNING') {
                clearInterval(pollInterval);
                setSubmittingRun(false);
              }
            }
          } catch {
            // Ignore temporary network poll errors
          }
        }, 500);

        // Fallback safety timeout (15 seconds)
        setTimeout(() => {
          clearInterval(pollInterval);
          setSubmittingRun(false);
        }, 15000);

        // Keep submittingRun true during execution polling
        return;
      } else {
        const errorVal = data?.error || data?.message;
        const errMsg = typeof errorVal === 'object'
          ? (errorVal.message || JSON.stringify(errorVal))
          : (typeof errorVal === 'string' && errorVal.trim().length > 0 ? errorVal : `Execution failed with HTTP ${res.status}.`);
        setRunError(errMsg);
        setExecutionResult({
          status: 'QUEUE_ERROR',
          stderr: errMsg,
        });
        setSubmittingRun(false);
      }
    } catch (err: any) {
      const errMsg = err.message || 'Network error communicating with execution server.';
      setRunError(errMsg);
      setExecutionResult({
        status: 'QUEUE_ERROR',
        stderr: errMsg,
      });
      setSubmittingRun(false);
    }
  };

  // ===========================================================================
  // 5. Submit Flag Handler (Fragment 9 CTF Pipeline)
  // ===========================================================================
  const handleSubmitFlag = async (overrideFlag?: string) => {
    const flagToSubmit = (overrideFlag || flagInput || '').trim();
    if (!activeChallengeId || !flagToSubmit) return;

    if (currentStatus !== 'RUNNING') {
      setFlagSubmitError(`Cannot submit flag while competition is ${currentStatus}.`);
      return;
    }

    setSubmittingFlag(true);
    setFlagSubmitError(null);
    setFlagSubmitSuccess(null);

    try {
      const res = await arenaFetch(`/api/challenges/${activeChallengeId}/submit-flag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flag: flagToSubmit,
          executionId: executionResult?.submissionId,
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setFlagSubmitSuccess(data.message || 'FLAG ACCEPTED! Challenge completed.');
        setFlagSubmitError(null);

        // Update challenge details
        setChallengeDetails((prev) =>
          prev ? { ...prev, status: 'COMPLETED' } : null
        );

        // Refetch authoritative progression
        await fetchProgression();

        if (data.data?.unlockedRounds && data.data.unlockedRounds.length > 0) {
          const rounds = data.data.unlockedRounds.map(String).join(', ').toUpperCase();
          setNewlyUnlockedTierAlert(`Unlocked Difficulties: ${rounds}`);
        }
      } else {
        if (
          data.code === 'ALREADY_COMPLETED' ||
          data.code === 'TEAMMATE_ALREADY_COMPLETED' ||
          data.alreadyCompleted
        ) {
          setAlreadyCompletedAlert(true);
          setChallengeDetails((prev) =>
            prev ? { ...prev, status: 'COMPLETED' } : null
          );
          await fetchProgression();
        }
        setFlagSubmitError(data.message || data.error || 'Failed to submit flag.');
      }
    } catch (err: any) {
      setFlagSubmitError(err.message || 'Network error communicating with flag validation server.');
    } finally {
      setSubmittingFlag(false);
    }
  };

  // Format time MM:SS
  const formatTime = (secs: number) => {
    const clamped = Math.max(0, secs);
    const mins = Math.floor(clamped / 60);
    const s = clamped % 60;
    return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleLogoutClick = async () => {
    setLoggingOut(true);
    try {
      const storedToken = typeof localStorage !== 'undefined' ? localStorage.getItem('bugrip_participant_token') : '';
      await arenaFetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: storedToken }),
      });
    } catch {
      // Cleanup regardless
    } finally {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('bugrip_participant_token');
      }
      setLoggingOut(false);
      onLogout();
    }
  };

  const isPaused = currentStatus === 'PAUSED';
  const isEnded = currentStatus === 'ENDED';

  // Derived Round & Challenges Navigation
  const currentRound =
    progression?.rounds.find((r) => r.slug === selectedRoundSlug) || progression?.rounds[0];
  const roundChallenges =
    progression?.challenges.filter((c) => c.roundId === currentRound?.id) || [];

  return (
    <div id="coding-arena-root" className="space-y-4 font-mono text-zinc-100">
      {/* ========================================================================= */}
      {/* 5. TEAM HEADER                                                            */}
      {/* ========================================================================= */}
      <header
        id="arena-team-header"
        className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 shadow-2xl flex flex-col md:flex-row items-center justify-between gap-4"
      >
        {/* Left: Branding & Team Details */}
        <div className="flex items-center gap-4 w-full md:w-auto">
          <div className="w-11 h-11 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center shrink-0">
            <Terminal className="w-6 h-6 text-emerald-400" />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase text-zinc-500 font-bold tracking-wider">BUG SNIPER ARENA</span>
              <span
                id="arena-status-badge"
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

            <div className="text-base font-black text-white flex items-center gap-2 mt-0.5">
              <span id="arena-team-name">{team.teamName}</span>
            </div>
          </div>
        </div>

        {/* Center/Right: Key Metrics HUD */}
        <div className="flex flex-wrap items-center gap-4 sm:gap-6 justify-between md:justify-end w-full md:w-auto">
          {/* Solo Competitor Session */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs">
            <Users className="w-4 h-4 text-cyan-400" />
            <div>
              <div className="text-[9px] uppercase text-zinc-500 font-bold">MODE</div>
              <div id="arena-connected-members" className="font-bold text-zinc-200">
                SOLO (1/1)
              </div>
            </div>
          </div>

          {/* Solved Problems */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <div>
              <div className="text-[9px] uppercase text-zinc-500 font-bold">SOLVED</div>
              <div id="arena-solved-count" className="font-bold text-emerald-400">
                {progression?.problemsSolved ?? 0}
              </div>
            </div>
          </div>

          {/* Score */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs">
            <Trophy className="w-4 h-4 text-amber-400" />
            <div>
              <div className="text-[9px] uppercase text-zinc-500 font-bold">SCORE</div>
              <div id="arena-team-score" className="font-bold text-amber-400">
                {progression?.totalScore ?? 0}
              </div>
            </div>
          </div>

          {/* Fullscreen & Anti-Cheat Mode Toggle */}
          <div className="flex items-center">
            {isFullscreen ? (
              <button
                id="arena-fullscreen-active-badge"
                onClick={toggleFullscreen}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-950/30 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-900/30 text-xs font-bold transition-all cursor-pointer"
                title="Fullscreen Anti-Cheat Active. Click to exit."
              >
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span className="hidden lg:inline text-[10px] tracking-wider">FULLSCREEN</span>
                <Minimize2 className="w-3 h-3 text-emerald-400" />
              </button>
            ) : (
              <button
                id="arena-enter-fullscreen-btn"
                onClick={toggleFullscreen}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-950/40 border border-amber-500/50 hover:bg-amber-900/40 text-amber-300 text-xs font-bold transition-all cursor-pointer"
                title="Enter Fullscreen mode (recommended for competition integrity)"
              >
                <Maximize2 className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-[10px] tracking-wider">FULLSCREEN</span>
              </button>
            )}
          </div>

          {/* Authoritative 60-Minute Countdown Clock */}
          <div className="text-right pl-2 border-l border-zinc-800">
            <div className="text-[9px] uppercase tracking-wider text-zinc-500 flex items-center justify-end gap-1 font-bold">
              <Clock className="w-3 h-3 text-emerald-400" />
              <span>TIME LEFT</span>
            </div>
            <div
              id="arena-authoritative-timer"
              className={`text-2xl sm:text-3xl font-black font-mono tracking-tight ${
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

          {/* Leave/Logout */}
          <button
            id="arena-logout-button"
            onClick={handleLogoutClick}
            disabled={loggingOut}
            className="p-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-850 text-zinc-400 hover:text-red-400 border border-zinc-800 hover:border-red-500/40 transition-colors cursor-pointer"
            title="Leave Arena"
          >
            {loggingOut ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* Anti-Cheat & Client Integrity Notice (Fragment 12) */}
      {antiCheatNotice && (
        <div
          id="arena-anti-cheat-alert"
          className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-500/50 text-amber-200 text-xs flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xl backdrop-blur-xs animate-in fade-in duration-300"
        >
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0" />
            <div>
              <span className="font-bold text-amber-300 mr-2">INTEGRITY NOTICE:</span>
              <span>{antiCheatNotice}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!isFullscreen && (
              <button
                id="arena-alert-return-fullscreen"
                onClick={toggleFullscreen}
                className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs transition-all cursor-pointer shadow-md active:scale-95"
              >
                Return to Fullscreen
              </button>
            )}
            <button
              onClick={() => setAntiCheatNotice(null)}
              className="px-2 py-1 rounded text-zinc-400 hover:text-zinc-200 text-xs transition-colors cursor-pointer"
              title="Dismiss Notice"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 6. COMPETITION PAUSED BANNER                                              */}
      {/* ========================================================================= */}
      {isPaused && (
        <div
          id="arena-paused-banner"
          className="relative overflow-hidden rounded-xl border border-amber-500/50 bg-amber-950/30 p-4 text-center shadow-2xl flex flex-col sm:flex-row items-center justify-center gap-3"
        >
          <PauseCircle className="w-6 h-6 text-amber-400 shrink-0" />
          <div className="text-left">
            <div className="text-sm font-black text-white tracking-tight">
              COMPETITION PAUSED
            </div>
            <div className="text-xs text-amber-200">
              Your competition time is currently stopped. Code execution and submissions are suspended until the organizer resumes the event.
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 6. COMPETITION ENDED BANNER                                               */}
      {/* ========================================================================= */}
      {isEnded && (
        <div
          id="arena-ended-banner"
          className="relative overflow-hidden rounded-xl border border-red-500/50 bg-red-950/30 p-4 text-center shadow-2xl flex flex-col sm:flex-row items-center justify-center gap-3"
        >
          <AlertOctagon className="w-6 h-6 text-red-400 shrink-0" />
          <div className="text-left">
            <div className="text-sm font-black text-white tracking-tight">
              COMPETITION ENDED
            </div>
            <div className="text-xs text-zinc-300">
              The competition is over. The authoritative 60-minute duration has elapsed. Final standings and tiebreakers are being calculated.
            </div>
          </div>
        </div>
      )}


      {/* ========================================================================= */}
      {/* 4. MAIN ARENA LAYOUT (Sidebar + Editor / Workspace)                      */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* ======================================================================= */}
        {/* LEFT COLUMN: DIFFICULTIES & CHALLENGES NAVIGATION (lg:col-span-3)      */}
        {/* ======================================================================= */}
        <div id="arena-navigation-sidebar" className="lg:col-span-3 space-y-3">
          {/* Difficulty Tiers Selector */}
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 space-y-2">
            <div className="text-[10px] uppercase text-zinc-500 font-bold tracking-wider px-1 flex items-center justify-between">
              <span>DIFFICULTIES</span>
              {progression?.progressionMode === 'UNLOCK_ALL' && (
                <span className="text-[9px] text-amber-400 font-bold">ALL UNLOCKED</span>
              )}
            </div>

            <div className="space-y-1.5">
              {progression?.rounds.map((round, idx) => {
                const isSelected = round.slug === selectedRoundSlug;
                const roundSolves =
                  progression.challenges.filter(
                    (c) => c.roundId === round.id && c.status === 'COMPLETED'
                  ).length || 0;
                const totalInRound =
                  progression.challenges.filter((c) => c.roundId === round.id).length ||
                  round.challengesCount;

                return (
                  <button
                    key={round.id}
                    id={`diff-btn-${round.slug}`}
                    onClick={() => setSelectedRoundSlug(round.slug)}
                    className={`w-full p-2.5 rounded-lg border text-left transition-all cursor-pointer flex items-center justify-between ${
                      isSelected
                        ? 'border-blue-500 bg-blue-950/30 text-white'
                        : round.isUnlocked
                        ? 'border-zinc-800/80 bg-zinc-900/60 hover:bg-zinc-850 text-zinc-300'
                        : 'border-zinc-850/60 bg-zinc-950/40 text-zinc-600 opacity-60 hover:opacity-80'
                    }`}
                  >
                    <div>
                      <div className="text-xs font-bold flex items-center gap-1.5">
                        {round.isUnlocked ? (
                          <Unlock className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Lock className="w-3 h-3 text-zinc-500" />
                        )}
                        <span>{(round?.name || '').toUpperCase()}</span>
                      </div>
                      <div className="text-[10px] text-zinc-500 mt-0.5">
                        {round.isUnlocked
                          ? `${totalInRound} available challenges • ${roundSolves} solved`
                          : `LOCKED • ${totalInRound} challenges`}
                      </div>
                    </div>

                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold ${
                        round.isUnlocked
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                          : 'bg-zinc-900 text-zinc-500 border border-zinc-800'
                      }`}
                    >
                      {totalInRound} ch
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Challenges List in Current Difficulty */}
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 space-y-2">
            <div className="text-[10px] uppercase text-zinc-500 font-bold tracking-wider px-1 flex items-center justify-between">
              <span>{(currentRound?.name || 'CURRENT').toUpperCase()} CHALLENGES</span>
              <span id="arena-available-challenges-count">{roundChallenges.length} available challenges</span>
            </div>

            {currentRound && !currentRound.isUnlocked ? (
              <div
                id="arena-tier-locked-notice"
                className="p-4 rounded-lg bg-zinc-900/40 border border-zinc-850 text-center space-y-2"
              >
                <Lock className="w-6 h-6 text-zinc-600 mx-auto" />
                <div className="text-xs font-bold text-zinc-400">TIER LOCKED</div>
                <p className="text-[11px] text-zinc-500 leading-relaxed">
                  {currentRound.unlockRequiredSolves > 0
                    ? `Solve ${currentRound.solvesRemainingToUnlock ?? currentRound.unlockRequiredSolves} more problem(s) in the preceding tier to unlock ${currentRound.name}.`
                    : 'This tier is currently locked by tournament progression rules.'}
                </p>
              </div>
            ) : roundChallenges.length === 0 ? (
              <div className="p-4 rounded-lg bg-zinc-900/40 text-center text-xs text-zinc-500">
                No active challenges found in this tier.
              </div>
            ) : (
              <div id="arena-challenges-list" className="space-y-1.5 max-h-[500px] overflow-y-auto pr-1">
                {roundChallenges.map((chal, index) => {
                  const isSelected = chal.id === activeChallengeId;
                  const isCompleted = chal.status === 'COMPLETED';
                  const isLocked = chal.status === 'LOCKED';

                  return (
                    <button
                      key={chal.id}
                      id={`challenge-item-${chal.id}`}
                      onClick={() => loadChallenge(chal.id)}
                      disabled={isLocked}
                      className={`w-full p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                        isSelected
                          ? 'border-blue-500 bg-blue-950/40 text-white shadow-sm'
                          : isCompleted
                          ? 'border-emerald-500/40 bg-emerald-950/15 hover:bg-emerald-950/25 text-zinc-200'
                          : isLocked
                          ? 'border-zinc-900 bg-zinc-950/30 text-zinc-600 cursor-not-allowed opacity-50'
                          : 'border-zinc-800/80 bg-zinc-900/50 hover:bg-zinc-850 text-zinc-300'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold font-mono text-zinc-400">
                          #{index + 1} {chal.title}
                        </span>
                        <span className="text-[10px] font-bold text-amber-400/90 font-mono">
                          +{chal.score}
                        </span>
                      </div>

                      <div className="flex items-center justify-between mt-1 text-[10px]">
                        <span className="text-zinc-500 font-mono">{chal.id}</span>
                        <span
                          className={`font-bold flex items-center gap-1 ${
                            isCompleted
                              ? 'text-emerald-400'
                              : isSelected
                              ? 'text-blue-400'
                              : isLocked
                              ? 'text-zinc-600'
                              : 'text-zinc-400'
                          }`}
                        >
                          {isCompleted ? (
                            <>
                              <CheckCircle2 className="w-3 h-3" />
                              <span>SOLVED</span>
                            </>
                          ) : isSelected ? (
                            <span>ACTIVE</span>
                          ) : isLocked ? (
                            <span>LOCKED</span>
                          ) : (
                            <span>OPEN</span>
                          )}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ======================================================================= */}
        {/* MAIN WORKSPACE: CHALLENGE DETAILS, MONACO EDITOR, RUN, OUTPUT (col-span-9) */}
        {/* ======================================================================= */}
        <div id="arena-main-workspace" className="lg:col-span-9 space-y-4">
          {loadingChallenge ? (
            <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-16 text-center text-zinc-500 flex flex-col items-center justify-center gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
              <span className="text-xs uppercase tracking-wider font-bold">
                Loading challenge environment...
              </span>
            </div>
          ) : challengeError ? (
            <div className="bg-zinc-950 border border-red-500/40 rounded-xl p-8 text-center space-y-3">
              <AlertCircle className="w-8 h-8 text-red-400 mx-auto" />
              <div className="text-sm font-bold text-red-300">{challengeError}</div>
              <p className="text-xs text-zinc-400 max-w-md mx-auto">
                Unable to load this challenge. Please verify you have unlocked this difficulty tier or select another active problem.
              </p>
            </div>
          ) : activeChallengeId && challengeDetails ? (
            <div className="space-y-4">
              {/* Challenge Header & Constraints Bar */}
              <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 shadow-xl space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-zinc-800/80">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-bold font-mono">
                        ROUND: {(challengeDetails?.roundName || '').toUpperCase()}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400 text-xs font-mono">
                        ID: {challengeDetails.id}
                      </span>
                      {challengeDetails.status === 'COMPLETED' && (
                        <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold flex items-center gap-1 font-mono">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>SOLVED</span>
                        </span>
                      )}
                    </div>
                    <h2 id="arena-challenge-title" className="text-xl sm:text-2xl font-black text-white mt-1">
                      {challengeDetails.title}
                    </h2>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="text-[10px] text-zinc-500 font-bold uppercase">REWARD</div>
                    <div className="text-2xl font-black text-amber-400 font-mono">
                      +{challengeDetails.score} PTS
                    </div>
                  </div>
                </div>

                {/* Problem Description Statement */}
                <div className="space-y-1">
                  <div className="text-[10px] uppercase text-zinc-500 font-bold tracking-wider">
                    PROBLEM STATEMENT
                  </div>
                  <div
                    id="arena-problem-description"
                    className="p-3.5 rounded-lg bg-zinc-900/70 border border-zinc-800 text-xs text-zinc-200 leading-relaxed font-sans whitespace-pre-wrap"
                  >
                    {challengeDetails.description}
                  </div>
                </div>

                {/* Public Constraints Pills */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="p-2 rounded bg-zinc-900/60 border border-zinc-850">
                    <span className="text-[9px] text-zinc-500 uppercase font-bold block">Validation</span>
                    <span className="font-mono text-zinc-300 font-bold">{challengeDetails.validationType}</span>
                  </div>
                  <div className="p-2 rounded bg-zinc-900/60 border border-zinc-850">
                    <span className="text-[9px] text-zinc-500 uppercase font-bold block">Time Limit</span>
                    <span className="font-mono text-zinc-300 font-bold">{challengeDetails.timeLimitMs} ms</span>
                  </div>
                  <div className="p-2 rounded bg-zinc-900/60 border border-zinc-850">
                    <span className="text-[9px] text-zinc-500 uppercase font-bold block">Memory Limit</span>
                    <span className="font-mono text-zinc-300 font-bold">{challengeDetails.memoryLimitMb} MB</span>
                  </div>
                  <div className="p-2 rounded bg-zinc-900/60 border border-zinc-850">
                    <span className="text-[9px] text-zinc-500 uppercase font-bold block">Attempts</span>
                    <span className="font-mono text-zinc-300 font-bold">{challengeDetails.attemptCount} (unlimited)</span>
                  </div>
                </div>
              </div>

              {/* Public Test Cases Preview */}
              {challengeDetails.publicTestCases && challengeDetails.publicTestCases.length > 0 && (
                <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3.5 space-y-2">
                  <div className="text-[10px] uppercase text-zinc-500 font-bold tracking-wider flex items-center justify-between">
                    <span>PUBLIC TEST CASES (EXEMPLARS)</span>
                    <span className="text-zinc-500 font-normal">Hidden test cases evaluated on server</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    {challengeDetails.publicTestCases.map((tc, i) => (
                      <div key={tc.id || `tc-${tc.displayOrder || i}`} className="p-2.5 rounded-lg bg-zinc-900/80 border border-zinc-850 text-xs space-y-1.5 flex flex-col justify-between">
                        <div className="space-y-1">
                          <div className="text-[10px] font-bold text-zinc-400 uppercase flex items-center justify-between">
                            <span>Test Case #{tc.displayOrder ?? i + 1}</span>
                          </div>
                          <div>
                            <span className="text-[9px] text-zinc-500 uppercase font-bold block">Input:</span>
                            <pre className="font-mono text-zinc-300 bg-zinc-950 p-1.5 rounded border border-zinc-850/60 text-[11px] overflow-x-auto whitespace-pre-wrap break-all">
                              {tc.inputData}
                            </pre>
                          </div>
                          <div>
                            <span className="text-[9px] text-zinc-500 uppercase font-bold block">Expected Output:</span>
                            <pre className="font-mono text-emerald-400 bg-zinc-950 p-1.5 rounded border border-zinc-850/60 text-[11px] overflow-x-auto whitespace-pre-wrap break-all">
                              {tc.expectedOutput}
                            </pre>
                          </div>
                        </div>
                        {tc.explanation && (
                          <div className="pt-1.5 border-t border-zinc-850/80">
                            <span className="text-[9px] text-zinc-500 uppercase font-bold block">Explanation:</span>
                            <div className="text-[11px] text-zinc-400 italic leading-snug">
                              {tc.explanation}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ================================================================= */}
              {/* 12. MONACO JAVA EDITOR                                           */}
              {/* ================================================================= */}
              <div
                id="arena-monaco-container"
                className="bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden shadow-2xl space-y-0"
              >
                {/* Editor Header Bar */}
                <div className="bg-zinc-900/90 px-4 py-2 border-b border-zinc-800 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <FileCode className="w-4 h-4 text-amber-400" />
                    <span className="font-bold text-zinc-100 font-mono">Main.java</span>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-700/60">
                      Buggy Code (Debug Required)
                    </span>
                    <span className="text-[10px] text-zinc-500 font-normal hidden sm:inline">• OpenJDK 21</span>
                    {hasDraft && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-cyan-300 border border-zinc-700 flex items-center gap-1">
                        <Save className="w-3 h-3" />
                        <span>Draft Saved Locally</span>
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      id="arena-reset-code-btn"
                      onClick={handleResetStarterCode}
                      className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-750 text-zinc-300 hover:text-white text-[11px] font-bold border border-zinc-700 flex items-center gap-1.5 transition-colors cursor-pointer"
                      title="Reset editor back to initial buggy Java code"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Reset Buggy Code</span>
                    </button>
                  </div>
                </div>

                {/* Monaco Editor Canvas */}
                <div
                  ref={editorContainerRef}
                  id="monaco-canvas-wrapper"
                  className="relative h-[460px] w-full bg-[#1e1e1e] overflow-hidden"
                >
                  <Editor
                    height="100%"
                    defaultLanguage="java"
                    language="java"
                    theme="vs-dark"
                    value={editorSource}
                    onChange={handleEditorChange}
                    onMount={handleEditorDidMount}
                    options={{
                      minimap: { enabled: false },
                      fontSize: 14,
                      lineHeight: 22,
                      letterSpacing: 0,
                      fontLigatures: false,
                      fontFamily:
                        "'JetBrains Mono', Menlo, Monaco, Consolas, 'Courier New', monospace",
                      lineNumbers: 'on',
                      automaticLayout: true,
                      scrollBeyondLastLine: false,
                      tabSize: 4,
                      renderWhitespace: 'selection',
                      bracketPairColorization: { enabled: true },
                      folding: true,
                      wordWrap: 'on',
                      cursorBlinking: 'blink',
                      cursorStyle: 'line',
                      cursorWidth: 2,
                      readOnly: isPaused || isEnded,
                    }}
                  />
                </div>

                {/* Editor Action & Run Footer */}
                <div className="bg-zinc-900/90 px-4 py-3 border-t border-zinc-800 flex flex-col sm:flex-row items-center justify-between gap-3">
                  <div className="flex items-center gap-3 text-xs text-zinc-400">
                    <span className="font-mono">
                      {new TextEncoder().encode(editorSource).length} /{' '}
                      {challengeDetails.maxSourceBytes || 65536} bytes
                    </span>
                    <span className="text-zinc-600">•</span>
                    <span className="text-[11px] text-zinc-500">
                      Unlimited executions permitted
                    </span>
                  </div>

                  <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                    {/* RUN CODE BUTTON */}
                    <button
                      id="arena-run-code-btn"
                      onClick={handleRunCode}
                      disabled={
                        submittingRun ||
                        isPaused ||
                        isEnded ||
                        challengeDetails.status === 'LOCKED' ||
                        !editorSource.trim()
                      }
                      className={`px-5 py-2 rounded-xl font-bold font-mono text-xs flex items-center gap-2 transition-all cursor-pointer shadow-lg ${
                        submittingRun
                          ? 'bg-blue-600 text-white opacity-80 cursor-wait'
                          : isPaused || isEnded || challengeDetails.status === 'LOCKED'
                          ? 'bg-zinc-800 text-zinc-500 border border-zinc-700 cursor-not-allowed'
                          : 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-emerald-500/20 active:scale-95'
                      }`}
                    >
                      {submittingRun ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>SUBMITTING...</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4 fill-current" />
                          <span>RUN CODE</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Validation/Run Error Alert */}
              {runError && (
                <div
                  id="arena-run-error-alert"
                  className="p-3 rounded-lg bg-red-950/30 border border-red-500/40 text-red-300 text-xs flex items-center gap-2"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                  <span>{runError}</span>
                </div>
              )}

              {/* ================================================================= */}
              {/* 20. OUTPUT CONSOLE (Terminal Style)                              */}
              {/* ================================================================= */}
              <div
                id="arena-output-console"
                className="bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden shadow-xl"
              >
                <div className="bg-zinc-900/80 px-4 py-2 border-b border-zinc-800 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-cyan-400" />
                    <span className="font-bold uppercase tracking-wider text-zinc-300">
                      OUTPUT CONSOLE
                    </span>
                    {executionResult?.status && (
                      <span
                        id="arena-execution-status-badge"
                        className={`text-[10px] px-2.5 py-0.5 rounded-full font-mono font-bold uppercase tracking-wider ${
                          executionResult.status === 'SUCCESS'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            : executionResult.status === 'QUEUED'
                            ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40 animate-pulse'
                            : executionResult.status === 'RUNNING'
                            ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 animate-pulse'
                            : executionResult.status === 'COMPILE_ERROR'
                            ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                            : executionResult.status === 'RUNTIME_ERROR'
                            ? 'bg-orange-500/20 text-orange-300 border border-orange-500/40'
                            : executionResult.status === 'TIMEOUT'
                            ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                            : executionResult.status === 'OUTPUT_LIMIT'
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                            : executionResult.status === 'SANDBOX_ERROR'
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                            : executionResult.status === 'QUEUE_ERROR'
                            ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                            : 'bg-zinc-800 text-zinc-300 border border-zinc-700'
                        }`}
                      >
                        {executionResult.status === 'SUCCESS'
                          ? 'RUN SUCCESS (EXIT 0)'
                          : executionResult.status === 'COMPILE_ERROR'
                          ? 'COMPILATION FAILED'
                          : executionResult.status === 'RUNTIME_ERROR'
                          ? 'RUNTIME EXCEPTION'
                          : executionResult.status === 'TIMEOUT'
                          ? 'TIME LIMIT EXCEEDED'
                          : executionResult.status === 'OUTPUT_LIMIT'
                          ? 'OUTPUT TRUNCATED'
                          : executionResult.status === 'SANDBOX_ERROR'
                          ? (executionResult.stderr?.includes('JAVA COMPILER UNAVAILABLE') ? 'JAVA COMPILER UNAVAILABLE' : 'SYSTEM ERROR')
                          : executionResult.status === 'QUEUE_ERROR'
                          ? 'QUEUE FAILURE'
                          : executionResult.status}
                      </span>
                    )}
                  </div>

                  {executionResult && (
                    <button
                      onClick={() => setExecutionResult(null)}
                      className="text-[10px] text-zinc-500 hover:text-zinc-300 cursor-pointer"
                    >
                      Clear Output
                    </button>
                  )}
                </div>

                <div className="p-4 bg-[#0d0f17] font-mono text-xs text-zinc-300 min-h-[120px] max-h-[260px] overflow-y-auto">
                  {!executionResult ? (
                    <div className="text-zinc-600 italic">
                      OUTPUT
                      <br />
                      No execution yet. Click &quot;RUN CODE&quot; to compile and test your debugged code in the sandbox.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {executionResult.stdout && (
                        <div>
                          <div className="text-[10px] uppercase text-zinc-500 font-bold mb-1">STDOUT:</div>
                          <pre className="text-emerald-400/90 whitespace-pre-wrap bg-zinc-950/80 p-2 rounded border border-zinc-850">
                            {executionResult.stdout}
                          </pre>
                        </div>
                      )}
                      {executionResult.stderr && (
                        <div>
                          <div className="text-[10px] uppercase text-red-400 font-bold mb-1">
                            {executionResult.status === 'COMPILE_ERROR'
                              ? 'COMPILER DIAGNOSTICS (JAVAC):'
                              : executionResult.status === 'RUNTIME_ERROR'
                              ? 'STDERR / EXCEPTION TRACE:'
                              : executionResult.status === 'SANDBOX_ERROR'
                              ? 'SYSTEM DIAGNOSTIC:'
                              : 'STDERR / COMPILER:'}
                          </div>
                          <pre className="text-red-400 whitespace-pre-wrap bg-red-950/20 p-2 rounded border border-red-900/40">
                            {executionResult.stderr}
                          </pre>
                        </div>
                      )}
                      {executionResult.submittedAt && (
                        <div className="flex items-center justify-between text-[10px] text-zinc-600 pt-1 border-t border-zinc-900">
                          <span>Submitted: {new Date(executionResult.submittedAt).toLocaleTimeString()}</span>
                          {executionResult.executionTimeMs !== undefined && (
                            <span className="font-mono text-zinc-400">Duration: {executionResult.executionTimeMs}ms</span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* ================================================================= */}
              {/* 21. FLAG AREA (Fragment 9 CTF Flag Reveal, Submission & Solve)   */}
              {/* ================================================================= */}
              <div
                id="arena-flag-container"
                className="bg-zinc-950 border border-zinc-800 rounded-xl p-5 shadow-xl space-y-4"
              >
                {/* Header & Status */}
                <div className="flex items-center justify-between">
                  <div className="text-[11px] uppercase text-zinc-400 font-bold tracking-wider flex items-center gap-2">
                    <Flag className="w-4 h-4 text-amber-400" />
                    <span>FLAG VERIFICATION & SUBMISSION</span>
                  </div>

                  <div>
                    {challengeDetails.status === 'COMPLETED' ? (
                      <span
                        id="arena-flag-status-badge"
                        className="px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        <span>SOLVED (+{challengeDetails.score} PTS)</span>
                      </span>
                    ) : executionResult?.revealedFlag || executionResult?.behaviorDiagnostics?.flagRevealed ? (
                      <span
                        id="arena-flag-status-badge"
                        className="px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 flex items-center gap-1 animate-pulse"
                      >
                        <Sparkles className="w-3 h-3" />
                        <span>FLAG REVEALED</span>
                      </span>
                    ) : (
                      <span
                        id="arena-flag-status-badge"
                        className="px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono bg-zinc-800 text-zinc-400 border border-zinc-700 flex items-center gap-1"
                      >
                        <Lock className="w-3 h-3" />
                        <span>NOT SOLVED</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Case A: Solved / Completed */}
                {challengeDetails.status === 'COMPLETED' && (
                  <div
                    id="arena-challenge-completed-card"
                    className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-500/30 flex items-center gap-3.5"
                  >
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center shrink-0">
                      <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                    </div>
                    <div className="space-y-0.5">
                      <div className="font-bold text-sm text-emerald-300">
                        FLAG ACCEPTED — PROBLEM SOLVED!
                      </div>
                      <p className="text-xs text-zinc-400">
                        You have earned <span className="text-emerald-300 font-bold font-mono">+{challengeDetails.score} points</span>. Authoritative solved count and score are updated.
                      </p>
                    </div>
                  </div>
                )}

                {/* Case B: Duplicate Solve Attempt Warning */}
                {alreadyCompletedAlert && challengeDetails.status !== 'COMPLETED' && (
                  <div
                    id="arena-already-completed-alert"
                    className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-500/40 text-amber-200 text-xs flex items-center gap-3"
                  >
                    <CheckCircle2 className="w-5 h-5 text-amber-400 shrink-0" />
                    <div>
                      <div className="font-bold">THIS PROBLEM HAS ALREADY BEEN COMPLETED.</div>
                      <p className="text-zinc-400 text-[11px] mt-0.5">
                        You have already received full credit for this challenge.
                      </p>
                    </div>
                  </div>
                )}

                {/* Case C: Newly Unlocked Tier Notification */}
                {newlyUnlockedTierAlert && (
                  <div
                    id="arena-unlocked-tier-alert"
                    className="p-3 rounded-xl bg-cyan-950/30 border border-cyan-500/40 text-cyan-200 text-xs flex items-center gap-2.5"
                  >
                    <Unlock className="w-4 h-4 text-cyan-400 shrink-0" />
                    <span>{newlyUnlockedTierAlert}</span>
                  </div>
                )}

                {/* Case D: Flag Revealed by Sandbox Execution */}
                {challengeDetails.status !== 'COMPLETED' && (executionResult?.revealedFlag || (executionResult?.behaviorStatus === 'PASS' && executionResult?.stdout && /DBG\{[A-Za-z0-9_\-]{4,64}\}/.test(executionResult.stdout))) && (
                  <div
                    id="arena-revealed-flag-box"
                    className="p-4 rounded-xl bg-cyan-950/20 border border-cyan-500/30 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-bold text-cyan-300 flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-cyan-400" />
                        <span>FLAG REVEALED IN SANDBOX EXECUTION!</span>
                      </div>
                      <span className="text-[10px] text-zinc-500 font-mono">Format: DBG{`{...}`}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <code
                        id="arena-revealed-flag-text"
                        className="flex-1 px-3 py-2 rounded-lg bg-zinc-900 border border-cyan-500/40 font-mono text-xs text-cyan-200 font-bold select-all tracking-wide"
                      >
                        {executionResult?.revealedFlag || executionResult?.stdout?.match(/DBG\{[A-Za-z0-9_\-]{4,64}\}/)?.[0]}
                      </code>

                      <button
                        type="button"
                        onClick={() => {
                          const flagText = executionResult?.revealedFlag || executionResult?.stdout?.match(/DBG\{[A-Za-z0-9_\-]{4,64}\}/)?.[0] || '';
                          navigator.clipboard.writeText(flagText);
                          setCopiedFlag(true);
                          setTimeout(() => setCopiedFlag(false), 2000);
                        }}
                        className="px-3 py-2 rounded-lg bg-zinc-850 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-700 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                        title="Copy flag to clipboard"
                      >
                        {copiedFlag ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="text-emerald-400">Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const flagText = executionResult?.revealedFlag || executionResult?.stdout?.match(/DBG\{[A-Za-z0-9_\-]{4,64}\}/)?.[0] || '';
                          setFlagInput(flagText);
                          handleSubmitFlag(flagText);
                        }}
                        disabled={submittingFlag || isPaused || isEnded}
                        className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-lg shadow-emerald-500/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Send className="w-3.5 h-3.5 fill-current" />
                        <span>Auto-Submit</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Case E: Interactive Flag Submission Form */}
                {challengeDetails.status !== 'COMPLETED' && (
                  <div className="space-y-3 pt-1">
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                      <div className="relative flex-1">
                        <input
                          id="arena-flag-input"
                          type="text"
                          value={flagInput}
                          onChange={(e) => setFlagInput(e.target.value)}
                          placeholder="DBG{YOUR_SOLVED_FLAG_HERE}"
                          disabled={submittingFlag || isPaused || isEnded}
                          className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-700 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 text-xs font-mono text-zinc-100 placeholder:text-zinc-600 outline-none transition-all"
                        />
                      </div>

                      <button
                        id="arena-submit-flag-btn"
                        type="button"
                        onClick={() => handleSubmitFlag()}
                        disabled={
                          submittingFlag ||
                          !flagInput.trim() ||
                          isPaused ||
                          isEnded ||
                          challengeDetails.status === 'COMPLETED'
                        }
                        className={`px-5 py-2.5 rounded-xl font-bold font-mono text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shrink-0 ${
                          submittingFlag
                            ? 'bg-blue-600 text-white opacity-80 cursor-wait'
                            : !flagInput.trim() || isPaused || isEnded
                            ? 'bg-zinc-800 text-zinc-500 border border-zinc-700 cursor-not-allowed'
                            : 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-lg shadow-emerald-500/20 active:scale-95'
                        }`}
                      >
                        {submittingFlag ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>VERIFYING...</span>
                          </>
                        ) : (
                          <>
                            <Flag className="w-3.5 h-3.5 fill-current" />
                            <span>SUBMIT FLAG</span>
                          </>
                        )}
                      </button>
                    </div>

                    {/* Flag Error Message */}
                    {flagSubmitError && (
                      <div
                        id="arena-flag-error-alert"
                        className="p-3 rounded-lg bg-red-950/30 border border-red-500/40 text-red-300 text-xs flex items-center gap-2"
                      >
                        <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                        <span>{flagSubmitError}</span>
                      </div>
                    )}

                    {/* Flag Success Message */}
                    {flagSubmitSuccess && (
                      <div
                        id="arena-flag-success-alert"
                        className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-2"
                      >
                        <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                        <span>{flagSubmitSuccess}</span>
                      </div>
                    )}

                    {!executionResult?.revealedFlag && (
                      <div className="p-3 rounded-lg bg-zinc-900/40 border border-zinc-800/80 flex items-start gap-2.5 text-[11px] text-zinc-500 leading-relaxed">
                        <Info className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
                        <div>
                          <span>
                            Execution success alone does not complete a challenge. Fix the code defect so that the program passes all behavioral checks and prints the canonical <code className="text-zinc-400 font-mono">DBG{`{...}`}</code> flag.
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-zinc-950 border border-dashed border-zinc-800 rounded-xl p-16 text-center space-y-3">
              <Terminal className="w-10 h-10 text-zinc-600 mx-auto" />
              <div className="text-base font-bold text-zinc-300">Select a Challenge to Begin</div>
              <p className="text-xs text-zinc-500 max-w-md mx-auto leading-relaxed">
                Choose any unlocked problem from the difficulties on the left. All active challenges within unlocked tiers are freely selectable in any order.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
