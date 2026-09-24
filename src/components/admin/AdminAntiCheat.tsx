import React, { useState, useEffect, useCallback } from 'react';
import { adminFetch, getStoredAdminToken } from './adminFetch';
import {
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  AlertTriangle,
  Users,
  Eye,
  CheckCircle2,
  XCircle,
  Filter,
  Search,
  ExternalLink,
  Clock,
  ChevronRight,
  Sliders,
  FileCheck,
} from 'lucide-react';

interface AntiCheatEventItem {
  id: string;
  teamId: string;
  participantId?: string | null;
  teamName: string | null;
  teamCode?: string | null;
  participantName?: string | null;
  participantCode?: string | null;
  challengeId: string | null;
  challengeTitle: string | null;
  eventType: string;
  actionTaken: string;
  metadata: any;
  reviewedBy: string | null;
  reviewerUsername: string | null;
  adminNotes: string | null;
  reviewedAt: string | null;
  matchNumber?: number;
  matchId?: string | null;
  createdAt: string;
}

interface AntiCheatSummaryStats {
  totalEvents: number;
  eventsByType: Record<string, number>;
  teamsWithViolationsCount: number;
  recentEventsCount: number;
}

interface OffendingTeamItem {
  teamId: string;
  teamName: string;
  accessCode: string;
  totalEvents: number;
  eventsByType: Record<string, number>;
  latestEventAt: string;
}

