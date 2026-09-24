/**
 * BUG RIP - Canonical Competition Rules Engine
 * 
 * CRITICAL DIRECTIVE:
 * These rules are immutable and represent the core competition mechanics
 * of the BUG RIP Java Debugging CTF symposium.
 * 
 * 1. Ranking: Solved Count (Primary) -> Score (Secondary) -> Earliest Achievement (Tiebreaker)
 * 2. Team Size: 1 to 3 members, sourced directly from CSV.
 * 3. Simultaneous Work: Allowed (e.g. Member 1 on Prob 7, Member 2 on Prob 10, Member 3 on Prob 12).
 * 4. Same-Problem Race: Only the first valid submission counts. The second gets
 *    "This problem was just completed by another team member." with no duplicate score or unlocks.
 * 5. Difficulty Progression: Unlocked based on UNIQUE completed problems threshold.
 *    Teams may freely return to earlier difficulties.
 * 6. Duration: Exactly 60 minutes. Server is authoritative.
 */

import {
  ChallengeDifficulty,
  DifficultyConfig,
  EventState,
  LeaderboardEntry,
  SubmissionResult,
  TeamProgress,
} from '../types/competition';

export const COMPETITION_DURATION_MINUTES = 60;
export const COMPETITION_DURATION_SECONDS = COMPETITION_DURATION_MINUTES * 60;

export const INITIAL_DIFFICULTY_CONFIGS: DifficultyConfig[] = [
  {
    difficulty: ChallengeDifficulty.EASY,
    displayName: 'Easy',
    requiredSolvesToUnlockNext: 4, // Solves in Easy required to unlock Medium
    defaultPoints: 10,
    order: 1,
  },
  {
    difficulty: ChallengeDifficulty.MEDIUM,
    displayName: 'Medium',
    requiredSolvesToUnlockNext: 3, // Solves in Medium required to unlock Hard
    defaultPoints: 25,
    order: 2,
  },
  {
    difficulty: ChallengeDifficulty.HARD,
    displayName: 'Hard',
    requiredSolvesToUnlockNext: 2, // Solves in Hard required to unlock Extreme
    defaultPoints: 50,
    order: 3,
  },
  {
    difficulty: ChallengeDifficulty.EXTREME,
    displayName: 'Extreme',
    requiredSolvesToUnlockNext: 0, // Top tier
    defaultPoints: 100,
    order: 4,
  },
];

/**
 * Validates team size rule: Teams must have 1, 2, or 3 members.
 */
export function validateTeamSize(memberCount: number): { valid: boolean; error?: string } {
  if (memberCount < 1 || memberCount > 3) {
    return {
      valid: false,
      error: `BUG SNIPER requires teams of 1 to 3 registered members. Received: ${memberCount}`,
    };
  }
  return { valid: true };
}

/**
 * Validates maximum concurrent sessions for a team.
 * Derived strictly from registeredMemberCount:
 * 1-member team allows at most 1 active session.
 * 2-member team allows at most 2 active sessions.
 * 3-member team allows at most 3 active sessions.
 */
export function validateConcurrentSessionLimit(
  currentActiveSessions: number,
  registeredMemberCount: number,
): boolean {
  return currentActiveSessions < registeredMemberCount;
}

/**
 * Normalizes team name for verification comparisons (whitespace trimming & case-insensitivity).
 */
export function normalizeTeamName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Verifies participant credentials against imported CSV records.
 * Team code is the secret credential; team name provides additional identity verification.
 * Does not reveal which specific credential was incorrect.
 */
export function verifyTeamCredentials(
  enteredTeamName: string,
  enteredTeamCode: string,
  storedTeamName: string,
  storedTeamCode: string,
): boolean {
  if (!enteredTeamName || !enteredTeamCode) return false;
  const matchName = normalizeTeamName(enteredTeamName) === normalizeTeamName(storedTeamName);
  const matchCode = enteredTeamCode.trim() === storedTeamCode.trim();
  return matchName && matchCode;
}

/**
 * Determines difficulty unlock status based on unique solves.
 * 
 * Rules:
 * - EASY is unlocked by default.
 * - MEDIUM unlocks when team reaches required unique solves in EASY.
 * - HARD unlocks when team reaches required unique solves in MEDIUM.
 * - EXTREME unlocks when team reaches required unique solves in HARD.
 * - Teams can ALWAYS return to solve problems in earlier unlocked difficulties.
 */
