import React, { useState } from 'react';
import { Trophy, Plus, RotateCcw, ArrowDownUp, CheckCircle, Info, Sparkles } from 'lucide-react';
import { rankLeaderboard } from '../../backend/rules/competitionRules';
import { LeaderboardEntry } from '../../backend/types/competition';

export const TiebreakerDemonstrator: React.FC = () => {
  const initialTeams: LeaderboardEntry[] = [
    {
      teamId: 'candidate-a',
      teamName: 'Candidate Team A',
      problemsSolved: 20,
      score: 200,
      lastSolveTimestamp: 3200, // seconds into match
      connectedMemberCount: 2,
      registeredMemberCount: 2,
      rank: 1,
    },
    {
      teamId: 'candidate-b',
      teamName: 'Candidate Team B',
      problemsSolved: 19,
      score: 350,
      lastSolveTimestamp: 2800,
      connectedMemberCount: 1,
      registeredMemberCount: 1,
      rank: 2,
    },
    {
      teamId: 'candidate-c',
      teamName: 'Candidate Team C',
      problemsSolved: 15,
      score: 300,
      lastSolveTimestamp: 3100,
      connectedMemberCount: 2,
      registeredMemberCount: 2,
      rank: 3,
    },
    {
      teamId: 'candidate-d',
      teamName: 'Candidate Team D',
      problemsSolved: 15,
      score: 250,
      lastSolveTimestamp: 2900,
      connectedMemberCount: 2,
      registeredMemberCount: 2,
      rank: 4,
    },
    {
      teamId: 'candidate-e',
      teamName: 'Candidate Team E',
      problemsSolved: 12,
      score: 180,
      lastSolveTimestamp: 2100,
      connectedMemberCount: 1,
      registeredMemberCount: 1,
      rank: 5,
    },
    {
      teamId: 'candidate-f',
      teamName: 'Candidate Team F',
      problemsSolved: 12,
      score: 180,
      lastSolveTimestamp: 2600,
      connectedMemberCount: 2,
      registeredMemberCount: 2,
      rank: 6,
    },
  ];

  const [teams, setTeams] = useState<LeaderboardEntry[]>(initialTeams);
  const [newTeamName, setNewTeamName] = useState('');
  const [newSolves, setNewSolves] = useState('16');
  const [newScore, setNewScore] = useState('280');
  const [newTimeMinutes, setNewTimeMinutes] = useState('45');

  // Compute live ranking using the authoritative ranking engine
  const rankedTeams = rankLeaderboard(teams);

  const handleAddTeam = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTeamName.trim()) return;

    const newEntry: LeaderboardEntry = {
      teamId: `t-${Date.now()}`,
      teamName: newTeamName.trim(),
      problemsSolved: parseInt(newSolves || '0', 10),
      score: parseInt(newScore || '0', 10),
      lastSolveTimestamp: Math.max(1, parseInt(newTimeMinutes || '1', 10) * 60),
      connectedMemberCount: 2,
      registeredMemberCount: 2,
      rank: 0,
    };

    setTeams((prev) => [...prev, newEntry]);
    setNewTeamName('');
  };

  const handleReset = () => {
    setTeams(initialTeams);
  };

  const formatSecondsToMinutes = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs.toString().padStart(2, '0')}s`;
  };

  return (
    <div id="tiebreaker-workbench" className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-4">
        <div>
          <div className="flex items-center gap-2 text-amber-400 font-mono text-xs font-semibold uppercase tracking-wider">
            <Trophy className="w-4 h-4" />
            <span>Interactive Simulator</span>
          </div>
          <h2 className="text-xl font-bold text-white font-mono mt-1">
            Winner Ranking & Tiebreaker Engine
          </h2>
          <p className="text-xs text-zinc-400 font-mono mt-0.5">
            Real-time evaluation using canonical algorithm: <span className="text-emerald-400 font-bold">Solved (Primary)</span> &gt; <span className="text-blue-400 font-bold">Score</span> &gt; <span className="text-amber-400 font-bold">Earliest Timestamp</span>.
          </p>
        </div>

        <button
          id="reset-simulator-btn"
          onClick={handleReset}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-mono text-xs text-zinc-400 bg-zinc-900 border border-zinc-800 hover:text-white hover:border-zinc-700 transition-all self-start sm:self-auto"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset Defaults</span>
        </button>
      </div>

      {/* Interactive Leaderboard Table */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 overflow-hidden shadow-xl">
        <div className="p-4 sm:p-5 border-b border-zinc-800 bg-zinc-950/70 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-white text-sm">LIVE SIMULATED STANDINGS</span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-950/60 text-emerald-400 border border-emerald-800/60">
              Deterministic View
            </span>
          </div>
          <span className="text-xs font-mono text-zinc-500">
            {rankedTeams.length} Teams Competing
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-400 bg-zinc-950/40">
                <th className="py-3 px-4 font-semibold w-16">RANK</th>
                <th className="py-3 px-4 font-semibold">TEAM NAME</th>
                <th className="py-3 px-4 font-semibold text-emerald-400">1. PROBLEMS SOLVED</th>
                <th className="py-3 px-4 font-semibold text-blue-400">2. TOTAL SCORE</th>
                <th className="py-3 px-4 font-semibold text-amber-400">3. LAST SOLVE TIME</th>
                <th className="py-3 px-4 font-semibold text-zinc-400">DECISIVE DETERMINATION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {rankedTeams.map((team, idx) => {
                let decisiveText = '';
                if (idx === 0) {
                  decisiveText = 'Tournament Leader (Highest Solved Count)';
                } else {
                  const prev = rankedTeams[idx - 1];
                  if (prev.problemsSolved > team.problemsSolved) {
                    decisiveText = `Solved Count (${prev.problemsSolved} vs ${team.problemsSolved})`;
                  } else if (prev.score > team.score) {
                    decisiveText = `Equal Solves (${team.problemsSolved}) → Score (${prev.score} vs ${team.score} pts)`;
                  } else {
                    const diffSec = team.lastSolveTimestamp - prev.lastSolveTimestamp;
                    decisiveText = `Equal Solves & Score → Earliest Time (${diffSec}s earlier)`;
                  }
                }

                return (
                  <tr
                    key={team.teamId}
                    className={`transition-colors hover:bg-zinc-800/30 ${
                      team.rank === 1 ? 'bg-amber-500/5' : ''
                    }`}
                  >
                    <td className="py-3.5 px-4 font-bold">
                      {team.rank === 1 ? (
                        <span className="inline-flex items-center gap-1 text-amber-400 font-black">
                          <Trophy className="w-4 h-4" /> #1
                        </span>
                      ) : team.rank === 2 ? (
                        <span className="text-zinc-300 font-bold">#2</span>
                      ) : team.rank === 3 ? (
                        <span className="text-amber-600 font-bold">#3</span>
                      ) : (
                        <span className="text-zinc-500">#{team.rank}</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 font-bold text-white">
                      {team.teamName}
                    </td>
                    <td className="py-3.5 px-4 font-bold text-emerald-400">
                      {team.problemsSolved} Solved
                    </td>
                    <td className="py-3.5 px-4 font-semibold text-blue-400">
                      {team.score} pts
                    </td>
                    <td className="py-3.5 px-4 text-amber-300">
                      {formatSecondsToMinutes(team.lastSolveTimestamp)}
                    </td>
                    <td className="py-3.5 px-4 text-[11px] text-zinc-400 font-medium">
                      {decisiveText}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Custom Test Team Form */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-bold text-white font-mono uppercase tracking-wider">
            Inject Custom Team Into Engine
          </h3>
        </div>

        <form onSubmit={handleAddTeam} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 font-mono text-xs">
          <div>
            <label className="block text-zinc-500 text-[11px] mb-1">TEAM NAME</label>
            <input
              type="text"
              placeholder="e.g. Candidate Team X"
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-white placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>
          <div>
            <label className="block text-emerald-400 text-[11px] mb-1">SOLVED COUNT (PRIMARY)</label>
            <input
              type="number"
              min="0"
              max="50"
              value={newSolves}
              onChange={(e) => setNewSolves(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-white focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>
          <div>
            <label className="block text-blue-400 text-[11px] mb-1">SCORE (SECONDARY)</label>
            <input
              type="number"
              min="0"
              max="2000"
              step="5"
              value={newScore}
              onChange={(e) => setNewScore(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-white focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
          <div>
            <label className="block text-amber-400 text-[11px] mb-1">SOLVE TIME (MINUTES)</label>
            <input
              type="number"
              min="1"
              max="60"
              value={newTimeMinutes}
              onChange={(e) => setNewTimeMinutes(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-white focus:outline-none focus:border-amber-500 transition-colors"
            />
          </div>
          <div className="flex items-end">
            <button
              id="inject-team-btn"
              type="submit"
              className="w-full flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Simulate Team</span>
            </button>
          </div>
        </form>
      </div>

      {/* Proof Explanatory Callout */}
      <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/60 font-mono text-xs flex items-start gap-3">
        <Info className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
        <div className="text-zinc-300 leading-relaxed text-[11px]">
          <strong className="text-white">Mathematical Proof Verified:</strong> Candidate Team A has <strong>20 solves and 200 pts</strong>. Candidate Team B has <strong>19 solves and 350 pts</strong>. Candidate Team A is unconditionally awarded <strong>Rank #1</strong> because solved problems strictly precedes total score. A team cannot overcome a deficit in solved problems by accumulating points on harder challenges.
        </div>
      </div>
    </div>
  );
};
