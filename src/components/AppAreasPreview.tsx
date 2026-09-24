import React, { useState } from 'react';
import { Terminal, Shield, Tv, Code, Play, CheckCircle2, Users, FileSpreadsheet, Lock, AlertTriangle } from 'lucide-react';

export const AppAreasPreview: React.FC = () => {
  const [selectedArea, setSelectedArea] = useState<'participant' | 'admin' | 'live'>('participant');
  const [activeCodeTab, setActiveCodeTab] = useState<'broken' | 'fixed'>('broken');

  const brokenCode = `// Problem EASY-01: Array Boundary Guard
public class Solution {
    public static void main(String[] args) {
        int[] data = { 10, 20, 30, 40, 50 };
        // BUG: <= causes ArrayIndexOutOfBoundsException on 5!
        for (int i = 0; i <= data.length; i++) {
            System.out.println("Processing index: " + data[i]);
        }
    }
}`;

  const fixedCode = `// Problem EASY-01: Array Boundary Guard (Repaired)
public class Solution {
    public static void main(String[] args) {
        int[] data = { 10, 20, 30, 40, 50 };
        // CORRECTED: Strictly < length prevents out of bounds!
        for (int i = 0; i < data.length; i++) {
            System.out.println("Processing index: " + data[i]);
        }
        // Sandbox behavioral assertion satisfied -> Flag Reconstructed
        System.out.println("[REVEALED_FLAG]: DBG{arr4y_b0unds_r3ctified_882}");
    }
}`;

  return (
    <div id="three-application-areas" className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-4">
        <div>
          <div className="flex items-center gap-2 text-cyan-400 font-mono text-xs font-semibold uppercase tracking-wider">
            <Terminal className="w-4 h-4" />
            <span>Interactive Visual Preview</span>
          </div>
          <h2 className="text-xl font-bold text-white font-mono mt-1">
            The Three Major Application Experiences
          </h2>
          <p className="text-xs text-zinc-400 font-mono mt-0.5">
            Clear structural boundary separating Competitor Arena, Admin Control Deck, and Public Scoreboard.
          </p>
        </div>

        {/* View Switcher Tabs */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-zinc-900 border border-zinc-800 font-mono text-xs overflow-x-auto">
          <button
            id="tab-btn-participant"
            onClick={() => setSelectedArea('participant')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg transition-all whitespace-nowrap ${
              selectedArea === 'participant'
                ? 'bg-emerald-500 text-zinc-950 font-bold shadow'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>1. Participant Arena</span>
          </button>
          <button
            id="tab-btn-admin"
            onClick={() => setSelectedArea('admin')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg transition-all whitespace-nowrap ${
              selectedArea === 'admin'
                ? 'bg-blue-500 text-zinc-950 font-bold shadow'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>2. Organizer Admin</span>
          </button>
          <button
            id="tab-btn-live"
            onClick={() => setSelectedArea('live')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg transition-all whitespace-nowrap ${
              selectedArea === 'live'
                ? 'bg-amber-500 text-zinc-950 font-bold shadow'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Tv className="w-3.5 h-3.5" />
            <span>3. Public (/live)</span>
          </button>
        </div>
      </div>

      {/* Experience 1: Participant Arena */}
      {selectedArea === 'participant' && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 sm:p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800/80 pb-4">
            <div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-800/60 uppercase font-semibold">
                EXPERIENCE A • COMPETITOR INTERFACE
              </span>
              <h3 className="text-base font-bold text-white font-mono mt-2">
                Participant Java Debugging Arena (Monaco Editor)
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Authenticates with Team Name + CSV Code. Unlocks challenges, debugs Java code, and triggers unlimited executions.
              </p>
            </div>
            <div className="flex items-center gap-2 font-mono text-xs text-zinc-400 bg-zinc-950 px-3 py-1.5 rounded-xl border border-zinc-800 self-start sm:self-auto">
              <Users className="w-3.5 h-3.5 text-emerald-400" />
              <span>Session Limit: 1 to 3 Members</span>
            </div>
          </div>

          {/* Interactive Monaco Editor Simulator */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden font-mono text-xs">
            {/* Editor Header */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-900 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <span className="text-zinc-400">Main.java</span>
                <span className="text-zinc-600">•</span>
                <span className="text-emerald-400 font-semibold text-[11px]">OpenJDK 21 Headless</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveCodeTab('broken')}
                  className={`px-2.5 py-1 rounded text-[11px] transition-colors ${
                    activeCodeTab === 'broken'
                      ? 'bg-rose-950 text-rose-300 border border-rose-800/60'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  Inspect Broken Defect
                </button>
                <button
                  onClick={() => setActiveCodeTab('fixed')}
                  className={`px-2.5 py-1 rounded text-[11px] transition-colors ${
                    activeCodeTab === 'fixed'
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/60'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  Inspect Repaired Fix
                </button>
              </div>
            </div>

            {/* Code Body */}
            <pre className="p-4 text-[12px] leading-relaxed text-zinc-300 overflow-x-auto">
              <code>{activeCodeTab === 'broken' ? brokenCode : fixedCode}</code>
            </pre>

            {/* Simulated Console Output */}
            <div className="border-t border-zinc-800 bg-[#090a0f] p-4 text-[11px]">
              <div className="flex items-center justify-between text-zinc-500 mb-2">
                <div className="flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5 text-zinc-400" />
                  <span>SANDBOX EXECUTION CONSOLE (UNLIMITED RUNS)</span>
                </div>
                <span className="text-zinc-600">Memory: 24MB / 256MB • Exec: 184ms</span>
              </div>
              {activeCodeTab === 'broken' ? (
                <div className="text-rose-400 leading-relaxed font-mono">
                  <div>Processing index: 10</div>
                  <div>Processing index: 20</div>
                  <div>Processing index: 30</div>
                  <div>Processing index: 40</div>
                  <div>Processing index: 50</div>
                  <div className="text-rose-300 font-bold mt-1">
                    Exception in thread "main" java.lang.ArrayIndexOutOfBoundsException: Index 5 out of bounds for length 5
                  </div>
                  <div className="text-zinc-500">at Main.main(Main.java:7)</div>
                </div>
              ) : (
                <div className="text-emerald-400 leading-relaxed font-mono">
                  <div>Processing index: 10</div>
                  <div>Processing index: 20</div>
                  <div>Processing index: 30</div>
                  <div>Processing index: 40</div>
                  <div>Processing index: 50</div>
                  <div className="p-2 rounded-lg bg-emerald-950/40 border border-emerald-800/60 text-emerald-300 font-bold mt-2">
                    ✓ Behavioral Assertions Passed! Reconstructed Flag Revealed:
                    <div className="text-amber-300 font-mono text-xs mt-1">DBG&#123;arr4y_b0unds_r3ctified_882&#125;</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Experience 2: Admin Control Center */}
      {selectedArea === 'admin' && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 sm:p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800/80 pb-4">
            <div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-950/60 text-blue-400 border border-blue-800/60 uppercase font-semibold">
                EXPERIENCE B • ORGANIZER COMMAND DECK
              </span>
              <h3 className="text-base font-bold text-white font-mono mt-2">
                Organizer Admin Control Center (/admin)
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Central authority for the 60-minute competition timer, CSV participant roster ingestion, and live team surveillance.
              </p>
            </div>
            <span className="text-xs font-mono px-2.5 py-1 rounded-lg bg-zinc-950 border border-zinc-800 text-blue-400">
              Organizer Route Only
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 font-mono text-xs">
            <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-950">
              <div className="text-zinc-500 mb-2 flex items-center justify-between">
                <span>MASTER TIMER CONTROLS</span>
                <span className="text-amber-400 font-bold">60:00</span>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <button className="py-2 px-3 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold">
                  START MATCH
                </button>
                <button className="py-2 px-3 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold">
                  PAUSE MATCH
                </button>
              </div>
              <div className="text-[10px] text-zinc-500 mt-3">
                Broadcasts authoritative timestamp to all connected participants.
              </div>
            </div>

            <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-950">
              <div className="text-zinc-500 mb-2 flex items-center justify-between">
                <span>CSV TEAM IMPORTER</span>
                <FileSpreadsheet className="w-4 h-4 text-blue-400" />
              </div>
              <div className="p-2.5 rounded bg-zinc-900 border border-zinc-800 text-[11px] text-zinc-300">
                <div>Mapped Headers:</div>
                <div className="text-emerald-400 mt-1">TeamName, Code, Member1, Member2, Member3</div>
              </div>
              <div className="text-[10px] text-zinc-500 mt-3">
                Preserves existing codes; never generates artificial credentials.
              </div>
            </div>

            <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-950">
              <div className="text-zinc-500 mb-2 flex items-center justify-between">
                <span>ACTIVE SESSION AUDITOR</span>
                <Users className="w-4 h-4 text-purple-400" />
              </div>
              <div className="space-y-1 text-[11px]">
                <div className="flex justify-between text-zinc-300">
                  <span>Registered Team Capacity:</span>
                  <span className="text-emerald-400 font-bold">1–3 Members Max</span>
                </div>
                <div className="flex justify-between text-zinc-300">
                  <span>Enforcement Mode:</span>
                  <span className="text-blue-400 font-bold">Database Strict</span>
                </div>
              </div>
              <div className="text-[10px] text-zinc-500 mt-3">
                Strictly blocks exceeding member headcount quotas.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Experience 3: Public Live Scoreboard */}
      {selectedArea === 'live' && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 sm:p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800/80 pb-4">
            <div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-950/60 text-amber-400 border border-amber-800/60 uppercase font-semibold">
                EXPERIENCE C • PUBLIC AUDITORIUM SCREEN
              </span>
              <h3 className="text-base font-bold text-white font-mono mt-2">
                Public Live Scoreboard (/live)
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Full-screen projector display for the symposium hall. High contrast, large numbers, and strict participant privacy shield.
              </p>
            </div>
            <span className="text-xs font-mono px-2.5 py-1 rounded-lg bg-zinc-950 border border-zinc-800 text-amber-400">
              Projector Display Mode
            </span>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3 mb-3">
              <div className="flex items-center gap-2">
                <span className="text-amber-400 font-bold">AUDITORIUM STANDINGS</span>
                <span className="text-zinc-600">•</span>
                <span className="text-zinc-400">Order: Solved Count &gt; Score &gt; Time</span>
              </div>
              <div className="text-[11px] text-emerald-400 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5" />
                <span>Zero Private Data Exposed</span>
              </div>
            </div>

            <div className="p-8 rounded-lg bg-zinc-900/40 border border-dashed border-zinc-800 text-center space-y-2">
              <Users className="w-8 h-8 text-zinc-600 mx-auto" />
              <div className="text-zinc-300 font-bold">Awaiting Symposium CSV Import</div>
              <p className="text-zinc-500 text-[11px] max-w-sm mx-auto">
                Live rankings populate automatically as registered teams connect and solve challenges during active matches.
              </p>
            </div>

            <div className="mt-4 pt-3 border-t border-zinc-800/80 text-[11px] text-zinc-500 flex items-center justify-between">
              <span>Auto-refreshes every 5s during match</span>
              <span>Auditorium Layout Optimized for 1080p/4K Projectors</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
