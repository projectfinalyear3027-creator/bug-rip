/**
 * BUG RIP - Organizer & Admin Experience Controller
 * Provides authoritative administrative surveillance and competition control.
 * Backed strictly by PostgreSQL / PGlite database and real HTTP-only admin sessions.
 */

import React, { useState, useEffect } from 'react';
import { Loader2, Shield, ArrowLeft } from 'lucide-react';
import { AdminLogin } from './admin/AdminLogin';
import { AdminLayout } from './admin/AdminLayout';
import { adminFetch, clearStoredAdminToken } from './admin/adminFetch';
import { ThemeId } from '../types';

interface AdminExperienceProps {
  currentTheme?: ThemeId;
  onBackToOverview?: () => void;
}

interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  role: string;
}

export const AdminExperience: React.FC<AdminExperienceProps> = ({ onBackToOverview }) => {
  const [loadingSession, setLoadingSession] = useState<boolean>(true);
  const [authenticatedAdmin, setAuthenticatedAdmin] = useState<AdminUser | null>(null);

  // 1. Session Restoration on Initial Mount
  useEffect(() => {
    const restoreAdminSession = async () => {
      setLoadingSession(true);
      try {
        const res = await adminFetch('/api/admin/session');

        if (res.ok) {
          const data = await res.json();
          const admin = data.admin || data.adminUser;
          if (data.authenticated && admin) {
            setAuthenticatedAdmin(admin);
            return;
          }
        }
      } catch (err) {
        // Fall through cleanly if no session is present or network unreachable
      } finally {
        setLoadingSession(false);
      }
      setAuthenticatedAdmin(null);
    };

    restoreAdminSession();
  }, []);

  const handleLoginSuccess = (admin: AdminUser) => {
    setAuthenticatedAdmin(admin);
  };

  const handleLogout = () => {
    clearStoredAdminToken();
    setAuthenticatedAdmin(null);
  };

  if (loadingSession) {
    return (
      <div className="flex flex-col items-center justify-center py-24 font-mono text-zinc-400 space-y-3">
        <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
        <span className="text-xs tracking-wider uppercase">
          Verifying organizer credentials against database...
        </span>
      </div>
    );
  }

  return (
    <div id="admin-experience-container" className="space-y-6">
      {onBackToOverview && (
        <div className="flex items-center justify-between font-mono text-xs border-b border-zinc-800/80 pb-3">
          <button
            onClick={onBackToOverview}
            className="text-zinc-400 hover:text-zinc-200 flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Return to Participant Portal</span>
          </button>
          <span className="text-zinc-600">BUG SNIPER Organizer Subsystem • Fragment 4</span>
        </div>
      )}

      {!authenticatedAdmin ? (
        <AdminLogin onLoginSuccess={handleLoginSuccess} />
      ) : (
        <AdminLayout admin={authenticatedAdmin} onLogout={handleLogout} />
      )}
    </div>
  );
};
