import React from 'react';
import { Terminal, Shield, Clock, RefreshCw, Tv, Layers } from 'lucide-react';
import { SystemHealthData, CompetitionStatusData, ActiveView } from '../types';

interface HeaderProps {
  health: SystemHealthData | null;
  status: CompetitionStatusData | null;
  loading: boolean;
  onRefresh?: () => void;
  activeView: ActiveView;
  onSelectView: (view: ActiveView) => void;
}

export const Header: React.FC<HeaderProps> = ({
  health,
  status,
  loading,
  onRefresh,
  activeView,
  onSelectView,
}) => {
  const formatTime = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const remaining = status?.remainingSeconds ?? 3600;

  return (
    <header id="bugrip-main-header" className="sticky top-0 z-50 border-b border-zinc-800/80 bg-[#090a0f]/95 backdrop-blur-md">
      {/* Top Header Row */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          {/* Logo & Brand Identity */}
          <div className="flex items-center gap-3.5 cursor-pointer" onClick={() => onSelectView('participant')}>
            <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 via-zinc-900 to-zinc-950 border border-emerald-500/40 shadow-inner">
              <Terminal className="w-5 h-5 text-emerald-400" />
              <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500" />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono font-black text-lg tracking-wider text-white">
                  BUG <span className="text-emerald-400">SNIPER</span>
                </span>
                <span className="hidden sm:inline-flex items-center text-[10px] font-mono font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700">
                  JAVA CTF
                </span>
              </div>
              <p className="text-[11px] font-mono text-zinc-400 tracking-tight hidden sm:block">
                Collegiate Technical Symposium
              </p>
            </div>
          </div>

          {/* Central Live Match Clock */}
          <div className="flex items-center gap-2 sm:gap-3 bg-zinc-900/90 px-3.5 py-1.5 rounded-xl border border-zinc-800 shadow-sm">
            <div className="flex items-center gap-1.5 text-zinc-400 text-xs font-mono">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden md:inline">MATCH TIMER:</span>
            </div>
            <div className="font-mono font-bold text-sm sm:text-base text-amber-400 tracking-wider">
              {formatTime(remaining)}
            </div>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wide bg-amber-950/60 text-amber-300 border border-amber-800/60">
              {status?.eventState || 'NOT_STARTED'}
            </span>
          </div>

          {/* Right Action & Diagnostics */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* System Health Pulse */}
            <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-900/60 border border-zinc-800 font-mono text-xs">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="text-zinc-300 text-[11px]">API: 200 OK</span>
              <span className="text-zinc-600">•</span>
              <span className="text-zinc-400 text-[11px]">Port 3000</span>
            </div>

            {/* Quick Refresh Probe Button */}
            {onRefresh && (
              <button
                id="header-refresh-btn"
                onClick={onRefresh}
                disabled={loading}
                title="Probe system health"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-mono text-xs text-zinc-300 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 hover:text-white transition-all disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
                <span className="hidden sm:inline">{loading ? 'Probing...' : 'Re-probe'}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Sub-Header: Experience Navigation Bar */}
      <div className="border-t border-zinc-800/80 bg-zinc-950/70">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex items-center space-x-1 sm:space-x-2 py-2 overflow-x-auto font-mono text-xs">
            <button
              id="nav-participant-app"
              onClick={() => onSelectView('participant')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg whitespace-nowrap font-bold transition-all ${
                activeView === 'participant'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Participant App (/)</span>
            </button>

            <button
              id="nav-live-scoreboard"
              onClick={() => onSelectView('live')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg whitespace-nowrap font-bold transition-all ${
                activeView === 'live'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
              }`}
            >
              <Tv className="w-3.5 h-3.5" />
              <span>Public Live Scoreboard (/live)</span>
            </button>

            <button
              id="nav-admin-center"
              onClick={() => onSelectView('admin')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg whitespace-nowrap font-bold transition-all ${
                activeView === 'admin'
                  ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40 shadow-sm'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
              }`}
            >
              <Shield className="w-3.5 h-3.5" />
              <span>Admin Control Center (/admin)</span>
            </button>

            <button
              id="nav-foundation-ledger"
              onClick={() => onSelectView('foundation')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg whitespace-nowrap font-bold transition-all ${
                activeView === 'foundation'
                  ? 'bg-zinc-800 text-zinc-200 border border-zinc-700 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Foundation Ledger</span>
            </button>
          </nav>
        </div>
      </div>
    </header>
  );
};
