import React, { useState } from 'react';
import {
  ShieldAlert,
  Trophy,
  Users,
  Timer,
  GitMerge,
  Flame,
  FileSpreadsheet,
  Lock,
  ChevronRight,
  Code2,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

export const ImmutableRulesViewer: React.FC = () => {
  const [activeFilter, setActiveFilter] = useState<'all' | 'ranking' | 'teams' | 'concurrency' | 'tiers'>('all');

  return (
    <div id="immutable-rules-section" className="space-y-6">
      {/* Header section with category pills */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-4">
        <div>
          <div className="flex items-center gap-2 text-emerald-400 font-mono text-xs font-semibold uppercase tracking-wider">
            <ShieldAlert className="w-4 h-4" />
            <span>Canonical Competition Law • Fragment 1</span>
          </div>
          <h2 className="text-xl font-bold text-white font-mono mt-1">
            Immutable Tournament Rules Ledger
          </h2>
        </div>

        {/* Filter Badges */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-zinc-900 border border-zinc-800 font-mono text-xs overflow-x-auto">
          <button
            onClick={() => setActiveFilter('all')}
            className={`px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
              activeFilter === 'all' ? 'bg-emerald-500 text-zinc-950 font-bold' : 'text-zinc-400 hover:text-white'
            }`}
          >
            All Rules (6)
          </button>
          <button
            onClick={() => setActiveFilter('ranking')}
            className={`px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
              activeFilter === 'ranking' ? 'bg-emerald-500 text-zinc-950 font-bold' : 'text-zinc-400 hover:text-white'
            }`}
          >
            Winner Law
          </button>
          <button
            onClick={() => setActiveFilter('teams')}
            className={`px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
              activeFilter === 'teams' ? 'bg-emerald-500 text-zinc-950 font-bold' : 'text-zinc-400 hover:text-white'
            }`}
          >
            1–3 Members
          </button>
          <button
            onClick={() => setActiveFilter('concurrency')}
            className={`px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
              activeFilter === 'concurrency' ? 'bg-emerald-500 text-zinc-950 font-bold' : 'text-zinc-400 hover:text-white'
            }`}
          >
            Race Guard
          </button>
          <button
            onClick={() => setActiveFilter('tiers')}
            className={`px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
              activeFilter === 'tiers' ? 'bg-emerald-500 text-zinc-950 font-bold' : 'text-zinc-400 hover:text-white'
            }`}
          >
            Tier Ladder
          </button>
        </div>
      </div>

      {/* Rules Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Rule 1: Winner Hierarchy */}
        {(activeFilter === 'all' || activeFilter === 'ranking') && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 hover:border-zinc-700 transition-all flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-amber-400 font-mono font-bold text-sm">
                  <Trophy className="w-4 h-4" />
                  <span>Rule 1: Winner Hierarchy</span>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-950/60 text-amber-300 border border-amber-800/60">
                  Priority 1-2-3
                </span>
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed mb-4">
                A team with more unique solved problems <strong className="text-white underline decoration-emerald-500 underline-offset-4">ALWAYS</strong> outranks a team with fewer solved problems, regardless of total points.
              </p>

              <div className="space-y-2 font-mono text-xs bg-zinc-950 p-3.5 rounded-xl border border-zinc-800">
                <div className="flex items-center justify-between pb-1.5 border-b border-zinc-800 text-emerald-400 font-semibold">
                  <span>1. PRIMARY METRIC:</span>
                  <span className="font-mono">Problems Solved (DESC)</span>
                </div>
                <div className="flex items-center justify-between pb-1.5 border-b border-zinc-800 text-blue-400">
                  <span>2. SECONDARY METRIC:</span>
                  <span className="font-mono">Total Points (DESC)</span>
                </div>
                <div className="flex items-center justify-between text-amber-400">
                  <span>3. TIEBREAKER METRIC:</span>
                  <span className="font-mono">Earliest Timestamp (ASC)</span>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-zinc-800/60 text-[11px] font-mono text-zinc-500">
              Verified in <code className="text-zinc-400">tests/rules.test.ts</code> (Suite 1: 9 assertions passing)
            </div>
          </div>
        )}

        {/* Rule 2: Single 60-Minute Central Timer */}
        {(activeFilter === 'all' || activeFilter === 'ranking') && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 hover:border-zinc-700 transition-all flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-amber-400 font-mono font-bold text-sm">
                  <Timer className="w-4 h-4" />
                  <span>Rule 2: Central 60-Minute Clock</span>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
                  Server-Authoritative
                </span>
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed mb-4">
                The entire competition runs under one authoritative 60-minute duration clock. Time is not tracked per individual challenge or tier.
              </p>

              <div className="grid grid-cols-4 gap-2 font-mono text-xs text-center">
                <div className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800">
                  <div className="text-zinc-400 font-bold text-[11px]">NOT_STARTED</div>
                  <div className="text-[10px] text-zinc-500 mt-0.5">Waiting Room</div>
                </div>
                <div className="p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-800/60 text-emerald-300">
                  <div className="font-bold text-[11px]">RUNNING</div>
                  <div className="text-[10px] text-emerald-400/80 mt-0.5">Active CTF</div>
                </div>
                <div className="p-2.5 rounded-xl bg-amber-950/40 border border-amber-800/60 text-amber-300">
                  <div className="font-bold text-[11px]">PAUSED</div>
                  <div className="text-[10px] text-amber-400/80 mt-0.5">Halted Clock</div>
                </div>
                <div className="p-2.5 rounded-xl bg-rose-950/40 border border-rose-800/60 text-rose-300">
                  <div className="font-bold text-[11px]">ENDED</div>
                  <div className="text-[10px] text-rose-400/80 mt-0.5">Locked Arena</div>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-zinc-800/60 text-[11px] font-mono text-zinc-500">
              Synchronized via Express server time with client heartbeat correction
            </div>
          </div>
        )}

        {/* Rule 3: Team Data from CSV */}
        {(activeFilter === 'all' || activeFilter === 'teams') && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 hover:border-zinc-700 transition-all flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-emerald-400 font-mono font-bold text-sm">
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Rule 3: Credentials Sourced from CSV</span>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/60">
                  No Auto-Generation
                </span>
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed mb-4">
                BUG SNIPER strictly never auto-generates or re-invents team codes. Teams authenticate exclusively using their existing registration data from the symposium CSV.
              </p>

              <div className="bg-zinc-950 p-3.5 rounded-xl border border-zinc-800 font-mono text-xs">
                <div className="text-zinc-500 text-[11px] mb-1">Dual Credential Validation:</div>
                <div className="text-white font-semibold">
                  <span className="text-emerald-400">Team Name</span> (case-insensitive, trimmed) + <span className="text-emerald-400">Unique Team Code</span>
                </div>
                <div className="text-[11px] text-zinc-500 mt-2">
                  Example: "Team Binary" + "SYM-BIN-882"
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-zinc-800/60 text-[11px] font-mono text-zinc-500">
              Disallows arbitrary signups or unauthorized team code generation
            </div>
          </div>
        )}

        {/* Rule 4: Team Size 1-3 Members */}
        {(activeFilter === 'all' || activeFilter === 'teams') && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 hover:border-zinc-700 transition-all flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-blue-400 font-mono font-bold text-sm">
                  <Users className="w-4 h-4" />
                  <span>Rule 4: Team Size (1 to 3 Members)</span>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-rose-950/60 text-rose-400 border border-rose-800/60">
                  4+ Discarded
                </span>
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed mb-4">
                Each team consists of 1, 2, or 3 registered members. 4 or more participants are strictly rejected. Simultaneous active sessions are strictly limited to match registered team headcount.
              </p>

              <div className="grid grid-cols-3 gap-2 font-mono text-xs">
                <div className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800">
                  <div className="text-zinc-400 font-bold text-[11px]">1-Member Team</div>
                  <div className="text-emerald-400 text-[11px] mt-1">Max 1 Session</div>
                  <div className="text-[10px] text-zinc-500 mt-0.5">2nd device rejected</div>
                </div>
                <div className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800">
                  <div className="text-zinc-400 font-bold text-[11px]">2-Member Team</div>
                  <div className="text-emerald-400 text-[11px] mt-1">Max 2 Sessions</div>
                  <div className="text-[10px] text-zinc-500 mt-0.5">3rd device rejected</div>
                </div>
                <div className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800">
                  <div className="text-zinc-400 font-bold text-[11px]">3-Member Team</div>
                  <div className="text-emerald-400 text-[11px] mt-1">Max 3 Sessions</div>
                  <div className="text-[10px] text-zinc-500 mt-0.5">4th device rejected</div>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-zinc-800/60 text-[11px] font-mono text-zinc-500">
              Tested against 0, 1, 2, 3, and 4 member submissions in unit test suite
            </div>
          </div>
        )}

        {/* Rule 5: Same-Problem Submission Race Condition */}
        {(activeFilter === 'all' || activeFilter === 'concurrency') && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 hover:border-zinc-700 transition-all flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-cyan-400 font-mono font-bold text-sm">
                  <GitMerge className="w-4 h-4" />
                  <span>Rule 5: Atomic Submission Race Guard</span>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950/60 text-cyan-300 border border-cyan-800/60">
                  Teammates Safe
                </span>
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed mb-4">
                Teammates may debug the same problem in parallel. Only the first valid submission is awarded points and incremented solves.
              </p>

              <div className="bg-zinc-950 p-3.5 rounded-xl border border-zinc-800 font-mono text-xs space-y-2">
                <div className="flex items-start gap-2 text-emerald-400">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span><strong>First Solve:</strong> Accepted → Problem marked solved, points awarded to team.</span>
                </div>
                <div className="flex items-start gap-2 text-amber-400">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span><strong>Second Solve:</strong> Safely rejected → <em>"This problem was just completed by another team member."</em> (Zero duplicate score).</span>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-zinc-800/60 text-[11px] font-mono text-zinc-500">
              Enforced at schema level with partial unique index on first solves
            </div>
          </div>
        )}

        {/* Rule 6: Progressive Unlocks & Retention */}
        {(activeFilter === 'all' || activeFilter === 'tiers') && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 hover:border-zinc-700 transition-all flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-purple-400 font-mono font-bold text-sm">
                  <Flame className="w-4 h-4" />
                  <span>Rule 6: Progressive Tiers & Retention</span>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-950/60 text-purple-300 border border-purple-800/60">
                  Always Reversible
                </span>
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed mb-4">
                Higher tiers unlock when the team solves an organizer-defined threshold of unique problems in the preceding tier. Unlocked tiers remain permanently accessible.
              </p>

              <div className="flex items-center justify-between font-mono text-xs bg-zinc-950 p-3 rounded-xl border border-zinc-800 text-center">
                <div className="flex-1">
                  <div className="text-emerald-400 font-bold">EASY</div>
                  <div className="text-[10px] text-zinc-500">Default Unlocked</div>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-600" />
                <div className="flex-1">
                  <div className="text-blue-400 font-bold">MEDIUM</div>
                  <div className="text-[10px] text-zinc-500">4 Easy Solves</div>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-600" />
                <div className="flex-1">
                  <div className="text-purple-400 font-bold">HARD</div>
                  <div className="text-[10px] text-zinc-500">3 Medium Solves</div>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-600" />
                <div className="flex-1">
                  <div className="text-rose-400 font-bold">EXTREME</div>
                  <div className="text-[10px] text-zinc-500">2 Hard Solves</div>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-zinc-800/60 text-[11px] font-mono text-zinc-500">
              Teams can always switch back to earlier tiers; unlocked tiers never lock again
            </div>
          </div>
        )}
      </div>

      {/* Flag Security & Java Sandbox Isolation Notice */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 font-mono text-xs">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 shrink-0">
            <Lock className="w-4 h-4" />
          </div>
          <div>
            <div className="font-bold text-white">Flag Security & Sandbox Execution Principle</div>
            <p className="text-zinc-400 text-[11px] mt-0.5 leading-relaxed">
              Corrected Java programs reconstruct flags dynamically in their execution output. Plaintext flags are never stored in client bundles or public challenge definitions.
            </p>
          </div>
        </div>
        <div className="px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-amber-300 text-[11px] font-semibold shrink-0">
          Unlimited Execution Runs Allowed
        </div>
      </div>
    </div>
  );
};
