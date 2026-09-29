/**
 * BUG SNIPER - Authoritative Match Timer Store & React Hook
 *
 * Enforces Competition Invariants:
 * 1. Server is the sole authority for time, duration, and match state.
 * 2. Component mount/unmount and challenge switching NEVER reset the timer.
 * 3. Page refreshes immediately restore the exact remaining time from server session/status.
 * 4. Local clock manipulation (e.g. altering OS date/time) cannot extend remaining time
 *    because tick progression uses monotonic performance.now() clamped by periodic server sync.
 * 5. State transitions:
 *    - NOT_STARTED: stays at totalSeconds without counting down.
 *    - RUNNING: counts down smoothly.
 *    - PAUSED: strictly freezes at server-authoritative remaining time.
 *    - ENDED: strictly displays 0 and stays ended.
 * 6. Match boundaries: New match cleanly initializes without leaking previous match values.
 * 7. Never persists authoritative time in localStorage (prevents client tamper).
 */

import { useState, useEffect } from 'react';

export interface AuthoritativeTimerSnapshot {
  currentMatchId: string | null;
  currentMatchNumber: number;
  status: 'NOT_STARTED' | 'RUNNING' | 'PAUSED' | 'ENDED';
  durationMinutes: number;
  totalSeconds: number;
  remainingSeconds: number;
  elapsedSeconds?: number;
  startedAt?: string | null;
  endedAt?: string | null;
  pausedAt?: string | null;
  scheduledEndTime?: string | null;
  serverTime?: string | null;
}

interface InternalTimerState {
  currentMatchId: string | null;
  currentMatchNumber: number;
  status: 'NOT_STARTED' | 'RUNNING' | 'PAUSED' | 'ENDED';
  durationMinutes: number;
  totalSeconds: number;
  remainingSeconds: number;
  startedAt: string | null;
  endedAt: string | null;
  pausedAt: string | null;
  scheduledEndTime: string | null;
  serverTime: string | null;
  syncPerfNow: number;
  syncTimestamp: number;
  lastSyncTime: number;
  isInitialized: boolean;
}

// Module-level singleton state persists across component unmounts and challenge navigation
const timerState: InternalTimerState = {
  currentMatchId: null,
  currentMatchNumber: 1,
  status: 'NOT_STARTED',
  durationMinutes: 60,
  totalSeconds: 3600,
  remainingSeconds: 3600,
  startedAt: null,
  endedAt: null,
  pausedAt: null,
  scheduledEndTime: null,
  serverTime: null,
  syncPerfNow: typeof performance !== 'undefined' ? performance.now() : 0,
  syncTimestamp: Date.now(),
  lastSyncTime: 0,
  isInitialized: false,
};

const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {}
  });
}

/**
 * Calculates current remaining seconds based on server-authoritative state
 * and monotonic elapsed time since the last synchronization anchor.
 */
export function getRemainingSeconds(): number {
  if (timerState.status === 'NOT_STARTED') {
    return timerState.totalSeconds || timerState.durationMinutes * 60;
  }
  if (timerState.status === 'PAUSED') {
    return Math.max(0, timerState.remainingSeconds);
  }
  if (timerState.status === 'ENDED') {
    return 0;
  }
  if (timerState.status === 'RUNNING') {
    const perfNow = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const elapsedSeconds = Math.max(0, Math.floor((perfNow - timerState.syncPerfNow) / 1000));
    return Math.max(0, timerState.remainingSeconds - elapsedSeconds);
  }
  return 0;
}

export function getTimerState(): Readonly<InternalTimerState> {
  return timerState;
}

export function resetTimerStore(): void {
  timerState.currentMatchId = null;
  timerState.currentMatchNumber = 1;
  timerState.status = 'NOT_STARTED';
  timerState.durationMinutes = 60;
  timerState.totalSeconds = 3600;
  timerState.remainingSeconds = 3600;
  timerState.startedAt = null;
  timerState.endedAt = null;
  timerState.pausedAt = null;
  timerState.scheduledEndTime = null;
  timerState.serverTime = null;
  timerState.syncPerfNow = typeof performance !== 'undefined' ? performance.now() : 0;
  timerState.syncTimestamp = Date.now();
  timerState.lastSyncTime = 0;
  timerState.isInitialized = false;
  notifyListeners();
}

