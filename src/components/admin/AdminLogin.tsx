import React, { useState } from 'react';
import { setStoredAdminToken } from './adminFetch';
import { Shield, Lock, User, AlertTriangle, ArrowRight, Loader2, KeyRound } from 'lucide-react';

interface AdminLoginProps {
  onLoginSuccess: (admin: { id: string; username: string; displayName: string; role: string }) => void;
}

export const AdminLogin: React.FC<AdminLoginProps> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setErrorMessage('Please enter both administrator username and password.');
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          username: username.trim(),
          password,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        if (res.status === 429) {
          setErrorMessage(data.error || 'Too many failed login attempts. Please wait 1 minute.');
        } else {
          setErrorMessage(data.error || 'Invalid administrator credentials. Access denied.');
        }
        return;
      }

      if (data.sessionToken) {
        setStoredAdminToken(data.sessionToken);
      }

      onLoginSuccess(data.admin || data.adminUser);
    } catch (err: any) {
      setErrorMessage('Network connection error while contacting organizer authentication gateway.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="admin-login-view" className="max-w-md mx-auto py-10 font-mono">
      <div className="bg-zinc-950/90 border border-zinc-800 rounded-xl shadow-2xl p-7 relative overflow-hidden backdrop-blur-sm">
        {/* Subtle accent line */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-600 via-indigo-500 to-blue-400" />

        {/* Security badge */}
        <div className="flex items-center justify-between mb-6">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md border border-blue-500/30 bg-blue-500/10 text-blue-400 text-[11px] font-semibold">
            <Shield className="w-3.5 h-3.5" />
            <span>ORGANIZER ACCESS ONLY</span>
          </div>
          <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-widest">PORT 3000 / AUTH</span>
        </div>

        <div className="mb-6">
          <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-blue-400" />
            Organizer Control Center
          </h2>
          <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
            Enter authorized administrator credentials to manage competition states, monitor live teams, and oversee the 60-minute Java CTF.
          </p>
        </div>

        {errorMessage && (
          <div
            id="admin-login-error"
            className="mb-5 p-3 rounded-lg border border-red-500/30 bg-red-950/40 text-red-300 text-xs flex items-start gap-2.5"
          >
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span className="leading-snug">{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1.5 uppercase tracking-wider">
              Admin Username
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="admin-username-input"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. admin"
                autoComplete="username"
                disabled={loading}
                className="w-full bg-zinc-900 border border-zinc-700/80 rounded-lg pl-9 pr-3 py-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors disabled:opacity-50"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1.5 uppercase tracking-wider">
              Master Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="admin-password-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                autoComplete="current-password"
                disabled={loading}
                className="w-full bg-zinc-900 border border-zinc-700/80 rounded-lg pl-9 pr-3 py-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors disabled:opacity-50"
              />
            </div>
          </div>

          <button
            id="admin-login-submit-btn"
            type="submit"
            disabled={loading}
            className="w-full mt-2 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-semibold py-2.5 px-4 rounded-lg text-xs flex items-center justify-center gap-2 transition-colors disabled:opacity-50 shadow-lg shadow-blue-950/40 cursor-pointer"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-white" />
                <span>Verifying Credentials...</span>
              </>
            ) : (
              <>
                <span>Authenticate Organizer</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-zinc-800/80 text-[11px] text-zinc-500 space-y-2">
          <div className="flex items-center justify-between">
            <span>Session Protocol:</span>
            <span className="text-zinc-400">Strict HTTP-Only Cookie</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Rate Limiter:</span>
            <span className="text-zinc-400">5 attempts / 60s window</span>
          </div>
          <p className="text-[10px] text-zinc-600 italic pt-1 text-center">
            All organizer actions are permanently recorded to the audit log.
          </p>
        </div>
      </div>
    </div>
  );
};
