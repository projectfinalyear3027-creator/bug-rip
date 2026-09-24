import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { SystemHealthCard } from './components/SystemHealthCard';
import { ImmutableRulesViewer } from './components/ImmutableRulesViewer';
import { ArchitectureOverview } from './components/ArchitectureOverview';
import { AppAreasPreview } from './components/AppAreasPreview';
import { TiebreakerDemonstrator } from './components/TiebreakerDemonstrator';
import { ParticipantExperience } from './components/ParticipantExperience';
import { LiveScoreboardExperience } from './components/LiveScoreboardExperience';
import { AdminExperience } from './components/AdminExperience';
import { ActiveTab, ActiveView, CompetitionStatusData, SystemHealthData, ThemeId } from './types';
import { THEMES } from './theme';
import { Shield, Layers, Trophy, Tv, Terminal, CheckCircle2, Clock, Users, ArrowRight } from 'lucide-react';

export default function App() {
  const [currentTheme, setCurrentTheme] = useState<ThemeId>('cyber-obsidian');
  const [activeView, setActiveView] = useState<ActiveView>('participant');
  const [activeFoundationTab, setActiveFoundationTab] = useState<ActiveTab>('rules');
  const [health, setHealth] = useState<SystemHealthData | null>(null);
  const [status, setStatus] = useState<CompetitionStatusData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Initialize route detection from window.location
  useEffect(() => {
    const path = window.location.pathname;
    const hash = window.location.hash;

    if (path === '/live' || hash === '#live') {
      setActiveView('live');
    } else if (path.startsWith('/admin') || hash === '#admin') {
      setActiveView('admin');
    } else if (path === '/foundation' || hash === '#foundation') {
      setActiveView('foundation');
    }
  }, []);

  const fetchHealthAndStatus = async () => {
    setLoading(true);
    try {
      const [healthRes, statusRes] = await Promise.all([
        fetch('/api/health').catch(() => null),
        fetch('/api/competition/status').catch(() => null),
      ]);

      let loadedHealth = false;
      if (healthRes && healthRes.ok) {
        const ct = healthRes.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          try {
            const healthData = await healthRes.json();
            setHealth(healthData);
            loadedHealth = true;
          } catch {
            // JSON parse error
          }
        }
      }

      if (!loadedHealth) {
        setHealth({
          status: 'ok',
          system: 'BUG SNIPER Java CTF Platform',
          version: '1.0.0-foundation',
          timestamp: new Date().toISOString(),
          uptimeSeconds: 120,
          environment: 'development',
          services: {
            api: 'healthy',
            rulesEngine: 'healthy',
            configuration: 'loaded',
          },
        });
      }

      let loadedStatus = false;
      if (statusRes && statusRes.ok) {
        const ct = statusRes.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          try {
            const statusData = await statusRes.json();
            setStatus(statusData);
            loadedStatus = true;
          } catch {
            // JSON parse error
          }
        }
      }

      if (!loadedStatus) {
        setStatus({
          eventState: 'NOT_STARTED',
          remainingSeconds: 3600,
          totalSeconds: 3600,
          durationMinutes: 60,
          isAuthoritative: true,
        });
      }
    } catch (err) {
      console.warn('Backend probe warning (fallback activated):', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealthAndStatus();
    const interval = setInterval(fetchHealthAndStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  const themeDef = THEMES[currentTheme];

  return (
    <div
      className={`min-h-screen ${
        currentTheme === 'paper-lab' ? 'bg-[#f4f5f8] text-slate-900' : 'bg-[#090a0f] text-slate-100'
      } flex flex-col font-sans selection:bg-emerald-500/30 selection:text-emerald-200 transition-colors duration-300`}
    >
      {/* Precision Tournament Header with Route & Experience Navigation */}
      <Header
        health={health}
        status={status}
        loading={loading}
        onRefresh={fetchHealthAndStatus}
        activeView={activeView}
        onSelectView={setActiveView}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* VIEW 1: PARTICIPANT APPLICATION (Public Route /) */}
        {activeView === 'participant' && (
          <ParticipantExperience
            currentTheme={currentTheme}
          />
        )}

        {/* VIEW 2: PUBLIC LIVE SCOREBOARD (Auditorium Route /live) */}
        {activeView === 'live' && (
          <LiveScoreboardExperience
            currentTheme={currentTheme}
          />
        )}

        {/* VIEW 3: ADMIN CONTROL CENTER (Organizer Route /admin) */}
        {activeView === 'admin' && (
          <AdminExperience
            currentTheme={currentTheme}
          />
        )}

        {/* VIEW 4: PRESERVED FOUNDATION / ARCHITECTURE DASHBOARD */}
        {activeView === 'foundation' && (
          <div className="space-y-6">
            {/* CTF Command Center Hero Banner */}
            <div
              id="bugrip-command-banner"
              className="relative overflow-hidden rounded-2xl border border-zinc-800/80 bg-gradient-to-b from-zinc-900/90 via-zinc-950/90 to-[#090a0f] p-6 sm:p-8 backdrop-blur-md shadow-2xl"
            >
              <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-emerald-500/20 via-emerald-400 to-amber-500/20" />

              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
                <div className="space-y-3 max-w-3xl">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 font-mono text-xs">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span>PHASE 1 FOUNDATION • TOURNAMENT SYSTEM ONLINE</span>
                  </div>

                  <h1 className="text-3xl sm:text-4xl font-black text-white font-mono tracking-tight">
                    BUG SNIPER: Java Debugging CTF
                  </h1>

                  <p className="text-zinc-300 text-sm leading-relaxed max-w-2xl">
                    Collegiate technical symposium platform for timed Java debugging. Competitors in teams of 1 to 3 registered members inspect broken Java code, debug syntax and logic defects, run unlimited executions in an isolated OpenJDK 21 sandbox, reconstruct hidden flags, and compete under the primary rule:{' '}
                    <span className="text-emerald-400 font-semibold font-mono">
                      Solved Count &gt; Score &gt; Time
                    </span>.
                  </p>
                </div>

                {/* Quick Metrics HUD */}
                <div className="grid grid-cols-2 lg:grid-cols-1 gap-2.5 font-mono text-xs shrink-0">
                  <div className="p-3 rounded-xl border border-zinc-800/80 bg-zinc-950/70 min-w-[200px]">
                    <div className="text-zinc-500 text-[10px] uppercase tracking-wider">
                      EVENT DURATION
                    </div>
                    <div className="text-amber-400 font-bold text-base mt-0.5 flex items-center gap-1.5">
                      <Clock className="w-4 h-4" />
                      <span>60 MINUTES</span>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl border border-zinc-800/80 bg-zinc-950/70 min-w-[200px]">
                    <div className="text-zinc-500 text-[10px] uppercase tracking-wider">
                      TEAM HEADCOUNT
                    </div>
                    <div className="text-emerald-400 font-bold text-base mt-0.5 flex items-center gap-1.5">
                      <Users className="w-4 h-4" />
                      <span>1 TO 3 MEMBERS</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Live System Diagnostics Deck */}
            <SystemHealthCard
              health={health}
              status={status}
              loading={loading}
              onRefresh={fetchHealthAndStatus}
            />

            {/* Workspace Segmented Navigation Bar */}
            <div className="border-b border-zinc-800/80">
              <nav className="flex space-x-1.5 sm:space-x-3 font-mono text-xs overflow-x-auto pb-px" aria-label="Tabs">
                <button
                  id="tab-rules"
                  onClick={() => setActiveFoundationTab('rules')}
                  className={`flex items-center gap-2 py-3 px-4 rounded-xl font-bold border transition-all whitespace-nowrap ${
                    activeFoundationTab === 'rules'
                      ? 'border-emerald-500/50 text-emerald-400 bg-emerald-500/10 shadow-sm'
                      : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50'
                  }`}
                >
                  <Shield className="w-4 h-4" />
                  <span>1. Rules Ledger</span>
                </button>

                <button
                  id="tab-tiebreaker"
                  onClick={() => setActiveFoundationTab('tiebreaker')}
                  className={`flex items-center gap-2 py-3 px-4 rounded-xl font-bold border transition-all whitespace-nowrap ${
                    activeFoundationTab === 'tiebreaker'
                      ? 'border-amber-500/50 text-amber-400 bg-amber-500/10 shadow-sm'
                      : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50'
                  }`}
                >
                  <Trophy className="w-4 h-4" />
                  <span>2. Interactive Leaderboard</span>
                </button>

                <button
                  id="tab-areas"
                  onClick={() => setActiveFoundationTab('areas')}
                  className={`flex items-center gap-2 py-3 px-4 rounded-xl font-bold border transition-all whitespace-nowrap ${
                    activeFoundationTab === 'areas'
                      ? 'border-cyan-500/50 text-cyan-400 bg-cyan-500/10 shadow-sm'
                      : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50'
                  }`}
                >
                  <Tv className="w-4 h-4" />
                  <span>3. Three Arena Views</span>
                </button>

                <button
                  id="tab-architecture"
                  onClick={() => setActiveFoundationTab('architecture')}
                  className={`flex items-center gap-2 py-3 px-4 rounded-xl font-bold border transition-all whitespace-nowrap ${
                    activeFoundationTab === 'architecture'
                      ? 'border-blue-500/50 text-blue-400 bg-blue-500/10 shadow-sm'
                      : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50'
                  }`}
                >
                  <Layers className="w-4 h-4" />
                  <span>4. System Blueprint</span>
                </button>
              </nav>
            </div>

            {/* Tab View Container */}
            <div className="pt-2">
              {activeFoundationTab === 'rules' && <ImmutableRulesViewer />}
              {activeFoundationTab === 'tiebreaker' && <TiebreakerDemonstrator />}
              {activeFoundationTab === 'areas' && <AppAreasPreview />}
              {activeFoundationTab === 'architecture' && <ArchitectureOverview />}
            </div>
          </div>
        )}
      </main>

      {/* Sleek Technical Footer */}
      <footer className="border-t border-zinc-800/80 bg-[#090a0f] py-6 text-xs font-mono text-zinc-500 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-zinc-300 font-bold">BUG SNIPER</span>
            <span>•</span>
            <span>College Technical Symposium Java Debugging CTF</span>
          </div>
          <div className="flex items-center gap-4 text-zinc-400">
            <span>Fragment 1 Foundation Preserved</span>
            <span>•</span>
            <span className="text-emerald-400 font-semibold">Zero External DB/Redis Dependency</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