export function formatTimerDisplay(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * Updates timer store from server-provided authoritative data.
 * Cleanly handles match transitions without leaking previous match timers.
 */
export function updateFromServer(data: Partial<AuthoritativeTimerSnapshot>): void {
  if (!data) return;

  const newMatchNumber = typeof data.currentMatchNumber === 'number' ? data.currentMatchNumber : timerState.currentMatchNumber;
  const newMatchId = data.currentMatchId !== undefined ? data.currentMatchId : timerState.currentMatchId;

  // Detect new match creation/switch: reset previous timer cleanly
  const isMatchChange =
    timerState.isInitialized &&
    ((typeof data.currentMatchNumber === 'number' && data.currentMatchNumber !== timerState.currentMatchNumber) ||
      (data.currentMatchId && timerState.currentMatchId && data.currentMatchId !== timerState.currentMatchId));

  if (isMatchChange) {
    timerState.currentMatchNumber = newMatchNumber;
    timerState.currentMatchId = newMatchId;
    timerState.status = data.status || 'NOT_STARTED';
    timerState.durationMinutes = typeof data.durationMinutes === 'number' ? data.durationMinutes : 60;
    timerState.totalSeconds = typeof data.totalSeconds === 'number' ? data.totalSeconds : (timerState.durationMinutes * 60);
    timerState.remainingSeconds = typeof data.remainingSeconds === 'number' ? Math.max(0, data.remainingSeconds) : (timerState.status === 'NOT_STARTED' ? timerState.totalSeconds : 0);
    timerState.startedAt = data.startedAt || null;
    timerState.endedAt = data.endedAt || null;
    timerState.pausedAt = data.pausedAt || null;
    timerState.scheduledEndTime = data.scheduledEndTime || null;
    timerState.serverTime = data.serverTime || null;
    timerState.syncPerfNow = typeof performance !== 'undefined' ? performance.now() : Date.now();
    timerState.syncTimestamp = Date.now();
    timerState.lastSyncTime = Date.now();
    timerState.isInitialized = true;
    notifyListeners();
    return;
  }

  timerState.currentMatchNumber = newMatchNumber;
  timerState.currentMatchId = newMatchId;

  if (data.status) {
    timerState.status = data.status;
  }

  if (typeof data.durationMinutes === 'number') {
    timerState.durationMinutes = data.durationMinutes;
  }
  if (typeof data.totalSeconds === 'number') {
    timerState.totalSeconds = data.totalSeconds;
  } else if (!timerState.totalSeconds) {
    timerState.totalSeconds = timerState.durationMinutes * 60;
  }

  if (timerState.status === 'ENDED') {
    timerState.remainingSeconds = 0;
  } else if (timerState.status === 'NOT_STARTED') {
    timerState.remainingSeconds = timerState.totalSeconds;
  } else if (typeof data.remainingSeconds === 'number') {
    timerState.remainingSeconds = Math.max(0, data.remainingSeconds);
  }

  if (data.startedAt !== undefined) timerState.startedAt = data.startedAt || null;
  if (data.endedAt !== undefined) timerState.endedAt = data.endedAt || null;
  if (data.pausedAt !== undefined) timerState.pausedAt = data.pausedAt || null;
  if (data.scheduledEndTime !== undefined) timerState.scheduledEndTime = data.scheduledEndTime || null;
  if (data.serverTime !== undefined) timerState.serverTime = data.serverTime || null;

  timerState.syncPerfNow = typeof performance !== 'undefined' ? performance.now() : Date.now();
  timerState.syncTimestamp = Date.now();
  timerState.lastSyncTime = Date.now();
  timerState.isInitialized = true;

  notifyListeners();
}

/**
 * Authoritatively fetches `/api/event/status` and syncs the in-memory timer store.
 */
export async function syncWithServer(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - timerState.lastSyncTime < 2500) {
    return; // Debounce rapid sync requests
  }

  try {
    const res = await fetch('/api/event/status');
    if (res.ok) {
      const data = await res.json();
      if (data && data.success !== false) {
        updateFromServer({
          currentMatchId: data.currentMatchId,
          currentMatchNumber: data.currentMatchNumber,
          status: data.status,
          durationMinutes: data.durationMinutes,
          totalSeconds: data.totalSeconds,
          remainingSeconds: data.remainingSeconds,
          startedAt: data.startedAt,
          endedAt: data.endedAt,
          pausedAt: data.pausedAt,
          scheduledEndTime: data.scheduledEndTime,
          serverTime: data.serverTime,
        });
      }
    }
  } catch {
    // Network error: preserve existing state without crashing
  }
}

/**
 * React Hook for consuming the Authoritative Match Timer in components.
 */
export function useAuthoritativeTimer(initialTimer?: Partial<AuthoritativeTimerSnapshot>) {
  if (initialTimer) {
    const isNewerMatch =
      (typeof initialTimer.currentMatchNumber === 'number' && initialTimer.currentMatchNumber !== timerState.currentMatchNumber) ||
      (initialTimer.currentMatchId && initialTimer.currentMatchId !== timerState.currentMatchId);
    if (!timerState.isInitialized || isNewerMatch) {
      updateFromServer(initialTimer);
    }
  }

  const [remaining, setRemaining] = useState<number>(() => getRemainingSeconds());
  const [currentStatus, setCurrentStatus] = useState<string>(() => timerState.status);
  const [matchNumber, setMatchNumber] = useState<number>(() => timerState.currentMatchNumber);
  const [matchId, setMatchId] = useState<string | null>(() => timerState.currentMatchId);

  useEffect(() => {
    const onStoreChange = () => {
      setRemaining(getRemainingSeconds());
      setCurrentStatus(timerState.status);
      setMatchNumber(timerState.currentMatchNumber);
      setMatchId(timerState.currentMatchId);
    };

    listeners.add(onStoreChange);

    // Initial check/sync
    if (!timerState.isInitialized || Date.now() - timerState.lastSyncTime > 5000) {
      syncWithServer(true);
    }

    // Tick countdown every second when RUNNING
    const tickInterval = setInterval(() => {
      const cur = getRemainingSeconds();
      setRemaining(cur);
      if (timerState.status === 'RUNNING' && cur <= 0) {
        syncWithServer(true);
      }
    }, 1000);

    // Periodic authoritative sync every 10 seconds
    const syncInterval = setInterval(() => {
      syncWithServer(false);
    }, 10000);

    // Re-sync immediately on window focus or visibility restoration
    const handleVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        syncWithServer(true);
      }
    };
    const handleFocus = () => {
      syncWithServer(true);
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibility);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleFocus);
    }

    return () => {
      listeners.delete(onStoreChange);
      clearInterval(tickInterval);
      clearInterval(syncInterval);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', handleFocus);
      }
    };
  }, []);

  return {
    remainingSeconds: remaining,
    status: currentStatus,
    currentMatchNumber: matchNumber,
    currentMatchId: matchId,
    durationMinutes: timerState.durationMinutes,
    totalSeconds: timerState.totalSeconds,
    syncWithServer: () => syncWithServer(true),
    updateFromServer,
  };
}
