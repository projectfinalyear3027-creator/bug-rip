import React, { useState } from 'react';
import { Layers, Database, Cpu, Terminal, GitBranch, ShieldCheck, CheckCircle2, Clock } from 'lucide-react';

export const ArchitectureOverview: React.FC = () => {
  const [activeView, setActiveView] = useState<'system' | 'schema' | 'sandbox' | 'roadmap'>('system');

  return (
    <div id="architecture-blueprint-section" className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-4">
        <div>
          <div className="flex items-center gap-2 text-blue-400 font-mono text-xs font-semibold uppercase tracking-wider">
            <Layers className="w-4 h-4" />
            <span>Full-Stack Engineering Spec</span>
          </div>
          <h2 className="text-xl font-bold text-white font-mono mt-1">
            System Architecture & Phased Blueprint
          </h2>
          <p className="text-xs text-zinc-400 font-mono mt-0.5">
            Designed for high concurrency, zero exfiltration, and deterministic competition integrity.
          </p>
        </div>

        {/* View Switcher */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-zinc-900 border border-zinc-800 font-mono text-xs overflow-x-auto">
          <button
            onClick={() => setActiveView('system')}
            className={`px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
              activeView === 'system' ? 'bg-blue-500 text-zinc-950 font-bold' : 'text-zinc-400 hover:text-white'
            }`}
          >
            3-Tier System
          </button>
          <button
            onClick={() => setActiveView('schema')}
            className={`px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
              activeView === 'schema' ? 'bg-blue-500 text-zinc-950 font-bold' : 'text-zinc-400 hover:text-white'
            }`}
          >
            Database Schema
          </button>
          <button
            onClick={() => setActiveView('sandbox')}
            className={`px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
              activeView === 'sandbox' ? 'bg-blue-500 text-zinc-950 font-bold' : 'text-zinc-400 hover:text-white'
            }`}
          >
            Sandbox Isolation
          </button>
          <button
            onClick={() => setActiveView('roadmap')}
            className={`px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
              activeView === 'roadmap' ? 'bg-blue-500 text-zinc-950 font-bold' : 'text-zinc-400 hover:text-white'
            }`}
          >
            Phased Roadmap
          </button>
        </div>
      </div>

      {/* View 1: 3-Tier Architecture */}
      {activeView === 'system' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs">
          {/* Tier 1: Presentation */}
          <div className="p-5 rounded-2xl border border-zinc-800 bg-zinc-900/50 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-800/60">
                  TIER 1 • PRESENTATION
                </span>
                <span className="text-emerald-400 font-bold">Active in Frag 1</span>
              </div>
              <h3 className="text-sm font-bold text-white mb-1">Client Applications</h3>
              <p className="text-zinc-400 text-[11px] leading-relaxed mb-4">
                React 19, TypeScript, Tailwind CSS, and Monaco Editor. Clean separation between user roles.
              </p>
              <ul className="space-y-2 text-[11px] text-zinc-300">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Participant Arena (/arena)</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Admin Control Center (/admin)</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Public Auditorium Screen (/live)</span>
                </li>
              </ul>
            </div>
            <div className="mt-4 pt-3 border-t border-zinc-800/80 text-[10px] text-zinc-500">
              Vite 6 SPA • Native Port 3000 Ingress
            </div>
          </div>

          {/* Tier 2: API & State */}
          <div className="p-5 rounded-2xl border border-zinc-800 bg-zinc-900/50 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-950/60 text-blue-400 border border-blue-800/60">
                  TIER 2 • API GATEWAY
                </span>
                <span className="text-blue-400 font-bold">Frag 1 Server Active</span>
              </div>
              <h3 className="text-sm font-bold text-white mb-1">Authoritative Gateway</h3>
              <p className="text-zinc-400 text-[11px] leading-relaxed mb-4">
                Express API engine on Node.js 22. Server-authoritative timer and invariant verification.
              </p>
              <ul className="space-y-2 text-[11px] text-zinc-300">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Express API Gateway (Port 3000)</span>
                </li>
                <li className="flex items-center gap-2 text-zinc-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
                  <span>PostgreSQL DB (Deferred to Frag 2)</span>
                </li>
                <li className="flex items-center gap-2 text-zinc-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
                  <span>Redis & BullMQ (Deferred to Frag 3)</span>
                </li>
              </ul>
            </div>
            <div className="mt-4 pt-3 border-t border-zinc-800/80 text-[10px] text-zinc-500">
              Clean config • No DB/Redis required in Frag 1
            </div>
          </div>

          {/* Tier 3: Execution Sandbox */}
          <div className="p-5 rounded-2xl border border-zinc-800 bg-zinc-900/50 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-purple-950/60 text-purple-400 border border-purple-800/60">
                  TIER 3 • JAVA EXECUTION
                </span>
                <span className="text-zinc-500 font-bold">Deferred to Frag 3</span>
              </div>
              <h3 className="text-sm font-bold text-white mb-1">Isolated OpenJDK 21</h3>
              <p className="text-zinc-400 text-[11px] leading-relaxed mb-4">
                Hardened container execution daemon for untrusted participant Java source code.
              </p>
              <ul className="space-y-2 text-[11px] text-zinc-400">
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
                  <span>Zero Network (--network none)</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
                  <span>256MB RAM / 8s Watchdog Timeout</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
                  <span>PID limits (32 max) & Non-root</span>
                </li>
              </ul>
            </div>
            <div className="mt-4 pt-3 border-t border-zinc-800/80 text-[10px] text-zinc-500">
              BullMQ Queue Architecture • OpenJDK 21 LTS
            </div>
          </div>
        </div>
      )}

      {/* View 2: Database Schema Map */}
      {activeView === 'schema' && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-4 font-mono text-xs">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
            <div>
              <h3 className="font-bold text-white text-sm">PostgreSQL 16 Relational Blueprint (database/schema.sql)</h3>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                Engineered with atomic submission race protections and canonical leaderboard view. (Deferred to Frag 2)
              </p>
            </div>
            <span className="text-[11px] px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800 text-zinc-400">
              8 Core Tables
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-[11px]">
            <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800">
              <div className="text-amber-400 font-bold mb-1">teams</div>
              <div className="text-zinc-400">CSV team_name (case-insensitive unique) and unique team_code.</div>
            </div>
            <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800">
              <div className="text-amber-400 font-bold mb-1">participants</div>
              <div className="text-zinc-400">1 to 3 members per team, contact info, and registration metadata.</div>
            </div>
            <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800">
              <div className="text-emerald-400 font-bold mb-1">team_sessions</div>
              <div className="text-zinc-400">Active session policing (max 1, 2, or 3 matching registered member count).</div>
            </div>
            <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800">
              <div className="text-emerald-400 font-bold mb-1">team_submissions</div>
              <div className="text-zinc-400">Unique partial index prevents duplicate teammate solve credits.</div>
            </div>
            <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800">
              <div className="text-blue-400 font-bold mb-1">challenges</div>
              <div className="text-zinc-400">Broken Java templates, test suites, and points per tier.</div>
            </div>
            <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800">
              <div className="text-blue-400 font-bold mb-1">difficulty_unlocks</div>
              <div className="text-zinc-400">Tiers unlocked per team; permanent access retention.</div>
            </div>
            <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800">
              <div className="text-purple-400 font-bold mb-1">event_state</div>
              <div className="text-zinc-400">Authoritative timer state: start, pause, and end timestamps.</div>
            </div>
            <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800">
              <div className="text-purple-400 font-bold mb-1">leaderboard_view</div>
              <div className="text-zinc-400">ORDER BY problems_solved DESC, total_score DESC, timestamp ASC.</div>
            </div>
          </div>
        </div>
      )}

      {/* View 3: Sandbox Isolation */}
      {activeView === 'sandbox' && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-4 font-mono text-xs">
          <div className="border-b border-zinc-800 pb-3">
            <h3 className="font-bold text-white text-sm">Java Sandbox Isolation & Threat Model</h3>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              Strict isolation parameters for running untrusted competitor Java code (execution-worker/architecture.md).
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 text-[11px]">
            <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1.5">
              <div className="text-emerald-400 font-bold flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Zero Network Access (--network none)</span>
              </div>
              <p className="text-zinc-400">
                Containers have no network interfaces other than loopback. Competitors cannot exfiltrate data, perform network calls, or reach internal infrastructure.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1.5">
              <div className="text-emerald-400 font-bold flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Hard Resource Quotas (256MB RAM / 8s Max)</span>
              </div>
              <p className="text-zinc-400">
                cgroups v2 strictly limits memory to 256MB and enforces an 8-second watchdog kill timer. Infinite loops and memory bombs are cleanly terminated.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1.5">
              <div className="text-emerald-400 font-bold flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Read-Only Root Filesystem</span>
              </div>
              <p className="text-zinc-400">
                The container root filesystem is mounted read-only. Source files and bytecode reside in a temporary RAM-backed tmpfs (`/tmp/workspace`) wiped immediately upon process exit.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1.5">
              <div className="text-emerald-400 font-bold flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Process Table Ceiling (--pids-limit 32)</span>
              </div>
              <p className="text-zinc-400">
                Prevents fork bombs and thread exhaustion. Configurable unprivileged user `sandbox (default uid 2001)` prevents privilege escalation.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* View 4: Phased Roadmap */}
      {activeView === 'roadmap' && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-4 font-mono text-xs">
          <div className="border-b border-zinc-800 pb-3">
            <h3 className="font-bold text-white text-sm">Sequential Phased Development Roadmap</h3>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              Strict step-by-step implementation order with zero premature dependency leakage.
            </p>
          </div>

          <div className="space-y-2.5">
            <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-800/60 flex items-start gap-3">
              <span className="text-emerald-400 font-bold text-xs uppercase px-2 py-0.5 rounded bg-emerald-950 border border-emerald-800">
                FRAGMENT 1 • COMPLETE
              </span>
              <div>
                <div className="font-bold text-white">Project Foundation, Immutable Rules & Architecture</div>
                <div className="text-[11px] text-zinc-300 mt-0.5">
                  Clean Express server, 33 verified rules unit tests, PostgreSQL schema, Docker orchestration, and high-contrast frontend console with zero DB/Redis runtime dependencies.
                </div>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 flex items-start gap-3">
              <span className="text-amber-400 font-bold text-xs uppercase px-2 py-0.5 rounded bg-amber-950 border border-amber-800">
                FRAGMENT 2 • NEXT
              </span>
              <div>
                <div className="font-bold text-white">CSV Team Importer, Participant Auth & Session Coordinator</div>
                <div className="text-[11px] text-zinc-400 mt-0.5">
                  Ingest symposium CSV files with flexible column mappings. Validate Team Name + CSV Code login. Enforce 1 to 3 concurrent sessions.
                </div>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 flex items-start gap-3">
              <span className="text-zinc-500 font-bold text-xs uppercase px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800">
                FRAGMENT 3
              </span>
              <div>
                <div className="font-bold text-white">Monaco Editor & Java Sandbox Worker Pipeline</div>
                <div className="text-[11px] text-zinc-400 mt-0.5">
                  BullMQ daemon, OpenJDK 21 execution containers, stdout/stderr compiler streaming, and infinite loop protection.
                </div>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 flex items-start gap-3">
              <span className="text-zinc-500 font-bold text-xs uppercase px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800">
                FRAGMENT 4 & 5
              </span>
              <div>
                <div className="font-bold text-white">Challenges, Live Scoreboard (/live) & Admin Center</div>
                <div className="text-[11px] text-zinc-400 mt-0.5">
                  Tier ladder (Easy/Med/Hard/Extreme), atomic same-problem teammate race handling, projector view, and organizer controls.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