export function calculateUnlockedDifficulties(
  solvedChallengesByDifficulty: Record<ChallengeDifficulty, number>,
  configs: DifficultyConfig[] = INITIAL_DIFFICULTY_CONFIGS,
  adminOverrides?: { unlockAll?: boolean; unlockedDifficulties?: ChallengeDifficulty[] },
): ChallengeDifficulty[] {
  if (adminOverrides?.unlockAll) {
    return [
      ChallengeDifficulty.EASY,
      ChallengeDifficulty.MEDIUM,
      ChallengeDifficulty.HARD,
      ChallengeDifficulty.EXTREME,
    ];
  }

  if (adminOverrides?.unlockedDifficulties && adminOverrides.unlockedDifficulties.length > 0) {
    return Array.from(new Set([ChallengeDifficulty.EASY, ...adminOverrides.unlockedDifficulties]));
  }

  const unlocked: ChallengeDifficulty[] = [ChallengeDifficulty.EASY];

  // Check Easy -> Medium
  const easyConfig = configs.find((c) => c.difficulty === ChallengeDifficulty.EASY);
  const easySolves = solvedChallengesByDifficulty[ChallengeDifficulty.EASY] || 0;
  if (easyConfig && easySolves >= easyConfig.requiredSolvesToUnlockNext) {
    unlocked.push(ChallengeDifficulty.MEDIUM);
  }

  // Check Medium -> Hard
  const medConfig = configs.find((c) => c.difficulty === ChallengeDifficulty.MEDIUM);
  const medSolves = solvedChallengesByDifficulty[ChallengeDifficulty.MEDIUM] || 0;
  if (unlocked.includes(ChallengeDifficulty.MEDIUM) && medConfig && medSolves >= medConfig.requiredSolvesToUnlockNext) {
    unlocked.push(ChallengeDifficulty.HARD);
  }

  // Check Hard -> Extreme
  const hardConfig = configs.find((c) => c.difficulty === ChallengeDifficulty.HARD);
  const hardSolves = solvedChallengesByDifficulty[ChallengeDifficulty.HARD] || 0;
  if (unlocked.includes(ChallengeDifficulty.HARD) && hardConfig && hardSolves >= hardConfig.requiredSolvesToUnlockNext) {
    unlocked.push(ChallengeDifficulty.EXTREME);
  }

  return unlocked;
}

/**
 * Resolves same-problem submission race condition.
 * 
 * RULE:
 * If multiple team members submit the same problem nearly simultaneously:
 * ONLY the first valid completion counts.
 * The second submission must not increase solved count, score, or duplicate unlocks.
 */
export function processSubmissionRace(
  currentProgress: TeamProgress,
  challengeId: string,
  points: number,
  submissionTimestamp: number,
  sessionId?: string,
): { updatedProgress: TeamProgress; result: SubmissionResult } {
  // Check if challenge is already solved by the team
  if (currentProgress.solvedChallengeIds.includes(challengeId)) {
    return {
      updatedProgress: currentProgress,
      result: {
        accepted: false,
        alreadySolvedByTeammate: true,
        message: 'This problem has already been completed.',
      },
    };
  }

  // First solve counts
  const updatedProgress: TeamProgress = {
    ...currentProgress,
    solvedChallengeIds: [...currentProgress.solvedChallengeIds, challengeId],
    problemsSolved: currentProgress.problemsSolved + 1,
    totalScore: currentProgress.totalScore + points,
    lastSolveTimestamp: submissionTimestamp,
    solveHistory: [
      ...currentProgress.solveHistory,
      {
        challengeId,
        solvedAt: submissionTimestamp,
        pointsAwarded: points,
        solvedBySessionId: sessionId,
      },
    ],
  };

  return {
    updatedProgress,
    result: {
      accepted: true,
      alreadySolvedByTeammate: false,
      message: 'Challenge solved successfully! Points awarded.',
      newSolvedCount: updatedProgress.problemsSolved,
      newScore: updatedProgress.totalScore,
    },
  };
}

/**
 * IMMUTABLE WINNER RANKING COMPARATOR:
 * 
 * 1. PRIMARY: Problems Solved (higher ranks better)
 * 2. SECONDARY: Score (higher ranks better)
 * 3. FINAL TIEBREAKER: Earliest achievement time (smaller timestamp ranks better)
 * 
 * Example:
 * Team A (20 solves, 200 pts) > Team B (19 solves, 250 pts)
 * Team C (15 solves, 200 pts, finished at 10:30) > Team D (15 solves, 200 pts, finished at 10:45)
 */
export function compareTeamsForLeaderboard(a: LeaderboardEntry, b: LeaderboardEntry): number {
  // 1. Primary: Problems Solved (descending)
  if (b.problemsSolved !== a.problemsSolved) {
    return b.problemsSolved - a.problemsSolved;
  }

  // 2. Secondary: Score (descending)
  if (b.score !== a.score) {
    return b.score - a.score;
  }

  // 3. Final Tiebreaker: Earliest achievement timestamp (ascending - earlier time wins)
  // If a team solved 0 problems, lastSolveTimestamp might be 0 or Infinity.
  const aTime = a.lastSolveTimestamp || Number.MAX_SAFE_INTEGER;
  const bTime = b.lastSolveTimestamp || Number.MAX_SAFE_INTEGER;
  return aTime - bTime;
}

/**
 * Sorts and assigns deterministic ranks to leaderboard entries.
 */
export function rankLeaderboard(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  const sorted = [...entries].sort(compareTeamsForLeaderboard);
  return sorted.map((entry, index) => ({
    ...entry,
    rank: index + 1,
  }));
}

/**
 * Validates whether code execution or flag submission is permitted given current EventState.
 */
export function canExecuteOrSubmit(state: EventState): { allowed: boolean; reason?: string } {
  if (state === EventState.NOT_STARTED) {
    return { allowed: false, reason: 'Competition has not started yet. Please wait in the waiting room.' };
  }
  if (state === EventState.PAUSED) {
    return { allowed: false, reason: 'Competition is currently PAUSED by the organizer.' };
  }
  if (state === EventState.ENDED) {
    return { allowed: false, reason: 'Competition has ENDED. No further submissions are accepted.' };
  }
  return { allowed: true };
}
