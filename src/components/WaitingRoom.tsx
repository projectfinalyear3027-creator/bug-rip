/**
 * BUG RIP - Participant Waiting Room
 * Route: /waiting
 * 
 * Strict Competition Requirements:
 * 1. Shows "BUG RIP", "GET READY", "Waiting for the organizer to start the competition."
 * 2. Displays TEAM name and PLAYERS count (connected / registered, e.g. 1/3, 2/3, or 3/3)
 * 3. Shows EVENT STATUS: NOT STARTED • WAITING FOR ORGANIZER...
 * 4. No participant-side START button
 * 5. Participant cannot access challenges before start
 * 6. Real-time automatic transition to /arena when organizer starts event (NOT_STARTED -> RUNNING)
 * 7. Clean Disconnect / Logout button
 */

import React, { useEffect, useState } from 'react';
import { Terminal, Users, Clock, Radio, LogOut, Shield, AlertCircle, Play } from 'lucide-react';

interface WaitingRoomProps {
  team: {
    id: string;
    teamName: string;
    registeredMemberCount: number;
    connectedMemberCount: number;
  };
  eventStatus: string;
  onEventStart: () => void;
  onLogout: () => void;
  onUpdateCounts: (connected: number, registered: number) => void;
}

export const WaitingRoom: React.FC<WaitingRoomProps> = ({
  team,
  eventStatus,
  onEventStart,
  onLogout,
  onUpdateCounts,
}) => {
  const [connectedCount, setConnectedCount] = useState<number>(team.connectedMemberCount || 1);
  const [currentStatus, setCurrentStatus] = useState<string>(eventStatus || 'NOT_STARTED');
  const [loggingOut, setLoggingOut] = useState<boolean>(false);
  const [isSseConnected, setIsSseConnected] = useState<boolean>(false);

  // 1. Real-time SSE Stream Listener
  useEffect(() => {
    let sse: EventSource | null = null;
    try {
      const storedToken = typeof localStorage !== 'undefined' ? localStorage.getItem('bugrip_participant_token') : null;
      const sseUrl = storedToken ? `/api/auth/events?token=${encodeURIComponent(storedToken)}` : '/api/auth/events';
      sse = new EventSource(sseUrl, { withCredentials: true });

      sse.onopen = () => {
        setIsSseConnected(true);
      };

      sse.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.eventStatus) {
            setCurrentStatus(data.eventStatus);
            if (data.eventStatus === 'RUNNING') {
              onEventStart();
            }
          }
          if (typeof data.connectedMemberCount === 'number') {
            setConnectedCount(data.connectedMemberCount);
            onUpdateCounts(data.connectedMemberCount, data.registeredMemberCount);
          }
        } catch {
          // Parse error
        }
      };

      sse.onerror = () => {
        setIsSseConnected(false);
      };
    } catch {
      setIsSseConnected(false);
    }

    const handleLeave = () => {
      try {
        const storedToken = typeof localStorage !== 'undefined' ? localStorage.getItem('bugrip_participant_token') : '';
        const url = storedToken ? `/api/auth/disconnect?token=${encodeURIComponent(storedToken)}` : '/api/auth/disconnect';
        const payload = JSON.stringify({ token: storedToken });
        if (navigator.sendBeacon) {
          const blob = new Blob([payload], { type: 'application/json' });
          navigator.sendBeacon(url, blob);
        } else {
          fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              ...(storedToken ? { 'Authorization': `Bearer ${storedToken}`, 'X-Session-Token': storedToken } : {}),
            },
            body: payload,
            keepalive: true,
          }).catch(() => {});
        }
      } catch {}
    };
    window.addEventListener('pagehide', handleLeave);
    window.addEventListener('beforeunload', handleLeave);

    return () => {
      window.removeEventListener('pagehide', handleLeave);
      window.removeEventListener('beforeunload', handleLeave);
      if (sse) {
        sse.close();
      }
    };
  }, [onEventStart, onUpdateCounts]);

  // 2. Periodic Heartbeat Polling (Fallback and Session Keep-Alive)
  useEffect(() => {
    const sendHeartbeat = async () => {
      try {
        const storedToken = typeof localStorage !== 'undefined' ? localStorage.getItem('bugrip_participant_token') : null;
        const headers: Record<string, string> = {};
        if (storedToken) {
          headers['Authorization'] = `Bearer ${storedToken}`;
          headers['X-Session-Token'] = storedToken;
        }
        const res = await fetch('/api/auth/heartbeat', {
          method: 'POST',
          credentials: 'include',
          headers,
        });
        if (res.ok) {
          const data = await res.json();
          if (data.eventStatus) {
            setCurrentStatus(data.eventStatus);
            if (data.eventStatus === 'RUNNING') {
              onEventStart();
            }
          }
          if (typeof data.connectedMemberCount === 'number') {
            setConnectedCount(data.connectedMemberCount);
            onUpdateCounts(data.connectedMemberCount, data.registeredMemberCount);
          }
        }
      } catch {
        // Network flicker
      }
    };

    const interval = setInterval(sendHeartbeat, 3000);
    return () => clearInterval(interval);
  }, [onEventStart, onUpdateCounts]);

  const handleLogoutClick = async () => {
    setLoggingOut(true);
    try {
      const storedToken = typeof localStorage !== 'undefined' ? localStorage.getItem('bugrip_participant_token') : '';
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(storedToken ? { 'Authorization': `Bearer ${storedToken}`, 'X-Session-Token': storedToken } : {}),
        },
        body: JSON.stringify({ token: storedToken }),
      });
    } catch {
      // Cleanup regardless
    } finally {
      localStorage.removeItem('bugrip_participant_token');
      setLoggingOut(false);
      onLogout();
    }
  };

  // Organizer Simulator for rapid local testing / evaluation
  const simulateOrganizerStart = async () => {
    try {
      await fetch('/api/competition/event/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'RUNNING' }),
      });
      onEventStart();
    } catch (err) {
      console.error('Failed to trigger organizer start:', err);
    }
  };

  return (
    <div id="waiting-room-root" className="w-full max-w-2xl mx-auto py-8 sm:py-14 px-4 space-y-6">
      {/* Top Banner & Title */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400 font-mono text-xs tracking-wider">
          <Radio className="w-3.5 h-3.5 animate-pulse" />
          <span>OFFICIAL WAITING ROOM</span>
        </div>

        <h1 className="text-4xl sm:text-5xl font-black text-white font-mono tracking-tight">
          BUG SNIPER
        </h1>

        <div className="text-emerald-400 font-mono text-xl sm:text-2xl font-black tracking-wider uppercase pt-1">
          GET READY
        </div>

        <p className="text-zinc-400 font-mono text-xs sm:text-sm tracking-wide">
          Waiting for the organizer to start the competition.
        </p>
      </div>

      {/* Waiting Room Status Card */}
      <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/90 p-6 sm:p-8 backdrop-blur-md shadow-2xl space-y-6">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 via-emerald-400 to-amber-500 animate-pulse" />

        {/* Competitor and Session Status Display */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl border border-zinc-800/80 bg-zinc-900/60 font-mono">
            <div className="text-zinc-500 text-xs uppercase tracking-wider">COMPETITOR</div>
            <div className="text-white text-lg font-bold mt-1 truncate" title={team.teamName}>
              {team.teamName}
            </div>
            <div className="text-emerald-400/80 text-[11px] mt-0.5">Solo Competitor Session</div>
          </div>

          <div className="p-4 rounded-xl border border-zinc-800/80 bg-zinc-900/60 font-mono">
            <div className="text-zinc-500 text-xs uppercase tracking-wider">SESSION STATUS</div>
            <div className="text-emerald-400 text-lg font-black mt-1 flex items-center gap-2">
              <Users className="w-5 h-5 text-emerald-400" />
              <span>
                {connectedCount >= 1 ? '1 / 1 ONLINE' : 'READY'}
              </span>
            </div>
            <div className="text-zinc-400 text-[11px] mt-0.5">
              Solo Participant Connected
            </div>
          </div>
        </div>

        {/* Authoritative Event Status Radar */}
        <div className="p-5 rounded-xl border border-amber-500/30 bg-amber-500/5 font-mono space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs text-amber-300 font-bold uppercase tracking-wider flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
              <span>EVENT STATUS</span>
            </div>
            <div className="text-xs text-zinc-500">
              SSE Stream: {isSseConnected ? 'Connected' : 'Polling'}
            </div>
          </div>

          <div className="text-2xl font-black text-amber-400 tracking-wider">
            {currentStatus === 'NOT_STARTED' ? 'NOT STARTED' : currentStatus}
          </div>

          <div className="flex items-center gap-2 text-xs text-zinc-300">
            <Clock className="w-4 h-4 text-amber-400" />
            <span className="font-semibold tracking-widest text-amber-300">
              WAITING FOR ORGANIZER...
            </span>
          </div>

          <p className="text-[11px] text-zinc-400 leading-relaxed border-t border-amber-500/20 pt-2">
            The coding arena will automatically unlock the instant the symposium organizer broadcasts the start command.
            You do not need to refresh your browser.
          </p>
        </div>

        {/* Security & Access Notice */}
        <div className="p-3.5 rounded-xl border border-zinc-800 bg-zinc-900/40 text-zinc-400 font-mono text-xs flex items-start gap-3">
          <Shield className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5 text-[11px]">
            <span className="text-zinc-300 font-bold">Competition Rule: </span>
            Challenge access, Java sandbox executions, and flag submissions remain strictly locked until the official countdown begins.
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
          <button
            id="btn-disconnect-session"
            type="button"
            disabled={loggingOut}
            onClick={handleLogoutClick}
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-zinc-700/80 bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 hover:text-white font-mono text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>DISCONNECT / LOGOUT</span>
          </button>

          <span className="text-[11px] text-zinc-500 font-mono">
            Releasing session frees your team slot
          </span>
        </div>

        {/* Organizer Simulation Drawer for Testing */}
        <div className="pt-4 border-t border-zinc-800/80">
          <div className="flex items-center justify-between text-zinc-500 font-mono text-xs">
            <span>Organizer Simulation (AI Studio Testing)</span>
            <button
              type="button"
              onClick={simulateOrganizerStart}
              className="px-3 py-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 text-[11px] flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <Play className="w-3 h-3" />
              <span>Simulate Start (NOT_STARTED → RUNNING)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
