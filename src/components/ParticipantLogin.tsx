/**
 * BUG RIP - Participant Landing & Authentication Page
 * Route: /
 * 
 * Sourced strictly from real PostgreSQL/PGlite database.
 * No mocks. No hard-coded lists. No frontend authentication.
 */

import React, { useState } from 'react';
import { Terminal, KeyRound, Users, ShieldAlert, ArrowRight, Loader2 } from 'lucide-react';

interface ParticipantLoginProps {
  onLoginSuccess: (data: {
    team: {
      id: string;
      teamName: string;
      registeredMemberCount: number;
      connectedMemberCount: number;
    };
    eventStatus: string;
    sessionToken?: string;
  }) => void;
}

export const ParticipantLogin: React.FC<ParticipantLoginProps> = ({ onLoginSuccess }) => {
  const [teamName, setTeamName] = useState('');
  const [teamCode, setTeamCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const trimmedName = teamName.trim();
    const trimmedCode = teamCode.trim();

    if (!trimmedName || !trimmedCode) {
      setErrorMessage('INVALID TEAM CREDENTIALS');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/auth/team-login', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          teamName: trimmedName,
          teamCode: trimmedCode,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        // Display exact server-verified error message without revealing internals
        setErrorMessage(data.error || 'INVALID TEAM CREDENTIALS');
        return;
      }

      onLoginSuccess({
        team: data.team,
        eventStatus: data.eventStatus,
        sessionToken: data.sessionToken,
      });
    } catch (err) {
      console.error('Participant login error:', err);
      setErrorMessage('UNABLE TO VERIFY TEAM. PLEASE TRY AGAIN.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-xl mx-auto py-8 sm:py-16 px-4">
      {/* Visual Identity & Title Card */}
      <div className="text-center space-y-3 mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 font-mono text-xs tracking-wider">
          <Terminal className="w-3.5 h-3.5" />
          <span>OFFICIAL COMPETITION ACCESS</span>
        </div>

        <h1 className="text-4xl sm:text-5xl font-black text-white font-mono tracking-tight">
          BUG SNIPER
        </h1>

        <div className="text-emerald-400 font-mono text-xs sm:text-sm font-semibold tracking-widest uppercase">
          JAVA DEBUGGING CTF
        </div>

        <div className="pt-2 text-zinc-400 font-mono text-xs space-y-0.5 tracking-wider">
          <p className="text-zinc-300 font-bold">FIND THE BUG. RUN THE CODE. RIP THE FLAG.</p>
          <p className="text-zinc-500 text-[11px]">60-Minute Collegiate Java Debugging Competition</p>
        </div>
      </div>

      {/* Login Card */}
      <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/90 p-6 sm:p-8 backdrop-blur-md shadow-2xl">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-600" />

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Team Name Input */}
          <div className="space-y-2">
            <label
              htmlFor="input-team-name"
              className="flex items-center justify-between text-xs font-mono font-semibold text-zinc-300 tracking-wider"
            >
              <span className="flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-emerald-400" />
                COMPETITOR NAME
              </span>
              <span className="text-[10px] text-zinc-500 font-normal">Solo Participant</span>
            </label>
            <input
              id="input-team-name"
              type="text"
              required
              autoComplete="off"
              disabled={loading}
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="e.g. Alex Chen"
              className="w-full px-4 py-3 rounded-xl bg-zinc-900/90 border border-zinc-700/80 text-white font-mono text-sm placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all disabled:opacity-50"
            />
          </div>

          {/* Unique Code Input */}
          <div className="space-y-2">
            <label
              htmlFor="input-team-code"
              className="flex items-center justify-between text-xs font-mono font-semibold text-zinc-300 tracking-wider"
            >
              <span className="flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5 text-emerald-400" />
                PARTICIPANT CODE
              </span>
              <span className="text-[10px] text-zinc-500 font-normal">From registration</span>
            </label>
            <input
              id="input-team-code"
              type="password"
              required
              autoComplete="off"
              disabled={loading}
              value={teamCode}
              onChange={(e) => setTeamCode(e.target.value)}
              placeholder="e.g. RIP-9481-2201"
              className="w-full px-4 py-3 rounded-xl bg-zinc-900/90 border border-zinc-700/80 text-white font-mono text-sm placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all disabled:opacity-50 tracking-widest"
            />
          </div>

          {/* Error State Banner */}
          {errorMessage && (
            <div
              id="participant-login-error"
              className="p-3.5 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 flex items-start gap-3 font-mono text-xs animate-in fade-in duration-200"
            >
              <ShieldAlert className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <div className="font-bold tracking-wider">{errorMessage}</div>
                {(errorMessage.includes('LIMIT REACHED') || errorMessage.includes('SESSION')) && (
                  <p className="text-red-400/80 text-[11px]">
                    Solo competition allows maximum 1 active device session. Close other tabs or wait 60 seconds.
                  </p>
                )}
                {(errorMessage.includes('UNAVAILABLE') || errorMessage.includes('DISABLED')) && (
                  <p className="text-red-400/80 text-[11px]">
                    This competitor account is currently disabled. Contact competition organizers.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Submit Button */}
          <button
            id="btn-enter-arena"
            type="submit"
            disabled={loading}
            className="w-full py-3.5 px-6 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-zinc-950 font-mono font-bold text-sm tracking-wider flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>VERIFYING CREDENTIALS...</span>
              </>
            ) : (
              <>
                <span>ENTER CODING ARENA</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Registration Instructions */}
        <div className="mt-6 pt-4 border-t border-zinc-800/80 text-center">
          <p className="text-[11px] text-zinc-500 font-mono">
            Access credentials are provided by competition organizers upon symposium registration confirmation.
          </p>
        </div>
      </div>
    </div>
  );
};
