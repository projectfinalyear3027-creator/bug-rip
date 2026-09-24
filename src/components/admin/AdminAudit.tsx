import React, { useState, useEffect } from 'react';
import { adminFetch } from './adminFetch';
import { Shield, RefreshCw, FileText, CheckCircle2, AlertTriangle, Terminal } from 'lucide-react';

interface AuditLogItem {
  id: string;
  adminUsername: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  details: any;
  reason: string | null;
  createdAt: string;
}

export const AdminAudit: React.FC = () => {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState(new Date());

  const fetchAuditLogs = async () => {
    try {
      const res = await adminFetch('/api/admin/audit');
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
        setLastRefreshed(new Date());
      }
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAuditLogs();
    const interval = setInterval(fetchAuditLogs, 5000);
    return () => clearInterval(interval);
  }, []);

  const getActionBadge = (action: string) => {
    if (action.includes('START') || action.includes('RESUME')) {
      return (
        <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-bold">
          {action}
        </span>
      );
    }
    if (action.includes('PAUSE')) {
      return (
        <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30 font-bold">
          {action}
        </span>
      );
    }
    if (action.includes('END') || action.includes('REVOKE') || action.includes('FAILED')) {
      return (
        <span className="px-2 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/30 font-bold">
          {action}
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700 font-semibold">
        {action}
      </span>
    );
  };

  return (
    <div id="admin-audit-view" className="space-y-6 font-mono">
      {/* Header */}
      <div className="bg-zinc-950/80 border border-zinc-800 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
            <Terminal className="w-4 h-4 text-amber-400" />
            Immutable Organizer Audit Trail
          </h3>
          <p className="text-xs text-zinc-400 mt-1">
            Authoritative append-only log of administrator authentication, session events, and state mutations.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-500">
            Synced: {lastRefreshed.toLocaleTimeString()}
          </span>
          <button
            onClick={() => fetchAuditLogs()}
            className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/70 rounded-lg text-xs text-zinc-300 flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Sync</span>
          </button>
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="bg-zinc-950/90 border border-zinc-800 rounded-xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-zinc-900/80 text-zinc-400 border-b border-zinc-800 font-semibold uppercase tracking-wider">
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">Administrator</th>
                <th className="py-3 px-4">Action</th>
                <th className="py-3 px-4">Target / Scope</th>
                <th className="py-3 px-4">Reason / Metadata</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-zinc-500">
                    {loading ? 'Retrieving audit trail from database...' : 'No audit records yet.'}
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-zinc-900/40 transition-colors">
                    <td className="py-3 px-4 font-mono text-zinc-400 whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleTimeString()}
                      <span className="text-[10px] text-zinc-600 block">
                        {new Date(log.createdAt).toLocaleDateString()}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-bold text-blue-400">
                      {log.adminUsername}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      {getActionBadge(log.action)}
                    </td>
                    <td className="py-3 px-4 text-zinc-300">
                      {log.targetType ? `${log.targetType}${log.targetId ? ` (${log.targetId})` : ''}` : 'SYSTEM'}
                    </td>
                    <td className="py-3 px-4 text-zinc-400 max-w-xs truncate">
                      {log.reason || (log.details ? JSON.stringify(log.details) : '—')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
