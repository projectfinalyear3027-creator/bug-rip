/**
 * BUG RIP - Participant Experience Controller
 * Orchestrates:
 * 1. Public Participant Landing Page (Route: /)
 * 2. Participant Waiting Room (Route: /waiting)
 * 3. Reserved Coding Arena Shell (Route: /arena)
 * 
 * Strict Fragment 3 Boundaries:
 * - Real PostgreSQL/PGlite database authentication
 * - Concurrency session limit enforcement (1-3 members)
 * - Session restoration on reload via HTTP-only cookie
 * - Real-time start transition (NOT_STARTED -> RUNNING)
 */

import React, { useState, useEffect } from 'react';
import { ParticipantLogin } from './ParticipantLogin';
import { WaitingRoom } from './WaitingRoom';
import { ParticipantArena } from './ParticipantArena';
import { Loader2 } from 'lucide-react';
import { ThemeId } from '../types';

interface AuthenticatedTeam {
  id: string;
  teamName: string;
  registeredMemberCount: number;
  connectedMemberCount: number;
}

interface ParticipantExperienceProps {
  currentTheme?: ThemeId;
}

export const ParticipantExperience: React.FC<ParticipantExperienceProps> = () => {
  const [loadingSession, setLoadingSession] = useState<boolean>(true);
  const [authenticatedTeam, setAuthenticatedTeam] = useState<AuthenticatedTeam | null>(null);
  const [eventStatus, setEventStatus] = useState<string>('NOT_STARTED');
  const [participantRoute, setParticipantRoute] = useState<'LOGIN' | 'WAITING' | 'ARENA'>('LOGIN');

  // 1. Session Restoration on Initial Mount
  useEffect(() => {
    const restoreSession = async () => {
      setLoadingSession(true);
      try {
        const storedToken = localStorage.getItem('bugrip_participant_token');
        const headers: Record<string, string> = {};
        if (storedToken) {
          headers['Authorization'] = `Bearer ${storedToken}`;
        }

        const res = await fetch('/api/auth/session', {
          credentials: 'include',
          headers,
        });

        if (res.ok) {
          const data = await res.json();
          if (data.authenticated && data.team) {
            setAuthenticatedTeam(data.team);
            setEventStatus(data.eventStatus || 'NOT_STARTED');

            if (data.eventStatus && data.eventStatus !== 'NOT_STARTED') {
              setParticipantRoute('ARENA');
              window.history.replaceState(null, '', '/arena');
            } else {
              setParticipantRoute('WAITING');
              window.history.replaceState(null, '', '/waiting');
            }
            return;
          }
        }
      } catch (err) {
        // Fall through cleanly if no session is present or network unreachable
      } finally {
        setLoadingSession(false);
      }

      // No active session: remain on login page
      setAuthenticatedTeam(null);
      setParticipantRoute('LOGIN');
      if (window.location.pathname === '/waiting' || window.location.pathname === '/arena') {
        window.history.replaceState(null, '', '/');
      }
    };

    restoreSession();
  }, []);

  // 2. Handle Login Success
  const handleLoginSuccess = (data: {
    team: AuthenticatedTeam;
    eventStatus: string;
    sessionToken?: string;
  }) => {
    if (data.sessionToken) {
      localStorage.setItem('bugrip_participant_token', data.sessionToken);
    }
    setAuthenticatedTeam(data.team);
    setEventStatus(data.eventStatus);

    if (data.eventStatus && data.eventStatus !== 'NOT_STARTED') {
      setParticipantRoute('ARENA');
      window.history.pushState(null, '', '/arena');
    } else {
      setParticipantRoute('WAITING');
      window.history.pushState(null, '', '/waiting');
    }
  };

  // 3. Real-Time Transition to Arena
  const handleEventStart = () => {
    setEventStatus('RUNNING');
    setParticipantRoute('ARENA');
    window.history.pushState(null, '', '/arena');
  };

  // 4. Handle Clean Disconnect / Logout
  const handleLogout = () => {
    localStorage.removeItem('bugrip_participant_token');
    setAuthenticatedTeam(null);
    setParticipantRoute('LOGIN');
    window.history.pushState(null, '', '/');
  };

  // 5. Update Connected Counts
  const handleUpdateCounts = (connected: number, registered: number) => {
    setAuthenticatedTeam((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        connectedMemberCount: connected,
        registeredMemberCount: registered,
      };
    });
  };

  if (loadingSession) {
    return (
      <div className="flex flex-col items-center justify-center py-24 font-mono text-zinc-400 space-y-3">
        <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
        <span className="text-xs tracking-wider uppercase">Restoring verified team session...</span>
      </div>
    );
  }

  // Route: / (Login)
  if (participantRoute === 'LOGIN' || !authenticatedTeam) {
    return <ParticipantLogin onLoginSuccess={handleLoginSuccess} />;
  }

  // Route: /waiting (Waiting Room)
  if (participantRoute === 'WAITING' || eventStatus === 'NOT_STARTED') {
    return (
      <WaitingRoom
        team={authenticatedTeam}
        eventStatus={eventStatus}
        onEventStart={handleEventStart}
        onLogout={handleLogout}
        onUpdateCounts={handleUpdateCounts}
      />
    );
  }

  // Route: /arena (Participant Coding Arena)
  return (
    <ParticipantArena
      team={authenticatedTeam}
      eventStatus={eventStatus}
      onLogout={handleLogout}
      onReturnToWaiting={() => setParticipantRoute('WAITING')}
    />
  );
};
