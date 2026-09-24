import React, { useState } from 'react';
import { adminFetch } from './adminFetch';
import {
  Shield,
  LayoutDashboard,
  PlaySquare,
  Users,
  Radio,
  FileText,
  LogOut,
  Server,
  UserCheck,
  Layers,
  ShieldAlert,
  FileSpreadsheet,
} from 'lucide-react';
import { AdminDashboard } from './AdminDashboard';
import { AdminEventControl } from './AdminEventControl';
import { AdminParticipants } from './AdminParticipants';
import { AdminAudit } from './AdminAudit';
import { AdminProgressionControl } from './AdminProgressionControl';
import { AdminAntiCheat } from './AdminAntiCheat';

interface AdminLayoutProps {
  admin: {
    id: string;
    username: string;
    displayName: string;
    role: string;
  };
  onLogout: () => void;
}

export type AdminTab =
  | 'dashboard'
  | 'controls'
  | 'progression'
  | 'participants'
  | 'anticheat'
  | 'audit';

export const AdminLayout: React.FC<AdminLayoutProps> = ({ admin, onLogout }) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('dashboard');
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogoutClick = async () => {
    setLoggingOut(true);
    try {
      await adminFetch('/api/admin/logout', {
        method: 'POST',
      });
    } catch (err) {
      console.error('Logout request failed:', err);
    } finally {
      onLogout();
    }
  };

  return (
    <div id="admin-control-center-root" className="space-y-6 font-mono">
      {/* Organizer Top Bar */}
      <div className="bg-zinc-950/90 border border-zinc-800 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-600/20 border border-blue-500/40 flex items-center justify-center">
            <Shield className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-zinc-100 tracking-wide uppercase">
                BUG SNIPER Organizer Command Center
              </h2>
              <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/30 text-blue-400 font-bold">
                {admin.role}
              </span>
            </div>
            <div className="text-[11px] text-zinc-400 flex items-center gap-2 mt-0.5">
              <span>Session: <strong className="text-zinc-200">@{admin.username}</strong> ({admin.displayName})</span>
              <span className="text-zinc-600">•</span>
              <span className="flex items-center gap-1 text-emerald-400">
                <Server className="w-3 h-3" />
                <span>PGlite Live Engine</span>
              </span>
            </div>
          </div>
        </div>

        {/* Tab Navigation Pill Group + Logout */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex p-1 rounded-lg bg-zinc-900 border border-zinc-800 text-xs">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeTab === 'dashboard'
                  ? 'bg-blue-600 text-white font-bold shadow'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              <span>Overview</span>
            </button>
            <button
              onClick={() => setActiveTab('controls')}
              className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeTab === 'controls'
                  ? 'bg-blue-600 text-white font-bold shadow'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <PlaySquare className="w-3.5 h-3.5" />
              <span>Event Controls</span>
            </button>
            <button
              onClick={() => setActiveTab('progression')}
              className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeTab === 'progression'
                  ? 'bg-blue-600 text-white font-bold shadow'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Challenges & Progression</span>
            </button>
            <button
              onClick={() => setActiveTab('participants')}
              className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeTab === 'participants'
                  ? 'bg-blue-600 text-white font-bold shadow'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Registered Participants</span>
            </button>
            <button
              onClick={() => setActiveTab('anticheat')}
              className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeTab === 'anticheat'
                  ? 'bg-blue-600 text-white font-bold shadow'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Anti-Cheat</span>
            </button>
            <button
              onClick={() => setActiveTab('audit')}
              className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeTab === 'audit'
                  ? 'bg-blue-600 text-white font-bold shadow'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Audit Trail</span>
            </button>
          </div>

          <button
            onClick={handleLogoutClick}
            disabled={loggingOut}
            className="px-3 py-2 bg-zinc-900 hover:bg-zinc-800 text-red-400 border border-zinc-800 hover:border-red-500/40 rounded-lg text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Terminate administrator session"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>{loggingOut ? 'Closing...' : 'Exit'}</span>
          </button>
        </div>
      </div>

      {/* Main View Area */}
      <div>
        {activeTab === 'dashboard' && <AdminDashboard onNavigateTab={(t) => setActiveTab(t)} />}
        {activeTab === 'controls' && <AdminEventControl />}
        {activeTab === 'progression' && <AdminProgressionControl />}
        {activeTab === 'participants' && <AdminParticipants />}
        {activeTab === 'anticheat' && <AdminAntiCheat />}
        {activeTab === 'audit' && <AdminAudit />}
      </div>
    </div>
  );
};
