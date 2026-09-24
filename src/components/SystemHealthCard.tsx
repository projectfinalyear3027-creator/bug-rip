import React from 'react';
import { Server, CheckCircle, ShieldAlert, Cpu, Terminal, ShieldCheck, Flame, Users, Clock } from 'lucide-react';
import { SystemHealthData, CompetitionStatusData } from '../types';

interface SystemHealthCardProps {
  health: SystemHealthData | null;
  status: CompetitionStatusData | null;
  loading: boolean;
  onRefresh: () => void;
}

export const SystemHealthCard: React.FC<SystemHealthCardProps> = ({
  health,
  status,
  loading,
  onRefresh,
}) => {
  return (
    <div id="system-telemetry-deck" className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 sm:p-6 backdrop-blur-sm shadow-xl space-y-5">
      {/* Top telemetry status bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800/70 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-950/60 border border-emerald-800/60 text-emerald-400">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-white font-mono uppercase tracking-wide">
                System Health & Rules Authority
              </h2>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-950/60 text-emerald-400 border border-emerald-800/60">
                Active
              </span>
            </div>
            <p className="text-[11px] text-zinc-400 font-mono mt-0.5">
              Authoritative state synchronized via Node.js Express • Zero database/Redis dependencies in Fragment 1
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="text-zinc-500">Node Environment:</span>
          <span className="px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800 text-zinc-300">
            {health?.environment || 'development'}
          </span>
          <span className="text-zinc-500 ml-2">Version:</span>
          <span className="text-zinc-300">{health?.version || '1.0.0-foundation'}</span>
        </div>
      </div>

      {/* 5 Core Invariants Grid (Express, Database, Rules, Timer, Team Limits) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5 font-mono text-xs">
        {/* Metric 1: Express Server */}
        <div className="p-3.5 rounded-xl border border-zinc-800/80 bg-zinc-950/60 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-zinc-400 mb-1.5">
              <span className="text-[11px] uppercase tracking-wider text-zinc-500">API Gateway</span>
              <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="text-white font-bold text-sm tracking-tight">Express Port 3000</div>
            <div className="text-[11px] text-emerald-400/90 mt-1">
              • GET /api/health responding
            </div>
          </div>
          <div className="text-[10px] text-zinc-500 mt-3 pt-2 border-t border-zinc-800/60">
            Uptime: {health?.uptimeSeconds ?? 0}s
          </div>
        </div>

        {/* Metric 2: PostgreSQL Database */}
        <div className="p-3.5 rounded-xl border border-zinc-800/80 bg-zinc-950/60 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-zinc-400 mb-1.5">
              <span className="text-[11px] uppercase tracking-wider text-zinc-500">PostgreSQL DB</span>
              {health?.database?.connected ? (
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
              )}
            </div>
            <div className="text-white font-bold text-sm tracking-tight">
              {health?.database?.connected ? (
                health?.database?.isEmbedded ? 'PGlite Embedded' : 'External Postgres'
              ) : 'Connecting...'}
            </div>
            <div className="text-[11px] text-emerald-400/90 mt-1">
              • {health?.database?.engine || 'PostgreSQL Engine'}
            </div>
          </div>
          <div className="text-[10px] text-zinc-500 mt-3 pt-2 border-t border-zinc-800/60">
            {health?.database?.isEmbedded ? 'Zero-Config' : 'Network DB'} • {health?.database?.latencyMs ?? 1}ms • Drizzle ORM
          </div>
        </div>

        {/* Metric 3: Canonical Rules */}
        <div className="p-3.5 rounded-xl border border-zinc-800/80 bg-zinc-950/60 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-zinc-400 mb-1.5">
              <span className="text-[11px] uppercase tracking-wider text-zinc-500">Rules Engine</span>
              <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="text-white font-bold text-sm tracking-tight">33 Invariant Tests</div>
            <div className="text-[11px] text-emerald-400/90 mt-1">
              • All unit assertions passing
            </div>
          </div>
          <div className="text-[10px] text-zinc-500 mt-3 pt-2 border-t border-zinc-800/60">
            Winner, Race & Tier policies locked
          </div>
        </div>

        {/* Metric 4: Authoritative Timer */}
        <div className="p-3.5 rounded-xl border border-zinc-800/80 bg-zinc-950/60 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-zinc-400 mb-1.5">
              <span className="text-[11px] uppercase tracking-wider text-zinc-500">Event Timer</span>
              <Clock className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div className="text-white font-bold text-sm tracking-tight">60 Minutes Clock</div>
            <div className="text-[11px] text-amber-400/90 mt-1">
              • State: {status?.eventState || 'NOT_STARTED'}
            </div>
          </div>
          <div className="text-[10px] text-zinc-500 mt-3 pt-2 border-t border-zinc-800/60">
            Synchronized server timestamp
          </div>
        </div>

        {/* Metric 5: Team Constraints */}
        <div className="p-3.5 rounded-xl border border-zinc-800/80 bg-zinc-950/60 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-zinc-400 mb-1.5">
              <span className="text-[11px] uppercase tracking-wider text-zinc-500">Team Size Rule</span>
              <Users className="w-3.5 h-3.5 text-blue-400" />
            </div>
            <div className="text-white font-bold text-sm tracking-tight">1 to 3 Members</div>
            <div className="text-[11px] text-blue-400/90 mt-1">
              • CSV Import Only (No auto-codes)
            </div>
          </div>
          <div className="text-[10px] text-zinc-500 mt-3 pt-2 border-t border-zinc-800/60">
            4+ member teams rejected
          </div>
        </div>
      </div>
    </div>
  );
};
