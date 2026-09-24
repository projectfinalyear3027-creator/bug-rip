import React, { useState, useEffect } from 'react';
import { adminFetch, getStoredAdminToken } from './adminFetch';
import {
  Users,
  Search,
  RefreshCw,
  Eye,
  EyeOff,
  Shield,
  Clock,
  CheckCircle2,
  AlertCircle,
  X,
  ExternalLink,
  Laptop,
} from 'lucide-react';

interface TeamOverviewItem {
  id: string;
  teamName: string;
  teamCode: string;
  registeredMemberCount: number;
  connectedMemberCount: number;
  status: 'ACTIVE' | 'DISABLED' | 'DISQUALIFIED';
  problemsSolved: number;
  totalScore: number;
  createdAt: string;
}

interface TeamDetail {
  id: string;
  teamName: string;
  teamCode: string;
  registeredMemberCount: number;
  status: string;
  members: Array<{
    id: string;
    name: string;
    email: string | null;
    college: string | null;
    assignedAt: string;
  }>;
  activeSessions: Array<{
    id: string;
    participantName: string;
    ipAddress: string | null;
    connectedAt: string;
    lastHeartbeatAt: string;
  }>;
}

export const AdminTeams: React.FC = () => {
  const [teams, setTeams] = useState<TeamOverviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [revealedCodes, setRevealedCodes] = useState<Set<string>>(new Set());
  const [selectedTeam, setSelectedTeam] = useState<TeamDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState(new Date());

  const fetchTeams = async () => {
    try {
      const res = await adminFetch('/api/admin/teams');
      if (res.ok) {
        const data = await res.json();
        setTeams(data.teams || []);
        setLastRefreshed(new Date());
      }
    } catch (err) {
      console.error('Failed to load teams overview:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTeams();
    const interval = setInterval(fetchTeams, 5000);

    let eventSource: EventSource | null = null;
    try {
      const token = getStoredAdminToken();
      const sseUrl = token ? `/api/admin/events?token=${encodeURIComponent(token)}` : '/api/admin/events';
      eventSource = new EventSource(sseUrl, { withCredentials: true });
      eventSource.addEventListener('admin.connection.changed', (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload && payload.teamId && typeof payload.teamConnectedCount === 'number') {
            setTeams((prev) =>
              prev.map((t) =>
                t.id === payload.teamId
                  ? {
                      ...t,
                      connectedMemberCount: payload.teamConnectedCount,
                      connectedMembersCount: payload.teamConnectedCount,
                    }
                  : t
              )
            );
          }
        } catch {}
        fetchTeams();
      });
      eventSource.addEventListener('admin.teams.updated', () => {
        fetchTeams();
      });
    } catch {
      // Fallback handled by interval
    }

    return () => {
      clearInterval(interval);
      if (eventSource) {
        eventSource.close();
      }
    };
  }, []);

  const toggleReveal = (teamId: string) => {
    setRevealedCodes((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) {
        next.delete(teamId);
      } else {
        next.add(teamId);
      }
      return next;
    });
  };

  const openTeamDetail = async (teamId: string) => {
    setDetailLoading(true);
    try {
      const res = await adminFetch(`/api/admin/teams/${teamId}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedTeam(data.team);
      }
    } catch (err) {
      console.error('Failed to load team detail:', err);
    } finally {
      setDetailLoading(false);
    }
  };

  const filteredTeams = teams.filter(
    (t) =>
      t.teamName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.teamCode.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div id="admin-teams-view" className="space-y-6 font-mono">
      {/* Top Controls Header */}
      <div className="bg-zinc-950/80 border border-zinc-800 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
            <Users className="w-4 h-4 text-blue-400" />
            Live Team Connection Monitor
          </h3>
          <p className="text-xs text-zinc-400 mt-1">
            Real database quotas: exactly 1–2 concurrent members per team. Synced: {lastRefreshed.toLocaleTimeString()}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search team or code..."
              className="bg-zinc-900 border border-zinc-700/80 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <button
            onClick={() => fetchTeams()}
            className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/70 rounded-lg text-xs text-zinc-300 flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Sync</span>
          </button>
        </div>
      </div>

      {/* Teams Table */}
      <div className="bg-zinc-950/90 border border-zinc-800 rounded-xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-zinc-900/80 text-zinc-400 border-b border-zinc-800 font-semibold uppercase tracking-wider">
                <th className="py-3 px-4">Team Name</th>
                <th className="py-3 px-4">Secret Team Code</th>
                <th className="py-3 px-4">Members Connected</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Solved</th>
                <th className="py-3 px-4">Total Score</th>
                <th className="py-3 px-4 text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {filteredTeams.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-zinc-500">
                    {loading ? 'Loading teams from database...' : 'No matching teams found in database.'}
                  </td>
                </tr>
              ) : (
                filteredTeams.map((team) => {
                  const isRevealed = revealedCodes.has(team.id);
                  const isFull = team.connectedMemberCount >= team.registeredMemberCount;
                  const isPartial = team.connectedMemberCount > 0 && !isFull;

                  return (
                    <tr key={team.id} className="hover:bg-zinc-900/40 transition-colors">
                      <td className="py-3 px-4 font-bold text-zinc-200">
                        {team.teamName}
                      </td>
                      <td className="py-3 px-4 font-mono text-zinc-300">
                        <div className="flex items-center gap-2">
                          <span>
                            {isRevealed ? team.teamCode : '••••••••••••'}
                          </span>
                          <button
                            onClick={() => toggleReveal(team.id)}
                            className="text-zinc-500 hover:text-zinc-300 cursor-pointer"
                            title={isRevealed ? 'Hide code' : 'Reveal code'}
                          >
                            {isRevealed ? (
                              <EyeOff className="w-3.5 h-3.5" />
                            ) : (
                              <Eye className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold ${
                            isFull
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                              : isPartial
                              ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                              : 'bg-zinc-800/80 text-zinc-400 border border-zinc-700'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              isFull
                                ? 'bg-emerald-400'
                                : isPartial
                                ? 'bg-amber-400'
                                : 'bg-zinc-500'
                            }`}
                          />
                          {team.connectedMemberCount} / {team.registeredMemberCount} Connected
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                            team.status === 'ACTIVE'
                              ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-500/30'
                              : 'bg-red-950/40 text-red-300 border border-red-500/30'
                          }`}
                        >
                          {team.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-zinc-300 font-bold">
                        {team.problemsSolved}
                      </td>
                      <td className="py-3 px-4 text-amber-300 font-bold">
                        {team.totalScore} pts
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => openTeamDetail(team.id)}
                          className="px-2.5 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 text-blue-400 hover:text-blue-300 transition-colors text-[11px] font-semibold cursor-pointer"
                        >
                          Inspect
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Team Detail Modal */}
      {selectedTeam && (
        <div
          id="admin-team-detail-modal"
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl max-w-2xl w-full p-6 shadow-2xl relative">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-4 mb-4">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-blue-400" />
                <h3 className="text-base font-bold text-zinc-100">
                  {selectedTeam.teamName}
                </h3>
                <span className="text-xs text-zinc-500">({selectedTeam.teamCode})</span>
              </div>
              <button
                onClick={() => setSelectedTeam(null)}
                className="text-zinc-500 hover:text-zinc-200 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-5 text-xs">
              {/* Registered Members */}
              <div>
                <h4 className="text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-emerald-400" />
                  Registered Symposium Members ({selectedTeam.members.length}/{selectedTeam.registeredMemberCount})
                </h4>
                <div className="space-y-2">
                  {selectedTeam.members.map((m) => (
                    <div
                      key={m.id}
                      className="p-2.5 bg-zinc-900/70 border border-zinc-800/80 rounded-lg flex items-center justify-between"
                    >
                      <div>
                        <span className="font-bold text-zinc-200 block">{m.name}</span>
                        <span className="text-[11px] text-zinc-500">{m.college || 'Institution Not Listed'}</span>
                      </div>
                      <span className="text-[11px] text-zinc-400">
                        {m.email || 'Email not recorded'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Active Sessions */}
              <div>
                <h4 className="text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Laptop className="w-4 h-4 text-blue-400" />
                  Live Concurrent Sessions ({selectedTeam.activeSessions.length})
                </h4>
                {selectedTeam.activeSessions.length === 0 ? (
                  <div className="p-3 bg-zinc-900/40 border border-zinc-800 rounded-lg text-zinc-500 text-center">
                    No active sockets or heartbeats currently detected for this team.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selectedTeam.activeSessions.map((s) => (
                      <div
                        key={s.id}
                        className="p-2.5 bg-zinc-900/70 border border-emerald-500/30 rounded-lg flex items-center justify-between"
                      >
                        <div>
                          <span className="font-bold text-emerald-400 block flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block animate-ping" />
                            {s.participantName}
                          </span>
                          <span className="text-[10px] text-zinc-500 font-mono">
                            Terminal IP: {s.ipAddress || 'Internal Loopback'}
                          </span>
                        </div>
                        <div className="text-right text-[11px] text-zinc-400">
                          <div>Connected: {new Date(s.connectedAt).toLocaleTimeString()}</div>
                          <div className="text-[10px] text-zinc-500">
                            Heartbeat: {new Date(s.lastHeartbeatAt).toLocaleTimeString()}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-zinc-800 flex justify-end">
              <button
                onClick={() => setSelectedTeam(null)}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-semibold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