export const AdminAntiCheat: React.FC = () => {
  const [events, setEvents] = useState<AntiCheatEventItem[]>([]);
  const [summary, setSummary] = useState<AntiCheatSummaryStats | null>(null);
  const [offendingTeams, setOffendingTeams] = useState<OffendingTeamItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  // Filters
  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [selectedTeamId, setSelectedTeamId] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Review Modal / State
  const [reviewingEvent, setReviewingEvent] = useState<AntiCheatEventItem | null>(null);
  const [reviewAction, setReviewAction] = useState<string>('VERIFIED_CLEAR');
  const [reviewNotes, setReviewNotes] = useState<string>('');
  const [submittingReview, setSubmittingReview] = useState<boolean>(false);
  const [reviewFeedback, setReviewFeedback] = useState<string | null>(null);

  const fetchAntiCheatData = useCallback(async () => {
    try {
      setRefreshing(true);
      const [eventsRes, summaryRes] = await Promise.all([
        adminFetch(
          `/api/admin/anti-cheat/events?limit=100${
            selectedType !== 'ALL' ? `&eventType=${selectedType}` : ''
          }${selectedTeamId !== 'ALL' ? `&teamId=${selectedTeamId}` : ''}`
        ),
        adminFetch('/api/admin/anti-cheat/summary'),
      ]);

      if (eventsRes.ok) {
        const eventsData = await eventsRes.json();
        if (eventsData.success && eventsData.data) {
          setEvents(eventsData.data.events || []);
        }
      }

      if (summaryRes.ok) {
        const sumData = await summaryRes.json();
        if (sumData.success && sumData.data) {
          setSummary(sumData.data.stats || null);
          setOffendingTeams(sumData.data.teams || []);
        }
      }

      setLastRefreshed(new Date());
    } catch (err) {
      console.error('Failed to load anti-cheat data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedType, selectedTeamId]);

  useEffect(() => {
    fetchAntiCheatData();
    const interval = setInterval(fetchAntiCheatData, 5000);

    let eventSource: EventSource | null = null;
    try {
      const token = getStoredAdminToken();
      const sseUrl = token ? `/api/admin/events?token=${encodeURIComponent(token)}` : '/api/admin/events';
      eventSource = new EventSource(sseUrl, { withCredentials: true });
      eventSource.addEventListener('admin.anticheat.event', () => {
        fetchAntiCheatData();
      });
      eventSource.addEventListener('admin.connection.changed', () => {
        fetchAntiCheatData();
      });
      eventSource.addEventListener('admin.metrics.updated', () => {
        fetchAntiCheatData();
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
  }, [fetchAntiCheatData]);

  const handleOpenReview = (ev: AntiCheatEventItem) => {
    setReviewingEvent(ev);
    setReviewAction(ev.actionTaken === 'LOGGED' ? 'VERIFIED_CLEAR' : ev.actionTaken);
    setReviewNotes(ev.adminNotes || '');
    setReviewFeedback(null);
  };

  const handleSaveReview = async () => {
    if (!reviewingEvent) return;
    setSubmittingReview(true);
    setReviewFeedback(null);

    try {
      const res = await adminFetch(`/api/admin/anti-cheat/events/${reviewingEvent.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionTaken: reviewAction,
          adminNotes: reviewNotes,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setReviewFeedback('Incident review recorded successfully.');
        setTimeout(() => {
          setReviewingEvent(null);
          fetchAntiCheatData();
        }, 1000);
      } else {
        setReviewFeedback(data.error || 'Failed to update review.');
      }
    } catch (err: any) {
      setReviewFeedback(err.message || 'Network error updating review.');
    } finally {
      setSubmittingReview(false);
    }
  };

  const getEventBadge = (type: string) => {
    switch (type) {
      case 'FULLSCREEN_EXIT':
        return (
          <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30 text-[10px] font-bold">
            FULLSCREEN_EXIT
          </span>
        );
      case 'FULLSCREEN_ENTER':
        return (
          <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold">
            FULLSCREEN_ENTER
          </span>
        );
      case 'TAB_HIDDEN':
        return (
          <span className="px-2 py-0.5 rounded bg-orange-500/10 text-orange-300 border border-orange-500/30 text-[10px] font-bold">
            TAB_HIDDEN
          </span>
        );
      case 'TAB_VISIBLE':
        return (
          <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/30 text-[10px] font-bold">
            TAB_VISIBLE
          </span>
        );
      case 'WINDOW_BLUR':
        return (
          <span className="px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-300 border border-yellow-500/30 text-[10px] font-bold">
            WINDOW_BLUR
          </span>
        );
      case 'VIEWPORT_CHANGE':
      case 'VIEWPORT_RESIZE':
        return (
          <span className="px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/30 text-[10px] font-bold">
            VIEWPORT_CHANGE
          </span>
        );
      case 'MULTIPLE_SESSION':
      case 'MULTI_SESSION_ATTEMPT':
        return (
          <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/40 text-[10px] font-bold">
            MULTIPLE_SESSION
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700 text-[10px] font-bold">
            {type}
          </span>
        );
    }
  };

  const getActionBadge = (action: string) => {
    switch (action) {
      case 'LOGGED':
        return (
          <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[10px]">
            LOGGED
          </span>
        );
      case 'VERIFIED_CLEAR':
        return (
          <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold">
            VERIFIED_CLEAR
          </span>
        );
      case 'FLAGGED_VIOLATION':
        return (
          <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/40 text-[10px] font-bold">
            FLAGGED_VIOLATION
          </span>
        );
      case 'DISQUALIFIED':
        return (
          <span className="px-1.5 py-0.5 rounded bg-red-600 text-white font-black text-[10px]">
            DISQUALIFIED
          </span>
        );
      default:
        return (
          <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[10px]">
            {action}
          </span>
        );
    }
  };

  const filteredEvents = events.filter((ev) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    const nameMatch = ev.teamName?.toLowerCase().includes(query);
    const typeMatch = ev.eventType.toLowerCase().includes(query);
    const notesMatch = ev.adminNotes?.toLowerCase().includes(query);
    const metaMatch = JSON.stringify(ev.metadata).toLowerCase().includes(query);
    return nameMatch || typeMatch || notesMatch || metaMatch;
  });

  return (
    <div id="admin-anti-cheat-root" className="space-y-6 font-mono text-zinc-100">
      {/* 1. Header & Controls */}
      <div className="bg-zinc-950/90 border border-zinc-800 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xl">
        <div>
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-amber-400" />
            <h3 className="text-sm font-bold text-zinc-100 uppercase tracking-wide">
              Anti-Cheat & Competition Integrity Monitor
            </h3>
            <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 font-bold">
              FRAGMENT 12
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-1 max-w-3xl">
            Detects and audits browser viewport changes, tab hidden switches, window blur events, and concurrent session attempts. Signals are logged and presented for organizer review without automatic disruption of honest competitors.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-[11px] text-zinc-500 hidden sm:block">
            Updated: {lastRefreshed.toLocaleTimeString()}
          </div>
          <button
            id="admin-anti-cheat-refresh-btn"
            onClick={fetchAntiCheatData}
            disabled={refreshing}
            className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-850 text-zinc-300 hover:text-white border border-zinc-800 text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>{refreshing ? 'Syncing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* 2. Key Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-zinc-950/80 border border-zinc-800 rounded-xl p-4 shadow">
          <div className="text-[10px] uppercase text-zinc-500 font-bold tracking-wider">
            Total Logged Incidents
          </div>
          <div id="anticheat-total-count" className="text-2xl font-black text-white mt-1">
            {summary?.totalEvents ?? 0}
          </div>
          <div className="text-[11px] text-zinc-400 mt-1 flex items-center gap-1">
            <Clock className="w-3 h-3 text-zinc-500" />
            <span>Authoritative event log count</span>
          </div>
        </div>

        <div className="bg-zinc-950/80 border border-zinc-800 rounded-xl p-4 shadow">
          <div className="text-[10px] uppercase text-zinc-500 font-bold tracking-wider">
            Participants With Incidents
          </div>
          <div id="anticheat-teams-count" className="text-2xl font-black text-amber-400 mt-1">
            {summary?.teamsWithViolationsCount ?? 0}
          </div>
          <div className="text-[11px] text-zinc-400 mt-1 flex items-center gap-1">
            <Users className="w-3 h-3 text-zinc-500" />
            <span>Active participants flagged</span>
          </div>
        </div>

        <div className="bg-zinc-950/80 border border-zinc-800 rounded-xl p-4 shadow">
          <div className="text-[10px] uppercase text-zinc-500 font-bold tracking-wider">
            Recent Incidents (15m)
          </div>
          <div id="anticheat-recent-count" className="text-2xl font-black text-blue-400 mt-1">
            {summary?.recentEventsCount ?? 0}
          </div>
          <div className="text-[11px] text-zinc-400 mt-1 flex items-center gap-1">
            <Eye className="w-3 h-3 text-zinc-500" />
            <span>Active live competition activity</span>
          </div>
        </div>

        <div className="bg-zinc-950/80 border border-zinc-800 rounded-xl p-4 shadow">
          <div className="text-[10px] uppercase text-zinc-500 font-bold tracking-wider">
            Fullscreen Exits
          </div>
          <div id="anticheat-fullscreen-count" className="text-2xl font-black text-orange-400 mt-1">
            {summary?.eventsByType?.FULLSCREEN_EXIT ?? 0}
          </div>
          <div className="text-[11px] text-zinc-400 mt-1 flex items-center gap-1">
            <ShieldAlert className="w-3 h-3 text-zinc-500" />
            <span>Focus / Tab: {summary?.eventsByType?.TAB_HIDDEN ?? 0}</span>
          </div>
        </div>
      </div>

      {/* 3. Top Flagged Teams Table */}
      {offendingTeams.length > 0 && (
        <div className="bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden shadow-xl">
          <div className="bg-zinc-900/80 px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-amber-400" />
              <h4 className="text-xs font-bold text-zinc-200 uppercase tracking-wider">
                Participants with Detected Incidents
              </h4>
            </div>
            <span className="text-[11px] text-zinc-400">
              Ordered by incident frequency
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-zinc-800/80 bg-zinc-900/40 text-zinc-400 font-semibold">
                  <th className="py-2.5 px-4">Competitor</th>
                  <th className="py-2.5 px-4">Access Code</th>
                  <th className="py-2.5 px-4 text-center">Incidents</th>
                  <th className="py-2.5 px-4">Breakdown</th>
                  <th className="py-2.5 px-4">Latest Incident</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {offendingTeams.map((t) => (
                  <tr key={t.teamId} className="hover:bg-zinc-900/30 transition-colors">
                    <td className="py-3 px-4 font-bold text-white flex items-center gap-2">
                      <span>{t.teamName}</span>
                    </td>
                    <td className="py-3 px-4 font-mono text-zinc-400">
                      {t.accessCode || (t as any).teamCode || '—'}
                    </td>
                    <td className="py-3 px-4 text-center font-bold text-amber-400">
                      {t.totalEvents ?? 0}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap gap-1.5 text-[10px]">
                        {Object.entries(t.eventsByType || {}).map(([k, v]) => (
                          <span
                            key={k}
                            className="px-1.5 py-0.5 rounded bg-zinc-850 border border-zinc-700 text-zinc-300"
                          >
                            {k}: <strong>{v}</strong>
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-zinc-400 text-[11px]">
                      {t.latestEventAt || (t as any).lastEventAt
                        ? new Date(t.latestEventAt || (t as any).lastEventAt).toLocaleTimeString()
                        : 'N/A'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => setSelectedTeamId(t.teamId)}
                        className="px-2 py-1 rounded bg-zinc-850 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 text-[11px] cursor-pointer"
                      >
                        Filter Timeline
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 4. Filterable Event Timeline */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden shadow-xl">
        <div className="bg-zinc-900/80 p-4 border-b border-zinc-800 flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 w-full md:w-auto">
            <Filter className="w-4 h-4 text-blue-400" />
            <h4 className="text-xs font-bold text-zinc-200 uppercase tracking-wider">
              Authoritative Incident Timeline
            </h4>
            <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">
              {filteredEvents.length} events
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end">
            {/* Event Type Filter */}
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-750 text-xs text-zinc-200 focus:outline-hidden cursor-pointer"
            >
              <option value="ALL">All Event Types</option>
              <option value="FULLSCREEN_EXIT">Fullscreen Exit</option>
              <option value="FULLSCREEN_ENTER">Fullscreen Enter</option>
              <option value="TAB_HIDDEN">Tab Hidden</option>
              <option value="TAB_VISIBLE">Tab Visible</option>
              <option value="WINDOW_BLUR">Window Blur</option>
              <option value="WINDOW_FOCUS">Window Focus</option>
              <option value="VIEWPORT_CHANGE">Viewport Change</option>
              <option value="MULTIPLE_SESSION">Multiple Session</option>
              <option value="RECONNECT">Reconnect / Reload</option>
            </select>

            {/* Participant Filter */}
            {selectedTeamId !== 'ALL' && (
              <button
                onClick={() => setSelectedTeamId('ALL')}
                className="px-2.5 py-1.5 rounded-lg bg-blue-950/40 text-blue-300 border border-blue-500/40 text-xs flex items-center gap-1 cursor-pointer"
              >
                <span>Clear Participant Filter</span>
                <span>✕</span>
              </button>
            )}

            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search participant or notes..."
                className="pl-8 pr-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-750 text-xs text-zinc-200 placeholder-zinc-500 w-52 focus:outline-hidden"
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-zinc-800/80 bg-zinc-900/40 text-zinc-400 font-semibold">
                <th className="py-2.5 px-4">Time</th>
                <th className="py-2.5 px-4">Competitor</th>
                <th className="py-2.5 px-4">Event Type</th>
                <th className="py-2.5 px-4">Action Status</th>
                <th className="py-2.5 px-4">Metadata & Context</th>
                <th className="py-2.5 px-4">Reviewer</th>
                <th className="py-2.5 px-4 text-right">Review</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-zinc-500 italic">
                    Loading incident records...
                  </td>
                </tr>
              ) : filteredEvents.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-zinc-500 italic">
                    No anti-cheat incidents matching the current filter criteria.
                  </td>
                </tr>
              ) : (
                filteredEvents.map((ev) => (
                  <tr key={ev.id} className="hover:bg-zinc-900/30 transition-colors">
                    <td className="py-3 px-4 font-mono text-zinc-400 text-[11px] whitespace-nowrap">
                      {new Date(ev.createdAt).toLocaleTimeString()}
                    </td>
                    <td className="py-3 px-4 font-bold text-white whitespace-nowrap">
                      <span>{ev.participantName || ev.teamName || 'Solo Competitor'}</span>
                      {(ev.participantCode || ev.teamCode) && (
                        <span className="ml-1.5 text-[10px] font-mono text-zinc-400 font-normal">
                          ({ev.participantCode || ev.teamCode})
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      {getEventBadge(ev.eventType)}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      {getActionBadge(ev.actionTaken)}
                    </td>
                    <td className="py-3 px-4 text-zinc-300 font-mono text-[11px] max-w-xs truncate">
                      {ev.metadata ? (
                        <span>
                          {ev.metadata.durationSeconds
                            ? `Away for ${ev.metadata.durationSeconds}s `
                            : ''}
                          {ev.metadata.activeSessions
                            ? `Sessions: ${ev.metadata.activeSessions}/${ev.metadata.maxAllowedSessions} `
                            : ''}
                          {ev.metadata.reason ? `${ev.metadata.reason} ` : ''}
                          {JSON.stringify(ev.metadata)}
                        </span>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-zinc-400 text-[11px] whitespace-nowrap">
                      {ev.reviewerUsername ? (
                        <span className="text-emerald-400">@{ev.reviewerUsername}</span>
                      ) : (
                        <span className="text-zinc-600 italic">Unreviewed</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <button
                        onClick={() => handleOpenReview(ev)}
                        className="px-2.5 py-1 rounded bg-zinc-850 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-700 text-[11px] transition-colors cursor-pointer"
                      >
                        {ev.reviewedBy ? 'Edit Review' : 'Review'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 5. Review Incident Modal */}
      {reviewingEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs font-mono">
          <div className="bg-zinc-900 border border-zinc-750 rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <FileCheck className="w-4 h-4 text-emerald-400" />
                <h4 className="text-sm font-bold text-white uppercase tracking-wide">
                  Review Anti-Cheat Incident
                </h4>
              </div>
              <button
                onClick={() => setReviewingEvent(null)}
                className="text-zinc-400 hover:text-zinc-200 text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-2 bg-zinc-950 p-3 rounded-lg border border-zinc-850">
                <div>
                  <span className="text-[10px] text-zinc-500 uppercase font-bold block">Competitor</span>
                  <span className="font-bold text-white">{reviewingEvent.teamName}</span>
                </div>
                <div>
                  <span className="text-[10px] text-zinc-500 uppercase font-bold block">Event Type</span>
                  <span>{getEventBadge(reviewingEvent.eventType)}</span>
                </div>
                <div className="col-span-2 pt-1 border-t border-zinc-900">
                  <span className="text-[10px] text-zinc-500 uppercase font-bold block">Timestamp</span>
                  <span className="text-zinc-400">{new Date(reviewingEvent.createdAt).toLocaleString()}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-[10px] text-zinc-500 uppercase font-bold block">Metadata</span>
                  <pre className="text-[10px] text-zinc-300 bg-zinc-900 p-2 rounded overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(reviewingEvent.metadata, null, 2)}
                  </pre>
                </div>
              </div>

              <div>
                <label className="text-[10px] text-zinc-400 uppercase font-bold block mb-1">
                  Organizer Action Decision
                </label>
                <select
                  value={reviewAction}
                  onChange={(e) => setReviewAction(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-white focus:outline-hidden"
                >
                  <option value="VERIFIED_CLEAR">VERIFIED_CLEAR — False positive / legitimate reason</option>
                  <option value="LOGGED">LOGGED — Keep recorded for observation</option>
                  <option value="FLAGGED_VIOLATION">FLAGGED_VIOLATION — Suspicious activity confirmed</option>
                  <option value="DISQUALIFIED">DISQUALIFIED — Disqualification recommendation</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] text-zinc-400 uppercase font-bold block mb-1">
                  Organizer Audit Notes
                </label>
                <textarea
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  placeholder="Record justification, physical observation notes, or competitor statements..."
                  rows={3}
                  className="w-full p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-white placeholder-zinc-600 focus:outline-hidden"
                />
              </div>

              {reviewFeedback && (
                <div className="p-2.5 rounded bg-zinc-850 border border-zinc-700 text-xs text-emerald-300">
                  {reviewFeedback}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setReviewingEvent(null)}
                className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-750 text-zinc-300 text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveReview}
                disabled={submittingReview}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition-colors cursor-pointer"
              >
                {submittingReview ? 'Saving...' : 'Save Decision'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
