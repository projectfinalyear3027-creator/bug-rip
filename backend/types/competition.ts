/**
 * BUG RIP - Core Competition Type Definitions
 * Canonical definitions for teams, participants, event states, difficulties,
 * submissions, and leaderboard rankings.
 * 
 * IMMUTABLE RULES ENFORCED:
 * - 60-Minute Competition duration
 * - 1 to 3 members per team (sourced exclusively from CSV)
 * - Ranking: Problems Solved (Primary) -> Score (Secondary) -> Earliest Achievement (Tiebreaker)
 * - 4 Initial Difficulties: EASY, MEDIUM, HARD, EXTREME
 * - Solve-count based unlocks (unique problems solved)
 */

export enum EventState {
  NOT_STARTED = 'NOT_STARTED',
  RUNNING = 'RUNNING',
  PAUSED = 'PAUSED',
  ENDED = 'ENDED',
}

export enum ChallengeDifficulty {
  EASY = 'EASY',
  MEDIUM = 'MEDIUM',
  HARD = 'HARD',
  EXTREME = 'EXTREME',
}

export interface ParticipantRecord {
  participantId: string;
  name: string;
  email: string;
  college: string;
  teamName: string;
  teamCode: string; // Secret credential provided by the symposium CSV
}

export interface Team {
  id: string;
  teamName: string;
  teamCode: string; // Sourced strictly from CSV - never auto-generated!
  registeredMemberCount: number; // 1, 2, or 3
  members: ParticipantRecord[];
  createdAt: string;
}

export interface TeamSessionState {
  teamId: string;
  activeSessionCount: number; // Maximum 1 for 1-member team, 2 for 2-member team, 3 for 3-member team
  maxAllowedSessions: number; // Exactly equal to registeredMemberCount
  connectedMembers: Array<{
    sessionId: string;
    participantId?: string;
    connectedAt: string;
    lastHeartbeat: string;
  }>;
}

export interface DifficultyConfig {
  difficulty: ChallengeDifficulty;
  displayName: string;
  requiredSolvesToUnlockNext: number; // e.g., 6 unique solves in Easy to unlock Medium
  defaultPoints: number;
  order: number;
}

export interface ChallengeMetadata {
  id: string;
  title: string;
  difficulty: ChallengeDifficulty;
  points: number;
  description: string;
  // Flag is never exposed to client!
  flagFormat: string; // e.g., "DBG{...}"
}

export interface TeamProgress {
  teamId: string;
  solvedChallengeIds: string[]; // List of unique solved challenge IDs
  problemsSolved: number; // Primary leaderboard metric
  totalScore: number;     // Secondary leaderboard metric
  lastSolveTimestamp: number; // Milliseconds timestamp of latest solve (Earliest achievement tiebreaker)
  unlockedDifficulties: ChallengeDifficulty[];
  solveHistory: Array<{
    challengeId: string;
    solvedAt: number;
    pointsAwarded: number;
    solvedBySessionId?: string;
  }>;
}

export interface LeaderboardEntry {
  rank: number;
  teamId: string;
  teamName: string;
  connectedMemberCount: number;
  registeredMemberCount: number;
  problemsSolved: number; // Primary
  score: number;          // Secondary
  lastSolveTimestamp: number; // Final tiebreaker: earlier timestamp wins
}

export interface SubmissionResult {
  accepted: boolean;
  message: string;
  alreadySolvedByTeammate?: boolean;
  newSolvedCount?: number;
  newScore?: number;
  unlockedDifficulties?: ChallengeDifficulty[];
}

/**
 * Public/Safe test case format sent to participants
 */
export interface ParticipantTestCaseDTO {
  id: string;
  inputData: string;
  expectedOutput: string;
  testType: string;
  displayOrder?: number;
  explanation?: string | null;
}

/**
 * PARTICIPANT CHALLENGE DTO (RESTRICTED PROJECTION)
 * STRICT SECURITY INVARIANT:
 * This projection MUST NEVER contain:
 * - solution / solutionCode / referenceSolution
 * - hiddenTests / hiddenTestCases
 * - flag / flagHash / flagVerifier / verifier
 * - adminNotes / answer / answerExplanation
 */
export interface ParticipantChallengeDTO {
  id: string;
  roundId: string;
  title: string;
  slug: string;
  description: string;
  starterCode: string; // The buggy Java code to debug
  buggyCode?: string; // Explicit alias for clarity
  score: number;
  displayOrder: number;
  validationType: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  maxOutputBytes: number;
  maxSourceBytes: number;
  status: 'LOCKED' | 'AVAILABLE' | 'IN_PROGRESS' | 'COMPLETED';
  attemptCount: number;
  publicTestCases: ParticipantTestCaseDTO[];
}

/**
 * PARTICIPANT CHALLENGE LIST ITEM DTO
 */
export interface ParticipantChallengeListItemDTO {
  id: string;
  roundId: string;
  title: string;
  slug: string;
  score: number;
  displayOrder: number;
  validationType: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  status: 'LOCKED' | 'AVAILABLE' | 'IN_PROGRESS' | 'COMPLETED';
  attemptCount: number;
}

/**
 * ADMIN CHALLENGE DTO (ORGANIZER FULL PROJECTION)
 * Organizers have full visibility into buggy source, solution code,
 * hidden test cases, flag verifiers, and admin notes.
 */
export interface AdminChallengeDTO {
  id: string;
  roundId: string;
  title: string;
  slug: string;
  description: string;
  starterCode: string; // Buggy source code
  solutionCode?: string | null; // Corrected reference solution
  adminNotes?: string | null; // Organizer defect explanation
  score: number;
  displayOrder: number;
  validationType: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  maxOutputBytes: number;
  maxSourceBytes: number;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  testCases?: any[]; // Full test cases including hidden
  flagVerifier?: string | null;
  round?: any;
}
