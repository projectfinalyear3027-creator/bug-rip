import React, { useState, useEffect } from 'react';
import { adminFetch } from './adminFetch';
import {
  Layers,
  Unlock,
  Lock,
  Plus,
  Edit2,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Eye,
  Power,
  PowerOff,
  Sparkles,
  ShieldAlert,
  Info,
} from 'lucide-react';

interface RoundItem {
  id: string;
  name: string;
  slug: string;
  displayOrder: number;
  isActive: boolean;
  unlockRequiredSolves: number;
  activeChallengesCount: number;
  totalChallengesCount: number;
}

interface ChallengeItem {
  id: string;
  roundId: string;
  roundName: string;
  title: string;
  slug: string;
  score: number;
  displayOrder: number;
  validationType: string;
  isActive: boolean;
  testCaseCount: number;
  publicCaseCount: number;
  hiddenCaseCount: number;
}

export const AdminProgressionControl: React.FC = () => {
  const [rounds, setRounds] = useState<RoundItem[]>([]);
  const [challenges, setChallenges] = useState<ChallengeItem[]>([]);
  const [progressionMode, setProgressionMode] = useState<string>('SEQUENTIAL');
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Modal states
  const [showUnlockAllModal, setShowUnlockAllModal] = useState(false);
  const [unlockAllReason, setUnlockAllReason] = useState('Emergency organizer bypass');

  const [editingRound, setEditingRound] = useState<RoundItem | null>(null);
  const [newThreshold, setNewThreshold] = useState<number>(0);
  const [thresholdError, setThresholdError] = useState<string | null>(null);

  const [deactivatingChallenge, setDeactivatingChallenge] = useState<ChallengeItem | null>(null);
  const [deactivationImpact, setDeactivationImpact] = useState<any>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [roundsRes, challengesRes] = await Promise.all([
        adminFetch('/api/admin/rounds'),
        adminFetch('/api/admin/challenges'),
      ]);

      if (roundsRes.ok) {
        const data = await roundsRes.json();
        setRounds(data.rounds || []);
        if (data.progressionMode) {
          setProgressionMode(data.progressionMode);
        }
      }

      if (challengesRes.ok) {
        const data = await challengesRes.json();
        setChallenges(data.challenges || []);
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: 'Failed to load rounds and challenges.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleUnlockAll = async () => {
    setActionInProgress(true);
    setMessage(null);
    try {
      const res = await adminFetch('/api/admin/progression/unlock-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: unlockAllReason }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setMessage({
          type: 'success',
          text: 'All competition difficulty tiers have been unlocked for all teams.',
        });
        setShowUnlockAllModal(false);
        fetchData();
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to unlock all difficulties.' });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Network error occurred.' });
    } finally {
      setActionInProgress(false);
    }
  };

  const handleSaveThreshold = async () => {
    if (!editingRound) return;
    setActionInProgress(true);
    setThresholdError(null);
    try {
      const res = await adminFetch(`/api/admin/rounds/${editingRound.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unlockRequiredSolves: newThreshold,
          reason: `Organizer updated threshold from ${editingRound.unlockRequiredSolves} to ${newThreshold}`,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setMessage({
          type: 'success',
          text: `Threshold for "${editingRound.name}" updated to ${newThreshold} solves.`,
        });
        setEditingRound(null);
        fetchData();
      } else {
        setThresholdError(data.error || 'Failed to update threshold.');
      }
    } catch (err: any) {
      setThresholdError(err.message || 'Network error occurred.');
    } finally {
      setActionInProgress(false);
    }
  };

  const checkDeactivate = async (challenge: ChallengeItem) => {
    setDeactivatingChallenge(challenge);
    setDeactivationImpact(null);
    try {
      const res = await adminFetch(`/api/admin/challenges/${challenge.id}/deactivation-impact`);
      if (res.ok) {
        const data = await res.json();
        setDeactivationImpact(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const confirmToggleChallenge = async (challengeId: string, currentActive: boolean) => {
    setActionInProgress(true);
    try {
      const res = await adminFetch(`/api/admin/challenges/${challengeId}/toggle-active`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isActive: !currentActive,
          reason: `Organizer ${!currentActive ? 'activated' : 'deactivated'} challenge`,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setMessage({
          type: 'success',
          text: `Challenge ${!currentActive ? 'activated' : 'deactivated'} successfully.`,
        });
        setDeactivatingChallenge(null);
        fetchData();
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to toggle challenge state.' });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Error occurred.' });
    } finally {
      setActionInProgress(false);
    }
  };

  // Dynamic Authoritative Counts sourced from database query results
  const easyCount = challenges.filter((c) => c.roundName?.toLowerCase() === 'easy').length ||
    (rounds.find((r) => r.slug.toLowerCase() === 'easy')?.totalChallengesCount ?? 0);
  const mediumCount = challenges.filter((c) => c.roundName?.toLowerCase() === 'medium').length ||
    (rounds.find((r) => r.slug.toLowerCase() === 'medium')?.totalChallengesCount ?? 0);
  const hardCount = challenges.filter((c) => c.roundName?.toLowerCase() === 'hard').length ||
    (rounds.find((r) => r.slug.toLowerCase() === 'hard')?.totalChallengesCount ?? 0);
  const extremeCount = challenges.filter((c) => c.roundName?.toLowerCase() === 'extreme').length ||
    (rounds.find((r) => r.slug.toLowerCase() === 'extreme')?.totalChallengesCount ?? 0);
  const totalCount = challenges.length || (easyCount + mediumCount + hardCount + extremeCount);

  return (
    <div id="admin-progression-control-root" className="space-y-6">
      {/* Authoritative Challenge Inventory Summary */}
      <div id="admin-challenge-inventory-summary" className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-4 mb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-emerald-400" />
            <h3 className="text-base font-bold text-white uppercase tracking-wider">
              Authoritative Challenge Inventory
            </h3>
          </div>
          <span className="text-xs font-mono px-2.5 py-1 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">
            Database Sourced
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
          <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-lg p-3">
            <div className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">Easy</div>
            <div id="admin-count-easy" className="text-2xl font-black font-mono text-white mt-1">{easyCount}</div>
            <div className="text-[10px] text-zinc-500 mt-0.5">challenges</div>
          </div>
          <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-lg p-3">
            <div className="text-[11px] font-bold text-blue-400 uppercase tracking-wider">Medium</div>
            <div id="admin-count-medium" className="text-2xl font-black font-mono text-white mt-1">{mediumCount}</div>
            <div className="text-[10px] text-zinc-500 mt-0.5">challenges</div>
          </div>
          <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-lg p-3">
            <div className="text-[11px] font-bold text-amber-400 uppercase tracking-wider">Hard</div>
            <div id="admin-count-hard" className="text-2xl font-black font-mono text-white mt-1">{hardCount}</div>
            <div className="text-[10px] text-zinc-500 mt-0.5">challenges</div>
          </div>
          <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-lg p-3">
            <div className="text-[11px] font-bold text-purple-400 uppercase tracking-wider">Extreme</div>
            <div id="admin-count-extreme" className="text-2xl font-black font-mono text-white mt-1">{extremeCount}</div>
            <div className="text-[10px] text-zinc-500 mt-0.5">challenges</div>
          </div>
          <div className="bg-zinc-950/80 border border-emerald-500/30 rounded-lg p-3 col-span-2 sm:col-span-1 bg-emerald-950/10">
            <div className="text-[11px] font-bold text-emerald-300 uppercase tracking-wider">Total</div>
            <div id="admin-count-total" className="text-2xl font-black font-mono text-emerald-400 mt-1">{totalCount}</div>
            <div className="text-[10px] text-emerald-500/80 mt-0.5">challenges</div>
          </div>
        </div>
      </div>

      {/* Top Banner & Emergency Actions */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-amber-400" />
            <h3 className="text-lg font-bold text-white uppercase tracking-wider">
              Rounds & Difficulty Progression Controls
            </h3>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Server-authoritative sequential difficulty tiers, threshold unlocks, challenge management, and monotonic unlock preservation.
          </p>
          <div className="flex items-center gap-2 mt-3 text-xs">
            <span className="text-zinc-500">Current Mode:</span>
            <span
              className={`px-2.5 py-0.5 rounded font-bold uppercase tracking-wider ${
                progressionMode === 'UNLOCK_ALL'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
              }`}
            >
              {progressionMode}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            id="btn-admin-unlock-all-modal"
            onClick={() => setShowUnlockAllModal(true)}
            disabled={actionInProgress}
            className="px-4 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold flex items-center gap-2 shadow-lg shadow-amber-950/40 transition-all cursor-pointer"
          >
            <Unlock className="w-4 h-4" />
            <span>Emergency Unlock All Difficulties</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {message && (
        <div
          className={`p-4 rounded-xl text-xs flex items-center gap-2 border ${
            message.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
              : 'bg-red-950/40 border-red-500/40 text-red-300'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* Rounds & Thresholds Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-zinc-800 bg-zinc-950/60 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-bold text-zinc-200">
            <Layers className="w-4 h-4 text-blue-400" />
            <span>Difficulty Tiers & Sequential Thresholds</span>
          </div>
          <span className="text-xs text-zinc-500">
            {rounds.length} Tiers Configured
          </span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-zinc-500 flex items-center justify-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Loading competition rounds...</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-950/80 text-zinc-400 uppercase tracking-wider border-b border-zinc-800">
                <tr>
                  <th className="py-3 px-4">Order</th>
                  <th className="py-3 px-4">Difficulty</th>
                  <th className="py-3 px-4">Slug</th>
                  <th className="py-3 px-4">Unlock Condition</th>
                  <th className="py-3 px-4">Active Challenges</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {rounds.map((r, idx) => {
                  const prevRound = idx > 0 ? rounds[idx - 1] : null;
                  return (
                    <tr key={r.id} className="hover:bg-zinc-850/40 transition-colors">
                      <td className="py-3 px-4 font-bold text-zinc-300">
                        Tier {r.displayOrder}
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-bold text-white text-sm">{r.name}</span>
                      </td>
                      <td className="py-3 px-4 font-mono text-zinc-400">
                        {r.slug}
                      </td>
                      <td className="py-3 px-4">
                        {r.displayOrder === 1 ? (
                          <span className="text-emerald-400 font-bold">
                            Default Unlocked (0 solves)
                          </span>
                        ) : (
                          <span className="text-zinc-200">
                            Requires <strong className="text-amber-400">{r.unlockRequiredSolves}</strong> solves in {prevRound?.name || 'Preceding'}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 font-mono text-zinc-300">
                          {r.activeChallengesCount} active / {r.totalChallengesCount} total
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {r.isActive ? (
                          <span className="text-emerald-400 font-bold">Active</span>
                        ) : (
                          <span className="text-zinc-500">Disabled</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => {
                            setEditingRound(r);
                            setNewThreshold(r.unlockRequiredSolves);
                            setThresholdError(null);
                          }}
                          className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-xs font-semibold flex items-center gap-1.5 ml-auto cursor-pointer"
                        >
                          <Edit2 className="w-3 h-3" />
                          <span>Configure Threshold</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Challenges List per Round */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-zinc-800 bg-zinc-950/60 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-bold text-zinc-200">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <span>Competition Challenge Bank ({challenges.length} Challenges)</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-950/80 text-zinc-400 uppercase tracking-wider border-b border-zinc-800">
              <tr>
                <th className="py-3 px-4">Challenge ID</th>
                <th className="py-3 px-4">Title</th>
                <th className="py-3 px-4">Difficulty</th>
                <th className="py-3 px-4">Points</th>
                <th className="py-3 px-4">Validation</th>
                <th className="py-3 px-4">Test Cases</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Toggle Active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {challenges.map((c) => (
                <tr key={c.id} className="hover:bg-zinc-850/40 transition-colors">
                  <td className="py-3 px-4 font-mono font-bold text-blue-400">
                    {c.id}
                  </td>
                  <td className="py-3 px-4 font-medium text-white">
                    {c.title}
                  </td>
                  <td className="py-3 px-4">
                    <span className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 font-semibold">
                      {c.roundName}
                    </span>
                  </td>
                  <td className="py-3 px-4 font-bold text-amber-400">
                    {c.score} pts
                  </td>
                  <td className="py-3 px-4 text-zinc-400 font-mono text-[11px]">
                    {c.validationType}
                  </td>
                  <td className="py-3 px-4 text-zinc-300">
                    {c.publicCaseCount} public / {c.hiddenCaseCount} hidden
                  </td>
                  <td className="py-3 px-4">
                    {c.isActive ? (
                      <span className="inline-flex items-center gap-1 text-emerald-400 font-bold">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>ACTIVE</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-red-400 font-bold">
                        <PowerOff className="w-3.5 h-3.5" />
                        <span>DEACTIVATED</span>
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right">
                    {c.isActive ? (
                      <button
                        onClick={() => checkDeactivate(c)}
                        disabled={actionInProgress}
                        className="px-2 py-1 bg-red-950/40 hover:bg-red-900/60 border border-red-500/40 text-red-300 rounded text-[11px] font-bold cursor-pointer"
                      >
                        Deactivate
                      </button>
                    ) : (
                      <button
                        onClick={() => confirmToggleChallenge(c.id, false)}
                        disabled={actionInProgress}
                        className="px-2 py-1 bg-emerald-950/40 hover:bg-emerald-900/60 border border-emerald-500/40 text-emerald-300 rounded text-[11px] font-bold cursor-pointer"
                      >
                        Re-activate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Configure Threshold */}
      {editingRound && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Edit2 className="w-4 h-4 text-blue-400" />
              <span>Configure Threshold: {editingRound.name}</span>
            </h3>

            <p className="text-xs text-zinc-400">
              Set the number of unique problems solved in the preceding round required to unlock this difficulty tier.
            </p>

            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-300">
                Required Solves:
              </label>
              <input
                type="number"
                min="0"
                value={newThreshold}
                onChange={(e) => setNewThreshold(parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-lg text-sm text-white font-mono"
              />
            </div>

            {thresholdError && (
              <div className="p-3 bg-red-950/50 border border-red-500/50 rounded-lg text-xs text-red-300 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{thresholdError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setEditingRound(null)}
                disabled={actionInProgress}
                className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveThreshold}
                disabled={actionInProgress}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg text-xs flex items-center gap-1.5 cursor-pointer"
              >
                {actionInProgress && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Save Threshold</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Deactivation Impact Warning */}
      {deactivatingChallenge && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-red-400 flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-red-400" />
              <span>Deactivate Challenge: {deactivatingChallenge.id}</span>
            </h3>

            <p className="text-xs text-zinc-300">
              Are you sure you want to deactivate <strong className="text-white">{deactivatingChallenge.title}</strong>?
            </p>

            {deactivationImpact?.warning && (
              <div className="p-3.5 rounded-lg bg-amber-950/60 border border-amber-500/60 text-amber-200 text-xs space-y-1.5">
                <div className="font-bold flex items-center gap-1.5 text-amber-300">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Warning: Progression Impact</span>
                </div>
                <p className="leading-relaxed">{deactivationImpact.warning}</p>
              </div>
            )}

            <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-[11px] text-zinc-400 space-y-1">
              <div className="text-zinc-300 font-semibold">Immutable Historical Protection:</div>
              <div>• Teams that previously solved this challenge retain their scores and solves.</div>
              <div>• Previously unlocked tiers remain permanently unlocked (monotonic rule).</div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setDeactivatingChallenge(null)}
                disabled={actionInProgress}
                className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => confirmToggleChallenge(deactivatingChallenge.id, true)}
                disabled={actionInProgress}
                className="px-4 py-1.5 bg-red-600 hover:bg-red-500 text-white font-bold rounded-lg text-xs flex items-center gap-1.5 cursor-pointer"
              >
                {actionInProgress && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Confirm Deactivation</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Unlock All Difficulties */}
      {showUnlockAllModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-amber-400 flex items-center gap-2">
              <Unlock className="w-5 h-5 text-amber-400" />
              <span>Unlock All Competition Difficulties</span>
            </h3>

            <p className="text-xs text-zinc-300 leading-relaxed">
              This action will instantly unlock <strong>ALL difficulty tiers</strong> for <strong>ALL teams</strong>, regardless of their solved count. Teams will be free to attempt challenges across any difficulty tier.
            </p>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-300">
                Reason for Audit Log:
              </label>
              <input
                type="text"
                value={unlockAllReason}
                onChange={(e) => setUnlockAllReason(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-lg text-xs text-white"
                placeholder="e.g. Organizer decision due to time limit"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setShowUnlockAllModal(false)}
                disabled={actionInProgress}
                className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleUnlockAll}
                disabled={actionInProgress}
                className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-lg text-xs flex items-center gap-1.5 cursor-pointer"
              >
                {actionInProgress && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Confirm Unlock All</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
